// 中性 Demo 的宏观基线与章节注册。
// 这是 B 的运行时夹具，不承载正式角色、剧情或模型生成结果。

import type { Character } from "../domain/character";
import type { Chapter, GameSave } from "../domain/chapter";
import type { ChapterSpan } from "../domain/shared";
import type { WorldSimulationOutput } from "../domain/simulation";
import type { Relationship } from "../domain/relationship";
import type { ScenePackage } from "../domain/scene";
import type { WorldState } from "../domain/world";
import { validateWorldState } from "../domain/validate";
import { createSceneRuntime } from "./scene-runtime";
import { appendSnapshot, initializeSnapshotState } from "./snapshot-manager";
import { hashState } from "./hash";
import { reduceWorldState } from "./world-reducer";
import { createNeutralScenePackages, NEUTRAL_CHARACTER_IDS } from "./neutral-scene-package";

export const NEUTRAL_DEMO_GAME_ID = "synthetic-neutral-scene-demo";
export const NEUTRAL_DEMO_SAVE_KEY = "restart-life-neutral-scene-demo-v1";
export const NEUTRAL_DEMO_DEFAULT_NOW = "2026-01-01T00:00:00.000Z";

export type NeutralSyntheticSimulationOutput = WorldSimulationOutput & {
  synthetic: true;
};

function neutralCharacter(
  id: string,
  name: string,
  role: Character["role"],
  currentYear: number,
  now: string,
): Character {
  return {
    id,
    role,
    identity: {
      name,
      birthYear: currentYear - (role === "protagonist" ? 18 : 20),
      gender: "未设定",
      hometown: "测试城市",
      familyBackground: "中性测试夹具",
    },
    core: {
      personalityTraits: ["谨慎"],
      values: ["诚实"],
      talents: { insight: 50, charm: 50, grit: 50, learning: 50, luck: 50 },
      hooks: [],
    },
    state: {
      age: role === "protagonist" ? 18 : 20,
      year: currentYear,
      city: "测试城市",
      occupation: "测试工作",
      socialIdentity: "测试身份",
      stats: { cash: 35, health: 80, happiness: 60, knowledge: 50, connections: 25, career: 15, assets: 5 },
      currentGoals: [],
      currentDilemmas: [],
      attitudes: {},
    },
    speechStyle: "表达清楚具体",
    emotionState: "平静",
    relationshipHistory: [],
    memoryIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createNeutralDemoWorld(
  currentYear = 2026,
  now = NEUTRAL_DEMO_DEFAULT_NOW,
): WorldState {
  const characters = {
    [NEUTRAL_CHARACTER_IDS.protagonist]: neutralCharacter(
      NEUTRAL_CHARACTER_IDS.protagonist,
      "测试主角",
      "protagonist",
      currentYear,
      now,
    ),
    [NEUTRAL_CHARACTER_IDS.first]: neutralCharacter(
      NEUTRAL_CHARACTER_IDS.first,
      "测试角色甲",
      "npc",
      currentYear,
      now,
    ),
    [NEUTRAL_CHARACTER_IDS.second]: neutralCharacter(
      NEUTRAL_CHARACTER_IDS.second,
      "测试角色乙",
      "npc",
      currentYear,
      now,
    ),
    [NEUTRAL_CHARACTER_IDS.third]: neutralCharacter(
      NEUTRAL_CHARACTER_IDS.third,
      "测试角色丙",
      "npc",
      currentYear,
      now,
    ),
  };
  const relationship = (id: string, target: string, score = 50): Relationship => ({
    id,
    characterAId: NEUTRAL_CHARACTER_IDS.protagonist,
    characterBId: target,
    type: "friend",
    scores: { closeness: score, trust: score, conflict: 10, commitment: 35 },
    publicSummary: "中性测试关系",
    unresolvedIssues: [],
    milestoneEventIds: [],
    status: "active",
    updatedAt: now,
  });
  const world: WorldState = {
    schemaVersion: 1,
    gameId: NEUTRAL_DEMO_GAME_ID,
    currentYear,
    protagonistId: NEUTRAL_CHARACTER_IDS.protagonist,
    characters,
    relationships: {
      "test-relationship-a": relationship("test-relationship-a", NEUTRAL_CHARACTER_IDS.first),
      "test-relationship-b": relationship("test-relationship-b", NEUTRAL_CHARACTER_IDS.second, 42),
      "test-relationship-c": relationship("test-relationship-c", NEUTRAL_CHARACTER_IDS.third, 35),
    },
    memories: {},
    chapterIds: [],
    eraContext: null,
    openThreads: [],
    canonicalEventIds: [],
    updatedAt: now,
  };
  validateWorldState(world);
  return world;
}

/**
 * 合成输出只负责把“本章宏观时间边界”交给统一 reducer；不制造现实证据或伪造宏观事件。
 * synthetic 标记只用于夹具验收，不能进入正式模型输出。
 */
export function createNeutralSyntheticSimulation(
  chapterId: string,
): NeutralSyntheticSimulationOutput {
  return {
    synthetic: true,
    events: [],
    newMemories: [],
    goalUpdates: [],
    hookUpdates: [],
    threadUpdates: { create: [], resolveIds: [], dormantIds: [] },
    chapterSummary: {
      keyEvents: [`${chapterId} 的中性宏观基线已注册`],
      characterChanges: [],
      relationshipChanges: [],
      unresolvedQuestions: [],
    },
  };
}

function neutralDecision(chapterId: string): Chapter["decision"] {
  return {
    id: `synthetic-decision:${chapterId}`,
    promptTitle: "中性玩法测试基线",
    context: "本记录只为验证宏观章节与 live 场景的先后关系，不代表正式剧情内容。",
    options: [
      {
        id: "A",
        label: "继续测试流程",
        description: "进入当前章节的 live 场景。",
        strategyTag: "continue",
        estimatedRisk: 0,
        stateFit: "可行",
      },
      {
        id: "B",
        label: "检查保存状态",
        description: "验证章节快照和运行时位置。",
        strategyTag: "inspect",
        estimatedRisk: 0,
        stateFit: "可行",
      },
      {
        id: "C",
        label: "结束测试流程",
        description: "验证章节边界不会自动替玩家推进。",
        strategyTag: "stop",
        estimatedRisk: 0,
        stateFit: "可行",
      },
    ],
    selectedOptionId: "A",
    normalizedAction: "继续测试流程",
  };
}

function createNeutralMacroChapter(
  before: WorldState,
  after: WorldState,
  packageItem: ScenePackage,
  output: NeutralSyntheticSimulationOutput,
  now: string,
): Chapter {
  const startYear = before.currentYear;
  const endYear = packageItem.scenes[0]?.year ?? startYear;
  const span: ChapterSpan = endYear - startYear === 3 ? 3 : 1;
  return {
    id: packageItem.chapterId,
    index: before.chapterIds.length,
    startYear,
    endYear,
    span,
    stateBeforeHash: hashState(before),
    decision: neutralDecision(packageItem.chapterId),
    resolution: {
      effectiveRisk: 0,
      outcomeAnchor: "favorable",
      uncertaintySeed: `synthetic:${packageItem.chapterId}`,
      reasonSummary: "中性夹具的宏观基线不产生随机结算。",
    },
    evidence: { experienceIds: [], featuredExperienceIds: [] },
    simulationEventIds: output.events.map((event) => event.id),
    stateAfterHash: hashState(after),
    novel: {
      title: "中性玩法宏观基线",
      subtitle: "synthetic fixture",
      scenes: [
        {
          id: `synthetic-novel:${packageItem.chapterId}`,
          heading: "测试记录",
          timeLabel: `${endYear} 年 · 宏观基线`,
          text: "这是中性玩法夹具的章节登记记录，live 场景从当前时间继续，不把测试对白写入历史回顾。",
        },
      ],
      generatedAt: now,
      version: 1,
    },
    summary: {
      keyEvents: output.chapterSummary.keyEvents,
      characterChanges: [],
      relationshipChanges: [],
      openThreads: [],
    },
    memoryIds: [],
    createdAt: now,
  };
}

/** 幂等地登记一个宏观夹具章节，并用统一 reducer 推进到其 live 年份。 */
export function registerNeutralMacroChapter(
  save: GameSave,
  packageItem: ScenePackage,
  now = new Date().toISOString(),
): GameSave {
  const existingChapter = save.chapters[packageItem.chapterId];
  if (existingChapter && save.worldState.chapterIds.includes(packageItem.chapterId)) return save;
  const prepared = initializeSnapshotState(save, now);
  const startYear = prepared.worldState.currentYear;
  const endYear = packageItem.scenes[0]?.year ?? startYear;
  if (!Number.isInteger(endYear) || endYear < startYear) {
    throw new Error("中性 Demo 的宏观章节年份必须不早于当前世界年份");
  }
  const output = createNeutralSyntheticSimulation(packageItem.chapterId);
  const worldState = reduceWorldState(prepared.worldState, output, {
    chapterId: packageItem.chapterId,
    endYear,
    now,
    recordChapter: true,
    newId: () => `synthetic-id:${packageItem.chapterId}`,
  });
  const chapter = createNeutralMacroChapter(prepared.worldState, worldState, packageItem, output, now);
  const next: GameSave = {
    ...prepared,
    savedAt: now,
    worldState,
    chapters: { ...prepared.chapters, [chapter.id]: chapter },
    scenePackages: { ...(prepared.scenePackages ?? {}), [packageItem.chapterId]: packageItem },
  };
  return appendSnapshot(next, { chapterId: chapter.id, now });
}

export function createNeutralDemoSave(
  currentYear = 2026,
  now = NEUTRAL_DEMO_DEFAULT_NOW,
): GameSave {
  const packages = createNeutralScenePackages(currentYear);
  const base: GameSave = {
    schemaVersion: 1,
    savedAt: now,
    worldState: createNeutralDemoWorld(currentYear, now),
    chapters: {},
    events: {},
    experienceCache: {},
    presentationMode: "galgame",
    activeBranchId: "main",
    scenePackages: Object.fromEntries(packages.map((packageItem) => [packageItem.chapterId, packageItem])),
    sceneActions: [],
    sceneFlags: {},
    saveRevision: 0,
  };
  const registered = registerNeutralMacroChapter(base, packages[0], now);
  const runtime = createSceneRuntime(packages[0], { branchId: registered.activeBranchId ?? "main" });
  const snapshotted = appendSnapshot(registered, {
    chapterId: packages[0].chapterId,
    sceneRuntime: runtime,
    sceneActions: registered.sceneActions,
    sceneFlags: registered.sceneFlags,
    now,
  });
  return {
    ...snapshotted,
    sceneRuntime: runtime,
  };
}

function orderedPackages(save: GameSave): ScenePackage[] {
  return Object.values(save.scenePackages ?? {})
    .filter((packageItem) => packageItem.id.startsWith("test-package-"))
    .sort((left, right) => (left.scenes[0]?.year ?? 0) - (right.scenes[0]?.year ?? 0));
}

/**
 * 从已完成的当前 live 包进入下一包。旧 v1 Demo 存档若缺少宏观登记，会在这里补齐，
 * 但只会补当前目标之前的中性章节，不触碰正式存档。
 */
export function advanceNeutralDemoSave(
  save: GameSave,
  nextPackage: ScenePackage,
  now = new Date().toISOString(),
): GameSave {
  if (save.worldState.gameId !== NEUTRAL_DEMO_GAME_ID) throw new Error("不是中性 Demo 存档");
  if (!save.sceneRuntime || save.sceneRuntime.status !== "completed") throw new Error("当前测试章节尚未完成");
  const packages = orderedPackages({
    ...save,
    scenePackages: { ...(save.scenePackages ?? {}), [nextPackage.chapterId]: nextPackage },
  });
  const currentIndex = packages.findIndex((packageItem) => packageItem.id === save.sceneRuntime?.packageId);
  const nextIndex = packages.findIndex((packageItem) => packageItem.id === nextPackage.id);
  if (currentIndex < 0 || nextIndex !== currentIndex + 1) throw new Error("只能进入当前测试章节的下一章");
  if ((nextPackage.scenes[0]?.year ?? save.worldState.currentYear) <= save.worldState.currentYear) {
    throw new Error("下一测试章节必须推进到新的年份");
  }

  let nextSave = save;
  for (const packageItem of packages.slice(0, nextIndex + 1)) {
    if (!nextSave.worldState.chapterIds.includes(packageItem.chapterId)) {
      nextSave = registerNeutralMacroChapter(nextSave, packageItem, now);
    }
  }
  const runtime = createSceneRuntime(nextPackage, {
    branchId: nextSave.activeBranchId ?? save.sceneRuntime.branchId,
    playbackMode: save.sceneRuntime.playbackMode,
  });
  const snapshotted = appendSnapshot(nextSave, {
    chapterId: nextPackage.chapterId,
    sceneRuntime: runtime,
    sceneActions: nextSave.sceneActions,
    sceneFlags: nextSave.sceneFlags,
    now,
  });
  return {
    ...snapshotted,
    savedAt: now,
    saveRevision: (snapshotted.saveRevision ?? 0) + 1,
    sceneRuntime: runtime,
  };
}
