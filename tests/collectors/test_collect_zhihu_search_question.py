import hashlib
import json
from datetime import UTC, datetime
from typing import Any

from scripts.collect_zhihu_search_question import collect_query


def test_search_question_and_answer_responses_become_traceable_records() -> None:
    calls: list[str] = []
    search_result = {
        "type": "search_result",
        "object": {
            "type": "answer",
            "id": 7001,
            "question": {"id": 4201, "title": "转行前要准备什么？"},
        },
    }
    feed_item = {"type": "feed", "target": {"type": "answer", "id": 7001}}
    search_payload = {"data": [search_result], "paging": {"is_end": True}}
    feed_payload = {"data": [feed_item], "paging": {"is_end": True}}
    answer_detail = {
        "id": 7001,
        "type": "answer",
        "content": "<p>先验证方向，再离职。</p>",
        "created_time": 1_700_000_000,
        "updated_time": 1_700_000_100,
        "voteup_count": 18,
        "comment_count": 3,
        "thanks_count": 2,
        "author": {"id": "author-hash"},
        "question": {
            "id": 4201,
            "title": "转行前要准备什么？",
            "topics": [{"id": "topic-career", "name": "职业规划"}],
        },
    }

    def fetch_json(url: str) -> dict[str, Any]:
        calls.append(url)
        if "search_v3" in url:
            return search_payload
        if "/questions/4201/feeds" in url:
            return feed_payload
        if "/answers/7001" in url:
            return answer_detail
        raise AssertionError(f"unexpected URL: {url}")

    records = collect_query(
        "转行",
        authorization_ref="auth-zhihu-search",
        fetched_at=datetime(2026, 8, 21, tzinfo=UTC),
        max_questions=3,
        max_answers_per_question=5,
        fetch_json=fetch_json,
    )

    assert len(records) == 1
    record = records[0]
    assert record.source.adapter_code == "zhihu_search_question_api"
    assert record.source.authorization_ref == "auth-zhihu-search"
    assert record.external_ref.id == "7001"
    assert record.external_ref.parent is not None
    assert record.external_ref.parent.id == "4201"
    assert record.content.title == "转行前要准备什么？"
    assert record.content.body == "先验证方向，再离职。"
    assert record.content.raw_html == "<p>先验证方向，再离职。</p>"
    assert record.topics[0].name == "职业规划"
    assert record.raw.payload["capture_method"] == "zhihu_search_question_api"
    assert record.raw.payload["api_responses"] == {
        "search": search_payload,
        "question_feed": feed_payload,
        "answer_detail": answer_detail,
    }
    assert record.raw.payload["matched_items"] == {
        "search_result": search_result,
        "question_feed_item": feed_item,
    }
    serialized_raw = json.dumps(
        record.raw.payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    assert record.raw.sha256 == hashlib.sha256(serialized_raw).hexdigest()
    assert [
        "search_v3" in calls[0],
        "/questions/4201/feeds" in calls[1],
        "/answers/7001" in calls[2],
    ] == [True, True, True]


def test_collection_is_bounded_and_deduplicates_answers() -> None:
    calls: list[str] = []

    def fetch_json(url: str) -> dict[str, Any]:
        calls.append(url)
        if "search_v3" in url:
            return {
                "data": [
                    {"object": {"type": "question", "id": 1}},
                    {"object": {"type": "question", "id": 2}},
                ]
            }
        if "/questions/1/feeds" in url:
            return {
                "data": [
                    {"target": {"type": "answer", "id": 9}},
                    {"target": {"type": "answer", "id": 10}},
                ]
            }
        if "/answers/9" in url:
            return {
                "id": 9,
                "content": "<p>answer</p>",
                "question": {"id": 1, "title": "question"},
            }
        raise AssertionError(f"collection exceeded its bounds: {url}")

    records = collect_query(
        "bounded",
        authorization_ref="auth",
        fetched_at=datetime(2026, 8, 21, tzinfo=UTC),
        max_questions=1,
        max_answers_per_question=1,
        fetch_json=fetch_json,
    )

    assert [record.external_ref.id for record in records] == ["9"]
    assert len(calls) == 3
    assert json.loads(records[0].model_dump_json())["raw"]["payload"]["query"] == "bounded"
