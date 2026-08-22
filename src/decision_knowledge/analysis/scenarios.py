"""Conservative, reviewable proposals for canonical scenarios and branches.

The embedding is used to rank/merge only after a coarse domain block and a
decision-point overlap check.  The result is deliberately a proposal: this
module never marks a scenario or branch as confirmed.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from decision_knowledge.analysis.embeddings import normalize_vector

SCENARIO_CLUSTER_ALGORITHM_VERSION = "scenario-cluster-v3"
BRANCH_PROPOSAL_ALGORITHM_VERSION = "branch-proposal-v3"

_COMMON_DECISION_TOKENS = frozenset(
    {
        "要不要",
        "是否",
        "能不能",
        "可不可以",
        "怎么",
        "如何",
        "选择",
        "决定",
        "考虑",
        "问题",
        "自己",
        "现在",
        "一个",
        "什么",
    }
)
_CJK_OR_WORD = re.compile(r"[\u3400-\u9fffA-Za-z0-9]+")
_PUNCTUATION = re.compile(r"[\s\W_]+", re.UNICODE)
_DECISION_POINT_MARKERS = (
    "要不要",
    "是否",
    "该不该",
    "怎么选",
    "如何选择",
    "值不值得",
    "靠不靠谱",
    "适不适合",
    "还是",
)


@dataclass(frozen=True)
class ScenarioCandidate:
    """Candidate fields needed for clustering; source content stays elsewhere."""

    candidate_id: str
    context: str
    decision: str
    action: str
    outcome: str
    confidence: int
    blocking_key: str
    vector: tuple[float, ...]


@dataclass(frozen=True)
class BranchProposal:
    branch_key: str
    label: str
    trigger: str
    action: str
    outcome: str
    candidate_ids: tuple[str, ...]


@dataclass(frozen=True)
class ScenarioClusterProposal:
    cluster_key: str
    blocking_key: str
    context: str
    decision: str
    candidate_ids: tuple[str, ...]
    medoid_candidate_id: str
    member_similarities: tuple[tuple[str, float], ...]
    average_similarity: float
    minimum_similarity: float
    branches: tuple[BranchProposal, ...]


@dataclass
class _WorkingCluster:
    blocking_key: str
    members: list[ScenarioCandidate] = field(default_factory=list)
    decision_tokens: set[str] = field(default_factory=set)
    centroid: tuple[float, ...] = ()

    def similarity(self, vector: Sequence[float]) -> float:
        return sum(left * right for left, right in zip(self.centroid, vector, strict=True))

    def add(self, candidate: ScenarioCandidate, tokens: set[str]) -> float:
        score = self.similarity(candidate.vector) if self.members else 1.0
        self.members.append(candidate)
        self.decision_tokens.update(tokens)
        if not self.centroid:
            self.centroid = candidate.vector
            return score
        total = len(self.members)
        averaged = tuple(
            (previous * (total - 1) + current) / total
            for previous, current in zip(self.centroid, candidate.vector, strict=True)
        )
        self.centroid = normalize_vector(averaged)
        return score


def _text(value: object) -> str:
    return " ".join(str(value or "").split()).strip()


def _integer(value: object) -> int:
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str) and value.strip():
        return int(value)
    return 0


def _candidate_from_mapping(value: ScenarioCandidate | Mapping[str, object]) -> ScenarioCandidate:
    if isinstance(value, ScenarioCandidate):
        return value
    raw_vector = value.get("vector")
    if not isinstance(raw_vector, Sequence) or isinstance(raw_vector, (str, bytes)):
        raise ValueError("candidate vector must be a sequence")
    candidate_id = _text(value.get("candidate_id"))
    if not candidate_id:
        raise ValueError("candidate_id is required")
    return ScenarioCandidate(
        candidate_id=candidate_id,
        context=_text(value.get("context")),
        decision=_text(value.get("decision")),
        action=_text(value.get("action")),
        outcome=_text(value.get("outcome")),
        confidence=_integer(value.get("confidence")),
        blocking_key=_text(value.get("blocking_key")) or "other",
        vector=normalize_vector(tuple(float(item) for item in raw_vector)),
    )


def _decision_tokens(value: str) -> set[str]:
    normalized = unicodedata.normalize("NFKC", value).lower()
    tokens: set[str] = set()
    for run in _CJK_OR_WORD.findall(normalized):
        if len(run) == 1:
            continue
        if run.isascii():
            tokens.add(run)
            continue
        tokens.update(run[index : index + 2] for index in range(len(run) - 1))
        if len(run) >= 4:
            tokens.update(run[index : index + 3] for index in range(len(run) - 2))
    return {token for token in tokens if token not in _COMMON_DECISION_TOKENS}


def normalize_action(value: str) -> str:
    """Return a stable action key used only to split observed branches."""

    normalized = unicodedata.normalize("NFKC", value).lower().strip()
    normalized = _PUNCTUATION.sub(" ", normalized)
    return " ".join(normalized.split())[:500]


def decision_point_ready(value: str) -> bool:
    """Reject generic advice/quotations before they become scenario groups."""

    normalized = unicodedata.normalize("NFKC", value).strip()
    if not normalized or len(normalized) > 240:
        return False
    if "?" in normalized or "？" in normalized:
        return True
    if any(marker in normalized for marker in _DECISION_POINT_MARKERS):
        return True
    return "我决定" in normalized or "最终决定" in normalized


def _decision_overlap(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0
    return len(left & right) / min(len(left), len(right))


def _stable_key(prefix: str, values: Sequence[str]) -> str:
    payload = "|".join(sorted(values)).encode("utf-8")
    return f"{prefix}-{hashlib.sha256(payload).hexdigest()[:16]}"


def _branch_proposals(
    members: Sequence[ScenarioCandidate],
    *,
    trigger: str,
) -> tuple[BranchProposal, ...]:
    groups: dict[str, list[ScenarioCandidate]] = defaultdict(list)
    for candidate in members:
        action_key = normalize_action(candidate.action)
        if not action_key or action_key == normalize_action(candidate.decision):
            continue
        groups[action_key].append(candidate)
    if len(groups) < 2:
        return ()

    proposals: list[BranchProposal] = []
    for action_key, branch_members in sorted(groups.items()):
        representative = max(
            branch_members,
            key=lambda item: (item.confidence, bool(item.outcome), item.candidate_id),
        )
        outcome = next(
            (
                item.outcome
                for item in sorted(branch_members, key=lambda item: -item.confidence)
                if item.outcome
            ),
            "",
        )
        proposals.append(
            BranchProposal(
                branch_key=_stable_key("branch", (action_key,)),
                label=representative.action[:256],
                trigger=trigger[:4_000],
                action=representative.action[:4_000],
                outcome=outcome[:8_000],
                candidate_ids=tuple(sorted(item.candidate_id for item in branch_members)),
            )
        )
    return tuple(proposals)


def propose_scenario_clusters(
    candidates: Sequence[ScenarioCandidate | Mapping[str, object]],
    *,
    similarity_threshold: float = 0.84,
    min_decision_overlap: float = 0.25,
    min_cluster_size: int = 2,
    max_token_postings: int = 128,
) -> tuple[ScenarioClusterProposal, ...]:
    """Build deterministic, conservative scenario-cluster proposals.

    Candidate vectors are compared only inside their blocking group and only
    when their decision-point character n-grams overlap.  An inverted token
    index keeps the batch bounded without adding a vector database dependency.
    """

    if not 0.0 < similarity_threshold <= 1.0:
        raise ValueError("similarity_threshold must be between 0 and 1")
    if not 0.0 <= min_decision_overlap <= 1.0:
        raise ValueError("min_decision_overlap must be between 0 and 1")
    if min_cluster_size < 2:
        raise ValueError("min_cluster_size must be at least 2")
    normalized = tuple(_candidate_from_mapping(item) for item in candidates)
    if not normalized:
        return ()

    by_block: dict[str, list[ScenarioCandidate]] = defaultdict(list)
    for candidate in normalized:
        by_block[candidate.blocking_key].append(candidate)

    output: list[ScenarioClusterProposal] = []
    for blocking_key, block_candidates in sorted(by_block.items()):
        block_candidates = [
            candidate for candidate in block_candidates if decision_point_ready(candidate.decision)
        ]
        clusters: list[_WorkingCluster] = []
        token_index: dict[str, set[int]] = defaultdict(set)
        for candidate in sorted(
            block_candidates,
            key=lambda item: (-item.confidence, item.candidate_id),
        ):
            tokens = _decision_tokens(candidate.decision)
            candidate_cluster_ids: set[int] = set()
            for token in tokens:
                candidate_cluster_ids.update(token_index.get(token, set()))

            best: tuple[float, float, int] | None = None
            for cluster_id in sorted(candidate_cluster_ids):
                cluster = clusters[cluster_id]
                overlap = _decision_overlap(tokens, cluster.decision_tokens)
                score = cluster.similarity(candidate.vector)
                if overlap < min_decision_overlap or score < similarity_threshold:
                    continue
                rank = (score, overlap, -cluster_id)
                if best is None or rank > best:
                    best = rank

            if best is None:
                cluster_id = len(clusters)
                cluster = _WorkingCluster(blocking_key=blocking_key)
                clusters.append(cluster)
            else:
                cluster_id = -best[2]
                cluster = clusters[cluster_id]
            cluster.add(candidate, tokens)
            for token in tokens:
                postings = token_index[token]
                if len(postings) < max_token_postings:
                    postings.add(cluster_id)

        for cluster in clusters:
            if len(cluster.members) < min_cluster_size:
                continue
            members = tuple(sorted(cluster.members, key=lambda item: item.candidate_id))
            medoid = max(
                cluster.members,
                key=lambda item: (cluster.similarity(item.vector), item.candidate_id),
            )
            similarities = tuple(cluster.similarity(item.vector) for item in cluster.members)
            output.append(
                ScenarioClusterProposal(
                    cluster_key=_stable_key(
                        "cluster", tuple(item.candidate_id for item in members)
                    ),
                    blocking_key=blocking_key,
                    context=medoid.context[:8_000],
                    decision=medoid.decision[:8_000],
                    candidate_ids=tuple(item.candidate_id for item in members),
                    medoid_candidate_id=medoid.candidate_id,
                    member_similarities=tuple(
                        sorted(
                            (
                                item.candidate_id,
                                round(cluster.similarity(item.vector), 6),
                            )
                            for item in cluster.members
                        )
                    ),
                    average_similarity=sum(similarities) / len(similarities),
                    minimum_similarity=min(similarities),
                    branches=_branch_proposals(cluster.members, trigger=medoid.decision),
                )
            )

    return tuple(sorted(output, key=lambda item: (item.blocking_key, item.cluster_key)))
