import type { GameSave } from "../domain/chapter";
import type {
  SceneChoiceResponse,
  SceneFlowPendingCommand,
  SceneFlowPosition,
  SceneFlowState,
  ScenePackage,
  SceneRuntimeState,
} from "../domain/scene";
import type { ZhaoLengCommand } from "../domain/zhao-leng-runtime";
import { evaluateZhaoLengHiddenEvent } from "../narrative/zhao-leng-demo";
import { ZHAO_LENG_BEAT_SCRIPTS } from "../narrative/zhao-leng-script";
import { transitionSceneRuntime } from "./scene-runtime";
import { getZhaoLengRelationship, isZhaoLengDemoSave } from "./zhao-leng-demo";

export type ZhaoLengBoundaryResult =
  | { kind: "none" }
  | { kind: "command"; type: ZhaoLengCommand["type"] }
  | { kind: "decision"; options: Array<"open_hidden" | "finish_normal"> }
  | { kind: "ended" }
  | { kind: "invalid"; code: string; message: string };

function sameRuntimePosition(left: SceneRuntimeState, right: SceneRuntimeState): boolean {
  return (
    left.branchId === right.branchId &&
    left.chapterId === right.chapterId &&
    left.packageId === right.packageId &&
    left.packageVersion === right.packageVersion &&
    left.sceneId === right.sceneId &&
    left.blockId === right.blockId
  );
}
function hiddenStatus(save: GameSave): ReturnType<typeof evaluateZhaoLengHiddenEvent> {
  const relationship = getZhaoLengRelationship(save).scores;
  return evaluateZhaoLengHiddenEvent({
    relationship,
    completedBeatIds: save.zhaoLeng?.completedBeatIds ?? [],
    observedClueIds: save.zhaoLeng?.observedClueIds ?? [],
    consumedEventIds: save.zhaoLeng?.consumedEventIds ?? [],
  });
}

/**
 * Resolves only the no-decision boundary after a package has been read.
 * It does not mutate a save, pick a hidden path, or issue a network request.
 */
export function resolveZhaoLengBoundary(input: {
  save: GameSave;
  completedRuntime: SceneRuntimeState;
}): ZhaoLengBoundaryResult {
  const { save, completedRuntime } = input;
  if (!isZhaoLengDemoSave(save) || !save.zhaoLeng) {
    return { kind: "invalid", code: "INVALID_DEMO", message: "当前存档不是有效的赵冷 Demo 存档" };
  }
  if (completedRuntime.readOnly) {
    return { kind: "invalid", code: "READ_ONLY", message: "只读回看不能推进赵冷 Demo" };
  }
  if (completedRuntime.status !== "completed") {
    return { kind: "invalid", code: "INVALID_POSITION", message: "当前场景尚未读完" };
  }
  if (!save.sceneRuntime || !sameRuntimePosition(save.sceneRuntime, completedRuntime)) {
    return { kind: "invalid", code: "STALE_RUNTIME", message: "场景位置已经变化，请恢复最新存档" };
  }

  if (save.zhaoLeng.stage === "ended") return { kind: "ended" };
  if (save.zhaoLeng.stage === "hidden_reading") return { kind: "command", type: "finish_hidden" };
  if (save.zhaoLeng.stage === "ending_reading") return { kind: "command", type: "finish_ending" };
  if (save.zhaoLeng.stage !== "reading" && save.zhaoLeng.stage !== "ready_to_advance") {
    return { kind: "invalid", code: "INVALID_STAGE", message: "当前赵冷 Demo 阶段不能继续" };
  }

  const currentIndex = ZHAO_LENG_BEAT_SCRIPTS.findIndex((beat) => beat.id === save.zhaoLeng?.beatId);
  if (currentIndex < 0) return { kind: "invalid", code: "INVALID_BEAT", message: "当前赵冷节拍不存在" };
  if (currentIndex < ZHAO_LENG_BEAT_SCRIPTS.length - 1) return { kind: "command", type: "advance_beat" };

  return hiddenStatus(save).status === "eligible"
    ? { kind: "decision", options: ["open_hidden", "finish_normal"] }
    : { kind: "command", type: "finish_normal" };
}

/**
 * Converts a successful choice into the first line of its feedback scene.
 * The conversion is presentation-only: events, actions and revision remain untouched.
 */
export function presentSceneChoiceResponse(
  packageItem: ScenePackage,
  response: SceneChoiceResponse,
  flowPolicy: "confirm" | "seamless" = "confirm",
): SceneChoiceResponse {
  if (flowPolicy !== "seamless") return response;
  if (response.runtimeAfter.status === "reading" && response.projectionAfter.runtime.status === "reading") return response;
  if (response.record.next.kind !== "scene") throw new Error("顺滑选择缺少有效反馈场景目标");
  if (response.runtimeAfter.status !== "feedback" || response.runtimeAfter.feedbackNext?.kind !== "scene") {
    throw new Error("顺滑选择结果缺少可验证的反馈游标");
  }
  const routed = transitionSceneRuntime(packageItem, response.runtimeAfter, { type: "ACK_FEEDBACK" });
  if (routed.status !== "reading" || routed.sceneId !== response.record.next.sceneId) {
    throw new Error("顺滑选择反馈目标不存在");
  }
  const runtimeAfter: SceneRuntimeState = {
    ...routed,
    selectedActionId: response.record.id,
    readBlockIds: [...new Set([...response.runtimeAfter.readBlockIds, response.runtimeAfter.blockId])],
  };
  return {
    ...response,
    runtimeAfter,
    projectionAfter: { ...response.projectionAfter, runtime: runtimeAfter },
  };
}

export type ZhaoLengNarrativeIdentity = {
  generation: number;
  mode: NonNullable<GameSave["zhaoLeng"]>["generationMode"];
  branchId: string;
  beatId: string;
  packageId: string;
  packageVersion: number;
  revision: number;
};

export function captureZhaoLengNarrativeIdentity(save: GameSave, generation: number): ZhaoLengNarrativeIdentity | null {
  if (!save.zhaoLeng || !save.sceneRuntime) return null;
  return {
    generation,
    mode: save.zhaoLeng.generationMode,
    branchId: save.activeBranchId ?? save.sceneRuntime.branchId,
    beatId: save.zhaoLeng.beatId,
    packageId: save.sceneRuntime.packageId,
    packageVersion: save.sceneRuntime.packageVersion,
    revision: save.saveRevision ?? 0,
  };
}

export function isCurrentZhaoLengNarrativeContext(
  save: GameSave,
  identity: ZhaoLengNarrativeIdentity,
  generation: number,
): boolean {
  const current = captureZhaoLengNarrativeIdentity(save, generation);
  return Boolean(
    current &&
      current.generation === identity.generation &&
      current.mode === identity.mode &&
      current.branchId === identity.branchId &&
      current.beatId === identity.beatId &&
      current.packageId === identity.packageId &&
      current.packageVersion === identity.packageVersion &&
      current.revision === identity.revision,
  );
}

function deliveryKey(delivery: { contextId: string; directiveId: string }): string {
  return `${delivery.contextId}:${delivery.directiveId}`;
}

/** Safely merges a preview's append-only narrative deliveries into the newest save. */
export function mergeNarrativePreviewSave(
  current: GameSave,
  preview: GameSave,
  identity: ZhaoLengNarrativeIdentity,
  generation: number,
): GameSave | null {
  if (!isCurrentZhaoLengNarrativeContext(current, identity, generation)) return null;
  if (!preview.narrativeRuntime) return current;
  const currentRuntime = current.narrativeRuntime ?? { schemaVersion: 1 as const, deliveries: [] };
  const known = new Set(currentRuntime.deliveries.map(deliveryKey));
  const deliveries = currentRuntime.deliveries.map((delivery) => ({ ...delivery }));
  for (const delivery of preview.narrativeRuntime.deliveries) {
    const key = deliveryKey(delivery);
    if (known.has(key) || delivery.branchId !== identity.branchId) continue;
    known.add(key);
    deliveries.push({ ...delivery });
  }
  return {
    ...current,
    narrativeRuntime: { schemaVersion: 1, deliveries },
  };
}

export function sceneFlowPosition(save: GameSave, runtime = save.sceneRuntime): SceneFlowPosition | null {
  if (!runtime) return null;
  return {
    branchId: save.activeBranchId ?? runtime.branchId,
    chapterId: runtime.chapterId,
    packageId: runtime.packageId,
    packageVersion: runtime.packageVersion,
    sceneId: runtime.sceneId,
    blockId: runtime.blockId,
    revision: save.saveRevision ?? 0,
  };
}

export function createPendingSceneFlow(
  save: GameSave,
  pendingCommand: SceneFlowPendingCommand,
  runtime = save.sceneRuntime,
): SceneFlowState | undefined {
  const sourcePosition = sceneFlowPosition(save, runtime);
  if (!sourcePosition) return undefined;
  return { schemaVersion: 1, sourcePosition, pendingCommand: { ...pendingCommand } };
}
