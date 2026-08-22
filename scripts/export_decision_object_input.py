"""Export unique Zhihu questions as decision-object extraction inputs."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from sqlalchemy import select

from decision_knowledge.db import Database
from decision_knowledge.ingest.models import ContentItem, ContentSnapshot, RawEnvelope


def export_question_titles(database_url: str, output: Path, limit: int | None = None) -> int:
    database = Database(database_url)
    try:
        with database.session() as session:
            rows = session.execute(
                select(
                    ContentSnapshot.id,
                    ContentSnapshot.title,
                    ContentSnapshot.captured_at,
                    RawEnvelope.payload["external_ref"]["parent"]["id"].as_string(),
                )
                .join(ContentItem, ContentItem.id == ContentSnapshot.content_item_id)
                .join(RawEnvelope, RawEnvelope.id == ContentSnapshot.raw_envelope_id)
                .where(
                    ContentItem.source_code == "zhihu",
                    ContentItem.external_type == "answer",
                )
                .order_by(ContentSnapshot.captured_at, ContentSnapshot.id)
            ).all()
            grouped: dict[str, dict[str, object]] = {}
            for snapshot_id, title, _captured_at, question_id in rows:
                if not isinstance(question_id, str) or not question_id.strip():
                    continue
                item = grouped.setdefault(
                    question_id,
                    {
                        "question_id": question_id,
                        "title": title,
                        "snapshot_ids": [],
                    },
                )
                item["title"] = title
                snapshot_ids = item["snapshot_ids"]
                assert isinstance(snapshot_ids, list)
                snapshot_ids.append(snapshot_id)
        ordered = sorted(
            grouped.values(),
            key=lambda item: hashlib.sha256(str(item["question_id"]).encode()).hexdigest(),
        )
        if limit is not None:
            ordered = ordered[:limit]
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(
            json.dumps(ordered, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        return len(ordered)
    finally:
        database.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", default="sqlite+pysqlite:///./local.db")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    count = export_question_titles(args.database_url, args.output, args.limit)
    print(json.dumps({"exported_questions": count, "output": str(args.output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
