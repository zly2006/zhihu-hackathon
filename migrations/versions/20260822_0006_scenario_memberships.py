"""Persist reviewable scenario and branch proposal memberships.

Revision ID: 20260822_0006
Revises: 20260822_0005
Create Date: 2026-08-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260822_0006"
down_revision: str | None = "20260822_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "decision_scenario_membership",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("scenario_id", sa.String(length=36), nullable=False),
        sa.Column("candidate_id", sa.String(length=36), nullable=False),
        sa.Column("similarity", sa.Float(), nullable=False),
        sa.Column("algorithm_version", sa.String(length=64), nullable=False),
        sa.Column("embedding_version", sa.String(length=128), nullable=False),
        sa.Column(
            "review_status",
            sa.String(length=32),
            nullable=False,
            server_default="PROPOSED",
        ),
        sa.Column("evidence", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["scenario_id"], ["decision_scenario.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["candidate_id"], ["decision_episode_candidate.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "scenario_id",
            "candidate_id",
            name="uq_decision_scenario_membership_pair",
        ),
    )
    op.create_index(
        "ix_decision_scenario_membership_scenario",
        "decision_scenario_membership",
        ["scenario_id"],
    )
    op.create_index(
        "ix_decision_scenario_membership_candidate",
        "decision_scenario_membership",
        ["candidate_id"],
    )
    op.create_index(
        "ix_decision_scenario_membership_review_status",
        "decision_scenario_membership",
        ["review_status"],
    )

    op.create_table(
        "decision_branch_membership",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("branch_id", sa.String(length=36), nullable=False),
        sa.Column("candidate_id", sa.String(length=36), nullable=False),
        sa.Column("similarity", sa.Float(), nullable=False),
        sa.Column("algorithm_version", sa.String(length=64), nullable=False),
        sa.Column(
            "review_status",
            sa.String(length=32),
            nullable=False,
            server_default="PROPOSED",
        ),
        sa.Column("evidence", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["branch_id"], ["decision_branch.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["candidate_id"], ["decision_episode_candidate.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "branch_id",
            "candidate_id",
            name="uq_decision_branch_membership_pair",
        ),
    )
    op.create_index(
        "ix_decision_branch_membership_branch",
        "decision_branch_membership",
        ["branch_id"],
    )
    op.create_index(
        "ix_decision_branch_membership_candidate",
        "decision_branch_membership",
        ["candidate_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_decision_branch_membership_candidate",
        table_name="decision_branch_membership",
    )
    op.drop_index(
        "ix_decision_branch_membership_branch",
        table_name="decision_branch_membership",
    )
    op.drop_table("decision_branch_membership")
    op.drop_index(
        "ix_decision_scenario_membership_review_status",
        table_name="decision_scenario_membership",
    )
    op.drop_index(
        "ix_decision_scenario_membership_candidate",
        table_name="decision_scenario_membership",
    )
    op.drop_index(
        "ix_decision_scenario_membership_scenario",
        table_name="decision_scenario_membership",
    )
    op.drop_table("decision_scenario_membership")
