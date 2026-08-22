"""Persist clustering output as reversible, reviewable proposals."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from decision_knowledge.analysis.scenarios import (
    BRANCH_PROPOSAL_ALGORITHM_VERSION,
    SCENARIO_CLUSTER_ALGORITHM_VERSION,
    ScenarioClusterProposal,
)
from decision_knowledge.ingest.models import (
    DecisionBranch,
    DecisionBranchMembership,
    DecisionEpisodeCandidate,
    DecisionScenario,
    DecisionScenarioMembership,
)


@dataclass(frozen=True)
class ScenarioProposalPersistResult:
    scenarios_created: int
    scenarios_reused: int
    memberships_created: int
    branches_created: int
    branch_memberships_created: int


@dataclass(frozen=True)
class SupersedeProposalResult:
    scenario_memberships: int
    branch_memberships: int
    scenarios: int
    branches: int


def _slug(value: str) -> str:
    compact = re.sub(r"[^a-z0-9-]+", "-", value.lower()).strip("-")
    return compact or "version"


def _scenario_slug(
    embedding_version: str,
    cluster_key: str,
    algorithm_version: str,
) -> str:
    return (
        f"proposal-{_slug(algorithm_version)}-{_slug(embedding_version)}-"
        f"{_slug(cluster_key)}"
    )[:160]


def _scenario_name(proposal: ScenarioClusterProposal) -> str:
    return f"候选情景 · {proposal.blocking_key} · {proposal.decision[:80]}"


def _scenario_summary(proposal: ScenarioClusterProposal) -> str:
    branch_note = f"；观察到 {len(proposal.branches)} 条行动分叉" if proposal.branches else ""
    return (
        f"背景：{proposal.context[:240]}\n"
        f"决策点：{proposal.decision[:240]}\n"
        f"候选数：{len(proposal.candidate_ids)}；"
        f"平均相似度：{proposal.average_similarity:.3f}；"
        f"最低相似度：{proposal.minimum_similarity:.3f}{branch_note}"
    )


def persist_scenario_proposals(
    session: Session,
    proposals: tuple[ScenarioClusterProposal, ...],
    *,
    embedding_version: str,
    scenario_algorithm_version: str = SCENARIO_CLUSTER_ALGORITHM_VERSION,
    branch_algorithm_version: str = BRANCH_PROPOSAL_ALGORITHM_VERSION,
) -> ScenarioProposalPersistResult:
    """Upsert proposals without changing confirmed or rejected review decisions."""

    candidate_ids = sorted(
        {
            candidate_id
            for proposal in proposals
            for candidate_id in proposal.candidate_ids
        }
    )
    candidates = {
        candidate.id: candidate
        for candidate in session.scalars(
            select(DecisionEpisodeCandidate).where(DecisionEpisodeCandidate.id.in_(candidate_ids))
        ).all()
    }
    missing = [candidate_id for candidate_id in candidate_ids if candidate_id not in candidates]
    if missing:
        raise ValueError(f"decision candidates not found: {', '.join(missing[:3])}")

    scenarios_created = scenarios_reused = memberships_created = 0
    branches_created = branch_memberships_created = 0
    now = datetime.now(UTC)

    for proposal in proposals:
        slug = _scenario_slug(
            embedding_version,
            proposal.cluster_key,
            scenario_algorithm_version,
        )
        scenario = session.scalar(select(DecisionScenario).where(DecisionScenario.slug == slug))
        if scenario is None:
            scenario = DecisionScenario(
                slug=slug,
                name=_scenario_name(proposal),
                summary=_scenario_summary(proposal),
                domain=proposal.blocking_key,
                review_status="PROPOSED",
                created_at=now,
                updated_at=now,
            )
            session.add(scenario)
            session.flush()
            scenarios_created += 1
        else:
            scenarios_reused += 1
            if scenario.review_status == "PROPOSED":
                scenario.name = _scenario_name(proposal)
                scenario.summary = _scenario_summary(proposal)
                scenario.domain = proposal.blocking_key
                scenario.updated_at = now

        similarity_by_id = dict(proposal.member_similarities)
        for candidate_id in proposal.candidate_ids:
            membership = session.scalar(
                select(DecisionScenarioMembership).where(
                    DecisionScenarioMembership.scenario_id == scenario.id,
                    DecisionScenarioMembership.candidate_id == candidate_id,
                )
            )
            evidence = {
                "cluster_key": proposal.cluster_key,
                "medoid_candidate_id": proposal.medoid_candidate_id,
                "blocking_key": proposal.blocking_key,
                "minimum_similarity": round(proposal.minimum_similarity, 6),
            }
            if membership is None:
                session.add(
                    DecisionScenarioMembership(
                        scenario_id=scenario.id,
                        candidate_id=candidate_id,
                        similarity=similarity_by_id[candidate_id],
                        algorithm_version=scenario_algorithm_version,
                        embedding_version=embedding_version,
                        review_status="PROPOSED",
                        evidence=evidence,
                        created_at=now,
                    )
                )
                memberships_created += 1
            elif membership.review_status == "PROPOSED":
                membership.similarity = similarity_by_id[candidate_id]
                membership.algorithm_version = scenario_algorithm_version
                membership.embedding_version = embedding_version
                membership.evidence = evidence

        for position, branch_proposal in enumerate(proposal.branches):
            label = f"{branch_proposal.label[:220]} · {branch_proposal.branch_key[-8:]}"
            branch = session.scalar(
                select(DecisionBranch).where(
                    DecisionBranch.scenario_id == scenario.id,
                    DecisionBranch.label == label,
                )
            )
            representative = candidates[branch_proposal.candidate_ids[0]]
            if branch is None:
                branch = DecisionBranch(
                    scenario_id=scenario.id,
                    label=label,
                    trigger=branch_proposal.trigger,
                    action=branch_proposal.action,
                    outcome=branch_proposal.outcome,
                    position=position,
                    review_status="PROPOSED",
                    source_snapshot_id=representative.content_snapshot_id,
                )
                session.add(branch)
                session.flush()
                branches_created += 1
            elif branch.review_status == "PROPOSED":
                branch.trigger = branch_proposal.trigger
                branch.action = branch_proposal.action
                branch.outcome = branch_proposal.outcome
                branch.position = position

            for candidate_id in branch_proposal.candidate_ids:
                branch_membership = session.scalar(
                    select(DecisionBranchMembership).where(
                        DecisionBranchMembership.branch_id == branch.id,
                        DecisionBranchMembership.candidate_id == candidate_id,
                    )
                )
                if branch_membership is None:
                    session.add(
                        DecisionBranchMembership(
                            branch_id=branch.id,
                            candidate_id=candidate_id,
                            similarity=similarity_by_id[candidate_id],
                            algorithm_version=branch_algorithm_version,
                            review_status="PROPOSED",
                            evidence={
                                "cluster_key": proposal.cluster_key,
                                "branch_key": branch_proposal.branch_key,
                            },
                            created_at=now,
                        )
                    )
                    branch_memberships_created += 1
                elif branch_membership.review_status == "PROPOSED":
                    branch_membership.similarity = similarity_by_id[candidate_id]
                    branch_membership.algorithm_version = branch_algorithm_version

    session.flush()
    return ScenarioProposalPersistResult(
        scenarios_created=scenarios_created,
        scenarios_reused=scenarios_reused,
        memberships_created=memberships_created,
        branches_created=branches_created,
        branch_memberships_created=branch_memberships_created,
    )


def supersede_previous_proposals(
    session: Session,
    *,
    embedding_version: str,
    scenario_algorithm_version: str = SCENARIO_CLUSTER_ALGORITHM_VERSION,
    branch_algorithm_version: str = BRANCH_PROPOSAL_ALGORITHM_VERSION,
) -> SupersedeProposalResult:
    """Keep old proposal rows for audit while removing them from the active queue."""

    scenario_memberships = 0
    for membership in session.scalars(
        select(DecisionScenarioMembership).where(
            DecisionScenarioMembership.review_status == "PROPOSED"
        )
    ).all():
        if (
            membership.algorithm_version != scenario_algorithm_version
            or membership.embedding_version != embedding_version
        ):
            membership.review_status = "SUPERSEDED"
            scenario_memberships += 1

    branch_memberships = 0
    for branch_membership in session.scalars(
        select(DecisionBranchMembership).where(
            DecisionBranchMembership.review_status == "PROPOSED"
        )
    ).all():
        if branch_membership.algorithm_version != branch_algorithm_version:
            branch_membership.review_status = "SUPERSEDED"
            branch_memberships += 1

    scenarios = 0
    for scenario in session.scalars(
        select(DecisionScenario).where(DecisionScenario.review_status == "PROPOSED")
    ).all():
        if scenario.memberships and not any(
            item.review_status == "PROPOSED" for item in scenario.memberships
        ):
            scenario.review_status = "SUPERSEDED"
            scenarios += 1

    branches = 0
    for branch in session.scalars(
        select(DecisionBranch).where(DecisionBranch.review_status == "PROPOSED")
    ).all():
        if branch.memberships and not any(
            item.review_status == "PROPOSED" for item in branch.memberships
        ):
            branch.review_status = "SUPERSEDED"
            branches += 1

    session.flush()
    return SupersedeProposalResult(
        scenario_memberships=scenario_memberships,
        branch_memberships=branch_memberships,
        scenarios=scenarios,
        branches=branches,
    )
