import json
import struct
from pathlib import Path

from decision_knowledge.db import Database
from decision_knowledge.ingest.models import DecisionEpisodeCandidate
from scripts.import_candidate_embeddings import import_embeddings


def _write_npy(path: Path) -> None:
    header = b"{'descr': '<f4', 'fortran_order': False, 'shape': (1, 2), }"
    padding = 64 - ((10 + len(header) + 1) % 64)
    header = header + b" " * padding + b"\n"
    path.write_bytes(
        b"\x93NUMPY"
        + b"\x01\x00"
        + struct.pack("<H", len(header))
        + header
        + struct.pack("<2f", 1.0, 0.0)
    )


def test_import_artifact_persists_versioned_vector_and_replays(tmp_path: Path) -> None:
    database_url = f"sqlite+pysqlite:///{tmp_path / 'import.db'}"
    database = Database(database_url)
    database.create_schema()
    with database.session() as session:
        candidate = DecisionEpisodeCandidate(
            content_snapshot_id="snapshot-import",
            analysis_version="heuristic-v1",
            context="工作收入有限。",
            decision="要不要转行？",
            action="先做项目。",
            outcome="收到反馈。",
            confidence=80,
            evidence={"method": "test"},
        )
        session.add(candidate)
        session.flush()
        candidate_id = candidate.id
    database.dispose()

    input_path = tmp_path / "input.json"
    input_path.write_text(
        json.dumps(
            [
                {
                    "id": candidate_id,
                    "context": "工作收入有限。",
                    "decision": "要不要转行？",
                    "confidence": 80,
                    "analysis_version": "heuristic-v1",
                    "scenario_text": "背景：工作收入有限。\n决策点：要不要转行？",
                    "input_sha256": "",
                    "blocking_key": "career",
                }
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    # The importer validates the hash, so derive it from the public builder.
    from decision_knowledge.analysis.embeddings import build_scenario_input

    scenario_input = build_scenario_input(context="工作收入有限。", decision="要不要转行？")
    payload = json.loads(input_path.read_text(encoding="utf-8"))
    payload[0]["input_sha256"] = scenario_input.input_sha256
    input_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    artifact_dir = tmp_path / "artifact"
    artifact_dir.mkdir()
    (artifact_dir / "candidate_ids.json").write_text(
        json.dumps([candidate_id]), encoding="utf-8"
    )
    (artifact_dir / "scenario_texts.json").write_text(
        json.dumps([scenario_input.text], ensure_ascii=False), encoding="utf-8"
    )
    (artifact_dir / "manifest.json").write_text(
        json.dumps(
            {
                "model_id": "test-model",
                "embedding_version": "test-v1",
                "count": 1,
                "dimension": 2,
            }
        ),
        encoding="utf-8",
    )
    _write_npy(artifact_dir / "embeddings.npy")

    first = import_embeddings(
        database_url=database_url,
        input_path=input_path,
        artifact_dir=artifact_dir,
    )
    replay = import_embeddings(
        database_url=database_url,
        input_path=input_path,
        artifact_dir=artifact_dir,
    )

    assert first == {"created": 1, "unchanged": 0, "count": 1, "dimension": 2}
    assert replay == {"created": 0, "unchanged": 1, "count": 1, "dimension": 2}
