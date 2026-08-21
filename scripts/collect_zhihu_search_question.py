"""Collect bounded Zhihu answers through search, question feeds, and answer APIs.

The command delegates signed web requests to ``zhurl``. It requires an explicit
authorization reference and never reads, writes, or prints Cookie material.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from decision_knowledge.contracts.source_record import SourceRecordV1
from decision_knowledge.ingest.html_text import html_fragment_to_text

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


def collect_query(
    query: str,
    *,
    authorization_ref: str,
    fetched_at: datetime,
    max_questions: int,
    max_answers_per_question: int,
    fetch_json: FetchJson,
) -> tuple[SourceRecordV1, ...]:
    """Run a bounded search → question feed → answer detail collection."""

    if not query.strip():
        raise ValueError("搜索词不能为空")
    if max_questions < 1 or max_answers_per_question < 1:
        raise ValueError("问题数和每题回答数必须大于零")

    search_url = _search_url(query.strip(), limit=max(20, max_questions))
    search_payload = fetch_json(search_url)
    questions: dict[str, dict[str, Any]] = {}
    for search_result in _items(search_payload):
        question_id = _question_id(search_result)
        if question_id and question_id not in questions:
            questions[question_id] = search_result

    records: list[SourceRecordV1] = []
    seen_answers: set[str] = set()
    for question_id, search_result in tuple(questions.items())[:max_questions]:
        feed_url = _question_feeds_url(question_id, limit=max_answers_per_question)
        feed_payload = fetch_json(feed_url)
        accepted = 0
        for feed_item in _items(feed_payload):
            answer_id = _answer_id(feed_item)
            if not answer_id or answer_id in seen_answers:
                continue
            answer_url = _answer_url(answer_id)
            answer_detail = fetch_json(answer_url)
            records.append(
                _build_record(
                    query=query.strip(),
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
                )
            )
            seen_answers.add(answer_id)
            accepted += 1
            if accepted >= max_answers_per_question:
                break
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


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--query", action="append", required=True, help="搜索词，可重复")
    parser.add_argument("--authorization-ref", required=True, help="数据库中的有效授权引用")
    parser.add_argument("--output", type=Path, required=True, help="SourceRecord JSONL 输出路径")
    parser.add_argument("--max-questions", type=_positive_int, default=5)
    parser.add_argument("--max-answers-per-question", type=_positive_int, default=10)
    parser.add_argument("--zhurl", default="zhurl", help="zhurl 可执行文件路径")
    return parser.parse_args()


def main() -> int:
    args = _arguments()
    fetched_at = datetime.now(UTC)
    records_by_id: dict[str, SourceRecordV1] = {}
    fetch_json = lambda url: _run_zhurl(args.zhurl, url)  # noqa: E731
    try:
        for query in args.query:
            for record in collect_query(
                query,
                authorization_ref=args.authorization_ref,
                fetched_at=fetched_at,
                max_questions=args.max_questions,
                max_answers_per_question=args.max_answers_per_question,
                fetch_json=fetch_json,
            ):
                records_by_id.setdefault(record.external_ref.id, record)
    except (RuntimeError, ValueError, KeyError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        "".join(record.model_dump_json() + "\n" for record in records_by_id.values()),
        encoding="utf-8",
    )
    print(f"WROTE records={len(records_by_id)} path={args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
