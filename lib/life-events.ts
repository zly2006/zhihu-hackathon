import campusLibrary from "../content/campus-life-events.v1.json";

export type LifeStage = "high-school" | "university" | "graduate";
export type LifeEventPlan = Record<LifeStage, string>;

export type ZhihuEvidence = {
  contentId: string;
  contentType: "Answer";
  title: string;
  author: string;
  url: string;
  excerpt: string;
  voteUpCount: number;
  authorityLevel: string;
  authorAvatarUrl?: string;
  authorProfileUrl?: string;
};

export type LifeEventOption = {
  id: "A" | "B" | "C";
  label: string;
  action: string;
  strategyTag: string;
  tradeoff: string;
  searchQuery: string;
  zhihuEvidence: ZhihuEvidence[];
};

export type LifeEventTemplate = {
  id: string;
  version: 2;
  title: string;
  domain: string;
  secondaryDomains: string[];
  lifeStages: LifeStage[];
  ageRange: { min: number; max: number };
  requiredRelationshipRoles: string[];
  options: [LifeEventOption, LifeEventOption, LifeEventOption];
  zhihuEvidence: ZhihuEvidence[];
  sourcePolicy: {
    mode: "zhihu-answers-only";
    minimumAnswersPerOption: 3;
    query: string;
    collectedAt: string;
  };
};

type RawLibrary = {
  schemaVersion: 2;
  updatedAt: string;
  events: LifeEventTemplate[];
};

const campus = campusLibrary as unknown as RawLibrary;

export const LIFE_EVENT_LIBRARY = {
  schemaVersion: 2 as const,
  updatedAt: campus.updatedAt,
  events: campus.events,
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

function renderEvidence(evidence: ZhihuEvidence[]) {
  return evidence
    .map(
      (item, index) =>
        `${index + 1}. ${item.title}｜${item.author}\n摘要：${item.excerpt}\n链接：${item.url}`,
    )
    .join("\n");
}

export function renderLifeEvent(
  event: LifeEventTemplate,
  lifeStage: LifeStage,
) {
  const options = event.options
    .map((option) => {
      return [
        `${option.id}. ${option.label}｜机制：${option.strategyTag}`,
        `行动：${option.action}`,
        `代价：${option.tradeoff}`,
        `知乎回答依据（只能综合这些内容推导结果）：\n${renderEvidence(option.zhihuEvidence)}`,
      ].join("\n");
    })
    .join("\n\n");

  return [
    `人生阶段：${LIFE_STAGE_LABELS[lifeStage]}（主角约 ${LIFE_STAGE_AGES[lifeStage]}）`,
    `主题事件：${event.title}（${event.id}）`,
    `事件背景只能从以下知乎回答综合，不得补写来源中没有的事实：\n${renderEvidence(event.zhihuEvidence)}`,
    `候选行动与各自依据：\n${options}`,
  ].join("\n");
}

export function optionForEvent(event: LifeEventTemplate, index: number) {
  return event.options[Math.max(0, Math.min(index, event.options.length - 1))];
}
