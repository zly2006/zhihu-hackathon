import { randomUUID } from "node:crypto";
import type { ChapterChoice, ChapterDecision } from "../domain/chapter";
import type { ChapterSpan } from "../domain/shared";
import type { EvidenceBundle } from "../domain/experience";
import type { WorldSimulationOutput } from "../domain/simulation";
import type { WorldState } from "../domain/world";
import { MAX_MAJOR_EVENTS_PER_CHAPTER } from "../domain/simulation";
import { resolveDecision } from "./decision-resolver";
import { retrieveEvidence } from "./evidence-retriever";
import { selectRelevantMemories } from "./memory-selector";
import {
  repairWorldSimulationReferences,
  runWorldSimulator,
  SimulationReferenceError,
  type ModelSimulation,
  type WorldSimulatorModel,
} from "./world-simulator";
import { validateSimulationOutput, type ValidationContext } from "./simulation-validator";
import { reduceWorldState } from "./world-reducer";
import { hashState } from "./hash";
import { planNpcAgentDirectives } from "./npc-agent";
import { normalizeSceneActionContext } from "./scene-action-context";
import { createStoryInputFingerprint } from "./story-input";
import { StoryArtifactCache } from "./story-cache";
import { ExecutionBudget } from "./execution-budget";
import { canRetryGeneration, generationFailure } from "./generation-error";

export type ChapterSimulationInput = {
  worldState: WorldState;
  choice: ChapterChoice;
  selection: { optionId: "A" | "B" | "C" | "CUSTOM"; customAction?: string };
  span: ChapterSpan;
  usedExperienceIds?: string[];
  sceneActionContext?: unknown;
  executionId?: string;
  branchId?: string;
};

export type ChapterSimulationResult = {
  chapterId: string;
  evidenceBundle: EvidenceBundle;
  resolution: ReturnType<typeof resolveDecision>;
  simulation: WorldSimulationOutput;
  worldStateAfter: WorldState;
  stateBeforeHash: string;
  stateAfterHash: string;
  inputFingerprint: string;
  executionId: string;
  cacheHit: boolean;
  validationAttempts: number;
  requestCount: number;
  elapsedMs: number;
  deadlineAt: number;
};

export type ChapterSimulationProgress = (progress: {
  stage: "resolving" | "parallel" | "generating" | "validating";
  message: string;
}) => void;

const simulationCache = new StoryArtifactCache<ChapterSimulationResult>({
  ttlMs: 10 * 60 * 1000,
  maxEntries: 32,
});

function candidateMajorEventCount(candidate: unknown): number {
  if (!candidate || typeof candidate !== "object" || !Array.isArray((candidate as { events?: unknown }).events)) return 0;
  return ((candidate as { events: unknown[] }).events).filter((event) => {
    if (!event || typeof event !== "object") return false;
    const importance = (event as { importance?: unknown }).importance;
    return typeof importance === "number" && Number.isFinite(importance) && importance >= 70;
  }).length;
}

/** A reference-only repair must not spend the last request on a candidate with a known semantic violation. */
export function canAttemptReferenceRepair(candidate: unknown): boolean {
  return candidateMajorEventCount(candidate) <= MAX_MAJOR_EVENTS_PER_CHAPTER;
}

export function chapterSimulationInputFingerprint(input: ChapterSimulationInput): string {
  const normalizedSceneActionContext = normalizeSceneActionContext(input.sceneActionContext ?? input.choice.sceneActionContext);
  return createStoryInputFingerprint({
    source: "life_ai",
    saveId: input.worldState.gameId,
    runId: input.worldState.gameId,
    branchId: input.branchId ?? "main",
    pipelineVersion: 2,
    unitId: input.executionId ?? input.choice.id,
    facts: {
      worldState: input.worldState,
      choice: input.choice,
      selection: input.selection,
      span: input.span,
      usedExperienceIds: [...(input.usedExperienceIds ?? [])].sort(),
      sceneActionContext: normalizedSceneActionContext,
    },
  });
}

export async function runChapterSimulation(
  input: ChapterSimulationInput,
  options: {
    onProgress?: ChapterSimulationProgress;
    forceFresh?: boolean;
    signal?: AbortSignal;
    budget?: ExecutionBudget;
    model?: WorldSimulatorModel;
  } = {},
): Promise<ChapterSimulationResult> {
  if (!input.worldState || input.worldState.schemaVersion !== 1 || !input.worldState.protagonistId) {
    throw new Error("无效的 WorldState");
  }
  if (!input.choice || !Array.isArray(input.choice.options) || input.choice.options.length !== 3) {
    throw new Error("无效的 ChapterChoice");
  }
  if (input.span !== 1 && input.span !== 3) throw new Error("span 必须是 1 或 3");
  const executionId = input.executionId ?? `execution-${randomUUID()}`;
  const startedAt = Date.now();
  const ownsBudget = !options.budget;
  const budget = options.budget ?? new ExecutionBudget({
    executionId,
    timeoutMs: 180_000,
    maxRequests: 2,
    phaseLimits: { annual: 2 },
    phaseTimeoutsMs: { annual: 180_000 },
    signal: options.signal,
  });
  const normalizedSceneActionContext = normalizeSceneActionContext(input.sceneActionContext ?? input.choice.sceneActionContext);
  const inputFingerprint = chapterSimulationInputFingerprint(input);
  if (!options.forceFresh) {
    const cached = simulationCache.get(inputFingerprint);
    if (cached) {
      if (ownsBudget) budget.dispose();
      // A cache hit reuses the canonical receipt and its original execution
      // identity. The caller must not relabel that result as a new settlement.
      return { ...cached, cacheHit: true };
    }
  }
  let result: ChapterSimulationResult;
  try {
    result = await simulationCache.getOrPrepare(inputFingerprint, async (taskSignal) => {
    const protagonist = input.worldState.characters[input.worldState.protagonistId];
    const selectedOption = input.choice.options.find((option) => option.id === input.selection.optionId);
    const decision: ChapterDecision = {
      id: input.choice.id,
      promptTitle: input.choice.promptTitle,
      context: input.choice.context,
      options: input.choice.options,
      selectedOptionId: input.selection.optionId,
      customAction: input.selection.customAction,
      normalizedAction:
        input.selection.optionId === "CUSTOM"
          ? (input.selection.customAction ?? "").trim()
          : (selectedOption?.label ?? "").trim(),
      ...(normalizedSceneActionContext.length ? { sceneActionContext: normalizedSceneActionContext } : {}),
    };
    const chapterIndex = input.worldState.chapterIds.length;
    const startYear = input.worldState.currentYear;
    const endYear = startYear + input.span;
    const chapterId = `chapter-${executionId}`;
    const npcAgentDirectives = planNpcAgentDirectives({
      chapterId,
      world: input.worldState,
      decision,
      startYear,
      endYear,
    });

    options.onProgress?.({ stage: "resolving", message: "正在计算本章结果锚点" });
    const resolution = resolveDecision({
      saveId: input.worldState.gameId,
      chapterIndex,
      decisionId: decision.id,
      normalizedAction: decision.normalizedAction,
      estimatedRisk: selectedOption?.estimatedRisk ?? 50,
      stateFit: selectedOption?.stateFit ?? "可行",
      protagonist,
      eraContext: input.worldState.eraContext ?? null,
    });

    options.onProgress?.({ stage: "parallel", message: "正在并行召回现实经历与整理相关记忆" });
    const [evidenceBundle, relevantMemories] = await Promise.all([
      retrieveEvidence({
        world: input.worldState,
        decision: input.choice,
        selectedOptionId: input.selection.optionId,
        usedExperienceIds: input.usedExperienceIds ?? [],
      }),
      Promise.resolve(selectRelevantMemories(input.worldState)),
    ]);
    const simulationInput = {
      chapter: { id: chapterId, startYear, endYear, span: input.span },
      protagonistId: input.worldState.protagonistId,
      characters: Object.values(input.worldState.characters),
      relationships: Object.values(input.worldState.relationships),
      relevantMemories,
      openThreads: input.worldState.openThreads,
      decision,
      resolution,
      evidenceBundle,
      npcAgentDirectives,
      eraContext: input.worldState.eraContext ?? null,
    };
    const evidenceIds = new Set(
      [
        ...evidenceBundle.backgroundSimilar,
        ...evidenceBundle.decisionSimilar,
        ...evidenceBundle.relationshipRelevant,
        ...evidenceBundle.outcomeContrasts,
      ].map((experience) => experience.id),
    );
    const validationContext: ValidationContext = {
      chapterId,
      startYear,
      endYear,
      span: input.span,
      characterIds: new Set(Object.keys(input.worldState.characters)),
      relationshipIds: new Set(Object.keys(input.worldState.relationships)),
      evidenceIds,
      currentRealYear: new Date().getFullYear(),
      npcAgentDirectives,
    };

    options.onProgress?.({ stage: "generating", message: "正在计算本章世界结果" });
    let output: WorldSimulationOutput | undefined;
    let correction = "";
    let validationAttempts = 0;
    let referenceRepairUsed = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      validationAttempts = attempt + 1;
      let candidate: ModelSimulation | undefined;
      try {
        budget.assertCanStart("world-simulation", "annual");
        output = await runWorldSimulator(simulationInput, {
          ...(correction ? { correction } : {}),
          budget,
          signal: taskSignal,
          model: options.model,
          onProgress: (progress) => options.onProgress?.({
            stage: progress.stage === "retrying" ? "validating" : "generating",
            message: progress.stage === "generating"
              ? `世界推演输出中（${progress.completionTokens} tokens）`
              : `模型阶段：${progress.stage}`,
          }),
          onCandidate: (value) => {
            candidate = value;
          },
        });
        validateSimulationOutput(output, validationContext);
        break;
      } catch (error) {
        const failure = generationFailure(error);
        if (["deadline", "cancelled", "auth", "quota"].includes(failure.category)) throw error;
        const failedCandidate = error instanceof SimulationReferenceError && error.candidate
          ? error.candidate
          : candidate;
        if (error instanceof SimulationReferenceError && failedCandidate && canAttemptReferenceRepair(failedCandidate) && !referenceRepairUsed && budget.snapshot().requestsStarted < budget.maxRequests) {
          referenceRepairUsed = true;
          validationAttempts += 1;
          options.onProgress?.({ stage: "validating", message: `仅修正有限引用：${error.field}` });
          output = await repairWorldSimulationReferences(simulationInput, failedCandidate, error, {
            budget,
            signal: taskSignal,
            model: options.model,
            onProgress: (progress) => options.onProgress?.({ stage: "validating", message: `引用修正：${progress.stage}` }),
          });
          validateSimulationOutput(output, validationContext);
          break;
        }
        if (attempt === 1 || !canRetryGeneration(error)) throw error;
        const candidateMajorCount = candidateMajorEventCount(failedCandidate);
        const message = candidateMajorCount > MAX_MAJOR_EVENTS_PER_CHAPTER
          ? `${failure.message}；同一候选还有 ${candidateMajorCount} 个 importance≥70 事件，最多允许 ${MAX_MAJOR_EVENTS_PER_CHAPTER} 个。`
          : failure.message;
        const candidateContext = failedCandidate
          ? `\n上一次完整候选（只允许修正上面列出的失败项；不得增删事件、改变 consequence、因果、引用或无关字段）：\n${JSON.stringify(failedCandidate)}`
          : "";
        correction = ["transport", "rate_limit"].includes(failure.category)
          ? ""
          : `上次候选只在以下程序校验项失败：${message}。保持已确定的结果锚点、风险后果和原始引用，不重写无关事件；重新输出完整 JSON。${candidateContext}`;
        options.onProgress?.({ stage: "validating", message: `第 ${attempt + 1} 次生成：${message}` });
      }
    }
    if (!output) throw new Error("世界推演未能产出有效结果");
    const worldStateAfter = reduceWorldState(input.worldState, output, { chapterId, endYear });
    return {
      chapterId,
      evidenceBundle,
      resolution,
      simulation: output,
      worldStateAfter,
      stateBeforeHash: hashState(input.worldState),
      stateAfterHash: hashState(worldStateAfter),
      inputFingerprint,
      executionId,
      cacheHit: false,
      validationAttempts,
      requestCount: budget.snapshot().requestsStarted,
      elapsedMs: Math.max(0, Date.now() - startedAt),
      deadlineAt: budget.deadlineAt,
    };
    }, { signal: options.signal ?? budget.signal });
  } finally {
    if (ownsBudget) budget.dispose();
  }
  return {
    ...result,
    cacheHit: result.cacheHit || result.executionId !== executionId,
  };
}

export function clearChapterSimulationCache(): void {
  simulationCache.clear();
}
