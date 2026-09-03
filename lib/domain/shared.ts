// 共享基础类型（方案 §8 Supporting Types）
// 所有 LifeStats 必须约束为 0..100；cash 是现金安全度指数，不是人民币余额。

export type CharacterId = string;
export type RelationshipId = string;
export type MemoryId = string;
export type ExperienceId = string;
export type SimulationEventId = string;
export type ChapterId = string;

export type ChapterSpan = 1 | 3;

export type GameMode = "novel" | "galgame";

export type LifeDomain =
  | "education"
  | "career"
  | "finance"
  | "housing"
  | "relocation"
  | "entrepreneurship"
  | "romance"
  | "marriage"
  | "family"
  | "parenting"
  | "friendship"
  | "health"
  | "social"
  | "loss"
  | "aging";

export type LifeStats = {
  cash: number;
  health: number;
  happiness: number;
  knowledge: number;
  connections: number;
  career: number;
  assets: number;
};

export type Talents = {
  insight: number;
  charm: number;
  grit: number;
  learning: number;
  luck: number;
};

export const LIFE_STAT_KEYS = [
  "cash",
  "health",
  "happiness",
  "knowledge",
  "connections",
  "career",
  "assets",
] as const;

export const TALENT_KEYS = ["insight", "charm", "grit", "learning", "luck"] as const;

export type LifeStatKey = (typeof LIFE_STAT_KEYS)[number];
export type TalentKey = (typeof TALENT_KEYS)[number];

export const STAT_MIN = 0;
export const STAT_MAX = 100;

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function clampStat(value: number): number {
  return Math.max(STAT_MIN, Math.min(STAT_MAX, Math.round(value)));
}

export function clampLifeStats(stats: LifeStats): LifeStats {
  return Object.fromEntries(
    LIFE_STAT_KEYS.map((key) => [key, clampStat(stats[key])]),
  ) as LifeStats;
}

export function clampTalents(talents: Talents): Talents {
  return Object.fromEntries(TALENT_KEYS.map((key) => [key, clampStat(talents[key])])) as Talents;
}
