import type { Character } from "../domain/character";
import type { GameSave } from "../domain/chapter";
import type { Relationship } from "../domain/relationship";
import type { WorldState } from "../domain/world";
import type { GameMode } from "../domain/shared";
import {
  createInitialGameSave,
  createInitialWorldState,
  createNpc,
  createProtagonist,
  createRelationship,
} from "./character-factory";
import { refreshActiveSnapshot } from "./snapshot-manager";
import {
  ZHAO_LENG_DEMO_ID,
  createInitialNarrativeRuntime,
  createInitialZhaoLengRuntime,
} from "../domain/zhao-leng-runtime";

export const ZHAO_LENG_GAME_ID = "zhao-leng-demo-game-v1" as const;
export const ZHAO_LENG_CHAPTER_ID = "zhao-leng-demo-session" as const;
export const ZHAO_LENG_SAVE_KEYS = {
  llm: "restart-life-zhao-leng-demo-v1-llm",
  scripted: "restart-life-zhao-leng-demo-v1-scripted",
} as const;
export const ZHAO_LENG_CHARACTER_IDS = {
  protagonist: "protagonist",
  zhaoLeng: "npc-zhao-leng",
} as const;
export const ZHAO_LENG_RELATIONSHIP_ID = "rel-protagonist-zhao-leng" as const;

export type CreateZhaoLengDemoSaveInput = {
  mode: "llm" | "scripted";
  currentYear?: number;
  now?: string;
};

function reidentify(character: Character, id: string, state: Partial<Character["state"]>): Character {
  return {
    ...character,
    id,
    state: { ...character.state, ...state },
    relationshipHistory: [],
  };
}

function createZhaoLengWorld(currentYear: number, now: string): WorldState {
  const protagonist = reidentify(
    createProtagonist(
      {
        name: "主角",
        birthYear: currentYear - 24,
        gender: "未设定",
        hometown: "这座城市",
        familyBackground: "普通家庭",
        initialCity: "本地",
        initialDirection: "自由职业者",
        personalityTraits: ["谨慎", "愿意倾听", "重视具体安排"],
        values: ["诚实", "边界"],
        longTermGoal: "把能做到的事做得可靠",
        initialDilemma: "在工作节奏和关系承诺之间找到真实的范围",
        talents: { insight: 50, charm: 50, grit: 50, learning: 50, luck: 50 },
        speechStyle: "先说事实，再说自己能承担的部分",
      },
      now,
    ),
    ZHAO_LENG_CHARACTER_IDS.protagonist,
    { age: 24, year: currentYear },
  );
  const zhaoLeng = reidentify(
    createNpc(
      {
        name: "赵冷",
        gender: "女",
        age: 26,
        relationshipType: "friend",
        basicSetting: "城市档案编辑，习惯把来源和结论分开记录",
        personalityTraits: ["克制", "清醒", "重视自主决定"],
        values: ["准确", "边界", "持续行动"],
        hiddenGoal: "完成一批一直想做的城市档案",
        hiddenConcern: "不希望自己的选择被亲近的人代替",
        privateBelief: "能被兑现的具体话，比漂亮承诺更可靠",
        speechStyle: "先核对事实，再说自己的判断；不替别人总结感受",
      },
      currentYear,
      now,
    ),
    ZHAO_LENG_CHARACTER_IDS.zhaoLeng,
    { age: 26, year: currentYear },
  );
  const relationship = createRelationship(
    protagonist.id,
    zhaoLeng.id,
    "friend",
    "两人在公开档案校对活动中交换联系方式，尚未发展恋爱关系。",
    now,
  );
  const stableRelationship: Relationship = {
    ...relationship,
    id: ZHAO_LENG_RELATIONSHIP_ID,
    scores: { closeness: 45, trust: 40, conflict: 10, commitment: 10 },
  };
  const world = createInitialWorldState(protagonist, [zhaoLeng], [stableRelationship], now);
  return {
    ...world,
    gameId: ZHAO_LENG_GAME_ID,
    currentYear,
  };
}

export function createZhaoLengDemoSave(input: CreateZhaoLengDemoSaveInput): GameSave {
  const now = input.now ?? new Date().toISOString();
  const currentYear = input.currentYear ?? new Date(now).getUTCFullYear();
  const mode: GameMode = "galgame";
  const base = createInitialGameSave(createZhaoLengWorld(currentYear, now), now, mode);
  const withRuntime: GameSave = {
    ...base,
    zhaoLeng: createInitialZhaoLengRuntime({ mode: input.mode }),
    narrativeRuntime: createInitialNarrativeRuntime(),
    scenePackages: {},
    sceneActions: [],
    sceneFlags: {},
    saveRevision: 0,
  };
  return refreshActiveSnapshot(withRuntime, now);
}

export function getZhaoLengRelationship(save: Pick<GameSave, "worldState">): Relationship {
  const relationship = save.worldState.relationships[ZHAO_LENG_RELATIONSHIP_ID];
  if (!relationship) throw new Error("赵冷 Demo 存档缺少主角与赵冷关系");
  return relationship;
}

export function getZhaoLengCharacters(save: Pick<GameSave, "worldState">): {
  protagonist: Character;
  zhaoLeng: Character;
} {
  const protagonist = save.worldState.characters[ZHAO_LENG_CHARACTER_IDS.protagonist];
  const zhaoLeng = save.worldState.characters[ZHAO_LENG_CHARACTER_IDS.zhaoLeng];
  if (!protagonist || !zhaoLeng) throw new Error("赵冷 Demo 存档缺少稳定角色身份");
  return { protagonist, zhaoLeng };
}

export function isZhaoLengDemoSave(save: Pick<GameSave, "worldState" | "zhaoLeng">): boolean {
  return save.worldState.gameId === ZHAO_LENG_GAME_ID && save.zhaoLeng?.demoId === ZHAO_LENG_DEMO_ID;
}
