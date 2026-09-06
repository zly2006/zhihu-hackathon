import assert from "node:assert/strict";

const buildDir = process.env.ZHAO_LENG_SESSION_TEST_DIR || ".tmp/test-all";

async function load(path) {
  return import(new URL(`../${buildDir}/${path}.js`, import.meta.url));
}

const [session, demo] = await Promise.all([
  load("game/zhao-leng-session"),
  load("game/zhao-leng-demo"),
]);

const now = "2026-01-01T00:00:00.000Z";
const started = await session.startZhaoLengDemo({ mode: "scripted", currentYear: 2026, now });
assert.equal(started.saveAfter.zhaoLeng.generationMode, "scripted");
assert.equal(started.saveAfter.zhaoLeng.beatId, "zl-01-message");
assert.equal(started.saveAfter.sceneRuntime.packageId, started.scenePackage.id);
assert.equal(started.saveAfter.sceneRuntime.status, "reading");
assert.equal(started.saveAfter.zhaoLeng.packagesById[started.scenePackage.id].id, started.scenePackage.id);

const continued = await session.startZhaoLengDemo({ save: started.saveAfter, mode: "scripted", now });
assert.equal(continued.saveAfter.sceneRuntime.packageId, started.saveAfter.sceneRuntime.packageId);
assert.deepEqual(continued.saveAfter.zhaoLeng.commandReceipts, started.saveAfter.zhaoLeng.commandReceipts);
assert.deepEqual(continued.saveAfter.narrativeRuntime, started.saveAfter.narrativeRuntime);

await assert.rejects(
  () => session.startZhaoLengDemo({ save: demo.createZhaoLengDemoSave({ mode: "scripted", currentYear: 2026, now }), mode: "llm", now }),
  /generationMode|模式|不能切换/,
);

console.log("zhao-leng-session: PASS");
