from pathlib import Path

from fastapi.testclient import TestClient

from decision_knowledge.api import create_app
from decision_knowledge.db import Database


def test_health_reports_database_ready(tmp_path: Path) -> None:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'health.db'}")
    client = TestClient(create_app(database=database))

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}
    database.dispose()
