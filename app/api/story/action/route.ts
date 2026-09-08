import { NextResponse } from "next/server";
import type { ChapterChoice, ChapterDecision } from "@/lib/domain/chapter";
import type { ChapterSpan } from "@/lib/domain/shared";
import type { SceneChoiceRequest, ScenePackage, SceneSaveProjection } from "@/lib/domain/scene";
import type { WorldState } from "@/lib/domain/world";
import { applySceneChoice, SceneChoiceServiceError } from "@/lib/game/scene-choice-service";
import {
  chapterSimulationInputFingerprint,
  runChapterSimulation,
  type ChapterSimulationInput,
} from "@/lib/game/chapter-simulation-service";
import { createStoryInputFingerprint } from "@/lib/game/story-input";
import { normalizeSceneActionContext } from "@/lib/game/scene-action-context";
import { ExecutionBudget } from "@/lib/game/execution-budget";
import { generationFailure } from "@/lib/game/generation-error";
import { prepareLifeStoryUnit } from "@/lib/game/story-generation";
import type { StoryUnit } from "@/lib/domain/story";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 225;

type StoryActionBody = {
  actionKind: "scene_choice" | "chapter_decision";
  requestId: string;
  inputFingerprint?: string;
  projection?: SceneSaveProjection;
  package?: ScenePackage;
  expectedRevision?: number;
  issuedAt?: string;
  choiceId?: "A" | "B" | "C";
  worldState?: WorldState;
  choice?: ChapterChoice;
  selection?: ChapterSimulationInput["selection"];
  span?: ChapterSpan;
  usedExperienceIds?: string[];
  sceneActionContext?: unknown;
  executionId?: string;
  branchId?: string;
  prepareUnit?: boolean;
  requiredEventIds?: string[];
  nextUnitId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requestIdFor(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new Error("requestId 无效");
}

function parseBody(value: unknown): StoryActionBody {
  if (!isRecord(value)) throw new Error("请求正文不是对象");
  if (value.actionKind !== "scene_choice" && value.actionKind !== "chapter_decision") {
    throw new Error("actionKind 无效");
  }
  const requestId = requestIdFor(value.requestId);
  if (value.actionKind === "scene_choice") {
    if (!isRecord(value.projection) || !isRecord(value.package)) throw new Error("场景行动缺少 projection 或 package");
    if (typeof value.issuedAt !== "string" || !value.issuedAt.trim()) throw new Error("issuedAt 无效");
    if (!Number.isInteger(value.expectedRevision) || (value.expectedRevision as number) < 0) throw new Error("expectedRevision 无效");
    if (value.choiceId !== "A" && value.choiceId !== "B" && value.choiceId !== "C") throw new Error("choiceId 无效");
    return {
      actionKind: "scene_choice",
      requestId,
      projection: value.projection as unknown as SceneSaveProjection,
      package: value.package as unknown as ScenePackage,
      issuedAt: value.issuedAt,
      expectedRevision: value.expectedRevision as number,
      choiceId: value.choiceId,
      ...(typeof value.inputFingerprint === "string" ? { inputFingerprint: value.inputFingerprint } : {}),
    };
  }
  if (!isRecord(value.worldState) || !isRecord(value.choice) || !isRecord(value.selection)) {
    throw new Error("年度行动缺少 worldState、choice 或 selection");
  }
  if (value.span !== 1 && value.span !== 3) throw new Error("span 必须是 1 或 3");
  return {
    actionKind: "chapter_decision",
    requestId,
    worldState: value.worldState as unknown as WorldState,
    choice: value.choice as unknown as ChapterChoice,
    selection: value.selection as ChapterSimulationInput["selection"],
    span: value.span as ChapterSpan,
    usedExperienceIds: Array.isArray(value.usedExperienceIds)
      ? value.usedExperienceIds.filter((item): item is string => typeof item === "string")
      : [],
    sceneActionContext: value.sceneActionContext,
    executionId: typeof value.executionId === "string" && value.executionId.trim() ? value.executionId.trim() : requestId,
    branchId: typeof value.branchId === "string" && value.branchId.trim() ? value.branchId.trim() : "main",
    prepareUnit: value.prepareUnit === true,
    ...(Array.isArray(value.requiredEventIds) ? {
      requiredEventIds: value.requiredEventIds.filter((item): item is string => typeof item === "string" && Boolean(item.trim())),
    } : {}),
    ...(typeof value.nextUnitId === "string" && value.nextUnitId.trim() ? { nextUnitId: value.nextUnitId.trim() } : {}),
    ...(typeof value.inputFingerprint === "string" ? { inputFingerprint: value.inputFingerprint } : {}),
  };
}

function sceneInputFingerprint(body: StoryActionBody): string {
  const projection = body.projection!;
  return createStoryInputFingerprint({
    source: "life_ai",
    saveId: projection.worldState.gameId,
    runId: projection.worldState.gameId,
    branchId: projection.activeBranchId ?? projection.runtime.branchId,
    pipelineVersion: 2,
    unitId: `${projection.runtime.packageId}:${projection.runtime.sceneId}:${projection.runtime.blockId}`,
    facts: {
      revision: projection.revision,
      packageId: body.package!.id,
      packageVersion: body.package!.version,
      choiceId: body.choiceId,
      requestKind: "scene_choice",
    },
  });
}

function eventLine(event: string, payload: Record<string, unknown>, seq: number): string {
  return `event: ${event}\ndata: ${JSON.stringify({ seq, ...payload })}\n\n`;
}

function errorMessage(error: unknown): { code: string; message: string } {
  if (error instanceof SceneChoiceServiceError) return { code: error.code, message: error.message };
  const failure = generationFailure(error);
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : `STORY_ACTION_${failure.category.toUpperCase()}`;
  return { code, message: failure.message || "故事行动失败，请稍后重试" };
}

function chapterContextForUnit(body: StoryActionBody, result: Awaited<ReturnType<typeof runChapterSimulation>>): {
  id: string;
  index: number;
  startYear: number;
  endYear: number;
  span: ChapterSpan;
  decision: ChapterDecision;
  summary: {
    keyEvents: string[];
    characterChanges: string[];
    relationshipChanges: string[];
    openThreads: string[];
  };
} {
  const choice = body.choice!;
  const selection = body.selection!;
  const option = choice.options.find((item) => item.id === selection.optionId);
  const normalizedAction = selection.optionId === "CUSTOM"
    ? (selection.customAction ?? "").trim()
    : (option?.label ?? "").trim();
  const sceneActionContext = normalizeSceneActionContext(body.sceneActionContext ?? choice.sceneActionContext);
  return {
    id: result.chapterId,
    index: body.worldState!.chapterIds.length,
    startYear: body.worldState!.currentYear,
    endYear: result.worldStateAfter.currentYear,
    span: body.span!,
    decision: {
      id: choice.id,
      promptTitle: choice.promptTitle,
      context: choice.context,
      options: choice.options,
      selectedOptionId: selection.optionId,
      customAction: selection.customAction,
      normalizedAction,
      ...(sceneActionContext.length ? { sceneActionContext } : {}),
    },
    summary: {
      keyEvents: result.simulation.chapterSummary.keyEvents,
      characterChanges: result.simulation.chapterSummary.characterChanges,
      relationshipChanges: result.simulation.chapterSummary.relationshipChanges,
      openThreads: result.worldStateAfter.openThreads
        .filter((thread) => thread.status === "open")
        .map((thread) => thread.label),
    },
  };
}

export async function POST(request: Request) {
  let body: StoryActionBody;
  try {
    body = parseBody(await request.json());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "请求正文无效" }, { status: 400 });
  }

  const requestId = body.requestId;
  const inputFingerprint = body.actionKind === "scene_choice"
    ? sceneInputFingerprint(body)
    : chapterSimulationInputFingerprint({
        worldState: body.worldState!,
        choice: body.choice!,
        selection: body.selection!,
        span: body.span!,
        usedExperienceIds: body.usedExperienceIds,
        sceneActionContext: body.sceneActionContext,
        executionId: body.executionId,
        branchId: body.branchId,
      });
  if (body.inputFingerprint && inputFingerprint && body.inputFingerprint !== inputFingerprint) {
    return NextResponse.json({ error: "故事行动事实指纹不匹配" }, { status: 409 });
  }

  const executionId = body.actionKind === "chapter_decision"
    ? body.executionId ?? requestId
    : requestId;
  const budget = body.actionKind === "chapter_decision"
    ? new ExecutionBudget({
        executionId,
        timeoutMs: 225_000,
        maxRequests: 4,
        phaseLimits: { annual: 2, interactive: 2 },
        phaseTimeoutsMs: { annual: 180_000, interactive: 45_000 },
        signal: request.signal,
      })
    : undefined;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let seq = 0;
      let closed = false;
      let canonicalCommittedResult: Awaited<ReturnType<typeof runChapterSimulation>> | undefined;
      const send = (event: string, payload: Record<string, unknown> = {}) => {
        if (closed || budget?.signal.aborted) return;
        seq += 1;
        try {
          controller.enqueue(encoder.encode(eventLine(event, { requestId, ...(inputFingerprint ? { inputFingerprint } : {}), ...payload }, seq)));
        } catch {
          closed = true;
          budget?.abort("stream-closed");
        }
      };
      void (async () => {
        send("accepted", { actionKind: body.actionKind });
        try {
          if (body.actionKind === "scene_choice") {
            const response = applySceneChoice({
              projection: body.projection!,
              package: body.package!,
              requestId,
              issuedAt: body.issuedAt!,
              expectedRevision: body.expectedRevision!,
              choiceId: body.choiceId!,
            });
            send("canonical_committed", { response });
            send("complete", { response, replayed: response.replayed });
            return;
          }
          const result = await runChapterSimulation({
            worldState: body.worldState!,
            choice: body.choice!,
            selection: body.selection!,
            span: body.span!,
            usedExperienceIds: body.usedExperienceIds,
            sceneActionContext: body.sceneActionContext,
            executionId: body.executionId,
            branchId: body.branchId,
          }, {
            ...(budget ? { budget } : {}),
            signal: request.signal,
            onProgress: (progress) => send("heartbeat", progress),
          });
          canonicalCommittedResult = result;
          send("canonical_committed", {
            committed: true,
            executionId: result.executionId,
            requestCount: result.requestCount,
            elapsedMs: result.elapsedMs,
            result,
          });
          if (body.prepareUnit) {
            send("heartbeat", { stage: "preparing", message: "年度结果已保存，正在衔接第一段互动" });
            const unit = await prepareLifeStoryUnit({
              world: result.worldStateAfter,
              events: result.simulation.events,
              chapter: chapterContextForUnit(body, result),
              saveId: result.worldStateAfter.gameId,
              runId: result.worldStateAfter.gameId,
              branchId: body.branchId ?? "main",
              unitId: `chapter-${result.chapterId}-unit-1`,
              requiredEventIds: result.simulation.events.map((event) => event.id),
              isFinalUnit: false,
              nextUnitId: `chapter-${result.chapterId}-unit-2`,
              budget,
              signal: request.signal,
            });
            if (unit.payload.kind !== "scene") throw new Error("互动单元不是可播放场景");
            send("unit_ready", { unit: unit as StoryUnit });
            send("complete", { result, unit, executionId: result.executionId });
          } else {
            send("complete", { result, executionId: result.executionId });
          }
        } catch (error) {
          const mapped = errorMessage(error);
          send("error", {
            ...mapped,
            executionId,
            committed: Boolean(canonicalCommittedResult),
            ...(canonicalCommittedResult ? { result: canonicalCommittedResult } : {}),
          });
        }
      })().finally(() => {
        closed = true;
        budget?.dispose();
        try { controller.close(); } catch { /* stream already closed */ }
      });
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
