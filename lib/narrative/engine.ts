// Narrative Engine 编排（V1.1 §4.8）
// buildNarrativeNeed → retrieveNarrativeEvidence → generateNarrativePlan → validateNarrativePlan → complete
// 校验失败时把具体失败项追加到下一轮 Director Prompt（Mind Flow 5），最多重试 2 次。
// KB 不可用 → 空 bundle，Director 以无参考模式生成（验收：KB 故障有 fallback，Director 失败不修改 canonical）。
import type { ChapterSpan } from "../domain/shared";
import type { ChapterDecision } from "../domain/chapter";
import type { SimulationEvent } from "../domain/simulation";
import type { WorldState } from "../domain/world";
import type {
  NarrativeDirectorBrief,
  NarrativeEvidenceBundle,
  NarrativePlan,
} from "../domain/narrative";
import { buildNarrativeNeed } from "./need-builder";
import { retrieveNarrativeEvidence } from "./retriever";
import { generateNarrativePlan } from "./planner";
import { validateNarrativePlan } from "./validator";

export type NarrativeEngineInput = {
  chapterId: string;
  span: ChapterSpan;
  world: WorldState; // 章节开始前状态
  events: SimulationEvent[];
  decision: ChapterDecision;
  startYear: number;
  endYear: number;
  directorBrief?: NarrativeDirectorBrief;
};

export type NarrativeEngineResult = {
  narrativePlan: NarrativePlan;
  narrativeEvidence: NarrativeEvidenceBundle;
  metrics: {
    kbAvailable: boolean;
    retrievalTotal: number;
    directorAttempts: number;
    validationErrorsAtSuccess: string[];
  };
};

const MAX_DIRECTOR_ATTEMPTS = 3;

export async function runNarrativeEngine(
  input: NarrativeEngineInput,
): Promise<NarrativeEngineResult> {
  const { chapterId, span, world, events, decision, startYear, endYear, directorBrief } = input;

  const need = buildNarrativeNeed({ chapterId, span, world, events, decision });
  const bundle = retrieveNarrativeEvidence(need);
  const info = { world, events, decision, span, startYear, endYear };

  let previousErrors: string[] = [];
  let plan: NarrativePlan | null = null;
  let attempts = 0;

  for (attempts = 1; attempts <= MAX_DIRECTOR_ATTEMPTS; attempts++) {
    plan = await generateNarrativePlan({ need, bundle, info, previousErrors, directorBrief });
    const validation = validateNarrativePlan({
      plan,
      need,
      bundle,
      world,
      events,
      span,
      startYear,
      endYear,
      directorBrief,
    });
    if (validation.valid) {
      return {
        narrativePlan: plan,
        narrativeEvidence: bundle,
        metrics: {
          kbAvailable: bundle.total > 0,
          retrievalTotal: bundle.total,
          directorAttempts: attempts,
          validationErrorsAtSuccess: [],
        },
      };
    }
    previousErrors = validation.errors;
  }

  // 三次仍未通过：返回最近一次 plan + 校验错误（由调用方决定降级），不修改 canonical。
  return {
    narrativePlan: plan as NarrativePlan,
    narrativeEvidence: bundle,
    metrics: {
      kbAvailable: bundle.total > 0,
      retrievalTotal: bundle.total,
      directorAttempts: attempts - 1,
      validationErrorsAtSuccess: previousErrors,
    },
  };
}
