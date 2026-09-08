import type {
  SceneReadingEntry,
  SceneReadingState,
  SceneRuntimeStatus,
} from "../domain/scene";
import type { DialogueChoiceId } from "../domain/dialogue";

export type SceneReadingBlockInput = {
  mode: string;
  branchId: string;
  chapterId: string;
  packageId: string;
  packageVersion: number;
  sceneId: string;
  blockId: string;
  blockType: SceneReadingEntry["blockType"];
  text: string;
  speaker?: string;
  selectedChoiceId?: DialogueChoiceId;
  selectedChoiceLabel?: string;
};

export type SceneReadingPreferences = {
  schemaVersion: 1;
  autoSpeed: "slow" | "standard" | "fast";
  fontScale: "small" | "standard" | "large";
  subtitleBackground: "soft" | "standard" | "strong";
};

export const DEFAULT_SCENE_READING_PREFERENCES: SceneReadingPreferences = {
  schemaVersion: 1,
  autoSpeed: "standard",
  fontScale: "standard",
  subtitleBackground: "standard",
};

export function createSceneReadingState(): SceneReadingState {
  return { schemaVersion: 1, entries: [], readKeys: [] };
}
/** A stable, browser-safe public-text fingerprint for reading history keys. */
export function publicSceneTextHash(text: string): string {
  let hash = 2166136261;
  for (const character of text) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function sceneReadingKey(input: SceneReadingBlockInput): string {
  const hash = publicSceneTextHash(input.text);
  return [
    input.mode,
    input.branchId,
    input.chapterId,
    input.packageId,
    `v${input.packageVersion}`,
    input.sceneId,
    input.blockId,
    hash,
  ].join(":");
}

export function isSceneBlockRead(
  state: SceneReadingState | undefined,
  input: SceneReadingBlockInput,
): boolean {
  if (!state) return false;
  const key = sceneReadingKey(input);
  return state.readKeys.includes(key) || state.entries.some((entry) => entry.key === key);
}

export function recordSceneBlockRead(
  state: SceneReadingState | undefined,
  input: SceneReadingBlockInput,
  readAt: string,
): SceneReadingState {
  const current = state ?? createSceneReadingState();
  const key = sceneReadingKey(input);
  if (current.readKeys.includes(key) || current.entries.some((entry) => entry.key === key)) {
    return {
      schemaVersion: 1,
      readKeys: [...current.readKeys],
      entries: current.entries.map((entry) => ({ ...entry })),
    };
  }
  const entry: SceneReadingEntry = {
    key,
    mode: input.mode,
    branchId: input.branchId,
    chapterId: input.chapterId,
    packageId: input.packageId,
    packageVersion: input.packageVersion,
    sceneId: input.sceneId,
    blockId: input.blockId,
    blockType: input.blockType,
    text: input.text,
    ...(input.speaker ? { speaker: input.speaker } : {}),
    ...(input.selectedChoiceId ? { selectedChoiceId: input.selectedChoiceId } : {}),
    ...(input.selectedChoiceLabel ? { selectedChoiceLabel: input.selectedChoiceLabel } : {}),
    contentHash: publicSceneTextHash(input.text),
    readAt,
  };
  return {
    schemaVersion: 1,
    readKeys: [...new Set([...current.readKeys, key])],
    entries: [...current.entries.map((item) => ({ ...item })), entry],
  };
}

export function autoDelayMs(
  text: string,
  speed: SceneReadingPreferences["autoSpeed"] = "standard",
): number {
  const speedFactor = speed === "slow" ? 0.75 : speed === "fast" ? 1.25 : 1;
  return Math.max(1500, Math.round((1200 + Array.from(text).length * 80) / speedFactor));
}

export type AutoAdvanceGate = {
  visibility: "visible" | "hidden";
  status: SceneRuntimeStatus;
  readOnly?: boolean;
  modalOpen?: boolean;
  observationWindow?: boolean;
  error?: boolean;
};

export function canAutoAdvance(input: AutoAdvanceGate): boolean {
  return (
    input.visibility === "visible" &&
    input.status === "reading" &&
    input.readOnly !== true &&
    input.modalOpen !== true &&
    input.observationWindow !== true &&
    input.error !== true
  );
}

export function normalizeSceneReadingPreferences(value: unknown): SceneReadingPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_SCENE_READING_PREFERENCES;
  const candidate = value as Partial<SceneReadingPreferences>;
  return {
    schemaVersion: 1,
    autoSpeed: candidate.autoSpeed === "slow" || candidate.autoSpeed === "fast" ? candidate.autoSpeed : "standard",
    fontScale: candidate.fontScale === "small" || candidate.fontScale === "large" ? candidate.fontScale : "standard",
    subtitleBackground:
      candidate.subtitleBackground === "soft" || candidate.subtitleBackground === "strong"
        ? candidate.subtitleBackground
        : "standard",
  };
}
