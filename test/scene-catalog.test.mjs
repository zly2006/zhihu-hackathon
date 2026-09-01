import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const lab = join(root, "docs", "ui-prototypes", "galgame-style-lab");
const catalogPath = join(lab, "scene-catalog.json");
const htmlPath = join(lab, "index.html");

const EXPECTED_IDS = [
  "urban-home-apartment-night-v1",
  "urban-home-apartment-day-v1",
  "urban-work-office-day-v1",
  "urban-public-cafe-rain-v1",
];

const REQUIRED_FIELDS = [
  "id",
  "familyId",
  "label",
  "assetPath",
  "timeOfDay",
  "weather",
  "eraMin",
  "eraMax",
  "narrativeTags",
  "backgroundPositionDesktop",
  "backgroundPositionMobile",
  "portraitLight",
  "status",
];

test("scene-catalog.json exists and lists exactly the 4 approved backgrounds", () => {
  assert.equal(existsSync(catalogPath), true, "scene-catalog.json should exist");
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  assert.ok(Array.isArray(catalog.scenes), "catalog.scenes should be an array");
  assert.equal(catalog.scenes.length, 4, "batch 01 should contain exactly 4 backgrounds");

  const ids = catalog.scenes.map((scene) => scene.id);
  assert.deepEqual(ids, EXPECTED_IDS, "scene ids should match the frozen batch-01 contract");
});

test("every scene record satisfies the catalog contract fields", () => {
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  for (const scene of catalog.scenes) {
    for (const field of REQUIRED_FIELDS) {
      assert.ok(field in scene, `scene ${scene.id} should have field ${field}`);
    }
    assert.equal(typeof scene.id, "string");
    assert.ok(["home", "work", "public"].includes(scene.familyId), `${scene.id} familyId invalid`);
    assert.ok(["day", "evening", "night"].includes(scene.timeOfDay), `${scene.id} timeOfDay invalid`);
    assert.ok(["clear", "cloudy", "rain"].includes(scene.weather), `${scene.id} weather invalid`);
    assert.ok(Number.isFinite(scene.eraMin) && Number.isFinite(scene.eraMax), `${scene.id} era range invalid`);
    assert.ok(scene.eraMin <= scene.eraMax, `${scene.id} era range reversed`);
    assert.ok(Array.isArray(scene.narrativeTags) && scene.narrativeTags.length > 0, `${scene.id} narrativeTags invalid`);
    assert.ok(["existing", "generated", "reviewed"].includes(scene.status), `${scene.id} status invalid`);
    assert.ok(scene.portraitLight.length > 0, `${scene.id} portraitLight should not be empty`);
  }
});

test("night is the pre-existing asset, three new backgrounds are generated", () => {
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  const byId = Object.fromEntries(catalog.scenes.map((scene) => [scene.id, scene]));
  assert.equal(byId["urban-home-apartment-night-v1"].status, "existing");
  assert.equal(byId["urban-home-apartment-day-v1"].status, "generated");
  assert.equal(byId["urban-work-office-day-v1"].status, "generated");
  assert.equal(byId["urban-public-cafe-rain-v1"].status, "generated");
});

test("every catalog asset file exists on disk", () => {
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  for (const scene of catalog.scenes) {
    const absolute = join(root, ...scene.assetPath.split("/"));
    assert.equal(existsSync(absolute), true, `asset file missing: ${scene.assetPath}`);
  }
});

test("style lab exposes the scene switcher wired to the catalog", () => {
  const html = readFileSync(htmlPath, "utf8");
  for (const id of EXPECTED_IDS) {
    assert.match(html, new RegExp(`data-action="scene" data-scene="${id}"`), `scene button missing: ${id}`);
  }
  assert.match(html, /fetch\("scene-catalog\.json"\)/, "lab should load scene-catalog.json");
  assert.match(html, /class="scene-meta-text"/, "scene meta should have a mutable text span");
  assert.match(html, /applyScene\(currentSceneId\)/, "device switch should re-apply current scene position");
});
