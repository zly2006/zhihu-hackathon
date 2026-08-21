import hashlib
import json
from datetime import UTC, datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from decision_knowledge.analysis.candidates import build_decision_candidate
from decision_knowledge.contracts.source_record import SourceRecordV1
from decision_knowledge.ingest.html_text import html_fragment_to_text
from decision_knowledge.ingest.models import (
    ContentItem,
    ContentSnapshot,
    DecisionEpisodeCandidate,
    DiscoveryRun,
    KeywordCandidate,
    RawEnvelope,
    SourceAuthorization,
)


class IngestStatus(StrEnum):
    CREATED = "CREATED"
    UNCHANGED = "UNCHANGED"
    REJECTED = "REJECTED"


class IngestItemResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    external_id: str
    status: IngestStatus
    content_item_id: str | None = None
    snapshot_id: str | None = None
    reason: str | None = None


class IngestBatchResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    created: int
    unchanged: int
    rejected: int
    items: tuple[IngestItemResult, ...]


class SourceIngestion:
    _IMPORT_ADAPTERS = frozenset(
        {"manual_upload", "manual_url_capture", "jsonl_import"}
    )

    def __init__(self, session: Session) -> None:
        self._session = session

    def ingest_batch(self, records: tuple[SourceRecordV1, ...]) -> IngestBatchResult:
        items = tuple(self._ingest_one(record) for record in records)
        return IngestBatchResult(
            created=sum(item.status is IngestStatus.CREATED for item in items),
            unchanged=sum(item.status is IngestStatus.UNCHANGED for item in items),
            rejected=sum(item.status is IngestStatus.REJECTED for item in items),
            items=items,
        )

    def _ingest_one(self, record: SourceRecordV1) -> IngestItemResult:
        if record.source.adapter_code not in self._IMPORT_ADAPTERS:
            rejection_reason = self._authorization_rejection_reason(record)
            if rejection_reason is not None:
                return IngestItemResult(
                    external_id=record.external_ref.id,
                    status=IngestStatus.REJECTED,
                    reason=rejection_reason,
                )

        item = self._session.scalar(
            select(ContentItem).where(
                ContentItem.source_code == record.source.code,
                ContentItem.external_type == record.external_ref.type,
                ContentItem.external_id == record.external_ref.id,
            )
        )
        if item is None:
            item = ContentItem(
                source_code=record.source.code,
                external_type=record.external_ref.type,
                external_id=record.external_ref.id,
                canonical_url=str(record.canonical_url),
                availability=record.availability.value,
            )
            self._session.add(item)
            self._session.flush()
        else:
            item.canonical_url = str(record.canonical_url)
            item.availability = record.availability.value

        envelope = self._session.scalar(
            select(RawEnvelope).where(
                RawEnvelope.source_code == record.source.code,
                RawEnvelope.external_type == record.external_ref.type,
                RawEnvelope.external_id == record.external_ref.id,
                RawEnvelope.payload_hash == record.raw.sha256,
            )
        )
        if envelope is None:
            envelope = RawEnvelope(
                source_code=record.source.code,
                adapter_code=record.source.adapter_code,
                adapter_version=record.source.adapter_version,
                authorization_ref=record.source.authorization_ref,
                external_type=record.external_ref.type,
                external_id=record.external_ref.id,
                canonical_url=str(record.canonical_url),
                fetched_at=record.fetched_at,
                payload_hash=record.raw.sha256,
                raw_html=record.content.raw_html,
                payload=record.model_dump(mode="json"),
            )
            self._session.add(envelope)
            self._session.flush()

        content_hash = self._content_hash(record)
        existing_snapshot = self._session.scalar(
            select(ContentSnapshot).where(
                ContentSnapshot.content_item_id == item.id,
                ContentSnapshot.content_hash == content_hash,
            )
        )
        if existing_snapshot is not None:
            self._persist_derivations(record, envelope, existing_snapshot)
            return IngestItemResult(
                external_id=record.external_ref.id,
                status=IngestStatus.UNCHANGED,
                content_item_id=item.id,
                snapshot_id=existing_snapshot.id,
            )

        snapshot = ContentSnapshot(
            content_item_id=item.id,
            raw_envelope_id=envelope.id,
            captured_at=record.fetched_at,
            title=record.content.title,
            body_format=record.content.body_format.value,
            body=record.content.body,
            raw_html=record.content.raw_html,
            language=record.content.language,
            content_hash=content_hash,
            source_created_at=record.source_created_at,
            source_updated_at=record.source_updated_at,
        )
        self._session.add(snapshot)
        self._session.flush()
        self._persist_derivations(record, envelope, snapshot)

        return IngestItemResult(
            external_id=record.external_ref.id,
            status=IngestStatus.CREATED,
            content_item_id=item.id,
            snapshot_id=snapshot.id,
        )

    def _persist_derivations(
        self,
        record: SourceRecordV1,
        envelope: RawEnvelope,
        snapshot: ContentSnapshot,
    ) -> None:
        """Persist only quality-passed, replayable derivatives."""

        payload = record.raw.payload
        quality = payload.get("quality")
        if not isinstance(quality, dict) or quality.get("accepted") is not True:
            return
        score_value = quality.get("score")
        quality_score = score_value if isinstance(score_value, int) else 0
        query_value = payload.get("query")
        source_query = query_value.strip() if isinstance(query_value, str) else ""
        round_value = payload.get("discovery_round")
        discovery_round = round_value if isinstance(round_value, int) and round_value >= 0 else 0
        run_id_value = payload.get("discovery_run_id")
        run_id = run_id_value.strip() if isinstance(run_id_value, str) else ""
        if run_id and len(run_id) <= 64:
            self._ensure_discovery_run(record, run_id, source_query)
        else:
            run_id = ""

        for term, origin in self._keyword_pairs(payload):
            existing = self._session.scalar(
                select(KeywordCandidate).where(
                    KeywordCandidate.content_snapshot_id == snapshot.id,
                    KeywordCandidate.raw_envelope_id == envelope.id,
                    KeywordCandidate.term == term,
                    KeywordCandidate.origin == origin,
                    KeywordCandidate.source_query == source_query,
                )
            )
            if existing is not None:
                continue
            self._session.add(
                KeywordCandidate(
                    content_snapshot_id=snapshot.id,
                    raw_envelope_id=envelope.id,
                    discovery_run_id=run_id or None,
                    term=term,
                    origin=origin,
                    source_query=source_query,
                    discovery_round=discovery_round,
                    quality_score=quality_score,
                )
            )

        body = (
            html_fragment_to_text(record.content.body)
            if record.content.body_format.value == "HTML"
            else record.content.body
        )
        draft = build_decision_candidate(body, quality_accepted=True)
        if draft is None:
            return
        existing_candidate = self._session.scalar(
            select(DecisionEpisodeCandidate).where(
                DecisionEpisodeCandidate.content_snapshot_id == snapshot.id,
                DecisionEpisodeCandidate.analysis_version == "heuristic-v1",
            )
        )
        if existing_candidate is None:
            self._session.add(
                DecisionEpisodeCandidate(
                    content_snapshot_id=snapshot.id,
                    analysis_version="heuristic-v1",
                    context=draft.context,
                    decision=draft.decision,
                    action=draft.action,
                    outcome=draft.outcome,
                    confidence=draft.confidence,
                    evidence=draft.evidence,
                    review_status=draft.review_status,
                )
            )

    def _ensure_discovery_run(
        self,
        record: SourceRecordV1,
        run_id: str,
        source_query: str,
    ) -> None:
        run = self._session.get(DiscoveryRun, run_id)
        if run is None:
            self._session.add(
                DiscoveryRun(
                    id=run_id,
                    source_code=record.source.code,
                    adapter_code=record.source.adapter_code,
                    authorization_ref=record.source.authorization_ref,
                    seed_queries=[source_query] if source_query else [],
                    started_at=record.fetched_at,
                    last_seen_at=record.fetched_at,
                )
            )
            return
        if source_query and source_query not in run.seed_queries:
            run.seed_queries = [*run.seed_queries, source_query]
        if record.fetched_at.replace(tzinfo=None) > run.last_seen_at.replace(tzinfo=None):
            run.last_seen_at = record.fetched_at

    @staticmethod
    def _keyword_pairs(payload: dict[str, object]) -> tuple[tuple[str, str], ...]:
        raw_sources = payload.get("keyword_candidate_sources")
        pairs: list[tuple[str, str]] = []
        if isinstance(raw_sources, list):
            for raw_source in raw_sources:
                if not isinstance(raw_source, dict):
                    continue
                term = raw_source.get("term")
                origin = raw_source.get("origin")
                if isinstance(term, str) and isinstance(origin, str):
                    normalized_term = term.strip()
                    normalized_origin = origin.strip() or "provided"
                    if normalized_term:
                        pairs.append((normalized_term, normalized_origin))
        if not pairs:
            raw_candidates = payload.get("keyword_candidates")
            if isinstance(raw_candidates, list):
                pairs.extend(
                    (term.strip(), "provided")
                    for term in raw_candidates
                    if isinstance(term, str) and term.strip()
                )
        return tuple(dict.fromkeys(pairs))

    def _authorization_rejection_reason(self, record: SourceRecordV1) -> str | None:
        reference = record.source.authorization_ref
        if reference is None:
            return "automated source requires authorization_ref"

        checked_at = datetime.now(UTC)
        authorization = self._session.scalar(
            select(SourceAuthorization).where(
                SourceAuthorization.reference == reference,
                SourceAuthorization.source_code == record.source.code,
                SourceAuthorization.adapter_code == record.source.adapter_code,
                SourceAuthorization.status == "ACTIVE",
                SourceAuthorization.valid_from <= checked_at,
                or_(
                    SourceAuthorization.valid_to.is_(None),
                    SourceAuthorization.valid_to >= checked_at,
                ),
            )
        )
        if authorization is None:
            return "authorization_ref is unknown, inactive, expired, or out of scope"
        return None

    @staticmethod
    def _content_hash(record: SourceRecordV1) -> str:
        canonical_content = {
            "availability": record.availability.value,
            "body": record.content.body,
            "body_format": record.content.body_format.value,
            "language": record.content.language,
            "title": record.content.title,
        }
        encoded = json.dumps(
            canonical_content,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode()
        return hashlib.sha256(encoded).hexdigest()
