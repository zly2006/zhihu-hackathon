"""Add COEL-backed decision objects and source assignments.

Revision ID: 20260822_0007
Revises: 20260822_0006
Create Date: 2026-08-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260822_0007"
down_revision: str | None = "20260822_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "decision_object",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("object_key", sa.String(length=256), nullable=False),
        sa.Column("name", sa.String(length=256), nullable=False),
        sa.Column("coel_codes", sa.JSON(), nullable=False),
        sa.Column("coel_labels", sa.JSON(), nullable=False),
        sa.Column("taxonomy_version", sa.String(length=64), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("object_key", name="uq_decision_object_key"),
    )
    op.create_index(
        "ix_decision_object_taxonomy", "decision_object", ["taxonomy_version"]
    )

    op.create_table(
        "decision_object_assignment",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("decision_object_id", sa.String(length=36), nullable=False),
        sa.Column("content_snapshot_id", sa.String(length=36), nullable=False),
        sa.Column("question_external_id", sa.String(length=255), nullable=False),
        sa.Column("source_title", sa.Text(), nullable=False),
        sa.Column("extractor_version", sa.String(length=64), nullable=False),
        sa.Column("model_id", sa.String(length=256), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("evidence", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["decision_object_id"], ["decision_object.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["content_snapshot_id"], ["content_snapshot.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "content_snapshot_id",
            "extractor_version",
            name="uq_decision_object_assignment_snapshot_version",
        ),
    )
    op.create_index(
        "ix_decision_object_assignment_object",
        "decision_object_assignment",
        ["decision_object_id"],
    )
    op.create_index(
        "ix_decision_object_assignment_question",
        "decision_object_assignment",
        ["question_external_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_decision_object_assignment_question",
        table_name="decision_object_assignment",
    )
    op.drop_index(
        "ix_decision_object_assignment_object",
        table_name="decision_object_assignment",
    )
    op.drop_table("decision_object_assignment")
    op.drop_index("ix_decision_object_taxonomy", table_name="decision_object")
    op.drop_table("decision_object")
