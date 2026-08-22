"""Generate versioned candidate-scenario vectors on a worker with a GPU."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import UTC, datetime
from pathlib import Path


def run_embedding(
    input_path: Path,
    output_dir: Path,
    *,
    model_id: str,
    embedding_version: str,
    device: str,
    batch_size: int,
) -> dict[str, object]:
    try:
        import numpy as np
        import torch
        from sentence_transformers import SentenceTransformer
    except ImportError as exc:  # pragma: no cover - exercised on the worker image
        raise RuntimeError(
            "embedding runtime requires numpy, torch and sentence-transformers"
        ) from exc

    rows = json.loads(input_path.read_text(encoding="utf-8"))
    if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
        raise ValueError("embedding input must be a JSON array of objects")
    ids = [str(row["id"]) for row in rows]
    texts = [str(row["scenario_text"]) for row in rows]
    if len(ids) != len(set(ids)):
        raise ValueError("embedding input contains duplicate candidate IDs")

    if device.startswith("cuda") and not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable; refusing to fall back to CPU")

    output_dir.mkdir(parents=True, exist_ok=True)
    model = SentenceTransformer(model_id, device=device)
    vectors = model.encode(
        texts,
        batch_size=batch_size,
        normalize_embeddings=True,
        convert_to_numpy=True,
        show_progress_bar=True,
    )
    embeddings = np.asarray(vectors, dtype=np.float32)
    if embeddings.ndim != 2 or embeddings.shape[0] != len(ids):
        raise ValueError("model output shape does not match candidate count")

    np.save(output_dir / "embeddings.npy", embeddings)
    (output_dir / "candidate_ids.json").write_text(
        json.dumps(ids, ensure_ascii=False), encoding="utf-8"
    )
    (output_dir / "scenario_texts.json").write_text(
        json.dumps(texts, ensure_ascii=False), encoding="utf-8"
    )
    manifest: dict[str, object] = {
        "model_id": model_id,
        "embedding_version": embedding_version,
        "scenario_text_version": "scenario-text-v2",
        "dimension": int(embeddings.shape[1]),
        "count": int(embeddings.shape[0]),
        "device": device,
        "torch_version": torch.__version__,
        "cuda_version": torch.version.cuda,
        "gpu": torch.cuda.get_device_name(0) if device.startswith("cuda") else None,
        "input_sha256": hashlib.sha256(input_path.read_bytes()).hexdigest(),
        "created_at": datetime.now(UTC).isoformat(),
    }
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(manifest, ensure_ascii=False))
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--model-id", default="BAAI/bge-large-zh-v1.5")
    parser.add_argument(
        "--embedding-version",
        default="bge-large-zh-v1.5:scenario-text-v2",
    )
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--batch-size", type=int, default=32)
    args = parser.parse_args()
    if args.batch_size < 1:
        parser.error("--batch-size must be positive")
    run_embedding(
        args.input,
        args.output_dir,
        model_id=args.model_id,
        embedding_version=args.embedding_version,
        device=args.device,
        batch_size=args.batch_size,
    )
    # CUDA worker pools can otherwise keep a completed CLI process alive on
    # some hosts. All artifacts are written before this point.
    os._exit(0)


if __name__ == "__main__":
    main()
