import type { GameSave } from "../domain/chapter";
import type { ScenePackage } from "../domain/scene";
import type {
  ZhaoLengBeatId,
  ZhaoLengCommand,
  ZhaoLengEndingId,
  ZhaoLengPreparedArtifact,
  ZhaoLengPhaseId,
  ZhaoLengRuntimeState,
} from "../domain/zhao-leng-runtime";
import { evaluateZhaoLengHiddenEvent } from "../narrative/zhao-leng-demo";
import {
  buildZhaoLengEndingLines,
  buildZhaoLengHiddenLines,
  getZhaoLengBeatScript,
} from "../narrative/zhao-leng-script";
import {
  ZHAO_LENG_BEAT_SCRIPTS,
} from "../narrative/zhao-leng-script";
import { createSceneRuntime } from "./scene-runtime";
import { appendSnapshot } from "./snapshot-manager";
import {
  getZhaoLengRelationship,
  isZhaoLengDemoSave,
  ZHAO_LENG_CHAPTER_ID,
} from "./zhao-leng-demo";
import {
  compileZhaoLengBeat,
  compileZhaoLengReadingPackage,
} from "./zhao-leng-package";
import {
  deriveZhaoLengFacts,
  zhaoLengFlags,
} from "./zhao-leng-facts";
import { validateZhaoLengPreparedArtifact } from "./zhao-leng-artifact-validator";
export { resolveZhaoLengBoundary } from "./zhao-leng-flow";
export { deriveZhaoLengFacts, zhaoLengFlags } from "./zhao-leng-facts";
export type { ZhaoLengFacts } from "./zhao-leng-facts";

export class ZhaoLengCommandError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "ZhaoLengCommandError";
    this.code = code;
    this.retryable = retryable;
  }
}

export type ZhaoLengCommandResult = {
  saveAfter: GameSave;
  replayed: boolean;
};

export type ZhaoLengCommandDependencies = {
  now?: string;
  compileBeat?: typeof compileZhaoLengBeat;
  preparedArtifact?: ZhaoLengPreparedArtifact;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function currentPackage(save: GameSave): ScenePackage {
  const runtime = save.sceneRuntime;
  const active = runtime
    ? save.scenePackages?.[ZHAO_LENG_CHAPTER_ID] ?? save.zhaoLeng?.packagesById[runtime.packageId]
    : undefined;
  if (!active || !runtime || active.id !== runtime.packageId || active.version !== runtime.packageVersion) {
    throw new ZhaoLengCommandError("INVALID_DEMO_POSITION", "赵冷 Demo 当前场景包不存在或版本不一致");
  }
  return active;
}

function assertBaseCommand(save: GameSave, command: ZhaoLengCommand): {
  runtime: NonNullable<GameSave["sceneRuntime"]>;
  packageItem: ScenePackage;
} {
  if (!isZhaoLengDemoSave(save) || !save.zhaoLeng) {
    throw new ZhaoLengCommandError("INVALID_DEMO", "当前存档不是有效的赵冷 Demo 存档");
  }
  const runtime = save.sceneRuntime;
  if (!runtime) throw new ZhaoLengCommandError("INVALID_DEMO_POSITION", "赵冷 Demo 尚未建立场景运行时");
  const packageItem = currentPackage(save);
  const branchId = save.activeBranchId ?? runtime.branchId;
  if (command.expectedBranchId && command.expectedBranchId !== branchId) {
    throw new ZhaoLengCommandError("BRANCH_MISMATCH", "场景分支已经变化，请恢复最新存档");
  }
  if (command.expectedPackageId !== packageItem.id) {
    throw new ZhaoLengCommandError("PACKAGE_MISMATCH", "场景内容已经变化，请恢复最新存档");
  }
  if (command.expectedRevision !== (save.saveRevision ?? 0)) {
    throw new ZhaoLengCommandError("REVISION_CONFLICT", "赵冷 Demo 存档版本已经变化，请恢复后重试", true);
  }
  return { runtime, packageItem };
}

function commandHash(command: ZhaoLengCommand): string {
  return JSON.stringify(command);
}

function replayReceipt(save: GameSave, command: ZhaoLengCommand): ZhaoLengCommandResult | null {
  const receipt = save.zhaoLeng?.commandReceipts[command.requestId];
  if (!receipt) return null;
  if (receipt.payloadHash !== commandHash(command)) {
    throw new ZhaoLengCommandError("REQUEST_ID_CONFLICT", "requestId 已经用于另一条赵冷 Demo 命令");
  }
  const visible = save.zhaoLeng?.packagesById[receipt.resultingPackageId] || save.scenePackages?.[ZHAO_LENG_CHAPTER_ID];
  if (!visible) throw new ZhaoLengCommandError("INCOMPLETE_SAVE", "命令回执引用的内容包不在当前分支历史中");
  return { saveAfter: clone(save), replayed: true };
}

function addUnique<T>(items: T[], item: T): T[] {
  return items.includes(item) ? [...items] : [...items, item];
}

function phaseFor(beatId: ZhaoLengBeatId): ZhaoLengPhaseId {
  return getZhaoLengBeatScript(beatId).phaseId;
}


export function resolveZhaoLengNormalEnding(save: GameSave): "mutual-trust" | "kind-distance" {
  const facts = deriveZhaoLengFacts(save);
  return facts.canTogether && facts.relationshipIntent === "together" ? "mutual-trust" : "kind-distance";
}

export function evaluateZhaoLengHidden(save: GameSave) {
  const relationship = getZhaoLengRelationship(save);
  return evaluateZhaoLengHiddenEvent({
    relationship: relationship.scores,
    completedBeatIds: save.zhaoLeng?.completedBeatIds ?? [],
    observedClueIds: save.zhaoLeng?.observedClueIds ?? [],
    consumedEventIds: save.zhaoLeng?.consumedEventIds ?? [],
  });
}

function expectedCurrentBeat(save: GameSave): ZhaoLengBeatId {
  const beatId = save.zhaoLeng?.beatId;
  if (!beatId) throw new ZhaoLengCommandError("INVALID_DEMO_POSITION", "赵冷 Demo 缺少当前节拍");
  return beatId;
}

function isLibraryCardObservationPosition(
  runtime: NonNullable<GameSave["sceneRuntime"]>,
  packageItem: ScenePackage,
): boolean {
  if (runtime.status !== "reading" || runtime.sceneId !== packageItem.entrySceneId) return false;
  return [
    `${packageItem.entrySceneId}:opening:line:8`,
    `${packageItem.entrySceneId}:opening:line:9`,
  ].includes(runtime.blockId);
}

export function canObserveZhaoLengLibraryCard(save: GameSave): boolean {
  if (!isZhaoLengDemoSave(save) || !save.zhaoLeng || save.zhaoLeng.beatId !== "zl-02-library") return false;
  if (save.zhaoLeng.observedClueIds.includes("library-card") || !save.sceneRuntime) return false;
  let packageItem: ScenePackage;
  try {
    packageItem = currentPackage(save);
  } catch {
    return false;
  }
  return isLibraryCardObservationPosition(save.sceneRuntime, packageItem);
}

function activePackageId(save: GameSave): string {
  return currentPackage(save).id;
}

function commitCommand(
  save: GameSave,
  command: ZhaoLengCommand,
  draft: GameSave,
  now: string,
): ZhaoLengCommandResult {
  if (!draft.zhaoLeng) throw new ZhaoLengCommandError("INVALID_DEMO", "赵冷 Demo 状态缺失");
  const packageId = activePackageId(draft);
  const revision = (save.saveRevision ?? 0) + 1;
  const draftWithoutPendingFlow: GameSave = { ...draft };
  delete draftWithoutPendingFlow.sceneFlow;
  let next: GameSave = {
    ...draftWithoutPendingFlow,
    savedAt: now,
    saveRevision: revision,
    zhaoLeng: {
      ...draft.zhaoLeng,
      commandReceipts: {
        ...draft.zhaoLeng.commandReceipts,
        [command.requestId]: { payloadHash: commandHash(command), resultingPackageId: packageId },
      },
    },
  };
  next = appendSnapshot(next, {
    chapterId: ZHAO_LENG_CHAPTER_ID,
    now,
    sceneRuntime: next.sceneRuntime,
    sceneActions: next.sceneActions,
    sceneFlags: next.sceneFlags,
  });
  return { saveAfter: next, replayed: false };
}

function prepareNextPackage(save: GameSave, nextBeatId: ZhaoLengBeatId, now: string, dependencies: ZhaoLengCommandDependencies): GameSave {
  const nextFlags = zhaoLengFlags(save);
  const prepared: GameSave = { ...save, sceneFlags: nextFlags };
  const artifact = dependencies.preparedArtifact
    ? validateZhaoLengPreparedArtifact(save, nextBeatId, dependencies.preparedArtifact, new Date(now))
    : undefined;
  const packageItem = (dependencies.compileBeat ?? compileZhaoLengBeat)({
    save: prepared,
    beatId: nextBeatId,
    ...(artifact ? { written: artifact.written } : {}),
  });
  const nextRuntime = createSceneRuntime(packageItem, {
    branchId: save.activeBranchId ?? save.sceneRuntime?.branchId ?? "main",
    playbackMode: save.sceneRuntime?.playbackMode ?? "manual",
    skipPolicy: save.sceneRuntime?.skipPolicy ?? "legacy",
  });
  return {
    ...prepared,
    scenePackages: { ...(prepared.scenePackages ?? {}), [ZHAO_LENG_CHAPTER_ID]: packageItem },
    sceneRuntime: nextRuntime,
    zhaoLeng: {
      ...prepared.zhaoLeng!,
      beatId: nextBeatId,
      phaseId: phaseFor(nextBeatId),
      stage: "reading",
      packagesById: { ...(prepared.zhaoLeng?.packagesById ?? {}), [packageItem.id]: clone(packageItem) },
      cacheKeys: { ...(prepared.zhaoLeng?.cacheKeys ?? {}), [nextBeatId]: packageItem.id },
      preparedArtifact: undefined,
    },
  };
}

function completeBeat(state: ZhaoLengRuntimeState, beatId: ZhaoLengBeatId): ZhaoLengRuntimeState {
  return {
    ...state,
    completedBeatIds: addUnique(state.completedBeatIds, beatId),
  };
}

function ensureRuntimeCompleted(runtime: NonNullable<GameSave["sceneRuntime"]>) {
  if (runtime.status !== "completed") {
    throw new ZhaoLengCommandError("INVALID_DEMO_POSITION", "当前赵冷场景尚未播放完成");
  }
}

function validateCommandPosition(
  save: GameSave,
  command: ZhaoLengCommand,
  runtime: NonNullable<GameSave["sceneRuntime"]>,
): ZhaoLengBeatId | undefined {
  const currentBeat = expectedCurrentBeat(save);

  if (command.type === "observe_library_card") {
    if (!canObserveZhaoLengLibraryCard(save)) {
      throw new ZhaoLengCommandError("INVALID_DEMO_POSITION", "当前无法观察旧借阅卡");
    }
    return undefined;
  }

  ensureRuntimeCompleted(runtime);

  if (command.type === "advance_beat") {
    const currentIndex = ZHAO_LENG_BEAT_SCRIPTS.findIndex((beat) => beat.id === currentBeat);
    if (currentIndex < 0 || currentIndex >= ZHAO_LENG_BEAT_SCRIPTS.length - 1) {
      throw new ZhaoLengCommandError("INVALID_DEMO_POSITION", "第十二节拍不能继续推进为普通关系节拍");
    }
    return ZHAO_LENG_BEAT_SCRIPTS[currentIndex + 1].id;
  }

  if (command.type === "open_hidden") {
    if (currentBeat !== "zl-12-hook" || save.zhaoLeng!.stage !== "reading") {
      throw new ZhaoLengCommandError("INVALID_DEMO_POSITION", "当前不是第十二节拍的普通收束位置");
    }
    if (evaluateZhaoLengHidden(save).status !== "eligible") {
      throw new ZhaoLengCommandError("INVALID_DEMO_POSITION", "隐藏后续当前不可用");
    }
    return undefined;
  }

  if (command.type === "finish_normal") {
    if (currentBeat !== "zl-12-hook" || save.zhaoLeng!.stage !== "reading") {
      throw new ZhaoLengCommandError("INVALID_DEMO_POSITION", "普通结局只能从第十二节拍收束");
    }
    return undefined;
  }

  if (command.type === "finish_hidden") {
    if (
      save.zhaoLeng!.stage !== "hidden_reading" ||
      save.zhaoLeng!.consumedEventIds.includes("zhao-leng-library-letter")
    ) {
      throw new ZhaoLengCommandError("INVALID_DEMO_POSITION", "隐藏后续尚未读完或已经消费");
    }
    return undefined;
  }

  if (command.type === "finish_ending") {
    if (save.zhaoLeng!.stage !== "ending_reading" || !save.zhaoLeng!.endingId) {
      throw new ZhaoLengCommandError("INVALID_DEMO_POSITION", "结局内容尚未准备好");
    }
    return undefined;
  }

  throw new ZhaoLengCommandError("INVALID_COMMAND", "未知赵冷 Demo 命令");
}

export type ZhaoLengPreflight =
  | { replayed: true; result: ZhaoLengCommandResult }
  | {
      replayed: false;
      runtime: NonNullable<GameSave["sceneRuntime"]>;
      packageItem: ScenePackage;
      currentBeat: ZhaoLengBeatId;
      nextBeatId?: ZhaoLengBeatId;
    };

/**
 * Validates a command without compiling content or calling an AI writer.
 * Receipt replay intentionally happens first so a completed request remains idempotent
 * even after the saved revision has advanced.
 */
export function preflightZhaoLengCommand(save: GameSave, command: ZhaoLengCommand): ZhaoLengPreflight {
  const replay = replayReceipt(save, command);
  if (replay) return { replayed: true, result: replay };
  const { runtime, packageItem } = assertBaseCommand(save, command);
  const currentBeat = expectedCurrentBeat(save);
  const nextBeatId = validateCommandPosition(save, command, runtime);
  return { replayed: false, runtime, packageItem, currentBeat, ...(nextBeatId ? { nextBeatId } : {}) };
}

export function applyZhaoLengCommand(
  save: GameSave,
  command: ZhaoLengCommand,
  dependencies: ZhaoLengCommandDependencies = {},
): ZhaoLengCommandResult {
  const preflight = preflightZhaoLengCommand(save, command);
  if (preflight.replayed === true) return preflight.result;
  const { runtime, currentBeat, nextBeatId } = preflight;
  const now = dependencies.now ?? command.issuedAt;

  if (command.type === "observe_library_card") {
    return commitCommand(
      save,
      command,
      {
        ...save,
        zhaoLeng: {
          ...save.zhaoLeng!,
          observedClueIds: addUnique(save.zhaoLeng!.observedClueIds, "library-card"),
        },
      },
      now,
    );
  }

  if (command.type === "advance_beat") {
    if (!nextBeatId) throw new ZhaoLengCommandError("INVALID_DEMO_POSITION", "下一节拍不存在");
    const completed = completeBeat(save.zhaoLeng!, currentBeat);
    const advanced = prepareNextPackage(
      {
        ...save,
        sceneFlags: zhaoLengFlags(save),
        zhaoLeng: completed,
      },
      nextBeatId,
      now,
      dependencies,
    );
    return commitCommand(save, command, advanced, now);
  }

  if (command.type === "open_hidden") {
    const intent = deriveZhaoLengFacts(save).relationshipIntent;
    const hiddenPackage = compileZhaoLengReadingPackage(save, "zhao-leng-library-letter", buildZhaoLengHiddenLines(intent));
    const nextState = completeBeat({ ...save.zhaoLeng!, stage: "hidden_reading" }, currentBeat);
    return commitCommand(
      save,
      command,
      {
        ...save,
        scenePackages: { ...(save.scenePackages ?? {}), [ZHAO_LENG_CHAPTER_ID]: hiddenPackage },
        sceneRuntime: createSceneRuntime(hiddenPackage, { branchId: runtime.branchId, playbackMode: runtime.playbackMode, skipPolicy: runtime.skipPolicy ?? "legacy" }),
        zhaoLeng: {
          ...nextState,
          packagesById: { ...nextState.packagesById, [hiddenPackage.id]: hiddenPackage },
          cacheKeys: { ...nextState.cacheKeys, ["zhao-leng-library-letter"]: hiddenPackage.id },
        },
      },
      now,
    );
  }

  if (command.type === "finish_normal") {
    const endingId = resolveZhaoLengNormalEnding(save);
    const intent = deriveZhaoLengFacts(save).relationshipIntent;
    const endingPackage = compileZhaoLengReadingPackage(save, endingId, buildZhaoLengEndingLines(endingId, intent), endingId);
    const nextState = completeBeat({ ...save.zhaoLeng!, stage: "ending_reading", endingId }, currentBeat);
    return commitCommand(
      save,
      command,
      {
        ...save,
        scenePackages: { ...(save.scenePackages ?? {}), [ZHAO_LENG_CHAPTER_ID]: endingPackage },
        sceneRuntime: createSceneRuntime(endingPackage, { branchId: runtime.branchId, playbackMode: runtime.playbackMode, skipPolicy: runtime.skipPolicy ?? "legacy" }),
        zhaoLeng: {
          ...nextState,
          packagesById: { ...nextState.packagesById, [endingPackage.id]: endingPackage },
          cacheKeys: { ...nextState.cacheKeys, [endingId]: endingPackage.id },
        },
      },
      now,
    );
  }

  if (command.type === "finish_hidden") {
    const intent = deriveZhaoLengFacts(save).relationshipIntent;
    const endingPackage = compileZhaoLengReadingPackage(
      save,
      "library-letter",
      buildZhaoLengEndingLines("library-letter", intent),
      "library-letter",
    );
    return commitCommand(
      save,
      command,
      {
        ...save,
        scenePackages: { ...(save.scenePackages ?? {}), [ZHAO_LENG_CHAPTER_ID]: endingPackage },
        sceneRuntime: createSceneRuntime(endingPackage, { branchId: runtime.branchId, playbackMode: runtime.playbackMode, skipPolicy: runtime.skipPolicy ?? "legacy" }),
        zhaoLeng: {
          ...save.zhaoLeng!,
          stage: "ending_reading",
          endingId: "library-letter",
          consumedEventIds: addUnique(save.zhaoLeng!.consumedEventIds, "zhao-leng-library-letter"),
          packagesById: { ...save.zhaoLeng!.packagesById, [endingPackage.id]: endingPackage },
          cacheKeys: { ...save.zhaoLeng!.cacheKeys, ["library-letter"]: endingPackage.id },
        },
      },
      now,
    );
  }

  if (command.type === "finish_ending") {
    return commitCommand(
      save,
      command,
      { ...save, zhaoLeng: { ...save.zhaoLeng!, stage: "ended" } },
      now,
    );
  }

  throw new ZhaoLengCommandError("INVALID_COMMAND", "未知赵冷 Demo 命令");
}
