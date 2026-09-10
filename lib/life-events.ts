import coreLibrary from "../content/life-events.v1.json";
import campusLibrary from "../content/campus-life-events.v1.json";

export type LifeStage = "high-school" | "university" | "graduate";
export type LifeEventPlan = Record<LifeStage, string>;

export type LifeEventOption = {
  id: "A" | "B" | "C";
  label: string;
  action: string;
  strategyTag: string;
  tradeoff: string;
  immediate: {
    narrative: string;
    statDelta: Record<string, number>;
    relationshipEffects: Array<{
      targetRole: string;
      delta: Record<string, number>;
      reason: string;
    }>;
  };
  delayed: {
    horizon: string;
    likely: string;
    risk: string;
  };
  flags: string[];
  followUpHooks: string[];
};

export type LifeEventTemplate = {
  id: string;
  version: 1;
  title: string;
  domain: string;
  secondaryDomains: string[];
  lifeStages: LifeStage[];
  ageRange: { min: number; max: number };
  requiredRelationshipRoles: string[];
  situation: string;
  dilemma: string;
  stakes: string[];
  options: [LifeEventOption, LifeEventOption, LifeEventOption];
};

type RawLibrary = {
  schemaVersion: 1;
  updatedAt: string;
  events: LifeEventTemplate[];
};

const core = coreLibrary as unknown as RawLibrary;
const campus = campusLibrary as unknown as RawLibrary;

export const LIFE_EVENT_LIBRARY = {
  schemaVersion: 1 as const,
  updatedAt: campus.updatedAt,
  events: [...core.events, ...campus.events],
};

const campusEvents = campus.events;

export const LIFE_STAGE_SEQUENCE: readonly LifeStage[] = [
  "high-school",
  "high-school",
  "university",
  "university",
  "graduate",
  "graduate",
  "graduate",
];

export const LIFE_STAGE_LABELS: Record<LifeStage, string> = {
  "high-school": "高中",
  university: "本科",
  graduate: "硕士",
};

export const LIFE_STAGE_AGES: Record<LifeStage, string> = {
  "high-school": "15 至 18 岁",
  university: "18 至 22 岁",
  graduate: "22 至 25 岁",
};

function stableHash(value: string) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function campusEventsFor(stage: LifeStage) {
  return campusEvents.filter((event) => event.lifeStages.includes(stage));
}

export function lifeStageForStoryStage(stage: number): LifeStage {
  return LIFE_STAGE_SEQUENCE[
    Math.max(0, Math.min(stage, LIFE_STAGE_SEQUENCE.length - 1))
  ];
}

export function planLifeEvents(seed: string): LifeEventPlan {
  return Object.fromEntries(
    (Object.keys(LIFE_STAGE_LABELS) as LifeStage[]).map((stage) => {
      const candidates = campusEventsFor(stage);
      if (!candidates.length)
        throw new Error(`${LIFE_STAGE_LABELS[stage]}阶段没有校园事件。`);
      return [
        stage,
        candidates[stableHash(`${seed}:${stage}`) % candidates.length].id,
      ];
    }),
  ) as LifeEventPlan;
}

export function getLifeEvent(id: string): LifeEventTemplate | undefined {
  return LIFE_EVENT_LIBRARY.events.find((event) => event.id === id);
}

export function lifeEventForStoryStage(
  plan: LifeEventPlan,
  storyStage: number,
) {
  const lifeStage = lifeStageForStoryStage(storyStage);
  const event = getLifeEvent(plan[lifeStage]);
  if (!event || !event.lifeStages.includes(lifeStage)) {
    throw new Error(`${LIFE_STAGE_LABELS[lifeStage]}阶段事件计划无效。`);
  }
  return { lifeStage, event };
}

function renderDelta(delta: Record<string, number>) {
  return Object.entries(delta)
    .map(([key, value]) => `${key}${value >= 0 ? "+" : ""}${value}`)
    .join("、");
}

export function renderLifeEvent(
  event: LifeEventTemplate,
  lifeStage: LifeStage,
) {
  const options = event.options
    .map((option) => {
      const relationships = option.immediate.relationshipEffects
        .map(
          (effect) =>
            `${effect.targetRole}：${renderDelta(effect.delta)}；原因：${effect.reason}`,
        )
        .join("；");
      return [
        `${option.id}. ${option.label}｜机制：${option.strategyTag}`,
        `行动：${option.action}`,
        `代价：${option.tradeoff}`,
        `即时后果：${option.immediate.narrative}`,
        `状态变化：${renderDelta(option.immediate.statDelta)}`,
        `关系变化：${relationships}`,
        `延迟收益：${option.delayed.likely}`,
        `延迟风险：${option.delayed.risk}`,
        `后续钩子：${option.followUpHooks.join("、")}`,
      ].join("\n");
    })
    .join("\n\n");

  return [
    `人生阶段：${LIFE_STAGE_LABELS[lifeStage]}（主角约 ${LIFE_STAGE_AGES[lifeStage]}）`,
    `主题事件：${event.title}（${event.id}）`,
    `具体处境：${event.situation}`,
    `核心矛盾：${event.dilemma}`,
    `利害关系：${event.stakes.join("；")}`,
    `可用行动与后果边界：\n${options}`,
  ].join("\n");
}
