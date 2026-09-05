import assert from "node:assert/strict";
import test from "node:test";

const buildDir = process.env.V3_TEST_DIR || ".tmp/test-all";
async function load(file) {
  return import(new URL(`../${buildDir}/game/${file}.js`, import.meta.url).href);
}

async function loadFixture() {
  return import(new URL("./fixtures/scene-runtime-fixture.mjs", import.meta.url).href);
}

test("neutral fixture exposes three versioned scene packages", async () => {
  const module = await load("neutral-scene-package");
  assert.equal(typeof module.createNeutralScenePackages, "function");
  const packages = module.createNeutralScenePackages();
  assert.equal(packages.length, 3);
  assert.equal(packages.reduce((total, item) => total + item.scenes.length, 0), 11);
  assert.ok(packages.every((item) => item.schemaVersion === 1));
  assert.ok(packages.every((item) => item.version === 1 && item.entrySceneId));
  assert.equal(new Set(packages.flatMap((item) => item.scenes.map((scene) => scene.id))).size, 11);
  assert.ok(packages.flatMap((item) => item.scenes).some((scene) => scene.mode === "live"));
  assert.ok(packages.at(-1).endings.length >= 2);
});

test("scene contract stores executable choices inside choice blocks", async () => {
  const { createNeutralScenePackages } = await load("neutral-scene-package");
  const packages = createNeutralScenePackages();
  const choiceBlocks = packages
    .flatMap((item) => item.scenes)
    .flatMap((scene) => scene.blocks)
    .filter((block) => block.content.type === "choice");
  assert.ok(choiceBlocks.length >= 3);
  assert.ok(choiceBlocks.every((block) => block.content.choices.length >= 2 && block.content.choices.length <= 3));
  assert.ok(choiceBlocks.every((block) => block.content.choices.every((choice) => choice.ruleId && choice.next)));
});

test("scene package validator accepts a neutral package bound to the current world", async () => {
  const [{ createNeutralScenePackages }, { validateScenePackage }, fixture] = await Promise.all([
    load("neutral-scene-package"),
    load("scene-package-validator"),
    loadFixture(),
  ]);
  const pkg = createNeutralScenePackages(2026)[0];
  const normalized = validateScenePackage(pkg, {
    world: fixture.makeWorld(),
    flags: {},
    currentYear: 2026,
  });
  assert.notEqual(normalized, pkg);
  assert.equal(normalized.entrySceneId, "test-c1-01");
});

test("scene validator preserves cues on narration, dialogue, and choice blocks", async () => {
  const [{ validateScenePackage }, fixture] = await Promise.all([
    load("scene-package-validator"),
    loadFixture(),
  ]);
  const pkg = fixture.makeScenePackage();
  pkg.scenes[0].blocks[0].cues = [{ characterId: "test-character-a", animation: "enter" }];
  pkg.scenes[0].blocks[1].cues = [{ characterId: "test-character-a", emotion: "严肃", pose: "thinking", animation: "focus" }];
  const normalized = validateScenePackage(pkg, { world: fixture.makeWorld(), currentYear: 2026 });
  assert.deepEqual(normalized.scenes[0].blocks[0].cues, [{ characterId: "test-character-a", animation: "enter" }]);
  assert.deepEqual(normalized.scenes[0].blocks[1].cues, [{ characterId: "test-character-a", emotion: "严肃", pose: "thinking", animation: "focus" }]);
});

test("scene package validator reports path and rejects graph errors", async () => {
  const [{ validateScenePackage, ScenePackageValidationError }, fixture] = await Promise.all([
    load("scene-package-validator"),
    loadFixture(),
  ]);
  const pkg = fixture.makeScenePackage();
  pkg.scenes[0].blocks[1].content.choices[0].next = { kind: "scene", sceneId: "missing-scene" };
  assert.throws(
    () => validateScenePackage(pkg, { world: fixture.makeWorld(), currentYear: 2026 }),
    (error) => error instanceof ScenePackageValidationError && error.code === "unknown_target" && error.path.includes("next.sceneId"),
  );

  const cyclic = fixture.makeScenePackage();
  cyclic.scenes[1].defaultNext = { kind: "scene", sceneId: cyclic.scenes[0].id };
  assert.throws(
    () => validateScenePackage(cyclic, { world: fixture.makeWorld(), currentYear: 2026 }),
    (error) => error instanceof ScenePackageValidationError && error.code === "cycle",
  );
});

test("legacy dialogue choices are adapted as read-only and conflicts are explicit", async () => {
  const { adaptDialogueScenes, SceneAdapterError } = await load("scene-adapter");
  const scenes = [
    {
      id: "legacy-1",
      background: "urban-home-apartment-day-v1",
      timeLabel: "2026 年",
      characters: [{ id: "test-character-a", name: "测试角色甲" }],
      blocks: [
        { type: "dialogue", speakerId: "test-character-a", speaker: "测试角色甲", text: "旧对白", emotion: "平静" },
      ],
      choices: [{ id: "A", label: "旧选项" }],
    },
  ];
  const adapted = adaptDialogueScenes(scenes, { chapterId: "legacy-chapter", year: 2026 });
  const choiceBlock = adapted.scenes[0].blocks.at(-1);
  assert.equal(adapted.scenes[0].mode, "retrospective");
  assert.equal(choiceBlock.content.readOnly, true);
  assert.deepEqual(choiceBlock.content.choices, [{ id: "A", label: "旧选项" }]);

  const conflict = {
    ...scenes[0],
    blocks: [
      ...scenes[0].blocks,
      { type: "choice", text: "块内选项", choices: [{ id: "B", label: "另一个旧选项" }] },
    ],
  };
  assert.throws(
    () => adaptDialogueScenes([conflict]),
    (error) => error instanceof SceneAdapterError && error.path.includes("choices"),
  );
});
