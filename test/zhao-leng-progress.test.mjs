import assert from "node:assert/strict";
import test from "node:test";

const buildDir = process.env.ZHAO_LENG_PROGRESS_TEST_DIR || ".tmp/test-all";

async function load(file) {
  return import(new URL(`../${buildDir}/game/${file}.js`, import.meta.url));
}

test("赵冷完整固定路线由真实场景选择和 reducer 结算到一起规划", async () => {
  const { playZhaoLengPath } = await import(new URL("./helpers/zhao-leng-flow.mjs", import.meta.url));
  const result = await playZhaoLengPath({
    choices: ["A", "B", "A", "A", "B", "A", "A", "A", "A", "A", "A"],
  });
  assert.equal(result.endingId, "mutual-trust");
  assert.equal(new Set(result.completedBeatIds).size, 12);
  assert.deepEqual(result.scores, { closeness: 58, trust: 81, conflict: 11, commitment: 33 });
  assert.equal(result.committedChoiceCount, 11);
  assert.equal(result.uniqueSceneEventCount, 11);
});

test("高分不能覆盖第十一场明确的各自前进意愿", async () => {
  const { playZhaoLengPath } = await import(new URL("./helpers/zhao-leng-flow.mjs", import.meta.url));
  const result = await playZhaoLengPath({
    choices: ["A", "B", "A", "A", "B", "A", "A", "A", "A", "A", "C"],
  });
  assert.equal(result.endingId, "kind-distance");
  assert.equal(result.scores.trust, 79);
});

test("观察借阅卡后隐藏结局只消费一次，重复结束走回执", async () => {
  const { playZhaoLengPath } = await import(new URL("./helpers/zhao-leng-flow.mjs", import.meta.url));
  const result = await playZhaoLengPath({
    choices: ["A", "B", "A", "A", "B", "A", "A", "A", "A", "A", "A"],
    observeCard: true,
    endingAction: "finish_hidden",
  });
  assert.equal(result.endingId, "library-letter");
  assert.deepEqual(result.consumedEventIds, ["zhao-leng-library-letter"]);
  assert.equal(result.committedChoiceCount, 11);
  assert.equal(result.observedBefore, true);
});

test("借阅卡只能在第二节拍卡片阅读块观察", async () => {
  const [{ createZhaoLengDemoSave }, { compileZhaoLengBeat }, { createSceneRuntime, transitionSceneRuntime }, { applyZhaoLengCommand, ZhaoLengCommandError }] = await Promise.all([
    load("zhao-leng-demo"),
    load("zhao-leng-package"),
    load("scene-runtime"),
    load("zhao-leng-progress"),
  ]);
  const now = "2026-01-01T00:00:00.000Z";
  let save = createZhaoLengDemoSave({ mode: "scripted", currentYear: 2026, now });
  let packageItem = compileZhaoLengBeat({ save, beatId: "zl-02-library" });
  let runtime = createSceneRuntime(packageItem, { branchId: "main" });
  save = {
    ...save,
    scenePackages: { [packageItem.chapterId]: packageItem },
    sceneRuntime: runtime,
    zhaoLeng: {
      ...save.zhaoLeng,
      beatId: "zl-02-library",
      phaseId: "first-meet",
      packagesById: { [packageItem.id]: packageItem },
      cacheKeys: { "zl-02-library": packageItem.id },
    },
  };
  assert.throws(
    () => applyZhaoLengCommand(save, { type: "observe_library_card", requestId: "observe-too-early", expectedRevision: save.saveRevision, expectedPackageId: packageItem.id, issuedAt: now }),
    (error) => error instanceof ZhaoLengCommandError && error.code === "INVALID_DEMO_POSITION",
  );
  runtime = save.sceneRuntime;
  while (!/:opening:line:(8|9)$/.test(runtime.blockId)) runtime = transitionSceneRuntime(packageItem, runtime, { type: "NEXT" });
  const observed = applyZhaoLengCommand({ ...save, sceneRuntime: runtime }, { type: "observe_library_card", requestId: "observe-at-card", expectedRevision: save.saveRevision, expectedPackageId: packageItem.id, issuedAt: now });
  assert.deepEqual(observed.saveAfter.zhaoLeng.observedClueIds, ["library-card"]);
  const choiceRuntime = transitionSceneRuntime(packageItem, runtime, { type: "SKIP" });
  assert.equal(choiceRuntime.status, "awaiting_choice");
  assert.throws(
    () => applyZhaoLengCommand({ ...save, sceneRuntime: choiceRuntime }, { type: "observe_library_card", requestId: "observe-too-late", expectedRevision: save.saveRevision, expectedPackageId: packageItem.id, issuedAt: now }),
    (error) => error instanceof ZhaoLengCommandError && error.code === "INVALID_DEMO_POSITION",
  );
});

test("专用 P 规则不能从正式通用场景提交", async () => {
  const [{ createZhaoLengDemoSave }, { compileZhaoLengBeat }, { createSceneRuntime }, { projectGameSave }, { applySceneChoice, SceneChoiceServiceError }] = await Promise.all([
    load("zhao-leng-demo"),
    load("zhao-leng-package"),
    load("scene-runtime"),
    load("scene-save"),
    load("scene-choice-service"),
  ]);
  const save = createZhaoLengDemoSave({ mode: "scripted", currentYear: 2026, now: "2026-01-01T00:00:00.000Z" });
  const pkg = compileZhaoLengBeat({ save, beatId: "zl-03-boundary" });
  const formalPackage = {
    ...pkg,
    id: "formal-p-rule-package",
    chapterId: "formal-scene",
  };
  const runtime = createSceneRuntime(formalPackage, { branchId: "main", sceneId: pkg.scenes[0].id, blockId: `${pkg.scenes[0].id}:choice` });
  assert.throws(
    () => applySceneChoice({
      projection: projectGameSave(save, runtime),
      package: formalPackage,
      requestId: "p-formal-1",
      issuedAt: "2026-01-01T00:00:00.000Z",
      expectedRevision: 0,
      choiceId: "C",
    }),
    (error) => error instanceof SceneChoiceServiceError && error.code === "RULE_SCOPE_FORBIDDEN",
  );
});
