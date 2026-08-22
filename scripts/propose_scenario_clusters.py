"""Generate and automatically confirm scenario and branch records from embeddings."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from decision_knowledge.analysis.embeddings import decode_vector
from decision_knowledge.analysis.scenario_persistence import (
    persist_scenario_proposals,
    supersede_previous_proposals,
)
from decision_knowledge.analysis.scenarios import (
    ScenarioCandidate,
    propose_scenario_clusters,
)
from decision_knowledge.db import Database
from decision_knowledge.ingest.models import CandidateEmbedding, DecisionEpisodeCandidate


def load_candidates(session: Session, *, embedding_version: str) -> tuple[ScenarioCandidate, ...]:
    rows = session.execute(
        select(CandidateEmbedding, DecisionEpisodeCandidate)
        .join(
            DecisionEpisodeCandidate,
            DecisionEpisodeCandidate.id == CandidateEmbedding.candidate_id,
        )
        .where(
            CandidateEmbedding.embedding_version == embedding_version,
            CandidateEmbedding.status == "READY",
            DecisionEpisodeCandidate.review_status != "REJECTED",
        )
    ).all()
    return tuple(
        ScenarioCandidate(
            candidate_id=candidate.id,
            context=candidate.context,
            decision=candidate.decision,
            action=candidate.action,
            outcome=candidate.outcome,
            confidence=candidate.confidence,
            blocking_key=embedding.blocking_key,
            vector=decode_vector(embedding.vector, dimension=embedding.dimension),
        )
        for embedding, candidate in rows
    )


def run(
    *,
    database_url: str,
    embedding_version: str,
    similarity_threshold: float,
    min_decision_overlap: float,
    min_cluster_size: int,
    min_auto_similarity: float,
    min_auto_confidence: int,
    dry_run: bool,
    auto_confirm: bool,
) -> dict[str, object]:
    database = Database(database_url)
    database.create_schema()
    try:
        with database.session() as session:
            candidates = load_candidates(session, embedding_version=embedding_version)
            proposals = propose_scenario_clusters(
                candidates,
                similarity_threshold=similarity_threshold,
                min_decision_overlap=min_decision_overlap,
                min_cluster_size=min_cluster_size,
            )
            result: dict[str, object] = {
                "embedding_version": embedding_version,
                "candidate_count": len(candidates),
                "proposal_count": len(proposals),
                "branch_proposal_count": sum(len(item.branches) for item in proposals),
                "similarity_threshold": similarity_threshold,
                "min_decision_overlap": min_decision_overlap,
                "min_auto_similarity": min_auto_similarity,
                "min_auto_confidence": min_auto_confidence,
                "dry_run": dry_run,
                "auto_confirm": auto_confirm,
                "proposals": [
                    {
                        "cluster_key": item.cluster_key,
                        "blocking_key": item.blocking_key,
                        "candidate_count": len(item.candidate_ids),
                        "candidate_ids": list(item.candidate_ids),
                        "decision": item.decision,
                        "average_similarity": round(item.average_similarity, 6),
                        "minimum_similarity": round(item.minimum_similarity, 6),
                        "branch_count": len(item.branches),
                    }
                    for item in proposals
                ],
            }
            if not dry_run:
                superseded = supersede_previous_proposals(
                    session,
                    embedding_version=embedding_version,
                )
                persisted = persist_scenario_proposals(
                    session,
                    proposals,
                    embedding_version=embedding_version,
                    auto_confirm=auto_confirm,
                    min_auto_similarity=min_auto_similarity,
                    min_auto_confidence=min_auto_confidence,
                )
                result["persisted"] = {
                    "superseded_scenario_memberships": superseded.scenario_memberships,
                    "superseded_branch_memberships": superseded.branch_memberships,
                    "superseded_scenarios": superseded.scenarios,
                    "superseded_branches": superseded.branches,
                    "scenarios_created": persisted.scenarios_created,
                    "scenarios_reused": persisted.scenarios_reused,
                    "memberships_created": persisted.memberships_created,
                    "branches_created": persisted.branches_created,
                    "branch_memberships_created": persisted.branch_memberships_created,
                    "auto_confirmed_scenarios": persisted.auto_confirmed_scenarios,
                    "auto_rejected_scenarios": persisted.auto_rejected_scenarios,
                    "auto_confirmed_branches": persisted.auto_confirmed_branches,
                    "auto_rejected_branches": persisted.auto_rejected_branches,
                }
            return result
    finally:
        database.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", default="sqlite+pysqlite:///./local.db")
    parser.add_argument("--embedding-version", required=True)
    parser.add_argument("--similarity-threshold", type=float, default=0.84)
    parser.add_argument("--min-decision-overlap", type=float, default=0.25)
    parser.add_argument("--min-cluster-size", type=int, default=2)
    parser.add_argument("--min-auto-similarity", type=float, default=0.90)
    parser.add_argument("--min-auto-confidence", type=int, default=80)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--no-auto-confirm",
        action="store_true",
        help="keep generated rows as PROPOSED instead of applying the automatic gate",
    )
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    result = run(
        database_url=args.database_url,
        embedding_version=args.embedding_version,
        similarity_threshold=args.similarity_threshold,
        min_decision_overlap=args.min_decision_overlap,
        min_cluster_size=args.min_cluster_size,
        min_auto_similarity=args.min_auto_similarity,
        min_auto_confidence=args.min_auto_confidence,
        dry_run=args.dry_run,
        auto_confirm=not args.no_auto_confirm,
    )
    encoded = json.dumps(result, ensure_ascii=False, indent=2)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(encoded + "\n", encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    print(encoded)


if __name__ == "__main__":
    main()
