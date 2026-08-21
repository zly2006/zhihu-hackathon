"""Preserve source URLs and raw HTML fragments.

Revision ID: 20260821_0002
Revises: 20260820_0001
Create Date: 2026-08-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260821_0002"
down_revision: str | None = "20260820_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "raw_envelope",
        sa.Column("canonical_url", sa.Text(), nullable=True),
    )
    op.add_column(
        "raw_envelope",
        sa.Column("raw_html", sa.Text(), nullable=True),
    )
    op.add_column(
        "content_snapshot",
        sa.Column("raw_html", sa.Text(), nullable=True),
    )

    bind = op.get_bind()
    dialect = bind.dialect.name
    if dialect == "postgresql":
        op.execute(
            sa.text(
                """
                UPDATE raw_envelope AS raw
                SET canonical_url = COALESCE(raw.payload ->> 'canonical_url', item.canonical_url),
                    raw_html = COALESCE(
                        raw.payload #>> '{content,raw_html}',
                        CASE
                            WHEN raw.payload #>> '{content,body_format}' = 'HTML'
                            THEN raw.payload #>> '{content,body}'
                        END
                    )
                FROM content_item AS item
                WHERE item.source_code = raw.source_code
                  AND item.external_type = raw.external_type
                  AND item.external_id = raw.external_id
                """
            )
        )
        op.execute(
            sa.text(
                """
                UPDATE content_snapshot AS snapshot
                SET raw_html = raw.raw_html
                FROM raw_envelope AS raw
                WHERE raw.id = snapshot.raw_envelope_id
                  AND snapshot.raw_html IS NULL
                """
            )
        )
    elif dialect == "sqlite":
        op.execute(
            sa.text(
                """
                UPDATE raw_envelope
                SET canonical_url = json_extract(payload, '$.canonical_url'),
                    raw_html = COALESCE(
                        json_extract(payload, '$.content.raw_html'),
                        CASE
                            WHEN json_extract(payload, '$.content.body_format') = 'HTML'
                            THEN json_extract(payload, '$.content.body')
                        END
                    )
                WHERE canonical_url IS NULL
                """
            )
        )
        op.execute(
            sa.text(
                """
                UPDATE content_snapshot
                SET raw_html = (
                    SELECT raw.raw_html
                    FROM raw_envelope AS raw
                    WHERE raw.id = content_snapshot.raw_envelope_id
                )
                WHERE raw_html IS NULL
                """
            )
        )
    else:
        raise RuntimeError(f"raw provenance migration does not support {dialect}")

    missing_urls = bind.execute(
        sa.text("SELECT COUNT(*) FROM raw_envelope WHERE canonical_url IS NULL")
    ).scalar_one()
    if missing_urls:
        raise RuntimeError(
            "cannot make raw_envelope.canonical_url required: "
            f"{missing_urls} rows have no recoverable source URL"
        )

    with op.batch_alter_table("raw_envelope") as batch:
        batch.alter_column(
            "canonical_url",
            existing_type=sa.Text(),
            nullable=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("content_snapshot") as batch:
        batch.drop_column("raw_html")
    with op.batch_alter_table("raw_envelope") as batch:
        batch.drop_column("raw_html")
        batch.drop_column("canonical_url")
