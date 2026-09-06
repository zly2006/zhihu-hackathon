import assert from "node:assert/strict";
import test from "node:test";

const buildDir = process.env.ZHAO_LENG_RUNTIME_TEST_DIR || ".tmp/test-all";

async function load(file) {
  return import(new URL(`../${buildDir}/${file}.js`, import.meta.url));
}

test("赵冷固定剧本包含十二节拍、33项选择反馈和三个结局", async () => {
  const script = await load("narrative/zhao-leng-script");
  const errors = script.validateZhaoLengScript();
  assert.deepEqual(errors, []);
  assert.equal(script.ZHAO_LENG_BEAT_SCRIPTS.length, 12);
  assert.equal(
    script.ZHAO_LENG_BEAT_SCRIPTS.slice(0, 11).reduce((count, beat) => count + beat.choices.length, 0),
    33,
  );
  assert.deepEqual(script.ZHAO_LENG_ENDINGS.map((ending) => ending.id), [
    "mutual-trust",
    "kind-distance",
    "library-letter",
  ]);
  assert.equal(script.ZHAO_LENG_BEAT_SCRIPTS.at(-1).choices.length, 0);
  for (const beat of script.ZHAO_LENG_BEAT_SCRIPTS.slice(0, 11)) {
    assert.equal(Object.keys(beat.feedback).length, 3, beat.id);
    assert.ok(beat.choices.every((choice) => beat.feedback[choice.id]?.length > 0), beat.id);
  }
});

test("赵冷场景编译器只让程序决定规则、跳转和角色", async () => {
  const [{ createZhaoLengDemoSave }, { compileZhaoLengBeat }, { validateScenePackage }, script] = await Promise.all([
    load("game/zhao-leng-demo"),
    load("game/zhao-leng-package"),
    load("game/scene-package-validator"),
    load("narrative/zhao-leng-script"),
  ]);
  const save = createZhaoLengDemoSave({ mode: "scripted", currentYear: 2026, now: "2026-01-01T00:00:00.000Z" });
  const pkg = compileZhaoLengBeat({ save, beatId: "zl-01-message" });
  const normalized = validateScenePackage(pkg, {
    world: save.worldState,
    flags: save.sceneFlags,
    currentYear: 2026,
    chapterId: "zhao-leng-demo-session",
    knownRuleIds: script.ZHAO_LENG_RULE_IDS,
  });
  assert.equal(normalized.scenes.length, 4);
  const choiceBlock = normalized.scenes[0].blocks.at(-1);
  assert.equal(choiceBlock.content.type, "choice");
  assert.deepEqual(choiceBlock.content.choices.map((choice) => choice.id), ["A", "B", "C"]);
  assert.deepEqual(choiceBlock.content.choices.map((choice) => choice.ruleId), [
    "listen_without_promise",
    "make_joint_plan",
    "respect_distance",
  ]);
  assert.equal(choiceBlock.content.choices.every((choice) => choice.next.kind === "scene"), true);
  assert.equal(normalized.scenes.every((scene) => scene.characters.some((character) => character.id === "npc-zhao-leng")), true);
  assert.equal(normalized.scenes.every((scene) => scene.year === 2026), true);
});

test("赵冷场景编译保留远程和第一场改约的承接事实", async () => {
  const [{ createZhaoLengDemoSave }, { compileZhaoLengBeat }] = await Promise.all([
    load("game/zhao-leng-demo"),
    load("game/zhao-leng-package"),
  ]);
  const base = createZhaoLengDemoSave({ mode: "scripted", currentYear: 2026, now: "2026-01-01T00:00:00.000Z" });
  const weekend = { ...base, sceneFlags: { ...base.sceneFlags, zhaoFirstMeetingWeekend: true } };
  const second = compileZhaoLengBeat({ save: weekend, beatId: "zl-02-library" });
  assert.match(second.scenes[0].timeLabel, /周末/);

  const remote = {
    ...base,
    sceneFlags: { ...base.sceneFlags, zhaoRemoteFuture: true },
  };
  const eleventh = compileZhaoLengBeat({ save: remote, beatId: "zl-11-future" });
  assert.match(eleventh.scenes[0].timeLabel, /远程/);
});
