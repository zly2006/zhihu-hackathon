"""Create the authoritative ingest core.

Revision ID: 20260820_0001
Revises:
Create Date: 2026-08-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260820_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "content_item",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("source_code", sa.String(length=64), nullable=False),
        sa.Column("external_type", sa.String(length=64), nullable=False),
        sa.Column("external_id", sa.String(length=255), nullable=False),
        sa.Column("canonical_url", sa.Text(), nullable=False),
        sa.Column("availability", sa.String(length=32), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "source_code",
            "external_type",
            "external_id",
            name="uq_content_item_external_ref",
        ),
    )
    op.create_table(
        "source_authorization",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("reference", sa.String(length=128), nullable=False),
        sa.Column("source_code", sa.String(length=64), nullable=False),
        sa.Column("adapter_code", sa.String(length=128), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("valid_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("valid_to", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("reference"),
    )
    op.create_table(
        "raw_envelope",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("source_code", sa.String(length=64), nullable=False),
        sa.Column("adapter_code", sa.String(length=128), nullable=False),
        sa.Column("adapter_version", sa.String(length=64), nullable=False),
        sa.Column("authorization_ref", sa.String(length=128), nullable=True),
        sa.Column("external_type", sa.String(length=64), nullable=False),
        sa.Column("external_id", sa.String(length=255), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload_hash", sa.String(length=64), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "source_code",
            "external_type",
            "external_id",
            "payload_hash",
            name="uq_raw_envelope_external_hash",
        ),
    )
    op.create_table(
        "content_snapshot",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("content_item_id", sa.String(length=36), nullable=False),
        sa.Column("raw_envelope_id", sa.String(length=36), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("body_format", sa.String(length=32), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("language", sa.String(length=32), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("source_created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["content_item_id"], ["content_item.id"]),
        sa.ForeignKeyConstraint(["raw_envelope_id"], ["raw_envelope.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "content_item_id",
            "content_hash",
            name="uq_content_snapshot_item_hash",
        ),
    )


def downgrade() -> None:
    op.drop_table("content_snapshot")
    op.drop_table("raw_envelope")
    op.drop_table("source_authorization")
    op.drop_table("content_item")
