import type {
  Effect,
  EraContext,
  EraMechanism,
  GameOption,
  LifeState,
  Profile,
  ResourceContext,
} from "./types";

function eraRiskAdjustment(
  context: EraContext | null | undefined,
  option: { eraContextId?: string | null; eraMechanism?: EraMechanism },
) {
  if (
    !context ||
    option.eraContextId !== context.id ||
    !option.eraMechanism ||
    option.eraMechanism === "none"
  )
    return 0;
  return context.adjustments?.[option.eraMechanism].risk || 0;
}

function eraEffectAdjustment(
  context: EraContext | null | undefined,
  option: { eraContextId?: string | null; eraMechanism?: EraMechanism },
  riskOccurred: boolean,
) {
  if (
    !context ||
    option.eraContextId !== context.id ||
    !option.eraMechanism ||
    option.eraMechanism === "none"
  )
    return {};
  const adjustment = context.adjustments?.[option.eraMechanism];
  return adjustment ? (riskOccurred ? adjustment.setback : adjustment.success) : {};
}

export const resourceKeys = [
  "cash",
  "health",
  "happiness",
  "knowledge",
  "connections",
  "career",
  "assets",
] as const;

export type ResourceKey = (typeof resourceKeys)[number];

const effectKeys = resourceKeys;

export const crisisKeys = [
  "cash",
  "health",
  "happiness",
  "connections",
  "career",
  "assets",
] as const;

export type CrisisKey = (typeof crisisKeys)[number];

export function newlyZeroedCrises(previous: LifeState, next: LifeState): CrisisKey[] {
  return crisisKeys.filter(
    (key) => previous[key] > 0 && next[key] === 0 && (key !== "career" || previous.age >= 18),
  );
}

export function applyDebugState(previous: LifeState, draft: Record<ResourceKey, number>) {
  const state = { ...previous };
  for (const key of resourceKeys) {
    const value = Number(draft[key]);
    state[key] = Number.isFinite(value)
      ? Math.max(0, Math.min(100, Math.round(value)))
      : previous[key];
  }
  return { state, crisisKeys: newlyZeroedCrises(previous, state) };
}

export function resourceContext(state: LifeState): ResourceContext {
  const cashBand =
    state.cash < 10 ? "生存线" : state.cash < 25 ? "紧张" : state.cash < 55 ? "稳定" : "宽裕";
  const healthBand =
    state.health < 15 ? "危险" : state.health < 35 ? "透支" : state.health < 65 ? "一般" : "良好";
  return {
    cashBand,
    healthBand,
    incomeOpportunityRequired: state.cash < 25,
    recoveryOpportunityRequired: state.health < 35,
    maxCashLoss: 12,
    maxHealthLoss: 12,
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

function resourceCostPenalty(cost: number, available: number, critical: number, strained: number) {
  if (cost <= 0) return 0;
  const relativeBurden = (cost / Math.max(available, 1)) * 10;
  const absoluteBurden = cost * 0.6;
  const scarcityBurden = available < critical ? 4 : available < strained ? 2 : 0;
  return Math.min(18, Math.round(relativeBurden + absoluteBurden + scarcityBurden));
}

export function effectiveRiskForOption(
  state: LifeState,
  profile: Profile,
  option: GameOption,
  eraContext?: EraContext | null,
) {
  const cashCost = Math.max(0, -Number(option.effects.cash || 0));
  const healthCost = Math.max(0, -Number(option.effects.health || 0));
  const cashPenalty = resourceCostPenalty(cashCost, state.cash, 10, 25);
  const healthPenalty = resourceCostPenalty(healthCost, state.health, 15, 35);
  const fitAdjustment = option.stateFit === "顺势" ? -6 : option.stateFit === "吃力" ? 8 : 0;
  const talentProtection =
    profile.talents.insight * 0.8 + profile.talents.luck * 0.7 + profile.talents.grit * 0.35;
  return Math.round(
    Math.max(
      3,
      Math.min(
        95,
        option.baseRisk +
          cashPenalty +
          healthPenalty +
          fitAdjustment +
          eraRiskAdjustment(eraContext, option) -
          talentProtection,
      ),
    ),
  );
}

export function calibrateOptionRisks(
  state: LifeState,
  profile: Profile,
  options: GameOption[],
  eraContext?: EraContext | null,
) {
  const calibrated = options.map((option) => ({ ...option }));
  const risks = () =>
    calibrated.map((option) => effectiveRiskForOption(state, profile, option, eraContext));
  const averageRisk = () => {
    const values = risks();
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };

  for (let step = 0; step < 240 && averageRisk() > 50; step += 1) {
    const values = risks();
    const adjustable = calibrated
      .map((option, index) => ({ option, risk: values[index] }))
      .filter(({ option }) => option.baseRisk > 5)
      .sort((left, right) => right.risk - left.risk)[0];
    if (!adjustable) break;
    adjustable.option.baseRisk -= 1;
  }

  const values = risks();
  const safestIndex = values.indexOf(Math.min(...values));
  while (values[safestIndex] > 30 && calibrated[safestIndex].baseRisk > 5) {
    calibrated[safestIndex].baseRisk -= 1;
    values[safestIndex] = effectiveRiskForOption(
      state,
      profile,
      calibrated[safestIndex],
      eraContext,
    );
  }
  return calibrated;
}

export function settleChoice(
  state: LifeState,
  profile: Profile,
  option: GameOption,
  roll = Math.random() * 100,
  eraContext?: EraContext | null,
) {
  const context = resourceContext(state);
  const effectiveRisk = effectiveRiskForOption(state, profile, option, eraContext);
  const riskOccurred = roll < effectiveRisk;
  const branchEffects = riskOccurred ? option.setbackEffects : option.effects;
  const raw = Object.fromEntries(
    effectKeys.map((key) => [key, Number(branchEffects[key] || 0)]),
  ) as Required<Effect>;
  const eraEffects = eraEffectAdjustment(eraContext, option, riskOccurred);
  for (const [key, amount] of Object.entries(eraEffects)) {
    const typedKey = key as keyof Omit<LifeState, "age">;
    raw[typedKey] += Number(amount || 0);
  }

  if (raw.knowledge > 0) raw.knowledge *= context.developmentConversion;
  if (raw.career > 0) raw.career *= context.developmentConversion;
  if (raw.cash > 0 && state.health < 35) raw.cash *= state.health < 15 ? 0.55 : 0.8;

  for (const key of ["knowledge", "connections", "career", "assets"] as const) {
    if (raw[key] > 0) raw[key] *= Math.max(0, (100 - state[key]) / 100);
  }

  if (state.cash < 10) raw.happiness -= 3;
  else if (state.cash < 25) raw.happiness -= 1;
  if (state.health < 15) raw.happiness -= 3;
  else if (state.health < 35) raw.happiness -= 1;

  const consequences: string[] = [];
  if (state.cash + raw.cash <= 0) {
    raw.happiness -= 5;
    raw.connections -= 2;
    raw.career -= 3;
    consequences.push("现金归零，你失去了基本周转能力，心气、事业和人脉同时受损");
  }
  if (state.health + raw.health <= 0) {
    raw.happiness -= 6;
    raw.career -= 4;
    consequences.push("健康归零，你已无法维持原有生活和工作节奏，必须进入长期恢复");
  }
  const effects = Object.fromEntries(effectKeys.map((key) => [key, bounded(raw[key])])) as Effect;
  return { effects, effectiveRisk, riskOccurred, context, consequences };
}
