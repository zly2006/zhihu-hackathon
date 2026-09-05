import assert from "node:assert/strict";
import test from "node:test";

const buildDir = process.env.V3_TEST_DIR || ".tmp/test-all";
async function load(file) {
  return import(new URL(`../${buildDir}/game/${file}.js`, import.meta.url).href);
}

test("scene triggers deduplicate by branch and wait for safe playback boundaries", async () => {
  const { enqueueSceneTrigger, activateNextSceneTrigger, completeSceneTrigger } = await load("scene-trigger-queue");
  const fixture = await import(new URL("./fixtures/scene-runtime-fixture.mjs", import.meta.url).href);
  const candidate = {
    triggerId: "trigger-contact-1",
    kind: "contact",
    characterId: fixture.IDS.first,
    sourceEventIds: [],
    package: fixture.makeScenePackage(),
  };
  const first = enqueueSceneTrigger({
    branchId: "branch-main",
    candidate,
    world: fixture.makeWorld(),
    flags: {},
    now: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(first.accepted, true);
  assert.equal(first.queue.length, 1);

  const duplicate = enqueueSceneTrigger({
    branchId: "branch-main",
    candidate,
    existing: first.queue,
    world: fixture.makeWorld(),
    flags: {},
    now: "2026-01-01T00:00:01.000Z",
  });
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.reason, "duplicate");
  assert.equal(duplicate.queue.length, 1);

  const otherBranch = enqueueSceneTrigger({
    branchId: "branch-other",
    candidate,
    existing: duplicate.queue,
    world: fixture.makeWorld(),
    flags: {},
    now: "2026-01-01T00:00:02.000Z",
  });
  assert.equal(otherBranch.accepted, true);
  assert.equal(otherBranch.queue.length, 2);

  const runtime = fixture.makeProjection().runtime;
  const busy = activateNextSceneTrigger(otherBranch.queue, "branch-main", { ...runtime, status: "submitting" });
  assert.equal(busy.trigger, undefined);
  assert.equal(busy.reason, "busy");

  const active = activateNextSceneTrigger(busy.queue, "branch-main", { ...runtime, status: "reading" });
  assert.equal(active.trigger?.triggerId, "trigger-contact-1");
  assert.equal(active.trigger?.status, "active");
  const consumed = completeSceneTrigger(active.queue, "branch-main", "trigger-contact-1");
  assert.equal(consumed.find((item) => item.branchId === "branch-main")?.status, "consumed");
  assert.equal(consumed.find((item) => item.branchId === "branch-other")?.status, "queued");
});

test("scene triggers reject private or malformed insertion data", async () => {
  const { enqueueSceneTrigger } = await load("scene-trigger-queue");
  const fixture = await import(new URL("./fixtures/scene-runtime-fixture.mjs", import.meta.url).href);
  assert.throws(
    () => enqueueSceneTrigger({
      branchId: "branch-main",
      candidate: {
        triggerId: "",
        kind: "hidden",
        characterId: "private-target",
        sourceEventIds: [],
        package: fixture.makeScenePackage(),
      },
      world: fixture.makeWorld(),
      flags: {},
    }),
    /triggerId|角色|characterId/,
  );
});
