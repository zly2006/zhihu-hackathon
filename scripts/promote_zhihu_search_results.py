"""Promote quality-passed answer HTML already present in Zhihu search payloads.

This is a bounded recovery path for an API anti-bot window. It does not make
new requests: it turns a search result that already contains answer HTML into
the same ``SourceRecordV1`` contract, and marks the raw payload as
``search_result_only`` so a later detail refresh can be distinguished from a
full search → question feed → answer capture.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from sqlalchemy import select

from decision_knowledge.contracts.source_record import SourceRecordV1
from decision_knowledge.db import Database
from decision_knowledge.ingest.html_text import html_fragment_to_text
from decision_knowledge.ingest.models import ContentItem
from decision_knowledge.ingest.quality import (
    assess_answer_quality,
    extract_keyword_candidate_sources,
    extract_keyword_candidates,
)

try:
    from scripts.collect_zhihu_search_question import (
        ADAPTER_CODE,
        ADAPTER_VERSION,
        _count,
        _object,
        _timestamp,
    )
except ModuleNotFoundError:  # pragma: no cover - direct script execution
    from collect_zhihu_search_question import (  # type: ignore[no-redef]
        ADAPTER_CODE,
        ADAPTER_VERSION,
        _count,
        _object,
        _timestamp,
    )


def _positive_int(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("必须大于零")
    return number


def _iter_records(paths: Iterable[Path]) -> Iterable[SourceRecordV1]:
    for path in paths:
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                yield SourceRecordV1.model_validate(json.loads(line))


def _existing_ids(database_url: str) -> set[str]:
    database = Database(database_url)
    with database.session() as session:
        return set(
            session.scalars(
                select(ContentItem.external_id).where(
                    ContentItem.source_code == "zhihu",
                    ContentItem.external_type == "answer",
                )
            ).all()
        )


def _search_payload(record: SourceRecordV1) -> dict[str, Any] | None:
    payload = record.raw.payload
    responses = payload.get("api_responses")
    if not isinstance(responses, dict):
        return None
    search = responses.get("search")
    return search if isinstance(search, dict) else None


def _candidates(
    records: Iterable[SourceRecordV1], existing: set[str]
) -> tuple[dict[str, Any], ...]:
    by_id: dict[str, dict[str, Any]] = {}
    for source_record in records:
        search_payload = _search_payload(source_record)
        if search_payload is None:
            continue
        for item in search_payload.get("data", []):
            if not isinstance(item, dict):
                continue
            answer = _object(item.get("object"))
            if answer is None or answer.get("type") != "answer":
                continue
            answer_id = str(answer.get("id", "")).strip()
            if not answer_id or answer_id in existing:
                continue
            raw_html = str(answer.get("content", "")).strip()
            body = html_fragment_to_text(raw_html)
            question = _object(answer.get("question"))
            question_id = str(question.get("id", "")).strip() if question else ""
            title = html_fragment_to_text(str(question.get("name", ""))).strip() if question else ""
            quality = assess_answer_quality(answer)
            if not question_id or not title or not raw_html or not body or not quality.accepted:
                continue
            candidate = {
                "source_record": source_record,
                "search_payload": search_payload,
                "search_item": item,
                "answer": answer,
                "answer_id": answer_id,
                "question_id": question_id,
                "title": title[:2000],
                "raw_html": raw_html,
                "body": body,
                "quality": quality,
            }
            previous = by_id.get(answer_id)
            if previous is None or _rank(candidate) > _rank(previous):
                by_id[answer_id] = candidate
    return tuple(sorted(by_id.values(), key=_rank, reverse=True))


def _rank(candidate: dict[str, Any]) -> tuple[int, int, int, str]:
    answer = candidate["answer"]
    quality = candidate["quality"]
    voteup = answer.get("voteup_count") if isinstance(answer.get("voteup_count"), int) else 0
    return (quality.score, voteup, len(candidate["body"]), candidate["answer_id"])


def _build_record(candidate: dict[str, Any]) -> SourceRecordV1:
    source_record: SourceRecordV1 = candidate["source_record"]
    answer: dict[str, Any] = candidate["answer"]
    answer_id = candidate["answer_id"]
    question_id = candidate["question_id"]
    canonical_url = f"https://www.zhihu.com/answer/{answer_id}"
    author = _object(answer.get("author"))
    author_id = str(author.get("id", "")).strip() if author else ""
    source_payload = source_record.raw.payload
    search_url = str(source_payload.get("endpoints", {}).get("search", ""))
    query = str(source_payload.get("query", "")).strip()
    discovery_round = source_payload.get("discovery_round", 0)
    if not isinstance(discovery_round, int) or discovery_round < 0:
        discovery_round = 0
    discovery_run_id = source_payload.get("discovery_run_id")
    if not isinstance(discovery_run_id, str):
        discovery_run_id = ""
    raw_payload: dict[str, Any] = {
        "capture_method": "zhihu_search_result_promotion",
        "promotion_stage": "search_result_only",
        "promotion_reason": (
            "search payload already contained answer HTML; detail endpoint was rate-limited"
        ),
        "query": query,
        "discovery_round": discovery_round,
        "quality": candidate["quality"].as_dict(),
        "keyword_candidates": list(extract_keyword_candidates(answer)),
        "keyword_candidate_sources": [
            {"term": term, "origin": origin}
            for term, origin in extract_keyword_candidate_sources(answer)
        ],
        "endpoints": {
            "search": search_url,
            "question_feed": None,
            "answer": canonical_url,
        },
        "api_responses": {
            "search": candidate["search_payload"],
            "question_feed": {
                "status": "not_fetched",
                "reason": "zhihu_api_error_40352",
            },
            "answer_detail": None,
            "search_result_as_answer": answer,
        },
        "matched_items": {
            "search_result": candidate["search_item"],
            "question_feed_item": None,
        },
    }
    if discovery_run_id:
        raw_payload["discovery_run_id"] = discovery_run_id
    raw_hash = hashlib.sha256(
        json.dumps(raw_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode(
            "utf-8"
        )
    ).hexdigest()
    topics: list[dict[str, str]] = []
    question = _object(answer.get("question"))
    raw_topics = question.get("topics") if question else None
    if isinstance(raw_topics, list):
        for raw_topic in raw_topics:
            topic = _object(raw_topic)
            if topic and topic.get("id") and topic.get("name"):
                topics.append({"external_id": str(topic["id"]), "name": str(topic["name"])})
    return SourceRecordV1.model_validate(
        {
            "schema_version": "source_record.v1",
            "source": {
                "code": source_record.source.code,
                "adapter_code": ADAPTER_CODE,
                "adapter_version": ADAPTER_VERSION,
                "authorization_ref": source_record.source.authorization_ref,
            },
            "external_ref": {
                "type": "answer",
                "id": answer_id,
                "parent": {"type": "question", "id": question_id},
            },
            "canonical_url": canonical_url,
            "fetched_at": source_record.fetched_at,
            "source_created_at": _timestamp(answer.get("created_time")),
            "source_updated_at": _timestamp(answer.get("updated_time")),
            "availability": "AVAILABLE",
            "content": {
                "title": candidate["title"],
                "body_format": "HTML",
                "body": candidate["body"],
                "raw_html": candidate["raw_html"],
                "language": "zh-CN",
            },
            "topics": topics,
            "engagement": {
                "observed_at": source_record.fetched_at,
                "voteup_count": _count(answer.get("voteup_count")),
                "comment_count": _count(answer.get("comment_count")),
                "thanks_count": _count(answer.get("thanks_count")),
            },
            "restricted_author": {"external_id": author_id} if author_id else None,
            "raw": {"sha256": raw_hash, "payload": raw_payload},
        }
    )


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, action="append", required=True)
    parser.add_argument("--database-url", default="sqlite+pysqlite:///./local.db")
    parser.add_argument("--authorization-ref", required=True)
    parser.add_argument("--limit", type=_positive_int, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    args = _arguments()
    existing = _existing_ids(args.database_url)
    candidates = _candidates(_iter_records(args.input), existing)
    if len(candidates) < args.limit:
        raise SystemExit(
            f"eligible search-result candidates={len(candidates)} < requested={args.limit}"
        )
    records = []
    for candidate in candidates[: args.limit]:
        record = _build_record(candidate)
        if record.source.authorization_ref != args.authorization_ref:
            record = record.model_copy(
                update={
                    "source": record.source.model_copy(
                        update={"authorization_ref": args.authorization_ref}
                    )
                }
            )
        records.append(record)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        "".join(record.model_dump_json() + "\n" for record in records),
        encoding="utf-8",
    )
    print(f"WROTE promoted_records={len(records)} path={args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
