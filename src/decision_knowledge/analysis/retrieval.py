"""Persistence and retrieval for versioned candidate embeddings."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from decision_knowledge.analysis.embeddings import (
    SCENARIO_TEXT_VERSION,
    VECTOR_ENCODING,
    ScenarioInput,
    decode_vector,
    encode_vector,
    normalize_vector,
)
from decision_knowledge.ingest.models import CandidateEmbedding, DecisionEpisodeCandidate


@dataclass(frozen=True)
class CandidateEmbeddingImport:
    """One externally generated vector tied to a candidate and text hash."""

    candidate_id: str
    scenario_input: ScenarioInput
    vector: Sequence[float]


@dataclass(frozen=True)
class CandidateRetrievalHit:
    candidate_id: str
    score: float
    scenario_text: str
    blocking_key: str
    context: str
    decision: str
    action: str
    outcome: str
    confidence: int
    review_status: str


def upsert_candidate_embedding(
    session: Session,
    row: CandidateEmbeddingImport,
    *,
    model_id: str,
    embedding_version: str,
) -> CandidateEmbedding:
    """Insert one vector idempotently; reject silent version drift."""

    if not row.scenario_input.ready:
        raise ValueError("cannot persist an unready scenario input")
    candidate = session.get(DecisionEpisodeCandidate, row.candidate_id)
    if candidate is None:
        raise ValueError(f"decision candidate not found: {row.candidate_id}")

    normalized = normalize_vector(row.vector)
    vector_payload = encode_vector(normalized)
    dimension = len(normalized)
    existing = session.scalar(
        select(CandidateEmbedding).where(
            CandidateEmbedding.candidate_id == row.candidate_id,
            CandidateEmbedding.embedding_version == embedding_version,
        )
    )
    if existing is not None:
        same = (
            existing.input_sha256 == row.scenario_input.input_sha256
            and existing.model_id == model_id
            and existing.dimension == dimension
            and existing.vector == vector_payload
        )
        if not same:
            raise ValueError(
                "embedding version already exists with a different input or vector; "
                "use a new embedding_version"
            )
        return existing

    embedding = CandidateEmbedding(
        candidate_id=row.candidate_id,
        embedding_version=embedding_version,
        model_id=model_id,
        scenario_text_version=SCENARIO_TEXT_VERSION,
        scenario_text=row.scenario_input.text,
        blocking_key=row.scenario_input.blocking_key,
        input_sha256=row.scenario_input.input_sha256,
        dimension=dimension,
        vector_encoding=VECTOR_ENCODING,
        vector=vector_payload,
        status="READY",
        created_at=datetime.now(UTC),
    )
    session.add(embedding)
    session.flush()
    return embedding


def retrieve_candidate_embeddings(
    session: Session,
    query_vector: Sequence[float],
    *,
    embedding_version: str,
    limit: int = 10,
    blocking_key: str | None = None,
) -> tuple[CandidateRetrievalHit, ...]:
    """Recall candidates, optionally applying the coarse blocking key first."""

    if limit < 1:
        raise ValueError("limit must be positive")
    normalized_query = normalize_vector(query_vector)
    stmt = (
        select(CandidateEmbedding, DecisionEpisodeCandidate)
        .join(
            DecisionEpisodeCandidate,
            DecisionEpisodeCandidate.id == CandidateEmbedding.candidate_id,
        )
        .where(
            CandidateEmbedding.embedding_version == embedding_version,
            CandidateEmbedding.status == "READY",
            DecisionEpisodeCandidate.review_status != "REJECTED",
        )
    )
    if blocking_key:
        stmt = stmt.where(CandidateEmbedding.blocking_key == blocking_key)

    scored: list[CandidateRetrievalHit] = []
    for embedding, candidate in session.execute(stmt).all():
        vector = decode_vector(embedding.vector, dimension=embedding.dimension)
        if len(normalized_query) != embedding.dimension:
            raise ValueError(
                f"query dimension mismatch: expected {embedding.dimension}, "
                f"got {len(normalized_query)}"
            )
        score = sum(
            left * right for left, right in zip(normalized_query, vector, strict=True)
        )
        scored.append(
            CandidateRetrievalHit(
                candidate_id=candidate.id,
                score=score,
                scenario_text=embedding.scenario_text,
                blocking_key=embedding.blocking_key,
                context=candidate.context,
                decision=candidate.decision,
                action=candidate.action,
                outcome=candidate.outcome,
                confidence=candidate.confidence,
                review_status=candidate.review_status,
            )
        )
    scored.sort(key=lambda hit: (-hit.score, hit.candidate_id))
    return tuple(scored[:limit])
