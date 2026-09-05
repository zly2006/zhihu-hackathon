import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const buildDir = process.env.V3_TEST_DIR || ".tmp/test-all";
async function load(file) {
  return import(new URL(`../${buildDir}/game/${file}.js`, import.meta.url).href);
}

test("relationship module exposes five-level derivation", async () => {
  const module = await load("relationship-levels");
  assert.equal(typeof module.deriveRelationshipLevel, "function");
  const levels = [19, 20, 40, 60, 80].map((value) =>
    module.deriveRelationshipLevel({ closeness: value, trust: value, conflict: 0, commitment: 0 }),
  );
  assert.deepEqual(levels, ["stranger", "familiar", "friend", "trusted", "important"]);
  assert.equal(module.nextRelationshipThreshold("friend"), 60);
  assert.equal(module.levelLabel("important"), "重要的人");
});

test("relationship levels keep conflict and commitment independent", async () => {
  const [{ deriveRelationshipLevel, evaluateSceneRequirements }, fixture] = await Promise.all([
    load("relationship-levels"),
    import(new URL("./fixtures/scene-runtime-fixture.mjs", import.meta.url).href),
  ]);
  assert.equal(deriveRelationshipLevel({ closeness: 90, trust: 90, conflict: 90, commitment: 5 }), "trusted");
  const world = fixture.makeWorld();
  const ok = evaluateSceneRequirements(
    [
      { kind: "relationship", targetCharacterId: fixture.IDS.first, minTrust: 50, maxConflict: 20, minCommitment: 30 },
      { kind: "flag", key: "ready", equals: true },
    ],
    world,
    { ready: true },
  );
  assert.equal(ok.ok, true);
  const locked = evaluateSceneRequirements(
    [{ kind: "relationship", targetCharacterId: fixture.IDS.second, minTrust: 50 }],
    world,
    {},
  );
  assert.equal(locked.ok, false);
  assert.equal(locked.reasons[0].kind, "relationship");
  assert.match(locked.reasons[0].message, /关系/);
});

test("presentation filters protagonist relationships and exposes all four axes", async () => {
  const [{ buildLifePresentation }, { deriveRelationshipLevel }, fixture] = await Promise.all([
    load("presentation"),
    load("relationship-levels"),
    import(new URL("./fixtures/scene-runtime-fixture.mjs", import.meta.url).href),
  ]);
  const world = fixture.makeWorld({
    relationships: {
      ...fixture.makeWorld().relationships,
      unrelated: {
        id: "unrelated",
        characterAId: fixture.IDS.first,
        characterBId: fixture.IDS.second,
        type: "friend",
        scores: { closeness: 88, trust: 88, conflict: 0, commitment: 90 },
        publicSummary: "不应显示",
        unresolvedIssues: [],
        milestoneEventIds: [],
        status: "active",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
  });
  const presentation = buildLifePresentation({ world, chapterEvents: [] });
  assert.equal(presentation.relationships.length, 1);
  const relation = presentation.relationships[0];
  assert.deepEqual(relation.scores, { closeness: 50, trust: 50, conflict: 10, commitment: 35 });
  assert.equal(relation.level, deriveRelationshipLevel(relation.scores));
  assert.equal(typeof relation.nextThreshold, "number");
  assert.equal(relation.actualDelta, undefined);
});

test("scene action context is public, ordered, and capped to the last chapter", async () => {
  const { compileSceneActionContext } = await load("scene-action-context");
  const actions = Array.from({ length: 5 }, (_, index) => ({
    id: `action-${index}`,
    branchId: "main",
    chapterId: index < 2 ? "chapter-old" : "chapter-last",
    packageId: "package",
    packageVersion: 1,
    sceneId: `scene-${index}`,
    blockId: `block-${index}`,
    choiceId: "A",
    label: `公开行动 ${index}`,
    ruleId: "honest_talk",
    eventIds: [`event-${index}`],
    targetCharacterId: fixtureTarget(),
    actualRelationshipDelta: { trust: index + 1 },
    flagsAfter: { honestTalk: true },
    next: { kind: "chapter_end" },
    beforeHash: `before-${index}`,
    afterHash: `after-${index}`,
    committedAt: `2026-01-01T00:00:0${index}.000Z`,
  }));
  function fixtureTarget() { return "test-character-a"; }
  const context = compileSceneActionContext({ actions, activeBranchId: "main", lastCompletedChapterId: "chapter-last" });
  assert.equal(context.length, 3);
  assert.deepEqual(context.map((item) => item.actionId), ["action-2", "action-3", "action-4"]);
  assert.ok(context.every((item) => !("beforeHash" in item) && !("afterHash" in item) && !("flagsAfter" in item)));
  assert.deepEqual(context[0].appliedEffects.relationshipDelta, { trust: 3 });
});

test("scene action context normalizer strips non-public fields and enforces the cap", async () => {
  const { compileSceneActionContext, normalizeSceneActionContext } = await load("scene-action-context");
  const source = compileSceneActionContext({
    actions: [{
      id: "action-public",
      branchId: "main",
      chapterId: "chapter-last",
      packageId: "package",
      packageVersion: 1,
      sceneId: "scene-1",
      blockId: "block-1",
      choiceId: "A",
      label: "先把话听完",
      ruleId: "listen_without_promise",
      targetCharacterId: "test-character-a",
      eventIds: ["event-1"],
      actualRelationshipDelta: { trust: 4 },
      flagsAfter: { listened: true },
      next: { kind: "chapter_end" },
      beforeHash: "private-before-hash",
      afterHash: "private-after-hash",
      committedAt: "2026-01-01T00:00:00.000Z",
    }],
    activeBranchId: "main",
    lastCompletedChapterId: "chapter-last",
  });
  const normalized = normalizeSceneActionContext([
    { ...source[0], privateState: "不得进入 C 的公开上下文", beforeHash: "不得传播" },
  ]);
  assert.deepEqual(normalized, source);
  assert.throws(() => normalizeSceneActionContext([...Array(4)].map(() => source[0])), /最多 3/);
});

test("choice and simulation boundaries carry only compiled scene action context", () => {
  const root = process.cwd();
  const lifeApp = readFileSync(join(root, "components", "life", "LifeApp.tsx"), "utf8");
  const choicesRoute = readFileSync(join(root, "app", "api", "chapter", "choices", "route.ts"), "utf8");
  const simulateRoute = readFileSync(join(root, "app", "api", "chapter", "simulate", "route.ts"), "utf8");
  assert.match(lifeApp, /compileSceneActionContext/);
  assert.match(lifeApp, /sceneActionContext/);
  assert.match(choicesRoute, /normalizeSceneActionContext/);
  assert.match(choicesRoute, /sceneActionContext/);
  assert.match(simulateRoute, /normalizeSceneActionContext/);
  assert.match(simulateRoute, /sceneActionContext/);
  assert.doesNotMatch(choicesRoute, /privateState/);
  assert.doesNotMatch(simulateRoute, /privateState/);
});
