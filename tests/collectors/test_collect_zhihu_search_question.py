import hashlib
import json
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from decision_knowledge.ingest.quality import assess_answer_quality, suggest_queries
from scripts.collect_zhihu_search_question import (
    _run_cookie_request,
    _run_signed_cookie_request,
    collect_query,
    collect_question,
)


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
        "content": (
            "<p>我先盘点了自己的能力、储蓄和行业机会，再决定是否离职。</p>"
            "<p>当时的关键不是要不要转行，而是先验证目标方向，降低裸辞和试错成本。</p>"
            "<p>我用三个月做了两个小项目，找从业者反馈，后来才决定离开原岗位。</p>"
        ),
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
    assert "先盘点了自己的能力" in record.content.body
    assert "验证目标方向" in record.content.body
    assert "后来才决定" in record.content.body
    assert record.content.raw_html.startswith("<p>")
    assert "</p><p>" in record.content.raw_html
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
    assert record.raw.payload["quality"]["accepted"] is True
    assert record.raw.payload["discovery_round"] == 0
    assert record.raw.payload["keyword_candidate_sources"] == [
        {"term": "转行前要准备什么", "origin": "question_title"},
        {"term": "职业规划", "origin": "topic"},
    ]


def test_collection_keeps_a_run_id_for_replayable_snowball_lineage() -> None:
    def fetch_json(url: str) -> dict[str, Any]:
        if "/questions/42/feeds" in url:
            return {"data": [{"target": {"type": "answer", "id": 99}}]}
        if "/answers/99" in url:
            return {
                "id": 99,
                "content": (
                    "<p>我先明确目标，再比较成本和风险。</p>"
                    "<p>当时有家庭和时间约束，所以先做小项目验证。</p>"
                    "<p>后来结果符合预期，最终才做出决定。</p>"
                    "<p>我还核对了岗位要求、试错时间和收入变化，避免只凭情绪做决定。</p>"
                ),
                "question": {"id": 42, "title": "问题标题"},
            }
        raise AssertionError(f"unexpected URL: {url}")

    records = collect_question(
        "42",
        authorization_ref="auth",
        fetched_at=datetime(2026, 8, 21, tzinfo=UTC),
        max_answers_per_question=1,
        fetch_json=fetch_json,
        discovery_run_id="run-42",
    )

    assert records[0].raw.payload["discovery_run_id"] == "run-42"


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
                "content": (
                    "<p>我先确认目标，再比较成本和风险。</p>"
                    "<p>当时我有明确的储蓄和时间安排，所以先做小项目验证方向。</p>"
                    "<p>后来结果符合预期，我才正式做出决定。</p>"
                    "<p>我还核对了岗位要求、试错时间和收入变化，记录了反馈，避免只凭情绪做决定。</p>"
                ),
                "question": {"id": 1, "title": "question"},
            }
        raise AssertionError(f"collection exceeded its bounds: {url}")

    records = collect_query(
        "bounded",
        authorization_ref="auth",
        fetched_at=datetime(2026, 8, 21, tzinfo=UTC),
        max_questions=1,
        max_answers_per_question=1,
        max_candidates_per_question=1,
        fetch_json=fetch_json,
    )

    assert [record.external_ref.id for record in records] == ["9"]
    assert len(calls) == 3
    assert json.loads(records[0].model_dump_json())["raw"]["payload"]["query"] == "bounded"


def test_quality_gate_rejects_thin_answers_and_accepts_decision_evidence() -> None:
    thin = assess_answer_quality({"content": "<p>看情况。</p>"})
    substantial = assess_answer_quality(
        {
            "content": (
                "<p>我当时需要在稳定工作和转行之间选择。</p>"
                "<p>因为家庭储蓄只够一年，所以先用下班时间做项目，比较机会成本和风险。</p>"
                "<p>三个月后拿到反馈，最终决定转行；这个结果依赖时间和资源条件。</p>"
            ),
            "voteup_count": 20,
        }
    )

    assert thin.accepted is False
    assert "正文过短" in thin.reasons
    assert substantial.accepted is True
    assert substantial.score >= 45


def test_collect_query_skips_rejected_candidate_and_keeps_next_answer() -> None:
    calls: list[str] = []

    def fetch_json(url: str) -> dict[str, Any]:
        calls.append(url)
        if "search_v3" in url:
            return {"data": [{"object": {"type": "question", "id": 1}}]}
        if "/questions/1/feeds" in url:
            return {
                "data": [
                    {"target": {"type": "answer", "id": 8}},
                    {"target": {"type": "answer", "id": 9}},
                ]
            }
        if "/answers/8" in url:
            return {"id": 8, "content": "<p>看情况。</p>", "question": {"id": 1, "title": "问题"}}
        return {
            "id": 9,
            "content": (
                "<p>我先确认目标，再比较成本和风险。</p>"
                "<p>当时我有明确的储蓄和时间安排，所以先做小项目验证方向。</p>"
                "<p>后来结果符合预期，我才正式做出决定。</p>"
                "<p>我还核对了岗位要求、试错时间和收入变化，记录了反馈，避免只凭情绪做决定。</p>"
            ),
            "question": {"id": 1, "title": "问题标题"},
        }

    records = collect_query(
        "质量",
        authorization_ref="auth",
        fetched_at=datetime(2026, 8, 21, tzinfo=UTC),
        max_questions=1,
        max_answers_per_question=1,
        max_candidates_per_question=2,
        fetch_json=fetch_json,
    )

    assert [record.external_ref.id for record in records] == ["9"]
    assert len(calls) == 4


def test_snowball_only_uses_quality_passed_record_keywords() -> None:
    calls: list[str] = []

    def fetch_json(url: str) -> dict[str, Any]:
        calls.append(url)
        if "search_v3" in url:
            return {"data": [{"object": {"type": "question", "id": 1}}]}
        if "/questions/1/feeds" in url:
            return {"data": [{"target": {"type": "answer", "id": 9}}]}
        return {
            "id": 9,
            "content": (
                "<p>我先确认目标，再比较成本和风险。</p>"
                "<p>当时我有明确的储蓄和时间安排，所以先做小项目验证方向。</p>"
                "<p>后来结果符合预期，我才正式做出决定。</p>"
                "<p>我还核对了岗位要求、试错时间和收入变化，记录了反馈，避免只凭情绪做决定。</p>"
            ),
            "question": {
                "id": 1,
                "title": "转行项目怎么验证？",
                "topics": [{"id": "career", "name": "职业转型"}],
            },
        }

    records = collect_query(
        "转行",
        authorization_ref="auth",
        fetched_at=datetime(2026, 8, 21, tzinfo=UTC),
        max_questions=1,
        max_answers_per_question=1,
        max_candidates_per_question=1,
        fetch_json=fetch_json,
    )
    next_queries = suggest_queries(records, seed_queries=("转行",), max_queries=3)

    assert next_queries == ("职业转型", "转行项目怎么验证")
    assert len(calls) == 3


def test_question_seed_starts_at_question_feeds_without_search() -> None:
    calls: list[str] = []

    def fetch_json(url: str) -> dict[str, Any]:
        calls.append(url)
        if "/questions/42/feeds" in url:
            return {"data": [{"target": {"type": "answer", "id": 99}}]}
        if "/answers/99" in url:
            return {
                "id": 99,
                "content": (
                    "<p>我先明确目标，再比较成本和风险。</p>"
                    "<p>当时有家庭和时间约束，所以先做小项目验证。</p>"
                    "<p>后来结果符合预期，最终才做出决定。</p>"
                    "<p>我还核对了岗位要求、试错时间和收入变化，记录了反馈，避免只凭情绪做决定。</p>"
                ),
                "question": {"id": 42, "title": "问题标题"},
            }
        raise AssertionError(f"unexpected URL: {url}")

    records = collect_question(
        "42",
        authorization_ref="auth",
        fetched_at=datetime(2026, 8, 21, tzinfo=UTC),
        max_answers_per_question=1,
        fetch_json=fetch_json,
    )

    assert len(records) == 1
    assert records[0].raw.payload["query"] == "question:42"
    assert "search_v3" not in calls[0]
    assert "/questions/42/feeds" in calls[0]


def test_feed_content_mode_keeps_html_without_answer_detail_request() -> None:
    calls: list[str] = []
    feed_target = {
        "id": 99,
        "type": "answer",
        "content": (
            "<p>我先明确目标，再比较成本和风险。</p>"
            "<p>当时有家庭和时间约束，所以先做小项目验证。</p>"
            "<p>后来结果符合预期，最终才做出决定。</p>"
            "<p>我还核对了岗位要求、试错时间和收入变化，避免只凭情绪做决定。</p>"
        ),
        "question": {
            "id": 42,
            "title": "问题标题",
            "topics": [{"id": "career", "name": "职业规划"}],
        },
        "voteup_count": 12,
        "comment_count": 2,
        "thanks_count": 1,
    }

    def fetch_json(url: str) -> dict[str, Any]:
        calls.append(url)
        if "/questions/42/feeds" in url:
            return {"data": [{"target": feed_target}]}
        raise AssertionError(f"feed-only mode requested an unexpected URL: {url}")

    records = collect_question(
        "42",
        authorization_ref="auth",
        fetched_at=datetime(2026, 8, 21, tzinfo=UTC),
        max_answers_per_question=1,
        fetch_json=fetch_json,
        use_feed_content=True,
    )

    assert len(records) == 1
    assert len(calls) == 1
    assert records[0].content.raw_html == feed_target["content"]
    assert records[0].raw.payload["answer_capture"] == "question_feed_target"
    assert records[0].raw.payload["api_responses"]["answer_detail"] == feed_target


def test_cookie_transport_reads_json_and_does_not_return_cookie_material(
    tmp_path: Path,
    monkeypatch: Any,
) -> None:
    cookie_file = tmp_path / "cookies.txt"
    cookie_file.write_text("session-secret", encoding="utf-8")

    def fake_run(args: list[str], **_: object) -> subprocess.CompletedProcess[bytes]:
        headers = [
            args[index + 1]
            for index, value in enumerate(args[:-1])
            if value == "--header"
        ]
        assert "Accept: application/json" in headers
        assert "Accept-Language: zh-CN,zh;q=0.9,en;q=0.5" in headers
        output_path = Path(args[args.index("--output") + 1])
        output_path.write_text('{"data": [], "paging": {"is_end": true}}', encoding="utf-8")
        return subprocess.CompletedProcess(args, 0, stdout=b"200", stderr=b"")

    monkeypatch.setattr(subprocess, "run", fake_run)

    payload = _run_cookie_request(cookie_file, "https://www.zhihu.com/api/v4/search_v3")

    assert payload == {"data": [], "paging": {"is_end": True}}
    assert "session-secret" not in json.dumps(payload)


def test_signed_cookie_transport_builds_ephemeral_zhurl_account(
    tmp_path: Path,
    monkeypatch: Any,
) -> None:
    cookie_file = tmp_path / "cookies.txt"
    cookie_file.write_text(
        "\n".join(
            (
                "# Netscape HTTP Cookie File",
                ".zhihu.com\tTRUE\t/\tTRUE\t0\tz_c0\tlogin-secret",
                ".zhihu.com\tTRUE\t/\tTRUE\t0\td_c0\tsigning-secret",
            )
        ),
        encoding="utf-8",
    )

    def fake_run(args: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        account_path = Path(kwargs["env"]["HOME"]) / ".zhihu-plus-plus" / "account.json"
        account = json.loads(account_path.read_text(encoding="utf-8"))
        assert account["login"] is True
        assert set(account["cookies"]) == {"z_c0", "d_c0"}
        assert args[:2] == ["zhurl", "--web"]
        return subprocess.CompletedProcess(args, 0, stdout='{"data": []}', stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)

    payload = _run_signed_cookie_request(
        "zhurl",
        cookie_file,
        "https://www.zhihu.com/api/v4/search_v3",
    )

    assert payload == {"data": []}
