import type { GameSave } from "../domain/chapter";
import type { ScenePackage } from "../domain/scene";
import type {
  ZhaoLengBeatId,
  ZhaoLengCommand,
  ZhaoLengEndingId,
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
  type ZhaoLengRelationshipIntent,
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

export type ZhaoLengFacts = {
  choiceByBeat: Partial<Record<ZhaoLengBeatId, "A" | "B" | "C">>;
  firstMeetingWeekend: boolean;
  boundaryRespected: boolean;
  coolingPromiseKept: boolean;
  autonomyRespected: boolean;
  jointArrangementActive: boolean;
  remoteFuture: boolean;
  relationshipIntent: ZhaoLengRelationshipIntent;
  canTogether: boolean;
  completedBeatIds: ZhaoLengBeatId[];
  observedLibraryCard: boolean;
};

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
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function beatIdFromPackageId(packageId: string): ZhaoLengBeatId | undefined {
  return ZHAO_LENG_BEAT_SCRIPTS.find((beat) => packageId.includes(`:${beat.id}:`))?.id;
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

function selectedChoices(save: Pick<GameSave, "sceneActions">): ZhaoLengFacts["choiceByBeat"] {
  const result: ZhaoLengFacts["choiceByBeat"] = {};
  for (const action of save.sceneActions ?? []) {
    const beatId = beatIdFromPackageId(action.packageId);
    if (beatId) result[beatId] = action.choiceId;
  }
  return result;
}

function canTogether(
  save: GameSave,
  facts: Omit<ZhaoLengFacts, "canTogether">,
): boolean {
  const scores = getZhaoLengRelationship(save).scores;
  return (
    scores.closeness >= 55 &&
    scores.trust >= 60 &&
    scores.commitment >= 20 &&
    facts.boundaryRespected &&
    facts.autonomyRespected &&
    facts.jointArrangementActive
  );
}

export function deriveZhaoLengFacts(save: GameSave): ZhaoLengFacts {
  const choiceByBeat = selectedChoices(save);
  const boundaryChoice = choiceByBeat["zl-03-boundary"];
  const coolingChoice = choiceByBeat["zl-06-distance"];
  const choice08 = choiceByBeat["zl-08-choice"];
  const choice09 = choiceByBeat["zl-09-consequence"];
  const choice11 = choiceByBeat["zl-11-future"];
  const base = {
    choiceByBeat,
    firstMeetingWeekend: choiceByBeat["zl-01-message"] === "C",
    boundaryRespected: boundaryChoice === "A" || boundaryChoice === "B",
    coolingPromiseKept: coolingChoice === "A" || coolingChoice === "B",
    autonomyRespected: choice08 !== undefined,
    jointArrangementActive:
      choice09 === "C"
        ? false
        : choice09 === "B"
          ? true
          : choice08 === "A",
    remoteFuture: choiceByBeat["zl-10-letter"] === "C",
    relationshipIntent:
      choice11 === "A" ? ("together" as const) : choice11 === "B" ? ("friends" as const) : choice11 === "C" ? ("apart" as const) : ("undecided" as const),
    completedBeatIds: [...(save.zhaoLeng?.completedBeatIds ?? [])],
    observedLibraryCard: (save.zhaoLeng?.observedClueIds ?? []).includes("library-card"),
  };
  return { ...base, canTogether: canTogether(save, base) };
}

export function zhaoLengFlags(save: GameSave): Record<string, boolean> {
  const facts = deriveZhaoLengFacts(save);
  return {
    ...(save.sceneFlags ?? {}),
    zhaoFirstMeetingWeekend: facts.firstMeetingWeekend,
    zhaoBoundaryRespected: facts.boundaryRespected,
    zhaoCoolingPromiseKept: facts.coolingPromiseKept,
    zhaoAutonomyRespected: facts.autonomyRespected,
    zhaoJointArrangementActive: facts.jointArrangementActive,
    zhaoRemoteFuture: facts.remoteFuture,
    zhaoCanTogether: facts.canTogether,
  };
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
  let next: GameSave = {
    ...draft,
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
  const packageItem = (dependencies.compileBeat ?? compileZhaoLengBeat)({ save: prepared, beatId: nextBeatId });
  const nextRuntime = createSceneRuntime(packageItem, {
    branchId: save.activeBranchId ?? save.sceneRuntime?.branchId ?? "main",
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

export function applyZhaoLengCommand(
  save: GameSave,
  command: ZhaoLengCommand,
  dependencies: ZhaoLengCommandDependencies = {},
): ZhaoLengCommandResult {
  const replay = replayReceipt(save, command);
  if (replay) return replay;
  const { runtime, packageItem } = assertBaseCommand(save, command);
  const now = dependencies.now ?? command.issuedAt;
  const currentBeat = expectedCurrentBeat(save);

  if (command.type === "observe_library_card") {
    if (!canObserveZhaoLengLibraryCard(save)) {
      throw new ZhaoLengCommandError("INVALID_DEMO_POSITION", "当前无法观察旧借阅卡");
    }
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
    ensureRuntimeCompleted(runtime);
    const currentIndex = ZHAO_LENG_BEAT_SCRIPTS.findIndex((beat) => beat.id === currentBeat);
    if (currentIndex < 0 || currentIndex >= ZHAO_LENG_BEAT_SCRIPTS.length - 1) {
      throw new ZhaoLengCommandError("INVALID_DEMO_POSITION", "第十二节拍不能继续推进为普通关系节拍");
    }
    const nextBeatId = ZHAO_LENG_BEAT_SCRIPTS[currentIndex + 1].id;
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
    ensureRuntimeCompleted(runtime);
    if (currentBeat !== "zl-12-hook" || save.zhaoLeng!.stage !== "reading") {
      throw new ZhaoLengCommandError("INVALID_DEMO_POSITION", "当前不是第十二节拍的普通收束位置");
    }
    const hidden = evaluateZhaoLengHidden(save);
    if (hidden.status !== "eligible") throw new ZhaoLengCommandError("INVALID_DEMO_POSITION", "隐藏后续当前不可用");
    const intent = deriveZhaoLengFacts(save).relationshipIntent;
    const hiddenPackage = compileZhaoLengReadingPackage(save, "zhao-leng-library-letter", buildZhaoLengHiddenLines(intent));
    const nextState = completeBeat({ ...save.zhaoLeng!, stage: "hidden_reading" }, currentBeat);
    return commitCommand(
      save,
      command,
      {
        ...save,
        scenePackages: { ...(save.scenePackages ?? {}), [ZHAO_LENG_CHAPTER_ID]: hiddenPackage },
        sceneRuntime: createSceneRuntime(hiddenPackage, { branchId: runtime.branchId }),
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
    ensureRuntimeCompleted(runtime);
    if (currentBeat !== "zl-12-hook" || save.zhaoLeng!.stage !== "reading") {
      throw new ZhaoLengCommandError("INVALID_DEMO_POSITION", "普通结局只能从第十二节拍收束");
    }
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
        sceneRuntime: createSceneRuntime(endingPackage, { branchId: runtime.branchId }),
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
    ensureRuntimeCompleted(runtime);
    if (save.zhaoLeng!.stage !== "hidden_reading" || save.zhaoLeng!.consumedEventIds.includes("zhao-leng-library-letter")) {
      throw new ZhaoLengCommandError("INVALID_DEMO_POSITION", "隐藏后续尚未读完或已经消费");
    }
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
        sceneRuntime: createSceneRuntime(endingPackage, { branchId: runtime.branchId }),
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
    ensureRuntimeCompleted(runtime);
    if (save.zhaoLeng!.stage !== "ending_reading" || !save.zhaoLeng!.endingId) {
      throw new ZhaoLengCommandError("INVALID_DEMO_POSITION", "结局内容尚未准备好");
    }
    return commitCommand(
      save,
      command,
      { ...save, zhaoLeng: { ...save.zhaoLeng!, stage: "ended" } },
      now,
    );
  }

  throw new ZhaoLengCommandError("INVALID_COMMAND", "未知赵冷 Demo 命令");
}
