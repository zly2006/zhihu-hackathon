import type { ChapterChoice } from "./chapter";
import type { SceneCompletion, ScenePackage } from "./scene";
import type { WorldState } from "./world";

export const STORY_SCHEMA_VERSION = 1 as const;
export const STORY_PIPELINE_VERSION = 2 as const;

export type StorySource = "zhao_scripted" | "zhao_ai" | "life_ai";
export type StoryActionKind = "scene_choice" | "chapter_decision" | "story_command";
export type StoryPhase = "opening" | "decision" | "response" | "outcome" | "live" | "ending";

export type StoryIdentity = {
  saveId: string;
  runId: string;
  branchId: string;
  source: StorySource;
  contentVersion: string;
  pipelineVersion: number;
};

export type StoryRequestIdentity = StoryIdentity & {
  requestId: string;
  inputFingerprint: string;
  sourceUnitId: string;
};

export type PublicStoryLine =
  | { type: "narration"; text: string }
  | { type: "dialogue"; speakerId: string; text: string; emotion?: string };

export type StoryUnitPayload =
  | { kind: "scene"; package: ScenePackage }
  | { kind: "chapter_decision"; opening: PublicStoryLine[]; choice: ChapterChoice };

export type StoryUnit = {
  id: string;
  identity: StoryIdentity;
  inputFingerprint: string;
  phase: StoryPhase;
  sourceEventIds: string[];
  payload: StoryUnitPayload;
  coverage?: StoryUnitCoverage;
  continuation?: SceneCompletion;
};

export type StoryUnitCoverage = {
  requiredEventIds: string[];
  coveredEventIds: string[];
  pendingEventIds: string[];
};

export type StoryRevealCursor = {
  schemaVersion: typeof STORY_SCHEMA_VERSION;
  chapterId: string;
  requiredEventIds: string[];
  revealedEventIds: string[];
  visibleWorld: WorldState;
  canonicalWorld: WorldState;
  phase: "hidden" | "in_progress" | "complete";
  activeUnitId?: string;
};

export type StoryJournalPhase =
  | "prepared"
  | "submitted"
  | "canonical_committed"
  | "presentation_ready"
  | "failed";

export type StoryJournal = {
  actionKind: StoryActionKind;
  requestId: string;
  inputFingerprint: string;
  expectedRevision: number;
  phase: StoryJournalPhase;
  acceptedAt: string;
  canonicalReceiptId?: string;
  canonicalRevision?: number;
  unitId?: string;
  error?: { code: string; message: string };
};

export type StoryTrace = {
  requestId?: string;
  actionReceived?: number;
  prefetchStarted?: number;
  queueMs?: number;
  canonicalReady?: number;
  unitReady?: number;
  persisted?: number;
  displayed?: boolean;
  displayedAt?: number;
  boundaryReached?: number;
  boundaryWaitMs?: number;
  canonicalMs?: number;
  writerMs?: number;
  transportAttempts: number;
  validationAttempts: number;
  artifactReuse: boolean;
  discardedTokens: number;
};

export type StorySessionState = {
  schemaVersion: typeof STORY_SCHEMA_VERSION;
  identity: StoryIdentity;
  status: "idle" | "preparing" | "awaiting_input" | "submitting" | "canonical_committed" | "presenting" | "completed" | "error";
  canonicalRevision: number;
  activeUnitId?: string;
  preparedUnitId?: string;
  publishedUnitIds: string[];
  journal?: StoryJournal;
  trace: StoryTrace;
  lastError?: { code: string; message: string };
};

export type StorySseEventName = "accepted" | "unit_ready" | "canonical_committed" | "complete" | "error" | "heartbeat";

export type StorySseEvent = {
  event: StorySseEventName;
  seq: number;
  requestId: string;
  inputFingerprint?: string;
  payload?: unknown;
};
