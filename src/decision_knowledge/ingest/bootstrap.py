"""Small, idempotent local-data bootstrap helpers."""

import json
from pathlib import Path

from decision_knowledge.contracts.source_record import SourceRecordV1
from decision_knowledge.db import Database
from decision_knowledge.ingest.source_ingestion import IngestBatchResult, SourceIngestion


def read_jsonl(path: Path) -> tuple[SourceRecordV1, ...]:
    records: list[SourceRecordV1] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
            records.append(SourceRecordV1.model_validate(payload))
        except (json.JSONDecodeError, ValueError) as exc:
            raise ValueError(f"invalid source record at {path}:{line_number}") from exc
    return tuple(records)


def import_jsonl(database: Database, path: Path) -> IngestBatchResult:
    """Import a JSONL file through the same public ingestion module as the API."""

    records = read_jsonl(path)
    with database.session() as session:
        return SourceIngestion(session).ingest_batch(records)
