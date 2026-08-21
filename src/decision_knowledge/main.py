from pathlib import Path

from decision_knowledge.api import create_app

PROJECT_ROOT = Path(__file__).resolve().parents[2]
app = create_app(
    seed_local_data=True,
    seed_path=PROJECT_ROOT / "data" / "zhihu" / "public_answers.jsonl",
)
