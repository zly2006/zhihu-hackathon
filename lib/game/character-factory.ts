// 角色工厂与初始 WorldState 构造（Phase 1）
// 纯函数，不依赖 LLM。主角 18 岁开局；NPC 由 npc-generator 生成后在这里落成 Character。

import { randomUUID } from "node:crypto";
import type { Character } from "../domain/character";
import type { Relationship, RelationshipType, RelationshipScores } from "../domain/relationship";
import type { WorldState } from "../domain/world";
import type { GameSave } from "../domain/chapter";
import { clampLifeStats, clampTalents, type LifeStats, type Talents } from "../domain/shared";

export type ProtagonistDraft = {
  name: string;
  birthYear: number;
  gender: string;
  hometown: string;
  familyBackground: string;
  initialCity: string;
  initialDirection: string; // 起点方向：职业/身份方向，作为 occupation 与 socialIdentity 的种子
  personalityTraits: string[]; // 3-5
  values: string[]; // 2-4
  longTermGoal: string;
  initialDilemma: string;
  talents: Talents;
};

export type NpcDraft = {
  name: string;
  gender: string;
  age: number;
  relationshipType: RelationshipType;
  basicSetting: string; // 一句公开设定，玩家可编辑
  personalityTraits: string[];
  values: string[];
  hiddenGoal: string;
  hiddenConcern: string;
  privateBelief: string;
};

// 18 岁开局状态基线（0-100 安全度指数，非绝对数值）
export const STARTING_LIFE_STATS: LifeStats = {
  cash: 35,
  health: 80,
  happiness: 60,
  knowledge: 50,
  connections: 25,
  career: 15,
  assets: 5,
};

export function initialRelationshipScores(type: RelationshipType): RelationshipScores {
  switch (type) {
    case "family":
      return { closeness: 65, trust: 70, conflict: 25, commitment: 80 };
    case "spouse":
      return { closeness: 60, trust: 65, conflict: 25, commitment: 70 };
    case "partner":
      return { closeness: 55, trust: 55, conflict: 20, commitment: 45 };
    case "close_friend":
      return { closeness: 58, trust: 58, conflict: 15, commitment: 40 };
    case "friend":
    case "classmate":
    case "coworker":
      return { closeness: 50, trust: 50, conflict: 15, commitment: 35 };
    case "rival":
      return { closeness: 20, trust: 30, conflict: 60, commitment: 15 };
    case "estranged":
      return { closeness: 15, trust: 20, conflict: 55, commitment: 10 };
    case "ex_partner":
      return { closeness: 25, trust: 30, conflict: 50, commitment: 10 };
    default:
      return { closeness: 40, trust: 40, conflict: 15, commitment: 25 };
  }
}

export function createProtagonist(draft: ProtagonistDraft, now = new Date().toISOString()): Character {
  const birthYear = Math.max(1900, Math.min(2026, Math.round(draft.birthYear)));
  const year = birthYear + 18;
  return {
    id: `protagonist-${randomUUID()}`,
    role: "protagonist",
    identity: {
      name: draft.name.trim() || "主角",
      birthYear,
      gender: draft.gender,
      hometown: draft.hometown,
      familyBackground: draft.familyBackground,
    },
    core: {
      personalityTraits: draft.personalityTraits.map((item) => item.trim()).filter(Boolean).slice(0, 5),
      values: draft.values.map((item) => item.trim()).filter(Boolean).slice(0, 4),
      talents: clampTalents(draft.talents),
      hooks: [],
    },
    state: {
      age: 18,
      year,
      city: draft.initialCity,
      occupation: draft.initialDirection,
      socialIdentity: draft.initialDirection,
      stats: clampLifeStats({ ...STARTING_LIFE_STATS }),
      currentGoals: [
        {
          id: `goal-${randomUUID()}`,
          label: draft.longTermGoal,
          horizon: "long",
          priority: 80,
          status: "active",
        },
      ],
      currentDilemmas: draft.initialDilemma ? [draft.initialDilemma] : [],
      attitudes: {},
    },
    privateState: undefined,
    memoryIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createNpc(draft: NpcDraft, currentYear: number, now = new Date().toISOString()): Character {
  const age = Math.max(0, Math.round(draft.age));
  const birthYear = currentYear - age;
  return {
    id: `npc-${randomUUID()}`,
    role: "npc",
    identity: {
      name: draft.name.trim() || "未命名",
      birthYear,
      gender: draft.gender,
      hometown: "",
      familyBackground: "",
    },
    core: {
      personalityTraits: draft.personalityTraits.map((item) => item.trim()).filter(Boolean).slice(0, 5),
      values: draft.values.map((item) => item.trim()).filter(Boolean).slice(0, 4),
      talents: { insight: 50, charm: 50, grit: 50, learning: 50, luck: 50 },
      hooks: [],
    },
    state: {
      age,
      year: currentYear,
      city: "",
      occupation: "",
      socialIdentity: "",
      stats: clampLifeStats({ ...STARTING_LIFE_STATS }),
      currentGoals: [],
      currentDilemmas: [],
      attitudes: {},
    },
    privateState: {
      hiddenGoals: draft.hiddenGoal ? [draft.hiddenGoal] : [],
      hiddenConcerns: draft.hiddenConcern ? [draft.hiddenConcern] : [],
      privateBeliefs: draft.privateBelief ? [draft.privateBelief] : [],
    },
    memoryIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createRelationship(
  protagonistId: string,
  npcId: string,
  type: RelationshipType,
  publicSummary: string,
  now = new Date().toISOString(),
): Relationship {
  return {
    id: `rel-${randomUUID()}`,
    characterAId: protagonistId,
    characterBId: npcId,
    type,
    scores: initialRelationshipScores(type),
    publicSummary,
    unresolvedIssues: [],
    milestoneEventIds: [],
    status: "active",
    updatedAt: now,
  };
}

// 组装初始 WorldState：1 主角 + 3 NPC + 3 条关系
export function createInitialWorldState(
  protagonist: Character,
  npcs: Character[],
  relationships: Relationship[],
  now = new Date().toISOString(),
): WorldState {
  const characters: Record<string, Character> = { [protagonist.id]: protagonist };
  for (const npc of npcs) characters[npc.id] = npc;
  const relationshipMap: Record<string, Relationship> = {};
  for (const rel of relationships) relationshipMap[rel.id] = rel;

  return {
    schemaVersion: 1,
    gameId: `game-${randomUUID()}`,
    currentYear: protagonist.state.year,
    protagonistId: protagonist.id,
    characters,
    relationships: relationshipMap,
    memories: {},
    chapterIds: [],
    eraContext: null,
    openThreads: [],
    canonicalEventIds: [],
    updatedAt: now,
  };
}

export function createInitialGameSave(world: WorldState, now = new Date().toISOString()): GameSave {
  return {
    schemaVersion: 1,
    savedAt: now,
    worldState: world,
    chapters: {},
    events: {},
    experienceCache: {},
  };
}
