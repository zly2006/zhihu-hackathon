import { clampStat } from "../domain/shared";
import type { RelationshipScores } from "../domain/relationship";
import type { RuntimeChoice, ScenePackage, SceneRuntimeState } from "../domain/scene";
import type { SimulationEvent } from "../domain/simulation";
import type { WorldState } from "../domain/world";
import { getActiveBlock } from "./scene-runtime";
import { evaluateSceneRequirements, findProtagonistRelationship } from "./relationship-levels";
import { getSceneChoiceRule, type SceneChoiceRule } from "./scene-choice-rules";

export class SceneChoiceResolutionError extends Error {
  readonly code: string;
  readonly reasons?: ReturnType<typeof evaluateSceneRequirements>["reasons"];

  constructor(code: string, message: string, reasons?: ReturnType<typeof evaluateSceneRequirements>["reasons"]) {
    super(message);
    this.name = "SceneChoiceResolutionError";
    this.code = code;
    this.reasons = reasons;
  }
}

export type ResolveSceneChoiceInput = {
  world: WorldState;
  package: ScenePackage;
  runtime: SceneRuntimeState;
  flags: Record<string, boolean>;
  choiceId: "A" | "B" | "C";
  actionId: string;
  scope?: "general" | "zhao-leng-demo";
};

export type ResolvedSceneChoice = {
  choice: RuntimeChoice;
  rule: SceneChoiceRule;
  actualRelationshipDelta: Partial<RelationshipScores>;
  relationshipId?: string;
  flagsAfter: Record<string, boolean>;
  feedback: string;
  event: SimulationEvent;
};

function isRuntimeChoice(value: unknown): value is RuntimeChoice {
  return Boolean(value && typeof value === "object" && "ruleId" in value && "next" in value);
}

function findChoice(input: ResolveSceneChoiceInput): RuntimeChoice {
  const block = getActiveBlock(input.package, input.runtime);
  if (!block || block.content.type !== "choice" || block.content.readOnly) {
    throw new SceneChoiceResolutionError("INVALID_SCENE_POSITION", "当前运行时位置不是可结算的选择块");
  }
  const choice = block.content.choices.find((item) => item.id === input.choiceId);
  if (!isRuntimeChoice(choice)) throw new SceneChoiceResolutionError("UNKNOWN_CHOICE", "当前选择不存在或仅可用于回顾");
  return choice;
}

function applyRelationshipDelta(
  world: WorldState,
  targetCharacterId: string | undefined,
  rule: SceneChoiceRule,
): { relationshipId?: string; actual: Partial<RelationshipScores> } {
  if (!rule.requiresTargetRelationship) return { actual: {} };
  if (!targetCharacterId) throw new SceneChoiceResolutionError("MISSING_TARGET", "该选择缺少关系目标");
  const relationship = findProtagonistRelationship(world, targetCharacterId);
  if (!relationship) throw new SceneChoiceResolutionError("MISSING_RELATIONSHIP", "当前世界没有对应的公开关系");
  const actual: Partial<RelationshipScores> = {};
  for (const key of ["closeness", "trust", "conflict", "commitment"] as const) {
    const requested = rule.scoreDelta[key];
    if (requested === undefined) continue;
    const before = relationship.scores[key];
    const after = clampStat(before + requested);
    if (after !== before) actual[key] = after - before;
  }
  return { relationshipId: relationship.id, actual };
}

export function resolveSceneChoice(input: ResolveSceneChoiceInput): ResolvedSceneChoice {
  const choice = findChoice(input);
  const rule = getSceneChoiceRule(choice.ruleId);
  if (!rule) throw new SceneChoiceResolutionError("UNKNOWN_RULE", `未注册场景规则：${choice.ruleId}`);
  if (rule.scope && input.scope !== rule.scope) {
    throw new SceneChoiceResolutionError("RULE_SCOPE_FORBIDDEN", `规则 ${choice.ruleId} 不允许用于当前场景范围`);
  }
  const requirements = evaluateSceneRequirements(choice.requirements, input.world, input.flags);
  if (!requirements.ok) throw new SceneChoiceResolutionError("CHOICE_LOCKED", "当前状态尚未满足该选择的公开前置条件", requirements.reasons);
  const relationship = applyRelationshipDelta(input.world, choice.targetCharacterId, rule);
  const flagsAfter = { ...input.flags, ...rule.flags };
  const eventId = `scene-event:${input.actionId}`;
  const participantIds = [input.world.protagonistId, ...(choice.targetCharacterId ? [choice.targetCharacterId] : [])].filter(
    (id, index, list) => list.indexOf(id) === index,
  );
  const block = getActiveBlock(input.package, input.runtime);
  const event: SimulationEvent = {
    id: eventId,
    chapterId: input.package.chapterId,
    year: input.world.currentYear,
    order: 0,
    title: rule.title,
    summary: rule.summary,
    domain: rule.domain,
    participantIds,
    causes: [{ type: "player_choice", refId: input.actionId, description: `场景选择：${choice.label}` }],
    characterChanges: [],
    relationshipChanges: relationship.relationshipId
      ? [
          {
            relationshipId: relationship.relationshipId,
            scoreDelta: relationship.actual,
            description: rule.feedback,
          },
        ]
      : [],
    evidenceIds: [],
    importance: 45,
    visibility: "known_to_protagonist",
    createsThreadIds: [],
    resolvesThreadIds: [],
    source: {
      kind: "scene_choice",
      actionId: input.actionId,
      ruleId: rule.ruleId,
      packageId: input.package.id,
      packageVersion: input.package.version,
      sceneId: input.runtime.sceneId,
      blockId: block?.id ?? input.runtime.blockId,
    },
  };
  return {
    choice,
    rule,
    actualRelationshipDelta: relationship.actual,
    ...(relationship.relationshipId ? { relationshipId: relationship.relationshipId } : {}),
    flagsAfter,
    feedback: rule.feedback,
    event,
  };
}
