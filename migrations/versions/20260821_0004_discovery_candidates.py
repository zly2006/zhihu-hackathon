"""Persist snowball lineage and reviewable decision candidates.

Revision ID: 20260821_0004
Revises: 20260821_0003
Create Date: 2026-08-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260821_0004"
down_revision: str | None = "20260821_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "discovery_run",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("source_code", sa.String(length=64), nullable=False),
        sa.Column("adapter_code", sa.String(length=128), nullable=False),
        sa.Column("authorization_ref", sa.String(length=128), nullable=True),
        sa.Column("seed_queries", sa.JSON(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default="IMPORTED",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_discovery_run_started_at", "discovery_run", ["started_at"])

    op.create_table(
        "keyword_candidate",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("content_snapshot_id", sa.String(length=36), nullable=False),
        sa.Column("raw_envelope_id", sa.String(length=36), nullable=False),
        sa.Column("discovery_run_id", sa.String(length=64), nullable=True),
        sa.Column("term", sa.String(length=256), nullable=False),
        sa.Column("origin", sa.String(length=32), nullable=False),
        sa.Column("source_query", sa.String(length=256), nullable=False),
        sa.Column("discovery_round", sa.Integer(), nullable=False),
        sa.Column("quality_score", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default="CANDIDATE",
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["content_snapshot_id"], ["content_snapshot.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["raw_envelope_id"], ["raw_envelope.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["discovery_run_id"], ["discovery_run.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "content_snapshot_id",
            "raw_envelope_id",
            "term",
            "origin",
            "source_query",
            name="uq_keyword_candidate_snapshot_raw_term_query",
        ),
    )
    op.create_index("ix_keyword_candidate_term", "keyword_candidate", ["term"])
    op.create_index(
        "ix_keyword_candidate_round", "keyword_candidate", ["discovery_round"]
    )

    op.create_table(
        "decision_episode_candidate",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("content_snapshot_id", sa.String(length=36), nullable=False),
        sa.Column("analysis_version", sa.String(length=64), nullable=False),
        sa.Column("context", sa.Text(), nullable=False),
        sa.Column("decision", sa.Text(), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("outcome", sa.Text(), nullable=False),
        sa.Column("confidence", sa.Integer(), nullable=False),
        sa.Column("evidence", sa.JSON(), nullable=False),
        sa.Column(
            "review_status",
            sa.String(length=32),
            nullable=False,
            server_default="UNREVIEWED",
        ),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["content_snapshot_id"], ["content_snapshot.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "content_snapshot_id",
            "analysis_version",
            name="uq_decision_candidate_snapshot_version",
        ),
    )
    op.create_index(
        "ix_decision_candidate_review_status",
        "decision_episode_candidate",
        ["review_status"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_decision_candidate_review_status", table_name="decision_episode_candidate"
    )
    op.drop_table("decision_episode_candidate")
    op.drop_index("ix_keyword_candidate_round", table_name="keyword_candidate")
    op.drop_index("ix_keyword_candidate_term", table_name="keyword_candidate")
    op.drop_table("keyword_candidate")
    op.drop_index("ix_discovery_run_started_at", table_name="discovery_run")
    op.drop_table("discovery_run")
