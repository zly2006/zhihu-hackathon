"""Import a worker-produced candidate embedding artifact into the database."""

from __future__ import annotations

import argparse
import ast
import json
import struct
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from sqlalchemy import select

from decision_knowledge.analysis.embeddings import build_scenario_input
from decision_knowledge.analysis.retrieval import (
    CandidateEmbeddingImport,
    upsert_candidate_embedding,
)
from decision_knowledge.db import Database
from decision_knowledge.ingest.models import CandidateEmbedding


def _read_npy_float32(path: Path) -> tuple[int, int, Iterator[tuple[float, ...]]]:
    payload = path.read_bytes()
    if payload[:6] != b"\x93NUMPY":
        raise ValueError("embedding artifact is not a NumPy .npy file")
    major, minor = payload[6], payload[7]
    if major == 1:
        header_size = struct.unpack_from("<H", payload, 8)[0]
        header_start = 10
    elif major in (2, 3):
        header_size = struct.unpack_from("<I", payload, 8)[0]
        header_start = 12
    else:
        raise ValueError(f"unsupported .npy version: {major}.{minor}")
    header_end = header_start + header_size
    header = ast.literal_eval(payload[header_start:header_end].decode("latin1"))
    if not isinstance(header, dict):
        raise ValueError("invalid .npy header")
    if header.get("descr") != "<f4" or header.get("fortran_order") is not False:
        raise ValueError("only C-order little-endian float32 vectors are supported")
    shape = header.get("shape")
    if not isinstance(shape, tuple) or len(shape) != 2:
        raise ValueError("embedding artifact must be a 2D matrix")
    count, dimension = shape
    if not isinstance(count, int) or not isinstance(dimension, int) or count < 1 or dimension < 1:
        raise ValueError("embedding artifact has an invalid shape")
    expected_bytes = count * dimension * 4
    if len(payload) - header_end != expected_bytes:
        raise ValueError("embedding artifact payload length does not match its shape")

    def vectors() -> Iterator[tuple[float, ...]]:
        for row in range(count):
            offset = header_end + row * dimension * 4
            yield struct.unpack_from(f"<{dimension}f", payload, offset)

    return count, dimension, vectors()


def _load_json_array(path: Path, label: str) -> list[Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, list):
        raise ValueError(f"{label} must be a JSON array")
    return value


def import_embeddings(
    *,
    database_url: str,
    input_path: Path,
    artifact_dir: Path,
) -> dict[str, int]:
    rows = _load_json_array(input_path, "embedding input")
    candidate_ids = [
        str(value)
        for value in _load_json_array(artifact_dir / "candidate_ids.json", "candidate IDs")
    ]
    scenario_texts = [
        str(value)
        for value in _load_json_array(artifact_dir / "scenario_texts.json", "scenario texts")
    ]
    manifest = json.loads((artifact_dir / "manifest.json").read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        raise ValueError("embedding manifest must be a JSON object")
    count, dimension, vectors = _read_npy_float32(artifact_dir / "embeddings.npy")
    if count != len(rows) or candidate_ids != [str(row["id"]) for row in rows]:
        raise ValueError("candidate IDs do not match embedding input order")
    if len(scenario_texts) != count or int(manifest.get("count", -1)) != count:
        raise ValueError("embedding artifact count does not match input")
    if int(manifest.get("dimension", -1)) != dimension:
        raise ValueError("embedding artifact dimension does not match manifest")

    model_id = str(manifest.get("model_id", ""))
    embedding_version = str(manifest.get("embedding_version", ""))
    if not model_id or not embedding_version:
        raise ValueError("manifest must contain model_id and embedding_version")

    database = Database(database_url)
    database.create_schema()
    created = 0
    unchanged = 0
    try:
        with database.session() as session:
            existing_ids = set(
                session.scalars(
                    select(CandidateEmbedding.candidate_id).where(
                        CandidateEmbedding.embedding_version == embedding_version
                    )
                ).all()
            )
            for row, candidate_id, scenario_text, vector in zip(
                rows,
                candidate_ids,
                scenario_texts,
                vectors,
                strict=True,
            ):
                if not isinstance(row, dict):
                    raise ValueError("embedding input rows must be JSON objects")
                scenario_input = build_scenario_input(
                    context=str(row.get("context", "")),
                    decision=str(row.get("decision", "")),
                    action=str(row.get("action", "")),
                    outcome=str(row.get("outcome", "")),
                )
                if not scenario_input.ready:
                    raise ValueError(f"candidate is not ready for embedding: {candidate_id}")
                if scenario_text != scenario_input.text:
                    raise ValueError(f"scenario text mismatch for candidate: {candidate_id}")
                if row.get("input_sha256") != scenario_input.input_sha256:
                    raise ValueError(f"scenario input hash mismatch for candidate: {candidate_id}")
                embedding_row = CandidateEmbeddingImport(
                    candidate_id=candidate_id,
                    scenario_input=scenario_input,
                    vector=vector,
                )
                upsert_candidate_embedding(
                    session,
                    embedding_row,
                    model_id=model_id,
                    embedding_version=embedding_version,
                )
                if candidate_id in existing_ids:
                    unchanged += 1
                else:
                    created += 1
                    existing_ids.add(candidate_id)
    finally:
        database.dispose()
    return {"created": created, "unchanged": unchanged, "count": count, "dimension": dimension}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", default="sqlite+pysqlite:///./local.db")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--artifact-dir", type=Path, required=True)
    args = parser.parse_args()
    print(
        json.dumps(
            import_embeddings(
                database_url=args.database_url,
                input_path=args.input,
                artifact_dir=args.artifact_dir,
            ),
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
