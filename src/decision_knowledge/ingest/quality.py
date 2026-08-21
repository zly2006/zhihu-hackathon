"""Deterministic quality gates and bounded keyword expansion for source intake."""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any

from decision_knowledge.contracts.source_record import SourceRecordV1
from decision_knowledge.ingest.html_text import html_fragment_to_text

MIN_BODY_CHARS = 80
MIN_QUALITY_SCORE = 45

DECISION_TERMS = (
    "选择",
    "决定",
    "建议",
    "如果",
    "因为",
    "所以",
    "成本",
    "风险",
    "机会",
    "考虑",
    "转行",
    "读研",
    "工作",
    "创业",
    "准备",
)
CONTEXT_TERMS = (
    "当时",
    "目前",
    "家庭",
    "储蓄",
    "经验",
    "资源",
    "时间",
    "能力",
    "行业",
    "目标",
)
OUTCOME_TERMS = (
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
PROMOTION_TERMS = ("加微信", "私信", "报名", "优惠", "购买", "咨询", "课程")
IGNORED_KEYWORDS = frozenset({"知乎", "回答", "问题", "其他"})


@dataclass(frozen=True)
class QualityAssessment:
    score: int
    accepted: bool
    reasons: tuple[str, ...]
    stats: dict[str, int]

    def as_dict(self) -> dict[str, Any]:
        return {
            "score": self.score,
            "accepted": self.accepted,
            "reasons": list(self.reasons),
            "stats": dict(self.stats),
        }


def _hits(text: str, terms: Iterable[str]) -> tuple[str, ...]:
    return tuple(term for term in terms if term in text)


def assess_answer_quality(answer_detail: dict[str, Any]) -> QualityAssessment:
    """Score an answer without an LLM; keep the decision explainable and replayable."""

    raw_html = str(answer_detail.get("content", ""))
    body = html_fragment_to_text(raw_html)
    compact_body = "".join(body.split())
    body_chars = len(compact_body)
    sentence_count = len(re.findall(r"[。！？!?；;]", body))
    decision_hits = _hits(body, DECISION_TERMS)
    context_hits = _hits(body, CONTEXT_TERMS)
    outcome_hits = _hits(body, OUTCOME_TERMS)
    promotion_hits = _hits(body, PROMOTION_TERMS)
    voteup_count = answer_detail.get("voteup_count")
    voteup = voteup_count if isinstance(voteup_count, int) and voteup_count >= 0 else 0

    if body_chars < MIN_BODY_CHARS:
        length_score = 0
    elif body_chars < 200:
        length_score = 20
    elif body_chars < 400:
        length_score = 28
    else:
        length_score = 35
    structure_score = 15 if sentence_count >= 4 else 10 if sentence_count >= 2 else 0
    decision_score = min(4, len(decision_hits)) * 5
    context_score = min(3, len(context_hits)) * 3
    outcome_score = min(2, len(outcome_hits)) * 5
    engagement_score = 10 if voteup >= 20 else 5 if voteup >= 5 else 0
    penalty = 20 if len(promotion_hits) >= 2 and not context_hits else 0
    score = max(
        0,
        min(
            100,
            length_score
            + structure_score
            + decision_score
            + context_score
            + outcome_score
            + engagement_score
            - penalty,
        ),
    )

    reasons: list[str] = []
    if body_chars < MIN_BODY_CHARS:
        reasons.append("正文过短")
    if not decision_hits:
        reasons.append("缺少决策信息")
    if sentence_count < 2:
        reasons.append("结构过于单薄")
    if penalty:
        reasons.append("疑似营销内容")
    if score < MIN_QUALITY_SCORE:
        reasons.append("质量分低于门槛")
    accepted = not any(
        reason in reasons
        for reason in ("正文过短", "缺少决策信息", "疑似营销内容", "质量分低于门槛")
    )
    return QualityAssessment(
        score=score,
        accepted=accepted,
        reasons=tuple(reasons),
        stats={
            "body_chars": body_chars,
            "sentence_count": sentence_count,
            "decision_hits": len(decision_hits),
            "context_hits": len(context_hits),
            "outcome_hits": len(outcome_hits),
            "promotion_hits": len(promotion_hits),
            "voteup_count": voteup,
        },
    )


def extract_keyword_candidate_sources(
    answer_detail: dict[str, Any],
) -> tuple[tuple[str, str], ...]:
    """Return source-labelled terms for replayable snowball lineage."""

    candidates: list[tuple[str, str]] = []
    question = answer_detail.get("question")
    if isinstance(question, dict):
        title = str(question.get("title", "")).strip(" 。！？!?；;，,\t\n")
        if 4 <= len(title) <= 28:
            candidates.append((title, "question_title"))
        topics = question.get("topics")
        if isinstance(topics, list):
            for topic in topics:
                if isinstance(topic, dict):
                    candidates.append((str(topic.get("name", "")).strip(), "topic"))
    keywords = answer_detail.get("keywords")
    if isinstance(keywords, list):
        candidates.extend((str(keyword).strip(), "api_keyword") for keyword in keywords)
    return tuple(
        dict.fromkeys(
            (candidate, origin)
            for candidate, origin in candidates
            if 2 <= len(candidate) <= 28 and candidate not in IGNORED_KEYWORDS
        )
    )


def extract_keyword_candidates(answer_detail: dict[str, Any]) -> tuple[str, ...]:
    """Use source-provided topics/keywords plus a bounded question title."""

    return tuple(term for term, _ in extract_keyword_candidate_sources(answer_detail))


def suggest_queries(
    records: Sequence[SourceRecordV1],
    *,
    seed_queries: Sequence[str],
    max_queries: int,
) -> tuple[str, ...]:
    """Return bounded next-round queries from accepted records only."""

    seeds = {query.strip() for query in seed_queries if query.strip()}
    aggregate: dict[str, tuple[int, int]] = {}
    for record in records:
        payload = record.raw.payload
        quality = payload.get("quality")
        if not isinstance(quality, dict) or quality.get("accepted") is not True:
            continue
        score = quality.get("score")
        quality_score = score if isinstance(score, int) else 0
        candidates = payload.get("keyword_candidates")
        if not isinstance(candidates, list):
            continue
        for candidate in candidates:
            if not isinstance(candidate, str):
                continue
            term = candidate.strip()
            if len(term) < 2 or term in seeds:
                continue
            count, best_score = aggregate.get(term, (0, 0))
            aggregate[term] = (count + 1, max(best_score, quality_score))
    ranked = sorted(
        aggregate.items(),
        key=lambda item: (-item[1][0], -item[1][1], len(item[0]), item[0]),
    )
    return tuple(term for term, _ in ranked[:max(0, max_queries)])
