// NarrativePlan 校验器（V1.1 §4.6）
// 硬校验 1-10（§4.6 编号）+ 结构完整性；软规则在 Director Prompt 中体现。
// 校验失败 → engine 将具体失败项追加到重试 Prompt（Mind Flow 5：追加失败项，不覆盖原对话）。
import type { ChapterSpan } from "../domain/shared";
import type {
  NarrativeDirectorBrief,
  NarrativeEvidenceBundle,
  NarrativePlan,
} from "../domain/narrative";
import type { SimulationEvent } from "../domain/simulation";
import type { WorldState } from "../domain/world";
import { bundleFragmentIds } from "./retriever";

export const SCENE_COUNT_RANGE: Record<ChapterSpan, [number, number]> = {
  1: [3, 5],
  3: [5, 8],
};

export const ENDING_HOOK_TYPES = new Set([
  "open_question",
  "relationship_tension",
  "new_opportunity",
  "unresolved_cost",
  "quiet_aftershock",
]);

export type PlanValidationInput = {
  plan: NarrativePlan;
  need: { chapterId: string; lifeDomains: string[] };
  bundle: NarrativeEvidenceBundle;
  world: WorldState;
  events: SimulationEvent[];
  span: ChapterSpan;
  startYear: number;
  endYear: number;
  directorBrief?: NarrativeDirectorBrief;
};

export type PlanValidationResult = {
  valid: boolean;
  errors: string[];
};

function privateStateLeak(plan: NarrativePlan, world: WorldState): string[] {
  const leaks: string[] = [];
  const sensitive: string[] = [];
  for (const character of Object.values(world.characters)) {
    if (!character.privateState) continue;
    for (const text of [
      ...(character.privateState.hiddenGoals ?? []),
      ...(character.privateState.hiddenConcerns ?? []),
      ...(character.privateState.privateBeliefs ?? []),
    ]) {
      if (text && text.trim().length >= 4) sensitive.push(text.trim());
    }
  }
  const planText = JSON.stringify(plan);
  for (const secret of sensitive) {
    if (planText.includes(secret)) {
      leaks.push(
        `计划文本泄漏 NPC 隐藏状态（不得把 privateState 当作主角已知事实）：${secret.slice(0, 30)}…`,
      );
    }
  }
  return leaks;
}

export function validateNarrativePlan(input: PlanValidationInput): PlanValidationResult {
  const { plan, bundle, world, events, span, startYear, endYear } = input;
  const errors: string[] = [];

  if (input.directorBrief?.pacing) {
    const requiredPurposes = new Set(input.directorBrief.pacing.requiredScenePurposes);
    if (!plan.scenes.some((scene) => requiredPurposes.has(scene.purpose))) {
      errors.push(
        `本章节奏为 ${input.directorBrief.pacing.phase}，至少需要一个场景 purpose 为 ${[...requiredPurposes].join("/")}`,
      );
    }
  }

  // 1. canonicalEventIds 只能引用本章事件
  const eventIds = new Set(events.map((event) => event.id));
  for (const eventId of plan.canonicalEventIds) {
    if (!eventIds.has(eventId)) errors.push(`canonicalEventIds 引用了本章之外的事件：${eventId}`);
  }
  if (plan.canonicalEventIds.length === 0)
    errors.push("canonicalEventIds 不能为空（必须引用本章事件）");

  // 2. 每个 ScenePlan.sourceEventIds 至少 1 个
  for (const scene of plan.scenes) {
    if (!Array.isArray(scene.sourceEventIds) || scene.sourceEventIds.length === 0) {
      errors.push(`场景 ${scene.id} 的 sourceEventIds 为空（§4.6.2）`);
    }
    for (const eventId of scene.sourceEventIds ?? []) {
      if (!eventIds.has(eventId)) errors.push(`场景 ${scene.id} 引用了本章之外的事件：${eventId}`);
    }
  }

  // 3. 时间逻辑：timeLabel 内可解析年份须在章节范围内（回忆场景除外）
  for (const scene of plan.scenes) {
    const yearMatch = scene.timeLabel?.match(/(19|20)\d{2}/);
    if (yearMatch) {
      const year = Number(yearMatch[0]);
      const isFlashback = scene.timeLabel.includes("回忆") || scene.location.includes("回忆");
      if (!isFlashback && (year < startYear || year > endYear)) {
        errors.push(
          `场景 ${scene.id} 时间 ${scene.timeLabel} 超出章节范围 ${startYear}-${endYear}（§4.6.3）`,
        );
      }
    }
  }

  // 4. participantIds / povCharacterId 必须存在
  const characterIds = new Set(Object.keys(world.characters));
  for (const scene of plan.scenes) {
    if (!characterIds.has(scene.povCharacterId))
      errors.push(`场景 ${scene.id} 的 povCharacterId 不存在：${scene.povCharacterId}`);
    for (const participantId of scene.participantIds ?? []) {
      if (!characterIds.has(participantId))
        errors.push(`场景 ${scene.id} 的 participantIds 含不存在角色：${participantId}`);
    }
    if (!scene.participantIds?.includes(scene.povCharacterId)) {
      errors.push(`场景 ${scene.id} 的 povCharacterId 必须出现在 participantIds 中`);
    }
  }

  // 5. privateState 泄漏检查
  errors.push(...privateStateLeak(plan, world));

  // 6. 场景数量：1 年章 3-5；3 年章 5-8
  const [minScenes, maxScenes] = SCENE_COUNT_RANGE[span];
  if (plan.scenes.length < minScenes || plan.scenes.length > maxScenes) {
    errors.push(
      `场景数 ${plan.scenes.length} 超出 ${span} 年章范围 [${minScenes}, ${maxScenes}]（§4.6.6/4.6.7）`,
    );
  }

  // 7. 未提供 V3.3 节奏时沿用旧版高张力保底；提供节奏时已在顶部校验当前阶段。
  const hasConflictScene = plan.scenes.some((scene) =>
    ["conflict", "turning_point", "climax"].includes(scene.purpose),
  );
  if (!input.directorBrief?.pacing && !hasConflictScene) {
    errors.push("缺少 conflict / turning_point / climax 场景（§4.6.8）");
  }

  // 8. 必须有 endingHook 且类型合法
  if (!plan.endingHook?.textGoal || !ENDING_HOOK_TYPES.has(plan.endingHook?.type as string)) {
    errors.push("endingHook 缺失或类型非法（§4.6.9）");
  }

  // 9. referenceFragmentIds 必须来自当前 NarrativeEvidenceBundle
  const allowedFragmentIds = bundleFragmentIds(bundle);
  for (const fragmentId of plan.referenceFragmentIds) {
    if (!allowedFragmentIds.has(fragmentId)) {
      errors.push(`referenceFragmentIds 含非本 bundle 的引用：${fragmentId}（§4.6.10）`);
    }
  }

  // 10. 场景顺序与结构完整性
  const orders = plan.scenes.map((scene) => scene.order);
  if (new Set(orders).size !== orders.length) errors.push("场景 order 必须唯一");
  const sorted = [...orders].sort((a, b) => a - b);
  if (sorted[0] !== 1 || sorted[sorted.length - 1] !== sorted.length)
    errors.push("场景 order 必须从 1 连续编号");

  // 必填文本字段
  for (const scene of plan.scenes) {
    if (!scene.visibleGoal?.trim()) errors.push(`场景 ${scene.id} 缺少 visibleGoal`);
    if (!scene.conflict?.trim()) errors.push(`场景 ${scene.id} 缺少 conflict`);
    if (!scene.endingBeat?.trim()) errors.push(`场景 ${scene.id} 缺少 endingBeat`);
    if (!scene.location?.trim()) errors.push(`场景 ${scene.id} 缺少 location`);
  }
  if (!plan.theme?.trim()) errors.push("缺少 theme");
  if (!plan.mainConflict?.trim()) errors.push("缺少 mainConflict");

  return { valid: errors.length === 0, errors };
}
