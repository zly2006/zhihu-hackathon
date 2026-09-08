import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const base = process.env.V31_V32_TEST_DIR || ".tmp/test-all";

async function load(rel) {
  return import(new URL(`../${base}/${rel}`, import.meta.url).href);
}

const now = "2026-09-03T00:00:00.000Z";

function character(id, name, role = "npc", options = {}) {
  return {
    id,
    role,
    identity: { name, birthYear: 1998, gender: "未知", hometown: "", familyBackground: "" },
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
      stats: { cash: 45, health: 70, happiness: 55, knowledge: 50, connections: 40, career: 50, assets: 20 },
      currentGoals: role === "npc"
        ? [{ id: `${id}-goal`, label: "保持生活稳定", horizon: "medium", priority: 72, status: "active" }]
        : [{ id: `${id}-goal`, label: "继续生活", horizon: "long", priority: 80, status: "active" }],
      currentDilemmas: [],
      attitudes: {},
    },
    privateState: role === "npc"
      ? {
          hiddenGoals: ["攒够首付再谈婚嫁"],
          hiddenConcerns: ["担心关系和职业同时失控"],
          privateBeliefs: ["稳定比高薪重要"],
          currentEmotionalTrend: "anxious",
        }
      : undefined,
    memoryIds: [],
    createdAt: now,
    updatedAt: now,
    ...options,
  };
}

function world(options = {}) {
  const baseWorld = {
    schemaVersion: 1,
    gameId: "v3-test",
    currentYear: 2026,
    protagonistId: "hero",
    characters: {
      hero: character("hero", "张明", "protagonist"),
      npc1: character("npc1", "林雨"),
      npc2: character("npc2", "王浩", "npc", {
        privateState: {
          hiddenGoals: ["扩大自己的业务"],
          hiddenConcerns: ["担心错过机会"],
          privateBeliefs: ["机会稍纵即逝"],
          currentEmotionalTrend: "hopeful",
        },
      }),
      npc3: character("npc3", "周凯"),
      npc4: character("npc4", "赵宁"),
    },
    relationships: {
      rel1: {
        id: "rel1",
        characterAId: "hero",
        characterBId: "npc1",
        type: "partner",
        scores: { closeness: 68, trust: 34, conflict: 78, commitment: 62 },
        publicSummary: "正在磨合的恋人",
        unresolvedIssues: [{ id: "issue1", description: "城市与未来安排没有谈妥", severity: 70, introducedAtChapterId: "c0" }],
        milestoneEventIds: [],
        status: "active",
        updatedAt: now,
      },
      rel2: {
        id: "rel2",
        characterAId: "hero",
        characterBId: "npc2",
        type: "friend",
        scores: { closeness: 45, trust: 55, conflict: 20, commitment: 30 },
        publicSummary: "老同学",
        unresolvedIssues: [],
        milestoneEventIds: [],
        status: "active",
        updatedAt: now,
      },
    },
    memories: {},
    chapterIds: [],
    eraContext: null,
    openThreads: [
      { id: "thread1", label: "去留谈判", description: "两人需要决定是否继续留在同一座城市", domain: "relocation", relatedCharacterIds: ["hero", "npc1"], urgency: 86, status: "open" },
      { id: "thread2", label: "业务机会", description: "朋友提供了一个不确定的合作机会", domain: "career", relatedCharacterIds: ["hero", "npc2"], urgency: 48, status: "open" },
    ],
    canonicalEventIds: [],
    updatedAt: now,
  };
  return { ...baseWorld, ...options };
}

function decision() {
  return {
    id: "decision1",
    promptTitle: "留在深圳还是换城市",
    context: "工作与亲密关系都需要重新安排。",
    options: [
      { id: "A", label: "留在深圳", description: "维持现状", strategyTag: "保守", estimatedRisk: 35, stateFit: "可行" },
      { id: "B", label: "接受外地机会", description: "离开深圳", strategyTag: "激进", estimatedRisk: 65, stateFit: "吃力" },
      { id: "C", label: "暂时观望", description: "再谈一轮", strategyTag: "观望", estimatedRisk: 45, stateFit: "可行" },
    ],
    selectedOptionId: "B",
    normalizedAction: "接受外地机会",
  };
}

function events() {
  return [
    {
      id: "event1",
      chapterId: "c1",
      year: 2026,
      month: 3,
      order: 1,
      title: "去留谈判",
      summary: "主角的选择让两人必须重新讨论未来安排。",
      domain: "relocation",
      participantIds: ["hero", "npc1"],
      causes: [{ type: "npc_goal", refId: "npc1-goal", description: "林雨想把关系和生活稳定下来" }],
      characterChanges: [],
      relationshipChanges: [{ relationshipId: "rel1", scoreDelta: { conflict: 8 }, description: "去留分歧再次浮现" }],
      evidenceIds: [],
      importance: 82,
      visibility: "known_to_protagonist",
      createsThreadIds: [],
      resolvesThreadIds: [],
    },
    {
      id: "event2",
      chapterId: "c1",
      year: 2027,
      month: 1,
      order: 2,
      title: "新的工作安排",
      summary: "一个现实的工作机会出现，但仍有代价。",
      domain: "career",
      participantIds: ["hero"],
      causes: [{ type: "player_choice", description: "玩家此前的选择带来后续机会" }],
      characterChanges: [],
      relationshipChanges: [],
      evidenceIds: [],
      importance: 62,
      visibility: "known_to_protagonist",
      createsThreadIds: [],
      resolvesThreadIds: [],
    },
  ];
}

test("V3.1: NPC Agent 按关系/目标压力生成稳定自主驱动且不修改 WorldState", async () => {
  const { planNpcAgentDirectives } = await load("game/npc-agent.js");
  const before = JSON.stringify(world());
  const directives = planNpcAgentDirectives({
    chapterId: "c1",
    world: world(),
    decision: decision(),
    startYear: 2026,
    endYear: 2027,
  });

  assert.ok(directives.length > 0);
  assert.ok(directives.length <= 3);
  assert.equal(directives[0].characterId, "npc1");
  assert.ok(["contact_player", "negotiate_relationship"].includes(directives[0].action));
  assert.ok(directives[0].targetCharacterIds.includes("hero"));
  assert.ok(directives[0].relationshipIds.includes("rel1"));
  assert.ok(directives[0].urgency >= 0 && directives[0].urgency <= 100);
  assert.ok(directives[0].privateIntent.includes("首付"));
  assert.equal(JSON.stringify(world()), before);
});

test("V3.1: NPC Agent 最多选择 3 个、排序可重现且公开 trace 不泄漏私密意图", async () => {
  const { planNpcAgentDirectives, toPublicNpcAgentTrace } = await load("game/npc-agent.js");
  const input = { chapterId: "c1", world: world(), decision: decision(), startYear: 2026, endYear: 2027 };
  const first = planNpcAgentDirectives(input);
  const second = planNpcAgentDirectives(input);
  assert.deepEqual(first, second);
  assert.equal(first.length, 3);
  assert.ok(first.every((item, index) => index === 0 || item.urgency <= first[index - 1].urgency));
  const publicTrace = first.map(toPublicNpcAgentTrace);
  assert.ok(!JSON.stringify(publicTrace).includes("首付"));
  assert.ok(!JSON.stringify(publicTrace).includes("错过机会"));
  assert.ok(publicTrace.every((item) => !("privateIntent" in item)));
});

test("V3.1: World Simulator 与章节路由消费 NPC Agent，但不建立后台常驻循环", () => {
  const simulator = readFileSync(join(root, "lib", "game", "world-simulator.ts"), "utf8");
  const simulateRoute = readFileSync(join(root, "app", "api", "chapter", "simulate", "route.ts"), "utf8");
  const simulationService = readFileSync(join(root, "lib", "game", "chapter-simulation-service.ts"), "utf8");
  const simulationDomain = readFileSync(join(root, "lib", "domain", "simulation.ts"), "utf8");
  assert.match(simulationDomain, /npcAgentDirectives\?:/);
  assert.match(simulator, /NPC Agent/);
  assert.match(simulator, /非后台|本章一次/);
  assert.match(simulateRoute, /runChapterSimulation/);
  assert.match(simulationService, /planNpcAgentDirectives/);
  assert.match(simulationService, /npcAgentDirectives/);
  assert.doesNotMatch(simulateRoute, /setInterval|setTimeout.*npc/i);
});

test("V3.2: Director Brief 从 NPC 事件、关系压力和开放线索推导下一幕焦点", async () => {
  const { buildNarrativeDirectorBrief } = await load("game/narrative-director.js");
  const brief = buildNarrativeDirectorBrief({
    chapterId: "c1",
    world: world(),
    events: events(),
    decision: decision(),
    span: 1,
    startYear: 2026,
    endYear: 2027,
  });

  assert.equal(brief.trigger, "npc_goal");
  assert.equal(brief.focusCharacterId, "npc1");
  assert.deepEqual(brief.focusEventIds, ["event1"]);
  assert.deepEqual(brief.focusThreadIds, ["thread1"]);
  assert.equal(brief.tensionLevel, "high");
  assert.match(brief.dramaticQuestion, /关系|代价|未来/);
  assert.ok(!JSON.stringify(brief).includes("首付"));
  assert.ok(!JSON.stringify(brief).includes("同时失控"));
});

test("V3.2: 无特殊事件时 Director Brief 有稳定兜底，且 Planner Prompt 消费 Brief", async () => {
  const { buildNarrativeDirectorBrief } = await load("game/narrative-director.js");
  const { buildDirectorPrompt } = await load("narrative/planner.js");
  const fallback = buildNarrativeDirectorBrief({
    chapterId: "c2",
    world: world({ openThreads: [] }),
    events: [events()[1]],
    decision: decision(),
    span: 1,
    startYear: 2027,
    endYear: 2028,
  });
  assert.equal(fallback.focusCharacterId, "hero");
  assert.equal(fallback.trigger, "player_choice");
  assert.equal(fallback.tensionLevel, "rising");

  const prompt = buildDirectorPrompt({
    need: {
      chapterId: "c1",
      lifeDomains: ["relocation"],
      relationshipTypes: ["partner"],
      centralEvents: ["去留谈判"],
      conflictTypes: ["激进"],
      desiredTone: "克制",
      narrativeFunctions: ["setup", "conflict", "hook"],
    },
    bundle: { querySummary: "", arcPatterns: [], scenePatterns: [], dialoguePatterns: [], pacingPatterns: [], endingPatterns: [], total: 0 },
    info: { world: world(), events: events(), decision: decision(), span: 1, startYear: 2026, endYear: 2027 },
    directorBrief: buildNarrativeDirectorBrief({ chapterId: "c1", world: world(), events: events(), decision: decision(), span: 1, startYear: 2026, endYear: 2027 }),
  });
  assert.match(prompt, /V3\.2|Director Brief|下一幕/);
  assert.match(prompt, /去留谈判/);
  assert.ok(!prompt.includes("攒够首付"));
});

test("V3.2: Narrative route/plan/Writer/Dialogue 复用同一 Director Brief，不增加第二条结算路径", () => {
  const narrativeRoute = readFileSync(join(root, "app", "api", "chapter", "narrative-plan", "route.ts"), "utf8");
  const engine = readFileSync(join(root, "lib", "narrative", "engine.ts"), "utf8");
  const planner = readFileSync(join(root, "lib", "narrative", "planner.ts"), "utf8");
  const narrativeDomain = readFileSync(join(root, "lib", "domain", "narrative.ts"), "utf8");
  const novelWriter = readFileSync(join(root, "lib", "game", "novel-writer.ts"), "utf8");
  const dialogueWriter = readFileSync(join(root, "lib", "game", "dialogue-writer.ts"), "utf8");
  assert.match(narrativeRoute, /buildNarrativeDirectorBrief/);
  assert.match(narrativeRoute, /runNarrativeEngine/);
  assert.match(engine, /directorBrief/);
  assert.match(planner, /directorBrief/);
  assert.match(narrativeDomain, /directorBrief\?:/);
  assert.match(novelWriter, /directorBrief/);
  assert.match(dialogueWriter, /directorBrief/);
  assert.doesNotMatch(narrativeRoute, /runWorldSimulator|reduceWorldState/);
});

test("V3.1/V3.2: 客户端只显示公开焦点和 NPC 主动事件标记，不输出私密字段", () => {
  const chapterResult = readFileSync(join(root, "components", "life-vn", "ChapterResult.tsx"), "utf8");
  const lifeApp = readFileSync(join(root, "components", "life", "LifeApp.tsx"), "utf8");
  assert.match(chapterResult, /NPC 主动/);
  assert.match(chapterResult, /directorBrief/);
  assert.match(lifeApp, /directorBrief/);
  assert.doesNotMatch(chapterResult, /privateIntent|hiddenGoals|privateBeliefs/);
  assert.doesNotMatch(lifeApp, /privateIntent|hiddenGoals|privateBeliefs/);
});
