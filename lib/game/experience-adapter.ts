// ExperienceAdapter（Phase 3）
// 把现有数据库候选映射为 LifeExperience。MVP 允许缺失字段（置 null），
// 禁止让模型为填满字段而硬猜（方案 §13.3）。

import type { LifeDomain } from "../domain/shared";
import type { LifeExperience } from "../domain/experience";
import type { EvidenceCandidate } from "../database";

// blocking_key 是现有数据库的领域值，映射到新版 LifeDomain。
const BLOCKING_KEY_TO_DOMAIN: Record<string, LifeDomain> = {
  career: "career",
  education: "education",
  health_life: "health",
  family_relationship: "family",
  finance: "finance",
  housing: "housing",
};

export function blockingKeyToDomain(blockingKey: string): LifeDomain {
  return BLOCKING_KEY_TO_DOMAIN[blockingKey] ?? "career";
}

function compact(...values: string[]) {
  return values.join(" ").replace(/\s+/g, " ").trim();
}

export function toLifeExperience(candidate: EvidenceCandidate): LifeExperience {
  const domain = blockingKeyToDomain(candidate.blockingKey);
  return {
    id: candidate.id,
    source: {
      platform: "zhihu",
      url: candidate.url,
      title: candidate.title,
      author: candidate.authorName,
      authorUrl: candidate.authorProfileUrl,
      avatarUrl: candidate.authorAvatarUrl,
      evidenceExcerpt: compact(candidate.context, candidate.decision).slice(0, 150),
    },
    context: {
      ageRange: null,
      lifeStage: null,
      education: null,
      occupation: null,
      industry: null,
      city: null,
      cityTier: null,
      incomeBand: null,
      assetBand: null,
      relationshipStatus: null,
      children: null,
      familyBackground: null,
      relevantTraits: [],
    },
    situation: {
      domains: [domain],
      eventType: "",
      trigger: candidate.context,
      dilemma: candidate.decision,
      constraints: [],
      goals: [],
    },
    decision: {
      action: candidate.action,
      alternatives: [],
      motivations: [],
      voluntariness: "未知",
      riskLevel: "未知",
    },
    outcomes: {
      shortTerm: [
        {
          dimension: domain === "health" ? "health" : domain === "family" ? "family" : "career",
          direction: "neutral",
          magnitude: "unknown",
          description: candidate.outcome,
          horizon: "unknown",
          explicitInSource: true,
        },
      ],
      mediumTerm: [],
      longTerm: [],
    },
    relationshipEffects: [],
    causalNotes: {
      claimedReasons: [],
      possibleMediators: [],
      uncertainties: ["单一个案，不能视为确定因果规律"],
    },
    retrieval: {
      tags: [],
      keywords: [],
      qualityScore: candidate.confidence,
      similarity: candidate.similarity,
    },
  };
}
