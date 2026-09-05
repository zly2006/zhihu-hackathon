import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const buildDir = process.env.V3_TEST_DIR || ".tmp/test-all";
async function load(file) {
  return import(new URL(`../${buildDir}/game/${file}.js`, import.meta.url).href);
}

test("scene choice service exposes deterministic application", async () => {
  const [{ applySceneChoice }, { resolveSceneChoice }, { validateSceneEvent }, fixture] = await Promise.all([
    load("scene-choice-service"),
    load("scene-choice-resolver"),
    load("scene-event-validator"),
    import(new URL("./fixtures/scene-runtime-fixture.mjs", import.meta.url).href),
  ]);
  const projection = fixture.makeProjection();
  const pkg = fixture.makeScenePackage();
  const input = {
    projection,
    package: pkg,
    requestId: "request-1",
    issuedAt: "2026-01-01T00:00:00.000Z",
    expectedRevision: 0,
    choiceId: "A",
  };
  const resolved = resolveSceneChoice({
    world: projection.worldState,
    package: pkg,
    runtime: projection.runtime,
    flags: projection.flags,
    choiceId: "A",
    actionId: "scene-action-1",
  });
  assert.equal(resolved.event.source.kind, "scene_choice");
  assert.equal(resolved.event.year, projection.worldState.currentYear);
  assert.equal(resolved.event.characterChanges.length, 0);
  assert.equal(resolved.event.evidenceIds.length, 0);
  assert.equal(resolved.actualRelationshipDelta.trust, 4);
  assert.equal(validateSceneEvent(resolved.event, { world: projection.worldState, package: pkg, runtime: projection.runtime, actionId: "scene-action-1" }).source.kind, "scene_choice");
  assert.throws(() => validateSceneEvent({ ...resolved.event, year: 2027 }, { world: projection.worldState, package: pkg, runtime: projection.runtime }), (error) => error.code === "YEAR_MISMATCH");
  assert.throws(() => validateSceneEvent({ ...resolved.event, characterChanges: [{ characterId: fixture.IDS.protagonist, description: "非法" }] }, { world: projection.worldState, package: pkg }), (error) => error.code === "CHARACTER_CHANGE_FORBIDDEN");

  const first = applySceneChoice({ ...input, delta: { trust: 99, closeness: 99 } });
  assert.equal(first.replayed, false);
  assert.equal(first.afterRevision, 1);
  assert.equal(first.events.length, 1);
  assert.equal(first.record.actualRelationshipDelta.trust, 4);
  assert.equal(first.worldStateAfter.chapterIds.length, 0);
  assert.equal(first.worldStateAfter.characters[fixture.IDS.protagonist].state.stats.cash, projection.worldState.characters[fixture.IDS.protagonist].state.stats.cash);
  assert.equal(first.worldStateAfter.currentYear, projection.worldState.currentYear);
  assert.equal(first.runtimeAfter.status, "feedback");

  const replay = applySceneChoice({ ...input, projection: first.projectionAfter });
  assert.equal(replay.replayed, true);
  assert.equal(replay.afterRevision, 1);
  assert.deepEqual(replay.record, first.record);
  assert.equal(replay.projectionAfter.revision, 1);
});

test("scene choice service rejects locked, unknown, stale, conflicting, and incomplete actions", async () => {
  const [{ applySceneChoice, SceneChoiceServiceError }, fixture] = await Promise.all([
    load("scene-choice-service"),
    import(new URL("./fixtures/scene-runtime-fixture.mjs", import.meta.url).href),
  ]);
  const base = {
    projection: fixture.makeProjection(),
    package: fixture.makeScenePackage(),
    requestId: "request-1",
    issuedAt: "2026-01-01T00:00:00.000Z",
    expectedRevision: 0,
    choiceId: "A",
  };
  const lockedPackage = fixture.makeScenePackage();
  for (const choice of lockedPackage.scenes[0].blocks[1].content.choices) {
    choice.requirements = [{ kind: "flag", key: "never", equals: true }];
  }
  assert.throws(() => applySceneChoice({ ...base, package: lockedPackage }), (error) => error instanceof SceneChoiceServiceError && error.code === "CHOICE_LOCKED");

  const unknownRule = fixture.makeScenePackage();
  unknownRule.scenes[0].blocks[1].content.choices[0].ruleId = "not-registered";
  assert.throws(() => applySceneChoice({ ...base, package: unknownRule }), (error) => error.code === "UNKNOWN_RULE");

  const first = applySceneChoice(base);
  assert.throws(
    () => applySceneChoice({ ...base, projection: first.projectionAfter, requestId: "request-2", expectedRevision: 0, choiceId: "B" }),
    (error) => error.code === "REVISION_CONFLICT" || error.code === "CHOICE_SLOT_CONFLICT",
  );

  const incomplete = fixture.makeProjection({
    worldState: fixture.makeWorld({ canonicalEventIds: ["scene-event:branch-main:test-chapter:test-package:v1:test-scene-1:test-scene-1-choice"] }),
  });
  assert.throws(() => applySceneChoice({ ...base, projection: incomplete }), (error) => error instanceof SceneChoiceServiceError && error.code === "INCOMPLETE_SAVE");
});

test("scene choice route is a Node-only thin error-mapping boundary", () => {
  const source = readFileSync(join(process.cwd(), "app/api/chapter/scene-choice/route.ts"), "utf8");
  assert.match(source, /export const runtime = ["']nodejs["']/);
  assert.match(source, /export async function POST/);
  assert.match(source, /applySceneChoice/);
  assert.match(source, /CHOICE_LOCKED/);
  assert.match(source, /REVISION_CONFLICT/);
  assert.match(source, /status: 422/);
  assert.match(source, /status: 409/);
  assert.match(source, /retryable/);
  assert.doesNotMatch(source, /from ["'][^"']*(llm|database|world-simulator|dialogue-writer)["']/);
  assert.doesNotMatch(source, /delta/);
});
