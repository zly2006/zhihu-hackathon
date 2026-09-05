// V2.3 Snapshot / Branch 数据契约。
// 快照是只读历史的完整状态副本；GameSave 顶层字段仍表示 active branch 的投影。

import type { Chapter } from "./chapter";
import type { Character } from "./character";
import type { CharacterMemory } from "./memory";
import type { SimulationEvent } from "./simulation";
import type { LifeExperience } from "./experience";
import type { WorldState } from "./world";
import type { SceneActionRecord, SceneRuntimeState } from "./scene";

export type SnapshotId = string;
export type BranchId = string;

export type SnapshotKind = "initial" | "chapter" | "legacy-current" | "scene-choice";

export type WorldSnapshot = {
  id: SnapshotId;
  branchId: BranchId;
  kind: SnapshotKind;
  replayable: boolean;

  // 方案要求的快照核心字段。
  year: number;
  worldState: WorldState;
  characters: Record<string, Character>;
  relationships: WorldState["relationships"];
  memories: Record<string, CharacterMemory>;
  events: Record<string, SimulationEvent>;
  chapterContent: Record<string, Chapter>;

  // 继续分支时仍需保留本局已经引用过的真实经历展示缓存。
  experienceCache: Record<string, LifeExperience>;

  chapterId?: string;
  chapterIndex: number;
  createdAt: string;

  // V3：同一章节内的场景选择检查点，不能只靠 chapterIndex 区分。
  sequence?: number;
  packageId?: string;
  packageVersion?: number;
  sceneId?: string;
  blockId?: string;
  sceneRuntime?: SceneRuntimeState;
  sceneActions?: SceneActionRecord[];
  sceneFlags?: Record<string, boolean>;
};
export type GameBranch = {
  id: BranchId;
  name: string;
  parentBranchId?: BranchId;
  sourceSnapshotId?: SnapshotId;
  createdAt: string;
  snapshotIds: SnapshotId[];
  headSnapshotId: SnapshotId;
  chapterIds: string[];
};
