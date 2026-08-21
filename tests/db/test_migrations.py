from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect


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
    }
    engine.dispose()
