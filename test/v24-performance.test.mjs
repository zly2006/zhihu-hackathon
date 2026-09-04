import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const base = process.env.V24_TEST_DIR || ".tmp/test-all";

async function load(rel) {
  return import(new URL(`../${base}/${rel}`, import.meta.url).href);
}

const scenePlan = {
  id: "scene-1",
  order: 1,
  timeLabel: "2027.03",
  location: "出租屋",
  participantIds: ["p1"],
  povCharacterId: "p1",
  sourceEventIds: ["event-1"],
  purpose: "conflict",
  visibleGoal: "做出决定",
  conflict: "时间与现金同时吃紧",
  startEmotion: "犹豫",
  endEmotion: "坚定",
  mustShow: ["账单"],
  mustNotInvent: ["不可写成已经成功"],
  narrativeTechniques: ["具体物件"],
  endingBeat: "手机亮起新的消息",
};

test("V2.4: bounded TTL cache 支持命中、过期、容量淘汰和 in-flight 合并", async () => {
  const cacheModule = await load("game/performance-cache.js");
  const cache = new cacheModule.BoundedTtlCache({
    ttlMs: 10,
    maxEntries: 2,
    now: () => clock,
  });
  let clock = 100;
  let calls = 0;

  cache.set("a", { value: 1 });
  assert.deepEqual(cache.get("a"), { value: 1 });
  const first = cache.get("a");
  first.value = 99;
  assert.equal(cache.get("a").value, 1, "cache 返回值必须与内部对象隔离");

  clock = 111;
  assert.equal(cache.get("a"), undefined, "TTL 到期后必须 miss");

  cache.set("a", { value: 1 });
  cache.set("b", { value: 2 });
  cache.set("c", { value: 3 });
  assert.equal(cache.get("a"), undefined, "超过容量后必须淘汰最早条目");
  assert.deepEqual(cache.get("c"), { value: 3 });

  const loader = () => {
    calls += 1;
    return new Promise((resolve) => setTimeout(() => resolve({ value: 7 }), 5));
  };
  const [left, right] = await Promise.all([
    cache.getOrSet("dedupe", loader),
    cache.getOrSet("dedupe", loader),
  ]);
  assert.deepEqual(left, { value: 7 });
  assert.deepEqual(right, { value: 7 });
  assert.equal(calls, 1, "相同 key 的并发 miss 必须合并为一次 loader");
});

test("V2.4: Scene writer 复用计划时间标签并拒绝空正文", async () => {
  const writer = await load("game/novel-writer.js");
  const scene = writer.parseNovelScene("  夜里，你把账单重新折好。  ", scenePlan, 0, "2026-09-03T00:00:00.000Z");
  assert.equal(scene.id, "scene-1");
  assert.equal(scene.timeLabel, "2027.03");
  assert.equal(scene.text, "夜里，你把账单重新折好。");
  assert.throws(() => writer.parseNovelScene("   ", scenePlan, 0, "2026-09-03T00:00:00.000Z"), /正文/);
  const protagonist = {
    id: "p1",
    role: "protagonist",
    identity: { name: "张明", birthYear: 2000, gender: "男", hometown: "武汉", familyBackground: "工薪" },
    core: { personalityTraits: ["务实"], values: ["稳定"], talents: {}, hooks: [] },
    state: { age: 26, year: 2026, city: "深圳", occupation: "程序员", socialIdentity: "程序员", stats: {}, currentGoals: [], currentDilemmas: [], attitudes: {} },
    memoryIds: [],
    createdAt: "2026-09-03T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:00.000Z",
  };
  assert.match(writer.buildNovelScenePrompt({
    protagonist,
    npcs: [],
    relationships: [],
    startYear: 2026,
    endYear: 2027,
    span: 1,
    events: [{ id: "event-1", year: 2027, title: "账单", summary: "现金变紧", participantIds: ["p1"], characterChanges: [], relationshipChanges: [], visibility: "known_to_protagonist" }],
    relevantMemories: [],
    featuredEvidence: [],
    scenePlan,
  }), /mustNotInvent|禁止编造/);
});

test("V2.4: 底层模型和小说端点暴露可取消的增量流", () => {
  const llm = readFileSync(join(root, "lib", "llm.ts"), "utf8");
  const novelRoute = readFileSync(join(root, "app", "api", "chapter", "novel", "route.ts"), "utf8");
  const app = readFileSync(join(root, "components", "life", "LifeApp.tsx"), "utf8");

  assert.match(llm, /onToken\?:/);
  assert.match(llm, /responseFormat\?:\s*"json"\s*\|\s*"text"/);
  assert.match(llm, /options\.onToken\?\./);
  assert.match(llm, /responseFormat === "text"/);
  assert.match(novelRoute, /stream/);
  assert.match(novelRoute, /scene_start/);
  assert.match(novelRoute, /delta/);
  assert.match(novelRoute, /ReadableStream/);
  assert.match(app, /正在推演你的未来/);
  assert.match(app, /onSceneToken|onDelta/);
  assert.match(app, /stream:\s*Boolean\(narrativePlan/);
});

test("V2.4: 依赖阶段并行且三类结果接入缓存", () => {
  const simulateRoute = readFileSync(join(root, "app", "api", "chapter", "simulate", "route.ts"), "utf8");
  const choices = readFileSync(join(root, "lib", "game", "choice-generator.ts"), "utf8");
  const evidence = readFileSync(join(root, "lib", "game", "evidence-retriever.ts"), "utf8");
  const retriever = readFileSync(join(root, "lib", "narrative", "retriever.ts"), "utf8");
  const novelWriter = readFileSync(join(root, "lib", "game", "novel-writer.ts"), "utf8");

  assert.match(simulateRoute, /Promise\.all\(\[[\s\S]*retrieveEvidence[\s\S]*selectRelevantMemories/);
  assert.match(choices, /BoundedTtlCache|performance-cache/);
  assert.match(evidence, /BoundedTtlCache|performance-cache/);
  assert.match(retriever, /BoundedTtlCache|performance-cache/);
  assert.match(novelWriter, /Promise\.all/);
  assert.match(novelWriter, /writeNovelScene/);
});
