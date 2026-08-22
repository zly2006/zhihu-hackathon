import hashlib
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

from decision_knowledge.analysis.retrieval import retrieve_candidate_embeddings
from decision_knowledge.contracts.source_record import Availability
from decision_knowledge.db import Database
from decision_knowledge.ingest.bootstrap import import_jsonl
from decision_knowledge.ingest.models import (
    ContentItem,
    ContentSnapshot,
    DecisionBranch,
    DecisionBranchMembership,
    DecisionEpisodeCandidate,
    DecisionScenario,
    DecisionScenarioMembership,
    DiscoveryRun,
    KeywordCandidate,
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
    adapter_code: str
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
    discovery_runs: int
    keyword_candidates: int
    decision_candidates: int


class WorkspaceOverview(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    content_items: int
    snapshots: int
    raw_envelopes: int
    discovery_runs: int
    keyword_candidates: int
    decision_candidates: int
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


class CandidateReviewUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    review_status: str = Field(min_length=1, max_length=32)
    review_note: str | None = Field(default=None, max_length=8_000)


class CandidateRetrievalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    embedding_version: str = Field(min_length=1, max_length=128)
    vector: tuple[float, ...] = Field(min_length=1, max_length=4096)
    blocking_key: str | None = Field(default=None, max_length=64)
    limit: int = Field(default=10, ge=1, le=100)


class MembershipReviewUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    review_status: str = Field(min_length=1, max_length=32)


def _body_preview(body: str, length: int = 220) -> str:
    plain = re.sub(r"<[^>]+>", " ", body)
    return " ".join(plain.split())[:length]


def _summary(
    item: ContentItem,
    snapshot: ContentSnapshot,
    envelope: RawEnvelope | None,
) -> SnapshotSummary:
    return SnapshotSummary(
        item_id=item.id,
        snapshot_id=snapshot.id,
        source_code=item.source_code,
        adapter_code=envelope.adapter_code if envelope else "unknown",
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
        **_summary(item, snapshot, envelope).model_dump(),
        body=snapshot.body,
        raw_html=snapshot.raw_html,
        raw_sha256=envelope.payload_hash if envelope else None,
        raw_payload=envelope.payload if include_payload and envelope else None,
    )


def _decision_candidate_dict(
    candidate: DecisionEpisodeCandidate,
    session: Session,
) -> dict[str, object]:
    snapshot = session.get(ContentSnapshot, candidate.content_snapshot_id)
    item = session.get(ContentItem, snapshot.content_item_id) if snapshot else None
    return {
        "id": candidate.id,
        "snapshot_id": candidate.content_snapshot_id,
        "title": snapshot.title if snapshot else "",
        "canonical_url": item.canonical_url if item else "",
        "analysis_version": candidate.analysis_version,
        "context": candidate.context,
        "decision": candidate.decision,
        "action": candidate.action,
        "outcome": candidate.outcome,
        "confidence": candidate.confidence,
        "evidence": candidate.evidence,
        "review_status": candidate.review_status,
        "review_note": candidate.review_note,
    }


_SCENE_DOMAINS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "职业与工作",
        (
            "工作", "职业", "职场", "岗位", "就业", "转行", "公司",
            "上班", "跳槽", "创业", "公务员", "国企",
        ),
    ),
    (
        "教育与学习",
        ("考研", "读研", "留学", "学校", "专业", "学习", "教育", "读博", "高考"),
    ),
    (
        "财务与住房",
        ("买房", "房贷", "租房", "投资", "理财", "存钱", "收入", "保险", "财务", "贷款"),
    ),
    (
        "关系与家庭",
        ("恋爱", "婚姻", "结婚", "家庭", "夫妻", "生育", "孩子", "父母", "养老"),
    ),
    ("成长与生活", ("成长", "健康", "时间", "生活", "习惯", "目标", "选择")),
)


def _scene_domain(text: str) -> str:
    for domain, terms in _SCENE_DOMAINS:
        if any(term in text for term in terms):
            return domain
    return "其他"


def _scene_id(name: str) -> str:
    return f"scene-{hashlib.sha1(name.encode('utf-8')).hexdigest()[:16]}"


def _clip(value: str | None, length: int = 180) -> str:
    return " ".join((value or "").split())[:length]


def _as_int(value: object) -> int:
    if isinstance(value, int):
        return value
    if isinstance(value, (float, str)):
        return int(value)
    return 0


def _decision_view_dict(
    candidate: DecisionEpisodeCandidate,
    snapshot: ContentSnapshot,
    item: ContentItem,
    envelope: RawEnvelope | str | None,
) -> dict[str, object]:
    adapter_code = (
        envelope.adapter_code
        if isinstance(envelope, RawEnvelope)
        else envelope or "unknown"
    )
    return {
        "id": candidate.id,
        "snapshot_id": candidate.content_snapshot_id,
        "title": snapshot.title,
        "canonical_url": item.canonical_url,
        "source_code": item.source_code,
        "external_id": item.external_id,
        "adapter_code": adapter_code,
        "captured_at": snapshot.captured_at.isoformat(),
        "body_preview": _body_preview(snapshot.body, 260),
        "analysis_version": candidate.analysis_version,
        "context": candidate.context,
        "decision": candidate.decision,
        "action": candidate.action,
        "outcome": candidate.outcome,
        "confidence": candidate.confidence,
        "evidence": candidate.evidence,
        "review_status": candidate.review_status,
        "review_note": candidate.review_note,
        "has_raw_html": bool(snapshot.raw_html),
    }


def _discovery_query_dicts(session: Session, limit: int) -> list[dict[str, object]]:
    rows = session.execute(
        select(KeywordCandidate, ContentSnapshot)
        .join(ContentSnapshot, ContentSnapshot.id == KeywordCandidate.content_snapshot_id)
        .where(KeywordCandidate.status == "CANDIDATE")
    ).all()
    source_queries = {
        candidate.source_query.strip()
        for candidate, _ in rows
        if candidate.source_query.strip()
    }
    grouped: dict[str, dict[str, object]] = {}
    for candidate, snapshot in rows:
        term = candidate.term.strip()
        if not term or term in source_queries:
            continue
        entry = grouped.setdefault(
            term,
            {
                "term": term,
                "occurrences": 0,
                "best_quality_score": 0,
                "rounds": set(),
                "sample_titles": [],
                "source_queries": set(),
                "run_ids": set(),
            },
        )
        occurrences = entry["occurrences"]
        best_quality_score = entry["best_quality_score"]
        entry["occurrences"] = (occurrences if isinstance(occurrences, int) else 0) + 1
        entry["best_quality_score"] = max(
            best_quality_score if isinstance(best_quality_score, int) else 0,
            candidate.quality_score,
        )
        rounds = entry["rounds"]
        if isinstance(rounds, set):
            rounds.add(candidate.discovery_round)
        titles = entry["sample_titles"]
        if isinstance(titles, list) and snapshot.title not in titles and len(titles) < 3:
            titles.append(snapshot.title)
        queries = entry["source_queries"]
        if isinstance(queries, set) and candidate.source_query:
            queries.add(candidate.source_query)
        run_ids = entry["run_ids"]
        if isinstance(run_ids, set) and candidate.discovery_run_id:
            run_ids.add(candidate.discovery_run_id)
    ranked = sorted(
        grouped.values(),
        key=lambda entry: (
            -(entry["occurrences"] if isinstance(entry["occurrences"], int) else 0),
            -(
                entry["best_quality_score"]
                if isinstance(entry["best_quality_score"], int)
                else 0
            ),
            len(str(entry["term"])),
            str(entry["term"]),
        ),
    )
    for entry in ranked:
        rounds = entry["rounds"]
        entry["rounds"] = sorted(rounds) if isinstance(rounds, set) else []
        query_values = entry["source_queries"]
        entry["source_queries"] = sorted(query_values) if isinstance(query_values, set) else []
        run_values = entry["run_ids"]
        entry["run_ids"] = sorted(run_values) if isinstance(run_values, set) else []
    return ranked[:limit]


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
                "memberships": tuple(
                    {
                        "id": membership.id,
                        "candidate_id": membership.candidate_id,
                        "similarity": round(membership.similarity, 6),
                        "review_status": membership.review_status,
                    }
                    for membership in sorted(
                        branch.memberships,
                        key=lambda item: (-item.similarity, item.candidate_id),
                    )
                ),
            }
        )
    memberships: list[dict[str, object]] = []
    for membership in sorted(
        scenario.memberships,
        key=lambda item: (-item.similarity, item.candidate_id),
    ):
        candidate = membership.candidate
        membership_source: dict[str, object] | None = None
        if candidate is not None:
            snapshot = session.get(ContentSnapshot, candidate.content_snapshot_id)
            if snapshot is not None:
                item = session.get(ContentItem, snapshot.content_item_id)
                membership_source = {
                    "snapshot_id": snapshot.id,
                    "title": snapshot.title,
                    "canonical_url": item.canonical_url if item else "",
                }
        memberships.append(
            {
                "id": membership.id,
                "candidate_id": membership.candidate_id,
                "similarity": round(membership.similarity, 6),
                "review_status": membership.review_status,
                "algorithm_version": membership.algorithm_version,
                "embedding_version": membership.embedding_version,
                "context": candidate.context if candidate else "",
                "decision": candidate.decision if candidate else "",
                "action": candidate.action if candidate else "",
                "outcome": candidate.outcome if candidate else "",
                "source": membership_source,
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
        "memberships": memberships,
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

        scenarios_count = session.scalar(
            select(func.count())
            .select_from(DecisionScenario)
            .where(DecisionScenario.review_status != "SUPERSEDED")
        ) or 0
        branches_count = session.scalar(
            select(func.count())
            .select_from(DecisionBranch)
            .where(DecisionBranch.review_status != "SUPERSEDED")
        ) or 0
        discovery_runs_count = count(DiscoveryRun)
        keyword_candidates_count = count(KeywordCandidate)
        decision_candidates_count = count(DecisionEpisodeCandidate)
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
        elif decision_candidates_count:
            semantic_status = "候选待审核"
        return WorkspaceOverview(
            content_items=count(ContentItem),
            snapshots=count(ContentSnapshot),
            raw_envelopes=count(RawEnvelope),
            discovery_runs=discovery_runs_count,
            keyword_candidates=keyword_candidates_count,
            decision_candidates=decision_candidates_count,
            scenarios=scenarios_count,
            branches=branches_count,
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
            select(ContentItem, ContentSnapshot, RawEnvelope)
            .join(ContentSnapshot, ContentSnapshot.content_item_id == ContentItem.id)
            .join(RawEnvelope, ContentSnapshot.raw_envelope_id == RawEnvelope.id)
            .where(*conditions)
            .order_by(ContentSnapshot.captured_at.desc())
            .limit(limit)
        ).all()
        return SearchResponse(
            query=q,
            total=total,
            items=tuple(_summary(item, snapshot, envelope) for item, snapshot, envelope in rows),
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

    @app.get("/api/scene-view")
    def scene_view(
        session: Annotated[Session, Depends(get_session)],
        q: str = Query(default="", max_length=200),
        domain: str = Query(default="", max_length=32),
        limit: int = Query(default=48, ge=1, le=100),
    ) -> dict[str, object]:
        """Return the scene perspective: question titles grouped into candidate paths.

        A group is deliberately called a candidate scene.  It is an evidence-first
        projection of the database, not a confirmed scenario or recommendation.
        """
        conditions = [
            DecisionEpisodeCandidate.review_status != "REJECTED",
            ContentItem.availability != Availability.DELETED.value,
        ]
        if q.strip():
            term = f"%{q.strip()}%"
            conditions.append(
                or_(
                    ContentSnapshot.title.ilike(term),
                    DecisionEpisodeCandidate.context.ilike(term),
                    DecisionEpisodeCandidate.decision.ilike(term),
                    DecisionEpisodeCandidate.action.ilike(term),
                    DecisionEpisodeCandidate.outcome.ilike(term),
                )
            )
        rows = session.execute(
            select(DecisionEpisodeCandidate, ContentSnapshot, ContentItem)
            .join(
                ContentSnapshot,
                ContentSnapshot.id == DecisionEpisodeCandidate.content_snapshot_id,
            )
            .join(ContentItem, ContentItem.id == ContentSnapshot.content_item_id)
            .where(*conditions)
            .order_by(
                DecisionEpisodeCandidate.confidence.desc(),
                DecisionEpisodeCandidate.created_at.desc(),
            )
        ).all()

        groups: dict[str, dict[str, object]] = {}
        for candidate, snapshot, item in rows:
            name = snapshot.title.strip() or f"未命名问题 · {snapshot.id[:8]}"
            group = groups.setdefault(
                name,
                {
                    "id": _scene_id(name),
                    "name": name,
                    "domain": _scene_domain(
                        " ".join(
                            (
                                name,
                                candidate.context,
                                candidate.decision,
                                candidate.action,
                                candidate.outcome,
                            )
                        )
                    ),
                    "status": "待归类",
                    "answer_count": 0,
                    "decision_count": 0,
                    "confidence_total": 0,
                    "paths": [],
                    "_snapshot_ids": set(),
                },
            )
            snapshot_ids = group["_snapshot_ids"]
            if isinstance(snapshot_ids, set):
                snapshot_ids.add(snapshot.id)
            group["decision_count"] = _as_int(group["decision_count"]) + 1
            group["confidence_total"] = _as_int(group["confidence_total"]) + candidate.confidence
            paths = group["paths"]
            if isinstance(paths, list) and len(paths) < 8:
                paths.append(
                    {
                        "candidate_id": candidate.id,
                        "snapshot_id": snapshot.id,
                        "decision": _clip(candidate.decision, 120),
                        "action": _clip(candidate.action, 180),
                        "outcome": _clip(candidate.outcome, 180),
                        "confidence": candidate.confidence,
                        "review_status": candidate.review_status,
                        "canonical_url": item.canonical_url,
                    }
                )

        ranked: list[dict[str, object]] = []
        for group in groups.values():
            snapshot_ids = group.pop("_snapshot_ids", set())
            group["answer_count"] = len(snapshot_ids) if isinstance(snapshot_ids, set) else 0
            count = _as_int(group["decision_count"])
            group["avg_confidence"] = (
                round(_as_int(group["confidence_total"]) / count) if count else 0
            )
            group.pop("confidence_total", None)
            ranked.append(group)
        ranked.sort(
            key=lambda item: (
                -_as_int(item["decision_count"]),
                -_as_int(item["avg_confidence"]),
                str(item["name"]),
            )
        )
        if domain.strip() and domain.strip() != "全部":
            ranked = [item for item in ranked if item["domain"] == domain.strip()]
        formal_count = session.scalar(
            select(func.count())
            .select_from(DecisionScenario)
            .where(DecisionScenario.review_status == "CONFIRMED")
        ) or 0
        candidate_total = session.scalar(
            select(func.count())
            .select_from(DecisionEpisodeCandidate)
            .join(
                ContentSnapshot,
                ContentSnapshot.id == DecisionEpisodeCandidate.content_snapshot_id,
            )
            .join(ContentItem, ContentItem.id == ContentSnapshot.content_item_id)
            .where(*conditions)
        ) or 0
        if domain.strip() and domain.strip() != "全部":
            candidate_total = sum(_as_int(item["decision_count"]) for item in ranked)
        return {
            "query": q,
            "domain": domain,
            "total": len(ranked),
            "candidate_total": candidate_total,
            "formal_scenarios": formal_count,
            "items": ranked[:limit],
        }

    @app.get("/api/decisions")
    def decisions(
        session: Annotated[Session, Depends(get_session)],
        q: str = Query(default="", max_length=200),
        limit: int = Query(default=60, ge=1, le=100),
    ) -> dict[str, object]:
        """Return individual decision candidates with their source trace."""
        conditions = [
            DecisionEpisodeCandidate.review_status != "REJECTED",
            ContentItem.availability != Availability.DELETED.value,
        ]
        if q.strip():
            term = f"%{q.strip()}%"
            conditions.append(
                or_(
                    ContentSnapshot.title.ilike(term),
                    DecisionEpisodeCandidate.context.ilike(term),
                    DecisionEpisodeCandidate.decision.ilike(term),
                    DecisionEpisodeCandidate.action.ilike(term),
                    DecisionEpisodeCandidate.outcome.ilike(term),
                )
            )
        total = session.scalar(
            select(func.count())
            .select_from(DecisionEpisodeCandidate)
            .join(
                ContentSnapshot,
                ContentSnapshot.id == DecisionEpisodeCandidate.content_snapshot_id,
            )
            .join(ContentItem, ContentItem.id == ContentSnapshot.content_item_id)
            .where(*conditions)
        ) or 0
        rows = session.execute(
            select(
                DecisionEpisodeCandidate,
                ContentSnapshot,
                ContentItem,
                RawEnvelope.adapter_code,
            )
            .join(
                ContentSnapshot,
                ContentSnapshot.id == DecisionEpisodeCandidate.content_snapshot_id,
            )
            .join(ContentItem, ContentItem.id == ContentSnapshot.content_item_id)
            .join(RawEnvelope, RawEnvelope.id == ContentSnapshot.raw_envelope_id)
            .where(*conditions)
            .order_by(
                DecisionEpisodeCandidate.confidence.desc(),
                DecisionEpisodeCandidate.created_at.desc(),
            )
            .limit(limit)
        ).all()
        return {
            "query": q,
            "total": total,
            "items": tuple(
                _decision_view_dict(candidate, snapshot, item, envelope)
                for candidate, snapshot, item, envelope in rows
            ),
        }

    @app.get("/api/decisions/{candidate_id}")
    def decision_detail(
        candidate_id: str,
        session: Annotated[Session, Depends(get_session)],
    ) -> dict[str, object]:
        candidate = session.get(DecisionEpisodeCandidate, candidate_id)
        if candidate is None or candidate.review_status == "REJECTED":
            raise HTTPException(status_code=404, detail="decision candidate not found")
        item, snapshot = _get_snapshot_row(session, candidate.content_snapshot_id)
        if item.availability == Availability.DELETED.value:
            raise HTTPException(status_code=404, detail="source not available")
        envelope = session.get(RawEnvelope, snapshot.raw_envelope_id)
        return {
            "decision": _decision_view_dict(candidate, snapshot, item, envelope),
            "source": _detail(item, snapshot, envelope, include_payload=False).model_dump(),
        }

    @app.post("/api/retrieval/candidates")
    def retrieve_candidates(
        request: CandidateRetrievalRequest,
        session: Annotated[Session, Depends(get_session)],
    ) -> dict[str, object]:
        """Recall candidates only; scenario membership still needs review."""

        try:
            hits = retrieve_candidate_embeddings(
                session,
                request.vector,
                embedding_version=request.embedding_version,
                blocking_key=request.blocking_key,
                limit=request.limit,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        items: list[dict[str, object]] = []
        for hit in hits:
            candidate = session.get(DecisionEpisodeCandidate, hit.candidate_id)
            source: dict[str, object] | None = None
            if candidate is not None:
                snapshot = session.get(ContentSnapshot, candidate.content_snapshot_id)
                if snapshot is not None:
                    item = session.get(ContentItem, snapshot.content_item_id)
                    source = {
                        "snapshot_id": snapshot.id,
                        "title": snapshot.title,
                        "canonical_url": item.canonical_url if item else "",
                    }
            items.append(
                {
                    "candidate_id": hit.candidate_id,
                    "score": round(hit.score, 6),
                    "scenario_text": hit.scenario_text,
                    "blocking_key": hit.blocking_key,
                    "context": hit.context,
                    "decision": hit.decision,
                    "action": hit.action,
                    "outcome": hit.outcome,
                    "confidence": hit.confidence,
                    "review_status": hit.review_status,
                    "source": source,
                }
            )
        return {
            "embedding_version": request.embedding_version,
            "blocking_key": request.blocking_key,
            "items": tuple(items),
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
        active_scenarios = session.scalar(
            select(func.count())
            .select_from(DecisionScenario)
            .where(DecisionScenario.review_status != "SUPERSEDED")
        ) or 0
        active_branches = session.scalar(
            select(func.count())
            .select_from(DecisionBranch)
            .where(DecisionBranch.review_status != "SUPERSEDED")
        ) or 0
        return AdminStats(
            content_items=count(ContentItem),
            snapshots=count(ContentSnapshot),
            raw_envelopes=count(RawEnvelope),
            scenarios=active_scenarios,
            branches=active_branches,
            confirmed_scenarios=confirmed,
            discovery_runs=count(DiscoveryRun),
            keyword_candidates=count(KeywordCandidate),
            decision_candidates=count(DecisionEpisodeCandidate),
        )

    @app.get("/api/admin/discovery/queries")
    def admin_discovery_queries(
        session: Annotated[Session, Depends(get_session)],
        limit: int = Query(default=20, ge=1, le=100),
    ) -> dict[str, object]:
        """Rank next queries from accepted answer evidence, not raw volume alone."""

        return {"items": tuple(_discovery_query_dicts(session, limit))}

    @app.get("/api/admin/discovery/runs")
    def admin_discovery_runs(
        session: Annotated[Session, Depends(get_session)],
        limit: int = Query(default=20, ge=1, le=100),
    ) -> dict[str, object]:
        runs = session.scalars(
            select(DiscoveryRun).order_by(DiscoveryRun.started_at.desc()).limit(limit)
        ).all()
        return {
            "items": tuple(
                {
                    "id": run.id,
                    "source_code": run.source_code,
                    "adapter_code": run.adapter_code,
                    "authorization_ref": run.authorization_ref,
                    "seed_queries": run.seed_queries,
                    "started_at": run.started_at.isoformat(),
                    "last_seen_at": run.last_seen_at.isoformat(),
                    "status": run.status,
                }
                for run in runs
            )
        }

    @app.get("/api/admin/decision-candidates")
    def admin_decision_candidates(
        session: Annotated[Session, Depends(get_session)],
        review_status: str | None = Query(default=None, max_length=32),
        limit: int = Query(default=50, ge=1, le=200),
    ) -> dict[str, object]:
        stmt = select(DecisionEpisodeCandidate).order_by(
            DecisionEpisodeCandidate.created_at.desc()
        )
        if review_status:
            stmt = stmt.where(DecisionEpisodeCandidate.review_status == review_status)
        records = session.scalars(stmt.limit(limit)).all()
        return {
            "items": tuple(_decision_candidate_dict(record, session) for record in records)
        }

    @app.patch("/api/admin/decision-candidates/{candidate_id}")
    def review_decision_candidate(
        candidate_id: str,
        request: CandidateReviewUpdate,
        session: Annotated[Session, Depends(get_session)],
    ) -> dict[str, object]:
        candidate = session.get(DecisionEpisodeCandidate, candidate_id)
        if candidate is None:
            raise HTTPException(status_code=404, detail="decision candidate not found")
        candidate.review_status = request.review_status
        candidate.review_note = request.review_note
        session.flush()
        return _decision_candidate_dict(candidate, session)

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
            select(ContentItem, ContentSnapshot, RawEnvelope)
            .join(ContentSnapshot, ContentSnapshot.content_item_id == ContentItem.id)
            .join(RawEnvelope, ContentSnapshot.raw_envelope_id == RawEnvelope.id)
            .where(*conditions)
            .order_by(ContentSnapshot.captured_at.desc())
            .limit(limit)
        ).all()
        return SearchResponse(
            query=q,
            total=total,
            items=tuple(_summary(item, snapshot, envelope) for item, snapshot, envelope in rows),
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
        include_superseded: bool = Query(default=False),
    ) -> dict[str, object]:
        stmt = select(DecisionScenario)
        if not include_superseded:
            stmt = stmt.where(DecisionScenario.review_status != "SUPERSEDED")
        records = session.scalars(stmt.order_by(DecisionScenario.updated_at.desc())).all()
        return {
            "items": tuple(
                _scenario_dict(record, session, confirmed_only=False) for record in records
            )
        }

    @app.get("/api/admin/scenario-proposals")
    def admin_scenario_proposals(
        session: Annotated[Session, Depends(get_session)],
        limit: int = Query(default=100, ge=1, le=500),
    ) -> dict[str, object]:
        """List generated proposals separately from confirmed knowledge."""

        records = session.scalars(
            select(DecisionScenario)
            .where(DecisionScenario.review_status == "PROPOSED")
            .order_by(DecisionScenario.updated_at.desc())
            .limit(limit)
        ).all()
        return {
            "items": tuple(
                _scenario_dict(record, session, confirmed_only=False) for record in records
            ),
            "total": len(records),
        }

    @app.patch("/api/admin/scenario-memberships/{membership_id}")
    def review_scenario_membership(
        membership_id: str,
        request: MembershipReviewUpdate,
        session: Annotated[Session, Depends(get_session)],
    ) -> dict[str, object]:
        membership = session.get(DecisionScenarioMembership, membership_id)
        if membership is None:
            raise HTTPException(status_code=404, detail="scenario membership not found")
        membership.review_status = request.review_status
        session.flush()
        return _scenario_dict(membership.scenario, session, confirmed_only=False)

    @app.patch("/api/admin/branch-memberships/{membership_id}")
    def review_branch_membership(
        membership_id: str,
        request: MembershipReviewUpdate,
        session: Annotated[Session, Depends(get_session)],
    ) -> dict[str, object]:
        membership = session.get(DecisionBranchMembership, membership_id)
        if membership is None:
            raise HTTPException(status_code=404, detail="branch membership not found")
        membership.review_status = request.review_status
        session.flush()
        return _scenario_dict(membership.branch.scenario, session, confirmed_only=False)

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
