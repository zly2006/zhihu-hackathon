import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from decision_knowledge.contracts import DecisionEpisodeV1

FIXTURES = Path(__file__).parents[1] / "fixtures"


def load_fixture(name: str) -> dict[str, object]:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def test_valid_decision_episode_is_parsed() -> None:
    episode = DecisionEpisodeV1.model_validate(load_fixture("decision_episode.valid.json"))

    assert episode.schema_version == "decision_episode.v1"
    assert episode.episode_id == "episode-001"
    assert [claim.kind for claim in episode.claims] == [
        "CONTEXT",
        "DECISION_POINT",
        "ACTION",
        "OUTCOME",
    ]


def test_duplicate_claim_ids_are_rejected() -> None:
    payload = load_fixture("decision_episode.valid.json")
    claims = payload["claims"]
    assert isinstance(claims, list)
    assert isinstance(claims[1], dict)
    claims[1]["claim_id"] = "claim-context"

    with pytest.raises(ValidationError, match="claim_id"):
        DecisionEpisodeV1.model_validate(payload)
