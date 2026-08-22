from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from sqlalchemy import Engine, create_engine, func, inspect, select
from sqlalchemy.engine import make_url

from decision_knowledge.db import Base
from decision_knowledge.ingest import models as ingest_models

del ingest_models  # Import registers every application table in Base.metadata.


@dataclass(frozen=True)
class DatabaseSyncReport:
    table_counts: Mapping[str, int]

    @property
    def total_rows(self) -> int:
        return sum(self.table_counts.values())


def _engine(database_url: str) -> Engine:
    connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
    return create_engine(database_url, connect_args=connect_args)


def _require_application_tables(engine: Engine, *, role: str) -> None:
    expected = set(Base.metadata.tables)
    present = set(inspect(engine).get_table_names())
    missing = sorted(expected - present)
    if missing:
        raise RuntimeError(f"{role} database is missing tables: {', '.join(missing)}")


def replace_database(
    source_database_url: str,
    target_database_url: str,
    *,
    batch_size: int = 100,
) -> DatabaseSyncReport:
    """Atomically replace all application data while preserving source primary keys."""
    if make_url(source_database_url) == make_url(target_database_url):
        raise ValueError("source and target databases must be different")
    if batch_size < 1:
        raise ValueError("batch_size must be at least 1")

    source_engine = _engine(source_database_url)
    target_engine = _engine(target_database_url)
    try:
        _require_application_tables(source_engine, role="source")
        _require_application_tables(target_engine, role="target")
        tables = list(Base.metadata.sorted_tables)
        counts: dict[str, int] = {}

        with source_engine.connect() as source, target_engine.begin() as target:
            for table in reversed(tables):
                target.execute(table.delete())

            for table in tables:
                result = source.execution_options(stream_results=True).execute(select(table))
                copied = 0
                while rows := result.fetchmany(batch_size):
                    values: list[dict[str, Any]] = [dict(row._mapping) for row in rows]
                    target.execute(table.insert(), values)
                    copied += len(values)
                counts[table.name] = copied

            for table in tables:
                target_count = target.scalar(select(func.count()).select_from(table))
                if target_count != counts[table.name]:
                    raise RuntimeError(
                        f"row-count verification failed for {table.name}: "
                        f"expected {counts[table.name]}, got {target_count}"
                    )

        return DatabaseSyncReport(table_counts=counts)
    finally:
        source_engine.dispose()
        target_engine.dispose()

