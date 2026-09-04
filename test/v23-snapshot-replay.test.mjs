import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const base = process.env.V23_TEST_DIR || ".tmp/test-all";

async function load(rel) {
  return import(new URL(`../${base}/${rel}`, import.meta.url).href);
}

const now = "2026-09-03T00:00:00.000Z";

function makeWorld(chapterIds = [], currentYear = 2026) {
  return {
    schemaVersion: 1,
    gameId: "game-v23",
    currentYear,
    protagonistId: "p1",
    characters: {
      p1: {
        id: "p1",
        role: "protagonist",
        identity: { name: "张明", birthYear: 2008, gender: "男", hometown: "武汉", familyBackground: "工薪" },
        core: {
          personalityTraits: ["务实"],
          values: ["稳定"],
          talents: { insight: 50, charm: 50, grit: 50, learning: 50, luck: 50 },
          hooks: [],
        },
        state: {
          age: currentYear - 2008,
          year: currentYear,
          city: "深圳",
          occupation: "程序员",
          socialIdentity: "程序员",
          stats: { cash: 35, health: 80, happiness: 60, knowledge: 50, connections: 25, career: 15, assets: 5 },
          currentGoals: [],
          currentDilemmas: [],
          attitudes: {},
        },
        memoryIds: [],
        createdAt: now,
        updatedAt: now,
      },
    },
    relationships: {},
    memories: {},
    chapterIds,
    eraContext: null,
    openThreads: [],
    canonicalEventIds: [],
    updatedAt: now,
  };
}

function makeChapter(id, index, startYear = 2026) {
  return {
    id,
    index,
    startYear,
    endYear: startYear + 1,
    span: 1,
    stateBeforeHash: `before-${id}`,
    decision: {
      id: `decision-${id}`,
      promptTitle: "一次选择",
      context: "做出决定。",
      options: [],
      selectedOptionId: "A",
      normalizedAction: "行动",
    },
    resolution: {
      effectiveRisk: 40,
      outcomeAnchor: "mixed",
      uncertaintySeed: `seed-${id}`,
      reasonSummary: "结果有得有失。",
    },
    evidence: { experienceIds: [], featuredExperienceIds: [] },
    simulationEventIds: [],
    stateAfterHash: `after-${id}`,
    novel: {
      title: `第 ${index + 1} 章`,
      scenes: [{ id: `scene-${id}`, text: "这一章发生了什么。" }],
      generatedAt: now,
      version: 1,
    },
    summary: { keyEvents: [`事件 ${id}`], characterChanges: [], relationshipChanges: [], openThreads: [] },
    memoryIds: [],
    createdAt: now,
  };
}

function makeSave(world = makeWorld()) {
  return {
    schemaVersion: 1,
    savedAt: now,
    worldState: world,
    chapters: {},
    events: {},
    experienceCache: {},
    presentationMode: "galgame",
  };
}

test("V2.3: 初始快照包含完整状态并与源数据隔离", async () => {
  const manager = await load("game/snapshot-manager.js");
  const save = makeSave();
  const initialized = manager.initializeSnapshotState(save, now);
  const snapshot = initialized.snapshots["main:snapshot:0"];

  assert.equal(initialized.activeBranchId, "main");
  assert.equal(initialized.branches.main.snapshotIds.length, 1);
  assert.equal(snapshot.year, 2026);
  assert.deepEqual(snapshot.worldState, save.worldState);
  assert.deepEqual(snapshot.characters, save.worldState.characters);
  assert.deepEqual(snapshot.relationships, save.worldState.relationships);
  assert.deepEqual(snapshot.memories, save.worldState.memories);
  assert.deepEqual(snapshot.events, {});
  assert.deepEqual(snapshot.chapterContent, {});

  save.worldState.characters.p1.state.city = "上海";
  assert.equal(snapshot.characters.p1.state.city, "深圳");
  assert.equal(snapshot.worldState.characters.p1.state.city, "深圳");
});

test("V2.3: 章节结算追加快照并构建可回溯时间线", async () => {
  const manager = await load("game/snapshot-manager.js");
  const chapter = makeChapter("chapter-1", 0);
  const worldAfter = makeWorld([chapter.id], 2027);
  const initial = manager.initializeSnapshotState(makeSave(), now);
  const saved = manager.appendSnapshot(
    {
      ...initial,
      worldState: worldAfter,
      chapters: { [chapter.id]: chapter },
    },
    { chapterId: chapter.id, now },
  );
  const snapshot = saved.snapshots["main:snapshot:1"];
  const nodes = manager.getTimelineNodes(saved);

  assert.equal(snapshot.chapterId, chapter.id);
  assert.equal(snapshot.chapterIndex, 1);
  assert.equal(snapshot.year, 2027);
  assert.equal(snapshot.chapterContent[chapter.id].novel.title, "第 1 章");
  assert.equal(saved.branches.main.headSnapshotId, snapshot.id);
  assert.deepEqual(nodes.map((node) => node.snapshotId), ["main:snapshot:0", "main:snapshot:1"]);
  assert.equal(nodes[1].canReplay, true);
  assert.equal(nodes[1].chapterId, chapter.id);
});

test("V2.3: 从快照创建新分支，源分支保持不变", async () => {
  const manager = await load("game/snapshot-manager.js");
  const chapter = makeChapter("chapter-1", 0);
  const initial = manager.initializeSnapshotState(makeSave(), now);
  const saved = manager.appendSnapshot(
    {
      ...initial,
      worldState: makeWorld([chapter.id], 2027),
      chapters: { [chapter.id]: chapter },
    },
    { chapterId: chapter.id, now },
  );
  const source = saved.snapshots["main:snapshot:1"];
  const branched = manager.createBranchFromSnapshot(saved, source.id, { name: "从第一章重启", now });
  const branch = branched.branches[branched.activeBranchId];
  const cloned = branched.snapshots[branch.headSnapshotId];

  assert.notEqual(branched.activeBranchId, "main");
  assert.equal(branch.name, "从第一章重启");
  assert.equal(branch.parentBranchId, "main");
  assert.equal(branch.sourceSnapshotId, source.id);
  assert.equal(branch.snapshotIds.length, 2);
  assert.notEqual(cloned.id, source.id);
  assert.equal(cloned.branchId, branched.activeBranchId);
  assert.deepEqual(manager.getTimelineNodes(branched).map((node) => node.chapterIndex), [0, 1]);
  assert.deepEqual(branched.worldState, source.worldState);
  assert.deepEqual(branched.chapters, source.chapterContent);
  assert.equal(saved.activeBranchId, "main");
  assert.equal(saved.branches.main.headSnapshotId, source.id);

  branched.worldState.currentYear = 2030;
  assert.equal(source.worldState.currentYear, 2027);
});

test("V2.3: 小说重写只刷新活动头部，不增加时间线节点", async () => {
  const manager = await load("game/snapshot-manager.js");
  const chapter = makeChapter("chapter-1", 0);
  const initial = manager.initializeSnapshotState(makeSave(), now);
  const saved = manager.appendSnapshot(
    {
      ...initial,
      worldState: makeWorld([chapter.id], 2027),
      chapters: { [chapter.id]: chapter },
    },
    { chapterId: chapter.id, now },
  );
  const rewritten = {
    ...saved,
    chapters: {
      ...saved.chapters,
      [chapter.id]: { ...chapter, novel: { ...chapter.novel, title: "重写后的章节" } },
    },
  };
  const refreshed = manager.refreshActiveSnapshot(rewritten, "2026-09-03T01:00:00.000Z");

  assert.equal(Object.keys(refreshed.snapshots).length, Object.keys(saved.snapshots).length);
  assert.equal(refreshed.snapshots["main:snapshot:1"].chapterContent[chapter.id].novel.title, "重写后的章节");
  assert.equal(refreshed.branches.main.headSnapshotId, "main:snapshot:1");
});

test("V2.3: 旧存档仍可解析，但没有历史快照时禁止伪造回溯能力", async () => {
  const manager = await load("game/snapshot-manager.js");
  const saveModule = await load("game/save.js");
  const chapter = makeChapter("legacy-chapter", 0);
  const legacy = makeSave(makeWorld([chapter.id], 2027));
  legacy.chapters[chapter.id] = chapter;

  const parsed = saveModule.parseGameSave(JSON.parse(JSON.stringify(legacy)));
  const ensured = manager.initializeSnapshotState(parsed, now);
  const nodes = manager.getTimelineNodes(ensured);
  const currentSnapshot = ensured.snapshots[ensured.branches.main.headSnapshotId];

  assert.equal(parsed.schemaVersion, 1);
  assert.equal(currentSnapshot.replayable, false);
  assert.ok(nodes.some((node) => node.chapterId === chapter.id));
  assert.equal(nodes.find((node) => node.chapterId === chapter.id).canReplay, false);
  assert.throws(() => manager.createBranchFromSnapshot(ensured, currentSnapshot.id, { now }));
});

test("V2.3: Timeline 与历史只读页完成接线且不新增结算请求", () => {
  const timeline = readFileSync(join(root, "components/life-vn/Timeline.tsx"), "utf8");
  const viewer = readFileSync(join(root, "components/life-vn/SnapshotViewer.tsx"), "utf8");
  const app = readFileSync(join(root, "components/life/LifeApp.tsx"), "utf8");

  assert.ok(existsSync(join(root, "components/life-vn/SnapshotViewer.tsx")));
  assert.match(timeline, /onSelect/);
  assert.match(timeline, /selectedId/);
  assert.match(timeline, /canSelect/);
  assert.match(viewer, /NovelReader/);
  assert.match(viewer, /从这里重新开始人生/);
  assert.match(viewer, /onContinue/);
  assert.match(app, /snapshot_view/);
  assert.match(app, /createBranchFromSnapshot/);
  assert.match(app, /getTimelineNodes/);
  assert.ok(!/SnapshotViewer[\s\S]*fetch\(/.test(viewer), "历史只读页不得发起网络请求");
});
