"""Normalize one Zhihu question into one decision object.

The decision object is intentionally smaller than a decision scenario. Its
canonical name defines identity; COEL is a versioned semantic anchor.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

DECISION_OBJECT_EXTRACTOR_VERSION = "decision-object-v1"
_COEL_CODE = re.compile(r"^\d+\.\d+\.\d+\.\d+$")
_SPACE = re.compile(r"\s+")
_PUNCTUATION = re.compile(r"[？?！!。.;；:：,，、\s]+")
_GENERIC_DECISION_OBJECTS = frozenset(
    {"是否做出正确决定", "选择应对方式", "选择重大人生方向", "选择重要性因素"}
)
_CORE_COEL_ALIASES = (
    ("28.1.1.0", ("结婚", "婚姻伴侣", "结婚对象", "伴侣类型")),
    ("28.1.2.0", ("离婚",)),
    ("28.1.3.0", ("生育", "生孩子", "要孩子")),
    ("28.2.1.0", ("破产",)),
    ("28.3.1.0", ("买房", "购房", "购买住房")),
    ("28.3.2.0", ("卖房", "售房", "出售住房")),
    ("28.3.4.0", ("搬家", "迁居")),
    (
        "28.4.1.0",
        ("找工作", "参加工作", "开始工作", "接受offer", "工作单位", "工作城市"),
    ),
    ("28.4.2.0", ("晋升", "升职")),
    ("28.4.3.0", ("被裁", "裁员", "被辞退")),
    ("28.4.4.0", ("辞职", "辞去", "离职", "跳槽")),
    ("28.4.6.0", ("退休",)),
    ("26.5.1.0", ("上大学", "进入大学")),
    ("26.5.6.0", ("考研",)),
    ("26.5.7.0", ("读研", "读博", "留学", "继续深造")),
)


def _text(value: object) -> str:
    return _SPACE.sub(" ", str(value or "")).strip()


def expected_core_coel_codes(name: str) -> tuple[str, ...]:
    """Return only deterministic, high-precision COEL anchors."""

    normalized = name.casefold().replace(" ", "")
    return tuple(
        code
        for code, aliases in _CORE_COEL_ALIASES
        if any(alias.casefold() in normalized for alias in aliases)
    )[:2]


@dataclass(frozen=True)
class CoelReference:
    code: str
    name: str
    path: str


@dataclass(frozen=True)
class DecisionObjectProposal:
    question_id: str
    title: str
    snapshot_ids: tuple[str, ...]
    is_decision: bool
    name: str
    coel: tuple[CoelReference, ...]
    confidence: float
    model_id: str = ""
    extractor_version: str = DECISION_OBJECT_EXTRACTOR_VERSION

    @property
    def object_key(self) -> str:
        if not self.is_decision:
            return ""
        normalized = unicodedata.normalize("NFKC", self.name).lower()
        normalized = _PUNCTUATION.sub("", normalized)
        for prefix in ("是否", "要不要", "该不该"):
            if normalized.startswith(prefix):
                normalized = normalized[len(prefix) :]
                break
        digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:20]
        return f"object:{DECISION_OBJECT_EXTRACTOR_VERSION}:{digest}"

    @classmethod
    def from_mapping(cls, value: Mapping[str, object]) -> DecisionObjectProposal:
        question_id = _text(value.get("question_id"))
        title = _text(value.get("title"))
        raw_snapshot_ids = value.get("snapshot_ids")
        if not isinstance(raw_snapshot_ids, Sequence) or isinstance(
            raw_snapshot_ids, (str, bytes)
        ):
            raise ValueError("snapshot_ids must be an array")
        snapshot_ids = tuple(sorted({_text(item) for item in raw_snapshot_ids if _text(item)}))
        is_decision = value.get("is_decision") is True
        name = _text(value.get("decision_object"))
        raw_coel = value.get("coel", ())
        if not isinstance(raw_coel, Sequence) or isinstance(raw_coel, (str, bytes)):
            raise ValueError("coel must be an array")
        references: list[CoelReference] = []
        for item in raw_coel:
            if not isinstance(item, Mapping):
                raise ValueError("coel entries must be objects")
            code = _text(item.get("code"))
            if not _COEL_CODE.fullmatch(code):
                raise ValueError(f"invalid COEL code: {code}")
            reference_name = _text(item.get("name"))
            reference_path = _text(item.get("path"))
            if not reference_name or not reference_path:
                raise ValueError("COEL name and path are required")
            references.append(
                CoelReference(
                    code=code,
                    name=reference_name,
                    path=reference_path,
                )
            )
        raw_confidence = value.get("confidence", 0.0)
        if isinstance(raw_confidence, bool) or not isinstance(
            raw_confidence, (int, float, str)
        ):
            raise ValueError("confidence must be numeric")
        confidence = float(raw_confidence)
        if not 0.0 <= confidence <= 1.0:
            raise ValueError("confidence must be between 0 and 1")
        if not question_id or not title or not snapshot_ids:
            raise ValueError("question_id, title and snapshot_ids are required")
        if is_decision and not name:
            raise ValueError("decision_object is required for a decision")
        if is_decision and not name.startswith(("是否", "选择")):
            raise ValueError("decision_object must start with 是否 or 选择")
        if is_decision and len(name) > 18:
            raise ValueError("decision_object must be at most 18 Chinese characters")
        if is_decision and name in _GENERIC_DECISION_OBJECTS:
            raise ValueError("decision_object is too generic to index")
        provided_codes = {reference.code for reference in references}
        if len(provided_codes) != len(references):
            raise ValueError("COEL anchors must not contain duplicate codes")
        expected_codes = set(expected_core_coel_codes(name))
        if provided_codes and provided_codes != expected_codes:
            raise ValueError("COEL anchors do not match the canonical decision object")
        return cls(
            question_id=question_id,
            title=title,
            snapshot_ids=snapshot_ids,
            is_decision=is_decision,
            name=name,
            coel=tuple(sorted(references, key=lambda item: item.code)),
            confidence=confidence,
            model_id=_text(value.get("model_id")),
            extractor_version=_text(value.get("extractor_version"))
            or DECISION_OBJECT_EXTRACTOR_VERSION,
        )


def validate_decision_object_batch(
    proposals: Sequence[DecisionObjectProposal],
    *,
    min_confidence: float = 0.90,
    max_dominant_share: float = 0.25,
) -> None:
    """Reject empty or obviously collapsed model batches before persistence."""

    if not 0.0 <= min_confidence <= 1.0:
        raise ValueError("min_confidence must be between 0 and 1")
    if not 0.0 < max_dominant_share <= 1.0:
        raise ValueError("max_dominant_share must be between 0 and 1")
    accepted = [
        proposal
        for proposal in proposals
        if proposal.is_decision and proposal.confidence >= min_confidence
    ]
    if not accepted:
        raise ValueError("batch contains no high-confidence decision objects")
    if len(accepted) < 10:
        return
    counts = Counter(proposal.object_key for proposal in accepted)
    dominant_count = counts.most_common(1)[0][1]
    dominant_share = dominant_count / len(accepted)
    if dominant_share > max_dominant_share:
        raise ValueError(
            "decision-object mode collapse detected: "
            f"dominant_share={dominant_share:.3f}"
        )
