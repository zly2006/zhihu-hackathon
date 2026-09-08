import assert from "node:assert/strict";
import test from "node:test";

const buildDir = process.env.STORY_RUNTIME_TEST_DIR || ".tmp/test-all";

async function load(path) {
  return import(new URL(`../${buildDir}/${path}.js`, import.meta.url));
}

function identity(source = "life_ai") {
  return {
    saveId: "save-1",
    runId: "run-1",
    branchId: "main",
    source,
    contentVersion: "content-v1",
    pipelineVersion: 2,
  };
}

function sceneUnit() {
  return {
    id: "unit-1",
    identity: identity(),
    inputFingerprint: "fp-1",
    phase: "live",
    sourceEventIds: ["event-1"],
    payload: {
      kind: "scene",
      package: {
        schemaVersion: 1,
        id: "story-unit-1",
        version: 1,
        chapterId: "chapter-1",
        entrySceneId: "scene-1",
        scenes: [],
        endings: [],
      },
    },
  };
}

test("shared story session accepts one action, commits canonical state, then publishes one unit", async () => {
  const session = await load("game/story-session");
  const unit = sceneUnit();
  let state = session.createStorySession({ identity: identity(), now: "2026-01-01T00:00:00.000Z" });
  state = session.beginStoryAction(state, {
    requestId: "request-1",
    actionKind: "scene_choice",
    inputFingerprint: "choice-fp",
    expectedRevision: 0,
    now: "2026-01-01T00:00:01.000Z",
  });
  assert.equal(state.journal.phase, "submitted");
  assert.throws(
    () => session.beginStoryAction(state, {
      requestId: "request-2",
      actionKind: "scene_choice",
      inputFingerprint: "choice-fp-2",
      expectedRevision: 0,
      now: "2026-01-01T00:00:02.000Z",
    }),
    /already|进行|submitted/i,
  );

  state = session.commitCanonical(state, {
    requestId: "request-1",
    receiptId: "receipt-1",
    canonicalRevision: 1,
    now: "2026-01-01T00:00:03.000Z",
  });
  assert.equal(state.canonicalRevision, 1);
  assert.equal(state.journal.phase, "canonical_committed");

  state = session.publishStoryUnit(state, unit, "2026-01-01T00:00:04.000Z");
  assert.deepEqual(state.publishedUnitIds, ["unit-1"]);
  assert.equal(state.journal.phase, "presentation_ready");
  assert.equal(session.markStoryDisplayed(state, "unit-1", "2026-01-01T00:00:05.000Z").trace.displayed, true);
});

test("story input fingerprints ignore reading cursor but change semantic facts", async () => {
  const input = await load("game/story-input");
  const base = {
    source: "life_ai",
    saveId: "save-1",
    runId: "run-1",
    branchId: "main",
    pipelineVersion: 2,
    unitId: "chapter-1:unit-1",
    facts: { currentYear: 2026, relationship: { trust: 50 }, eventIds: ["event-1"] },
  };
  const first = input.createStoryInputFingerprint(base);
  const movedCursor = input.createStoryInputFingerprint({ ...base, facts: { ...base.facts, readingBlockId: "block-9" } });
  const changedTrust = input.createStoryInputFingerprint({ ...base, facts: { ...base.facts, relationship: { trust: 51 } } });
  assert.equal(first, movedCursor);
  assert.notEqual(first, changedTrust);
});

test("story artifact cache merges concurrent same-key preparation and invalidates stale content", async () => {
  const cacheModule = await load("game/story-cache");
  const cache = new cacheModule.StoryArtifactCache({ ttlMs: 10_000, maxEntries: 2, now: () => 100 });
  let calls = 0;
  const loader = async () => {
    calls += 1;
    await Promise.resolve();
    return { id: "unit-1" };
  };
  const [left, right] = await Promise.all([cache.getOrPrepare("same-key", loader), cache.getOrPrepare("same-key", loader)]);
  assert.deepEqual(left, right);
  assert.equal(calls, 1);
  assert.deepEqual(cache.get("same-key"), { id: "unit-1" });
  cache.invalidate("same-key");
  assert.equal(cache.get("same-key"), undefined);
});

test("shared preparation keeps the task alive when one subscriber cancels", async () => {
  const { StoryArtifactCache } = await load("game/story-cache");
  const cache = new StoryArtifactCache({ ttlMs: 10_000, maxEntries: 2 });
  const leftController = new AbortController();
  let calls = 0;
  let resolveLoader;
  let underlyingAborted = false;
  const loader = (signal) => {
    calls += 1;
    return new Promise((resolve, reject) => {
      resolveLoader = resolve;
      signal.addEventListener("abort", () => {
        underlyingAborted = true;
        reject(new Error("underlying cancelled"));
      }, { once: true });
    });
  };
  const left = cache.getOrPrepare("shared", loader, { signal: leftController.signal });
  const right = cache.getOrPrepare("shared", loader);
  leftController.abort();
  await assert.rejects(left, (error) => error?.name === "AbortError");
  resolveLoader({ id: "unit-1" });
  assert.deepEqual(await right, { id: "unit-1" });
  assert.equal(calls, 1);
  assert.equal(underlyingAborted, false);
});

test("published unit validation rejects partial content and invalid SSE sequence", async () => {
  const validator = await load("game/story-generation-validator");
  assert.throws(() => validator.validatePublishedStoryUnit({ id: "unit", inputFingerprint: "fp" }), /payload|完整|unit/i);
  assert.throws(
    () => validator.validateSseSequence([
      { event: "accepted", seq: 1 },
      { event: "unit_ready", seq: 1 },
    ]),
    /seq|顺序|重复/i,
  );
  assert.equal(
    validator.validateSseSequence([
      { event: "accepted", seq: 1 },
      { event: "unit_ready", seq: 2 },
      { event: "complete", seq: 3 },
    ]).terminal,
    "complete",
  );
});
