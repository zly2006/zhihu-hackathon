import json
from pathlib import Path

from decision_knowledge.contracts.source_record import SourceRecordV1

DATASET = Path(__file__).parents[2] / "data" / "zhihu" / "public_answers.jsonl"


def test_public_dataset_contains_real_zhihu_provenance() -> None:
    records = tuple(
        SourceRecordV1.model_validate(json.loads(line))
        for line in DATASET.read_text(encoding="utf-8").splitlines()
        if line.strip()
    )

    assert len(records) == 6
    assert {record.external_ref.id for record in records} == {
        "717484672",
        "1713990524",
        "2474530964",
        "793866597",
        "2785487731",
        "2899254877",
    }
    assert all(record.source.code == "zhihu" for record in records)
    assert all(record.source.adapter_code == "manual_url_capture" for record in records)
    assert all(
        str(record.canonical_url).startswith("https://www.zhihu.com/answer/")
        for record in records
    )
    assert all(record.content.raw_html for record in records)
    assert all(
        record.raw.payload["fetch_url"].startswith("https://www.zhihu.com/en/answer/")
        for record in records
    )
