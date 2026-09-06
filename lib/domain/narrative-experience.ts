// Narrative Experience 扩展契约（V3.3）
// 这些对象只描述“下一幕如何邀请玩家参与”，不直接改变 WorldState。

import type { CharacterId, RelationshipId } from "./shared";
import type { NpcAgentAction } from "./npc-agent";

export type NarrativePacingPhase =
  "setup" | "bonding" | "conflict" | "turning_point" | "climax" | "aftermath";

// ScenePlan 的 purpose 额外包含 development 与 hook；节拍可要求其中任一场景功能。
export type NarrativeScenePurpose = NarrativePacingPhase | "development" | "hook";

export type NarrativePacingDirective = {
  chapterOrdinal: number;
  phase: NarrativePacingPhase;
  targetTension: "quiet" | "rising" | "high";
  requiredScenePurposes: NarrativeScenePurpose[];
  avoid: string[];
  rationale: string;
};

export type NpcProactiveEventKind =
  | "contact_message"
  | "support_request"
  | "relationship_conversation"
  | "goal_invitation"
  | "check_in";

// 对客户端安全的主动事件卡片。它是下一次玩家行动的建议，不是 canonical 事件。
export type NpcProactiveEvent = {
  id: string;
  directiveId: string;
  kind: NpcProactiveEventKind;
  senderId: CharacterId;
  senderName: string;
  targetCharacterIds: CharacterId[];
  relationshipIds: RelationshipId[];
  urgency: number;
  preview: string;
  sceneHook: string;
  suggestedAction: string;
  action: NpcAgentAction;
};

// 对话 prompt 使用的公开角色语言卡；绝不包含 privateState。
export type DialogueVoiceCard = {
  characterId: CharacterId;
  characterName: string;
  voiceSummary: string;
  preferredMoves: string[];
  avoid: string[];
  emotionGuidance: string;
};

export type HiddenEventStatus = "locked" | "eligible" | "consumed";

export type HiddenEventEvaluation = {
  eventId: string;
  status: HiddenEventStatus;
  // 不向玩家泄露具体前置条件，只给出可安全展示的下一步提示。
  playerHint: string;
};
