// Narrative Engine 领域类型（V1.1 迭代方案 §4.3）
// NarrativeNeed = What to reveal（检索需求）
// NarrativeEvidenceBundle = KB 检索结果
// NarrativePlan = How to reveal it（Director 产物，LLM 生成 + 校验器兜底）
// Novel = How to write it（Writer 只写正文）

import type { ChapterId, LifeDomain } from "./shared";
import type { RelationshipType } from "./relationship";

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

export type NarrativeEvidenceBundle = {
  querySummary: string;
  arcPatterns: NarrativeReference[];
  scenePatterns: NarrativeReference[];
  dialoguePatterns: NarrativeReference[];
  pacingPatterns: NarrativeReference[];
  endingPatterns: NarrativeReference[];
  total: number;
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
    type: "open_question" | "relationship_tension" | "new_opportunity" | "unresolved_cost" | "quiet_aftershock";
  };
  referenceFragmentIds: string[];
  canonicalEventIds: string[];
};
