"""Export clean, non-source candidate fields for an embedding job."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from sqlalchemy import select

from decision_knowledge.analysis.embeddings import build_scenario_input
from decision_knowledge.db import Database
from decision_knowledge.ingest.models import DecisionEpisodeCandidate


def export_candidates(database_url: str, output: Path, limit: int | None = None) -> int:
    database = Database(database_url)
    try:
        with database.session() as session:
            stmt = select(DecisionEpisodeCandidate).where(
                DecisionEpisodeCandidate.review_status != "REJECTED"
            )
            stmt = stmt.order_by(DecisionEpisodeCandidate.created_at, DecisionEpisodeCandidate.id)
            if limit is not None:
                stmt = stmt.limit(limit)
            candidates = session.scalars(stmt).all()
            rows: list[dict[str, object]] = []
            for candidate in candidates:
                scenario_input = build_scenario_input(
                    context=candidate.context,
                    decision=candidate.decision,
                    action=candidate.action,
                    outcome=candidate.outcome,
                )
                if not scenario_input.ready:
                    continue
                rows.append(
                    {
                        "id": candidate.id,
                        "context": candidate.context,
                        "decision": candidate.decision,
                        "confidence": candidate.confidence,
                        "analysis_version": candidate.analysis_version,
                        "scenario_text": scenario_input.text,
                        "input_sha256": scenario_input.input_sha256,
                        "blocking_key": scenario_input.blocking_key,
                    }
                )
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
        return len(rows)
    finally:
        database.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", default="sqlite+pysqlite:///./local.db")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()
    count = export_candidates(args.database_url, args.output, args.limit)
    print(json.dumps({"exported": count, "output": str(args.output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
