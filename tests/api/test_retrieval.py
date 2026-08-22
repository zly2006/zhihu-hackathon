from pathlib import Path

from fastapi.testclient import TestClient

from decision_knowledge.analysis.embeddings import build_scenario_input
from decision_knowledge.analysis.retrieval import (
    CandidateEmbeddingImport,
    upsert_candidate_embedding,
)
from decision_knowledge.api import create_app
from decision_knowledge.db import Database
from decision_knowledge.ingest.models import DecisionEpisodeCandidate


def test_retrieval_api_returns_ranked_candidates_without_confirming_scenarios(
    tmp_path: Path,
) -> None:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'retrieval-api.db'}")
    database.create_schema()
    with database.session() as session:
        candidate = DecisionEpisodeCandidate(
            content_snapshot_id="snapshot-api",
            analysis_version="heuristic-v1",
            context="工作收入有限。",
            decision="要不要转行？",
            action="先做项目。",
            outcome="收到反馈。",
            confidence=80,
            evidence={"method": "test"},
        )
        session.add(candidate)
        session.flush()
        scenario_input = build_scenario_input(
            context=candidate.context,
            decision=candidate.decision,
            action=candidate.action,
            outcome=candidate.outcome,
        )
        upsert_candidate_embedding(
            session,
            CandidateEmbeddingImport(candidate.id, scenario_input, (1.0, 0.0)),
            model_id="test-model",
            embedding_version="test-v1",
        )
        candidate_id = candidate.id

    client = TestClient(create_app(database=database))
    response = client.post(
        "/api/retrieval/candidates",
        json={
            "embedding_version": "test-v1",
            "vector": [1.0, 0.0],
            "blocking_key": "career",
            "limit": 5,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["items"][0]["candidate_id"] == candidate_id
    assert body["items"][0]["score"] == 1.0
    assert body["items"][0]["review_status"] == "UNREVIEWED"
    assert client.get("/api/scenarios").json()["items"] == []
    database.dispose()
