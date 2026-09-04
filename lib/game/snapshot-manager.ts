// V2.3 Snapshot / Timeline Replay。
// 这里是纯数据层：不调用模型、不请求网络、不改变 WorldState 的结算规则。

import type { GameSave } from "../domain/chapter";
import type {
  BranchId,
  GameBranch,
  SnapshotId,
  SnapshotKind,
  WorldSnapshot,
} from "../domain/snapshot";

export const MAIN_BRANCH_ID: BranchId = "main";

type SnapshotSource = Pick<GameSave, "worldState" | "chapters" | "events" | "experienceCache">;

export type CreateSnapshotOptions = {
  branchId: BranchId;
  id?: SnapshotId;
  kind?: SnapshotKind;
  replayable?: boolean;
  chapterId?: string;
  chapterIndex?: number;
  now?: string;
};

export type AppendSnapshotOptions = {
  chapterId?: string;
  id?: SnapshotId;
  now?: string;
};

export type CreateBranchOptions = {
  name?: string;
  now?: string;
};

export type SnapshotTimelineNode = {
  id: string;
  snapshotId?: SnapshotId;
  chapterId?: string;
  chapterIndex: number;
  year: number;
  label: string;
  title: string;
  summary?: string;
  active?: boolean;
  canReplay: boolean;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function snapshotIdFor(branchId: BranchId, chapterIndex: number): SnapshotId {
  return `${branchId}:snapshot:${chapterIndex}`;
}

function chapterIdsFromSave(save: SnapshotSource): string[] {
  return save.worldState.chapterIds.length > 0
    ? [...save.worldState.chapterIds]
    : Object.values(save.chapters)
        .sort((a, b) => a.index - b.index)
        .map((chapter) => chapter.id);
}

function lastChapterId(save: SnapshotSource): string | undefined {
  const chapterIds = chapterIdsFromSave(save);
  return chapterIds.at(-1);
}

function branchSnapshotIds(branch: GameBranch, snapshots: Record<SnapshotId, WorldSnapshot>): SnapshotId[] {
  return [...branch.snapshotIds]
    .filter((id) => Boolean(snapshots[id]))
    .sort((a, b) => snapshots[a].chapterIndex - snapshots[b].chapterIndex);
}

function activeBranch(save: GameSave): GameBranch | undefined {
  const branchId = save.activeBranchId;
  return branchId && save.branches ? save.branches[branchId] : undefined;
}

export function createWorldSnapshot(source: SnapshotSource, options: CreateSnapshotOptions): WorldSnapshot {
  const worldState = clone(source.worldState);
  const chapterContent = clone(source.chapters);
  const kind = options.kind ?? (worldState.chapterIds.length === 0 ? "initial" : "chapter");
  const replayable = options.replayable ?? kind !== "legacy-current";
  const chapterIndex = options.chapterIndex ?? worldState.chapterIds.length;

  return {
    id: options.id ?? snapshotIdFor(options.branchId, chapterIndex),
    branchId: options.branchId,
    kind,
    replayable,
    year: worldState.currentYear,
    worldState,
    characters: clone(worldState.characters),
    relationships: clone(worldState.relationships),
    memories: clone(worldState.memories),
    events: clone(source.events),
    chapterContent,
    experienceCache: clone(source.experienceCache),
    ...(options.chapterId ? { chapterId: options.chapterId } : {}),
    chapterIndex,
    createdAt: options.now ?? new Date().toISOString(),
  };
}

/**
 * 为新存档建立 main/initial 快照；对已有 V2.3 存档保持幂等。
 * 旧存档按已有章节内容生成不可回溯展示节点；它们共享当前状态投影，避免冒充过去 WorldState。
 */
export function initializeSnapshotState(save: GameSave, now = save.savedAt): GameSave {
  const branch = activeBranch(save);
  if (save.snapshots && branch && save.snapshots[branch.headSnapshotId]) return save;

  const legacy = Object.keys(save.chapters).length > 0;
  const branchId = save.activeBranchId ?? MAIN_BRANCH_ID;
  const legacySnapshots = legacy
    ? Object.values(save.chapters)
        .sort((a, b) => a.index - b.index)
        .map((chapter) =>
          createWorldSnapshot(save, {
            branchId,
            id: `${branchId}:legacy:${chapter.id}`,
            kind: "legacy-current",
            replayable: false,
            chapterId: chapter.id,
            chapterIndex: chapter.index + 1,
            now,
          }),
        )
    : [];
  const snapshot =
    legacySnapshots.at(-1) ??
    createWorldSnapshot(save, {
      branchId,
      id: snapshotIdFor(branchId, save.worldState.chapterIds.length),
      kind: "initial",
      replayable: true,
      now,
    });
  const snapshots = legacySnapshots.length > 0 ? legacySnapshots : [snapshot];
  const nextBranch: GameBranch = {
    id: branchId,
    name: branchId === MAIN_BRANCH_ID ? "主线" : `分支 ${branchId}`,
    createdAt: now,
    snapshotIds: snapshots.map((item) => item.id),
    headSnapshotId: snapshot.id,
    chapterIds: chapterIdsFromSave(save),
    ...(branch?.parentBranchId ? { parentBranchId: branch.parentBranchId } : {}),
    ...(branch?.sourceSnapshotId ? { sourceSnapshotId: branch.sourceSnapshotId } : {}),
  };

  return {
    ...save,
    activeBranchId: branchId,
    snapshots: {
      ...(save.snapshots ?? {}),
      ...Object.fromEntries(snapshots.map((item) => [item.id, item])),
    },
    branches: { ...(save.branches ?? {}), [branchId]: nextBranch },
  };
}

/** 在活动分支的当前头部追加一个章节快照；同一章节重复调用会稳定替换。 */
export function appendSnapshot(save: GameSave, options: AppendSnapshotOptions = {}): GameSave {
  const now = options.now ?? new Date().toISOString();
  const prepared = initializeSnapshotState(save, now);
  const branch = activeBranch(prepared);
  if (!branch || !prepared.snapshots) throw new Error("活动分支快照状态未初始化");

  const chapterId = options.chapterId ?? lastChapterId(prepared);
  const snapshot = createWorldSnapshot(prepared, {
    branchId: branch.id,
    id: options.id ?? snapshotIdFor(branch.id, prepared.worldState.chapterIds.length),
    kind: prepared.worldState.chapterIds.length === 0 ? "initial" : "chapter",
    replayable: true,
    chapterId,
    now,
  });
  const nextSnapshotIds = Array.from(new Set([...branch.snapshotIds, snapshot.id]));
  const nextBranch: GameBranch = {
    ...branch,
    snapshotIds: nextSnapshotIds,
    headSnapshotId: snapshot.id,
    chapterIds: chapterIdsFromSave(prepared),
  };

  return {
    ...prepared,
    activeBranchId: branch.id,
    snapshots: { ...prepared.snapshots, [snapshot.id]: snapshot },
    branches: { ...prepared.branches, [branch.id]: nextBranch },
  };
}

/** 小说重写不应制造新时间线节点，只刷新活动分支头部的章节内容。 */
export function refreshActiveSnapshot(save: GameSave, now = new Date().toISOString()): GameSave {
  const prepared = initializeSnapshotState(save, now);
  const branch = activeBranch(prepared);
  if (!branch || !prepared.snapshots) throw new Error("活动分支快照状态未初始化");
  const head = prepared.snapshots[branch.headSnapshotId];
  if (!head) throw new Error("活动分支缺少头部快照");

  const refreshed = createWorldSnapshot(prepared, {
    branchId: branch.id,
    id: head.id,
    kind: head.kind,
    replayable: head.replayable,
    chapterId: lastChapterId(prepared),
    now,
  });
  return {
    ...prepared,
    snapshots: { ...prepared.snapshots, [refreshed.id]: refreshed },
  };
}

/** 返回副本，UI 或调用方误修改也不会污染 localStorage 中的历史数据。 */
export function getSnapshot(save: GameSave, snapshotId: SnapshotId): WorldSnapshot | null {
  const snapshot = save.snapshots?.[snapshotId];
  return snapshot ? clone(snapshot) : null;
}

function nextBranchId(branches: Record<BranchId, GameBranch>): BranchId {
  let index = 1;
  while (branches[`branch-${index}`]) index += 1;
  return `branch-${index}`;
}

/** 从历史快照复制出新活动分支，源分支、源快照和原存档对象均保持不变。 */
export function createBranchFromSnapshot(
  save: GameSave,
  snapshotId: SnapshotId,
  options: CreateBranchOptions = {},
): GameSave {
  const now = options.now ?? new Date().toISOString();
  const prepared = initializeSnapshotState(save, now);
  if (!prepared.snapshots || !prepared.branches) throw new Error("快照状态未初始化");
  const source = prepared.snapshots[snapshotId];
  if (!source) throw new Error("找不到要重开的时间线节点");
  if (!source.replayable) throw new Error("该旧存档没有可用的历史快照，不能从这里重开");

  const branchId = nextBranchId(prepared.branches);
  const sourceBranch = prepared.branches[source.branchId];
  const sourceSnapshotIds = sourceBranch
    ? branchSnapshotIds(sourceBranch, prepared.snapshots).filter(
        (id) => {
          const item = prepared.snapshots?.[id];
          return Boolean(item && item.chapterIndex <= source.chapterIndex);
        },
      )
    : [];
  const sourceSnapshots = Array.from(new Set([...sourceSnapshotIds, source.id]))
    .map((id) => prepared.snapshots?.[id])
    .filter((item): item is WorldSnapshot => Boolean(item))
    .sort((a, b) => a.chapterIndex - b.chapterIndex);
  const clonedSnapshots = sourceSnapshots.map((item) => {
    const cloned = clone(item);
    cloned.id = snapshotIdFor(branchId, item.chapterIndex);
    cloned.branchId = branchId;
    cloned.createdAt = now;
    return cloned;
  });
  const clonedSnapshot = clonedSnapshots.find((item) => item.chapterIndex === source.chapterIndex);
  if (!clonedSnapshot) throw new Error("无法复制历史快照");
  const clonedSnapshotMap = Object.fromEntries(clonedSnapshots.map((item) => [item.id, item]));

  const name = options.name?.trim() || `分支 ${Object.keys(prepared.branches).length}`;
  const branch: GameBranch = {
    id: branchId,
    name,
    parentBranchId: source.branchId,
    sourceSnapshotId: source.id,
    createdAt: now,
    snapshotIds: clonedSnapshots.map((item) => item.id),
    headSnapshotId: clonedSnapshot.id,
    chapterIds: [...source.worldState.chapterIds],
  };

  return {
    ...prepared,
    savedAt: now,
    activeBranchId: branchId,
    worldState: clone(source.worldState),
    chapters: clone(source.chapterContent),
    events: clone(source.events),
    experienceCache: clone(source.experienceCache),
    snapshots: { ...prepared.snapshots, ...clonedSnapshotMap },
    branches: { ...prepared.branches, [branchId]: branch },
  };
}

function nodeForSnapshot(
  snapshot: WorldSnapshot,
  branch: GameBranch,
): SnapshotTimelineNode {
  const chapter = snapshot.chapterId ? snapshot.chapterContent[snapshot.chapterId] : undefined;
  if (!chapter) {
    return {
      id: snapshot.id,
      snapshotId: snapshot.id,
      chapterIndex: snapshot.chapterIndex,
      year: snapshot.year,
      label: `人生起点 · ${snapshot.year}`,
      title: "人生起点",
      active: snapshot.id === branch.headSnapshotId,
      canReplay: snapshot.replayable,
    };
  }
  return {
    id: snapshot.id,
    snapshotId: snapshot.id,
    chapterId: chapter.id,
    chapterIndex: snapshot.chapterIndex,
    year: snapshot.year,
    label: `第 ${String(chapter.index + 1).padStart(2, "0")} 章 · ${chapter.startYear}—${chapter.endYear}`,
    title: chapter.novel.title,
    summary: chapter.summary.keyEvents.slice(0, 2).join("；"),
    active: snapshot.id === branch.headSnapshotId,
    canReplay: snapshot.replayable,
  };
}

function legacyNodes(save: GameSave, branch: GameBranch): SnapshotTimelineNode[] {
  const chapters = Object.values(save.chapters).sort((a, b) => a.index - b.index);
  return chapters.map((chapter) => ({
    id: chapter.id,
    chapterId: chapter.id,
    chapterIndex: chapter.index + 1,
    year: chapter.endYear,
    label: `第 ${String(chapter.index + 1).padStart(2, "0")} 章 · ${chapter.startYear}—${chapter.endYear}`,
    title: chapter.novel.title,
    summary: chapter.summary.keyEvents.slice(0, 2).join("；"),
    active: chapter.id === branch.chapterIds.at(-1),
    canReplay: false,
  }));
}

/** 将活动分支快照转换为 Timeline 可消费的纯展示节点。 */
export function getTimelineNodes(save: GameSave): SnapshotTimelineNode[] {
  const branch = activeBranch(save);
  if (!branch || !save.snapshots) return [];

  const ids = branchSnapshotIds(branch, save.snapshots);
  const snapshots = ids.map((id) => save.snapshots?.[id]).filter((item): item is WorldSnapshot => Boolean(item));
  const nodes: SnapshotTimelineNode[] = [];
  const representedChapterIds = new Set<string>();
  for (const snapshot of snapshots) {
    const node = nodeForSnapshot(snapshot, branch);
    nodes.push(node);
    if (node.chapterId) representedChapterIds.add(node.chapterId);
  }

  if (nodes.length === 0 && Object.keys(save.chapters).length > 0) {
    for (const node of legacyNodes(save, branch)) {
      if (!representedChapterIds.has(node.chapterId ?? "")) nodes.push(node);
    }
  }
  return nodes.sort((a, b) => a.chapterIndex - b.chapterIndex);
}
