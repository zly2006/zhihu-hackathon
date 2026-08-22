import json
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text


def test_migrations_build_authoritative_ingest_tables(tmp_path: Path) -> None:
    database_path = tmp_path / "migrations.db"
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", f"sqlite+pysqlite:///{database_path}")

    command.upgrade(config, "head")
    command.check(config)

    engine = create_engine(f"sqlite+pysqlite:///{database_path}")
    assert set(inspect(engine).get_table_names()) >= {
        "alembic_version",
        "content_item",
        "content_snapshot",
        "raw_envelope",
        "source_authorization",
        "decision_scenario",
        "decision_branch",
        "discovery_run",
        "keyword_candidate",
        "decision_episode_candidate",
        "candidate_embedding",
    }
    raw_envelope_columns = {
        column["name"] for column in inspect(engine).get_columns("raw_envelope")
    }
    snapshot_columns = {
        column["name"] for column in inspect(engine).get_columns("content_snapshot")
    }
    assert {"canonical_url", "raw_html"} <= raw_envelope_columns
    assert "raw_html" in snapshot_columns
    assert {"review_status", "review_note"} <= snapshot_columns
    engine.dispose()


def test_raw_provenance_migration_backfills_legacy_payload(tmp_path: Path) -> None:
    database_path = tmp_path / "legacy.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    command.upgrade(config, "20260820_0001")

    legacy_url = "https://www.zhihu.com/question/demo/answer/demo"
    legacy_payload = {
        "canonical_url": legacy_url,
        "content": {"body_format": "HTML", "body": "<p>历史 HTML</p>"},
    }
    engine = create_engine(database_url)
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO content_item
                    (id, source_code, external_type, external_id, canonical_url, availability)
                VALUES ('item-legacy', 'zhihu', 'answer', 'answer-legacy', :url, 'AVAILABLE')
                """
            ),
            {"url": legacy_url},
        )
        connection.execute(
            text(
                """
                INSERT INTO raw_envelope
                    (id, source_code, adapter_code, adapter_version, authorization_ref,
                     external_type, external_id, fetched_at, payload_hash, payload)
                VALUES ('raw-legacy', 'zhihu', 'authorized_zhihu_adapter', '1.0.0', 'AUTH-1',
                        'answer', 'answer-legacy', '2026-08-21T00:00:00Z', :payload_hash, :payload)
                """
            ),
            {
                "payload_hash": "d" * 64,
                "payload": json.dumps(legacy_payload),
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO content_snapshot
                    (id, content_item_id, raw_envelope_id, captured_at, title,
                     body_format, body, language, content_hash,
                     source_created_at, source_updated_at)
                VALUES ('snapshot-legacy', 'item-legacy', 'raw-legacy', '2026-08-21T00:00:00Z',
                        '历史回答', 'HTML', '<p>历史 HTML</p>', 'zh-CN', :content_hash, NULL, NULL)
                """
            ),
            {"content_hash": "e" * 64},
        )

    command.upgrade(config, "head")

    with engine.connect() as connection:
        raw = connection.execute(
            text("SELECT canonical_url, raw_html FROM raw_envelope WHERE id = 'raw-legacy'")
        ).mappings().one()
        snapshot = connection.execute(
            text("SELECT raw_html FROM content_snapshot WHERE id = 'snapshot-legacy'")
        ).mappings().one()
    assert raw["canonical_url"] == legacy_url
    assert raw["raw_html"] == "<p>历史 HTML</p>"
    assert snapshot["raw_html"] == "<p>历史 HTML</p>"
    engine.dispose()
