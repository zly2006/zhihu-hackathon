import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// 编译：npx tsc --outDir .tmp/v13-test --module commonjs --moduleResolution node --target es2022 lib/domain/shared.ts lib/game/avatar-registry.ts lib/game/scene-catalog.ts lib/game/presentation.ts lib/game/character-factory.ts lib/game/decision-resolver.ts
// 运行：node --test test/v13-ui-contract.test.mjs

const base = process.env.V13_TEST_DIR || ".tmp/v13-test";
async function load(rel) {
  return import(new URL(`../${base}/${rel}`, import.meta.url).href);
}

// ---- lib 契约层 ----

test("presentation: buildLifePresentation 只暴露可见信息并正确折算 HUD", async () => {
  const { buildLifePresentation } = await load("game/presentation.js");
  const { AVATAR_PRESETS } = await load("game/avatar-registry.js");

  const now = "2026-01-01T00:00:00.000Z";
  const hero = {
    id: "hero",
    role: "protagonist",
    identity: { name: "张明", birthYear: 2008, gender: "男", hometown: "武汉", familyBackground: "工薪" },
    core: {
      personalityTraits: ["谨慎"],
      values: ["稳定"],
      talents: { insight: 50, charm: 50, grit: 50, learning: 50, luck: 50 },
      hooks: [],
    },
    state: {
      age: 18,
      year: 2026,
      city: "深圳",
      occupation: "程序员",
      socialIdentity: "程序员",
      stats: { cash: 35, health: 80, happiness: 60, knowledge: 50, connections: 25, career: 15, assets: 5 },
      currentGoals: [{ id: "g1", label: "立足", horizon: "long", priority: 80, status: "active" }],
      currentDilemmas: ["就业压力"],
      attitudes: {},
    },
    privateState: { hiddenGoals: ["秘密跳槽"] },
    visual: { avatarId: AVATAR_PRESETS[0].id },
    memoryIds: [],
    createdAt: now,
    updatedAt: now,
  };
  const npc = {
    id: "npc-1",
    role: "npc",
    identity: { name: "林雨", birthYear: 2006, gender: "女", hometown: "", familyBackground: "" },
    core: {
      personalityTraits: [],
      values: [],
      talents: { insight: 50, charm: 50, grit: 50, learning: 50, luck: 50 },
      hooks: [],
    },
    state: {
      age: 20,
      year: 2026,
      city: "深圳",
      occupation: "产品经理",
      socialIdentity: "产品经理",
      stats: { cash: 35, health: 80, happiness: 60, knowledge: 50, connections: 25, career: 40, assets: 5 },
      currentGoals: [],
      currentDilemmas: [],
      attitudes: {},
    },
    privateState: { hiddenGoals: ["不想异地"] },
    visual: { avatarId: AVATAR_PRESETS[2].id },
    memoryIds: [],
    createdAt: now,
    updatedAt: now,
  };
  const world = {
    schemaVersion: 1,
    gameId: "game-1",
    currentYear: 2026,
    protagonistId: "hero",
    characters: { hero, "npc-1": npc },
    relationships: {
      "rel-1": {
        id: "rel-1",
        characterAId: "hero",
        characterBId: "npc-1",
        type: "partner",
        scores: { closeness: 55, trust: 55, conflict: 20, commitment: 45 },
        publicSummary: "恋人",
        unresolvedIssues: [],
        milestoneEventIds: [],
        status: "active",
        updatedAt: now,
      },
    },
    memories: {},
    chapterIds: [],
    eraContext: null,
    openThreads: [],
    canonicalEventIds: [],
    updatedAt: now,
  };

  const result = buildLifePresentation({ world });
  assert.equal(result.protagonist.name, "张明");
  assert.equal(result.protagonist.levelLabel, "Life 01");
  assert.equal(result.protagonist.stats.length, 7);
  assert.ok(result.protagonist.avatarUrl?.includes("/life/avatars/"));
  assert.equal(result.relationships.length, 1);
  assert.equal(result.relationships[0].name, "林雨");
  assert.equal(result.relationships[0].score, 55);

  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("privateState"), "presentation 不得携带 privateState");
  assert.ok(!serialized.includes("秘密跳槽"), "presentation 不得泄漏隐藏目标");
});

test("presentation: 章末属性增量按事件 characterChanges 累计", async () => {
  const { statDeltaFromEvents } = await load("game/presentation.js");
  const events = [
    {
      characterChanges: [
        { characterId: "hero", statDelta: { health: -5, career: 4 } },
        { characterId: "npc", statDelta: { health: -2 } },
      ],
    },
    { characterChanges: [{ characterId: "hero", statDelta: { career: 6 } }] },
  ];
  const delta = statDeltaFromEvents("hero", events);
  assert.deepEqual(delta, { health: -5, career: 10 });
});

test("scene-catalog: 生产目录与实验台 JSON 同源（batch-01 四张）", async () => {
  const { SCENES, pickSceneForNovelScene, findScene } = await load("game/scene-catalog.js");
  const catalog = JSON.parse(
    readFileSync(join(process.cwd(), "docs", "ui-prototypes", "galgame-style-lab", "scene-catalog.json"), "utf8"),
  );
  assert.equal(SCENES.length, 4);
  assert.deepEqual(
    SCENES.map((scene) => scene.id).sort(),
    catalog.scenes.map((scene) => scene.id).sort(),
    "生产目录与实验台 catalog 的 id 集合必须一致",
  );
  for (const scene of SCENES) {
    const matched = catalog.scenes.find((entry) => entry.id === scene.id);
    assert.ok(matched, `catalog 缺少 ${scene.id}`);
    assert.equal(scene.backgroundPositionDesktop, matched.backgroundPositionDesktop);
    assert.equal(scene.backgroundPositionMobile, matched.backgroundPositionMobile);
    assert.equal(scene.portraitLight, matched.portraitLight);
    assert.equal(scene.narrativeTags.join(","), matched.narrativeTags.join(","));
  }

  assert.equal(pickSceneForNovelScene({ heading: "办公室的下午" }).id, "urban-work-office-day-v1");
  assert.equal(
    pickSceneForNovelScene({ timeLabel: "2029.11", text: "窗外的雨越下越大，咖啡馆里只剩我们。" }).id,
    "urban-public-cafe-rain-v1",
  );
  assert.equal(pickSceneForNovelScene({ timeLabel: "上午" }).id, "urban-home-apartment-day-v1");
  assert.equal(pickSceneForNovelScene({ text: "深夜的出租屋" }).id, "urban-home-apartment-night-v1");
  assert.ok(findScene("urban-home-apartment-night-v1"), "默认夜景必须存在");
});

test("decision-resolver: 天赋 0-100 归一化后保护强度等价旧 1-7 量表", async () => {
  const { computeEffectiveRisk, deterministicRoll, resolveDecision } = await load("game/decision-resolver.js");
  const base = {
    state: {
      stats: { cash: 60, health: 70, happiness: 60, knowledge: 50, connections: 40, career: 50, assets: 30 },
    },
  };
  const talents = (values) => ({
    ...base,
    core: { talents: { insight: values, charm: 50, grit: values, learning: 50, luck: values } },
  });

  const riskAtZero = computeEffectiveRisk({ estimatedRisk: 60, stateFit: "可行", protagonist: talents(0) });
  const riskAtFifty = computeEffectiveRisk({ estimatedRisk: 60, stateFit: "可行", protagonist: talents(50) });
  const riskAtHundred = computeEffectiveRisk({ estimatedRisk: 60, stateFit: "可行", protagonist: talents(100) });
  assert.equal(riskAtZero - riskAtFifty, 7, "50 天赋应降低 7 点风险（≈7.4 四舍五入）");
  assert.equal(riskAtFifty - riskAtHundred, 8, "50→100 应再降约 7.4 点（合计 ≈14.8）");

  const args = {
    saveId: "game-1",
    chapterIndex: 3,
    decisionId: "d-1",
    normalizedAction: "加入创业公司",
    estimatedRisk: 48,
    stateFit: "可行",
    protagonist: talents(50),
    eraContext: null,
  };
  const first = resolveDecision(args);
  const second = resolveDecision(args);
  assert.equal(first.uncertaintySeed, second.uncertaintySeed);
  assert.equal(first.effectiveRisk, second.effectiveRisk);
  assert.ok(Number.isFinite(deterministicRoll("x")) && deterministicRoll("x") >= 0 && deterministicRoll("x") < 1);
});

test("character-factory: ProtagonistDraft.visualIdentity 映射为 Character.visual", async () => {
  const { createProtagonist } = await load("game/character-factory.js");
  const { AVATAR_PRESETS } = await load("game/avatar-registry.js");
  const base = {
    name: "张明",
    birthYear: 2008,
    gender: "男",
    hometown: "武汉",
    familyBackground: "工薪",
    initialCity: "深圳",
    initialDirection: "程序员",
    personalityTraits: ["谨慎", "务实", "念旧"],
    values: ["稳定", "家庭"],
    longTermGoal: "立足",
    initialDilemma: "就业压力",
    talents: { insight: 50, charm: 50, grit: 50, learning: 50, luck: 50 },
  };
  const withVisual = createProtagonist({
    ...base,
    visualIdentity: { avatarSource: "preset", avatarId: AVATAR_PRESETS[0].id, avatarLabel: "沉静" },
  });
  assert.equal(withVisual.visual?.avatarId, AVATAR_PRESETS[0].id);
  assert.equal(withVisual.visual?.avatarLabel, "沉静");
  const without = createProtagonist(base);
  assert.equal(without.visual, undefined);
});

// ---- 页面静态契约 ----

test("LifeApp 暴露 render_game_to_text 且不输出 privateState", () => {
  const source = readFileSync(join(process.cwd(), "components", "life", "LifeApp.tsx"), "utf8");
  assert.match(source, /render_game_to_text/);
  const block = source.slice(source.indexOf("render_game_to_text"));
  assert.ok(!/privateState/.test(block), "render_game_to_text 不得引用 privateState");
  assert.match(source, /visibleNpcs/);
  assert.match(source, /visibleRelationships/);
  assert.match(source, /activeDecision/);
});

test("V1.3 页面已接入 life-vn 组件族", () => {
  const lifeApp = readFileSync(join(process.cwd(), "components", "life", "LifeApp.tsx"), "utf8");
  for (const symbol of ["LifeShell", "SceneStage", "DialogueBox", "PlayerHud", "RelationshipHud"]) {
    assert.match(lifeApp, new RegExp(`import.*${symbol}`));
  }
  const summary = readFileSync(join(process.cwd(), "components", "life", "ChapterSummary.tsx"), "utf8");
  assert.match(summary, /pickSceneForNovelScene/, "章节阅读应按场景文本匹配背景");
  const setup = readFileSync(join(process.cwd(), "components", "life", "ProtagonistSetup.tsx"), "utf8");
  assert.match(setup, /visualIdentity/, "主角创建必须携带视觉身份");
  assert.match(setup, /TALENT_BUDGET/, "天赋预算必须存在");
});
