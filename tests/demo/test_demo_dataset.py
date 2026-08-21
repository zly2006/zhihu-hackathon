import json
from pathlib import Path

from decision_knowledge.contracts.source_record import SourceRecordV1
from decision_knowledge.db import Database
from decision_knowledge.ingest.source_ingestion import SourceIngestion

DATASET = Path(__file__).parents[2] / "data" / "demo" / "source_records_with_html.jsonl"


def load_demo_records() -> tuple[SourceRecordV1, ...]:
    return tuple(
        SourceRecordV1.model_validate(json.loads(line))
        for line in DATASET.read_text(encoding="utf-8").splitlines()
        if line.strip()
    )


def test_demo_dataset_is_valid_and_ingests_as_one_batch() -> None:
    records = load_demo_records()
    database = Database("sqlite+pysqlite:///:memory:")
    database.create_schema()

    with database.session() as session:
        result = SourceIngestion(session).ingest_batch(records)

    assert len(records) == 6
    assert all(record.content.raw_html for record in records)
    assert result.created == 6
    assert result.unchanged == 0
    assert result.rejected == 0
    assert {item.external_id for item in result.items} == {
        f"answer-html-{index:03d}" for index in range(1, 7)
    }
    database.dispose()
