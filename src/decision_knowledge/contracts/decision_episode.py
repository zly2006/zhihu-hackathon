"""Stable contract for one evidence-backed decision experience."""

from enum import StrEnum
from typing import Literal

from pydantic import AwareDatetime, Field, model_validator

from decision_knowledge.contracts.source_record import ContractModel


class ClaimScope(StrEnum):
    SELF_REPORTED = "SELF_REPORTED"
    THIRD_PARTY = "THIRD_PARTY"
    ADVICE = "ADVICE"
    COUNTERFACTUAL = "COUNTERFACTUAL"


class ActorScope(StrEnum):
    SELF = "SELF"
    OTHER = "OTHER"
    MIXED = "MIXED"


class TimePrecision(StrEnum):
    EXACT = "EXACT"
    MONTH = "MONTH"
    YEAR = "YEAR"
    LIFE_STAGE = "LIFE_STAGE"
    UNKNOWN = "UNKNOWN"


class ClaimKind(StrEnum):
    CONTEXT = "CONTEXT"
    DECISION_POINT = "DECISION_POINT"
    ACTION = "ACTION"
    OUTCOME = "OUTCOME"


class Explicitness(StrEnum):
    EXPLICIT = "EXPLICIT"
    IMPLIED = "IMPLIED"


class ActionRole(StrEnum):
    CONSIDERED = "CONSIDERED"
    CHOSEN = "CHOSEN"
    AVOIDED = "AVOIDED"
    RECOMMENDED = "RECOMMENDED"


class ReviewStatus(StrEnum):
    UNREVIEWED = "UNREVIEWED"
    CONFIRMED = "CONFIRMED"
    REJECTED = "REJECTED"


class EpisodeTimeV1(ContractModel):
    raw: str | None = Field(default=None, max_length=512)
    start: AwareDatetime | None = None
    end: AwareDatetime | None = None
    precision: TimePrecision


class DecisionClaimV1(ContractModel):
    claim_id: str = Field(min_length=1, max_length=128)
    kind: ClaimKind
    dimension: str | None = Field(default=None, max_length=128)
    concept_code: str | None = Field(default=None, max_length=256)
    role: ActionRole | None = None
    action_archetype: str | None = Field(default=None, max_length=256)
    normalized_value: str = Field(min_length=1, max_length=4_000)
    explicitness: Explicitness
    confidence: float = Field(ge=0, le=1)
    evidence_span_ids: tuple[str, ...] = Field(min_length=1)
    horizon: str | None = Field(default=None, max_length=64)
    direction: str | None = Field(default=None, max_length=64)
    causal_language_present: bool | None = None


class EpisodeQualityV1(ContractModel):
    all_claims_have_evidence: bool
    temporal_order_explicit: bool
    review_status: ReviewStatus


class DecisionEpisodeV1(ContractModel):
    schema_version: Literal["decision_episode.v1"]
    episode_id: str = Field(min_length=1, max_length=128)
    snapshot_id: str = Field(min_length=1, max_length=128)
    analysis_run_id: str = Field(min_length=1, max_length=128)
    episode_order: int = Field(ge=0)
    claim_scope: ClaimScope
    actor_scope: ActorScope
    time: EpisodeTimeV1
    claims: tuple[DecisionClaimV1, ...] = Field(min_length=1)
    quality: EpisodeQualityV1

    @model_validator(mode="after")
    def claim_ids_are_unique(self) -> "DecisionEpisodeV1":
        claim_ids = [claim.claim_id for claim in self.claims]
        if len(claim_ids) != len(set(claim_ids)):
            raise ValueError("claim_id values must be unique within an episode")
        return self
