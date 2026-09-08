import type { NpcProactiveEvent } from "./narrative-experience";
import type { ScenePackage } from "./scene";

export const ZHAO_LENG_DEMO_ID = "zhao-leng-adult-romance-v1" as const;
export const ZHAO_LENG_CONTENT_VERSION = 1 as const;

export type ZhaoLengBeatId =
  | "zl-01-message"
  | "zl-02-library"
  | "zl-03-boundary"
  | "zl-04-opportunity"
  | "zl-05-argument"
  | "zl-06-distance"
  | "zl-07-return"
  | "zl-08-choice"
  | "zl-09-consequence"
  | "zl-10-letter"
  | "zl-11-future"
  | "zl-12-hook";

export type ZhaoLengEndingId = "mutual-trust" | "kind-distance" | "library-letter";
export type ZhaoLengPhaseId = "first-meet" | "future-conflict" | "major-decision" | "ending";
export type ZhaoLengGenerationMode = "llm" | "scripted";

export type NarrativeDelivery = {
  source: "npc-agent" | "scripted-beat";
  contextId: string;
  branchId: string;
  directiveId: string;
  event?: NpcProactiveEvent;
  scriptedBeatId?: ZhaoLengBeatId;
  status: "queued" | "presented" | "opened" | "answered" | "dismissed";
  responseActionId?: string;
};

export type NarrativeRuntimeState = {
  schemaVersion: 1;
  deliveries: NarrativeDelivery[];
};

export type ZhaoLengRuntimeState = {
  schemaVersion: 1;
  demoId: typeof ZHAO_LENG_DEMO_ID;
  contentVersion: typeof ZHAO_LENG_CONTENT_VERSION;
  generationMode: ZhaoLengGenerationMode;
  phaseId: ZhaoLengPhaseId;
  beatId: ZhaoLengBeatId;
  stage: "reading" | "ready_to_advance" | "hidden_reading" | "ending_reading" | "ended";
  completedBeatIds: ZhaoLengBeatId[];
  observedClueIds: string[];
  consumedEventIds: string[];
  relationshipIntent: "undecided" | "together" | "friends" | "apart";
  packagesById: Record<string, ScenePackage>;
  cacheKeys: Record<string, string>;
  commandReceipts: Record<string, { payloadHash: string; resultingPackageId: string }>;
  preparedArtifact?: ZhaoLengPreparedArtifact;
  endingId?: ZhaoLengEndingId;
};

export type ZhaoLengCommandBase = {
  requestId: string;
  expectedRevision: number;
  expectedPackageId: string;
  expectedBranchId?: string;
  issuedAt: string;
};

export type ZhaoLengCommand = ZhaoLengCommandBase &
  (
    | { type: "observe_library_card" }
    | { type: "advance_beat" }
    | { type: "open_hidden" }
    | { type: "finish_hidden" }
    | { type: "finish_normal" }
    | { type: "finish_ending" }
  );

export type ZhaoLengWrittenLine =
  | { type: "narration"; text: string }
  | {
      type: "dialogue";
      speakerId: "protagonist" | "npc-zhao-leng";
      text: string;
      emotion: string;
    };

export type ZhaoLengWrittenBeat = {
  beatId: ZhaoLengBeatId;
  opening: ZhaoLengWrittenLine[];
  feedback: Partial<Record<"A" | "B" | "C", ZhaoLengWrittenLine[]>>;
};

export type ZhaoLengPreparedArtifact = {
  schemaVersion: 1;
  artifactId: string;
  beatId: ZhaoLengBeatId;
  inputFingerprint: string;
  generationMode: ZhaoLengGenerationMode;
  contentVersion: typeof ZHAO_LENG_CONTENT_VERSION;
  pipelineVersion: number;
  branchId: string;
  sourcePackageId: string;
  sourcePackageVersion: number;
  written: ZhaoLengWrittenBeat;
  createdAt: string;
  expiresAt: string;
};

export type ZhaoLengReadingPackage = {
  kind: "reading";
  id: string;
  beatId: ZhaoLengBeatId | "zhao-leng-library-letter" | ZhaoLengEndingId;
  lines: ZhaoLengWrittenLine[];
};

export function createInitialZhaoLengRuntime(input: {
  mode: ZhaoLengGenerationMode;
}): ZhaoLengRuntimeState {
  return {
    schemaVersion: 1,
    demoId: ZHAO_LENG_DEMO_ID,
    contentVersion: ZHAO_LENG_CONTENT_VERSION,
    generationMode: input.mode,
    phaseId: "first-meet",
    beatId: "zl-01-message",
    stage: "reading",
    completedBeatIds: [],
    observedClueIds: [],
    consumedEventIds: [],
    relationshipIntent: "undecided",
    packagesById: {},
    cacheKeys: {},
    commandReceipts: {},
  };
}

export function createInitialNarrativeRuntime(): NarrativeRuntimeState {
  return { schemaVersion: 1, deliveries: [] };
}

export function cloneZhaoLengRuntime(value: ZhaoLengRuntimeState): ZhaoLengRuntimeState {
  return JSON.parse(JSON.stringify(value)) as ZhaoLengRuntimeState;
}

export function cloneNarrativeRuntime(value: NarrativeRuntimeState): NarrativeRuntimeState {
  return JSON.parse(JSON.stringify(value)) as NarrativeRuntimeState;
}
