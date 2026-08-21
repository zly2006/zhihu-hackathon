"""Small deterministic derivations used before human semantic review.

These functions deliberately produce candidates, not confirmed knowledge. Every
field is assembled from sentences in the source snapshot so an editor can verify
the result without trusting an opaque model.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

ANALYSIS_VERSION = "heuristic-v1"

_DECISION_TERMS = ("选择", "决定", "要不要", "是否", "考虑", "取舍", "转行", "读研", "创业")
_CONTEXT_TERMS = (
    "当时",
    "目前",
    "家庭",
    "储蓄",
    "收入",
    "资源",
    "时间",
    "能力",
    "行业",
    "目标",
    "约束",
)
_ACTION_TERMS = (
    "先",
    "开始",
    "尝试",
    "验证",
    "比较",
    "盘点",
    "做项目",
    "工作",
    "学习",
    "准备",
)
_OUTCOME_TERMS = (
    "后来",
    "最终",
    "结果",
    "之后",
    "半年",
    "一年",
    "拿到",
    "失败",
    "成功",
    "找到",
    "毕业",
)


@dataclass(frozen=True)
class DecisionCandidateDraft:
    """A reviewable draft; it is not a DecisionEpisodeV1 yet."""

    context: str
    decision: str
    action: str
    outcome: str
    confidence: int
    evidence: dict[str, object]
    review_status: str = "UNREVIEWED"


def _sentences(body: str) -> tuple[str, ...]:
    compact = re.sub(r"\s+", " ", body).strip()
    if not compact:
        return ()
    parts = re.split(r"(?<=[。！？!?；;])\s*|[\r\n]+", compact)
    return tuple(part.strip() for part in parts if part.strip())


def _first(sentences: tuple[str, ...], terms: tuple[str, ...]) -> tuple[int, str] | None:
    for index, sentence in enumerate(sentences):
        if any(term in sentence for term in terms):
            return index, sentence
    return None


def _best(sentences: tuple[str, ...], terms: tuple[str, ...]) -> tuple[int, str] | None:
    matches = [
        (index, sentence)
        for index, sentence in enumerate(sentences)
        if any(term in sentence for term in terms)
    ]
    if not matches:
        return None
    return max(
        matches,
        key=lambda item: (
            sum(term in item[1] for term in terms),
            len(item[1]),
            -item[0],
        ),
    )


def build_decision_candidate(
    body: str,
    *,
    quality_accepted: bool,
) -> DecisionCandidateDraft | None:
    """Extract the smallest useful candidate from an accepted answer.

    The quality flag is intentionally required from the ingestion layer. This
    keeps rejected answers out of both the snowball frontier and the semantic
    candidate queue.
    """

    if not quality_accepted:
        return None
    sentences = _sentences(body)
    if not sentences:
        return None
    decision_hit = _first(sentences, _DECISION_TERMS)
    if decision_hit is None:
        return None
    context_hit = _best(sentences, _CONTEXT_TERMS)
    action_hit = _best(sentences, _ACTION_TERMS)
    outcome_hit = _best(sentences, _OUTCOME_TERMS)
    context = context_hit[1] if context_hit else sentences[0]
    action = action_hit[1] if action_hit else decision_hit[1]
    outcome = outcome_hit[1] if outcome_hit else ""
    populated = sum(bool(value) for value in (context, decision_hit[1], action, outcome))
    confidence = min(95, 35 + populated * 12 + (10 if outcome else 0))
    evidence: dict[str, object] = {
        "method": ANALYSIS_VERSION,
        "sentence_count": len(sentences),
        "spans": {
            "context": [context_hit[0]] if context_hit else [0],
            "decision": [decision_hit[0]],
            "action": [action_hit[0]] if action_hit else [decision_hit[0]],
            "outcome": [outcome_hit[0]] if outcome_hit else [],
        },
    }
    return DecisionCandidateDraft(
        context=context,
        decision=decision_hit[1],
        action=action,
        outcome=outcome,
        confidence=confidence,
        evidence=evidence,
    )
