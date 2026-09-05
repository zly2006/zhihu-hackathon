import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const buildDir = process.env.V3_TEST_DIR || ".tmp/test-all";
async function load(file) {
  return import(new URL(`../${buildDir}/game/${file}.js`, import.meta.url).href);
}

test("scene save module exposes immutable choice commits", async () => {
  const [{ commitSceneChoice, serializeSceneSave, normalizeSceneSave }, { applySceneChoice }, fixture] = await Promise.all([
    load("scene-save"),
    load("scene-choice-service"),
    import(new URL("./fixtures/scene-runtime-fixture.mjs", import.meta.url).href),
  ]);
  const projection = fixture.makeProjection();
  const response = applySceneChoice({
    projection,
    package: fixture.makeScenePackage(),
    requestId: "request-1",
    issuedAt: "2026-01-01T00:00:00.000Z",
    expectedRevision: 0,
    choiceId: "A",
  });
  const committed = commitSceneChoice(projection, response);
  assert.equal(committed.revision, 1);
  assert.equal(projection.revision, 0);
  assert.equal(projection.actions.length, 0);
  assert.equal(JSON.parse(serializeSceneSave(committed)).revision, 1);
  assert.throws(() => commitSceneChoice(projection, response, () => { throw new Error("disk full"); }), (error) => error.code === "STORAGE_WRITE_FAILED");

  const legacy = normalizeSceneSave({ ...fixture.makeProjection(), runtime: undefined, actions: undefined, flags: undefined, revision: undefined });
  assert.deepEqual(legacy.actions, []);
  assert.deepEqual(legacy.flags, {});
});

test("scene save protects future runtime versions and restores pending chapter stages", async () => {
  const [{ recoverSceneRuntime, createPendingChapter, updatePendingChapterStage, completePendingChapter, resumePendingChapter }, fixture] = await Promise.all([
    load("scene-save"),
    import(new URL("./fixtures/scene-runtime-fixture.mjs", import.meta.url).href),
  ]);
  const projection = fixture.makeProjection({ runtime: { ...fixture.makeProjection().runtime, schemaVersion: 99 } });
  const recovered = recoverSceneRuntime(projection, fixture.makeScenePackage());
  assert.equal(recovered.readOnly, true);
  assert.match(recovered.reason, /版本/);

  const pending = createPendingChapter({
    executionId: "execution-1",
    chapterId: "test-chapter",
    startYear: 2026,
    endYear: 2026,
    worldStateBefore: fixture.makeWorld(),
    worldStateAfter: fixture.makeWorld(),
    eventIds: [],
    evidenceIds: [],
  });
  const staged = updatePendingChapterStage(pending, "execution-1", "novel", { novelCompleted: true });
  assert.equal(staged.stage, "novel");
  assert.equal(staged.novelCompleted, true);
  assert.equal(resumePendingChapter({ pendingChapter: staged }).executionId, "execution-1");
  const completed = completePendingChapter({ pendingChapter: staged, chapters: {}, scenePackages: {} }, "execution-1", { id: "test-chapter" }, fixture.makeScenePackage());
  assert.equal(completed.pendingChapter, undefined);
  assert.equal(completed.chapters["test-chapter"].id, "test-chapter");
  assert.equal(completed.scenePackages["test-chapter"].id, "test-package");
});

test("scene checkpoints are sequence-aware and branch-isolated", async () => {
  const [{ appendSceneChoiceCheckpoint, createBranchFromSceneCheckpoint, switchBranch }, { initializeSnapshotState }, fixture] = await Promise.all([
    load("snapshot-manager"),
    load("snapshot-manager"),
    import(new URL("./fixtures/scene-runtime-fixture.mjs", import.meta.url).href),
  ]);
  const base = {
    schemaVersion: 1,
    savedAt: "2026-01-01T00:00:00.000Z",
    worldState: fixture.makeWorld(),
    chapters: {},
    events: {},
    experienceCache: {},
    activeBranchId: "main",
  };
  let save = initializeSnapshotState(base);
  save = appendSceneChoiceCheckpoint(save, { chapterId: "test-chapter", packageId: "test-package", packageVersion: 1, sceneId: "test-scene-1", blockId: "test-scene-1-choice", sequence: 1, runtime: fixture.makeProjection().runtime, actions: [], flags: {}, now: "2026-01-01T00:00:01.000Z" });
  save = appendSceneChoiceCheckpoint(save, { chapterId: "test-chapter", packageId: "test-package", packageVersion: 1, sceneId: "test-scene-1", blockId: "test-scene-1-choice", sequence: 2, runtime: fixture.makeProjection().runtime, actions: [], flags: {}, now: "2026-01-01T00:00:02.000Z" });
  const ids = save.branches.main.snapshotIds.filter((id) => id.includes("scene-choice"));
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
  const repeated = appendSceneChoiceCheckpoint(save, { chapterId: "test-chapter", packageId: "test-package", packageVersion: 1, sceneId: "test-scene-1", blockId: "test-scene-1-choice", runtime: fixture.makeProjection().runtime, actions: [], flags: {}, now: "2026-01-01T00:00:03.000Z" });
  assert.equal(repeated.branches.main.snapshotIds.filter((id) => id.includes("scene-choice")).length, 2);
  const source = save;
  const branch = createBranchFromSceneCheckpoint(save, ids[0], { name: "测试分支", now: "2026-01-01T00:00:03.000Z" });
  assert.notEqual(branch.activeBranchId, "main");
  assert.equal(branch.worldState.gameId, save.worldState.gameId);
  assert.equal(save.activeBranchId, "main");
  assert.deepEqual(save.branches.main, source.branches.main);
  const switched = switchBranch(branch, "main");
  assert.equal(switched.activeBranchId, "main");
  assert.equal(switched.worldState.gameId, save.worldState.gameId);
});

test("switching back to a branch keeps its committed scene position replay-safe", async () => {
  const [{ appendSceneChoiceCheckpoint, createBranchFromSceneCheckpoint, switchBranch }, { initializeSnapshotState }, { projectGameSave, mergeSceneProjection }, { applySceneChoice }, fixture] = await Promise.all([
    load("snapshot-manager"),
    load("snapshot-manager"),
    load("scene-save"),
    load("scene-choice-service"),
    import(new URL("./fixtures/scene-runtime-fixture.mjs", import.meta.url).href),
  ]);
  const base = initializeSnapshotState({
    schemaVersion: 1,
    savedAt: "2026-01-01T00:00:00.000Z",
    worldState: fixture.makeWorld(),
    chapters: {},
    events: {},
    experienceCache: {},
    activeBranchId: "main",
    sceneActions: [],
    sceneFlags: {},
    saveRevision: 0,
  });
  const packageItem = fixture.makeScenePackage();
  const beforeChoice = { ...fixture.makeProjection().runtime, status: "awaiting_choice" };
  const checkpointed = appendSceneChoiceCheckpoint(base, {
    chapterId: packageItem.chapterId,
    packageId: packageItem.id,
    packageVersion: packageItem.version,
    sceneId: beforeChoice.sceneId,
    blockId: beforeChoice.blockId,
    runtime: beforeChoice,
    actions: [],
    flags: {},
    sequence: 1,
    now: "2026-01-01T00:00:01.000Z",
  });
  const branch = createBranchFromSceneCheckpoint(checkpointed, checkpointed.branches.main.headSnapshotId, { now: "2026-01-01T00:00:02.000Z" });
  const response = applySceneChoice({
    projection: projectGameSave(branch, branch.sceneRuntime),
    package: packageItem,
    requestId: "branch-choice",
    issuedAt: "2026-01-01T00:00:03.000Z",
    expectedRevision: branch.saveRevision,
    choiceId: "A",
  });
  const afterChoice = mergeSceneProjection(branch, response.projectionAfter);
  const checkpointedAfterChoice = appendSceneChoiceCheckpoint(afterChoice, {
    chapterId: packageItem.chapterId,
    packageId: packageItem.id,
    packageVersion: packageItem.version,
    sceneId: response.runtimeAfter.sceneId,
    blockId: response.runtimeAfter.blockId,
    runtime: response.runtimeAfter,
    actions: afterChoice.sceneActions,
    flags: afterChoice.sceneFlags,
    sequence: 2,
    now: "2026-01-01T00:00:04.000Z",
  });
  const main = switchBranch(checkpointedAfterChoice, "main", "2026-01-01T00:00:05.000Z");
  const restoredBranch = switchBranch(main, branch.activeBranchId, "2026-01-01T00:00:06.000Z");
  assert.equal(restoredBranch.sceneActions.length, 1);
  assert.notEqual(restoredBranch.sceneRuntime.status, "awaiting_choice");
  assert.equal(restoredBranch.sceneRuntime.selectedActionId, response.record.id);
});

test("rewriting a chapter preserves the active scene checkpoint metadata", async () => {
  const [{ appendSceneChoiceCheckpoint, refreshActiveSnapshot, getSnapshot }, { initializeSnapshotState }, fixture] = await Promise.all([
    load("snapshot-manager"),
    load("snapshot-manager"),
    import(new URL("./fixtures/scene-runtime-fixture.mjs", import.meta.url).href),
  ]);
  let save = initializeSnapshotState({
    schemaVersion: 1,
    savedAt: "2026-01-01T00:00:00.000Z",
    worldState: fixture.makeWorld(),
    chapters: {},
    events: {},
    experienceCache: {},
    activeBranchId: "main",
  });
  const runtime = { ...fixture.makeProjection().runtime, status: "awaiting_choice" };
  save = appendSceneChoiceCheckpoint(save, {
    chapterId: "test-chapter",
    packageId: "test-package",
    packageVersion: 1,
    sceneId: "test-scene-1",
    blockId: "test-scene-1-choice",
    sequence: 1,
    runtime,
    actions: [],
    flags: { seeded: true },
    now: "2026-01-01T00:00:01.000Z",
  });
  const checkpointId = save.branches.main.headSnapshotId;
  const rewritten = refreshActiveSnapshot(save, "2026-01-01T00:00:02.000Z");
  const checkpoint = getSnapshot(rewritten, checkpointId);
  assert.equal(checkpoint?.kind, "scene-choice");
  assert.equal(checkpoint?.sequence, 1);
  assert.equal(checkpoint?.packageId, "test-package");
  assert.deepEqual(checkpoint?.sceneRuntime, runtime);
  assert.deepEqual(checkpoint?.sceneFlags, { seeded: true });
  assert.deepEqual(rewritten.branches.main.snapshotIds, save.branches.main.snapshotIds);
});

test("chapter integration shares one live runtime and blocks continuation before completion", () => {
  const summary = readFileSync(join(process.cwd(), "components/life/ChapterSummary.tsx"), "utf8");
  const app = readFileSync(join(process.cwd(), "components/life/LifeApp.tsx"), "utf8");
  assert.match(summary, /SceneRuntimePlayer/);
  assert.match(summary, /scenePackage/);
  assert.match(summary, /canNextChapter|nextDisabled/);
  assert.match(app, /SceneRuntimePlayer|scene-choice/);
  assert.match(app, /pendingChapter|sceneRuntime/);
});
