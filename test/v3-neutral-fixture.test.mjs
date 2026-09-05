import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const buildDir = process.env.V3_TEST_DIR || ".tmp/test-all";
async function load(file) {
  return import(new URL(`../${buildDir}/game/${file}.js`, import.meta.url).href);
}

test("neutral fixture exposes three packages", async () => {
  const module = await load("neutral-scene-package");
  assert.equal(typeof module.createNeutralScenePackages, "function");
});

test("neutral demo route is isolated, synthetic, and validates packages before returning", () => {
  const source = readFileSync(join(process.cwd(), "app/api/life/demo/route.ts"), "utf8");
  assert.match(source, /synthetic: true/);
  assert.match(source, /restart-life-neutral-scene-demo-v1/);
  assert.match(source, /createNeutralScenePackages/);
  assert.match(source, /validateScenePackage/);
  assert.match(source, /validateWorldState/);
  assert.doesNotMatch(source, /DK_DATABASE_URL|raw_envelope|\.env/);
});

test("neutral demo UI keeps a separate save and exposes package continuation", () => {
  const source = readFileSync(join(process.cwd(), "components/life/LifeApp.tsx"), "utf8");
  assert.match(source, /restart-life-neutral-scene-demo-v1/);
  assert.match(source, /进入下一测试章节/);
  assert.match(source, /createSceneRuntime/);
});

test("neutral fixture paths contain a merge, a lock, and two public endings", async () => {
  const { createNeutralScenePackages } = await load("neutral-scene-package");
  const packages = createNeutralScenePackages();
  const allScenes = packages.flatMap((item) => item.scenes);
  const targets = allScenes.flatMap((scene) => [scene.defaultNext, ...scene.blocks.flatMap((block) => block.content.type === "choice" ? block.content.choices.map((choice) => choice.next) : [])]);
  assert.ok(targets.some((target) => target.kind === "chapter_end"));
  assert.ok(targets.some((target) => target.kind === "ending"));
  assert.ok(packages[1].scenes.find((scene) => scene.id === "test-c2-04")?.blocks.some((block) => block.content.type === "choice" && block.content.choices.some((choice) => choice.requirements.length > 0)));
  assert.ok(packages[2].scenes.some((scene) => scene.characters.length >= 2));
  assert.equal(packages[2].endings.length, 2);
  const forbidden = ["赵冷", "冷", "正式结局"].join("|");
  assert.ok(!JSON.stringify(packages).match(new RegExp(forbidden)));
});

test("neutral fixture walks two complete paths with one event per committed choice", async () => {
  const [{ createNeutralScenePackages }, { createSceneRuntime, transitionSceneRuntime }, { applySceneChoice }, { normalizeSceneSave, serializeSceneSave }, fixture] = await Promise.all([
    load("neutral-scene-package"),
    load("scene-runtime"),
    load("scene-choice-service"),
    load("scene-save"),
    import(new URL("./fixtures/scene-runtime-fixture.mjs", import.meta.url).href),
  ]);
  const packages = createNeutralScenePackages(2026);

  async function runPath(choices) {
    let projection = fixture.makeProjection();
    const visited = [];
    let actions = 0;
    for (const [packageIndex, packageItem] of packages.entries()) {
      projection = {
        ...projection,
        worldState: { ...projection.worldState, currentYear: 2026 + packageIndex },
        runtime: createSceneRuntime(packageItem, { branchId: projection.runtime.branchId }),
      };
      while (projection.runtime.status !== "completed") {
        visited.push(projection.runtime.sceneId);
        while (projection.runtime.status === "reading") {
          projection = { ...projection, runtime: transitionSceneRuntime(packageItem, projection.runtime, { type: "NEXT" }) };
          if (projection.runtime.status !== "reading") break;
          visited.push(projection.runtime.sceneId);
        }
        if (projection.runtime.status !== "awaiting_choice") break;
        const currentScene = packageItem.scenes.find((scene) => scene.id === projection.runtime.sceneId);
        const choiceBlock = currentScene.blocks.find((block) => block.id === projection.runtime.blockId);
        const choiceId = choices[packageIndex].shift();
        const response = applySceneChoice({
          projection,
          package: packageItem,
          requestId: `request-${packageIndex}-${actions}`,
          issuedAt: `2026-01-01T00:00:0${actions}.000Z`,
          expectedRevision: projection.revision,
          choiceId,
        });
        assert.ok(choiceBlock.content.choices.some((choice) => choice.id === choiceId));
        actions += 1;
        projection = normalizeSceneSave(JSON.parse(serializeSceneSave(response.projectionAfter)));
        projection = { ...projection, runtime: transitionSceneRuntime(packageItem, projection.runtime, { type: "ACK_FEEDBACK" }) };
        if (projection.runtime.status === "completed") break;
      }
    }
    return { projection, visited: new Set(visited), actions };
  }

  const together = await runPath([["A"], ["A", "A"], ["A"]]);
  const apart = await runPath([["A"], ["B", "B"], ["B"]]);
  assert.equal(together.projection.runtime.status, "completed");
  assert.equal(apart.projection.runtime.status, "completed");
  assert.equal(together.actions, 4);
  assert.equal(apart.actions, 4);
  assert.ok(together.visited.size >= 10);
  assert.ok(apart.visited.size >= 10);
  assert.ok(together.projection.flags.jointPlan);
  assert.equal(together.projection.actions.length, together.actions);
  assert.equal(Object.keys(together.projection.events).length, together.actions);
  assert.ok(together.projection.actions.some((action) => action.next.kind === "ending"));
  assert.ok(apart.projection.actions.some((action) => action.next.kind === "ending"));
});
