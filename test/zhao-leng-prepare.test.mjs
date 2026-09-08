import assert from "node:assert/strict";
import test from "node:test";

const buildDir = process.env.ZHAO_LENG_PREPARE_TEST_DIR || ".tmp/test-all";

async function load(file) {
  return import(new URL(`../${buildDir}/game/${file}.js`, import.meta.url));
}

test("赵冷 prepare 只生成绑定当前事实的 artifact，不修改存档且忽略阅读游标", async () => {
  const [{ createZhaoLengDemoSave }, { compileZhaoLengBeat }, { createSceneRuntime }, prepare] = await Promise.all([
    load("zhao-leng-demo"),
    load("zhao-leng-package"),
    load("scene-runtime"),
    load("zhao-leng-prepare"),
  ]);
  const now = "2026-01-01T00:00:00.000Z";
  const base = createZhaoLengDemoSave({ mode: "llm", currentYear: 2026, now });
  const packageItem = compileZhaoLengBeat({ save: base, beatId: "zl-01-message" });
  const save = {
    ...base,
    scenePackages: { [packageItem.chapterId]: packageItem },
    sceneRuntime: createSceneRuntime(packageItem, { branchId: "main", skipPolicy: "read" }),
  };
  const before = JSON.stringify(save);
  let modelCalls = 0;
  const model = async () => {
    modelCalls += 1;
    return {
      beatId: "zl-02-library",
      opening: [{ type: "narration", text: "下一次见面，先把事实说清楚。" }],
      feedback: {
        A: [{ type: "dialogue", speakerId: "npc-zhao-leng", text: "好。", emotion: "克制" }],
        B: [{ type: "dialogue", speakerId: "protagonist", text: "我会按约定来。", emotion: "认真" }],
        C: [{ type: "narration", text: "你们把时间留给了下一次确认。" }],
      },
    };
  };
  const [first, second] = await Promise.all([
    prepare.prepareZhaoLengBeat({ save, nextBeatId: "zl-02-library", model, now }),
    prepare.prepareZhaoLengBeat({ save, nextBeatId: "zl-02-library", model, now }),
  ]);
  assert.equal(modelCalls, 1);
  assert.equal(JSON.stringify(save), before);
  assert.equal(first.artifactId, second.artifactId);
  assert.equal(first.beatId, "zl-02-library");
  assert.equal(first.inputFingerprint, prepare.zhaoLengPrepareFingerprint(save, "zl-02-library"));
  assert.doesNotThrow(() => prepare.validateZhaoLengPreparedArtifact(save, "zl-02-library", first, new Date(now)));

  const withReadingCursor = { ...save, sceneRuntime: { ...save.sceneRuntime, blockId: "cursor-only" }, sceneReading: { schemaVersion: 1, entries: [] } };
  assert.equal(prepare.zhaoLengPrepareFingerprint(withReadingCursor, "zl-02-library"), first.inputFingerprint);

  const changedFacts = { ...save, worldState: { ...save.worldState, currentYear: 2027 } };
  assert.throws(
    () => prepare.validateZhaoLengPreparedArtifact(changedFacts, "zl-02-library", first, new Date(now)),
    /指纹|失效|不匹配/,
  );
});

test("advance_beat 消费已校验的 artifact，不再次调用写作者", async () => {
  const [{ createZhaoLengDemoSave }, { compileZhaoLengBeat }, { createSceneRuntime }, prepare, progress] = await Promise.all([
    load("zhao-leng-demo"),
    load("zhao-leng-package"),
    load("scene-runtime"),
    load("zhao-leng-prepare"),
    load("zhao-leng-progress"),
  ]);
  const now = new Date().toISOString();
  const base = createZhaoLengDemoSave({ mode: "llm", currentYear: 2026, now });
  const packageItem = compileZhaoLengBeat({ save: base, beatId: "zl-01-message" });
  const save = {
    ...base,
    scenePackages: { [packageItem.chapterId]: packageItem },
    sceneRuntime: { ...createSceneRuntime(packageItem, { branchId: "main", skipPolicy: "read" }), status: "completed" },
  };
  const artifact = await prepare.prepareZhaoLengBeat({
    save,
    nextBeatId: "zl-02-library",
    now,
    model: async () => ({
      beatId: "zl-02-library",
      opening: [{ type: "narration", text: "下一次见面，先把事实说清楚。" }],
      feedback: {
        A: [{ type: "narration", text: "你选择先核对安排。" }],
        B: [{ type: "narration", text: "你选择留下余地。" }],
        C: [{ type: "narration", text: "你选择暂时退开。" }],
      },
    }),
  });
  let compileCalls = 0;
  const result = progress.applyZhaoLengCommand(save, {
    type: "advance_beat",
    requestId: "advance-with-artifact",
    expectedRevision: save.saveRevision,
    expectedPackageId: packageItem.id,
    expectedBranchId: "main",
    issuedAt: now,
  }, {
    now,
    preparedArtifact: artifact,
    compileBeat: ({ save: prepared, beatId, written }) => {
      compileCalls += 1;
      assert.equal(beatId, "zl-02-library");
      assert.equal(written?.beatId, "zl-02-library");
      return compileZhaoLengBeat({ save: prepared, beatId, written });
    },
  });
  assert.equal(compileCalls, 1);
  assert.equal(result.saveAfter.zhaoLeng.beatId, "zl-02-library");
  assert.equal(result.saveAfter.zhaoLeng.preparedArtifact, undefined);
});

console.log("zhao-leng-prepare: PASS");
