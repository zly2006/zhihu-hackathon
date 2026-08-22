from pathlib import Path

from sqlalchemy import func, select

from decision_knowledge.analysis.scenario_persistence import (
    persist_scenario_proposals,
)
from decision_knowledge.analysis.scenarios import propose_scenario_clusters
from decision_knowledge.db import Database
from decision_knowledge.ingest.models import (
    DecisionBranch,
    DecisionBranchMembership,
    DecisionEpisodeCandidate,
    DecisionScenario,
    DecisionScenarioMembership,
)


def test_scenario_and_branch_proposals_are_idempotent(tmp_path: Path) -> None:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'scenario-proposals.db'}")
    database.create_schema()
    with database.session() as session:
        candidates = (
            DecisionEpisodeCandidate(
                content_snapshot_id="snapshot-a",
                analysis_version="test-v1",
                context="收入有限",
                decision="要不要转行做产品？",
                action="先做项目",
                outcome="拿到反馈",
                confidence=90,
                evidence={"method": "test"},
            ),
            DecisionEpisodeCandidate(
                content_snapshot_id="snapshot-b",
                analysis_version="test-v1",
                context="收入有限",
                decision="是否转行做产品？",
                action="直接辞职",
                outcome="进入新行业",
                confidence=80,
                evidence={"method": "test"},
            ),
        )
        session.add_all(candidates)
        session.flush()
        proposals = propose_scenario_clusters(
            tuple(
                {
                    "candidate_id": candidate.id,
                    "context": candidate.context,
                    "decision": candidate.decision,
                    "action": candidate.action,
                    "outcome": candidate.outcome,
                    "confidence": candidate.confidence,
                    "blocking_key": "career",
                    "vector": (1.0, 0.0),
                }
                for candidate in candidates
            ),
            similarity_threshold=0.9,
        )
        assert len(proposals) == 1

        first = persist_scenario_proposals(
            session, proposals, embedding_version="test-v1"
        )
        assert first.scenarios_created == 1
        assert first.memberships_created == 2
        assert first.branches_created == 2
        assert first.branch_memberships_created == 2

        scenario = session.scalar(select(DecisionScenario))
        assert scenario is not None
        scenario.review_status = "CONFIRMED"

        second = persist_scenario_proposals(
            session, proposals, embedding_version="test-v1"
        )
        assert second.scenarios_created == 0
        assert second.scenarios_reused == 1
        assert second.memberships_created == 0
        assert second.branches_created == 0
        assert second.branch_memberships_created == 0
        assert scenario.review_status == "CONFIRMED"
        assert session.scalar(select(func.count()).select_from(DecisionScenario)) == 1
        assert session.scalar(select(func.count()).select_from(DecisionScenarioMembership)) == 2
        assert session.scalar(select(func.count()).select_from(DecisionBranch)) == 2
        assert session.scalar(select(func.count()).select_from(DecisionBranchMembership)) == 2
    database.dispose()


def test_automatic_mode_confirms_strong_clusters_and_rejects_weak_ones(
    tmp_path: Path,
) -> None:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'automatic.db'}")
    database.create_schema()
    with database.session() as session:
        strong = (
            DecisionEpisodeCandidate(
                content_snapshot_id="snapshot-strong-a",
                analysis_version="test-v1",
                context="现金流有限",
                decision="要不要转行做产品？",
                action="先做项目",
                outcome="获得反馈",
                confidence=90,
                evidence={"method": "test"},
            ),
            DecisionEpisodeCandidate(
                content_snapshot_id="snapshot-strong-b",
                analysis_version="test-v1",
                context="现金流有限",
                decision="是否转行做产品？",
                action="直接辞职",
                outcome="进入新行业",
                confidence=85,
                evidence={"method": "test"},
            ),
        )
        weak = (
            DecisionEpisodeCandidate(
                content_snapshot_id="snapshot-weak-a",
                analysis_version="test-v1",
                context="现金流有限",
                decision="要不要考研？",
                action="先学习",
                outcome="",
                confidence=50,
                evidence={"method": "test"},
            ),
            DecisionEpisodeCandidate(
                content_snapshot_id="snapshot-weak-b",
                analysis_version="test-v1",
                context="现金流有限",
                decision="是否考研？",
                action="直接辞职",
                outcome="",
                confidence=50,
                evidence={"method": "test"},
            ),
        )
        session.add_all((*strong, *weak))
        session.flush()

        proposals = propose_scenario_clusters(
            tuple(
                {
                    "candidate_id": candidate.id,
                    "context": candidate.context,
                    "decision": candidate.decision,
                    "action": candidate.action,
                    "outcome": candidate.outcome,
                    "confidence": candidate.confidence,
                    "blocking_key": "career",
                    "vector": (
                        (1.0, 0.0)
                        if candidate.content_snapshot_id.startswith("snapshot-strong")
                        else (0.0, 1.0)
                    ),
                }
                for candidate in (*strong, *weak)
            ),
            similarity_threshold=0.9,
        )
        result = persist_scenario_proposals(
            session,
            proposals,
            embedding_version="automatic-v1",
            auto_confirm=True,
        )

        assert result.auto_confirmed_scenarios == 1
        assert result.auto_rejected_scenarios == 1
        statuses = session.execute(
            select(DecisionScenario.review_status, func.count()).group_by(
                DecisionScenario.review_status
            )
        ).all()
        assert dict(statuses) == {"CONFIRMED": 1, "REJECTED": 1}
        membership_statuses = session.execute(
            select(
                DecisionScenarioMembership.review_status,
                func.count(),
            ).group_by(DecisionScenarioMembership.review_status)
        ).all()
        assert dict(membership_statuses) == {"CONFIRMED": 2, "REJECTED": 2}
        branch_statuses = session.execute(
            select(DecisionBranch.review_status, func.count()).group_by(
                DecisionBranch.review_status
            )
        ).all()
        assert dict(branch_statuses) == {"CONFIRMED": 2, "REJECTED": 2}
        confirmed_branch_membership = session.scalar(
            select(DecisionBranchMembership).where(
                DecisionBranchMembership.review_status == "CONFIRMED"
            )
        )
        assert confirmed_branch_membership is not None
        assert confirmed_branch_membership.evidence["confirmation_mode"] == "automatic"
        confirmed_membership = session.scalar(
            select(DecisionScenarioMembership).where(
                DecisionScenarioMembership.review_status == "CONFIRMED"
            )
        )
        assert confirmed_membership is not None
        assert confirmed_membership.evidence["confirmation_mode"] == "automatic"
        rejected_membership = session.scalar(
            select(DecisionScenarioMembership).where(
                DecisionScenarioMembership.review_status == "REJECTED"
            )
        )
        assert rejected_membership is not None
        assert "candidate_confidence_below_threshold" in rejected_membership.evidence[
            "confirmation_reasons"
        ]
    database.dispose()
