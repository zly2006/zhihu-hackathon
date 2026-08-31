// Evidence Retriever（Phase 3）
// 把旧 retrieveExperiences 演进为 retrieveEvidence：保留 18 条真实召回，
// 但组装成 EvidenceBundle（背景相似 / 行动相似 / 关系相关 / 结果反例四类），
// 避免纯相似度召回的幸存者偏差（方案 §14）。

import { retrieveEvidenceCandidates } from "../database";
import { toLifeExperience } from "./experience-adapter";
import type { EvidenceBundle, LifeExperience } from "../domain/experience";
import type { WorldState } from "../domain/world";
import type { ChapterChoice } from "../domain/chapter";

export type EvidenceRetrievalInput = {
  world: WorldState;
  decision: ChapterChoice;
  selectedOptionId?: "A" | "B" | "C" | "CUSTOM";
  usedExperienceIds?: string[];
};

export type RetrievalContext = {
  domain: string;
  terms: string[];
  decisionKeywords: string[];
  relationshipKeywords: string[];
  anchorSeed: string;
};

const RELATIONSHIP_KEYWORDS = ["分手", "离婚", "异地", "沟通", "矛盾", "伴侣", "夫妻", "父母", "亲子", "结婚"];
const NEGATIVE_PATTERN = /失败|后悔|亏|没做成|放弃|不如|血本无归|分手|离婚|失业|被裁|困难|压力|没做成|错/;
const POSITIVE_PATTERN = /成功|顺利|赚|升职|加薪|满意|不错|改善|好转|收获|认可|翻身/;

function domainForAge(age: number): string {
  if (age < 23) return "education";
  if (age < 56) return "career";
  return "health_life";
}

function ageBandTerms(age: number): string[] {
  if (age < 23) return ["大学", "考研", "专业", "就业"];
  if (age < 29) return ["工作", "转行", "职业", "创业"];
  if (age < 36) return ["买房", "结婚", "工作", "创业"];
  if (age < 46) return ["职业", "家庭", "健康", "投资"];
  return ["退休", "养老", "健康", "生活"];
}

export function deriveRetrievalContext(
  world: WorldState,
  decision: ChapterChoice,
  selectedOptionId?: "A" | "B" | "C" | "CUSTOM",
): RetrievalContext {
  const protagonist = world.characters[world.protagonistId];
  const stats = protagonist.state.stats;
  const age = protagonist.state.age;

  let domain = domainForAge(age);
  if (stats.health < 28) domain = "health_life";

  const terms = new Set<string>(ageBandTerms(age));
  if (stats.cash < 22) ["收入", "赚钱", "兼职", "副业"].forEach((t) => terms.add(t));
  if (stats.health < 28) ["健康", "恢复", "治疗", "休息"].forEach((t) => terms.add(t));

  const selectedOption = decision.options.find((option) => option.id === selectedOptionId);
  const decisionKeywords = selectedOption
    ? [selectedOption.strategyTag, selectedOption.label].filter((t) => t && t.length >= 2)
    : [];
  decisionKeywords.forEach((t) => terms.add(t));

  const relationshipKeywords = new Set<string>();
  const maxConflict = Math.max(
    0,
    ...Object.values(world.relationships).map((rel) => rel.scores.conflict),
  );
  if (maxConflict >= 50) RELATIONSHIP_KEYWORDS.forEach((t) => relationshipKeywords.add(t));

  const anchorSeed = [protagonist.id, selectedOptionId ?? "none", world.currentYear].join(":");

  return {
    domain,
    terms: [...terms],
    decisionKeywords,
    relationshipKeywords: [...relationshipKeywords],
    anchorSeed,
  };
}

export function classifyOutcomeDirection(
  text: string,
): "positive" | "negative" | "mixed" | "unknown" {
  const negative = (text.match(NEGATIVE_PATTERN) || []).length;
  const positive = (text.match(POSITIVE_PATTERN) || []).length;
  if (negative > 0 && positive > 0) return "mixed";
  if (negative > 0) return "negative";
  if (positive > 0) return "positive";
  return "unknown";
}

export function assembleEvidenceBundle(
  experiences: LifeExperience[],
  context: RetrievalContext,
): EvidenceBundle {
  const backgroundSimilar: LifeExperience[] = [];
  const decisionSimilar: LifeExperience[] = [];
  const relationshipRelevant: LifeExperience[] = [];
  const outcomeContrasts: LifeExperience[] = [];

  // 第一遍：按关键词归入 关系 > 行动 > 背景
  for (const experience of experiences) {
    const text = [
      experience.situation.trigger,
      experience.situation.dilemma,
      experience.decision.action,
      experience.outcomes.shortTerm[0]?.description ?? "",
    ].join(" ");
    if (context.relationshipKeywords.some((keyword) => text.includes(keyword))) {
      relationshipRelevant.push(experience);
    } else if (context.decisionKeywords.some((keyword) => text.includes(keyword))) {
      decisionSimilar.push(experience);
    } else {
      backgroundSimilar.push(experience);
    }
  }

  // 第二遍：把负面/混合结果提到 outcomeContrasts（最多 5 条），对抗幸存者偏差
  const contrastPool = [...backgroundSimilar, ...decisionSimilar];
  for (const experience of contrastPool) {
    if (outcomeContrasts.length >= 5) break;
    const outcomeText = experience.outcomes.shortTerm[0]?.description ?? "";
    const direction = classifyOutcomeDirection(
      [experience.situation.dilemma, outcomeText].join(" "),
    );
    if (direction === "negative" || direction === "mixed") {
      const fromBackground = backgroundSimilar.indexOf(experience);
      if (fromBackground >= 0) backgroundSimilar.splice(fromBackground, 1);
      else {
        const fromDecision = decisionSimilar.indexOf(experience);
        if (fromDecision >= 0) decisionSimilar.splice(fromDecision, 1);
      }
      outcomeContrasts.push(experience);
    }
  }

  const balance = { positive: 0, negative: 0, mixed: 0, unknown: 0 };
  for (const experience of experiences) {
    const direction = classifyOutcomeDirection(
      [
        experience.situation.dilemma,
        experience.decision.action,
        experience.outcomes.shortTerm[0]?.description ?? "",
      ].join(" "),
    );
    balance[direction] += 1;
  }

  return {
    querySummary: `领域：${context.domain}；关键词：${context.terms.join("、") || "无"}`,
    total: experiences.length,
    backgroundSimilar,
    decisionSimilar,
    relationshipRelevant,
    outcomeContrasts,
    balance,
  };
}

export async function retrieveEvidence(input: EvidenceRetrievalInput): Promise<EvidenceBundle> {
  const context = deriveRetrievalContext(input.world, input.decision, input.selectedOptionId);
  const candidates = await retrieveEvidenceCandidates({
    domain: context.domain,
    terms: context.terms,
    anchorSeed: context.anchorSeed,
    limit: 18,
    excludedExperienceIds: input.usedExperienceIds ?? [],
  });
  const experiences = candidates.map(toLifeExperience);
  return assembleEvidenceBundle(experiences, context);
}
