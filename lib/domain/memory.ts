// CharacterMemory（方案 §11）
// 小说是“阅读档案”，CharacterMemory 才是“游戏长期记忆”。
// 长期玩 20 章后可能产生数万甚至十几万字小说，不能全部回传 Prompt。

import type { ChapterId, CharacterId, LifeDomain, MemoryId, SimulationEventId } from "./shared";

export type MemoryType =
  | "event"
  | "relationship"
  | "achievement"
  | "setback"
  | "promise"
  | "conflict"
  | "reflection";

export type EmotionalValence = -2 | -1 | 0 | 1 | 2;

export type CharacterMemory = {
  id: MemoryId;
  characterId: CharacterId;

  year: number;
  chapterId: ChapterId;
  eventId?: SimulationEventId;

  type: MemoryType;

  summary: string;

  relatedCharacterIds: CharacterId[];
  domains: LifeDomain[];

  importance: number; // 0-100
  emotionalValence: EmotionalValence;

  permanentFact: boolean;
  active: boolean;
};

// 每章记忆策略（方案 §11.3）：下一章使用 永久事实 + 最近 2 章摘要 +
// 与当前选择最相关的最多 8 条长期记忆 + 当前活跃 Hooks，而不是最近 N 条简单截断。
// 检索评分建议：score = relevance*0.45 + importance*0.30 + recency*0.15 + relationship_match*0.10

export const MEMORY_PER_CHAPTER_MIN = 3;
export const MEMORY_PER_CHAPTER_MAX = 6;
export const MEMORY_RETRIEVAL_LIMIT = 8;
