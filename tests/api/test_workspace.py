import json
from pathlib import Path

from fastapi.testclient import TestClient

from decision_knowledge.api import create_app
from decision_knowledge.db import Database

FIXTURE = Path(__file__).parents[1] / "fixtures" / "source_record.valid.json"


def test_user_can_search_and_open_an_ingested_answer(tmp_path: Path) -> None:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'workspace.db'}")
    database.create_schema()
    client = TestClient(create_app(database=database))

    payload = {
        "schema_version": "source_record.v1",
        "source": {
            "code": "zhihu",
            "adapter_code": "manual_url_capture",
            "adapter_version": "1.0.0",
            "authorization_ref": None,
        },
        "external_ref": {"type": "answer", "id": "workspace-001"},
        "canonical_url": "https://www.zhihu.com/answer/workspace-001",
        "fetched_at": "2026-08-21T03:05:37Z",
        "availability": "AVAILABLE",
        "content": {
            "title": "转行前应该先做什么？",
            "body_format": "HTML",
            "body": "先盘点已有能力，再决定是否转行。",
            "raw_html": "<p>先盘点已有能力，再决定是否转行。</p>",
            "language": "zh-CN",
        },
        "raw": {"sha256": "a" * 64, "payload": {"capture": "test"}},
    }
    ingest = client.post("/v1/source-records:batch", json={"records": [payload]})
    assert ingest.status_code == 200

    search = client.get("/api/search", params={"q": "转行"})
    assert search.status_code == 200
    assert search.json()["total"] == 1
    result = search.json()["items"][0]
    assert result["title"] == "转行前应该先做什么？"
    assert result["canonical_url"] == payload["canonical_url"]
    assert result["adapter_code"] == "manual_url_capture"

    detail = client.get(f"/api/snapshots/{result['snapshot_id']}")
    assert detail.status_code == 200
    assert detail.json()["raw_html"] == payload["content"]["raw_html"]

    database.dispose()


def test_admin_can_review_and_archive_without_losing_raw_evidence(tmp_path: Path) -> None:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'workspace.db'}")
    database.create_schema()
    client = TestClient(create_app(database=database))
    payload = {
        "schema_version": "source_record.v1",
        "source": {
            "code": "zhihu",
            "adapter_code": "manual_url_capture",
            "adapter_version": "1.0.0",
        },
        "external_ref": {"type": "answer", "id": "workspace-002"},
        "canonical_url": "https://www.zhihu.com/answer/workspace-002",
        "fetched_at": "2026-08-21T03:05:37Z",
        "availability": "AVAILABLE",
        "content": {
            "title": "原始标题",
            "body_format": "HTML",
            "body": "原始正文",
            "raw_html": "<p>原始正文</p>",
            "language": "zh-CN",
        },
        "raw": {"sha256": "b" * 64, "payload": {"capture": "test"}},
    }
    ingest = client.post("/v1/source-records:batch", json={"records": [payload]})
    snapshot_id = ingest.json()["items"][0]["snapshot_id"]
    item_id = ingest.json()["items"][0]["content_item_id"]

    review = client.patch(
        f"/api/admin/snapshots/{snapshot_id}",
        json={"review_status": "CONFIRMED", "review_note": "人工核对"},
    )
    assert review.status_code == 200
    assert review.json()["raw_html"] == "<p>原始正文</p>"
    archive = client.patch(f"/api/admin/content/{item_id}", json={"availability": "DELETED"})
    assert archive.status_code == 200
    assert client.get("/api/search", params={"q": "原始"}).json()["total"] == 0
    admin_detail = client.get(f"/api/admin/content/{item_id}")
    assert admin_detail.status_code == 200
    assert admin_detail.json()["snapshots"][0]["raw_html"] == "<p>原始正文</p>"
    database.dispose()


def test_only_confirmed_scenarios_and_branches_are_visible_to_users(tmp_path: Path) -> None:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'workspace.db'}")
    database.create_schema()
    client = TestClient(create_app(database=database))

    draft = client.post(
        "/api/admin/scenarios",
        json={
            "slug": "career-choice",
            "name": "职业选择",
            "summary": "先看约束，再看行动",
            "domain": "职业",
        },
    )
    assert draft.status_code == 200
    scenario_id = draft.json()["id"]
    branch = client.post(
        f"/api/admin/scenarios/{scenario_id}/branches",
        json={"label": "先工作", "action": "先工作再决定", "review_status": "CONFIRMED"},
    )
    assert branch.status_code == 200
    assert client.get("/api/scenarios").json()["items"] == []

    confirmed = client.patch(
        f"/api/admin/scenarios/{scenario_id}",
        json={"review_status": "CONFIRMED"},
    )
    assert confirmed.status_code == 200
    visible = client.get("/api/scenarios")
    assert visible.status_code == 200
    assert visible.json()["items"][0]["branches"][0]["label"] == "先工作"
    database.dispose()


def test_local_dual_end_pages_are_served_by_the_same_app(tmp_path: Path) -> None:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'workspace.db'}")
    database.create_schema()
    client = TestClient(create_app(database=database))

    user = client.get("/")
    admin = client.get("/admin")
    assets = client.get("/assets/styles.css")
    assert user.status_code == 200
    assert "人生决策知识库" in user.text
    assert "情景与分叉" in user.text
    assert "原文快照" in user.text
    assert 'data-ui="linear-workspace"' in user.text
    assert 'class="data-table snapshot-table"' in user.text
    assert admin.status_code == 200
    assert "知识库管理端" in admin.text
    assert "快照库" in admin.text
    assert "数据库层级导航" in admin.text
    assert 'data-ui="linear-workspace"' in admin.text
    assert 'class="data-table admin-snapshot-table"' in admin.text
    assert assets.status_code == 200
    assert "--accent: #5e6ad2" in assets.text
    assert "--shadow" not in assets.text
    database.dispose()


def test_admin_jsonl_import_reuses_idempotent_ingestion(tmp_path: Path) -> None:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'workspace.db'}")
    database.create_schema()
    client = TestClient(create_app(database=database))
    record = json.loads(FIXTURE.read_text(encoding="utf-8"))

    first = client.post("/api/admin/import", json={"records": [record]})
    replay = client.post("/api/admin/import", json={"records": [record]})
    assert first.status_code == 200
    assert first.json()["created"] == 1
    assert replay.json()["unchanged"] == 1
    assert client.get("/api/admin/stats").json()["snapshots"] == 1
    database.dispose()


def test_public_overview_explains_the_database_pipeline(tmp_path: Path) -> None:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'workspace.db'}")
    database.create_schema()
    client = TestClient(create_app(database=database))

    overview = client.get("/api/overview")

    assert overview.status_code == 200
    assert overview.json() == {
        "content_items": 0,
        "snapshots": 0,
        "raw_envelopes": 0,
        "discovery_runs": 0,
        "keyword_candidates": 0,
        "decision_candidates": 0,
        "scenarios": 0,
        "branches": 0,
        "confirmed_scenarios": 0,
        "unreviewed_snapshots": 0,
        "semantic_status": "待归类",
    }
    database.dispose()


def test_import_persists_snowball_lineage_and_decision_candidate(tmp_path: Path) -> None:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'workspace.db'}")
    database.create_schema()
    client = TestClient(create_app(database=database))
    payload = {
        "schema_version": "source_record.v1",
        "source": {
            "code": "zhihu",
            "adapter_code": "manual_upload",
            "adapter_version": "1.0.0",
        },
        "external_ref": {"type": "answer", "id": "derived-001"},
        "canonical_url": "https://www.zhihu.com/answer/derived-001",
        "fetched_at": "2026-08-21T03:05:37Z",
        "availability": "AVAILABLE",
        "content": {
            "title": "转行前如何验证方向？",
            "body_format": "HTML",
            "body": (
                "我当时需要在稳定工作和转行之间选择。"
                "因为家庭储蓄只够一年，所以先用下班时间做项目，比较机会成本和风险。"
                "三个月后拿到反馈，最终决定转行。"
            ),
            "raw_html": "<p>我当时需要在稳定工作和转行之间选择。</p>",
            "language": "zh-CN",
        },
        "raw": {
            "sha256": "c" * 64,
            "payload": {
                "discovery_run_id": "run-derived-001",
                "query": "转行",
                "discovery_round": 0,
                "quality": {"accepted": True, "score": 82},
                "keyword_candidates": ["职业转型", "风险控制"],
                "keyword_candidate_sources": [
                    {"term": "职业转型", "origin": "topic"},
                    {"term": "风险控制", "origin": "question_title"},
                ],
            },
        },
    }

    first = client.post("/api/admin/import", json={"records": [payload]})
    assert first.status_code == 200
    stats = client.get("/api/admin/stats").json()
    assert stats["keyword_candidates"] == 2
    assert stats["decision_candidates"] == 1
    assert stats["discovery_runs"] == 1

    queries = client.get("/api/admin/discovery/queries")
    assert queries.status_code == 200
    assert [item["term"] for item in queries.json()["items"]] == ["职业转型", "风险控制"]
    assert queries.json()["items"][0]["source_queries"] == ["转行"]
    assert queries.json()["items"][0]["run_ids"] == ["run-derived-001"]
    runs = client.get("/api/admin/discovery/runs")
    assert runs.json()["items"][0]["seed_queries"] == ["转行"]
    candidate = client.get("/api/admin/decision-candidates").json()["items"][0]
    assert candidate["title"] == "转行前如何验证方向？"
    assert candidate["review_status"] == "UNREVIEWED"
    assert "家庭储蓄" in candidate["context"]

    replay = client.post("/api/admin/import", json={"records": [payload]})
    assert replay.status_code == 200
    assert replay.json()["unchanged"] == 1
    assert client.get("/api/admin/stats").json()["keyword_candidates"] == 2

    reviewed = client.patch(
        f"/api/admin/decision-candidates/{candidate['id']}",
        json={"review_status": "CONFIRMED", "review_note": "已核对证据"},
    )
    assert reviewed.status_code == 200
    assert reviewed.json()["review_status"] == "CONFIRMED"
    database.dispose()
