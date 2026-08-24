import type { Effect, GameOption, LifeState, Profile, ResourceContext } from "./types";

const effectKeys = [
  "cash",
  "health",
  "happiness",
  "knowledge",
  "connections",
  "career",
  "assets",
] as const;

export function resourceContext(state: LifeState): ResourceContext {
  const cashBand =
    state.cash < 10 ? "生存线" : state.cash < 25 ? "紧张" : state.cash < 55 ? "稳定" : "宽裕";
  const healthBand =
    state.health < 15 ? "危险" : state.health < 35 ? "透支" : state.health < 65 ? "一般" : "良好";
  const cashRisk = state.cash < 10 ? 24 : state.cash < 25 ? 13 : state.cash < 40 ? 5 : 0;
  const healthRisk = state.health < 15 ? 28 : state.health < 35 ? 16 : state.health < 50 ? 6 : 0;
  return {
    cashBand,
    healthBand,
    riskModifier: cashRisk + healthRisk,
    incomeOpportunityRequired: state.cash < 25,
    recoveryOpportunityRequired: state.health < 35,
    maxCashLoss: Math.max(0, Math.min(12, state.cash - Math.min(state.cash, 8))),
    maxHealthLoss: Math.max(0, Math.min(12, state.health - Math.min(state.health, 8))),
    developmentConversion: Math.max(
      0.35,
      (state.cash < 10 ? 0.6 : state.cash < 25 ? 0.8 : 1) *
        (state.health < 15 ? 0.55 : state.health < 35 ? 0.78 : 1),
    ),
  };
}

export function projectedLifeEndAge(state: LifeState, profile: Profile) {
  const healthContribution = (state.health - 50) * 0.22;
  const happinessContribution = (state.happiness - 50) * 0.07;
  const securityContribution = (state.cash - 30) * 0.035 + (state.assets - 30) * 0.025;
  const talentContribution = profile.talents.grit * 0.8 + profile.talents.luck * 0.4;
  return Math.max(
    62,
    Math.min(
      100,
      Math.round(
        77 + healthContribution + happinessContribution + securityContribution + talentContribution,
      ),
    ),
  );
}

export function advanceAge(age: number, precision: Profile["precision"]) {
  return Math.min(100, age + precision);
}

function bounded(value: number) {
  return Math.max(-12, Math.min(12, Math.round(value)));
}

export function settleChoice(
  state: LifeState,
  profile: Profile,
  option: GameOption,
  roll = Math.random() * 100,
) {
  const context = resourceContext(state);
  const talentProtection =
    profile.talents.insight * 0.8 + profile.talents.luck * 0.7 + profile.talents.grit * 0.35;
  const effectiveRisk = Math.round(
    Math.max(3, Math.min(95, option.baseRisk + context.riskModifier - talentProtection)),
  );
  const riskOccurred = roll < effectiveRisk;
  const raw = Object.fromEntries(
    effectKeys.map((key) => [key, Number(option.effects[key] || 0)]),
  ) as Required<Effect>;

  if (raw.knowledge > 0) raw.knowledge *= context.developmentConversion;
  if (raw.career > 0) raw.career *= context.developmentConversion;
  if (raw.cash > 0 && state.health < 35) raw.cash *= state.health < 15 ? 0.55 : 0.8;

  if (state.cash < 10) raw.happiness -= 3;
  else if (state.cash < 25) raw.happiness -= 1;
  if (state.health < 15) raw.happiness -= 3;
  else if (state.health < 35) raw.happiness -= 1;

  if (riskOccurred) {
    raw.cash -= state.cash < 15 ? 1 : 3;
    raw.health -= state.health < 18 ? 1 : 2;
    raw.happiness -= 2;
    raw.career -= option.strategyTag === "增加收入" ? 1 : 0;
  }

  raw.cash = Math.max(-context.maxCashLoss, raw.cash);
  raw.health = Math.max(-context.maxHealthLoss, raw.health);
  const effects = Object.fromEntries(effectKeys.map((key) => [key, bounded(raw[key])])) as Effect;
  return { effects, effectiveRisk, riskOccurred, context };
}
