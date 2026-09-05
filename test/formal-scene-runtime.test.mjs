import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const buildDir = process.env.V3_TEST_DIR || ".tmp/test-all";
async function load(file) {
  return import(new URL(`../${buildDir}/game/${file}.js`, import.meta.url).href);
}

test("formal scene lookup accepts a matching live package and rejects retrospective content", async () => {
  const [{ getLiveSceneSession, hasLiveScene }, { createSceneRuntime }, { adaptDialogueScenes }, fixture] = await Promise.all([
    load("formal-scene-runtime"),
    load("scene-runtime"),
    load("scene-adapter"),
    import(new URL("./fixtures/scene-runtime-fixture.mjs", import.meta.url).href),
  ]);

  const livePackage = fixture.makeScenePackage();
  assert.equal(hasLiveScene(livePackage), true);
  const liveRuntime = createSceneRuntime(livePackage, { branchId: "branch-main" });
  const liveSave = {
    sceneRuntime: liveRuntime,
    scenePackages: { [livePackage.chapterId]: livePackage },
  };
  const session = getLiveSceneSession(liveSave, livePackage.chapterId);
  assert.equal(session?.package.id, livePackage.id);
  assert.equal(session?.runtime.packageVersion, livePackage.version);

  const retrospectivePackage = adaptDialogueScenes(
    [{
      id: "retro-scene-1",
      background: "urban-home-apartment-day-v1",
      timeLabel: "2026 年 · 历史回放",
      characters: [],
      blocks: [{ type: "narration", text: "已经发生的历史。" }],
      choices: [],
    }],
    { chapterId: "retro-chapter", year: 2026 },
  );
  const retrospectiveRuntime = createSceneRuntime(retrospectivePackage, { branchId: "branch-main" });
  assert.equal(hasLiveScene(retrospectivePackage), false);
  assert.equal(
    getLiveSceneSession(
      { sceneRuntime: retrospectiveRuntime, scenePackages: { [retrospectivePackage.chapterId]: retrospectivePackage } },
      retrospectivePackage.chapterId,
    ),
    null,
  );
});

test("formal chapter summary wires a live session without replacing the retrospective fallback", () => {
  const source = readFileSync(join(process.cwd(), "components", "life", "LifeApp.tsx"), "utf8");
  assert.match(source, /getLiveSceneSession/);
  assert.match(source, /handleFormalSceneSelect/);
  assert.match(source, /scenePackage=\{formalSceneSession\?\.package\}/);
  assert.match(source, /sceneRuntime=\{formalSceneSession\?\.runtime\}/);
  assert.match(source, /onSceneSelect=\{handleFormalSceneSelect\}/);
  assert.match(source, /onScenePersist=\{handleFormalScenePersistPosition\}/);
  assert.match(source, /runtimePackage/);
  assert.match(source, /save\?\.scenePackages\?\.\[runtime\.chapterId\]/);
  assert.match(source, /formal_scene/);
  assert.match(source, /setScreen\("formal_scene"\)/);
  assert.match(source, /recoveredRuntime/);
});

test("formal galgame generation requests an LLM live package and opens the runtime", () => {
  const source = readFileSync(join(process.cwd(), "components", "life", "LifeApp.tsx"), "utf8");
  assert.match(source, /fetchLiveScenePackage/);
  assert.match(source, /\/api\/chapter\/live-scene/);
  assert.match(source, /liveScenePackage/);
  assert.match(source, /setScreen\(liveRuntime \? "formal_scene" : "chapter_summary"\)/);
});

test("live scene route stays server-side and has no fixed-package fallback", () => {
  const source = readFileSync(join(process.cwd(), "app", "api", "chapter", "live-scene", "route.ts"), "utf8");
  assert.match(source, /runtime = "nodejs"/);
  assert.match(source, /generateLiveScenePackage/);
  assert.match(source, /status: 502/);
  assert.doesNotMatch(source, /createNeutralScenePackage/);
});
