import type {
  SceneActionRecord,
  SceneChoiceRequest,
  SceneChoiceResponse,
  ScenePackage,
  SceneSaveProjection,
} from "../domain/scene";
import type { WorldSimulationOutput } from "../domain/simulation";
import type { WorldState } from "../domain/world";
import { hashState } from "./hash";
import { validateScenePackage } from "./scene-package-validator";
import { reduceWorldState } from "./world-reducer";
import { resolveSceneChoice, SceneChoiceResolutionError } from "./scene-choice-resolver";
import { validateSceneEvent, SceneEventValidationError } from "./scene-event-validator";
import { transitionSceneRuntime } from "./scene-runtime";

export class SceneChoiceServiceError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly reasons?: unknown;

  constructor(code: string, message: string, retryable = false, reasons?: unknown) {
    super(message);
    this.name = "SceneChoiceServiceError";
    this.code = code;
    this.retryable = retryable;
    this.reasons = reasons;
  }
}

export type SceneChoiceServiceDependencies = {
  now?: string;
  reduceWorldState?: typeof reduceWorldState;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function slotKey(projection: SceneSaveProjection, pkg: ScenePackage): string {
  const branchId = projection.runtime.branchId || projection.activeBranchId || "main";
  return `${branchId}:${pkg.chapterId}:${pkg.id}:v${pkg.version}:${projection.runtime.sceneId}:${projection.runtime.blockId}`;
}

function actionIdFor(projection: SceneSaveProjection, pkg: ScenePackage): string {
  return slotKey(projection, pkg);
}

function errorFromValidation(error: unknown): SceneChoiceServiceError {
  if (error instanceof SceneChoiceServiceError) return error;
  if (error instanceof SceneChoiceResolutionError) {
    return new SceneChoiceServiceError(error.code, error.message, error.code === "REVISION_CONFLICT", error.reasons);
  }
  if (error instanceof SceneEventValidationError) return new SceneChoiceServiceError(error.code, error.message);
  if (error instanceof Error && error.name === "ScenePackageValidationError") {
    const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "INVALID_PACKAGE";
    const mapped = code === "unknown_rule" ? "UNKNOWN_RULE" : code === "all_choices_locked" ? "CHOICE_LOCKED" : code.toUpperCase();
    return new SceneChoiceServiceError(mapped, error.message);
  }
  if (error instanceof Error) return new SceneChoiceServiceError("SCENE_CHOICE_FAILED", error.message, true);
  return new SceneChoiceServiceError("SCENE_CHOICE_FAILED", "场景选择失败", true);
}

function projectionCopy(projection: SceneSaveProjection): SceneSaveProjection {
  return clone(projection);
}

function findExistingAction(projection: SceneSaveProjection, pkg: ScenePackage): SceneActionRecord | undefined {
  const slot = slotKey(projection, pkg);
  return (projection.actions ?? []).find(
    (action) =>
      `${action.branchId}:${action.chapterId}:${action.packageId}:v${action.packageVersion}:${action.sceneId}:${action.blockId}` === slot,
  );
}

function replayExisting(
  request: SceneChoiceRequest,
  pkg: ScenePackage,
  existing: SceneActionRecord,
): SceneChoiceResponse {
  const projection = projectionCopy(request.projection);
  const events = existing.eventIds.map((eventId) => projection.events[eventId]).filter((event): event is NonNullable<typeof event> => Boolean(event));
  if (events.length !== existing.eventIds.length || !existing.eventIds.every((id) => projection.worldState.canonicalEventIds.includes(id))) {
    throw new SceneChoiceServiceError("INCOMPLETE_SAVE", "动作记录关联的 canonical 事件不完整，当前存档已进入只读修复状态");
  }
  return {
    requestId: request.requestId,
    beforeRevision: projection.revision,
    afterRevision: projection.revision,
    record: clone(existing),
    events: clone(events),
    worldStateAfter: clone(projection.worldState),
    runtimeAfter: clone(projection.runtime),
    flagsAfter: clone(projection.flags),
    feedback: "该场景选择已经记录，已恢复原结果。",
    replayed: true,
    projectionAfter: projection,
  };
}

function ensureNoOrphanEvent(projection: SceneSaveProjection, actionId: string): void {
  const eventId = `scene-event:${actionId}`;
  const event = projection.events[eventId];
  const canonical = projection.worldState.canonicalEventIds.includes(eventId);
  if (event || canonical) throw new SceneChoiceServiceError("INCOMPLETE_SAVE", "发现没有动作记录的场景事件，拒绝继续写入");
}

function buildRuntimeAfter(pkg: ScenePackage, projection: SceneSaveProjection, record: SceneActionRecord) {
  const started = transitionSceneRuntime(pkg, projection.runtime, {
    type: "SELECT_STARTED",
    requestId: `recovered:${record.id}`,
    choiceId: record.choiceId,
    issuedAt: record.committedAt,
    expectedRevision: projection.revision,
  });
  const submitting = started.status === "submitting" ? started : { ...started, status: "submitting" as const };
  return transitionSceneRuntime(pkg, submitting, { type: "SELECT_SUCCEEDED", record });
}

export function applySceneChoice(
  request: SceneChoiceRequest,
  dependencies: SceneChoiceServiceDependencies = {},
): SceneChoiceResponse {
  try {
    const projection = request.projection;
    const pkg = request.package;
    const branchId = projection.activeBranchId ?? projection.runtime.branchId;
    if (branchId !== projection.runtime.branchId) throw new SceneChoiceServiceError("BRANCH_MISMATCH", "活动分支与场景运行时不一致");
    if (pkg.chapterId !== projection.runtime.chapterId || pkg.id !== projection.runtime.packageId || pkg.version !== projection.runtime.packageVersion) {
      throw new SceneChoiceServiceError("PACKAGE_MISMATCH", "场景包与当前运行时不一致");
    }
    const existing = findExistingAction(projection, pkg);
    if (existing) {
      if (existing.choiceId !== request.choiceId) throw new SceneChoiceServiceError("CHOICE_SLOT_CONFLICT", "这个选择位置已经提交过另一项行动");
      return replayExisting(request, pkg, existing);
    }
    const actionId = actionIdFor(projection, pkg);
    ensureNoOrphanEvent(projection, actionId);
    if (request.expectedRevision !== projection.revision) throw new SceneChoiceServiceError("REVISION_CONFLICT", "存档版本已变化，请恢复后重试", true);
    const normalizedPackage = validateScenePackage(pkg, {
      world: projection.worldState,
      flags: projection.flags,
      currentYear: projection.worldState.currentYear,
      chapterId: projection.runtime.chapterId,
      checkAvailability: false,
    });
    const resolved = resolveSceneChoice({
      world: projection.worldState,
      package: normalizedPackage,
      runtime: projection.runtime,
      flags: projection.flags,
      choiceId: request.choiceId,
      actionId,
    });
    validateSceneEvent(resolved.event, {
      world: projection.worldState,
      package: normalizedPackage,
      runtime: projection.runtime,
      actionId,
    });
    const now = dependencies.now ?? request.issuedAt;
    const output: WorldSimulationOutput = {
      events: [resolved.event],
      newMemories: [],
      goalUpdates: [],
      hookUpdates: [],
      threadUpdates: { create: [], resolveIds: [], dormantIds: [] },
      chapterSummary: { keyEvents: [], characterChanges: [], relationshipChanges: [], unresolvedQuestions: [] },
    };
    const reduce = dependencies.reduceWorldState ?? reduceWorldState;
    const worldStateAfter = reduce(projection.worldState, output, {
      chapterId: normalizedPackage.chapterId,
      endYear: projection.worldState.currentYear,
      now,
      recordChapter: false,
      newId: () => `${resolved.event.id}:generated-id`,
    });
    const beforeHash = hashState(projection.worldState);
    const afterHash = hashState(worldStateAfter);
    const record: SceneActionRecord = {
      id: actionId,
      branchId,
      chapterId: normalizedPackage.chapterId,
      packageId: normalizedPackage.id,
      packageVersion: normalizedPackage.version,
      sceneId: projection.runtime.sceneId,
      blockId: projection.runtime.blockId,
      choiceId: resolved.choice.id,
      label: resolved.choice.label,
      ruleId: resolved.rule.ruleId,
      ...(resolved.choice.targetCharacterId ? { targetCharacterId: resolved.choice.targetCharacterId } : {}),
      eventIds: [resolved.event.id],
      actualRelationshipDelta: clone(resolved.actualRelationshipDelta),
      flagsAfter: clone(resolved.flagsAfter),
      next: clone(resolved.choice.next),
      beforeHash,
      afterHash,
      committedAt: now,
    };
    validateSceneEvent(resolved.event, {
      world: projection.worldState,
      package: normalizedPackage,
      runtime: projection.runtime,
      actionId,
      record,
    });
    const runtimeAfter = buildRuntimeAfter(normalizedPackage, projection, record);
    const projectionAfter: SceneSaveProjection = {
      worldState: clone(worldStateAfter),
      chapters: clone(projection.chapters),
      events: { ...clone(projection.events), [resolved.event.id]: clone(resolved.event) },
      experienceCache: clone(projection.experienceCache),
      activeBranchId: branchId,
      runtime: clone(runtimeAfter),
      actions: [...clone(projection.actions ?? []), clone(record)],
      flags: clone(resolved.flagsAfter),
      revision: projection.revision + 1,
    };
    return {
      requestId: request.requestId,
      beforeRevision: projection.revision,
      afterRevision: projectionAfter.revision,
      record,
      events: [clone(resolved.event)],
      worldStateAfter: clone(worldStateAfter),
      runtimeAfter: clone(runtimeAfter),
      flagsAfter: clone(resolved.flagsAfter),
      feedback: resolved.feedback,
      replayed: false,
      projectionAfter,
    };
  } catch (error) {
    throw errorFromValidation(error);
  }
}
