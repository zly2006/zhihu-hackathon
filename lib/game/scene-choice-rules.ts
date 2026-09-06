import type { LifeDomain } from "../domain/shared";
import type { RelationshipScores } from "../domain/relationship";

export type SceneChoiceRule = {
  ruleId: string;
  scope?: "general" | "zhao-leng-demo";
  domain: LifeDomain;
  title: string;
  summary: string;
  feedback: string;
  scoreDelta: Partial<RelationshipScores>;
  flags: Record<string, boolean>;
  requiresTargetRelationship: boolean;
};

const rules: SceneChoiceRule[] = [
  {
    ruleId: "listen_without_promise",
    domain: "friendship",
    title: "先听完，再说自己能做到什么",
    summary: "玩家选择先听清对方的处境，没有立即作出无法兑现的承诺。",
    feedback: "你先把话听完，再说明自己现在真正能做到的部分。",
    scoreDelta: { closeness: 1, trust: 4 },
    flags: { listened: true },
    requiresTargetRelationship: true,
  },
  {
    ruleId: "clarify_boundary",
    domain: "friendship",
    title: "说明自己的边界",
    summary: "玩家明确表达可承担的范围，减少了模糊期待。",
    feedback: "你把能做和不能做的部分说清楚，谈话没有继续靠猜测推进。",
    scoreDelta: { closeness: 1, trust: 2, conflict: -1 },
    flags: { clarifiedBoundary: true },
    requiresTargetRelationship: true,
  },
  {
    ruleId: "avoid_conversation",
    domain: "friendship",
    title: "暂时回避这次谈话",
    summary: "玩家把谈话延后，短期减轻压力，但留下了未处理的部分。",
    feedback: "你暂时避开了谈话，眼前轻松了一点，但未处理的部分仍在那里。",
    scoreDelta: { closeness: -3, trust: -2, conflict: 3 },
    flags: { avoidedConversation: true },
    requiresTargetRelationship: true,
  },
  {
    ruleId: "honest_talk",
    domain: "friendship",
    title: "坦诚说明目前能承担的部分",
    summary: "玩家承认现实限制，同时把可以兑现的行动说具体。",
    feedback: "你没有把话说满，而是把当前能承担的部分讲得具体。",
    scoreDelta: { closeness: 2, trust: 6, conflict: 1 },
    flags: { honestTalk: true },
    requiresTargetRelationship: true,
  },
  {
    ruleId: "respect_distance",
    domain: "friendship",
    title: "尊重彼此的距离",
    summary: "玩家接受对方需要空间，避免把关系推向更高压力。",
    feedback: "你给彼此留出空间，暂时没有用新的承诺覆盖旧问题。",
    scoreDelta: { conflict: -2, commitment: -1 },
    flags: { respectedDistance: true },
    requiresTargetRelationship: true,
  },
  {
    ruleId: "make_joint_plan",
    domain: "friendship",
    title: "制定一个共同计划",
    summary: "玩家把前面的坦诚沟通转成一个双方都能检查的安排。",
    feedback: "你们把下一步写成了可以一起检查的安排。",
    scoreDelta: { trust: 2, commitment: 8 },
    flags: { jointPlan: true },
    requiresTargetRelationship: true,
  },
  {
    ruleId: "move_forward",
    domain: "friendship",
    title: "继续执行已经谈好的计划",
    summary: "玩家承担前面选择的后果，继续执行公开约定。",
    feedback: "你选择承担已经说出口的安排，接下来要用行动维持它。",
    scoreDelta: { closeness: 2, trust: 3, commitment: 8 },
    flags: { movedForward: true },
    requiresTargetRelationship: true,
  },
  {
    ruleId: "separate_paths",
    domain: "friendship",
    title: "接受各自前进的道路",
    summary: "玩家承认双方方向不同，结束共同计划而不抹去已经发生的事实。",
    feedback: "你们承认方向不同，各自前进也成为一条诚实的结果。",
    scoreDelta: { conflict: -1, commitment: -5 },
    flags: { separatePaths: true },
    requiresTargetRelationship: true,
  },
  {
    ruleId: "zhao_leng_press_help",
    scope: "zhao-leng-demo",
    domain: "friendship",
    title: "坚持替对方完成已被拒绝的帮助",
    summary: "赵冷已说明希望自己完成结论，主角仍坚持替她补完。",
    feedback: "赵冷收回笔记，这次帮助没有得到她的接受。",
    scoreDelta: { closeness: -2, trust: -4, conflict: 4 },
    flags: {},
    requiresTargetRelationship: true,
  },
];

export const SCENE_CHOICE_RULES: Readonly<Record<string, SceneChoiceRule>> = Object.freeze(
  Object.fromEntries(rules.map((rule) => [rule.ruleId, Object.freeze({ ...rule, flags: Object.freeze({ ...rule.flags }), scoreDelta: Object.freeze({ ...rule.scoreDelta }) })])),
);

export function getSceneChoiceRule(ruleId: string): SceneChoiceRule | undefined {
  return SCENE_CHOICE_RULES[ruleId];
}

export function listSceneChoiceRuleIds(): string[] {
  return Object.keys(SCENE_CHOICE_RULES).sort();
}
