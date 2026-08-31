// Decision Resolver（Phase 4）
// 程序先给 World Simulator 一个可复现的结果倾向锚点，而不是让 LLM 自己决定"运气"。
// 同一存档、同一章节、同一选择必须得到同一个随机结果（方案 §17.2）。

import { createHash } from "node:crypto";
import type { DecisionResolution } from "../domain/chapter";
import type { Character } from "../domain/character";
import type { EraContextSnapshot } from "../domain/world";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// 确定性随机：SHA-256 → 前 13 个 hex → [0, 1)
export function deterministicRoll(seed: string): number {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 13);
  const value = Number.parseInt(hex, 16);
  return value / 0x1fffffffffffff;
}

export type EffectiveRiskInput = {
  estimatedRisk: number; // 选项的结构风险 0-100
  stateFit: "顺势" | "可行" | "吃力";
  protagonist: Character;
  eraRiskAdjustment?: number; // 由 EraContext 修正，历史年份可能非零，未来弱假设默认 0
};

// 资源稀缺惩罚：主角当前资源越低，冒险的代价越重（近似旧 mechanics 思路）
function resourceScarcityPenalty(cash: number, health: number): number {
  let penalty = 0;
  if (cash < 10) penalty += 6;
  else if (cash < 25) penalty += 3;
  if (health < 15) penalty += 5;
  else if (health < 35) penalty += 2;
  return penalty;
}

export function computeEffectiveRisk(input: EffectiveRiskInput): number {
  const { protagonist } = input;
  const stats = protagonist.state.stats;
  const fitAdjustment = input.stateFit === "顺势" ? -6 : input.stateFit === "吃力" ? 8 : 0;
  const talentProtection =
    protagonist.core.talents.insight * 0.8 +
    protagonist.core.talents.luck * 0.7 +
    protagonist.core.talents.grit * 0.35;
  const scarcity = resourceScarcityPenalty(stats.cash, stats.health);
  const raw =
    input.estimatedRisk +
    scarcity +
    fitAdjustment +
    (input.eraRiskAdjustment ?? 0) -
    talentProtection;
  return Math.round(clamp(raw, 3, 95));
}

// 三级结果分布：mixed 永远是主要区间（方案 §17.2.2）
export function outcomeAnchorFromRoll(
  roll: number,
  effectiveRisk: number,
): DecisionResolution["outcomeAnchor"] {
  const setbackProbability = clamp(0.08 + effectiveRisk * 0.0035, 0.08, 0.4);
  const favorableProbability = clamp(0.4 - effectiveRisk * 0.0035, 0.1, 0.4);
  const mixedProbability = 1 - setbackProbability - favorableProbability;
  if (roll < favorableProbability) return "favorable";
  if (roll < favorableProbability + mixedProbability) return "mixed";
  return "setback";
}

export type ResolveInput = {
  saveId: string;
  chapterIndex: number;
  decisionId: string;
  normalizedAction: string;
  estimatedRisk: number;
  stateFit: "顺势" | "可行" | "吃力";
  protagonist: Character;
  eraContext?: EraContextSnapshot | null;
};

export function resolveDecision(input: ResolveInput): DecisionResolution {
  const seed = `${input.saveId}:${input.chapterIndex}:${input.decisionId}:${input.normalizedAction}`;
  const uncertaintySeed = createHash("sha256").update(seed).digest("hex");
  const roll = deterministicRoll(seed);
  const eraRiskAdjustment = input.eraContext ? 0 : 0; // 未来弱假设不施加宏观风险修正（§23.2）
  const effectiveRisk = computeEffectiveRisk({
    estimatedRisk: input.estimatedRisk,
    stateFit: input.stateFit,
    protagonist: input.protagonist,
    eraRiskAdjustment,
  });
  const outcomeAnchor = outcomeAnchorFromRoll(roll, effectiveRisk);
  const anchorLabels: Record<DecisionResolution["outcomeAnchor"], string> = {
    favorable: "顺遂",
    mixed: "有得有失",
    setback: "受挫",
  };
  return {
    effectiveRisk,
    outcomeAnchor,
    uncertaintySeed,
    reasonSummary: `有效风险 ${effectiveRisk}，确定性掷点 ${roll.toFixed(4)}，本章主决策结果锚点：${anchorLabels[outcomeAnchor]}`,
  };
}
