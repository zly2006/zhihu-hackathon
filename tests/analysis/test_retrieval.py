from pathlib import Path

import pytest

from decision_knowledge.analysis.embeddings import build_scenario_input
from decision_knowledge.analysis.retrieval import (
    CandidateEmbeddingImport,
    retrieve_candidate_embeddings,
    upsert_candidate_embedding,
)
from decision_knowledge.db import Database
from decision_knowledge.ingest.models import DecisionEpisodeCandidate


def _candidate(context: str, decision: str) -> DecisionEpisodeCandidate:
    return DecisionEpisodeCandidate(
        content_snapshot_id="snapshot-" + context,
        analysis_version="heuristic-v1",
        context=context,
        decision=decision,
        action="保留行动证据",
        outcome="保留结果观察",
        confidence=80,
        evidence={"method": "test"},
    )


def test_embedding_import_is_idempotent_and_rejects_version_drift(tmp_path: Path) -> None:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'embedding.db'}")
    database.create_schema()
    with database.session() as session:
        candidate = _candidate("工作经历和收入有限。", "要不要转行？")
        session.add(candidate)
        session.flush()
        scenario_input = build_scenario_input(
            context=candidate.context,
            decision=candidate.decision,
            action=candidate.action,
            outcome=candidate.outcome,
        )
        row = CandidateEmbeddingImport(
            candidate_id=candidate.id,
            scenario_input=scenario_input,
            vector=(1.0, 0.0),
        )

        first = upsert_candidate_embedding(
            session,
            row,
            model_id="test-model",
            embedding_version="test-v1",
        )
        replay = upsert_candidate_embedding(
            session,
            row,
            model_id="test-model",
            embedding_version="test-v1",
        )

        assert first.id == replay.id
        with pytest.raises(ValueError, match="different input or vector"):
            upsert_candidate_embedding(
                session,
                CandidateEmbeddingImport(
                    candidate_id=candidate.id,
                    scenario_input=scenario_input,
                    vector=(0.0, 1.0),
                ),
                model_id="test-model",
                embedding_version="test-v1",
            )
    database.dispose()


def test_retrieval_applies_blocking_before_top_k(tmp_path: Path) -> None:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'retrieval.db'}")
    database.create_schema()
    with database.session() as session:
        career = _candidate("工作收入有限，正在考虑转行。", "要不要转行？")
        housing = _candidate("家庭现金流有限。", "要不要买房？")
        session.add_all((career, housing))
        session.flush()
        for candidate, vector in ((career, (1.0, 0.0)), (housing, (0.99, 0.14))):
            scenario_input = build_scenario_input(
                context=candidate.context,
                decision=candidate.decision,
                action=candidate.action,
                outcome=candidate.outcome,
            )
            upsert_candidate_embedding(
                session,
                CandidateEmbeddingImport(candidate.id, scenario_input, vector),
                model_id="test-model",
                embedding_version="test-v1",
            )

        hits = retrieve_candidate_embeddings(
            session,
            (1.0, 0.0),
            embedding_version="test-v1",
            blocking_key="career",
            limit=10,
        )

        assert [hit.candidate_id for hit in hits] == [career.id]
        assert hits[0].score == pytest.approx(1.0, abs=1e-6)
    database.dispose()
