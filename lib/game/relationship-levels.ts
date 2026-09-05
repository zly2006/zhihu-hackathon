import type { Relationship, RelationshipScores } from "../domain/relationship";
import type { SceneRequirement, RelationshipLevel } from "../domain/scene";
import type { WorldState } from "../domain/world";

export const RELATIONSHIP_LEVELS: readonly RelationshipLevel[] = [
  "stranger",
  "familiar",
  "friend",
  "trusted",
  "important",
];

const LEVEL_LABELS: Record<RelationshipLevel, string> = {
  stranger: "陌生人",
  familiar: "熟悉的人",
  friend: "朋友",
  trusted: "信任的人",
  important: "重要的人",
};

export type SceneRequirementReason = {
  kind: "relationship" | "flag";
  code: "missing_relationship" | "level" | "trust" | "conflict" | "commitment" | "flag";
  targetCharacterId?: string;
  key?: string;
  message: string;
};

export type SceneRequirementResult = {
  ok: boolean;
  reasons: SceneRequirementReason[];
};

export function affinityOf(scores: Pick<RelationshipScores, "closeness" | "trust" | "conflict">): number {
  return scores.closeness * 0.6 + scores.trust * 0.4 - scores.conflict * 0.3;
}

export function deriveRelationshipLevel(scores: Pick<RelationshipScores, "closeness" | "trust" | "conflict">): RelationshipLevel {
  const affinity = affinityOf(scores);
  if (affinity < 20) return "stranger";
  if (affinity < 40) return "familiar";
  if (affinity < 60) return "friend";
  if (affinity < 80) return "trusted";
  return "important";
}

export function levelLabel(level: RelationshipLevel): string {
  return LEVEL_LABELS[level];
}

export function nextRelationshipThreshold(level: RelationshipLevel): number | null {
  const next = { stranger: 20, familiar: 40, friend: 60, trusted: 80, important: null } as const;
  return next[level];
}

export function findProtagonistRelationship(world: WorldState, targetCharacterId: string): Relationship | undefined {
  return Object.values(world.relationships).find(
    (relationship) =>
      (relationship.characterAId === world.protagonistId && relationship.characterBId === targetCharacterId) ||
      (relationship.characterBId === world.protagonistId && relationship.characterAId === targetCharacterId),
  );
}

const levelOrder: Record<RelationshipLevel, number> = {
  stranger: 0,
  familiar: 1,
  friend: 2,
  trusted: 3,
  important: 4,
};

export function evaluateSceneRequirements(
  requirements: SceneRequirement[],
  world: WorldState,
  flags: Record<string, boolean> = {},
): SceneRequirementResult {
  const reasons: SceneRequirementReason[] = [];
  for (const requirement of requirements) {
    if (requirement.kind === "flag") {
      if (flags[requirement.key] !== requirement.equals) {
        reasons.push({ kind: "flag", code: "flag", key: requirement.key, message: "前置条件尚未满足" });
      }
      continue;
    }
    const relationship = findProtagonistRelationship(world, requirement.targetCharacterId);
    if (!relationship) {
      reasons.push({
        kind: "relationship",
        code: "missing_relationship",
        targetCharacterId: requirement.targetCharacterId,
        message: "尚未建立可用的公开关系",
      });
      continue;
    }
    const level = deriveRelationshipLevel(relationship.scores);
    if (requirement.minLevel && levelOrder[level] < levelOrder[requirement.minLevel]) {
      reasons.push({ kind: "relationship", code: "level", targetCharacterId: requirement.targetCharacterId, message: "关系阶段尚未达到要求" });
    }
    if (requirement.minTrust !== undefined && relationship.scores.trust < requirement.minTrust) {
      reasons.push({ kind: "relationship", code: "trust", targetCharacterId: requirement.targetCharacterId, message: "信任尚未达到要求" });
    }
    if (requirement.maxConflict !== undefined && relationship.scores.conflict > requirement.maxConflict) {
      reasons.push({ kind: "relationship", code: "conflict", targetCharacterId: requirement.targetCharacterId, message: "当前冲突仍然过高" });
    }
    if (requirement.minCommitment !== undefined && relationship.scores.commitment < requirement.minCommitment) {
      reasons.push({ kind: "relationship", code: "commitment", targetCharacterId: requirement.targetCharacterId, message: "承诺程度尚未达到要求" });
    }
  }
  return { ok: reasons.length === 0, reasons };
}
