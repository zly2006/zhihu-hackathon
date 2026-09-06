// NPC Agent（V3.1）
// 每章选择前最多 3 个最有行动压力的 NPC，生成确定性的服务端驱动。
// 这是规划器，不是后台常驻 Agent：它不调用模型、不写数据库、不修改 WorldState。

import type { Character } from "../domain/character";
import type {
  NpcAgentAction,
  NpcAgentDirective,
  NpcAgentPlanningInput,
  NpcAgentTrace,
} from "../domain/npc-agent";
import type { Relationship } from "../domain/relationship";

export const MAX_NPC_AGENT_DIRECTIVES = 3;

type Candidate = {
  character: Character;
  relationships: Relationship[];
  relationshipPressure: number;
  goalPressure: number;
  decisionPressure: number;
  emotionalPressure: number;
  score: number;
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function hasAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function relationshipPressure(relationships: Relationship[]): number {
  if (!relationships.length) return 0;
  return Math.max(
    ...relationships.map((relationship) => {
      const conflict = relationship.scores.conflict;
      const trustGap = 100 - relationship.scores.trust;
      const issuePressure = relationship.unresolvedIssues.reduce(
        (highest, issue) => Math.max(highest, issue.severity),
        0,
      );
      return clamp(conflict * 0.55 + trustGap * 0.2 + issuePressure * 0.25);
    }),
  );
}

function goalPressure(character: Character): number {
  const activeGoals = character.state.currentGoals.filter((goal) => goal.status === "active");
  const visibleGoalPressure = activeGoals.reduce(
    (highest, goal) => Math.max(highest, goal.priority),
    0,
  );
  const hiddenGoalPressure = Math.min(100, character.privateState?.hiddenGoals.length ? 12 : 0);
  const concernPressure = Math.min(100, (character.privateState?.hiddenConcerns.length ?? 0) * 8);
  return clamp(Math.max(visibleGoalPressure, hiddenGoalPressure + concernPressure));
}

function decisionPressure(character: Character, normalizedAction: string): number {
  const action = normalizedAction.trim();
  const hiddenText = [
    ...(character.privateState?.hiddenGoals ?? []),
    ...(character.privateState?.hiddenConcerns ?? []),
    ...character.core.values,
  ].join("；");
  const decisionKeywords = [
    ["关系", "partner", "结婚", "恋爱", "家庭", "同城", "异地"],
    ["工作", "职业", "事业", "机会", "创业", "项目"],
    ["城市", "搬", "离开", "留下", "去留", "住房"],
    ["钱", "现金", "收入", "房", "首付", "财务"],
  ];
  const matchingThemes = decisionKeywords.filter((keywords) => hasAny(action, keywords));
  const matchingPrivateThemes = matchingThemes.filter((keywords) => hasAny(hiddenText, keywords));
  return clamp(matchingThemes.length * 18 + matchingPrivateThemes.length * 12);
}

function emotionalPressure(character: Character): number {
  const trend = character.privateState?.currentEmotionalTrend ?? "";
  if (hasAny(trend, ["anxious", "焦虑", "紧张", "hurt", "受伤", "angry", "愤怒"])) return 24;
  if (hasAny(trend, ["withdrawn", "退缩", "疲惫", "低落"])) return 30;
  if (hasAny(trend, ["hopeful", "积极", "期待"])) return 12;
  return 0;
}

function candidateFor(character: Character, input: NpcAgentPlanningInput): Candidate {
  const relationships = Object.values(input.world.relationships)
    .filter(
      (relationship) =>
        relationship.characterAId === character.id || relationship.characterBId === character.id,
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  const relationshipScore = relationshipPressure(relationships);
  const goalsScore = goalPressure(character);
  const decisionScore = decisionPressure(character, input.decision.normalizedAction);
  const emotionScore = emotionalPressure(character);
  return {
    character,
    relationships,
    relationshipPressure: relationshipScore,
    goalPressure: goalsScore,
    decisionPressure: decisionScore,
    emotionalPressure: emotionScore,
    score: clamp(
      relationshipScore * 0.46 + goalsScore * 0.28 + decisionScore * 0.14 + emotionScore * 0.12,
    ),
  };
}

function chooseAction(candidate: Candidate): NpcAgentAction {
  const trend = candidate.character.privateState?.currentEmotionalTrend ?? "";
  if (candidate.relationshipPressure >= 60) {
    return candidate.relationships.some((relationship) => relationship.unresolvedIssues.length > 0)
      ? "negotiate_relationship"
      : "contact_player";
  }
  if (hasAny(trend, ["withdrawn", "退缩", "疲惫", "低落"]) && candidate.emotionalPressure >= 24) {
    // 低落不等于沉默：仍由 NPC 自主决定以何种程度向可信对象求助。
    // 该意图只会通过后续可观察行为落地，不能把 privateState 直接给客户端。
    return "seek_support";
  }
  if (candidate.goalPressure >= 60) return "advance_goal";
  if (candidate.decisionPressure >= 25) return "contact_player";
  return candidate.character.core.values.some((value) => hasAny(value, ["照顾", "支持", "责任"]))
    ? "support_player"
    : "contact_player";
}

function relatedTargets(
  candidate: Candidate,
  input: NpcAgentPlanningInput,
): {
  targetCharacterIds: string[];
  relationshipIds: string[];
} {
  const protagonistId = input.world.protagonistId;
  const protagonistRelationships = candidate.relationships.filter(
    (relationship) =>
      relationship.characterAId === protagonistId || relationship.characterBId === protagonistId,
  );
  const relationships = (
    protagonistRelationships.length ? protagonistRelationships : candidate.relationships
  ).slice(0, 2);
  const targetIds = new Set<string>();
  for (const relationship of relationships) {
    const otherId =
      relationship.characterAId === candidate.character.id
        ? relationship.characterBId
        : relationship.characterAId;
    targetIds.add(otherId);
  }
  if (!targetIds.size && candidate.character.id !== protagonistId) targetIds.add(protagonistId);
  return {
    targetCharacterIds: [...targetIds].sort((left, right) => left.localeCompare(right)),
    relationshipIds: relationships.map((relationship) => relationship.id),
  };
}

function sourceGoalIds(character: Character): string[] {
  return character.state.currentGoals
    .filter((goal) => goal.status === "active")
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
    .slice(0, 2)
    .map((goal) => goal.id);
}

function privateIntent(
  candidate: Candidate,
  action: NpcAgentAction,
  input: NpcAgentPlanningInput,
): string {
  const character = candidate.character;
  const hiddenGoals = character.privateState?.hiddenGoals ?? [];
  const concerns = character.privateState?.hiddenConcerns ?? [];
  const decision = input.decision.normalizedAction.trim() || "玩家本轮选择";
  const goalText = hiddenGoals.length ? `隐藏目标：${hiddenGoals.join("；")}` : "未记录隐藏目标";
  const concernText = concerns.length ? `隐忧：${concerns.join("；")}` : "未记录隐忧";
  return `${character.identity.name}本章倾向${action}；${goalText}；${concernText}；玩家选择“${decision}”使该倾向需要在本章内得到回应。`;
}

export function planNpcAgentDirectives(input: NpcAgentPlanningInput): NpcAgentDirective[] {
  const candidates = Object.values(input.world.characters)
    .filter((character) => character.role === "npc" && character.privateState)
    .map((character) => candidateFor(character, input))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.relationshipPressure - left.relationshipPressure ||
        right.goalPressure - left.goalPressure ||
        left.character.id.localeCompare(right.character.id),
    )
    .slice(0, MAX_NPC_AGENT_DIRECTIVES);

  return candidates.map((candidate) => {
    const action = chooseAction(candidate);
    const targets = relatedTargets(candidate, input);
    return {
      id: `npc-agent-${input.chapterId}-${candidate.character.id}`,
      chapterId: input.chapterId,
      characterId: candidate.character.id,
      action,
      targetCharacterIds: targets.targetCharacterIds,
      relationshipIds: targets.relationshipIds,
      sourceGoalIds: sourceGoalIds(candidate.character),
      urgency: clamp(
        candidate.score +
          Math.max(candidate.relationshipPressure, candidate.goalPressure) * 0.18 +
          (input.endYear > input.startYear ? 4 : 0),
      ),
      privateIntent: privateIntent(candidate, action, input),
    };
  });
}

export function toPublicNpcAgentTrace(directive: NpcAgentDirective): NpcAgentTrace {
  return {
    directiveId: directive.id,
    characterId: directive.characterId,
    action: directive.action,
    targetCharacterIds: [...directive.targetCharacterIds],
    relationshipIds: [...directive.relationshipIds],
    urgency: directive.urgency,
  };
}
