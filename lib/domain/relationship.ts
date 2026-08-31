// Relationship（方案 §10）
// 关系不是“好感度”：closeness / trust / conflict / commitment 四个数值必须可以并存。
// 例如一对夫妻可能 closeness=76, trust=81, conflict=68, commitment=92。

import type { CharacterId, ChapterId, SimulationEventId } from "./shared";

export type RelationshipType =
  | "family"
  | "friend"
  | "close_friend"
  | "classmate"
  | "coworker"
  | "partner"
  | "spouse"
  | "ex_partner"
  | "rival"
  | "estranged"
  | "other";

export type RelationshipScores = {
  closeness: number;
  trust: number;
  conflict: number;
  commitment: number;
};

export type RelationshipIssue = {
  id: string;
  description: string;
  severity: number; // 0-100
  introducedAtChapterId: ChapterId;
};

export type Relationship = {
  id: string; // RelationshipId

  characterAId: CharacterId;
  characterBId: CharacterId;

  type: RelationshipType;

  scores: RelationshipScores;

  publicSummary: string;

  unresolvedIssues: RelationshipIssue[];

  milestoneEventIds: SimulationEventId[];

  status: "active" | "distant" | "ended";

  updatedAt: string;
};
