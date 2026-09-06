import assert from "node:assert/strict";
import test from "node:test";

const buildDir = process.env.ZHAO_LENG_SAVE_TEST_DIR || ".tmp/test-all";

async function load(file) {
  return import(new URL(`../${buildDir}/game/${file}.js`, import.meta.url));
}

test("赵冷叙事状态穿过场景投影、序列化和选择提交", async () => {
  const [{ createNeutralDemoSave }, runtime, sceneSave, { createSceneRuntime }, { applySceneChoice }] = await Promise.all([
    load("neutral-demo"),
    load("../domain/zhao-leng-runtime"),
    load("scene-save"),
    load("scene-runtime"),
    load("scene-choice-service"),
  ]);
  const base = createNeutralDemoSave(2026, "2026-01-01T00:00:00.000Z");
  const zhaoLeng = runtime.createInitialZhaoLengRuntime({ mode: "scripted" });
  const narrativeRuntime = runtime.createInitialNarrativeRuntime();
  const save = {
    ...base,
    zhaoLeng,
    narrativeRuntime,
    sceneRuntime: createSceneRuntime(base.scenePackages["test-chapter-1"], {
      branchId: "main",
      sceneId: "test-c1-02",
      blockId: "test-c1-02-choice",
    }),
  };
  const projection = sceneSave.projectGameSave(save, save.sceneRuntime);
  assert.deepEqual(projection.zhaoLeng, zhaoLeng);
  assert.deepEqual(projection.narrativeRuntime, narrativeRuntime);

  const roundTrip = JSON.parse(sceneSave.serializeSceneSave(save));
  assert.deepEqual(roundTrip.zhaoLeng, zhaoLeng);
  assert.deepEqual(roundTrip.narrativeRuntime, narrativeRuntime);

  const response = applySceneChoice({
    projection,
    package: save.scenePackages["test-chapter-1"],
    requestId: "zhao-save-choice-1",
    issuedAt: "2026-01-01T00:01:00.000Z",
    expectedRevision: projection.revision,
    choiceId: "A",
  });
  assert.deepEqual(response.projectionAfter.zhaoLeng, zhaoLeng);
  assert.deepEqual(response.projectionAfter.narrativeRuntime, narrativeRuntime);
});

test("从赵冷场景检查点分支时不继承检查点之后的线索和消费", async () => {
  const [{ createNeutralDemoSave }, runtime, snapshots, { createSceneRuntime }] = await Promise.all([
    load("neutral-demo"),
    load("../domain/zhao-leng-runtime"),
    load("snapshot-manager"),
    load("scene-runtime"),
  ]);
  const base = createNeutralDemoSave(2026, "2026-01-01T00:00:00.000Z");
  const packageItem = base.scenePackages["test-chapter-1"];
  const sceneRuntime = createSceneRuntime(packageItem, { branchId: "main" });
  const initialRuntime = runtime.createInitialZhaoLengRuntime({ mode: "scripted" });
  const checkpointed = snapshots.appendSceneChoiceCheckpoint(
    { ...base, zhaoLeng: initialRuntime, narrativeRuntime: runtime.createInitialNarrativeRuntime(), sceneRuntime },
    {
      chapterId: packageItem.chapterId,
      packageId: packageItem.id,
      packageVersion: packageItem.version,
      sceneId: sceneRuntime.sceneId,
      blockId: sceneRuntime.blockId,
      runtime: sceneRuntime,
      now: "2026-01-01T00:02:00.000Z",
    },
  );
  const checkpointId = Object.values(checkpointed.snapshots).at(-1).id;
  const future = {
    ...checkpointed,
    zhaoLeng: {
      ...checkpointed.zhaoLeng,
      observedClueIds: ["library-card"],
      consumedEventIds: ["zhao-leng-library-letter"],
    },
  };
  const branched = snapshots.createBranchFromSceneCheckpoint(future, checkpointId, { name: "赵冷回到第二场" });
  assert.deepEqual(branched.zhaoLeng.observedClueIds, []);
  assert.deepEqual(branched.zhaoLeng.consumedEventIds, []);
  assert.notEqual(branched.zhaoLeng, future.zhaoLeng);
});
