import type { GameSave } from "../domain/chapter";
import type { ScenePackage } from "../domain/scene";
import type { ZhaoLengBeatId } from "../domain/zhao-leng-runtime";
import { ZHAO_LENG_CONTENT_VERSION } from "../domain/zhao-leng-runtime";
import { createStoryInputFingerprint } from "./story-input";
import { getZhaoLengCharacters, getZhaoLengRelationship, isZhaoLengDemoSave, ZHAO_LENG_CHAPTER_ID } from "./zhao-leng-demo";
import { deriveZhaoLengFacts, zhaoLengFlags } from "./zhao-leng-facts";

export const ZHAO_LENG_PREPARE_PIPELINE_VERSION = 1 as const;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
export function activeZhaoLengSourcePackage(save: GameSave): ScenePackage {
  const runtime = save.sceneRuntime;
  if (!runtime) throw new Error("赵冷 Demo 尚未建立当前场景包");
  const packageItem = save.scenePackages?.[ZHAO_LENG_CHAPTER_ID] ?? save.zhaoLeng?.packagesById[runtime.packageId];
  if (!packageItem || packageItem.id !== runtime.packageId || packageItem.version !== runtime.packageVersion) {
    throw new Error("赵冷 Demo 当前场景包不存在或版本不一致");
  }
  return packageItem;
}

export function currentZhaoLengBeat(save: GameSave): ZhaoLengBeatId {
  const beatId = save.zhaoLeng?.beatId;
  if (!beatId) throw new Error("赵冷 Demo 缺少当前节拍");
  return beatId;
}

export function nextZhaoLengBeatId(save: GameSave): ZhaoLengBeatId | undefined {
  const beatId = currentZhaoLengBeat(save);
  const order: ZhaoLengBeatId[] = [
    "zl-01-message",
    "zl-02-library",
    "zl-03-boundary",
    "zl-04-opportunity",
    "zl-05-argument",
    "zl-06-distance",
    "zl-07-return",
    "zl-08-choice",
    "zl-09-consequence",
    "zl-10-letter",
    "zl-11-future",
    "zl-12-hook",
  ];
  const index = order.indexOf(beatId);
  return index >= 0 && index < order.length - 1 ? order[index + 1] : undefined;
}

export function projectedZhaoLengWriterSave(save: GameSave): GameSave {
  if (!isZhaoLengDemoSave(save) || !save.zhaoLeng) throw new Error("当前存档不是有效的赵冷 Demo 存档");
  const beatId = currentZhaoLengBeat(save);
  const completedBeatIds = save.zhaoLeng.completedBeatIds.includes(beatId)
    ? [...save.zhaoLeng.completedBeatIds]
    : [...save.zhaoLeng.completedBeatIds, beatId];
  return {
    ...clone(save),
    sceneFlags: zhaoLengFlags(save),
    zhaoLeng: {
      ...clone(save.zhaoLeng),
      completedBeatIds,
    },
  };
}

function semanticFacts(save: GameSave, nextBeatId: ZhaoLengBeatId): Record<string, unknown> {
  const projected = projectedZhaoLengWriterSave(save);
  const { protagonist, zhaoLeng } = getZhaoLengCharacters(projected);
  const relationship = getZhaoLengRelationship(projected);
  const packageItem = activeZhaoLengSourcePackage(save);
  const facts = deriveZhaoLengFacts(projected);
  return {
    currentBeat: currentZhaoLengBeat(save),
    nextBeatId,
    sourcePackageId: packageItem.id,
    sourcePackageVersion: packageItem.version,
    currentYear: projected.worldState.currentYear,
    branchId: projected.activeBranchId ?? save.sceneRuntime?.branchId ?? "main",
    completedBeatIds: facts.completedBeatIds,
    choiceByBeat: facts.choiceByBeat,
    observedClueIds: [...(projected.zhaoLeng?.observedClueIds ?? [])].sort(),
    flags: zhaoLengFlags(projected),
    relationship: {
      scores: relationship.scores,
      publicSummary: relationship.publicSummary,
    },
    publicCharacters: {
      protagonist: {
        name: protagonist.identity.name,
        city: protagonist.state.city,
        occupation: protagonist.state.occupation,
        speechStyle: protagonist.speechStyle,
      },
      zhaoLeng: {
        name: zhaoLeng.identity.name,
        occupation: zhaoLeng.state.occupation,
        personalityTraits: zhaoLeng.core.personalityTraits,
        speechStyle: zhaoLeng.speechStyle,
      },
    },
  };
}

export function zhaoLengPrepareFingerprint(save: GameSave, nextBeatId: ZhaoLengBeatId): string {
  const mode = save.zhaoLeng?.generationMode ?? "scripted";
  const branchId = save.activeBranchId ?? save.sceneRuntime?.branchId ?? "main";
  return createStoryInputFingerprint({
    source: mode === "llm" ? "zhao_ai" : "zhao_scripted",
    saveId: save.worldState.gameId,
    runId: save.worldState.gameId,
    branchId,
    pipelineVersion: ZHAO_LENG_PREPARE_PIPELINE_VERSION,
    unitId: nextBeatId,
    facts: semanticFacts(save, nextBeatId),
  });
}
