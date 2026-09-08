import type { SceneCompletion } from "../domain/scene";
import type { StoryRevealCursor } from "../domain/story";
import type { WorldState } from "../domain/world";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}

export function createRevealCursor(input: {
  chapterId: string;
  worldBefore: WorldState;
  worldAfter: WorldState;
  eventIds: string[];
  activeUnitId?: string;
}): StoryRevealCursor {
  return {
    schemaVersion: 1,
    chapterId: input.chapterId,
    requiredEventIds: unique(input.eventIds),
    revealedEventIds: [],
    visibleWorld: clone(input.worldBefore),
    canonicalWorld: clone(input.worldAfter),
    phase: "hidden",
    ...(input.activeUnitId ? { activeUnitId: input.activeUnitId } : {}),
  };
}

export function revealStoryUnit(
  cursor: StoryRevealCursor,
  input: {
    unitId: string;
    coveredEventIds: string[];
    boundary: SceneCompletion;
    worldAfter?: WorldState;
  },
): StoryRevealCursor {
  if (cursor.phase === "complete") return clone(cursor);
  const required = new Set(cursor.requiredEventIds);
  const revealedEventIds = unique([
    ...cursor.revealedEventIds,
    ...input.coveredEventIds.filter((eventId) => required.has(eventId)),
  ]);
  const allCovered = cursor.requiredEventIds.every((eventId) => revealedEventIds.includes(eventId));
  const terminalBoundary = input.boundary.kind === "chapter_end" || input.boundary.kind === "ending";
  if (terminalBoundary && !allCovered) {
    throw new Error("CHAPTER_BOUNDARY_BEFORE_REVEAL_COMPLETE");
  }
  const complete = terminalBoundary && allCovered;
  return {
    ...clone(cursor),
    revealedEventIds,
    phase: complete ? "complete" : "in_progress",
    ...(input.unitId ? { activeUnitId: input.unitId } : {}),
    ...(complete ? { visibleWorld: clone(input.worldAfter ?? cursor.canonicalWorld) } : {}),
  };
}
