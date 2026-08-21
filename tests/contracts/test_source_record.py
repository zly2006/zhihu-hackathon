import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from decision_knowledge.contracts import SourceRecordV1

FIXTURES = Path(__file__).parents[1] / "fixtures"


def load_fixture(name: str) -> dict[str, object]:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def test_valid_source_record_is_parsed_and_normalizes_sha256() -> None:
    record = SourceRecordV1.model_validate(load_fixture("source_record.valid.json"))

    assert record.schema_version == "source_record.v1"
    assert record.external_ref.id == "answer-001"
    assert record.raw.sha256 == "a" * 64


def test_invalid_source_record_is_rejected() -> None:
    with pytest.raises(ValidationError):
        SourceRecordV1.model_validate(load_fixture("source_record.invalid.json"))


def test_html_source_record_requires_raw_html_fragment() -> None:
    record = load_fixture("source_record.valid.json")
    del record["content"]["raw_html"]

    with pytest.raises(ValidationError, match="raw_html"):
        SourceRecordV1.model_validate(record)
