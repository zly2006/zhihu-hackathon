from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import create_engine, func, select

from decision_knowledge.db import Database
from decision_knowledge.ingest.models import (
    ContentItem,
    ContentSnapshot,
    DecisionObject,
    DecisionObjectAssignment,
    RawEnvelope,
    SourceAuthorization,
)
from decision_knowledge.operations.database_sync import replace_database


def _url(path: Path) -> str:
    return f"sqlite+pysqlite:///{path}"


def _seed_source(database: Database) -> None:
    captured_at = datetime(2026, 8, 22, tzinfo=UTC)
    with database.session() as session:
        session.add_all(
            [
                ContentItem(
                    id="item-1",
                    source_code="zhihu",
                    external_type="answer",
                    external_id="answer-1",
                    canonical_url="https://www.zhihu.com/question/1/answer/1",
                    availability="AVAILABLE",
                ),
                RawEnvelope(
                    id="raw-1",
                    source_code="zhihu",
                    adapter_code="zhihu_search_question",
                    adapter_version="1",
                    authorization_ref="cookie-ref",
                    external_type="answer",
                    external_id="answer-1",
                    canonical_url="https://www.zhihu.com/question/1/answer/1",
                    fetched_at=captured_at,
                    payload_hash="a" * 64,
                    raw_html="<p>保留原始 HTML</p>",
                    payload={"id": "answer-1", "content": "<p>保留原始 HTML</p>"},
                ),
                DecisionObject(
                    id="object-1",
                    object_key="换工作",
                    name="换工作",
                    coel_codes=["A.4.2"],
                    coel_labels=["工作流动"],
                    taxonomy_version="LOCAL-v1",
                    confidence=0.95,
                ),
            ]
        )
        session.flush()
        session.add(
            ContentSnapshot(
                id="snapshot-1",
                content_item_id="item-1",
                raw_envelope_id="raw-1",
                captured_at=captured_at,
                title="要不要换工作？",
                body_format="html",
                body="保留正文",
                raw_html="<p>保留原始 HTML</p>",
                language="zh-CN",
                content_hash="b" * 64,
            )
        )
        session.flush()
        session.add(
            DecisionObjectAssignment(
                id="assignment-1",
                decision_object_id="object-1",
                content_snapshot_id="snapshot-1",
                question_external_id="1",
                source_title="要不要换工作？",
                extractor_version="decision-object-v1",
                model_id="test-model",
                confidence=0.95,
                evidence={"quote": "保留正文"},
            )
        )


def test_replace_database_preserves_evidence_and_is_idempotent(tmp_path: Path) -> None:
    source_url = _url(tmp_path / "source.db")
    target_url = _url(tmp_path / "target.db")
    source = Database(source_url)
    target = Database(target_url)
    source.create_schema()
    target.create_schema()
    _seed_source(source)
    with target.session() as session:
        session.add(
            SourceAuthorization(
                id="stale",
                reference="stale",
                source_code="demo",
                adapter_code="demo",
                status="ACTIVE",
                valid_from=datetime(2020, 1, 1, tzinfo=UTC),
            )
        )

    first = replace_database(source_url, target_url, batch_size=2)
    second = replace_database(source_url, target_url, batch_size=2)

    assert first.total_rows == second.total_rows == 5
    assert first.table_counts["content_snapshot"] == 1
    with target.session() as session:
        assert session.scalar(select(func.count()).select_from(SourceAuthorization)) == 0
        snapshot = session.get(ContentSnapshot, "snapshot-1")
        raw = session.get(RawEnvelope, "raw-1")
        assignment = session.get(DecisionObjectAssignment, "assignment-1")
        assert snapshot is not None
        assert raw is not None
        assert assignment is not None
        assert snapshot.raw_html == "<p>保留原始 HTML</p>"
        assert raw.canonical_url == "https://www.zhihu.com/question/1/answer/1"
        assert raw.payload["id"] == "answer-1"
        assert assignment.decision_object_id == "object-1"

    source.dispose()
    target.dispose()


def test_replace_database_rejects_target_with_missing_tables(tmp_path: Path) -> None:
    source_url = _url(tmp_path / "source.db")
    target_url = _url(tmp_path / "empty.db")
    source = Database(source_url)
    source.create_schema()
    _seed_source(source)
    create_engine(target_url).dispose()

    with pytest.raises(RuntimeError, match="target database is missing tables"):
        replace_database(source_url, target_url)

    source.dispose()


def test_replace_database_refuses_same_source_and_target(tmp_path: Path) -> None:
    database_url = _url(tmp_path / "same.db")
    database = Database(database_url)
    database.create_schema()

    with pytest.raises(ValueError, match="must be different"):
        replace_database(database_url, database_url)

    database.dispose()
