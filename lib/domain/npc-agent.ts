// NPC Agent 领域契约（V3.1）
// NPC Agent 只描述本章一次的自主行动倾向，不直接修改 WorldState，
// 也不绕过 World Simulator 生成 canonical 事件。

import type { ChapterDecision } from "./chapter";
import type { CharacterId, ChapterId, RelationshipId } from "./shared";
import type { WorldState } from "./world";

export type NpcAgentAction =
  | "contact_player"
  | "seek_support"
  | "advance_goal"
  | "negotiate_relationship"
  | "withdraw"
  | "support_player";

export type NpcAgentDirective = {
  id: string;
  chapterId: ChapterId;
  characterId: CharacterId;
  action: NpcAgentAction;
  targetCharacterIds: CharacterId[];
  relationshipIds: RelationshipId[];
  sourceGoalIds: string[];
  urgency: number;
  // 仅供服务端 World Simulator 使用；不得进入 SSE、存档或客户端展示。
  privateIntent: string;
};

export type NpcAgentPlanningInput = {
  chapterId: ChapterId;
  world: WorldState;
  decision: ChapterDecision;
  startYear: number;
  endYear: number;
};

export type NpcAgentTrace = {
  directiveId: string;
  characterId: CharacterId;
  action: NpcAgentAction;
  targetCharacterIds: CharacterId[];
  relationshipIds: RelationshipId[];
  urgency: number;
};
