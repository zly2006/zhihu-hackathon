import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const base = process.env.V25_TEST_DIR || ".tmp/test-all";

async function load(rel) {
  return import(new URL(`../${base}/${rel}`, import.meta.url).href);
}

function makeWorld() {
  const now = "2026-09-03T00:00:00.000Z";
  const character = (id, name, role = "npc") => ({
    id,
    role,
    identity: { name, birthYear: 2000, gender: "男", hometown: "", familyBackground: "" },
    core: {
      personalityTraits: ["谨慎"],
      values: ["稳定"],
      talents: {},
      hooks: [],
    },
    state: {
      age: 26,
      year: 2026,
      city: "深圳",
      occupation: "程序员",
      socialIdentity: "程序员",
      stats: {},
      currentGoals: [],
      currentDilemmas: [],
      attitudes: {},
    },
    memoryIds: [],
    createdAt: now,
    updatedAt: now,
  });
  return {
    schemaVersion: 1,
    gameId: "v25-test",
    currentYear: 2026,
    protagonistId: "hero",
    characters: {
      hero: character("hero", "张明", "protagonist"),
      npc: character("npc", "林雨"),
    },
    relationships: {
      relation: {
        id: "relation",
        characterAId: "hero",
        characterBId: "npc",
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

test("V2.5: query adapter 只召回 rag_allowed 来源并加载关联 choice/arc", async () => {
  const { searchFragments, loadNarrativePatterns } = await load("narrative/query-adapter.js");
  const allowed = searchFragments({ query: "创业失败", limit: 8 });
  assert.equal(allowed.available, true);
  assert.ok(allowed.rows.length > 0, "公版 Narrative KB 应能召回结果");
  assert.ok(allowed.rows.every((row) => row.ragAllowed === 1), "游戏侧不得召回 rag_allowed=false 来源");

  const restrictedOnly = searchFragments({ query: "创业失败", stage: "entrepreneurship", limit: 8 });
  assert.equal(restrictedOnly.available, true);
  assert.equal(restrictedOnly.rows.length, 0, "仅有受限来源的阶段不得进入游戏检索");

  const patterns = loadNarrativePatterns(allowed.rows.map((row) => row.fragment_id));
  assert.equal(patterns.available, true);
  assert.ok(patterns.choicePatterns.length > 0, "匹配 fragment 应带出 choice_pattern");
  assert.ok(patterns.characterArcPatterns.length > 0, "匹配 fragment 应带出 character_arc");
  assert.ok(patterns.choicePatterns.every((pattern) => pattern.fragmentId && pattern.type));
  assert.ok(patterns.characterArcPatterns.every((pattern) => pattern.fragmentId && pattern.stage));
});

test("V2.5: search/scene service 对齐契约并输出有限结构参考", async () => {
  const { narrativeSearch, narrativeScene } = await load("narrative/kb-service.js");
  const search = narrativeSearch({ event: "创业失败", stage: "career", limit: 5 });
  assert.equal(search.kbAvailable, true);
  assert.equal(search.querySummary.event, "创业失败");
  assert.ok(Array.isArray(search.scene_pattern) && search.scene_pattern.length > 0);
  assert.ok(Array.isArray(search.choice_pattern) && search.choice_pattern.length > 0);
  assert.ok(Array.isArray(search.character_arc_pattern));
  assert.ok(search.emotion_curve?.curve);
  assert.ok(search.scene_pattern.every((item) => !Object.hasOwn(item, "excerpt")));
  assert.ok(search.choice_pattern.every((item) => item.options.length <= 3));

  const scene = narrativeScene({ event: "城市选择", characters: [{ name: "主角" }], relationship: "恋人" });
  assert.equal(scene.kbAvailable, true);
  assert.ok("scene_structure" in scene);
  assert.ok("dialogue_style" in scene);
  assert.ok(Array.isArray(scene.choices));
  assert.ok(Array.isArray(scene.references));
});

test("V2.5: NarrativeEvidenceBundle 把结构模式送入 Director 与 Dialogue", async () => {
  const { retrieveNarrativeEvidence } = await load("narrative/retriever.js");
  const bundle = retrieveNarrativeEvidence({
    chapterId: "v25-chapter",
    lifeDomains: ["career"],
    relationshipTypes: ["partner"],
    centralEvents: ["创业失败"],
    conflictTypes: ["资源不足"],
    desiredTone: "紧张但克制",
    narrativeFunctions: ["conflict", "decision"],
  });
  assert.ok(bundle.choicePatterns?.length > 0, "Evidence Bundle 应包含 choice patterns");
  assert.ok(bundle.characterArcPatterns?.length > 0, "Evidence Bundle 应包含 character arc patterns");

  const planner = await load("narrative/planner.js");
  const prompt = planner.buildDirectorPrompt({
    need: {
      chapterId: "v25-chapter",
      lifeDomains: ["career"],
      relationshipTypes: ["partner"],
      centralEvents: ["创业失败"],
      conflictTypes: ["资源不足"],
      desiredTone: "紧张但克制",
      narrativeFunctions: ["conflict"],
    },
    bundle: {
      querySummary: "test",
      arcPatterns: [],
      scenePatterns: [],
      dialoguePatterns: [],
      pacingPatterns: [],
      endingPatterns: [],
      total: 0,
      choicePatterns: [{ id: "choice-1", fragmentId: "frag-1", type: "career_vs_romance", options: ["保住工作", "守住关系"], effects: {}, similarity: 0.8, sourceId: "source-1" }],
      characterArcPatterns: [{ id: "arc-1", fragmentId: "frag-1", stage: "career_setback", stateBefore: "稳定", stateAfter: "重新选择", similarity: 0.8, sourceId: "source-1" }],
    },
    info: {
      world: makeWorld(),
      events: [{ id: "event-1", year: 2026, month: 3, title: "创业失败", summary: "资金链断裂", participantIds: ["hero"], characterChanges: [], relationshipChanges: [], importance: 80, visibility: "known_to_protagonist" }],
      decision: { promptTitle: "下一步", normalizedAction: "重新找工作" },
      span: 1,
      startYear: 2026,
      endYear: 2027,
    },
  });
  assert.match(prompt, /choice|选择设计模式/);
  assert.match(prompt, /career_vs_romance/);
  assert.match(prompt, /career_setback/);
  assert.match(prompt, /禁止复制|结构参考/);

  const dialogue = await load("game/dialogue-writer.js");
  const dialoguePrompt = dialogue.buildDialoguePrompt({
    world: makeWorld(),
    events: [{ id: "event-1", year: 2026, title: "创业失败", summary: "资金链断裂", participantIds: ["hero"], characterChanges: [], relationshipChanges: [] }],
    novelScenes: [{ id: "scene-1", timeLabel: "2026.03", text: "你盯着账户余额。" }],
    narrativeEvidence: {
      querySummary: "test",
      arcPatterns: [],
      scenePatterns: [],
      dialoguePatterns: [],
      pacingPatterns: [],
      endingPatterns: [],
      total: 0,
      choicePatterns: [{ id: "choice-1", fragmentId: "frag-1", type: "career_vs_romance", options: ["保住工作", "守住关系"], effects: {}, similarity: 0.8, sourceId: "source-1" }],
      characterArcPatterns: [{ id: "arc-1", fragmentId: "frag-1", stage: "career_setback", stateBefore: "稳定", stateAfter: "重新选择", similarity: 0.8, sourceId: "source-1" }],
    },
  });
  assert.match(dialoguePrompt, /choice|选择设计模式/);
  assert.match(dialoguePrompt, /career_vs_romance/);
  assert.match(dialoguePrompt, /展示选择|不改变 canonical/);
});

test("V2.5: 两个 Narrative API route 暴露契约并执行 400 输入边界", () => {
  const searchRoute = readFileSync(join(root, "app", "api", "narrative", "search", "route.ts"), "utf8");
  const sceneRoute = readFileSync(join(root, "app", "api", "narrative", "scene", "route.ts"), "utf8");
  for (const route of [searchRoute, sceneRoute]) {
    assert.match(route, /export async function POST/);
    assert.match(route, /status: 400/);
    assert.match(route, /runtime = "nodejs"/);
    assert.match(route, /NextResponse/);
  }
  assert.match(searchRoute, /narrativeSearch/);
  assert.match(sceneRoute, /narrativeScene/);

  const queryAdapter = readFileSync(join(root, "lib", "narrative", "query-adapter.ts"), "utf8");
  assert.match(queryAdapter, /s\.rag_allowed\s*=\s*1/);
  assert.match(queryAdapter, /quoteAllowed\s*===\s*1|quote_allowed/);

  const lifeApp = readFileSync(join(root, "components", "life", "LifeApp.tsx"), "utf8");
  assert.match(lifeApp, /narrativeEvidence = planOutcome\.evidence/);
  assert.match(lifeApp, /fetchLiveScenePackage/);
});

test("V2.5: OpenAI-compatible provider 支持按 Base URL 切换且不自动双发", () => {
  const llm = readFileSync(join(root, "lib", "llm.ts"), "utf8");
  assert.match(llm, /ccfuck/);
  assert.match(llm, /freeapp/);
  assert.match(llm, /CCFUCK_BASE_URL/);
  assert.match(llm, /FREEAPP_BASE_URL/);
  assert.match(llm, /chat\/completions/);
  assert.doesNotMatch(llm, /Promise\.all\(.*CCFUCK|fallback.*retry/i);
});
