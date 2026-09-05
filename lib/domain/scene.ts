// Scene Runtime 的公开内容、游标和选择结算契约。
// 场景内容不拥有 WorldState；只有服务端规则和 reducer 可以改变世界。

import type { Chapter, GameSave } from "./chapter";
import type { DialogueBlock, DialogueCharacter, DialogueChoiceId } from "./dialogue";
import type { RelationshipScores } from "./relationship";
import type { SimulationEvent } from "./simulation";
import type { WorldState } from "./world";

export type SceneMode = "retrospective" | "live";

export type RelationshipLevel = "stranger" | "familiar" | "friend" | "trusted" | "important";

export type SceneRequirement =
  | {
      kind: "relationship";
      targetCharacterId: string;
      minLevel?: RelationshipLevel;
      minTrust?: number;
      maxConflict?: number;
      minCommitment?: number;
    }
  | { kind: "flag"; key: string; equals: boolean };

export type SceneTarget =
  | { kind: "scene"; sceneId: string }
  | { kind: "chapter_end" }
  | { kind: "ending"; endingId: string };

export type SceneCue = {
  characterId: string;
  emotion?: string;
  pose?: string;
  animation?: "idle" | "speaking" | "focus" | "shake" | "enter" | "exit";
};

export type RuntimeChoice = {
  id: DialogueChoiceId;
  label: string;
  ruleId: string;
  targetCharacterId?: string;
  requirements: SceneRequirement[];
  next: SceneTarget;
};

export type ReadOnlyChoice = {
  id: DialogueChoiceId;
  label: string;
};

export type RuntimeBlock =
  | {
      id: string;
      content: Exclude<DialogueBlock, { type: "choice" }>;
      cues?: SceneCue[];
    }
  | {
      id: string;
      content: {
        type: "choice";
        text: string;
        choices: Array<RuntimeChoice | ReadOnlyChoice>;
        readOnly?: boolean;
      };
      cues?: SceneCue[];
    };

export type RuntimeScene = {
  id: string;
  mode: SceneMode;
  background: string;
  timeLabel: string;
  year: number;
  sourceEventIds: string[];
  characters: DialogueCharacter[];
  blocks: RuntimeBlock[];
  defaultNext: SceneTarget;
};

export type SceneEnding = {
  id: string;
  title: string;
  summary: string;
};

export type ScenePackage = {
  schemaVersion: 1;
  id: string;
  version: number;
  chapterId: string;
  entrySceneId: string;
  scenes: RuntimeScene[];
  endings: SceneEnding[];
};

export type SceneTriggerKind = "contact" | "emotional" | "hidden";

// C 可以提交的主动场景输入只包含公开触发事实，不携带 NPC 私密目标。
export type SceneTriggerCandidate = {
  triggerId: string;
  kind: SceneTriggerKind;
  characterId: string;
  sourceEventIds: string[];
  package: ScenePackage;
};

export type SceneTriggerStatus = "queued" | "active" | "consumed" | "dismissed";

export type SceneTriggerRecord = SceneTriggerCandidate & {
  branchId: string;
  status: SceneTriggerStatus;
  queuedAt: string;
  activatedAt?: string;
  completedAt?: string;
};

export type SceneRuntimeStatus =
  | "reading"
  | "awaiting_choice"
  | "submitting"
  | "feedback"
  | "completed"
  | "error";

export type SceneRuntimeState = {
  schemaVersion: 1;
  branchId: string;
  chapterId: string;
  packageId: string;
  packageVersion: number;
  sceneId: string;
  blockId: string;
  status: SceneRuntimeStatus;
  playbackMode: "manual" | "auto";
  readBlockIds: string[];
  selectedActionId?: string;
  pendingAction?: {
    requestId: string;
    choiceId: DialogueChoiceId;
    issuedAt: string;
    expectedRevision: number;
  };
  feedbackNext?: SceneTarget;
  readOnly?: boolean;
  errorCode?: string;
};

export type SceneActionRecord = {
  id: string;
  branchId: string;
  chapterId: string;
  packageId: string;
  packageVersion: number;
  sceneId: string;
  blockId: string;
  choiceId: DialogueChoiceId;
  label: string;
  ruleId: string;
  targetCharacterId?: string;
  eventIds: string[];
  actualRelationshipDelta: Partial<RelationshipScores>;
  flagsAfter: Record<string, boolean>;
  next: SceneTarget;
  beforeHash: string;
  afterHash: string;
  committedAt: string;
};

export type SceneSaveProjection = Pick<
  GameSave,
  "worldState" | "chapters" | "events" | "experienceCache" | "activeBranchId"
> & {
  runtime: SceneRuntimeState;
  actions: SceneActionRecord[];
  flags: Record<string, boolean>;
  revision: number;
};

export type SceneChoiceRequest = {
  projection: SceneSaveProjection;
  package: ScenePackage;
  requestId: string;
  issuedAt: string;
  expectedRevision: number;
  choiceId: DialogueChoiceId;
};

export type SceneChoiceResponse = {
  requestId: string;
  beforeRevision: number;
  afterRevision: number;
  record: SceneActionRecord;
  events: SimulationEvent[];
  worldStateAfter: WorldState;
  runtimeAfter: SceneRuntimeState;
  flagsAfter: Record<string, boolean>;
  feedback: string;
  replayed: boolean;
  projectionAfter: SceneSaveProjection;
};

export type SceneChapterReference = Pick<Chapter, "id" | "index" | "startYear" | "endYear">;
