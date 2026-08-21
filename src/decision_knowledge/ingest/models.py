from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
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
    canonical_url: Mapped[str] = mapped_column(Text, nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    raw_html: Mapped[str | None] = mapped_column(Text)
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
    raw_html: Mapped[str | None] = mapped_column(Text)
    language: Mapped[str] = mapped_column(String(32), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    source_created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    source_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="UNREVIEWED", server_default="UNREVIEWED"
    )
    review_note: Mapped[str | None] = mapped_column(Text)

    content_item: Mapped[ContentItem] = relationship(back_populates="snapshots")


class DecisionScenario(Base):
    __tablename__ = "decision_scenario"
    __table_args__ = (
        UniqueConstraint("slug", name="uq_decision_scenario_slug"),
        Index("ix_decision_scenario_review_status", "review_status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    slug: Mapped[str] = mapped_column(String(160), nullable=False)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    domain: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    review_status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="UNREVIEWED", server_default="UNREVIEWED"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    branches: Mapped[list["DecisionBranch"]] = relationship(
        back_populates="scenario", cascade="all, delete-orphan", order_by="DecisionBranch.position"
    )


class DecisionBranch(Base):
    __tablename__ = "decision_branch"
    __table_args__ = (
        Index("ix_decision_branch_scenario_position", "scenario_id", "position"),
        Index("ix_decision_branch_review_status", "review_status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    scenario_id: Mapped[str] = mapped_column(
        ForeignKey("decision_scenario.id", ondelete="CASCADE"), nullable=False
    )
    label: Mapped[str] = mapped_column(String(256), nullable=False)
    trigger: Mapped[str] = mapped_column(Text, nullable=False, default="")
    action: Mapped[str] = mapped_column(Text, nullable=False, default="")
    outcome: Mapped[str] = mapped_column(Text, nullable=False, default="")
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    review_status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="UNREVIEWED", server_default="UNREVIEWED"
    )
    source_snapshot_id: Mapped[str | None] = mapped_column(
        ForeignKey("content_snapshot.id", ondelete="SET NULL")
    )

    scenario: Mapped[DecisionScenario] = relationship(back_populates="branches")
    source_snapshot: Mapped[ContentSnapshot | None] = relationship()
