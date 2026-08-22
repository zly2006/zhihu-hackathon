from pathlib import Path

from fastapi.testclient import TestClient

from decision_knowledge.analysis.scenario_persistence import persist_scenario_proposals
from decision_knowledge.analysis.scenarios import propose_scenario_clusters
from decision_knowledge.api import create_app
from decision_knowledge.db import Database
from decision_knowledge.ingest.models import DecisionEpisodeCandidate


def test_admin_can_review_generated_scenario_membership(tmp_path: Path) -> None:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'scenario-api.db'}")
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
        persist_scenario_proposals(
            session,
            proposals,
            embedding_version="test-v1",
            auto_confirm=False,
        )

    client = TestClient(create_app(database=database))
    response = client.get("/api/admin/scenario-proposals")
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    item = body["items"][0]
    assert item["review_status"] == "PROPOSED"
    assert len(item["memberships"]) == 2
    assert len(item["branches"]) == 2

    membership_id = item["memberships"][0]["id"]
    reviewed = client.patch(
        f"/api/admin/scenario-memberships/{membership_id}",
        json={"review_status": "CONFIRMED"},
    )
    assert reviewed.status_code == 200
    statuses = {
        membership["id"]: membership["review_status"]
        for membership in reviewed.json()["memberships"]
    }
    assert statuses[membership_id] == "CONFIRMED"
    database.dispose()
