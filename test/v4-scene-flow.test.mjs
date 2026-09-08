import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const buildDir = process.env.V4_SCENE_FLOW_TEST_DIR || ".tmp/test-all";

async function load(file) {
  return import(new URL(`../${buildDir}/game/${file}.js`, import.meta.url));
}

async function choiceState() {
  const [{ createSceneRuntime, transitionSceneRuntime }, { makeScenePackage }] = await Promise.all([
    load("scene-runtime"),
    import(new URL("./fixtures/scene-runtime-fixture.mjs", import.meta.url).href),
  ]);
  const pkg = makeScenePackage();
  let state = createSceneRuntime(pkg, { branchId: "branch-main" });
  state = transitionSceneRuntime(pkg, state, { type: "NEXT" });
  return { pkg, state, transitionSceneRuntime };
}

test("seamless presentation routes a committed choice to its first feedback block", async () => {
  const { pkg, state, transitionSceneRuntime } = await choiceState();
  let submitting = transitionSceneRuntime(pkg, state, {
    type: "SELECT_STARTED",
    requestId: "seamless-request",
    choiceId: "A",
    issuedAt: "2026-01-01T00:00:00.000Z",
    expectedRevision: 0,
  });
  submitting = transitionSceneRuntime(pkg, submitting, {
    type: "SELECT_SUCCEEDED",
    flowPolicy: "seamless",
    record: { id: "seamless-action", next: { kind: "scene", sceneId: "test-scene-2" } },
  });

  assert.equal(submitting.status, "reading");
  assert.equal(submitting.sceneId, "test-scene-2");
  assert.equal(submitting.blockId, "test-scene-2-b1");
  assert.equal(submitting.selectedActionId, "seamless-action");
});

test("skip stops at the first block that has not been confirmed read", async () => {
  const [{ createSceneRuntime, transitionSceneRuntime }, { makeScenePackage }] = await Promise.all([
    load("scene-runtime"),
    import(new URL("./fixtures/scene-runtime-fixture.mjs", import.meta.url).href),
  ]);
  const pkg = makeScenePackage();
  const state = createSceneRuntime(pkg, { branchId: "branch-main", skipPolicy: "read" });
  const skipped = transitionSceneRuntime(pkg, state, { type: "SKIP" });

  assert.equal(skipped.sceneId, state.sceneId);
  assert.equal(skipped.blockId, state.blockId);
  assert.deepEqual(skipped.readBlockIds, []);
});

test("赵冷 exposes a shared boundary decision function and reading helpers", async () => {
  const [{ resolveZhaoLengBoundary }, { createZhaoLengDemoSave }, { createSceneRuntime }, { compileZhaoLengBeat }] = await Promise.all([
    load("zhao-leng-progress"),
    load("zhao-leng-demo"),
    load("scene-runtime"),
    load("zhao-leng-package"),
  ]);
  assert.equal(typeof resolveZhaoLengBoundary, "function");
  assert.equal(existsSync(join(process.cwd(), "lib/game/scene-reading.ts")), true);
  assert.match(readFileSync(join(process.cwd(), "lib/game/scene-reading.ts"), "utf8"), /autoDelayMs|recordSceneBlockRead/);

  const save = createZhaoLengDemoSave({ mode: "scripted", currentYear: 2026, now: "2026-01-01T00:00:00.000Z" });
  const pkg = compileZhaoLengBeat({ save, beatId: "zl-12-hook" });
  const runtime = { ...createSceneRuntime(pkg, { branchId: "main" }), status: "completed" };
  const result = resolveZhaoLengBoundary({ save: { ...save, sceneRuntime: runtime, zhaoLeng: { ...save.zhaoLeng, beatId: "zl-12-hook" } }, completedRuntime: runtime });
  assert.equal(result.kind, "command");
  assert.equal(result.type, "finish_normal");
});

test("scene flow and reading state survive the projection boundary", async () => {
  const [{ projectGameSave, mergeSceneProjection }, { createSceneRuntime }, { makeScenePackage, makeWorld }] = await Promise.all([
    load("scene-save"),
    load("scene-runtime"),
    import(new URL("./fixtures/scene-runtime-fixture.mjs", import.meta.url).href),
  ]);
  const pkg = makeScenePackage();
  const runtime = createSceneRuntime(pkg, { branchId: "branch-main" });
  const save = {
    schemaVersion: 1,
    savedAt: "2026-01-01T00:00:00.000Z",
    worldState: makeWorld(),
    chapters: {},
    events: {},
    experienceCache: {},
    activeBranchId: "branch-main",
    sceneRuntime: runtime,
    sceneActions: [],
    sceneFlags: {},
    scenePackages: { [pkg.chapterId]: pkg },
    saveRevision: 0,
    sceneReading: { schemaVersion: 1, entries: [], readKeys: ["read-key"] },
    sceneFlow: {
      schemaVersion: 1,
      sourcePosition: {
        branchId: "branch-main",
        chapterId: pkg.chapterId,
        packageId: pkg.id,
        packageVersion: pkg.version,
        sceneId: runtime.sceneId,
        blockId: runtime.blockId,
        revision: 0,
      },
      pendingCommand: {
        type: "advance_beat",
        requestId: "request-1",
        issuedAt: "2026-01-01T00:00:00.000Z",
        expectedRevision: 0,
        expectedPackageId: pkg.id,
        source: "auto",
      },
    },
  };
  const projection = projectGameSave(save, runtime);
  assert.deepEqual(projection.sceneReading, save.sceneReading);
  assert.deepEqual(projection.sceneFlow, save.sceneFlow);
  const merged = mergeSceneProjection(save, projection);
  assert.deepEqual(merged.sceneReading, save.sceneReading);
  assert.deepEqual(merged.sceneFlow, save.sceneFlow);
});

test("AI command route preflights before it can call the writer", async () => {
  const progress = await load("zhao-leng-progress");
  assert.equal(typeof progress.preflightZhaoLengCommand, "function");
  const route = readFileSync(join(process.cwd(), "app/api/life/zhao-leng/command/route.ts"), "utf8");
  assert.ok(route.indexOf("preflightZhaoLengCommand") < route.indexOf("generateZhaoLengBeat"));
});

test("赵冷命令预检可复用下一节拍并优先重放已有回执", async () => {
  const [{ createZhaoLengDemoSave }, { compileZhaoLengBeat }, { createSceneRuntime }, progress] = await Promise.all([
    load("zhao-leng-demo"),
    load("zhao-leng-package"),
    load("scene-runtime"),
    load("zhao-leng-progress"),
  ]);
  const now = "2026-01-01T00:00:00.000Z";
  const base = createZhaoLengDemoSave({ mode: "scripted", currentYear: 2026, now });
  const pkg = compileZhaoLengBeat({ save: base, beatId: "zl-01-message" });
  const runtime = { ...createSceneRuntime(pkg, { branchId: "main" }), status: "completed" };
  const save = {
    ...base,
    scenePackages: { [pkg.chapterId]: pkg },
    sceneRuntime: runtime,
    zhaoLeng: { ...base.zhaoLeng, packagesById: { [pkg.id]: pkg } },
  };
  const command = {
    type: "advance_beat",
    requestId: "preflight-advance-1",
    expectedRevision: 0,
    expectedPackageId: pkg.id,
    expectedBranchId: "main",
    issuedAt: now,
  };
  const preflight = progress.preflightZhaoLengCommand(save, command);
  assert.equal(preflight.replayed, false);
  assert.equal(preflight.nextBeatId, "zl-02-library");
  const committed = progress.applyZhaoLengCommand(save, command, { now });
  const replay = progress.preflightZhaoLengCommand(committed.saveAfter, command);
  assert.equal(replay.replayed, true);
  assert.equal(replay.result.replayed, true);
});

test("阅读记录去重并按文本长度计算自动播放等待", async () => {
  const reading = await load("scene-reading");
  const input = {
    mode: "scripted",
    branchId: "main",
    chapterId: "zhao-leng-demo-session",
    packageId: "pkg-v1",
    packageVersion: 1,
    sceneId: "scene-1",
    blockId: "line-1",
    blockType: "dialogue",
    text: "赵冷把卡片翻到背面。",
    speaker: "赵冷",
  };
  let state = reading.recordSceneBlockRead(undefined, input, "2026-01-01T00:00:00.000Z");
  state = reading.recordSceneBlockRead(state, input, "2026-01-01T00:00:01.000Z");
  assert.equal(state.entries.length, 1);
  assert.equal(reading.isSceneBlockRead(state, input), true);
  assert.ok(reading.autoDelayMs("字".repeat(20), "slow") > reading.autoDelayMs("字".repeat(20), "standard"));
  assert.ok(reading.autoDelayMs("字".repeat(20), "standard") > reading.autoDelayMs("字".repeat(20), "fast"));
  assert.equal(reading.canAutoAdvance({ visibility: "visible", status: "reading", modalOpen: true }), false);
});

test("赵冷结局完成后进入独立完成页", () => {
  const source = readFileSync(join(process.cwd(), "components/life/ZhaoLengDemo.tsx"), "utf8");
  assert.match(source, /ZhaoLengCompletion/);
});

test("从快照建立新分支时不继承待执行场景命令", async () => {
  const [{ createSceneRuntime }, snapshots, { makeScenePackage, makeWorld }] = await Promise.all([
    load("scene-runtime"),
    load("snapshot-manager"),
    import(new URL("./fixtures/scene-runtime-fixture.mjs", import.meta.url).href),
  ]);
  const pkg = makeScenePackage();
  const runtime = createSceneRuntime(pkg, { branchId: "main" });
  const save = snapshots.initializeSnapshotState({
    schemaVersion: 1,
    savedAt: "2026-01-01T00:00:00.000Z",
    worldState: makeWorld(),
    chapters: {},
    events: {},
    experienceCache: {},
    activeBranchId: "main",
    sceneRuntime: runtime,
    scenePackages: { [pkg.chapterId]: pkg },
    sceneFlow: {
      schemaVersion: 1,
      sourcePosition: {
        branchId: "main",
        chapterId: pkg.chapterId,
        packageId: pkg.id,
        packageVersion: pkg.version,
        sceneId: runtime.sceneId,
        blockId: runtime.blockId,
        revision: 0,
      },
      pendingCommand: {
        type: "advance_beat",
        requestId: "pending-1",
        issuedAt: "2026-01-01T00:00:00.000Z",
        expectedRevision: 0,
        expectedPackageId: pkg.id,
        source: "button",
      },
    },
  });
  const branched = snapshots.createBranchFromSnapshot(save, save.branches.main.headSnapshotId, { now: "2026-01-01T00:01:00.000Z" });
  assert.equal(branched.sceneFlow, undefined);
  assert.equal(branched.snapshots[branched.branches[branched.activeBranchId].headSnapshotId].sceneFlow, undefined);
});

test("舞台与主继续入口忽略鼠标双击的第二次推进", () => {
  const player = readFileSync(join(process.cwd(), "components/life-vn/SceneRuntimePlayer.tsx"), "utf8");
  const dialogue = readFileSync(join(process.cwd(), "components/life-vn/DialogueBox.tsx"), "utf8");
  assert.match(player, /detail\s*>\s*1/);
  assert.match(dialogue, /onClick=\{onContinue\}/);
});

test("阅读记录与设置面板会暂停自动推进，关闭记录后需主动恢复", () => {
  const shell = readFileSync(join(process.cwd(), "components/life-vn/LifeShell.tsx"), "utf8");
  const demo = readFileSync(join(process.cwd(), "components/life/ZhaoLengDemo.tsx"), "utf8");
  const runtime = readFileSync(join(process.cwd(), "components/life/use-scene-runtime.ts"), "utf8");
  assert.match(shell, /onSheetOpenChange/);
  assert.match(demo, /readingSheetOpen/);
  assert.match(demo, /readingLogOpen \|\| readingSheetOpen \|\| pauseAfterReadingLog/);
  assert.match(runtime, /stateRef\.current\.playbackMode === "auto" && options\.autoPaused/);
});

test("跨节拍换包后互斥锁仍能释放且不误解锁新会话", () => {
  const flow = readFileSync(join(process.cwd(), "components/life/use-zhao-leng-flow.ts"), "utf8");
  assert.match(flow, /exclusiveToken/);
  assert.match(flow, /exclusiveToken\.current === token/);
});

test("无玩家决策的跨包推进保留玩家已开启的自动模式", async () => {
  const [{ createZhaoLengDemoSave }, { compileZhaoLengBeat }, { createSceneRuntime }, progress] = await Promise.all([
    load("zhao-leng-demo"),
    load("zhao-leng-package"),
    load("scene-runtime"),
    load("zhao-leng-progress"),
  ]);
  const now = "2026-01-01T00:00:00.000Z";
  const base = createZhaoLengDemoSave({ mode: "scripted", currentYear: 2026, now });
  const pkg = compileZhaoLengBeat({ save: base, beatId: "zl-01-message" });
  const runtime = { ...createSceneRuntime(pkg, { branchId: "main", playbackMode: "auto" }), status: "completed" };
  const save = {
    ...base,
    scenePackages: { [pkg.chapterId]: pkg },
    sceneRuntime: runtime,
    zhaoLeng: { ...base.zhaoLeng, packagesById: { [pkg.id]: pkg } },
  };
  const result = progress.applyZhaoLengCommand(save, {
    type: "advance_beat",
    requestId: "preserve-auto-1",
    expectedRevision: 0,
    expectedPackageId: pkg.id,
    issuedAt: now,
  });
  assert.equal(result.saveAfter.sceneRuntime.playbackMode, "auto");
});
