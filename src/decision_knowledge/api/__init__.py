from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, FastAPI
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from decision_knowledge.contracts.source_record import SourceRecordV1
from decision_knowledge.db import Database
from decision_knowledge.ingest.source_ingestion import (
    IngestBatchResult,
    SourceIngestion,
)
from decision_knowledge.settings import Settings


class SourceRecordBatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    records: tuple[SourceRecordV1, ...] = Field(min_length=1, max_length=100)


def create_app(*, database: Database | None = None) -> FastAPI:
    app = FastAPI(title="Decision Knowledge")
    app_database = database or Database(Settings().database_url)
    app.state.database = app_database

    def get_session() -> Iterator[Session]:
        with app_database.session() as session:
            yield session

    @app.get("/health")
    def health(session: Annotated[Session, Depends(get_session)]) -> dict[str, str]:
        session.execute(text("SELECT 1"))
        return {"status": "ok", "database": "ok"}

    @app.post("/v1/source-records:batch", response_model=IngestBatchResult)
    def ingest_source_records(
        request: SourceRecordBatchRequest,
        session: Annotated[Session, Depends(get_session)],
    ) -> IngestBatchResult:
        return SourceIngestion(session).ingest_batch(request.records)

    return app
