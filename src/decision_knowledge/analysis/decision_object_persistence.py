"""Persist normalized decision objects without writing model output directly."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from decision_knowledge.analysis.decision_objects import DecisionObjectProposal
from decision_knowledge.ingest.models import DecisionObject, DecisionObjectAssignment


@dataclass(frozen=True)
class DecisionObjectPersistResult:
    questions_seen: int
    decisions_accepted: int
    non_decisions_skipped: int
    low_confidence_skipped: int
    objects_created: int
    objects_reused: int
    assignments_created: int
    assignments_updated: int


def persist_decision_objects(
    session: Session,
    proposals: tuple[DecisionObjectProposal, ...],
    *,
    min_confidence: float = 0.90,
) -> DecisionObjectPersistResult:
    """Upsert validated proposals; COEL anchors cannot bypass the confidence gate."""

    if not 0.0 <= min_confidence <= 1.0:
        raise ValueError("min_confidence must be between 0 and 1")
    objects_created = objects_reused = 0
    assignments_created = assignments_updated = 0
    decisions_accepted = non_decisions_skipped = low_confidence_skipped = 0
    now = datetime.now(UTC)
    for proposal in proposals:
        if not proposal.is_decision:
            non_decisions_skipped += 1
            continue
        if proposal.confidence < min_confidence:
            low_confidence_skipped += 1
            continue
        decisions_accepted += 1
        decision_object = session.scalar(
            select(DecisionObject).where(DecisionObject.object_key == proposal.object_key)
        )
        codes = [reference.code for reference in proposal.coel]
        labels = [reference.name for reference in proposal.coel]
        if decision_object is None:
            decision_object = DecisionObject(
                object_key=proposal.object_key,
                name=proposal.name,
                coel_codes=codes,
                coel_labels=labels,
                taxonomy_version="COEL-1.0" if codes else "LOCAL-v1",
                confidence=proposal.confidence,
                created_at=now,
                updated_at=now,
            )
            session.add(decision_object)
            session.flush()
            objects_created += 1
        else:
            objects_reused += 1
            if proposal.confidence > decision_object.confidence:
                decision_object.name = proposal.name
                decision_object.confidence = proposal.confidence
                decision_object.coel_codes = codes
                decision_object.coel_labels = labels
                decision_object.taxonomy_version = "COEL-1.0" if codes else "LOCAL-v1"
                decision_object.updated_at = now

        evidence = {
            "question_id": proposal.question_id,
            "title": proposal.title,
            "coel": [
                {"code": item.code, "name": item.name, "path": item.path}
                for item in proposal.coel
            ],
        }
        for snapshot_id in proposal.snapshot_ids:
            assignment = session.scalar(
                select(DecisionObjectAssignment).where(
                    DecisionObjectAssignment.content_snapshot_id == snapshot_id,
                    DecisionObjectAssignment.extractor_version == proposal.extractor_version,
                )
            )
            if assignment is None:
                session.add(
                    DecisionObjectAssignment(
                        decision_object_id=decision_object.id,
                        content_snapshot_id=snapshot_id,
                        question_external_id=proposal.question_id,
                        source_title=proposal.title,
                        extractor_version=proposal.extractor_version,
                        model_id=proposal.model_id,
                        confidence=proposal.confidence,
                        evidence=evidence,
                        created_at=now,
                    )
                )
                assignments_created += 1
            elif (
                assignment.decision_object_id != decision_object.id
                or assignment.confidence != proposal.confidence
                or assignment.evidence != evidence
            ):
                assignment.decision_object_id = decision_object.id
                assignment.question_external_id = proposal.question_id
                assignment.source_title = proposal.title
                assignment.model_id = proposal.model_id
                assignment.confidence = proposal.confidence
                assignment.evidence = evidence
                assignments_updated += 1
    session.flush()
    return DecisionObjectPersistResult(
        questions_seen=len(proposals),
        decisions_accepted=decisions_accepted,
        non_decisions_skipped=non_decisions_skipped,
        low_confidence_skipped=low_confidence_skipped,
        objects_created=objects_created,
        objects_reused=objects_reused,
        assignments_created=assignments_created,
        assignments_updated=assignments_updated,
    )
