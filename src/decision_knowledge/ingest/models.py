from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from decision_knowledge.db import Base


def new_id() -> str:
    return str(uuid4())


class ContentItem(Base):
    __tablename__ = "content_item"
    __table_args__ = (
        UniqueConstraint(
            "source_code",
            "external_type",
            "external_id",
            name="uq_content_item_external_ref",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    source_code: Mapped[str] = mapped_column(String(64), nullable=False)
    external_type: Mapped[str] = mapped_column(String(64), nullable=False)
    external_id: Mapped[str] = mapped_column(String(255), nullable=False)
    canonical_url: Mapped[str] = mapped_column(Text, nullable=False)
    availability: Mapped[str] = mapped_column(String(32), nullable=False)

    snapshots: Mapped[list["ContentSnapshot"]] = relationship(
        back_populates="content_item"
    )


class SourceAuthorization(Base):
    __tablename__ = "source_authorization"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    reference: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    source_code: Mapped[str] = mapped_column(String(64), nullable=False)
    adapter_code: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    valid_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    valid_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RawEnvelope(Base):
    __tablename__ = "raw_envelope"
    __table_args__ = (
        UniqueConstraint(
            "source_code",
            "external_type",
            "external_id",
            "payload_hash",
            name="uq_raw_envelope_external_hash",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    source_code: Mapped[str] = mapped_column(String(64), nullable=False)
    adapter_code: Mapped[str] = mapped_column(String(128), nullable=False)
    adapter_version: Mapped[str] = mapped_column(String(64), nullable=False)
    authorization_ref: Mapped[str | None] = mapped_column(String(128))
    external_type: Mapped[str] = mapped_column(String(64), nullable=False)
    external_id: Mapped[str] = mapped_column(String(255), nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)


class ContentSnapshot(Base):
    __tablename__ = "content_snapshot"
    __table_args__ = (
        UniqueConstraint(
            "content_item_id",
            "content_hash",
            name="uq_content_snapshot_item_hash",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    content_item_id: Mapped[str] = mapped_column(
        ForeignKey("content_item.id"), nullable=False
    )
    raw_envelope_id: Mapped[str] = mapped_column(
        ForeignKey("raw_envelope.id"), nullable=False
    )
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    body_format: Mapped[str] = mapped_column(String(32), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    language: Mapped[str] = mapped_column(String(32), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    source_created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    source_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    content_item: Mapped[ContentItem] = relationship(back_populates="snapshots")
