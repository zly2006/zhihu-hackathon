import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// 编译：npx tsc --outDir .tmp/narrative-test --module commonjs --moduleResolution node --target es2022 lib/domain/narrative.ts lib/narrative/need-builder.ts lib/narrative/query-adapter.ts lib/narrative/retriever.ts lib/narrative/validator.ts lib/narrative/aliases.ts
// 运行：node --test test/narrative-engine.test.mjs

const base = process.env.NARRATIVE_TEST_DIR || ".tmp/narrative-test";
async function load(rel) {
  return import(new URL(`../${base}/${rel}`, import.meta.url).href);
}

const now = "2026-09-02T00:00:00.000Z";

function makeCharacter(id, name, extra = {}) {
  return {
    id,
    role: id === "hero" ? "protagonist" : "npc",
    identity: { name, birthYear: 2008, gender: "男", hometown: "", familyBackground: "" },
    core: {
      personalityTraits: ["谨慎"],
      values: ["稳定"],
      talents: { insight: 50, charm: 50, grit: 50, learning: 50, luck: 50 },
      hooks: [],
    },
    state: {
      age: 28,
      year: 2026,
      city: "深圳",
      occupation: "程序员",
      socialIdentity: "程序员",
      stats: { cash: 50, health: 70, happiness: 60, knowledge: 50, connections: 40, career: 60, assets: 30 },
      currentGoals: [],
      currentDilemmas: [],
      attitudes: {},
    },
    memoryIds: [],
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

function makeEvents() {
  return [
    {
      id: "evt-1",
      chapterId: "ch-1",
      year: 2026,
      month: 3,
      order: 1,
      title: "公司裁员波及团队",
      summary: "公司业务收缩，你的团队被裁掉一半，你留了下来但开始怀疑方向。",
      domain: "career",
      participantIds: ["hero", "npc-1"],
      causes: [{ type: "other", description: "行业下行" }],
      characterChanges: [{ characterId: "hero", description: "对职业稳定性产生怀疑" }],
      relationshipChanges: [{ relationshipId: "rel-1", scoreDelta: { trust: -5 }, description: "同事关系出现裂痕" }],
      evidenceIds: [],
      importance: 85,
      visibility: "known_to_protagonist",
      createsThreadIds: [],
      resolvesThreadIds: [],
    },
    {
      id: "evt-2",
      chapterId: "ch-1",
      year: 2026,
      month: 9,
      order: 2,
      title: "收到外地 offer",
      summary: "一家新公司开出更高薪资，但需要离开深圳。",
      domain: "relocation",
      participantIds: ["hero"],
      causes: [{ type: "player_choice", description: "你此前的选择带来了这个机会" }],
      characterChanges: [{ characterId: "hero", description: "面临城市选择" }],
      relationshipChanges: [],
      evidenceIds: [],
      importance: 75,
      visibility: "known_to_protagonist",
      createsThreadIds: [],
      resolvesThreadIds: [],
    },
  ];
}

function makeWorld() {
  return {
    schemaVersion: 1,
    gameId: "game-1",
    currentYear: 2026,
    protagonistId: "hero",
    characters: {
      hero: makeCharacter("hero", "张明"),
      "npc-1": makeCharacter("npc-1", "林雨", {
        privateState: { hiddenGoals: ["打算跳槽回老家"], hiddenConcerns: ["担心你离开深圳"], privateBeliefs: ["认为稳定比高薪重要"] },
      }),
    },
    relationships: {
      "rel-1": {
        id: "rel-1",
        characterAId: "hero",
        characterBId: "npc-1",
        type: "partner",
        scores: { closeness: 60, trust: 55, conflict: 20, commitment: 50 },
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
}

function makeDecision() {
  return {
    id: "d-1",
    promptTitle: "留在深圳还是去外地",
    context: "公司动荡，外地 offer 出现。",
    options: [
      { id: "A", label: "留在深圳", description: "维持现状", strategyTag: "保守", estimatedRisk: 30, stateFit: "可行" },
      { id: "B", label: "接受 offer", description: "离开深圳", strategyTag: "激进", estimatedRisk: 60, stateFit: "吃力" },
      { id: "C", label: "观望", description: "再等等", strategyTag: "观望", estimatedRisk: 40, stateFit: "可行" },
    ],
    selectedOptionId: "B",
    customAction: undefined,
    normalizedAction: "接受 offer",
  };
}

test("need-builder：从 canonical 事件与决策推导 NarrativeNeed", async () => {
  const { buildNarrativeNeed } = await load("narrative/need-builder.js");
  const need = buildNarrativeNeed({
    chapterId: "ch-1",
    span: 1,
    world: makeWorld(),
    events: makeEvents(),
    decision: makeDecision(),
  });
  assert.deepEqual(need.lifeDomains, ["career", "relocation"]);
  assert.ok(need.centralEvents.includes("公司裁员波及团队"));
  assert.deepEqual(need.relationshipTypes, ["partner"]);
  assert.ok(need.conflictTypes.includes("保守") && need.conflictTypes.includes("激进"));
  assert.ok(need.narrativeFunctions.includes("hook"));
});

test("retriever：真实 KB 检索返回带 fragmentId 的参考（KB 可用）", async () => {
  const { retrieveNarrativeEvidence, bundleFragmentIds } = await load("narrative/retriever.js");
  const { buildNarrativeNeed } = await load("narrative/need-builder.js");
  const need = buildNarrativeNeed({
    chapterId: "ch-1",
    span: 1,
    world: makeWorld(),
    events: makeEvents(),
    decision: makeDecision(),
  });
  const bundle = retrieveNarrativeEvidence(need);
  assert.ok(bundle.total > 0, `KB 应可检索（实际 ${bundle.total}）`);
  const all = [
    ...bundle.arcPatterns,
    ...bundle.scenePatterns,
    ...bundle.dialoguePatterns,
    ...bundle.pacingPatterns,
    ...bundle.endingPatterns,
  ];
  for (const reference of all) {
    assert.ok(reference.fragmentId, "每个参考必须有 fragmentId");
    assert.ok(typeof reference.qualityScore === "number");
    assert.ok(reference.similarity >= 0);
  }
  assert.equal(bundleFragmentIds(bundle).size, bundle.total, "bundle.total 应等于去重后的参考数");
});

test("validator：合法计划通过", async () => {
  const { validateNarrativePlan } = await load("narrative/validator.js");
  const world = makeWorld();
  const plan = {
    version: 1,
    titleDirection: "裁员之后",
    theme: "动荡中重新确认什么值得坚持",
    emotionalCore: "不安但清醒",
    mainConflict: "职业安全感与亲密关系的拉扯",
    characterArcs: [],
    scenes: [
      {
        id: "scene-1", order: 1, timeLabel: "2026.03", location: "公司",
        participantIds: ["hero", "npc-1"], povCharacterId: "hero", sourceEventIds: ["evt-1"],
        purpose: "conflict", visibleGoal: "弄清楚裁员名单", conflict: "名单未公布的不安",
        startEmotion: "不安", endEmotion: "暂时松一口气", mustShow: ["裁员发生"], mustNotInvent: ["具体裁员原因"],
        narrativeTechniques: [], endingBeat: "楼道里安静得反常",
      },
      {
        id: "scene-2", order: 2, timeLabel: "2026.06", location: "家中",
        participantIds: ["hero", "npc-1"], povCharacterId: "hero", sourceEventIds: ["evt-1"],
        purpose: "development", visibleGoal: "商量下一步", conflict: "两人对未来的分歧",
        startEmotion: "平静", endEmotion: "低气压", mustShow: ["沟通"], mustNotInvent: [],
        narrativeTechniques: [], endingBeat: "晚饭吃到一半冷了",
      },
      {
        id: "scene-3", order: 3, timeLabel: "2026.09", location: "新公司楼下",
        participantIds: ["hero"], povCharacterId: "hero", sourceEventIds: ["evt-2"],
        purpose: "turning_point", visibleGoal: "面对 offer 做决定", conflict: "离开还是留下",
        startEmotion: "犹豫", endEmotion: "下定决心", mustShow: ["offer 已到"], mustNotInvent: [],
        narrativeTechniques: [], endingBeat: "手机里未发出的消息",
      },
      {
        id: "scene-4", order: 4, timeLabel: "2026.12", location: "火车站",
        participantIds: ["hero", "npc-1"], povCharacterId: "hero", sourceEventIds: ["evt-2"],
        purpose: "hook", visibleGoal: "送别", conflict: "未说出口的话",
        startEmotion: "沉默", endEmotion: "余味", mustShow: ["离开"], mustNotInvent: [],
        narrativeTechniques: [], endingBeat: "列车开走后站台空了",
      },
    ],
    endingHook: { textGoal: "留下未解的问题", type: "relationship_tension" },
    referenceFragmentIds: [],
    canonicalEventIds: ["evt-1", "evt-2"],
  };
  const result = validateNarrativePlan({
    plan, need: { chapterId: "ch-1", lifeDomains: ["career"] },
    bundle: { querySummary: "", arcPatterns: [], scenePatterns: [], dialoguePatterns: [], pacingPatterns: [], endingPatterns: [], total: 0 },
    world, events: makeEvents(), span: 1, startYear: 2026, endYear: 2027,
  });
  assert.equal(result.valid, true, result.errors.join("；"));
});

test("validator：违规计划逐条命中硬校验", async () => {
  const { validateNarrativePlan } = await load("narrative/validator.js");
  const world = makeWorld();
  const events = makeEvents();
  const basePlan = {
    version: 1,
    titleDirection: "x",
    theme: "主题",
    emotionalCore: "情绪",
    mainConflict: "主冲突",
    characterArcs: [],
    scenes: [
      {
        id: "scene-1", order: 1, timeLabel: "2026.03", location: "公司",
        participantIds: ["hero"], povCharacterId: "hero", sourceEventIds: [],
        purpose: "development", visibleGoal: "目标", conflict: "冲突",
        startEmotion: "a", endEmotion: "b", mustShow: [], mustNotInvent: [],
        narrativeTechniques: [], endingBeat: "结尾",
      },
      {
        id: "scene-2", order: 2, timeLabel: "2026.05", location: "家中",
        participantIds: ["hero"], povCharacterId: "hero", sourceEventIds: ["evt-1"],
        purpose: "development", visibleGoal: "目标", conflict: "冲突",
        startEmotion: "a", endEmotion: "b", mustShow: [], mustNotInvent: [],
        narrativeTechniques: [], endingBeat: "结尾",
      },
    ],
    endingHook: { textGoal: "余味", type: "relationship_tension" },
    referenceFragmentIds: ["frag-999"],
    canonicalEventIds: ["evt-1", "evt-3"],
  };
  const result = validateNarrativePlan({
    plan: basePlan, need: { chapterId: "ch-1", lifeDomains: ["career"] },
    bundle: { querySummary: "", arcPatterns: [], scenePatterns: [], dialoguePatterns: [], pacingPatterns: [], endingPatterns: [], total: 0 },
    world, events, span: 1, startYear: 2026, endYear: 2027,
  });
  const text = result.errors.join("；");
  assert.ok(result.errors.some((e) => e.includes("sourceEventIds 为空")), "场景 sourceEventIds 空应报错");
  assert.ok(result.errors.some((e) => e.includes("本章之外的事件")), "canonicalEventIds 越界应报错");
  assert.ok(result.errors.some((e) => e.includes("场景数")), "场景数超范围应报错");
  assert.ok(result.errors.some((e) => e.includes("conflict / turning_point / climax")), "缺冲突场景应报错");
  assert.ok(result.errors.some((e) => e.includes("非本 bundle")), "referenceFragmentIds 越界应报错");
});

test("validator：privateState 泄漏被拦截", async () => {
  const { validateNarrativePlan } = await load("narrative/validator.js");
  const world = makeWorld();
  const events = makeEvents();
  const plan = {
    version: 1,
    titleDirection: "x",
    theme: "主题",
    emotionalCore: "情绪",
    mainConflict: "主冲突",
    characterArcs: [],
    scenes: [
      {
        id: "scene-1", order: 1, timeLabel: "2026.03", location: "公司",
        participantIds: ["hero"], povCharacterId: "hero", sourceEventIds: ["evt-1"],
        purpose: "conflict", visibleGoal: "目标", conflict: "你知道林雨打算跳槽回老家",
        startEmotion: "a", endEmotion: "b", mustShow: [], mustNotInvent: [],
        narrativeTechniques: [], endingBeat: "结尾",
      },
      {
        id: "scene-2", order: 2, timeLabel: "2026.05", location: "家中",
        participantIds: ["hero"], povCharacterId: "hero", sourceEventIds: ["evt-1"],
        purpose: "development", visibleGoal: "目标", conflict: "冲突",
        startEmotion: "a", endEmotion: "b", mustShow: [], mustNotInvent: [],
        narrativeTechniques: [], endingBeat: "结尾",
      },
      {
        id: "scene-3", order: 3, timeLabel: "2026.09", location: "车站",
        participantIds: ["hero"], povCharacterId: "hero", sourceEventIds: ["evt-2"],
        purpose: "climax", visibleGoal: "目标", conflict: "冲突",
        startEmotion: "a", endEmotion: "b", mustShow: [], mustNotInvent: [],
        narrativeTechniques: [], endingBeat: "结尾",
      },
    ],
    endingHook: { textGoal: "余味", type: "quiet_aftershock" },
    referenceFragmentIds: [],
    canonicalEventIds: ["evt-1", "evt-2"],
  };
  const result = validateNarrativePlan({
    plan, need: { chapterId: "ch-1", lifeDomains: ["career"] },
    bundle: { querySummary: "", arcPatterns: [], scenePatterns: [], dialoguePatterns: [], pacingPatterns: [], endingPatterns: [], total: 0 },
    world, events, span: 1, startYear: 2026, endYear: 2027,
  });
  assert.ok(result.errors.some((e) => e.includes("泄漏")), result.errors.join("；"));
});

test("页面契约：LifeApp 先规划后写小说，Chapter 带可选 narrative", () => {
  const lifeApp = readFileSync(join(process.cwd(), "components", "life", "LifeApp.tsx"), "utf8");
  assert.match(lifeApp, /\/api\/chapter\/narrative-plan/, "LifeApp 必须调用 narrative-plan 端点");
  assert.match(lifeApp, /narrative plan fallback/, "Director 失败必须降级不阻断");
  assert.match(lifeApp, /narrativePlan/, "fetchNovel 必须携带 narrativePlan");
  const chapter = readFileSync(join(process.cwd(), "lib", "domain", "chapter.ts"), "utf8");
  assert.match(chapter, /narrative\?:/, "Chapter 必须有可选 narrative 字段");
  assert.match(chapter, /schemaVersion: 1/, "GameSave schemaVersion 保持 1");
  const novelRoute = readFileSync(join(process.cwd(), "app", "api", "chapter", "novel", "route.ts"), "utf8");
  assert.match(novelRoute, /narrativePlan/, "novel 端点必须接收 narrativePlan");
  const planRoute = readFileSync(join(process.cwd(), "app", "api", "chapter", "narrative-plan", "route.ts"), "utf8");
  assert.match(planRoute, /runNarrativeEngine/, "narrative-plan 端点必须走 engine 编排");
});

test("代号映射：E/C 代号还原真实 id，真实 id 透传", async () => {
  const { buildAliasTables, resolvePlanAliases, eventLabelFor, characterLabelFor } = await load("narrative/aliases.js");
  const world = makeWorld();
  const events = makeEvents();
  const tables = buildAliasTables(events, world);
  assert.equal(tables.eventAliasToId.get("E1"), "evt-1");
  assert.equal(tables.characterAliasToId.get("C1"), "hero");
  assert.equal(tables.characterAliasToId.get("C2"), "npc-1");
  const plan = {
    version: 1,
    titleDirection: "x", theme: "t", emotionalCore: "e", mainConflict: "c",
    characterArcs: [{ characterId: "C2", startState: "a", pressure: "b", change: "c", endState: "d" }],
    scenes: [{
      id: "scene-1", order: 1, timeLabel: "2026.03", location: "家",
      participantIds: ["C1", "hero"], povCharacterId: "C1", sourceEventIds: ["E1", "evt-2"],
      purpose: "setup", visibleGoal: "g", conflict: "c", startEmotion: "a", endEmotion: "b",
      mustShow: [], mustNotInvent: [], narrativeTechniques: [], endingBeat: "x",
    }],
    endingHook: { textGoal: "h", type: "quiet_aftershock" },
    referenceFragmentIds: [],
    canonicalEventIds: ["E2", "evt-1"],
  };
  const resolved = resolvePlanAliases(plan, tables);
  assert.equal(resolved.scenes[0].povCharacterId, "hero");
  assert.deepEqual(resolved.scenes[0].participantIds, ["hero"]);
  assert.deepEqual(resolved.scenes[0].sourceEventIds, ["evt-1", "evt-2"]);
  assert.equal(resolved.characterArcs[0].characterId, "npc-1");
  assert.deepEqual(resolved.canonicalEventIds, ["evt-2", "evt-1"]);
  assert.ok(eventLabelFor(events).includes("E1="));
  assert.ok(characterLabelFor(world).includes("C1=张明(主角)"));
});
