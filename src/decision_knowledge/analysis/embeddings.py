"""Deterministic input and vector primitives for candidate retrieval.

The module deliberately stops at candidate recall.  It does not decide that
two candidates belong to the same canonical scenario and it never writes a
confirmed scenario or branch.
"""

from __future__ import annotations

import hashlib
import math
import re
import struct
from collections.abc import Sequence
from dataclasses import dataclass

SCENARIO_TEXT_VERSION = "scenario-text-v2"
VECTOR_ENCODING = "float32-le"

_BLOCKING_GROUPS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "career",
        ("工作", "职业", "职场", "岗位", "就业", "转行", "公司", "上班", "跳槽", "创业"),
    ),
    ("education", ("考研", "读研", "留学", "学校", "专业", "学习", "教育", "读博")),
    (
        "finance_housing",
        ("买房", "房贷", "租房", "投资", "理财", "存钱", "收入", "保险", "贷款"),
    ),
    (
        "family_relationship",
        ("恋爱", "婚姻", "结婚", "家庭", "夫妻", "生育", "孩子", "父母", "养老"),
    ),
    ("health_life", ("健康", "医疗", "疾病", "治疗", "健身", "习惯", "生活")),
)


@dataclass(frozen=True)
class ScenarioInput:
    """The versioned, hashable text sent to an embedding model."""

    ready: bool
    text: str
    input_sha256: str
    blocking_key: str = "other"
    reason: str | None = None


@dataclass(frozen=True)
class SimilarityHit:
    """One candidate returned by vector recall."""

    candidate_id: str
    score: float


def _clean(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def decision_family(text: str) -> str:
    """Return a coarse blocking key; it is not a semantic label."""

    for family, terms in _BLOCKING_GROUPS:
        if any(term in text for term in terms):
            return family
    return "other"


def build_scenario_input(
    *,
    context: str | None,
    decision: str | None,
    action: str | None = None,
    outcome: str | None = None,
) -> ScenarioInput:
    """Build a retrieval-only text from the candidate's pre-decision state.

    ``action`` and ``outcome`` are accepted to make call sites explicit, but
    are intentionally not included.  They describe a branch or an observation
    and would make otherwise comparable scenarios look different.
    """

    del action, outcome
    normalized_context = _clean(context)
    normalized_decision = _clean(decision)
    if not normalized_context or not normalized_decision:
        return ScenarioInput(
            ready=False,
            text="",
            input_sha256="",
            reason="missing_context_or_decision",
        )
    if normalized_context == normalized_decision:
        return ScenarioInput(
            ready=False,
            text="",
            input_sha256="",
            reason="duplicated_context_and_decision",
        )

    text = f"背景：{normalized_context}\n决策点：{normalized_decision}"
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    return ScenarioInput(
        ready=True,
        text=text,
        input_sha256=digest,
        blocking_key=decision_family(text),
    )


def normalize_vector(values: Sequence[float]) -> tuple[float, ...]:
    """Return a finite unit vector suitable for cosine recall."""

    if not values:
        raise ValueError("embedding vector must not be empty")
    converted = tuple(float(value) for value in values)
    if not all(math.isfinite(value) for value in converted):
        raise ValueError("embedding vector must contain only finite values")
    norm = math.sqrt(sum(value * value for value in converted))
    if norm == 0:
        raise ValueError("embedding vector must not be all zeros")
    return tuple(value / norm for value in converted)


def encode_vector(values: Sequence[float]) -> bytes:
    """Encode a normalized vector as portable little-endian float32 bytes."""

    normalized = normalize_vector(values)
    return struct.pack(f"<{len(normalized)}f", *normalized)


def decode_vector(payload: bytes, *, dimension: int | None = None) -> tuple[float, ...]:
    """Decode a vector stored by :func:`encode_vector`."""

    if not payload or len(payload) % 4:
        raise ValueError("embedding payload must contain complete float32 values")
    actual_dimension = len(payload) // 4
    if dimension is not None and actual_dimension != dimension:
        raise ValueError(
            f"embedding dimension mismatch: expected {dimension}, got {actual_dimension}"
        )
    return struct.unpack(f"<{actual_dimension}f", payload)


def cosine_similarity(left: Sequence[float], right: Sequence[float]) -> float:
    """Compute cosine similarity without a heavyweight runtime dependency."""

    if len(left) != len(right) or not left:
        raise ValueError("vectors must have the same non-zero dimension")
    left_normalized = normalize_vector(left)
    right_normalized = normalize_vector(right)
    return sum(a * b for a, b in zip(left_normalized, right_normalized, strict=True))


def top_k_similar(
    query: Sequence[float],
    candidates: Sequence[tuple[str, Sequence[float]]],
    *,
    limit: int = 10,
) -> tuple[SimilarityHit, ...]:
    """Return deterministic Top-K vector hits, highest score first."""

    if limit < 1:
        raise ValueError("limit must be positive")
    normalized_query = normalize_vector(query)
    scored = [
        SimilarityHit(
            candidate_id=candidate_id,
            score=sum(
                left * right
                for left, right in zip(
                    normalized_query,
                    normalize_vector(vector),
                    strict=True,
                )
            ),
        )
        for candidate_id, vector in candidates
    ]
    scored.sort(key=lambda hit: (-hit.score, hit.candidate_id))
    return tuple(scored[:limit])
