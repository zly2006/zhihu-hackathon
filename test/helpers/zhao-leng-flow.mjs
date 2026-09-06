import assert from "node:assert/strict";

const buildDir = process.env.ZHAO_LENG_FLOW_TEST_DIR || ".tmp/test-all";

async function load(path) {
  return import(new URL(`../../${buildDir}/${path}.js`, import.meta.url));
}

function readUntilCompleted(pkg, runtime, transition) {
  let state = runtime;
  for (let step = 0; step < 100; step += 1) {
    if (state.status === "feedback") {
      state = transition(pkg, state, { type: "ACK_FEEDBACK" });
      continue;
    }
    if (state.status === "completed") return state;
    if (state.status !== "reading") throw new Error(`读取场景失败：${state.status}`);
    state = transition(pkg, state, { type: "NEXT" });
  }
  throw new Error("场景读取超过最大步数");
}

async function preparePackage(save, packageItem, sceneRuntime, modules) {
  return {
    ...save,
    scenePackages: { ...(save.scenePackages ?? {}), [modules.demo.ZHAO_LENG_CHAPTER_ID]: packageItem },
    zhaoLeng: {
      ...save.zhaoLeng,
      packagesById: { ...(save.zhaoLeng?.packagesById ?? {}), [packageItem.id]: packageItem },
    },
    sceneRuntime,
  };
}

export async function playZhaoLengPath({ choices, observeCard = false, endingAction = "finish_normal" }) {
  if (!Array.isArray(choices) || choices.length !== 11) throw new Error("必须提供 11 项关系选择");
  const [demo, packageModule, progress, runtimeModule, sceneSave, choiceService] = await Promise.all([
    load("game/zhao-leng-demo"),
    load("game/zhao-leng-package"),
    load("game/zhao-leng-progress"),
    load("game/scene-runtime"),
    load("game/scene-save"),
    load("game/scene-choice-service"),
  ]);
  const now = "2026-01-01T00:00:00.000Z";
  let save = demo.createZhaoLengDemoSave({ mode: "scripted", currentYear: 2026, now });
  let pkg = packageModule.compileZhaoLengBeat({ save, beatId: "zl-01-message" });
  let runtime = runtimeModule.createSceneRuntime(pkg, { branchId: "main" });
  save = await preparePackage(save, pkg, runtime, { demo, sceneSave });

  let committedChoiceCount = 0;
  let uniqueSceneEventCount = 0;
  let observedBefore = false;
  for (let index = 0; index < choices.length; index += 1) {
    const beatId = save.zhaoLeng.beatId;
    assert.equal(beatId, `zl-${String(index + 1).padStart(2, "0")}-${[
      "message",
      "library",
      "boundary",
      "opportunity",
      "argument",
      "distance",
      "return",
      "choice",
      "consequence",
      "letter",
      "future",
    ][index]}`);
    if (beatId === "zl-02-library" && observeCard) {
      let observationRuntime = save.sceneRuntime;
      while (
        observationRuntime.status === "reading" &&
        !/:opening:line:(8|9)$/.test(observationRuntime.blockId)
      ) {
        observationRuntime = runtimeModule.transitionSceneRuntime(pkg, observationRuntime, { type: "NEXT" });
      }
      save = { ...save, sceneRuntime: observationRuntime };
      const result = progress.applyZhaoLengCommand(save, {
        type: "observe_library_card",
        requestId: "observe-library-card-1",
        expectedRevision: save.saveRevision ?? 0,
        expectedPackageId: pkg.id,
        issuedAt: now,
      });
      save = result.saveAfter;
      observedBefore = true;
    }

    runtime = save.sceneRuntime;
    if (runtime.status === "reading") runtime = runtimeModule.transitionSceneRuntime(pkg, runtime, { type: "SKIP" });
    assert.equal(runtime.status, "awaiting_choice", `${beatId} 未到达选择块`);
    const projection = sceneSave.projectGameSave(save, runtime);
    const requestId = `zhao-flow-choice-${index + 1}`;
    const response = choiceService.applySceneChoice({
      projection,
      package: pkg,
      requestId,
      issuedAt: now,
      expectedRevision: projection.revision,
      choiceId: choices[index],
    });
    save = sceneSave.mergeSceneProjection(save, response.projectionAfter);
    const completedRuntime = readUntilCompleted(pkg, response.runtimeAfter, runtimeModule.transitionSceneRuntime);
    save = { ...save, sceneRuntime: completedRuntime };
    committedChoiceCount += 1;
    uniqueSceneEventCount += response.events.length;
    const next = progress.applyZhaoLengCommand(save, {
      type: "advance_beat",
      requestId: `zhao-flow-advance-${index + 1}`,
      expectedRevision: save.saveRevision ?? 0,
      expectedPackageId: pkg.id,
      issuedAt: now,
    });
    save = next.saveAfter;
    pkg = save.scenePackages[demo.ZHAO_LENG_CHAPTER_ID];
    runtime = save.sceneRuntime;
  }

  assert.equal(save.zhaoLeng.beatId, "zl-12-hook");
  assert.equal(save.sceneRuntime.status, "reading");
  const completedTwelfth = readUntilCompleted(pkg, save.sceneRuntime, runtimeModule.transitionSceneRuntime);
  save = { ...save, sceneRuntime: completedTwelfth };
  if (endingAction === "finish_hidden") {
    const opened = progress.applyZhaoLengCommand(save, {
      type: "open_hidden",
      requestId: "zhao-flow-open-hidden",
      expectedRevision: save.saveRevision ?? 0,
      expectedPackageId: pkg.id,
      issuedAt: now,
    });
    save = opened.saveAfter;
    const hiddenPackage = save.scenePackages[demo.ZHAO_LENG_CHAPTER_ID];
    save = { ...save, sceneRuntime: readUntilCompleted(hiddenPackage, save.sceneRuntime, runtimeModule.transitionSceneRuntime) };
    const finished = progress.applyZhaoLengCommand(save, {
      type: "finish_hidden",
      requestId: "zhao-flow-finish-hidden",
      expectedRevision: save.saveRevision ?? 0,
      expectedPackageId: hiddenPackage.id,
      issuedAt: now,
    });
    save = finished.saveAfter;
  } else {
    const finished = progress.applyZhaoLengCommand(save, {
      type: endingAction,
      requestId: "zhao-flow-finish-normal",
      expectedRevision: save.saveRevision ?? 0,
      expectedPackageId: pkg.id,
      issuedAt: now,
    });
    save = finished.saveAfter;
  }
  const endingPackage = save.scenePackages[demo.ZHAO_LENG_CHAPTER_ID];
  save = { ...save, sceneRuntime: readUntilCompleted(endingPackage, save.sceneRuntime, runtimeModule.transitionSceneRuntime) };
  const ended = progress.applyZhaoLengCommand(save, {
    type: "finish_ending",
    requestId: "zhao-flow-finish-ending",
    expectedRevision: save.saveRevision ?? 0,
    expectedPackageId: endingPackage.id,
    issuedAt: now,
  });
  save = ended.saveAfter;
  return {
    save,
    endingId: save.zhaoLeng.endingId,
    completedBeatIds: save.zhaoLeng.completedBeatIds,
    consumedEventIds: save.zhaoLeng.consumedEventIds,
    scores: demo.getZhaoLengRelationship(save).scores,
    committedChoiceCount,
    uniqueSceneEventCount,
    observedBefore,
  };
}
