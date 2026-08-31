// LifeExperience（方案 §13）与 EvidenceBundle（方案 §14）
// 知乎真实经历：现实世界中别人经历过什么，只作为经验和证据，不直接决定剧情。
// MVP 允许缺失字段（ageRange 未知时置 null），禁止让模型为了填满字段而硬猜。

import type { ExperienceId, LifeDomain } from "./shared";

export type LifeOutcome = {
  dimension:
    | "career"
    | "cash"
    | "health"
    | "happiness"
    | "knowledge"
    | "social"
    | "relationship"
    | "family";

  direction: "positive" | "negative" | "mixed" | "neutral";
  magnitude: "small" | "medium" | "large" | "unknown";
  description: string;

  horizon: "months" | "1_year" | "3_years" | "long_term" | "unknown";
  explicitInSource: boolean;
};

export type RelationshipExperienceEffect = {
  actorRole: "partner" | "parent" | "child" | "friend" | "coworker" | "boss" | "other";

  dimension: "closeness" | "trust" | "conflict" | "dependency" | "commitment";
  direction: "increase" | "decrease" | "mixed";
  cause: string;
  description: string;
};

export type LifeExperience = {
  id: ExperienceId;

  source: {
    platform: "zhihu";
    url: string;
    title: string;
    author: string | null;
    authorUrl: string | null;
    avatarUrl: string | null;
    evidenceExcerpt?: string;
  };

  context: {
    ageRange?: [number, number] | null;
    lifeStage?: string | null;
    education?: string | null;
    occupation?: string | null;
    industry?: string | null;
    city?: string | null;
    cityTier?: string | null;
    incomeBand?: string | null;
    assetBand?: string | null;
    relationshipStatus?: string | null;
    children?: number | null;
    familyBackground?: string | null;
    relevantTraits: string[];
  };

  situation: {
    domains: LifeDomain[];
    eventType: string;
    trigger: string;
    dilemma: string;
    constraints: string[];
    goals: string[];
  };

  decision: {
    action: string;
    alternatives: string[];
    motivations: string[];
    voluntariness: "主动" | "被迫" | "混合" | "未知";
    riskLevel: "低" | "中" | "高" | "未知";
  };

  outcomes: {
    shortTerm: LifeOutcome[];
    mediumTerm: LifeOutcome[];
    longTerm: LifeOutcome[];
  };

  relationshipEffects: RelationshipExperienceEffect[];

  causalNotes: {
    claimedReasons: string[];
    possibleMediators: string[];
    uncertainties: string[];
  };

  retrieval: {
    tags: string[];
    keywords: string[];
    qualityScore: number;
    similarity: number;
  };
};

// EvidenceBundle（方案 §14）：不能只做 Top-18 相似度，要主动保持视角多样性，
// 避免“辞职创业”纯相似度召回大量“创业成功”内容的幸存者偏差。
export type EvidenceBundle = {
  querySummary: string;
  total: number; // MVP 目标 18

  backgroundSimilar: LifeExperience[];
  decisionSimilar: LifeExperience[];
  relationshipRelevant: LifeExperience[];
  outcomeContrasts: LifeExperience[];

  balance: {
    positive: number;
    negative: number;
    mixed: number;
    unknown: number;
  };
};

export const EVIDENCE_TOTAL_TARGET = 18;
