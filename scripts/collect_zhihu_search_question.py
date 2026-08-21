"""Collect bounded Zhihu answers through search, question feeds, and answer APIs.

The command delegates signed web requests to ``zhurl``. It requires an explicit
authorization reference and never reads, writes, or prints Cookie material.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from uuid import uuid4

from decision_knowledge.contracts.source_record import SourceRecordV1
from decision_knowledge.ingest.html_text import html_fragment_to_text
from decision_knowledge.ingest.quality import (
    QualityAssessment,
    assess_answer_quality,
    extract_keyword_candidate_sources,
    extract_keyword_candidates,
    suggest_queries,
)

ADAPTER_CODE = "zhihu_search_question_api"
ADAPTER_VERSION = "1.0.0"
SEARCH_ENDPOINT = "https://www.zhihu.com/api/v4/search_v3"
QUESTION_FEEDS_ENDPOINT = "https://www.zhihu.com/api/v4/questions/{question_id}/feeds"
ANSWER_ENDPOINT = "https://www.zhihu.com/api/v4/answers/{answer_id}"
ANSWER_INCLUDE = ",".join(
    (
        "content",
        "excerpt",
        "thanks_count",
        "voteup_count",
        "comment_count",
        "question.topics",
        "author.badge_v2",
    )
)

FetchJson = Callable[[str], dict[str, Any]]


def _search_url(query: str, *, limit: int) -> str:
    params = {
        "q": query,
        "t": "general",
        "correction": 1,
        "offset": 0,
        "limit": limit,
        "search_source": "Normal",
        "vertical": "answer",
        "include": "data[*].highlight,object,type",
    }
    return f"{SEARCH_ENDPOINT}?{urlencode(params)}"


def _question_feeds_url(question_id: str, *, limit: int) -> str:
    params = {
        "limit": limit,
        "order": "default",
        "offset": 0,
        "include": "data[*].content,excerpt,headline,target.author.badge_v2",
    }
    return f"{QUESTION_FEEDS_ENDPOINT.format(question_id=question_id)}?{urlencode(params)}"


def _answer_url(answer_id: str) -> str:
    return f"{ANSWER_ENDPOINT.format(answer_id=answer_id)}?{urlencode({'include': ANSWER_INCLUDE})}"


def _object(value: object) -> dict[str, Any] | None:
    return value if isinstance(value, dict) else None


def _items(payload: dict[str, Any]) -> tuple[dict[str, Any], ...]:
    data = payload.get("data")
    if not isinstance(data, list):
        return ()
    return tuple(item for item in data if isinstance(item, dict))


def _question_id(search_result: dict[str, Any]) -> str | None:
    result_object = _object(search_result.get("object"))
    if result_object is None:
        return None
    if result_object.get("type") == "question" and result_object.get("id") is not None:
        return str(result_object["id"])
    question = _object(result_object.get("question"))
    if question and question.get("id") is not None:
        return str(question["id"])
    match = re.search(r"/question/(?P<question_id>[0-9]+)", str(result_object.get("url", "")))
    if match:
        return match.group("question_id")
    return None


def _answer_id(feed_item: dict[str, Any]) -> str | None:
    target = _object(feed_item.get("target"))
    if target and target.get("type") == "answer" and target.get("id") is not None:
        return str(target["id"])
    return None


def _timestamp(value: object) -> datetime | None:
    if isinstance(value, int | float) and value > 0:
        return datetime.fromtimestamp(value, UTC)
    return None


def _count(value: object) -> int | None:
    return value if isinstance(value, int) and value >= 0 else None


def _canonical_json(value: dict[str, Any]) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _build_record(
    *,
    query: str,
    authorization_ref: str,
    fetched_at: datetime,
    search_url: str,
    question_feed_url: str,
    answer_url: str,
    search_payload: dict[str, Any],
    question_feed_payload: dict[str, Any],
    search_result: dict[str, Any],
    question_feed_item: dict[str, Any],
    answer_detail: dict[str, Any],
    quality: QualityAssessment,
    discovery_round: int,
    discovery_run_id: str | None,
) -> SourceRecordV1:
    answer_id = str(answer_detail.get("id", "")).strip()
    question = _object(answer_detail.get("question"))
    question_id = str(question.get("id", "")).strip() if question else ""
    title = str(question.get("title", "")).strip() if question else ""
    raw_html = str(answer_detail.get("content", "")).strip()
    body = html_fragment_to_text(raw_html)
    if not answer_id or not question_id or not title or not raw_html or not body:
        raise ValueError("回答详情缺少回答 ID、问题、标题或正文")

    topics: list[dict[str, str]] = []
    raw_topics = question.get("topics") if question else None
    if isinstance(raw_topics, list):
        for raw_topic in raw_topics:
            topic = _object(raw_topic)
            if topic and topic.get("id") and topic.get("name"):
                topics.append(
                    {"external_id": str(topic["id"]), "name": str(topic["name"])}
                )

    author = _object(answer_detail.get("author"))
    author_id = str(author.get("id", "")).strip() if author else ""
    raw_payload = {
        "capture_method": ADAPTER_CODE,
        "query": query,
        "discovery_round": discovery_round,
        "quality": quality.as_dict(),
        "keyword_candidates": list(extract_keyword_candidates(answer_detail)),
        "keyword_candidate_sources": [
            {"term": term, "origin": origin}
            for term, origin in extract_keyword_candidate_sources(answer_detail)
        ],
        "endpoints": {
            "search": search_url,
            "question_feed": question_feed_url,
            "answer": answer_url,
        },
        "api_responses": {
            "search": search_payload,
            "question_feed": question_feed_payload,
            "answer_detail": answer_detail,
        },
        "matched_items": {
            "search_result": search_result,
            "question_feed_item": question_feed_item,
        },
    }
    if discovery_run_id:
        raw_payload["discovery_run_id"] = discovery_run_id
    response_sha256 = hashlib.sha256(_canonical_json(raw_payload)).hexdigest()
    return SourceRecordV1.model_validate(
        {
            "schema_version": "source_record.v1",
            "source": {
                "code": "zhihu",
                "adapter_code": ADAPTER_CODE,
                "adapter_version": ADAPTER_VERSION,
                "authorization_ref": authorization_ref,
            },
            "external_ref": {
                "type": "answer",
                "id": answer_id,
                "parent": {"type": "question", "id": question_id},
            },
            "canonical_url": f"https://www.zhihu.com/answer/{answer_id}",
            "fetched_at": fetched_at,
            "source_created_at": _timestamp(answer_detail.get("created_time")),
            "source_updated_at": _timestamp(answer_detail.get("updated_time")),
            "availability": "AVAILABLE",
            "content": {
                "title": title,
                "body_format": "HTML",
                "body": body,
                "raw_html": raw_html,
                "language": "zh-CN",
            },
            "topics": topics,
            "engagement": {
                "observed_at": fetched_at,
                "voteup_count": _count(answer_detail.get("voteup_count")),
                "comment_count": _count(answer_detail.get("comment_count")),
                "thanks_count": _count(answer_detail.get("thanks_count")),
            },
            "restricted_author": {"external_id": author_id} if author_id else None,
            "raw": {"sha256": response_sha256, "payload": raw_payload},
        }
    )


def _collect_question_answers(
    question_id: str,
    *,
    query: str,
    authorization_ref: str,
    fetched_at: datetime,
    max_answers_per_question: int,
    max_candidates_per_question: int,
    fetch_json: FetchJson,
    search_url: str,
    search_payload: dict[str, Any],
    search_result: dict[str, Any],
    discovery_round: int,
    discovery_run_id: str | None,
) -> tuple[SourceRecordV1, ...]:
    feed_url = _question_feeds_url(
        question_id,
        limit=max_candidates_per_question,
    )
    feed_payload = fetch_json(feed_url)
    records: list[SourceRecordV1] = []
    seen_answers: set[str] = set()
    accepted = 0
    inspected = 0
    for feed_item in _items(feed_payload):
        answer_id = _answer_id(feed_item)
        if not answer_id or answer_id in seen_answers:
            continue
        seen_answers.add(answer_id)
        inspected += 1
        answer_url = _answer_url(answer_id)
        answer_detail = fetch_json(answer_url)
        quality = assess_answer_quality(answer_detail)
        if not quality.accepted:
            if inspected >= max_candidates_per_question:
                break
            continue
        records.append(
            _build_record(
                query=query,
                authorization_ref=authorization_ref,
                fetched_at=fetched_at,
                search_url=search_url,
                question_feed_url=feed_url,
                answer_url=answer_url,
                search_payload=search_payload,
                question_feed_payload=feed_payload,
                search_result=search_result,
                question_feed_item=feed_item,
                answer_detail=answer_detail,
                quality=quality,
                discovery_round=discovery_round,
                discovery_run_id=discovery_run_id,
            )
        )
        accepted += 1
        if accepted >= max_answers_per_question:
            break
        if inspected >= max_candidates_per_question:
            break
    return tuple(records)


def collect_question(
    question_id: str,
    *,
    authorization_ref: str,
    fetched_at: datetime,
    max_answers_per_question: int,
    max_candidates_per_question: int | None = None,
    fetch_json: FetchJson,
    discovery_round: int = 0,
    discovery_run_id: str | None = None,
) -> tuple[SourceRecordV1, ...]:
    """Start from one question ID and collect its highest-ranked answers."""

    normalized_id = question_id.strip()
    if not normalized_id:
        raise ValueError("问题 ID 不能为空")
    if not normalized_id.isdecimal():
        raise ValueError("问题 ID 必须是数字")
    if max_answers_per_question < 1:
        raise ValueError("每题回答数必须大于零")
    candidate_limit = max_candidates_per_question or max_answers_per_question * 3
    if candidate_limit < 1:
        raise ValueError("候选回答数必须大于零")
    return _collect_question_answers(
        normalized_id,
        query=f"question:{normalized_id}",
        authorization_ref=authorization_ref,
        fetched_at=fetched_at,
        max_answers_per_question=max_answers_per_question,
        max_candidates_per_question=candidate_limit,
        fetch_json=fetch_json,
        search_url=f"https://www.zhihu.com/question/{normalized_id}",
        search_payload={"seed_question_id": normalized_id},
        search_result={
            "type": "seed_question",
            "object": {"type": "question", "id": normalized_id},
        },
        discovery_round=discovery_round,
        discovery_run_id=discovery_run_id,
    )


def collect_query(
    query: str,
    *,
    authorization_ref: str,
    fetched_at: datetime,
    max_questions: int,
    max_answers_per_question: int,
    max_candidates_per_question: int | None = None,
    fetch_json: FetchJson,
    discovery_round: int = 0,
    discovery_run_id: str | None = None,
) -> tuple[SourceRecordV1, ...]:
    """Run a bounded search → question feed → answer detail collection."""

    normalized_query = query.strip()
    if not normalized_query:
        raise ValueError("搜索词不能为空")
    if max_questions < 1 or max_answers_per_question < 1:
        raise ValueError("问题数和每题回答数必须大于零")
    candidate_limit = max_candidates_per_question or max_answers_per_question * 3
    if candidate_limit < 1:
        raise ValueError("候选回答数必须大于零")

    search_url = _search_url(normalized_query, limit=max(20, max_questions))
    search_payload = fetch_json(search_url)
    questions: dict[str, dict[str, Any]] = {}
    for search_result in _items(search_payload):
        question_id = _question_id(search_result)
        if question_id and question_id not in questions:
            questions[question_id] = search_result

    records: list[SourceRecordV1] = []
    for question_id, search_result in tuple(questions.items())[:max_questions]:
        records.extend(
            _collect_question_answers(
                question_id,
                query=normalized_query,
                authorization_ref=authorization_ref,
                fetched_at=fetched_at,
                max_answers_per_question=max_answers_per_question,
                max_candidates_per_question=candidate_limit,
                fetch_json=fetch_json,
                search_url=search_url,
                search_payload=search_payload,
                search_result=search_result,
                discovery_round=discovery_round,
                discovery_run_id=discovery_run_id,
            )
        )
    return tuple(records)


def _run_zhurl(executable: str, url: str) -> dict[str, Any]:
    try:
        result = subprocess.run(
            [executable, "--web", url],
            capture_output=True,
            check=False,
            text=True,
            encoding="utf-8",
        )
    except FileNotFoundError as exc:
        raise RuntimeError(f"找不到 zhurl：{executable}") from exc
    if result.returncode != 0:
        raise RuntimeError(f"zhurl 请求失败（exit {result.returncode}）")
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError("zhurl 没有返回有效 JSON") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("zhurl 返回的顶层数据不是 JSON object")
    return payload


def _positive_int(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("必须大于零")
    return number


def _round_count(value: str) -> int:
    number = _positive_int(value)
    if number > 3:
        raise argparse.ArgumentTypeError("滚雪球轮次最多为 3")
    return number


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--query", action="append", default=[], help="搜索词，可重复")
    parser.add_argument("--question-id", action="append", default=[], help="问题 ID，可重复")
    parser.add_argument("--authorization-ref", required=True, help="数据库中的有效授权引用")
    parser.add_argument("--output", type=Path, required=True, help="SourceRecord JSONL 输出路径")
    parser.add_argument("--max-questions", type=_positive_int, default=5)
    parser.add_argument("--max-answers-per-question", type=_positive_int, default=10)
    parser.add_argument("--max-candidates-per-question", type=_positive_int)
    parser.add_argument("--snowball-rounds", type=_round_count, default=1)
    parser.add_argument("--max-snowball-queries", type=_positive_int, default=5)
    parser.add_argument("--zhurl", default="zhurl", help="zhurl 可执行文件路径")
    return parser.parse_args()


def main() -> int:
    args = _arguments()
    if not any(query.strip() for query in args.query) and not any(
        question_id.strip() for question_id in args.question_id
    ):
        print("ERROR: 至少提供一个 --query 或 --question-id", file=sys.stderr)
        return 2
    fetched_at = datetime.now(UTC)
    discovery_run_id = str(uuid4())
    records_by_key: dict[tuple[str, str], SourceRecordV1] = {}
    fetch_json = lambda url: _run_zhurl(args.zhurl, url)  # noqa: E731
    frontier = tuple(dict.fromkeys(query.strip() for query in args.query if query.strip()))
    seen_queries = set(frontier)
    question_seed_records: list[SourceRecordV1] = []
    try:
        for question_id in tuple(dict.fromkeys(args.question_id)):
            records = collect_question(
                question_id,
                authorization_ref=args.authorization_ref,
                fetched_at=fetched_at,
                max_answers_per_question=args.max_answers_per_question,
                max_candidates_per_question=args.max_candidates_per_question,
                fetch_json=fetch_json,
                discovery_run_id=discovery_run_id,
            )
            question_seed_records.extend(records)
            for record in records:
                records_by_key.setdefault((record.external_ref.id, record.raw.sha256), record)
        for discovery_round in range(args.snowball_rounds):
            round_records: list[SourceRecordV1] = (
                list(question_seed_records) if discovery_round == 0 else []
            )
            for query in frontier:
                records = collect_query(
                    query,
                    authorization_ref=args.authorization_ref,
                    fetched_at=fetched_at,
                    max_questions=args.max_questions,
                    max_answers_per_question=args.max_answers_per_question,
                    max_candidates_per_question=args.max_candidates_per_question,
                    fetch_json=fetch_json,
                    discovery_round=discovery_round,
                    discovery_run_id=discovery_run_id,
                )
                round_records.extend(records)
                for record in records:
                    records_by_key.setdefault(
                        (record.external_ref.id, record.raw.sha256), record
                    )
            if discovery_round + 1 >= args.snowball_rounds:
                break
            frontier = suggest_queries(
                round_records,
                seed_queries=tuple(seen_queries),
                max_queries=args.max_snowball_queries,
            )
            seen_queries.update(frontier)
            if not frontier:
                break
    except (RuntimeError, ValueError, KeyError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        "".join(record.model_dump_json() + "\n" for record in records_by_key.values()),
        encoding="utf-8",
    )
    print(f"WROTE records={len(records_by_key)} path={args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
