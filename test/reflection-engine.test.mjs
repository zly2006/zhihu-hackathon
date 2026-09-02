import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// 运行：先 node scripts/test-all.mjs（统一编译 lib 到 .tmp/test-all）
const base = process.env.REFLECTION_TEST_DIR || ".tmp/test-all";
async function load(rel) {
  return import(new URL(`../${base}/${rel}`, import.meta.url).href);
}

const now = "2026-09-02T00:00:00.000Z";

function makeCharacter(id, name, opts = {}) {
  return {
    id,
    role: id === "hero" ? "protagonist" : "npc",
    identity: { name, birthYear: 1998, gender: "男", hometown: "", familyBackground: "" },
    core: { personalityTraits: ["谨慎"], values: ["稳定"], talents: { insight: 50, charm: 50, grit: 50, learning: 50, luck: 50 }, hooks: [] },
    state: {
      age: 28,
      year: 2026,
      city: "深圳",
      occupation: "程序员",
      socialIdentity: "程序员",
      stats: { cash: 50, health: 70, happiness: 60, knowledge: 50, connections: 40, career: 60, assets: 30 },
      currentGoals: [
        { id: "g1", label: "立足大城市", horizon: "long", priority: 70, status: "active" },
        { id: "g2", label: "回老家考编", horizon: "medium", priority: 40, status: "active" },
        { id: "g3", label: "旧目标", horizon: "short", priority: 30, status: "abandoned" },
      ],
      currentDilemmas: [],
      attitudes: {},
    },
    privateState: {
      hiddenGoals: ["攒够首付再谈婚嫁"],
      hiddenConcerns: ["担心你在深圳撑不住"],
      privateBeliefs: ["稳定比高薪重要"],
    },
    memoryIds: [],
    createdAt: now,
    updatedAt: now,
    ...opts,
  };
}

function makeWorld(opts = {}) {
  const world = {
    schemaVersion: 1,
    gameId: "g1",
    currentYear: 2026,
    protagonistId: "hero",
    characters: {
      hero: makeCharacter("hero", "张明", { privateState: undefined }),
      npc1: makeCharacter("npc1", "林雨"),
      npc2: makeCharacter("npc2", "王浩"),
      npc3: makeCharacter("npc3", "周凯"),
    },
    relationships: {
      r1: { id: "r1", characterAId: "hero", characterBId: "npc1", type: "partner", scores: { closeness: 60, trust: 50, conflict: 20, commitment: 50 }, publicSummary: "恋人", unresolvedIssues: [], milestoneEventIds: [], status: "active", updatedAt: now },
    },
    memories: {},
    chapterIds: [],
    eraContext: null,
    openThreads: [],
    canonicalEventIds: [],
    updatedAt: now,
    ...opts,
  };
  return world;
}

function makeEvents() {
  return [
    {
      id: "e1",
      chapterId: "ch1",
      year: 2026,
      month: 3,
      order: 1,
      title: "裁员风波",
      summary: "公司裁员，你留了下来。",
      domain: "career",
      participantIds: ["hero", "npc1"],
      causes: [],
      characterChanges: [],
      relationshipChanges: [{ relationshipId: "r1", scoreDelta: { trust: -10 }, description: "两人对未来产生分歧" }],
      evidenceIds: [],
      importance: 85,
      visibility: "known_to_protagonist",
      createsThreadIds: [],
      resolvesThreadIds: [],
    },
  ];
}

test("候选人：仅私密状态角色 + 事件参与/关系变化，cap 4", async () => {
  const { collectReflectionCandidates } = await load("game/reflection-engine.js");
  const world = makeWorld();
  const candidates = collectReflectionCandidates({
    worldBefore: world,
    events: makeEvents(),
    newMemories: [],
  });
  const ids = candidates.map((c) => c.characterId);
  assert.ok(ids.includes("npc1"), "npc1 参与事件且关系变化");
  assert.ok(!ids.includes("hero"), "主角无 privateState 应排除");
  assert.ok(!ids.includes("npc2"), "未受影响角色应排除");
  assert.ok(candidates.length <= 4);
});

test("候选人：高重要度记忆触发反思（阈值 70）", async () => {
  const { collectReflectionCandidates } = await load("game/reflection-engine.js");
  const world = makeWorld();
  const candidates = collectReflectionCandidates({
    worldBefore: world,
    events: [],
    newMemories: [
      { id: "m1", characterId: "npc2", year: 2026, summary: "目睹挚友离开", importance: 85 },
      { id: "m2", characterId: "npc3", year: 2026, summary: "普通日常", importance: 20 },
    ],
  });
  const ids = candidates.map((c) => c.characterId);
  assert.ok(ids.includes("npc2"));
  assert.ok(!ids.includes("npc3"));
});

test("parse：非法 goalId / 非法 emotionalTrend / 越界记忆 被拒绝", async () => {
  const { buildReflectionContext, parseReflections } = await load("game/reflection-engine.js");
  const worldAfter = makeWorld({
    memories: { m1: { id: "m1", characterId: "npc1", year: 2026, summary: "裁员后的对话", importance: 60 } },
  });
  const { context } = buildReflectionContext({
    chapterId: "ch1",
    year: 2027,
    worldBefore: makeWorld(),
    worldAfter,
    events: makeEvents(),
  });
  assert.ok(context, "有候选人时上下文应存在");
  const base = {
    characterId: "npc1",
    basedOnMemoryIds: ["m1"],
    insight: "开始认真考虑离开",
    beliefChanges: [{ topic: "城市选择", to: "老家的稳定更有吸引力", strength: 60 }],
    goalPressure: [{ goalId: "g2", direction: "increase", amount: 15, reason: "裁员后对稳定更渴望" }],
    emotionalTrend: "anxious",
  };
  assert.equal(parseReflections({ reflections: [base] }, context).length, 1);
  assert.throws(() => parseReflections({ reflections: [{ ...base, goalId: undefined, goalPressure: [{ goalId: "gX", direction: "increase", amount: 10, reason: "" }] }] }, context), /非 active 目标/);
  assert.throws(() => parseReflections({ reflections: [{ ...base, emotionalTrend: "happy" }] }, context), /emotionalTrend 非法/);
  assert.throws(() => parseReflections({ reflections: [{ ...base, basedOnMemoryIds: ["mx"] }] }, context), /不存在记忆/);
  assert.throws(() => parseReflections({ reflections: [{ ...base, goalPressure: [{ goalId: "g3", direction: "increase", amount: 5, reason: "" }] }] }, context), /非 active 目标/);
});

test("apply：优先级 clamp、信念追加、趋势与 reflectionIds 更新、旧存档兼容", async () => {
  const { applyReflections } = await load("game/reflection-engine.js");
  const worldAfter = makeWorld({ memories: { m1: { id: "m1", characterId: "npc1", year: 2026, summary: "对话", importance: 60 } } });
  const reflection = {
    id: "ref-1",
    characterId: "npc1",
    chapterId: "ch1",
    year: 2027,
    basedOnMemoryIds: ["m1"],
    insight: "决定更认真考虑回老家",
    beliefChanges: [{ topic: "城市选择", to: "老家的稳定更有吸引力", strength: 60 }],
    goalPressure: [
      { goalId: "g1", direction: "decrease", amount: 25, reason: "动摇" },
      { goalId: "g2", direction: "increase", amount: 35, reason: "更渴望稳定" },
    ],
    emotionalTrend: "anxious",
    private: true,
  };
  const next = applyReflections(worldAfter, [reflection], now);
  assert.equal(next.schemaVersion, 1, "schemaVersion 保持 1");
  const npc1 = next.characters.npc1;
  assert.equal(npc1.state.currentGoals.find((g) => g.id === "g1").priority, 45, "70-25=45");
  assert.equal(npc1.state.currentGoals.find((g) => g.id === "g2").priority, 75, "40+35 clamp 至 75");
  assert.equal(npc1.state.currentGoals.find((g) => g.id === "g3").status, "abandoned", "非 active 目标不动");
  assert.equal(npc1.privateState.currentEmotionalTrend, "anxious");
  assert.deepEqual(npc1.privateState.reflectionIds, ["ref-1"]);
  assert.ok(npc1.privateState.privateBeliefs.includes("老家的稳定更有吸引力"));
  assert.equal(next.reflections["ref-1"].id, "ref-1");
  assert.ok(next.characters.hero.privateState === undefined);
  // 旧存档（无 reflections 字段）也能应用
  const legacy = makeWorld();
  delete legacy.reflections;
  const appliedLegacy = applyReflections(legacy, [reflection], now);
  assert.equal(appliedLegacy.reflections["ref-1"].characterId, "npc1");
});

test("Prompt 防膨胀：既往反思只取最近 2 条且单条截断", async () => {
  const { buildReflectionContext, buildReflectionPrompt, MAX_PRIOR_REFLECTIONS_PER_CHARACTER } = await load("game/reflection-engine.js");
  const worldBefore = makeWorld({
    reflections: {
      r1: { id: "r1", characterId: "npc1", chapterId: "c0", year: 2025, basedOnMemoryIds: [], insight: "A".repeat(300), beliefChanges: [], goalPressure: [], emotionalTrend: "stable", private: true },
      r2: { id: "r2", characterId: "npc1", chapterId: "c1", year: 2026, basedOnMemoryIds: [], insight: "第二条", beliefChanges: [], goalPressure: [], emotionalTrend: "anxious", private: true },
      r3: { id: "r3", characterId: "npc1", chapterId: "c2", year: 2026, basedOnMemoryIds: [], insight: "第三条", beliefChanges: [], goalPressure: [], emotionalTrend: "withdrawn", private: true },
    },
  });
  const { context } = buildReflectionContext({
    chapterId: "ch9",
    year: 2028,
    worldBefore,
    worldAfter: makeWorld({ memories: { m1: { id: "m1", characterId: "npc1", year: 2026, summary: "x", importance: 60 } } }),
    events: makeEvents(),
  });
  assert.ok(context);
  const digest = context.priorReflectionDigest["npc1"];
  assert.ok(!digest.includes("第一条") && !digest.includes("A".repeat(200)), "只取最近 2 条且截断");
  assert.ok(digest.includes("第二条") && digest.includes("第三条"));
  const prompt = buildReflectionPrompt(context);
  assert.ok(prompt.length < 6000, "Prompt 不应随历史无限增长");
  assert.ok(MAX_PRIOR_REFLECTIONS_PER_CHARACTER === 2);
});

test("私有性：render_game_to_text 只含反思计数，不泄漏内容", () => {
  const lifeApp = readFileSync(join(process.cwd(), "components", "life", "LifeApp.tsx"), "utf8");
  assert.match(lifeApp, /reflectionCount/, "应有 reflectionCount");
  assert.doesNotMatch(lifeApp, /beliefChanges.*save|insight.*save|hiddenGoals.*render/, "不得把反思/私有字段输出到测试接口");
  assert.match(lifeApp, /\/api\/chapter\/reflections/, "LifeApp 必须调用独立反思端点");
  assert.match(lifeApp, /reflection fallback/, "反思失败必须降级不阻断");
  assert.match(lifeApp, /Promise\.all\(/, "规划与反思必须并行调用（缩短章节生成时长）");
  const reflectionsRoute = readFileSync(join(process.cwd(), "app", "api", "chapter", "reflections", "route.ts"), "utf8");
  assert.match(reflectionsRoute, /runReflectionBatch/, "reflections 端点必须运行反思批次");
  assert.match(reflectionsRoute, /applyReflections/, "reflections 端点必须应用反思结果");
  const simulateRoute = readFileSync(join(process.cwd(), "app", "api", "chapter", "simulate", "route.ts"), "utf8");
  assert.doesNotMatch(simulateRoute, /runReflectionBatch/, "simulate 不应再串行运行反思（已拆出并行）");
  const world = readFileSync(join(process.cwd(), "lib", "domain", "world.ts"), "utf8");
  assert.match(world, /reflections\?:/, "WorldState 应有可选 reflections 字段");
  assert.match(world, /schemaVersion: 1/, "schemaVersion 保持 1");
});
