import type { GameSave } from "../domain/chapter";
import type { ScenePackage } from "../domain/scene";
import type { ZhaoLengGenerationMode } from "../domain/zhao-leng-runtime";
import { createSceneRuntime } from "./scene-runtime";
import { normalizeSceneSave } from "./scene-save";
import { appendSnapshot } from "./snapshot-manager";
import { enqueueScriptedBeatDelivery } from "./narrative-experience-service";
import { createInitialNarrativeRuntime } from "../domain/zhao-leng-runtime";
import { generateZhaoLengBeat } from "./zhao-leng-writer";
import { createZhaoLengDemoSave, isZhaoLengDemoSave, ZHAO_LENG_CHAPTER_ID } from "./zhao-leng-demo";
import { compileZhaoLengBeat } from "./zhao-leng-package";
import { zhaoLengFlags } from "./zhao-leng-progress";

export type StartZhaoLengDemoInput = {
  save?: GameSave;
  mode?: ZhaoLengGenerationMode;
  currentYear?: number;
  now?: string;
};

export type StartZhaoLengDemoResult = {
  saveAfter: GameSave;
  scenePackage: ScenePackage;
  reused: boolean;
};

function activePackage(save: GameSave): ScenePackage | undefined {
  const runtime = save.sceneRuntime;
  if (!runtime) return undefined;
  const packageItem = save.scenePackages?.[ZHAO_LENG_CHAPTER_ID];
  return packageItem?.id === runtime.packageId && packageItem.version === runtime.packageVersion
    ? packageItem
    : save.zhaoLeng?.packagesById[runtime.packageId];
}

export async function startZhaoLengDemo(input: StartZhaoLengDemoInput = {}): Promise<StartZhaoLengDemoResult> {
  const now = input.now ?? new Date().toISOString();
  const base = input.save
    ? normalizeSceneSave(input.save)
    : createZhaoLengDemoSave({ mode: input.mode ?? "scripted", currentYear: input.currentYear, now });
  if (!isZhaoLengDemoSave(base) || !base.zhaoLeng) throw new Error("当前存档不是有效的赵冷 Demo 存档");
  const zhaoLengRuntime = base.zhaoLeng;
  const requestedMode = input.mode ?? zhaoLengRuntime.generationMode;
  if (requestedMode !== zhaoLengRuntime.generationMode) throw new Error("已有赵冷 Demo 存档不能切换生成模式");

  const existing = activePackage(base);
  if (base.sceneRuntime && existing) {
    const upgradedRuntime = base.sceneRuntime.skipPolicy === "read"
      ? base.sceneRuntime
      : { ...base.sceneRuntime, skipPolicy: "read" as const };
    const saveAfter = upgradedRuntime === base.sceneRuntime ? base : { ...base, sceneRuntime: upgradedRuntime };
    return { saveAfter, scenePackage: existing, reused: true };
  }

  const beatId = zhaoLengRuntime.beatId;
  const written = await generateZhaoLengBeat({ save: base, beatId, mode: requestedMode });
  const prepared: GameSave = { ...base, zhaoLeng: zhaoLengRuntime, sceneFlags: zhaoLengFlags(base) };
  const scenePackage = compileZhaoLengBeat({ save: prepared, beatId, written });
  const runtime = createSceneRuntime(scenePackage, {
    branchId: prepared.activeBranchId ?? "main",
    skipPolicy: "read",
  });
  const narrativeRuntime = enqueueScriptedBeatDelivery(
    prepared.narrativeRuntime ?? createInitialNarrativeRuntime(),
    beatId,
    runtime.branchId,
  );
  const next: GameSave = {
    ...prepared,
    savedAt: now,
    scenePackages: { ...(prepared.scenePackages ?? {}), [ZHAO_LENG_CHAPTER_ID]: scenePackage },
    sceneRuntime: runtime,
    narrativeRuntime,
    zhaoLeng: {
      ...zhaoLengRuntime,
      packagesById: { ...(zhaoLengRuntime.packagesById ?? {}), [scenePackage.id]: scenePackage },
      cacheKeys: { ...(zhaoLengRuntime.cacheKeys ?? {}), [beatId]: scenePackage.id },
    },
  };
  return {
    saveAfter: appendSnapshot(next, {
      chapterId: ZHAO_LENG_CHAPTER_ID,
      sceneRuntime: runtime,
      sceneActions: next.sceneActions,
      sceneFlags: next.sceneFlags,
      now,
    }),
    scenePackage,
    reused: false,
  };
}
