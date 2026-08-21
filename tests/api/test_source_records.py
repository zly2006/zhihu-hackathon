import json
from datetime import UTC, datetime
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from decision_knowledge.api import create_app
from decision_knowledge.db import Database
from decision_knowledge.ingest.models import (
    ContentItem,
    ContentSnapshot,
    RawEnvelope,
    SourceAuthorization,
)

FIXTURES = Path(__file__).parents[1] / "fixtures"


def load_source_record() -> dict[str, object]:
    return json.loads((FIXTURES / "source_record.valid.json").read_text(encoding="utf-8"))


def test_manual_source_record_creates_content_snapshot(tmp_path: Path) -> None:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'ingest.db'}")
    database.create_schema()
    client = TestClient(create_app(database=database))

    response = client.post("/v1/source-records:batch", json={"records": [load_source_record()]})

    assert response.status_code == 200
    body = response.json()
    assert body["created"] == 1
    assert body["unchanged"] == 0
    assert body["rejected"] == 0
    assert body["items"][0]["status"] == "CREATED"
    assert body["items"][0]["content_item_id"]
    assert body["items"][0]["snapshot_id"]

    database.dispose()


def test_ingest_persists_source_url_and_raw_html_at_each_provenance_layer(
    tmp_path: Path,
) -> None:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'ingest.db'}")
    database.create_schema()
    client = TestClient(create_app(database=database))
    source_record = load_source_record()

    response = client.post(
        "/v1/source-records:batch", json={"records": [source_record]}
    )

    assert response.status_code == 200
    result = response.json()["items"][0]
    with database.session() as session:
        item = session.get(ContentItem, result["content_item_id"])
        snapshot = session.get(ContentSnapshot, result["snapshot_id"])
        assert item is not None
        assert snapshot is not None
        envelope = session.get(RawEnvelope, snapshot.raw_envelope_id)
        assert envelope is not None

        expected_url = source_record["canonical_url"]
        expected_html = source_record["content"]["raw_html"]
        assert item.canonical_url == expected_url
        assert envelope.canonical_url == expected_url
        assert envelope.raw_html == expected_html
        assert snapshot.raw_html == expected_html

    database.dispose()


def test_same_content_is_unchanged_when_replayed_ten_times(tmp_path: Path) -> None:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'ingest.db'}")
    database.create_schema()
    client = TestClient(create_app(database=database))
    payload = {"records": [load_source_record()]}

    responses = [
        client.post("/v1/source-records:batch", json=payload) for _ in range(10)
    ]
    first, *replays = responses

    assert first.status_code == 200
    assert all(replay.status_code == 200 for replay in replays)
    assert all(replay.json()["created"] == 0 for replay in replays)
    assert all(replay.json()["unchanged"] == 1 for replay in replays)
    assert all(
        replay.json()["items"][0]["status"] == "UNCHANGED" for replay in replays
    )
    assert all(
        replay.json()["items"][0]["snapshot_id"]
        == first.json()["items"][0]["snapshot_id"]
        for replay in replays
    )

    database.dispose()


def test_automated_source_without_authorization_is_rejected(tmp_path: Path) -> None:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'ingest.db'}")
    database.create_schema()
    client = TestClient(create_app(database=database))
    record = load_source_record()
    record["source"] = {
        "code": "zhihu",
        "adapter_code": "authorized_zhihu_adapter",
        "adapter_version": "1.0.0",
        "authorization_ref": None,
    }

    response = client.post("/v1/source-records:batch", json={"records": [record]})

    assert response.status_code == 200
    assert response.json()["created"] == 0
    assert response.json()["rejected"] == 1
    assert response.json()["items"][0]["status"] == "REJECTED"
    assert response.json()["items"][0]["content_item_id"] is None
    assert response.json()["items"][0]["snapshot_id"] is None

    database.dispose()


def test_manual_url_capture_does_not_require_automated_authorization(
    tmp_path: Path,
) -> None:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'ingest.db'}")
    database.create_schema()
    client = TestClient(create_app(database=database))
    record = load_source_record()
    record["source"] = {
        "code": "zhihu",
        "adapter_code": "manual_url_capture",
        "adapter_version": "1.0.0",
        "authorization_ref": None,
    }

    response = client.post("/v1/source-records:batch", json={"records": [record]})

    assert response.status_code == 200
    assert response.json()["created"] == 1
    assert response.json()["rejected"] == 0
    database.dispose()


def test_automated_source_with_unknown_authorization_is_rejected(tmp_path: Path) -> None:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'ingest.db'}")
    database.create_schema()
    client = TestClient(create_app(database=database))
    record = load_source_record()
    record["source"] = {
        "code": "zhihu",
        "adapter_code": "authorized_zhihu_adapter",
        "adapter_version": "1.0.0",
        "authorization_ref": "AUTH-DOES-NOT-EXIST",
    }

    response = client.post("/v1/source-records:batch", json={"records": [record]})

    assert response.status_code == 200
    assert response.json()["created"] == 0
    assert response.json()["rejected"] == 1
    assert response.json()["items"][0]["status"] == "REJECTED"
    database.dispose()


def test_automated_source_with_active_authorization_is_created(tmp_path: Path) -> None:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'ingest.db'}")
    database.create_schema()
    with database.session() as session:
        session.add(
            SourceAuthorization(
                reference="AUTH-2026-001",
                source_code="zhihu",
                adapter_code="authorized_zhihu_adapter",
                status="ACTIVE",
                valid_from=datetime(2020, 1, 1, tzinfo=UTC),
                valid_to=datetime(2099, 12, 31, tzinfo=UTC),
            )
        )

    client = TestClient(create_app(database=database))
    record = load_source_record()
    record["source"] = {
        "code": "zhihu",
        "adapter_code": "authorized_zhihu_adapter",
        "adapter_version": "1.0.0",
        "authorization_ref": "AUTH-2026-001",
    }

    response = client.post("/v1/source-records:batch", json={"records": [record]})

    assert response.status_code == 200
    assert response.json()["created"] == 1
    assert response.json()["rejected"] == 0
    database.dispose()


def test_engagement_change_preserves_raw_but_does_not_version_content(
    tmp_path: Path,
) -> None:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'ingest.db'}")
    database.create_schema()
    client = TestClient(create_app(database=database))
    first_record = load_source_record()
    second_record = load_source_record()
    second_record["engagement"]["voteup_count"] = 99
    second_record["raw"] = {
        "sha256": "b" * 64,
        "payload": {"id": "answer-001", "voteup_count": 99},
    }

    first = client.post(
        "/v1/source-records:batch", json={"records": [first_record]}
    )
    second = client.post(
        "/v1/source-records:batch", json={"records": [second_record]}
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["unchanged"] == 1
    assert second.json()["items"][0]["snapshot_id"] == first.json()["items"][0][
        "snapshot_id"
    ]
    with database.session() as session:
        assert session.scalar(select(func.count()).select_from(RawEnvelope)) == 2
        assert session.scalar(select(func.count()).select_from(ContentSnapshot)) == 1

    database.dispose()


def test_body_change_creates_a_new_content_snapshot(tmp_path: Path) -> None:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'ingest.db'}")
    database.create_schema()
    client = TestClient(create_app(database=database))
    first_record = load_source_record()
    edited_record = load_source_record()
    edited_record["content"]["body"] = "<p>毕业时我先工作，后来再读研。</p>"
    edited_record["raw"]["sha256"] = "c" * 64

    first = client.post(
        "/v1/source-records:batch", json={"records": [first_record]}
    )
    edited = client.post(
        "/v1/source-records:batch", json={"records": [edited_record]}
    )

    assert first.status_code == 200
    assert edited.status_code == 200
    assert edited.json()["created"] == 1
    assert edited.json()["items"][0]["snapshot_id"] != first.json()["items"][0][
        "snapshot_id"
    ]
    with database.session() as session:
        assert session.scalar(select(func.count()).select_from(ContentSnapshot)) == 2

    database.dispose()
