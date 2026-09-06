// Narrative Director 的跨章节节奏策略（V3.3）。
// WorldState 不保存小说节拍，因此以已完成章节数作为可重放的稳定锚点；
// 它只约束呈现方式，绝不参与世界结算。

import type {
  NarrativePacingDirective,
  NarrativePacingPhase,
} from "../domain/narrative-experience";
import type { SimulationEvent } from "../domain/simulation";
import type { WorldState } from "../domain/world";

type PacingInput = {
  world: WorldState;
  events: SimulationEvent[];
  tensionLevel: "quiet" | "rising" | "high";
};

type PhaseRule = Omit<NarrativePacingDirective, "chapterOrdinal" | "rationale">;

const PHASE_RULES: Record<NarrativePacingPhase, PhaseRule> = {
  setup: {
    phase: "setup",
    targetTension: "quiet",
    requiredScenePurposes: ["setup", "hook"],
    avoid: ["在没有铺垫时解决核心关系", "将普通事件直接写成高潮"],
  },
  bonding: {
    phase: "bonding",
    targetTension: "rising",
    requiredScenePurposes: ["development"],
    avoid: ["用突发冲突替代相互了解", "让角色无代价地完全坦白"],
  },
  conflict: {
    phase: "conflict",
    targetTension: "rising",
    requiredScenePurposes: ["conflict"],
    avoid: ["在同一场景立刻和解", "把分歧写成单方无理取闹"],
  },
  turning_point: {
    phase: "turning_point",
    targetTension: "rising",
    requiredScenePurposes: ["turning_point"],
    avoid: ["在没有选择或代价时强行反转", "新增无关重大事件抢走主题"],
  },
  climax: {
    phase: "climax",
    targetTension: "high",
    requiredScenePurposes: ["climax"],
    avoid: ["用误会或巧合替代已铺垫的选择", "在高潮引入新的主线"],
  },
  aftermath: {
    phase: "aftermath",
    targetTension: "quiet",
    requiredScenePurposes: ["aftermath"],
    avoid: ["未呈现代价就立刻开启下一次高潮", "将未解决问题假装已经消失"],
  },
};

function arcSlot(chapterOrdinal: number): number {
  return ((Math.max(1, chapterOrdinal) - 1) % 6) + 1;
}

function hasEarnedClimax(input: PacingInput): boolean {
  const highEvent = input.events.some((event) => event.importance >= 72);
  const urgentThread = input.world.openThreads.some(
    (thread) => thread.status === "open" && thread.urgency >= 75,
  );
  const highConflict = Object.values(input.world.relationships).some(
    (relationship) => relationship.scores.conflict >= 58,
  );
  return highEvent || urgentThread || highConflict || input.tensionLevel === "high";
}

function choosePhase(slot: number, input: PacingInput): NarrativePacingPhase {
  switch (slot) {
    case 1:
      return "setup";
    case 2:
      return "bonding";
    case 3:
      return "conflict";
    case 4:
      return "turning_point";
    case 5:
      return hasEarnedClimax(input) ? "climax" : "turning_point";
    default:
      return "aftermath";
  }
}

export function deriveNarrativePacing(input: PacingInput): NarrativePacingDirective {
  const chapterOrdinal = input.world.chapterIds.length + 1;
  const phase = choosePhase(arcSlot(chapterOrdinal), input);
  const rule = PHASE_RULES[phase];
  return {
    chapterOrdinal,
    ...rule,
    rationale: `第 ${chapterOrdinal} 章处于六拍叙事弧的 ${phase} 阶段；当前 canonical 事件与公开关系压力决定本章张力上限。`,
  };
}
