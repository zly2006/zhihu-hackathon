import type {
  Chapter,
  GameSave,
  PendingChapter,
  PendingChapterStage,
} from "../domain/chapter";
import type {
  SceneActionRecord,
  SceneChoiceResponse,
  ScenePackage,
  SceneRuntimeState,
  SceneSaveProjection,
} from "../domain/scene";
import { hashState } from "./hash";

export class SceneSaveWriteError extends Error {
  readonly code = "STORAGE_WRITE_FAILED";
  readonly retryable = true;

  constructor(message = "场景结果写入失败，旧存档仍保持不变") {
    super(message);
    this.name = "SceneSaveWriteError";
  }
}

export type SceneRecoveryResult = {
  save: GameSave | SceneSaveProjection;
  runtime?: SceneRuntimeState;
  readOnly: boolean;
  reason: string;
};

export type SceneStorageWriter = (serialized: string) => void;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isProjection(value: unknown): value is SceneSaveProjection {
  return isRecord(value) && ("revision" in value || "runtime" in value || "actions" in value || "flags" in value);
}

function normalizeRuntime(value: unknown): SceneRuntimeState | undefined {
  if (!isRecord(value)) return undefined;
  if (value.schemaVersion !== 1) return value as unknown as SceneRuntimeState;
  if (typeof value.branchId !== "string" || typeof value.chapterId !== "string" || typeof value.packageId !== "string" || typeof value.packageVersion !== "number" || typeof value.sceneId !== "string" || typeof value.blockId !== "string") return value as unknown as SceneRuntimeState;
  if (!["reading", "awaiting_choice", "submitting", "feedback", "completed", "error"].includes(String(value.status))) return value as unknown as SceneRuntimeState;
  if (value.playbackMode !== "manual" && value.playbackMode !== "auto") return value as unknown as SceneRuntimeState;
  if (!Array.isArray(value.readBlockIds)) return value as unknown as SceneRuntimeState;
  return clone(value) as SceneRuntimeState;
}

export function normalizeSceneSave<T extends GameSave | SceneSaveProjection>(value: T): T {
  if (!isRecord(value)) throw new Error("场景存档必须是对象");
  if (isProjection(value)) {
    return {
      ...clone(value),
      ...(normalizeRuntime(value.runtime) ? { runtime: normalizeRuntime(value.runtime) } : {}),
      actions: Array.isArray(value.actions) ? clone(value.actions) : [],
      flags: isRecord(value.flags) ? clone(value.flags) : {},
      revision: Number.isInteger(value.revision) && (value.revision as number) >= 0 ? value.revision : 0,
    } as T;
  }
  const save = value as GameSave;
  if (save.schemaVersion !== 1) throw new Error("只支持 schemaVersion=1 的游戏存档");
  return {
    ...clone(save),
    ...(save.sceneRuntime ? { sceneRuntime: normalizeRuntime(save.sceneRuntime) } : {}),
    sceneActions: Array.isArray(save.sceneActions) ? clone(save.sceneActions) : [],
    sceneFlags: isRecord(save.sceneFlags) ? clone(save.sceneFlags) : {},
    scenePackages: isRecord(save.scenePackages) ? clone(save.scenePackages) : {},
    saveRevision: Number.isInteger(save.saveRevision) && (save.saveRevision as number) >= 0 ? save.saveRevision : 0,
  } as T;
}

export function serializeSceneSave(value: GameSave | SceneSaveProjection): string {
  return JSON.stringify(normalizeSceneSave(value));
}

function projectionFromResponse(projection: SceneSaveProjection, response: SceneChoiceResponse): SceneSaveProjection {
  if (response.projectionAfter) return clone(response.projectionAfter);
  return {
    ...clone(projection),
    worldState: clone(response.worldStateAfter),
    runtime: clone(response.runtimeAfter),
    actions: [...clone(projection.actions ?? []), clone(response.record)],
    flags: clone(response.flagsAfter),
    events: { ...clone(projection.events), ...Object.fromEntries(response.events.map((event) => [event.id, clone(event)])) },
    revision: response.afterRevision,
  };
}

export function commitSceneChoice(
  projection: SceneSaveProjection,
  response: SceneChoiceResponse,
  write?: SceneStorageWriter,
): SceneSaveProjection {
  const next = projectionFromResponse(projection, response);
  if (write) {
    try {
      write(serializeSceneSave(next));
    } catch (error) {
      throw new SceneSaveWriteError(error instanceof Error ? error.message : "存储层拒绝写入");
    }
  }
  return next;
}

export function recoverSceneRuntime(
  value: GameSave | SceneSaveProjection,
  packages?: ScenePackage | ScenePackage[],
): SceneRecoveryResult {
  const save = normalizeSceneSave(value);
  const runtime = isProjection(save) ? save.runtime : save.sceneRuntime;
  if (!runtime) return { save, readOnly: false, reason: "当前存档还没有未完成场景" };
  if (runtime.schemaVersion !== 1) return { save, runtime, readOnly: true, reason: "场景运行时版本未知，已切换为只读并等待升级" };
  const packageList = packages ? (Array.isArray(packages) ? packages : [packages]) : [];
  if (packageList.length > 0 && !packageList.some((item) => item.id === runtime.packageId && item.version === runtime.packageVersion)) {
    return { save, runtime, readOnly: true, reason: "场景内容包版本未知，已切换为只读并等待内容包" };
  }
  const packageItem = packageList.find((item) => item.id === runtime.packageId && item.version === runtime.packageVersion);
  if (packageItem && !packageItem.scenes.some((scene) => scene.id === runtime.sceneId && scene.blocks.some((block) => block.id === runtime.blockId))) {
    return { save, runtime, readOnly: true, reason: "场景游标不再存在，已切换为只读并等待修复" };
  }
  return { save, runtime, readOnly: false, reason: "场景运行时已恢复" };
}

export type PendingChapterInput = {
  executionId?: string;
  chapterId: string;
  startYear: number;
  endYear: number;
  stateBeforeHash?: string;
  stateAfterHash?: string;
  worldStateBefore: PendingChapter["worldStateBefore"];
  worldStateAfter: PendingChapter["worldStateAfter"];
  selection?: PendingChapter["selection"];
  resolution?: PendingChapter["resolution"];
  simulationOutput?: PendingChapter["simulationOutput"];
  eventIds?: string[];
  evidenceIds?: string[];
  featuredExperienceIds?: string[];
  stage?: PendingChapterStage;
  createdAt?: string;
};

export function createPendingChapter(input: PendingChapterInput): PendingChapter {
  const now = input.createdAt ?? new Date().toISOString();
  const stateBeforeHash = input.stateBeforeHash ?? hashState(input.worldStateBefore);
  const stateAfterHash = input.stateAfterHash ?? hashState(input.worldStateAfter);
  return {
    executionId: input.executionId ?? `pending:${input.chapterId}:${stateBeforeHash}`,
    chapterId: input.chapterId,
    startYear: input.startYear,
    endYear: input.endYear,
    stateBeforeHash,
    stateAfterHash,
    worldStateBefore: clone(input.worldStateBefore),
    worldStateAfter: clone(input.worldStateAfter),
    ...(input.selection ? { selection: clone(input.selection) } : {}),
    ...(input.resolution ? { resolution: clone(input.resolution) } : {}),
    ...(input.simulationOutput ? { simulationOutput: clone(input.simulationOutput) } : {}),
    eventIds: [...(input.eventIds ?? [])],
    evidenceIds: [...(input.evidenceIds ?? [])],
    featuredExperienceIds: [...(input.featuredExperienceIds ?? [])],
    stage: input.stage ?? "simulated",
    createdAt: now,
    updatedAt: now,
  };
}

export function updatePendingChapterStage(
  pending: PendingChapter,
  executionId: string,
  stage: PendingChapterStage,
  fields: Partial<PendingChapter> = {},
): PendingChapter {
  if (pending.executionId !== executionId) throw new Error("PENDING_EXECUTION_MISMATCH");
  const now = fields.updatedAt ?? new Date().toISOString();
  return {
    ...clone(pending),
    ...clone(fields),
    executionId: pending.executionId,
    chapterId: pending.chapterId,
    stage,
    updatedAt: now,
  };
}

export function resumePendingChapter(value: Pick<GameSave, "pendingChapter"> | { pendingChapter?: PendingChapter }): PendingChapter | null {
  return value.pendingChapter ? clone(value.pendingChapter) : null;
}

export function completePendingChapter(
  value: (Pick<GameSave, "pendingChapter" | "chapters"> & { scenePackages?: Record<string, ScenePackage> }) | GameSave,
  executionId: string,
  chapter: Chapter,
  packageItem: ScenePackage,
): GameSave {
  const current = value.pendingChapter;
  if (!current || current.executionId !== executionId) throw new Error("PENDING_EXECUTION_MISMATCH");
  if (!chapter?.id || chapter.id !== current.chapterId) throw new Error("PENDING_CHAPTER_MISMATCH");
  if (!packageItem?.id || packageItem.chapterId !== current.chapterId) throw new Error("PENDING_PACKAGE_MISMATCH");
  const next = clone(value) as GameSave;
  next.chapters = { ...next.chapters, [chapter.id]: clone(chapter) };
  next.scenePackages = { ...(next.scenePackages ?? {}), [chapter.id]: clone(packageItem) };
  delete next.pendingChapter;
  return next;
}

export function projectGameSave(
  save: GameSave,
  runtime: SceneRuntimeState,
  actions: SceneActionRecord[] = save.sceneActions ?? [],
  flags: Record<string, boolean> = save.sceneFlags ?? {},
): SceneSaveProjection {
  return {
    worldState: clone(save.worldState),
    chapters: clone(save.chapters),
    events: clone(save.events),
    experienceCache: clone(save.experienceCache),
    activeBranchId: save.activeBranchId ?? runtime.branchId,
    runtime: clone(runtime),
    actions: clone(actions),
    flags: clone(flags),
    revision: save.saveRevision ?? 0,
  };
}

export function mergeSceneProjection(save: GameSave, projection: SceneSaveProjection): GameSave {
  return {
    ...clone(save),
    worldState: clone(projection.worldState),
    chapters: clone(projection.chapters),
    events: clone(projection.events),
    experienceCache: clone(projection.experienceCache),
    activeBranchId: projection.activeBranchId,
    sceneRuntime: clone(projection.runtime),
    sceneActions: clone(projection.actions),
    sceneFlags: clone(projection.flags),
    saveRevision: projection.revision,
  };
}
