// Character（方案 §9）
// 主角与 NPC 使用同一结构，区别只在 role。NPC 是真正拥有状态的人，
// 而不是主角旁边的一段描述文字。

import type { ChapterId, MemoryId, RelationshipId, Talents } from "./shared";
import type { LifeStats } from "./shared";
import type { RelationshipType } from "./relationship";
import type { CharacterVisual } from "./visual";

export type CharacterHook = {
  id: string;
  label: string;
  description: string;
  status: "active" | "resolved" | "transformed";
  originMemoryId?: MemoryId;
  resolvedAtChapterId?: ChapterId;
};

export type CharacterGoal = {
  id: string;
  label: string;
  horizon: "short" | "medium" | "long";
  priority: number; // 0-100
  status: "active" | "achieved" | "abandoned" | "blocked";
};

export type CharacterRelationshipHistory = {
  relationshipId: RelationshipId;
  chapterId: ChapterId;
  year: number;
  relationshipType: RelationshipType;
  summary: string;
};

export type Character = {
  id: string; // CharacterId
  role: "protagonist" | "npc";

  identity: {
    name: string;
    birthYear: number;
    gender: string;
    hometown: string;
    familyBackground: string;
  };

  core: {
    personalityTraits: string[]; // 3-5
    values: string[]; // 2-4
    talents: Talents;
    hooks: CharacterHook[]; // 最多 3 个 active，避免 Prompt 膨胀
  };

  state: {
    age: number;
    year: number;
    city: string;
    occupation: string;
    socialIdentity: string;
    stats: LifeStats;
    currentGoals: CharacterGoal[];
    currentDilemmas: string[];
    attitudes: Record<string, number>;
  };

  // NPC 的隐藏状态，默认不直接展示给玩家；小说只能通过行为/对白/可观察迹象表现。
  // V1.2：currentEmotionalTrend / reflectionIds 由 CharacterReflection 演化更新（§5.2）。
  privateState?: {
    hiddenGoals: string[];
    hiddenConcerns: string[];
    privateBeliefs: string[];
    currentEmotionalTrend?: string;
    reflectionIds?: string[];
  };

  // 对话表现层使用的公开、短期状态；不替代 core/state/privateState 的既有语义。
  speechStyle?: string;
  emotionState?: string;
  relationshipHistory?: CharacterRelationshipHistory[];

  // 视觉身份（V1.3 展示层，可选；不进入世界模拟语义）
  visual?: CharacterVisual;

  memoryIds: MemoryId[];

  createdAt: string;
  updatedAt: string;
};
