import re
from collections.abc import Iterator
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, HttpUrl
from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session

from decision_knowledge.contracts.source_record import Availability
from decision_knowledge.db import Database
from decision_knowledge.ingest.bootstrap import import_jsonl
from decision_knowledge.ingest.models import (
    ContentItem,
    ContentSnapshot,
    DecisionBranch,
    DecisionScenario,
    RawEnvelope,
)
from decision_knowledge.ingest.source_ingestion import (
    IngestBatchResult,
    SourceIngestion,
)
from decision_knowledge.settings import Settings


class SourceRecordBatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    records: tuple[dict[str, object], ...] = Field(min_length=1, max_length=100)


class SnapshotSummary(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    item_id: str
    snapshot_id: str
    source_code: str
    external_id: str
    title: str
    body_preview: str
    canonical_url: str
    language: str
    availability: str
    captured_at: str
    review_status: str
    has_raw_html: bool


class SearchResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    query: str
    total: int
    items: tuple[SnapshotSummary, ...]


class SnapshotDetail(SnapshotSummary):
    body: str
    raw_html: str | None
    raw_sha256: str | None
    raw_payload: dict[str, object] | None = None


class ContentDetail(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    item_id: str
    source_code: str
    external_id: str
    canonical_url: str
    availability: str
    snapshots: tuple[SnapshotDetail, ...]


class AdminStats(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    content_items: int
    snapshots: int
    raw_envelopes: int
    scenarios: int
    branches: int
    confirmed_scenarios: int


class WorkspaceOverview(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    content_items: int
    snapshots: int
    raw_envelopes: int
    scenarios: int
    branches: int
    confirmed_scenarios: int
    unreviewed_snapshots: int
    semantic_status: str


class ScenarioCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    slug: str = Field(min_length=1, max_length=160, pattern=r"^[a-z0-9][a-z0-9-]*$")
    name: str = Field(min_length=1, max_length=256)
    summary: str = Field(default="", max_length=8_000)
    domain: str = Field(default="", max_length=128)
    review_status: str = Field(default="UNREVIEWED", max_length=32)


class ScenarioUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    slug: str | None = Field(
        default=None,
        min_length=1,
        max_length=160,
        pattern=r"^[a-z0-9][a-z0-9-]*$",
    )
    name: str | None = Field(default=None, min_length=1, max_length=256)
    summary: str | None = Field(default=None, max_length=8_000)
    domain: str | None = Field(default=None, max_length=128)
    review_status: str | None = Field(default=None, max_length=32)


class BranchCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    label: str = Field(min_length=1, max_length=256)
    trigger: str = Field(default="", max_length=4_000)
    action: str = Field(default="", max_length=4_000)
    outcome: str = Field(default="", max_length=8_000)
    position: int = Field(default=0, ge=0, le=10_000)
    review_status: str = Field(default="UNREVIEWED", max_length=32)
    source_snapshot_id: str | None = None


class BranchUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    label: str | None = Field(default=None, min_length=1, max_length=256)
    trigger: str | None = Field(default=None, max_length=4_000)
    action: str | None = Field(default=None, max_length=4_000)
    outcome: str | None = Field(default=None, max_length=8_000)
    position: int | None = Field(default=None, ge=0, le=10_000)
    review_status: str | None = Field(default=None, max_length=32)
    source_snapshot_id: str | None = None


class ContentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    canonical_url: HttpUrl | None = None
    availability: Availability | None = None


class SnapshotReviewUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    review_status: str = Field(min_length=1, max_length=32)
    review_note: str | None = Field(default=None, max_length=8_000)


def _body_preview(body: str, length: int = 220) -> str:
    plain = re.sub(r"<[^>]+>", " ", body)
    return " ".join(plain.split())[:length]


def _summary(item: ContentItem, snapshot: ContentSnapshot) -> SnapshotSummary:
    return SnapshotSummary(
        item_id=item.id,
        snapshot_id=snapshot.id,
        source_code=item.source_code,
        external_id=item.external_id,
        title=snapshot.title,
        body_preview=_body_preview(snapshot.body),
        canonical_url=item.canonical_url,
        language=snapshot.language,
        availability=item.availability,
        captured_at=snapshot.captured_at.isoformat(),
        review_status=snapshot.review_status,
        has_raw_html=bool(snapshot.raw_html),
    )


def _detail(
    item: ContentItem,
    snapshot: ContentSnapshot,
    envelope: RawEnvelope | None,
    *,
    include_payload: bool,
) -> SnapshotDetail:
    return SnapshotDetail(
        **_summary(item, snapshot).model_dump(),
        body=snapshot.body,
        raw_html=snapshot.raw_html,
        raw_sha256=envelope.payload_hash if envelope else None,
        raw_payload=envelope.payload if include_payload and envelope else None,
    )


def _scenario_dict(
    scenario: DecisionScenario,
    session: Session,
    *,
    confirmed_only: bool,
) -> dict[str, object]:
    branches: list[dict[str, object]] = []
    for branch in scenario.branches:
        if confirmed_only and branch.review_status != "CONFIRMED":
            continue
        evidence: dict[str, object] | None = None
        if branch.source_snapshot_id:
            source = session.get(ContentSnapshot, branch.source_snapshot_id)
            if source:
                item = session.get(ContentItem, source.content_item_id)
                if item:
                    evidence = {
                        "snapshot_id": source.id,
                        "title": source.title,
                        "canonical_url": item.canonical_url,
                    }
        branches.append(
            {
                "id": branch.id,
                "label": branch.label,
                "trigger": branch.trigger,
                "action": branch.action,
                "outcome": branch.outcome,
                "position": branch.position,
                "review_status": branch.review_status,
                "evidence": evidence,
            }
        )
    return {
        "id": scenario.id,
        "slug": scenario.slug,
        "name": scenario.name,
        "summary": scenario.summary,
        "domain": scenario.domain,
        "review_status": scenario.review_status,
        "branches": branches,
    }


def _get_snapshot_row(
    session: Session, snapshot_id: str
) -> tuple[ContentItem, ContentSnapshot]:
    row = session.execute(
        select(ContentItem, ContentSnapshot)
        .join(ContentSnapshot, ContentSnapshot.content_item_id == ContentItem.id)
        .where(ContentSnapshot.id == snapshot_id)
    ).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="snapshot not found")
    return row[0], row[1]


def _get_content_item(session: Session, item_id: str) -> ContentItem:
    item = session.get(ContentItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="content item not found")
    return item


def create_app(
    *,
    database: Database | None = None,
    seed_local_data: bool = False,
    seed_path: Path | None = None,
) -> FastAPI:
    settings = Settings()
    app = FastAPI(title="Decision Knowledge Workspace")
    app_database = database or Database(settings.database_url)
    app.state.database = app_database

    if seed_local_data:
        if app_database.is_sqlite:
            app_database.create_schema()
        if seed_path and seed_path.exists():
            import_jsonl(app_database, seed_path)

    web_root = Path(__file__).resolve().parents[1] / "web"
    app.mount("/assets", StaticFiles(directory=web_root), name="assets")

    def get_session() -> Iterator[Session]:
        with app_database.session() as session:
            yield session

    @app.get("/", include_in_schema=False)
    def user_page() -> FileResponse:
        return FileResponse(web_root / "user.html")

    @app.get("/admin", include_in_schema=False)
    @app.get("/admin/", include_in_schema=False)
    def admin_page() -> FileResponse:
        return FileResponse(web_root / "admin.html")

    @app.get("/health")
    def health(session: Annotated[Session, Depends(get_session)]) -> dict[str, str]:
        session.execute(text("SELECT 1"))
        return {"status": "ok", "database": "ok"}

    @app.get("/api/overview", response_model=WorkspaceOverview)
    def overview(session: Annotated[Session, Depends(get_session)]) -> WorkspaceOverview:
        def count(model: type[object]) -> int:
            return session.scalar(select(func.count()).select_from(model)) or 0

        scenarios_count = count(DecisionScenario)
        confirmed_count = session.scalar(
            select(func.count())
            .select_from(DecisionScenario)
            .where(DecisionScenario.review_status == "CONFIRMED")
        ) or 0
        unreviewed_count = session.scalar(
            select(func.count())
            .select_from(ContentSnapshot)
            .where(ContentSnapshot.review_status == "UNREVIEWED")
        ) or 0
        semantic_status = "已建立情景" if confirmed_count else "待归类"
        if scenarios_count and not confirmed_count:
            semantic_status = "待审核"
        return WorkspaceOverview(
            content_items=count(ContentItem),
            snapshots=count(ContentSnapshot),
            raw_envelopes=count(RawEnvelope),
            scenarios=scenarios_count,
            branches=count(DecisionBranch),
            confirmed_scenarios=confirmed_count,
            unreviewed_snapshots=unreviewed_count,
            semantic_status=semantic_status,
        )

    @app.post("/v1/source-records:batch", response_model=IngestBatchResult)
    def ingest_source_records(
        request: SourceRecordBatchRequest,
        session: Annotated[Session, Depends(get_session)],
    ) -> IngestBatchResult:
        from decision_knowledge.contracts.source_record import SourceRecordV1

        records = tuple(SourceRecordV1.model_validate(record) for record in request.records)
        return SourceIngestion(session).ingest_batch(records)

    @app.get("/api/search", response_model=SearchResponse)
    def search(
        session: Annotated[Session, Depends(get_session)],
        q: str = Query(default="", max_length=200),
        limit: int = Query(default=20, ge=1, le=100),
    ) -> SearchResponse:
        conditions = [ContentItem.availability != Availability.DELETED.value]
        if q.strip():
            term = f"%{q.strip()}%"
            conditions.append(
                or_(
                    ContentSnapshot.title.ilike(term),
                    ContentSnapshot.body.ilike(term),
                    ContentItem.external_id.ilike(term),
                )
            )
        total = session.scalar(
            select(func.count())
            .select_from(ContentSnapshot)
            .join(ContentItem, ContentSnapshot.content_item_id == ContentItem.id)
            .where(*conditions)
        ) or 0
        rows = session.execute(
            select(ContentItem, ContentSnapshot)
            .join(ContentSnapshot, ContentSnapshot.content_item_id == ContentItem.id)
            .where(*conditions)
            .order_by(ContentSnapshot.captured_at.desc())
            .limit(limit)
        ).all()
        return SearchResponse(
            query=q,
            total=total,
            items=tuple(_summary(item, snapshot) for item, snapshot in rows),
        )

    @app.get("/api/snapshots/{snapshot_id}", response_model=SnapshotDetail)
    def snapshot_detail(
        snapshot_id: str,
        session: Annotated[Session, Depends(get_session)],
    ) -> SnapshotDetail:
        item, snapshot = _get_snapshot_row(session, snapshot_id)
        if item.availability == Availability.DELETED.value:
            raise HTTPException(status_code=404, detail="snapshot not available")
        envelope = session.get(RawEnvelope, snapshot.raw_envelope_id)
        return _detail(item, snapshot, envelope, include_payload=False)

    @app.get("/api/scenarios")
    def scenarios(
        session: Annotated[Session, Depends(get_session)],
        q: str = Query(default="", max_length=200),
    ) -> dict[str, object]:
        stmt = select(DecisionScenario).where(DecisionScenario.review_status == "CONFIRMED")
        if q.strip():
            term = f"%{q.strip()}%"
            stmt = stmt.where(
                or_(DecisionScenario.name.ilike(term), DecisionScenario.summary.ilike(term))
            )
        records = session.scalars(stmt.order_by(DecisionScenario.updated_at.desc())).all()
        return {
            "items": tuple(
                _scenario_dict(record, session, confirmed_only=True) for record in records
            )
        }

    @app.get("/api/scenarios/{scenario_id}")
    def scenario_detail(
        scenario_id: str,
        session: Annotated[Session, Depends(get_session)],
    ) -> dict[str, object]:
        scenario = session.get(DecisionScenario, scenario_id)
        if scenario is None or scenario.review_status != "CONFIRMED":
            raise HTTPException(status_code=404, detail="scenario not found")
        return _scenario_dict(scenario, session, confirmed_only=True)

    @app.get("/api/admin/stats", response_model=AdminStats)
    def admin_stats(session: Annotated[Session, Depends(get_session)]) -> AdminStats:
        def count(model: type[object]) -> int:
            return session.scalar(select(func.count()).select_from(model)) or 0

        confirmed = session.scalar(
            select(func.count())
            .select_from(DecisionScenario)
            .where(DecisionScenario.review_status == "CONFIRMED")
        ) or 0
        return AdminStats(
            content_items=count(ContentItem),
            snapshots=count(ContentSnapshot),
            raw_envelopes=count(RawEnvelope),
            scenarios=count(DecisionScenario),
            branches=count(DecisionBranch),
            confirmed_scenarios=confirmed,
        )

    @app.get("/api/admin/content", response_model=SearchResponse)
    def admin_content(
        session: Annotated[Session, Depends(get_session)],
        q: str = Query(default="", max_length=200),
        limit: int = Query(default=100, ge=1, le=200),
    ) -> SearchResponse:
        conditions = []
        if q.strip():
            term = f"%{q.strip()}%"
            conditions.append(
                or_(
                    ContentSnapshot.title.ilike(term),
                    ContentSnapshot.body.ilike(term),
                    ContentItem.external_id.ilike(term),
                )
            )
        total = session.scalar(
            select(func.count())
            .select_from(ContentSnapshot)
            .join(ContentItem, ContentSnapshot.content_item_id == ContentItem.id)
            .where(*conditions)
        ) or 0
        rows = session.execute(
            select(ContentItem, ContentSnapshot)
            .join(ContentSnapshot, ContentSnapshot.content_item_id == ContentItem.id)
            .where(*conditions)
            .order_by(ContentSnapshot.captured_at.desc())
            .limit(limit)
        ).all()
        return SearchResponse(
            query=q,
            total=total,
            items=tuple(_summary(item, snapshot) for item, snapshot in rows),
        )

    @app.get("/api/admin/content/{item_id}", response_model=ContentDetail)
    def admin_content_detail(
        item_id: str,
        session: Annotated[Session, Depends(get_session)],
    ) -> ContentDetail:
        item = _get_content_item(session, item_id)
        snapshots = session.scalars(
            select(ContentSnapshot)
            .where(ContentSnapshot.content_item_id == item.id)
            .order_by(ContentSnapshot.captured_at.desc())
        ).all()
        details = []
        for snapshot in snapshots:
            envelope = session.get(RawEnvelope, snapshot.raw_envelope_id)
            details.append(_detail(item, snapshot, envelope, include_payload=True))
        return ContentDetail(
            item_id=item.id,
            source_code=item.source_code,
            external_id=item.external_id,
            canonical_url=item.canonical_url,
            availability=item.availability,
            snapshots=tuple(details),
        )

    @app.patch("/api/admin/content/{item_id}", response_model=ContentDetail)
    def update_content(
        item_id: str,
        request: ContentUpdate,
        session: Annotated[Session, Depends(get_session)],
    ) -> ContentDetail:
        item = _get_content_item(session, item_id)
        if request.canonical_url is not None:
            item.canonical_url = str(request.canonical_url)
        if request.availability is not None:
            item.availability = request.availability.value
        session.flush()
        return admin_content_detail(item_id, session)

    @app.patch("/api/admin/snapshots/{snapshot_id}", response_model=SnapshotDetail)
    def review_snapshot(
        snapshot_id: str,
        request: SnapshotReviewUpdate,
        session: Annotated[Session, Depends(get_session)],
    ) -> SnapshotDetail:
        item, snapshot = _get_snapshot_row(session, snapshot_id)
        snapshot.review_status = request.review_status
        snapshot.review_note = request.review_note
        session.flush()
        envelope = session.get(RawEnvelope, snapshot.raw_envelope_id)
        return _detail(item, snapshot, envelope, include_payload=True)

    @app.post("/api/admin/import", response_model=IngestBatchResult)
    def admin_import(
        request: SourceRecordBatchRequest,
        session: Annotated[Session, Depends(get_session)],
    ) -> IngestBatchResult:
        from decision_knowledge.contracts.source_record import SourceRecordV1

        records = tuple(SourceRecordV1.model_validate(record) for record in request.records)
        return SourceIngestion(session).ingest_batch(records)

    @app.get("/api/admin/scenarios")
    def admin_scenarios(
        session: Annotated[Session, Depends(get_session)],
    ) -> dict[str, object]:
        records = session.scalars(
            select(DecisionScenario).order_by(DecisionScenario.updated_at.desc())
        ).all()
        return {
            "items": tuple(
                _scenario_dict(record, session, confirmed_only=False) for record in records
            )
        }

    @app.post("/api/admin/scenarios")
    def create_scenario(
        request: ScenarioCreate,
        session: Annotated[Session, Depends(get_session)],
    ) -> dict[str, object]:
        scenario = DecisionScenario(**request.model_dump())
        session.add(scenario)
        session.flush()
        return _scenario_dict(scenario, session, confirmed_only=False)

    @app.patch("/api/admin/scenarios/{scenario_id}")
    def update_scenario(
        scenario_id: str,
        request: ScenarioUpdate,
        session: Annotated[Session, Depends(get_session)],
    ) -> dict[str, object]:
        scenario = session.get(DecisionScenario, scenario_id)
        if scenario is None:
            raise HTTPException(status_code=404, detail="scenario not found")
        for field, value in request.model_dump(exclude_unset=True).items():
            setattr(scenario, field, value)
        session.flush()
        return _scenario_dict(scenario, session, confirmed_only=False)

    @app.post("/api/admin/scenarios/{scenario_id}/branches")
    def create_branch(
        scenario_id: str,
        request: BranchCreate,
        session: Annotated[Session, Depends(get_session)],
    ) -> dict[str, object]:
        scenario = session.get(DecisionScenario, scenario_id)
        if scenario is None:
            raise HTTPException(status_code=404, detail="scenario not found")
        if request.source_snapshot_id:
            _get_snapshot_row(session, request.source_snapshot_id)
        branch = DecisionBranch(scenario_id=scenario.id, **request.model_dump())
        session.add(branch)
        session.flush()
        return _scenario_dict(scenario, session, confirmed_only=False)

    @app.patch("/api/admin/branches/{branch_id}")
    def update_branch(
        branch_id: str,
        request: BranchUpdate,
        session: Annotated[Session, Depends(get_session)],
    ) -> dict[str, object]:
        branch = session.get(DecisionBranch, branch_id)
        if branch is None:
            raise HTTPException(status_code=404, detail="branch not found")
        if request.source_snapshot_id:
            _get_snapshot_row(session, request.source_snapshot_id)
        for field, value in request.model_dump(exclude_unset=True).items():
            setattr(branch, field, value)
        session.flush()
        return _scenario_dict(branch.scenario, session, confirmed_only=False)

    return app
