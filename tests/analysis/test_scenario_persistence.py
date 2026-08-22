from pathlib import Path

from sqlalchemy import func, select

from decision_knowledge.analysis.scenario_persistence import persist_scenario_proposals
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
