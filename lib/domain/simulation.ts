// SimulationEvent（方案 §15）与 World Simulator 输入/输出契约（方案 §19/§20）
// SimulationEvent 一旦通过校验即为 canonical，Novel Writer 不能改、重新生成小说不能改。

import type {
  ChapterId,
  CharacterId,
  ChapterSpan,
  ExperienceId,
  LifeDomain,
  LifeStats,
  RelationshipId,
  SimulationEventId,
} from "./shared";
import type { Character, CharacterGoal, CharacterHook } from "./character";
import type { CharacterMemory } from "./memory";
import type { Relationship, RelationshipType } from "./relationship";
import type { StoryThread, EraContextSnapshot } from "./world";
import type { EvidenceBundle } from "./experience";
import type { ChapterDecision, DecisionResolution } from "./chapter";
import type { NpcAgentDirective } from "./npc-agent";

export type CharacterChange = {
  characterId: CharacterId;

  statDelta?: Partial<LifeStats>;

  cityChange?: { from: string; to: string };
  occupationChange?: { from: string; to: string };
  socialIdentityChange?: { from: string; to: string };

  addGoalIds?: string[];
  resolveGoalIds?: string[];

  description: string;
};

export type RelationshipChange = {
  relationshipId: RelationshipId;

  scoreDelta: Partial<{
    closeness: number;
    trust: number;
    conflict: number;
    commitment: number;
  }>;

  typeChange?: {
    from: RelationshipType;
    to: RelationshipType;
  };

  addIssue?: string;
  resolveIssueId?: string;

  description: string;
};

export type SimulationEvent = {
  id: SimulationEventId;
  chapterId: ChapterId;

  year: number;
  month?: number | null;
  order: number;

  title: string;
  summary: string;

  domain: LifeDomain;

  participantIds: CharacterId[];

  causes: Array<{
    type: "player_choice" | "prior_event" | "relationship" | "npc_goal" | "era" | "other";
    refId?: string;
    description: string;
  }>;

  characterChanges: CharacterChange[];
  relationshipChanges: RelationshipChange[];

  evidenceIds: ExperienceId[];

  importance: number; // 0-100
  visibility: "known_to_protagonist" | "partially_known";

  createsThreadIds: string[];
  resolvesThreadIds: string[];

  // V3 Scene Runtime：即时选择产生的 canonical 事件元数据。
  // 旧章级事件不需要该字段；它只描述已通过服务端规则的场景行动。
  source?: {
    kind: "scene_choice";
    actionId: string;
    ruleId: string;
    packageId: string;
    packageVersion: number;
    sceneId: string;
    blockId: string;
  };
};

// World Simulator 输入契约（方案 §19）：服务端组装，不允许前端直接自由拼 Prompt。
export type WorldSimulationInput = {
  chapter: {
    id: ChapterId;
    startYear: number;
    endYear: number;
    span: ChapterSpan;
  };

  protagonistId: CharacterId;

  characters: Character[];
  relationships: Relationship[];

  relevantMemories: CharacterMemory[];
  openThreads: StoryThread[];

  decision: ChapterDecision;
  resolution: DecisionResolution;

  evidenceBundle: EvidenceBundle;

  // V3.1：每章一次的服务端 NPC 自主驱动；不进入客户端，不直接修改 WorldState。
  npcAgentDirectives?: NpcAgentDirective[];

  eraContext?: EraContextSnapshot | null;
};

// World Simulator 输出契约（方案 §20）
export type WorldSimulationOutput = {
  events: SimulationEvent[];

  newMemories: CharacterMemory[];

  goalUpdates: Array<{
    characterId: CharacterId;
    add: CharacterGoal[];
    update: CharacterGoal[];
  }>;

  hookUpdates: Array<{
    characterId: CharacterId;
    add?: CharacterHook[];
    resolveIds?: string[];
  }>;

  threadUpdates: {
    create: StoryThread[];
    resolveIds: string[];
    dormantIds: string[];
  };

  chapterSummary: {
    keyEvents: string[];
    characterChanges: string[];
    relationshipChanges: string[];
    unresolvedQuestions: string[];
  };
};

// 服务端校验规则常量（方案 §20.1）
export const EVENTS_PER_YEAR_SPAN: Record<ChapterSpan, [number, number]> = {
  1: [2, 4],
  3: [4, 8],
};
export const MAX_MAJOR_EVENTS_PER_CHAPTER = 2;
export const RELATIONSHIP_DELTA_CEILING = 20; // 方案 §10.3：重大变化 13-20，超过 12 必须有明确关键事件
