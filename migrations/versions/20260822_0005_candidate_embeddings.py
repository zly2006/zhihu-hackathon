"""Persist versioned candidate-scenario embeddings.

Revision ID: 20260822_0005
Revises: 20260821_0004
Create Date: 2026-08-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260822_0005"
down_revision: str | None = "20260821_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "candidate_embedding",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("candidate_id", sa.String(length=36), nullable=False),
        sa.Column("embedding_version", sa.String(length=128), nullable=False),
        sa.Column("model_id", sa.String(length=256), nullable=False),
        sa.Column("scenario_text_version", sa.String(length=64), nullable=False),
        sa.Column("scenario_text", sa.Text(), nullable=False),
        sa.Column("blocking_key", sa.String(length=64), nullable=False),
        sa.Column("input_sha256", sa.String(length=64), nullable=False),
        sa.Column("dimension", sa.Integer(), nullable=False),
        sa.Column("vector_encoding", sa.String(length=32), nullable=False),
        sa.Column("vector", sa.LargeBinary(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="READY"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["candidate_id"],
            ["decision_episode_candidate.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "candidate_id",
            "embedding_version",
            name="uq_candidate_embedding_candidate_version",
        ),
    )
    op.create_index(
        "ix_candidate_embedding_version",
        "candidate_embedding",
        ["embedding_version"],
    )
    op.create_index(
        "ix_candidate_embedding_version_block",
        "candidate_embedding",
        ["embedding_version", "blocking_key"],
    )
    op.create_index(
        "ix_candidate_embedding_input_hash",
        "candidate_embedding",
        ["input_sha256"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_candidate_embedding_input_hash",
        table_name="candidate_embedding",
    )
    op.drop_index(
        "ix_candidate_embedding_version_block",
        table_name="candidate_embedding",
    )
    op.drop_index(
        "ix_candidate_embedding_version",
        table_name="candidate_embedding",
    )
    op.drop_table("candidate_embedding")
