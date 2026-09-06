import assert from "node:assert/strict";
import test from "node:test";

const buildDir = process.env.NARRATIVE_EXPERIENCE_TEST_DIR || ".tmp/test-all";

async function load(file) {
  return import(new URL(`../${buildDir}/game/${file}.js`, import.meta.url));
}

test("公共叙事体验 service 保持正式接口的 span 和空结果约束", async () => {
  const [{ buildNarrativeExperience }, { createZhaoLengDemoSave }] = await Promise.all([
    load("narrative-experience-service"),
    load("zhao-leng-demo"),
  ]);
  const save = createZhaoLengDemoSave({ mode: "scripted", currentYear: 2026, now: "2026-01-01T00:00:00.000Z" });
  const result = buildNarrativeExperience({
    chapterId: "zhao-leng-demo-session",
    state: save.worldState,
    decision: {
      id: "preview-1",
      promptTitle: "预览",
      context: "只读预览",
      options: [
        { id: "A", label: "继续", description: "继续", strategyTag: "continue", estimatedRisk: 0, stateFit: "可行" },
        { id: "B", label: "等待", description: "等待", strategyTag: "wait", estimatedRisk: 0, stateFit: "可行" },
        { id: "C", label: "退出", description: "退出", strategyTag: "stop", estimatedRisk: 0, stateFit: "可行" },
      ],
      selectedOptionId: "A",
      normalizedAction: "进入故事",
    },
    span: 1,
    deliveredDirectiveIds: [],
  });
  assert.equal(result.span, 1);
  assert.equal(result.proactiveEvents.length <= 2, true);
  assert.equal(result.publicDirectives.every((item) => !("privateIntent" in item)), true);
});

test("赵冷 scene 体验使用同年节拍上下文，不把 C 卡片直接结算", async () => {
  const [{ buildZhaoLengNarrativeExperience }, { createZhaoLengDemoSave }] = await Promise.all([
    load("narrative-experience-service"),
    load("zhao-leng-demo"),
  ]);
  const save = createZhaoLengDemoSave({ mode: "scripted", currentYear: 2026, now: "2026-01-01T00:00:00.000Z" });
  const result = buildZhaoLengNarrativeExperience({ save, contextKind: "demo-entry" });
  assert.equal(result.span, 1);
  assert.equal(result.startYear, 2026);
  assert.equal(result.endYear, 2026);
  assert.equal(result.pacingSource, "zhao-leng-beat");
  assert.equal(result.contextKind, "demo-entry");
  assert.equal(result.worldStateAfter, undefined);
});

test("主动卡片先 queued，再按 contextId 和 directiveId 去重", async () => {
  const [{ mergeNarrativeDeliveries, updateNarrativeDelivery }, { createInitialNarrativeRuntime }] = await Promise.all([
    load("narrative-experience-service"),
    load("../domain/zhao-leng-runtime"),
  ]);
  const event = {
    id: "npc-proactive-directive-1",
    directiveId: "directive-1",
    kind: "contact_message",
    senderId: "npc-zhao-leng",
    senderName: "赵冷",
    targetCharacterIds: ["protagonist"],
    relationshipIds: ["rel-protagonist-zhao-leng"],
    urgency: 60,
    preview: "赵冷：有空吗？",
    sceneHook: "赵冷主动联系主角。",
    suggestedAction: "先回应。",
    action: "contact_player",
  };
  const first = mergeNarrativeDeliveries(createInitialNarrativeRuntime(), [event], "main", "zl-01");
  const second = mergeNarrativeDeliveries(first.runtime, [event], "main", "zl-01");
  assert.equal(first.runtime.deliveries.length, 1);
  assert.equal(first.runtime.deliveries[0].status, "queued");
  assert.equal(second.runtime.deliveries.length, 1);
  const opened = updateNarrativeDelivery(first.runtime, {
    contextId: "zl-01",
    branchId: "main",
    directiveId: "directive-1",
    status: "opened",
  });
  assert.equal(opened.deliveries[0].status, "opened");
});
