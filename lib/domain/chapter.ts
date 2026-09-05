// Chapter（方案 §16）、ChapterDecision / DecisionResolution（方案 §17）、GameSave（方案 §25）
// Chapter 保存：选择 + 证据引用 + 真实模拟结果引用 + 小说 + 摘要。
// 真正的世界状态仍由 WorldState 决定。

import type { ChapterId, ChapterSpan, ExperienceId, GameMode, MemoryId, SimulationEventId } from "./shared";
import type { WorldState } from "./world";
import type { SimulationEvent } from "./simulation";
import type { LifeExperience } from "./experience";
import type { NarrativePlan } from "./narrative";
import type { DialogueScene } from "./dialogue";
import type { BranchId, GameBranch, SnapshotId, WorldSnapshot } from "./snapshot";
import type {
  SceneActionRecord,
  ScenePackage,
  SceneRuntimeState,
} from "./scene";
import type { PublicSceneActionContext } from "../game/scene-action-context";
import type { WorldSimulationOutput } from "./simulation";

export type PendingChapterStage = "simulated" | "plan" | "reflection" | "novel" | "dialogue" | "live_scene" | "ready" | "error";

export type PendingChapter = {
  executionId: string;
  chapterId: ChapterId;
  startYear: number;
  endYear: number;
  stateBeforeHash: string;
  stateAfterHash: string;
  worldStateBefore: WorldState;
  worldStateAfter: WorldState;
  selection?: ChapterDecision;
  resolution?: DecisionResolution;
  simulationOutput?: WorldSimulationOutput;
  eventIds: SimulationEventId[];
  evidenceIds: ExperienceId[];
  featuredExperienceIds: ExperienceId[];
  stage: PendingChapterStage;
  novelCompleted?: boolean;
  dialogueCompleted?: boolean;
  planCompleted?: boolean;
  reflectionCompleted?: boolean;
  liveSceneCompleted?: boolean;
  novel?: Chapter["novel"];
  dialogue?: DialogueScene[];
  liveScenePackage?: ScenePackage;
  narrative?: Chapter["narrative"];
  error?: { code: string; message: string };
  createdAt: string;
  updatedAt: string;
};

export type ChapterDecision = {
  id: string;
  promptTitle: string;
  context: string;

  options: Array<{
    id: "A" | "B" | "C";
    label: string;
    description: string;
    strategyTag: string;
    estimatedRisk: number;
    stateFit: "顺势" | "可行" | "吃力";
  }>;

  selectedOptionId: "A" | "B" | "C" | "CUSTOM";
  customAction?: string;
  normalizedAction: string;
  // B → C：上一已完成章的公开 live 行动摘要，不进入小说全文或私密状态。
  sceneActionContext?: PublicSceneActionContext[];
};

// 待选决策：Choice Generator 的产物（玩家尚未选择），选择后组装成完整 ChapterDecision。
export type ChapterChoice = {
  id: string;
  promptTitle: string;
  context: string;
  options: ChapterDecision["options"];
  sceneActionContext?: PublicSceneActionContext[];
};

// DecisionResolution（方案 §17）：结果倾向由程序计算并持久化。
// 同一存档、同一章节、同一选择必须得到同一个随机结果（确定性随机）。
export type DecisionResolution = {
  effectiveRisk: number; // 0-100
  outcomeAnchor: "favorable" | "mixed" | "setback";
  uncertaintySeed: string; // SHA-256(saveId:chapterIndex:decisionId:normalizedAction)
  reasonSummary: string;
};

export type NovelScene = {
  id: string;
  heading?: string;
  timeLabel?: string;
  text: string;
};

export type Chapter = {
  id: ChapterId;
  index: number;

  startYear: number;
  endYear: number;
  span: ChapterSpan;

  stateBeforeHash: string;

  decision: ChapterDecision;
  resolution: DecisionResolution;

  evidence: {
    experienceIds: ExperienceId[];
    featuredExperienceIds: ExperienceId[];
  };

  simulationEventIds: SimulationEventId[];

  stateAfterHash: string;

  novel: {
    title: string;
    subtitle?: string;
    scenes: NovelScene[];
    generatedAt: string;
    version: number;
  };

  // V2.1 Galgame 表现层产物；缺失时由 NovelScene 确定性降级展示。
  dialogue?: DialogueScene[];

  summary: {
    keyEvents: string[];
    characterChanges: string[];
    relationshipChanges: string[];
    openThreads: string[];
  };

  // V1.1 Narrative Engine 产物（可选，§4.9；GameSave schemaVersion 不 bump，旧存档兼容）
  narrative?: {
    plan: NarrativePlan;
    referenceFragmentIds: string[];
    directorVersion: number;
  };

  memoryIds: MemoryId[];

  createdAt: string;
};

// GameSave v1（方案 §25）：客户端 localStorage，versioned JSON。
// experienceCache 只保存本局实际引用过的必要展示信息，不保存整库。
export type GameSave = {
  schemaVersion: 1;

  savedAt: string;

  worldState: WorldState;

  chapters: Record<ChapterId, Chapter>;
  events: Record<SimulationEventId, SimulationEvent>;

  experienceCache: Record<ExperienceId, LifeExperience>;

  // 旧存档缺失时由 parseGameSave 归一为 galgame。
  presentationMode?: GameMode;

  // V2.3：可选字段保持 GameSave schemaVersion=1，便于读取 V2.1/V2.2 旧存档。
  snapshots?: Record<SnapshotId, WorldSnapshot>;
  branches?: Record<BranchId, GameBranch>;
  activeBranchId?: BranchId;

  // V3 Scene Runtime：增量字段保持 schemaVersion=1，旧存档仍可读取。
  sceneRuntime?: SceneRuntimeState;
  sceneActions?: SceneActionRecord[];
  sceneFlags?: Record<string, boolean>;
  scenePackages?: Record<string, ScenePackage>;
  pendingChapter?: PendingChapter;
  saveRevision?: number;
};
