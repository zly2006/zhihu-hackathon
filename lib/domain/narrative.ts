// Narrative Engine 领域类型（V1.1 迭代方案 §4.3）
// NarrativeNeed = What to reveal（检索需求）
// NarrativeEvidenceBundle = KB 检索结果
// NarrativePlan = How to reveal it（Director 产物，LLM 生成 + 校验器兜底）
// Novel = How to write it（Writer 只写正文）

import type { ChapterId, LifeDomain } from "./shared";
import type { RelationshipType } from "./relationship";
import type { NarrativePacingDirective } from "./narrative-experience";

export type NarrativeFunction =
  | "setup"
  | "bonding"
  | "conflict"
  | "decision"
  | "reversal"
  | "loss"
  | "reconciliation"
  | "climax"
  | "aftermath"
  | "hook";

export type NarrativeNeed = {
  chapterId: string;
  lifeDomains: LifeDomain[];
  relationshipTypes: RelationshipType[];
  centralEvents: string[];
  conflictTypes: string[];
  desiredTone: string;
  narrativeFunctions: NarrativeFunction[];
};

export type NarrativeReference = {
  fragmentId: string;
  sourceId: string;
  functionTags: string[];
  conflictTags: string[];
  relationshipTags: string[];
  techniqueSummary: string;
  structureSummary: string;
  emotionalCurve: string[];
  safeExcerpt?: string;
  similarity: number;
  qualityScore: number;
};

export type NarrativeChoicePattern = {
  id: string;
  fragmentId: string;
  type: string;
  options: string[];
  effects: Record<string, unknown>;
  sourceId: string;
  similarity: number;
};

export type NarrativeCharacterArcPattern = {
  id: string;
  fragmentId: string;
  stage: string;
  stateBefore: string;
  stateAfter: string;
  sourceId: string;
  similarity: number;
};

export type NarrativeDirectorTrigger =
  "npc_goal" | "relationship" | "player_choice" | "canonical_event";

export type NarrativeDirectorBrief = {
  trigger: NarrativeDirectorTrigger;
  focusCharacterId: string;
  focusEventIds: string[];
  focusThreadIds: string[];
  dramaticQuestion: string;
  tensionLevel: "quiet" | "rising" | "high";
  // V3.3：跨章节的节奏约束；只控制呈现，不新增或改写 canonical 事实。
  pacing?: NarrativePacingDirective;
};

export type NarrativeEvidenceBundle = {
  querySummary: string;
  arcPatterns: NarrativeReference[];
  scenePatterns: NarrativeReference[];
  dialoguePatterns: NarrativeReference[];
  pacingPatterns: NarrativeReference[];
  endingPatterns: NarrativeReference[];
  total: number;
  // V2.5：兼容旧响应；新 bundle 始终填充这两个数组。
  choicePatterns?: NarrativeChoicePattern[];
  characterArcPatterns?: NarrativeCharacterArcPattern[];
};

export type ScenePlan = {
  id: string;
  order: number;
  timeLabel: string;
  location: string;
  participantIds: string[];
  povCharacterId: string;
  sourceEventIds: string[];
  purpose: "setup" | "development" | "conflict" | "turning_point" | "climax" | "aftermath" | "hook";
  visibleGoal: string;
  conflict: string;
  startEmotion: string;
  endEmotion: string;
  mustShow: string[];
  mustNotInvent: string[];
  dialogueIntent?: string;
  narrativeTechniques: string[];
  endingBeat: string;
};

export type CharacterArcPlan = {
  characterId: string;
  startState: string;
  pressure: string;
  change: string;
  endState: string;
};

export type NarrativePlan = {
  version: 1;
  titleDirection: string;
  theme: string;
  emotionalCore: string;
  mainConflict: string;
  characterArcs: CharacterArcPlan[];
  scenes: ScenePlan[];
  endingHook: {
    textGoal: string;
    type:
      | "open_question"
      | "relationship_tension"
      | "new_opportunity"
      | "unresolved_cost"
      | "quiet_aftershock";
  };
  referenceFragmentIds: string[];
  canonicalEventIds: string[];
  // V3.2：程序从公开状态推导的下一幕聚焦建议；不携带 NPC 私密字段。
  directorBrief?: NarrativeDirectorBrief;
};
