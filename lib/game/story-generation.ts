import type { SimulationEvent } from "../domain/simulation";
import type { StoryIdentity, StoryUnit } from "../domain/story";
import type { WorldState } from "../domain/world";
import type { ExecutionBudget } from "./execution-budget";
import {
  buildNarrativeDirectorBrief,
} from "./narrative-director";
import { deriveNarrativePacing } from "./narrative-pacing";
import {
  generateInteractiveScenePackage,
  type LiveSceneChapterContext,
  type LiveSceneModel,
} from "./live-scene-generator";
import { createStoryInputFingerprint } from "./story-input";
import { StoryArtifactCache } from "./story-cache";
import { validatePublishedStoryUnit } from "./story-generation-validator";

export const LIFE_STORY_CONTENT_VERSION = "life-ai-v1" as const;
export const LIFE_STORY_PREPARE_TTL_MS = 10 * 60 * 1000;

const lifeStoryCache = new StoryArtifactCache<StoryUnit>({
  ttlMs: LIFE_STORY_PREPARE_TTL_MS,
  maxEntries: 32,
});

export type LifeStoryPreparationInput = {
  world: WorldState;
  events: SimulationEvent[];
  chapter: LiveSceneChapterContext;
  saveId?: string;
  runId?: string;
  branchId?: string;
  unitId?: string;
  inputFingerprint?: string;
  model?: LiveSceneModel;
  signal?: AbortSignal;
  budget?: ExecutionBudget;
  requiredEventIds?: string[];
  revealedEventIds?: string[];
  isFinalUnit?: boolean;
  nextUnitId?: string;
};

function publicEvents(events: SimulationEvent[]): Array<Record<string, unknown>> {
  return events.slice(-12).map((event) => ({
    id: event.id,
    year: event.year,
    title: event.title,
    summary: event.summary,
    participantIds: [...event.participantIds],
    visibility: event.visibility,
  }));
}

function directorContext(input: LifeStoryPreparationInput): LiveSceneChapterContext {
  const directorBrief = input.chapter.directorBrief ?? buildNarrativeDirectorBrief({
    chapterId: input.chapter.id,
    world: input.world,
    events: input.events,
    decision: input.chapter.decision,
    span: input.chapter.span,
    startYear: input.chapter.startYear,
    endYear: input.chapter.endYear,
  });
  const pacing = input.chapter.pacing ?? deriveNarrativePacing({
    world: input.world,
    events: input.events,
    tensionLevel: directorBrief.tensionLevel,
  });
  return { ...input.chapter, directorBrief, pacing };
}

function unitIdFor(input: LifeStoryPreparationInput): string {
  return input.unitId ?? `chapter-${input.chapter.id}-unit-1`;
}

export function lifeStoryInputFingerprint(input: LifeStoryPreparationInput): string {
  const chapter = directorContext(input);
  const source = "life_ai" as const;
  const saveId = input.saveId ?? input.world.gameId;
  const runId = input.runId ?? input.world.gameId;
  const branchId = input.branchId ?? "main";
  const unitId = unitIdFor(input);
  return createStoryInputFingerprint({
    source,
    saveId,
    runId,
    branchId,
    pipelineVersion: 2,
    unitId,
    facts: {
      world: {
        gameId: input.world.gameId,
        currentYear: input.world.currentYear,
        protagonistId: input.world.protagonistId,
        characterIds: Object.keys(input.world.characters).sort(),
        relationshipScores: Object.values(input.world.relationships).map((relationship) => ({
          id: relationship.id,
          scores: relationship.scores,
          publicSummary: relationship.publicSummary,
        })),
        openThreads: input.world.openThreads.map((thread) => ({ id: thread.id, label: thread.label, urgency: thread.urgency, status: thread.status })),
      },
      events: publicEvents(input.events),
      chapter: {
        id: chapter.id,
        index: chapter.index,
        startYear: chapter.startYear,
        endYear: chapter.endYear,
        span: chapter.span,
        decision: {
          id: chapter.decision.id,
          selectedOptionId: chapter.decision.selectedOptionId,
          normalizedAction: chapter.decision.normalizedAction,
          sceneActionContext: chapter.decision.sceneActionContext,
        },
        summary: chapter.summary,
        directorBrief: chapter.directorBrief,
        pacing: chapter.pacing,
      },
      unit: {
        requiredEventIds: [...(input.requiredEventIds ?? input.events.map((event) => event.id))].sort(),
        revealedEventIds: [...(input.revealedEventIds ?? [])].sort(),
        isFinalUnit: input.isFinalUnit === true,
        nextUnitId: input.nextUnitId,
      },
    },
  });
}

export async function prepareLifeStoryUnit(input: LifeStoryPreparationInput): Promise<StoryUnit> {
  const chapter = directorContext(input);
  const unitId = unitIdFor(input);
  const branchId = input.branchId ?? "main";
  const identity: StoryIdentity = {
    saveId: input.saveId ?? input.world.gameId,
    runId: input.runId ?? input.world.gameId,
    branchId,
    source: "life_ai",
    contentVersion: LIFE_STORY_CONTENT_VERSION,
    pipelineVersion: 2,
  };
  const inputFingerprint = lifeStoryInputFingerprint(input);
  if (input.inputFingerprint && input.inputFingerprint !== inputFingerprint) {
    throw new Error("主游戏 story unit inputFingerprint 与服务端事实不匹配");
  }
  return lifeStoryCache.getOrPrepare(inputFingerprint, async () => {
    const scenePackage = await generateInteractiveScenePackage({
      world: input.world,
      events: input.events,
      chapter,
      unitId,
      requiredEventIds: input.requiredEventIds,
      revealedEventIds: input.revealedEventIds,
      isFinalUnit: input.isFinalUnit,
      nextUnitId: input.nextUnitId,
      version: 1,
    }, {
      model: input.model,
      signal: input.signal,
      budget: input.budget,
    });
    const sourceEventIds = [...new Set(scenePackage.scenes.flatMap((scene) => scene.sourceEventIds))];
    const requiredEventIds = [...new Set(input.requiredEventIds ?? input.events.map((event) => event.id))];
    const alreadyRevealed = new Set(input.revealedEventIds ?? []);
    const coveredEventIds = requiredEventIds.filter((eventId) => alreadyRevealed.has(eventId) || sourceEventIds.includes(eventId));
    const pendingEventIds = requiredEventIds.filter((eventId) => !coveredEventIds.includes(eventId));
    const unit: StoryUnit = {
      id: unitId,
      identity,
      inputFingerprint,
      phase: "live",
      sourceEventIds,
      payload: { kind: "scene", package: scenePackage },
      coverage: { requiredEventIds, coveredEventIds, pendingEventIds },
      ...(scenePackage.completion ? { continuation: scenePackage.completion } : {}),
    };
    return validatePublishedStoryUnit(unit);
  }, { signal: input.signal ?? input.budget?.signal });
}

export function clearLifeStoryCache(): void {
  lifeStoryCache.clear();
}
