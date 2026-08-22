"""Validate worker proposals and persist COEL-backed decision objects."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from sqlalchemy import func, select

from decision_knowledge.analysis.decision_object_persistence import persist_decision_objects
from decision_knowledge.analysis.decision_objects import (
    DecisionObjectProposal,
    validate_decision_object_batch,
)
from decision_knowledge.db import Database
from decision_knowledge.ingest.models import (
    ContentSnapshot,
    DecisionObject,
    DecisionObjectAssignment,
)


def import_decision_objects(
    *,
    database_url: str,
    input_path: Path,
    min_confidence: float = 0.90,
) -> dict[str, object]:
    raw = json.loads(input_path.read_text(encoding="utf-8"))
    if not isinstance(raw, list) or not all(isinstance(item, dict) for item in raw):
        raise ValueError("decision-object artifact must be a JSON array of objects")
    proposals = tuple(DecisionObjectProposal.from_mapping(item) for item in raw)
    validate_decision_object_batch(proposals, min_confidence=min_confidence)
    database = Database(database_url)
    database.create_schema()
    try:
        with database.session() as session:
            snapshot_ids = {
                snapshot_id for proposal in proposals for snapshot_id in proposal.snapshot_ids
            }
            existing = set(
                session.scalars(
                    select(ContentSnapshot.id).where(ContentSnapshot.id.in_(snapshot_ids))
                ).all()
            )
            missing = sorted(snapshot_ids - existing)
            if missing:
                raise ValueError(f"content snapshots not found: {', '.join(missing[:3])}")
            persisted = persist_decision_objects(
                session, proposals, min_confidence=min_confidence
            )
            top_objects = session.execute(
                select(DecisionObject.name, DecisionObject.coel_labels, func.count())
                .join(
                    DecisionObjectAssignment,
                    DecisionObjectAssignment.decision_object_id == DecisionObject.id,
                )
                .group_by(DecisionObject.id)
                .order_by(func.count().desc(), DecisionObject.name)
                .limit(20)
            ).all()
            result: dict[str, object] = {
                "questions_seen": persisted.questions_seen,
                "min_confidence": min_confidence,
                "decisions_accepted": persisted.decisions_accepted,
                "non_decisions_skipped": persisted.non_decisions_skipped,
                "low_confidence_skipped": persisted.low_confidence_skipped,
                "objects_created": persisted.objects_created,
                "objects_reused": persisted.objects_reused,
                "assignments_created": persisted.assignments_created,
                "assignments_updated": persisted.assignments_updated,
                "total_objects": session.scalar(
                    select(func.count()).select_from(DecisionObject)
                ),
                "total_assignments": session.scalar(
                    select(func.count()).select_from(DecisionObjectAssignment)
                ),
                "top_objects": [
                    {"name": name, "coel_labels": labels, "answer_count": count}
                    for name, labels, count in top_objects
                ],
            }
            return result
    finally:
        database.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", default="sqlite+pysqlite:///./local.db")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--min-confidence", type=float, default=0.90)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    result = import_decision_objects(
        database_url=args.database_url,
        input_path=args.input,
        min_confidence=args.min_confidence,
    )
    encoded = json.dumps(result, ensure_ascii=False, indent=2)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(encoded + "\n", encoding="utf-8")
    print(encoded)


if __name__ == "__main__":
    main()
