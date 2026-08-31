// WorldState（方案 §12）
// 本局游戏唯一权威状态。SimulationEvent 是 canonical facts，
// Chapter 的 novel 只是对 canonical facts 的文学表达，可重写文风但不能改变事实。

import type {
  ChapterId,
  CharacterId,
  LifeDomain,
  MemoryId,
  RelationshipId,
  SimulationEventId,
} from "./shared";
import type { Character } from "./character";
import type { CharacterMemory } from "./memory";
import type { Relationship } from "./relationship";

export type StoryThread = {
  id: string;
  label: string;
  description: string;
  domain: LifeDomain;
  relatedCharacterIds: CharacterId[];
  urgency: number; // 0-100
  status: "open" | "resolved" | "dormant";
};

// 时代背景快照（方案 §23）。历史年份使用真实 EraDefinition；
// 未来年份只能生成“弱假设的通用社会背景”，eraContext 为 null 仅作技术 fallback。
export type EraContextSnapshot = {
  id: string;
  title: string;
  year: number;
  domain: string;
  summary: string;
  ageFrame: string;
  relevance: number;
  intensity: "背景" | "显著" | "强烈";
  keywords: string[];
  mechanisms: string[];
  isFutureFallback: boolean; // true = 未来年份弱假设通用背景
};

export type WorldState = {
  schemaVersion: 1;
  gameId: string;

  currentYear: number;
  protagonistId: CharacterId;

  characters: Record<CharacterId, Character>;
  relationships: Record<RelationshipId, Relationship>;
  memories: Record<MemoryId, CharacterMemory>;

  chapterIds: ChapterId[];

  eraContext?: EraContextSnapshot | null;

  openThreads: StoryThread[];

  canonicalEventIds: SimulationEventId[];

  updatedAt: string;
};
