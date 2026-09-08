import assert from "node:assert/strict";
import test from "node:test";

const buildDir = process.env.SCENE_BOUNDARY_REVEAL_TEST_DIR || ".tmp/test-all";

async function load(file) {
  return import(new URL(`../${buildDir}/game/${file}.js`, import.meta.url));
}

function packageWithBoundary(boundary) {
  return {
    schemaVersion: 1,
    id: "story-unit-boundary-v1",
    version: 1,
    chapterId: "chapter-boundary",
    entrySceneId: "scene-1",
    scenes: [
      {
        id: "scene-1",
        mode: "live",
        background: "urban-public-cafe-rain-v1",
        timeLabel: "2026 年 · 当前",
        year: 2026,
        sourceEventIds: [],
        characters: [
          { id: "hero", name: "主角", position: "center", emotion: "犹豫" },
          { id: "friend", name: "朋友", position: "left", emotion: "等待" },
        ],
        blocks: [
          { id: "scene-1:opening", content: { type: "dialogue", speaker: "朋友", speakerId: "friend", text: "你准备怎么回应？", emotion: "等待" } },
          {
            id: "scene-1:choice",
            content: {
              type: "choice",
              text: "做出选择",
              choices: [
                { id: "A", label: "说明计划", ruleId: "honest_talk", targetCharacterId: "friend", requirements: [], next: { kind: "scene", sceneId: "scene-2" } },
                { id: "B", label: "保留空间", ruleId: "respect_distance", targetCharacterId: "friend", requirements: [], next: { kind: "scene", sceneId: "scene-2" } },
                { id: "C", label: "先暂停", ruleId: "avoid_conversation", targetCharacterId: "friend", requirements: [], next: { kind: "scene", sceneId: "scene-2" } },
              ],
            },
          },
        ],
        defaultNext: { kind: "scene", sceneId: "scene-2" },
      },
      {
        id: "scene-2",
        mode: "live",
        background: "urban-home-apartment-night-v1",
        timeLabel: "2026 年 · 当晚",
        year: 2026,
        sourceEventIds: [],
        characters: [{ id: "hero", name: "主角", position: "center", emotion: "平静" }],
        blocks: [
          { id: "scene-2:line", content: { type: "narration", text: "你的选择留下了一个具体的下一步。" } },
        ],
        defaultNext: boundary,
      },
    ],
    endings: [],
  };
}

async function choiceRuntime(pkg) {
  const { createSceneRuntime, transitionSceneRuntime } = await load("scene-runtime");
  let state = createSceneRuntime(pkg, { branchId: "main" });
  state = transitionSceneRuntime(pkg, state, { type: "NEXT" });
  state = transitionSceneRuntime(pkg, state, {
    type: "SELECT_STARTED",
    requestId: "choice-1",
    choiceId: "A",
    issuedAt: "2026-01-01T00:00:00.000Z",
    expectedRevision: 0,
  });
  return transitionSceneRuntime(pkg, state, {
    type: "SELECT_SUCCEEDED",
    flowPolicy: "seamless",
    record: { id: "action-1", next: { kind: "scene", sceneId: "scene-2" } },
  });
}

test("seamless routes to unit_end and chapter_end as completed boundaries, never feedback", async () => {
  const { createSceneRuntime, transitionSceneRuntime } = await load("scene-runtime");
  for (const boundary of [
    { kind: "unit_end", unitId: "chapter-boundary-unit-2", pendingEventIds: ["event-2"] },
    { kind: "chapter_end" },
    { kind: "ending", endingId: "ending-1" },
  ]) {
    const pkg = packageWithBoundary(boundary);
    if (boundary.kind === "ending") {
      pkg.endings = [{ id: "ending-1", title: "结局", summary: "本章到达结局。" }];
    }
    let state = await choiceRuntime(pkg);
    state = transitionSceneRuntime(pkg, state, { type: "NEXT" });
    assert.equal(state.status, "completed");
    assert.deepEqual(state.completion, boundary);
    assert.notEqual(state.status, "feedback");
  }
});

test("reveal cursor keeps post-settlement world hidden until the covered boundary", async () => {
  const [{ createRevealCursor, revealStoryUnit }, fixture] = await Promise.all([
    load("story-reveal"),
    import(new URL("./fixtures/scene-runtime-fixture.mjs", import.meta.url).href),
  ]);
  const before = fixture.makeWorld();
  const after = JSON.parse(JSON.stringify(before));
  after.currentYear = before.currentYear + 1;
  after.characters[after.protagonistId].state.stats.cash += 80;
  const cursor = createRevealCursor({
    chapterId: "chapter-1",
    worldBefore: before,
    worldAfter: after,
    eventIds: ["event-1", "event-2"],
  });
  assert.equal(cursor.phase, "hidden");
  assert.equal(cursor.visibleWorld.currentYear, before.currentYear);
  assert.equal(cursor.visibleWorld.characters[before.protagonistId].state.stats.cash, before.characters[before.protagonistId].state.stats.cash);

  const inProgress = revealStoryUnit(cursor, { unitId: "unit-1", coveredEventIds: ["event-1"], boundary: { kind: "unit_end" } });
  assert.equal(inProgress.phase, "in_progress");
  assert.deepEqual(inProgress.revealedEventIds, ["event-1"]);
  assert.equal(inProgress.visibleWorld.currentYear, before.currentYear);

  const complete = revealStoryUnit(inProgress, { unitId: "unit-2", coveredEventIds: ["event-2"], boundary: { kind: "chapter_end" } });
  assert.equal(complete.phase, "complete");
  assert.deepEqual(complete.revealedEventIds, ["event-1", "event-2"]);
  assert.equal(complete.visibleWorld.currentYear, after.currentYear);
  assert.equal(complete.visibleWorld.characters[before.protagonistId].state.stats.cash, after.characters[after.protagonistId].state.stats.cash);

  const ending = revealStoryUnit(cursor, {
    unitId: "ending-unit",
    coveredEventIds: ["event-1", "event-2"],
    boundary: { kind: "ending", endingId: "ending-1" },
  });
  assert.equal(ending.phase, "complete");
  assert.equal(ending.visibleWorld.currentYear, after.currentYear);
});
