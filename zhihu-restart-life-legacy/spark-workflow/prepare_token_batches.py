"""Create token-bounded JSONL batches from the local SQLite snapshot store.

The script is intentionally read-only with respect to the source database. It
copies only the fields needed by the extractor: snapshot id, question title,
and answer body. Each generated run directory is self-contained and can be
handed to a cheap model worker or to a small Spark calibration run.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import tiktoken


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, help="SQLite database path")
    parser.add_argument(
        "--output-dir", required=True, help="New directory for input/manifest/state"
    )
    parser.add_argument(
        "--max-input-tokens",
        type=int,
        default=8000,
        help="Maximum serialized input tokens per batch (default: 8000)",
    )
    parser.add_argument(
        "--max-records",
        type=int,
        default=25,
        help="Maximum records per batch (default: 25)",
    )
    parser.add_argument(
        "--run-id",
        default=None,
        help="Run id; defaults to a timestamped local id",
    )
    return parser.parse_args()


def record_line(snapshot_id: str, title: str, body: str) -> str:
    return (
        json.dumps(
            {
                "id": snapshot_id,
                "question_title": title,
                "answer_text": body,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
        + "\n"
    )


def main() -> None:
    args = parse_args()
    if args.max_input_tokens <= 0 or args.max_records <= 0:
        raise SystemExit("max-input-tokens and max-records must be positive")

    output_dir = Path(args.output_dir)
    input_dir = output_dir / "input"
    state_dir = output_dir / "state"
    if output_dir.exists() and any(output_dir.iterdir()):
        raise SystemExit(f"refusing to overwrite non-empty directory: {output_dir}")
    input_dir.mkdir(parents=True, exist_ok=True)
    state_dir.mkdir(parents=True, exist_ok=True)

    schema_source = Path(__file__).with_name("output.schema.json")
    if not schema_source.exists():
        raise SystemExit(f"missing schema next to script: {schema_source}")
    shutil.copyfile(schema_source, output_dir / "output.schema.json")

    encoder = tiktoken.get_encoding("o200k_base")
    batches: list[dict[str, object]] = []
    current: list[str] = []
    current_tokens = 0
    oversized = 0

    def flush() -> None:
        nonlocal current, current_tokens
        if not current:
            return
        number = len(batches) + 1
        batch_id = f"batch-{number:04d}"
        path = input_dir / f"{batch_id}.jsonl"
        path.write_text("".join(current), encoding="utf-8", newline="\n")
        batches.append(
            {
                "batch_id": batch_id,
                "input_file": f"input/{batch_id}.jsonl",
                "records": len(current),
                "input_tokens": current_tokens,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "oversized": current_tokens > args.max_input_tokens,
                "status": "PENDING",
            }
        )
        current = []
        current_tokens = 0

    # mode=ro prevents accidental writes to the source database.
    db_uri = Path(args.db).resolve().as_uri() + "?mode=ro"
    with sqlite3.connect(db_uri, uri=True) as connection:
        rows = connection.execute(
            """
            SELECT id, title, body
            FROM content_snapshot
            ORDER BY captured_at, id
            """
        )
        for snapshot_id, title, body in rows:
            line = record_line(snapshot_id, title, body)
            line_tokens = len(encoder.encode(line))
            if line_tokens > args.max_input_tokens:
                flush()
                current = [line]
                current_tokens = line_tokens
                oversized += 1
                flush()
                continue
            if current and (
                current_tokens + line_tokens > args.max_input_tokens
                or len(current) >= args.max_records
            ):
                flush()
            current.append(line)
            current_tokens += line_tokens
        flush()

    run_id = args.run_id or datetime.now(timezone.utc).strftime(
        "spark-calibration-%Y%m%dT%H%M%SZ"
    )
    manifest = {
        "run_id": run_id,
        "mode": "spark_calibration",
        "extractor_version": "decision-object-v1",
        "input_dir": "input",
        "output_dir": "output",
        "schema": "output.schema.json",
        "max_input_tokens": args.max_input_tokens,
        "max_records": args.max_records,
        "batches": batches,
        "total_records": sum(int(batch["records"]) for batch in batches),
        "total_input_tokens": sum(
            int(batch["input_tokens"]) for batch in batches
        ),
    }
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    progress = {
        "run_id": run_id,
        "updated_at": None,
        "completed_batches": [],
        "retry_batches": [],
        "counts": {
            "input": manifest["total_records"],
            "accept": 0,
            "reject": 0,
            "retry": 0,
        },
    }
    (state_dir / "progress.json").write_text(
        json.dumps(progress, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(
        json.dumps(
            {
                "run_id": run_id,
                "batches": len(batches),
                "records": manifest["total_records"],
                "input_tokens": manifest["total_input_tokens"],
                "oversized_single_record_batches": oversized,
                "output_dir": str(output_dir),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
