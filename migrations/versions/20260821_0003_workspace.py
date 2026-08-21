"""Add reviewable scenarios and branches for the local workspace.

Revision ID: 20260821_0003
Revises: 20260821_0002
Create Date: 2026-08-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260821_0003"
down_revision: str | None = "20260821_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "content_snapshot",
        sa.Column(
            "review_status",
            sa.String(length=32),
            nullable=False,
            server_default="UNREVIEWED",
        ),
    )
    op.add_column("content_snapshot", sa.Column("review_note", sa.Text(), nullable=True))

    op.create_table(
        "decision_scenario",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("slug", sa.String(length=160), nullable=False),
        sa.Column("name", sa.String(length=256), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("domain", sa.String(length=128), nullable=False),
        sa.Column(
            "review_status",
            sa.String(length=32),
            nullable=False,
            server_default="UNREVIEWED",
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug", name="uq_decision_scenario_slug"),
    )
    op.create_index(
        "ix_decision_scenario_review_status",
        "decision_scenario",
        ["review_status"],
    )
    op.create_table(
        "decision_branch",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("scenario_id", sa.String(length=36), nullable=False),
        sa.Column("label", sa.String(length=256), nullable=False),
        sa.Column("trigger", sa.Text(), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("outcome", sa.Text(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column(
            "review_status",
            sa.String(length=32),
            nullable=False,
            server_default="UNREVIEWED",
        ),
        sa.Column("source_snapshot_id", sa.String(length=36), nullable=True),
        sa.ForeignKeyConstraint(
            ["scenario_id"], ["decision_scenario.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["source_snapshot_id"], ["content_snapshot.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_decision_branch_scenario_position",
        "decision_branch",
        ["scenario_id", "position"],
    )
    op.create_index(
        "ix_decision_branch_review_status",
        "decision_branch",
        ["review_status"],
    )


def downgrade() -> None:
    op.drop_index("ix_decision_branch_review_status", table_name="decision_branch")
    op.drop_index("ix_decision_branch_scenario_position", table_name="decision_branch")
    op.drop_table("decision_branch")
    op.drop_index("ix_decision_scenario_review_status", table_name="decision_scenario")
    op.drop_table("decision_scenario")
    with op.batch_alter_table("content_snapshot") as batch:
        batch.drop_column("review_note")
        batch.drop_column("review_status")
