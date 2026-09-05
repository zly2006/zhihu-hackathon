import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const buildDir = process.env.V3_TEST_DIR || ".tmp/test-all";
async function load(file) {
  return import(new URL(`../${buildDir}/game/${file}.js`, import.meta.url).href);
}

async function fixture() {
  return import(new URL("./fixtures/scene-runtime-fixture.mjs", import.meta.url).href);
}

test("scene runtime exposes a pure state-machine constructor", async () => {
  const [{ createSceneRuntime, getActiveBlock, transitionSceneRuntime, findNextChoice }, { makeScenePackage }] = await Promise.all([
    load("scene-runtime"),
    fixture(),
  ]);
  const pkg = makeScenePackage();
  let state = createSceneRuntime(pkg, { branchId: "branch-main" });
  assert.equal(state.status, "reading");
  assert.equal(state.sceneId, "test-scene-1");
  assert.equal(getActiveBlock(pkg, state).id, "test-scene-1-b1");

  state = transitionSceneRuntime(pkg, state, { type: "NEXT" });
  assert.equal(state.status, "awaiting_choice");
  assert.equal(state.blockId, "test-scene-1-choice");
  assert.equal(transitionSceneRuntime(pkg, state, { type: "AUTO_TICK" }), state);
  assert.equal(transitionSceneRuntime(pkg, state, { type: "SKIP" }), state);
  assert.equal(findNextChoice(pkg, state)?.block.id, "test-scene-1-choice");
});

test("scene runtime never auto-selects and routes successful actions from the record", async () => {
  const [{ createSceneRuntime, transitionSceneRuntime }, { makeScenePackage }] = await Promise.all([
    load("scene-runtime"),
    fixture(),
  ]);
  const pkg = makeScenePackage();
  let state = createSceneRuntime(pkg, { branchId: "branch-main" });
  state = transitionSceneRuntime(pkg, state, { type: "NEXT" });
  state = transitionSceneRuntime(pkg, state, {
    type: "SELECT_STARTED",
    requestId: "request-1",
    choiceId: "A",
    issuedAt: "2026-01-01T00:00:00.000Z",
    expectedRevision: 0,
  });
  assert.equal(state.status, "submitting");
  assert.equal(state.pendingAction?.choiceId, "A");

  const succeeded = transitionSceneRuntime(pkg, state, {
    type: "SELECT_SUCCEEDED",
    record: {
      id: "action-1",
      next: { kind: "scene", sceneId: "test-scene-2" },
    },
  });
  assert.equal(succeeded.status, "feedback");
  assert.equal(succeeded.selectedActionId, "action-1");
  assert.equal(succeeded.sceneId, "test-scene-1");

  const resumed = transitionSceneRuntime(pkg, succeeded, { type: "ACK_FEEDBACK" });
  assert.equal(resumed.sceneId, "test-scene-2");
  assert.equal(resumed.blockId, "test-scene-2-b1");
  assert.equal(resumed.status, "reading");
});

test("scene runtime supports error retry, completion, and read-only replay", async () => {
  const [{ createSceneRuntime, transitionSceneRuntime }, { makeScenePackage }] = await Promise.all([
    load("scene-runtime"),
    fixture(),
  ]);
  const pkg = makeScenePackage();
  let state = createSceneRuntime(pkg, { branchId: "branch-main" });
  state = transitionSceneRuntime(pkg, state, { type: "NEXT" });
  state = transitionSceneRuntime(pkg, state, {
    type: "SELECT_STARTED",
    requestId: "request-1",
    choiceId: "A",
    issuedAt: "2026-01-01T00:00:00.000Z",
    expectedRevision: 0,
  });
  state = transitionSceneRuntime(pkg, state, { type: "SELECT_FAILED", errorCode: "REVISION_CONFLICT" });
  assert.equal(state.status, "error");
  assert.equal(state.pendingAction?.choiceId, "A");
  state = transitionSceneRuntime(pkg, state, { type: "RESUME" });
  assert.equal(state.status, "awaiting_choice");
  assert.equal(state.blockId, "test-scene-1-choice");
  state = transitionSceneRuntime(pkg, state, {
    type: "SELECT_STARTED",
    requestId: "request-2",
    choiceId: "A",
    issuedAt: "2026-01-01T00:00:01.000Z",
    expectedRevision: 0,
  });

  state = transitionSceneRuntime(pkg, state, {
    type: "SELECT_SUCCEEDED",
    record: { id: "action-1", next: { kind: "chapter_end" } },
  });
  state = transitionSceneRuntime(pkg, state, { type: "ACK_FEEDBACK" });
  assert.equal(state.status, "completed");
  assert.equal(transitionSceneRuntime(pkg, state, { type: "NEXT" }), state);

  const replay = transitionSceneRuntime(pkg, createSceneRuntime(pkg, { branchId: "branch-main" }), {
    type: "REPLAY",
    blockId: "test-scene-1-choice",
  });
  assert.equal(replay.readOnly, true);
  assert.equal(replay.status, "reading");
  assert.equal(transitionSceneRuntime(pkg, replay, { type: "SELECT_STARTED", choiceId: "A", requestId: "r", issuedAt: "x", expectedRevision: 0 }), replay);
});

test("visual resolver follows exact, neutral, avatar, and placeholder fallback order", async () => {
  const { resolveCharacterVisual } = await load("visual-resolver");
  const args = {
    characterId: "test-character-a",
    emotion: "serious",
    pose: "stand",
    animation: "speaking",
    profileMap: {
      "test-character-a|serious|stand|speaking": { src: "/exact.png" },
      "test-character-a|neutral": { src: "/neutral.png" },
    },
    avatarFallback: "/avatar.png",
    name: "测试角色甲",
  };
  assert.equal(resolveCharacterVisual(args).kind, "exact");
  assert.equal(resolveCharacterVisual({ ...args, profileMap: { "test-character-a|neutral": { src: "/neutral.png" } } }).kind, "neutral");
  assert.equal(resolveCharacterVisual({ ...args, profileMap: {}, avatarFallback: "/avatar.png" }).kind, "avatar");
  assert.equal(resolveCharacterVisual({ ...args, profileMap: {}, avatarFallback: null }).kind, "placeholder");
});

test("scene player and hook expose lifecycle-safe controlled playback", () => {
  const root = process.cwd();
  const hook = readFileSync(join(root, "components/life/use-scene-runtime.ts"), "utf8");
  const player = readFileSync(join(root, "components/life-vn/SceneRuntimePlayer.tsx"), "utf8");
  const controls = readFileSync(join(root, "components/life-vn/ScenePlaybackControls.tsx"), "utf8");
  assert.ok(existsSync(join(root, "components/life/use-scene-runtime.ts")));
  assert.match(hook, /visibilitychange/);
  assert.match(hook, /inFlight/);
  assert.match(hook, /generation/);
  assert.match(hook, /SELECT_STARTED/);
  assert.match(hook, /SELECT_FAILED/);
  assert.match(player, /SceneStage/);
  assert.match(player, /DialogueBox/);
  assert.match(player, /readOnly/);
  assert.match(player, /aria-live/);
  assert.match(controls, /SKIP|跳至下个选择/);
});
