import hashlib
import json
from datetime import UTC, datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from decision_knowledge.contracts.source_record import SourceRecordV1
from decision_knowledge.ingest.models import (
    ContentItem,
    ContentSnapshot,
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

        return IngestItemResult(
            external_id=record.external_ref.id,
            status=IngestStatus.CREATED,
            content_item_id=item.id,
            snapshot_id=snapshot.id,
        )

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
