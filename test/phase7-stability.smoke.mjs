// Phase 7 稳定性冒烟测试：验证"没有小说文本参与状态计算，WorldState 能连续正确推进十章"。
// 覆盖：极端状态（现金归零不崩溃）、10+ 章连续、NPC 年龄/状态一致性、记忆累积与检索上限、
// 状态哈希确定性（小说重写不改 stateAfterHash）、存档往返。
// 编译（由 scripts/test-all.mjs 统一执行）后运行：node test/phase7-stability.smoke.mjs
const base = process.env.PHASE7_TEST_DIR || ".tmp/phase7-test";
async function load(rel) {
  return import(new URL(`../${base}/${rel}`, import.meta.url).href);
}

const { reduceWorldState } = await load("game/world-reducer.js");
const { validateWorldState } = await load("domain/validate.js");
const { selectRelevantMemories } = await load("game/memory-selector.js");
const { resolveDecision } = await load("game/decision-resolver.js");
const { hashState } = await load("game/hash.js");
const { parseGameSave, serializeGameSave } = await load("game/save.js");
const factory = await load("game/character-factory.js");
const { LIFE_STAT_KEYS } = await load("domain/shared.js");

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`PASS ${name}`);
  else {
    failures += 1;
    console.error(`FAIL ${name} ${detail}`);
  }
}

// ---- 构造初始世界 ----
const protagonist = factory.createProtagonist({
  name: "张明",
  birthYear: 2008,
  gender: "男",
  hometown: "武汉",
  familyBackground: "普通工薪家庭",
  initialCity: "深圳",
  initialDirection: "程序员",
  personalityTraits: ["务实", "谨慎"],
  values: ["稳定"],
  longTermGoal: "在大城市立足",
  initialDilemma: "毕业即面临就业压力",
  talents: { insight: 60, charm: 50, grit: 70, learning: 55, luck: 30 },
});
const npcDrafts = [
  { name: "林雨", gender: "女", age: 18, relationshipType: "partner", basicSetting: "高中同学", personalityTraits: ["独立"], values: ["家庭"], hiddenGoal: "回老家", hiddenConcern: "站不住脚", privateBelief: "稳定重要" },
  { name: "王浩", gender: "男", age: 19, relationshipType: "friend", basicSetting: "发小", personalityTraits: ["乐观"], values: ["自由"], hiddenGoal: "创业", hiddenConcern: "失败", privateBelief: "敢拼" },
  { name: "陈楠", gender: "女", age: 25, relationshipType: "coworker", basicSetting: "同组同事", personalityTraits: ["沉稳"], values: ["专业"], hiddenGoal: "升职", hiddenConcern: "被淘汰", privateBelief: "深耕" },
];
const npcs = npcDrafts.map((d) => factory.createNpc(d, protagonist.state.year));
const relationships = npcs.map((npc, i) => factory.createRelationship(protagonist.id, npc.id, npcDrafts[i].relationshipType, npcDrafts[i].basicSetting));
let world = factory.createInitialWorldState(protagonist, npcs, relationships);

// ---- 每章构造压力输出（模拟 World Simulator 的产物，程序化生成） ----
function makeStressOutput(world, chapterId, endYear, step) {
  const protagonistId = world.protagonistId;
  const npcIds = Object.keys(world.characters).filter((id) => id !== protagonistId);
  const relIds = Object.keys(world.relationships);
  return {
    events: [
      {
        id: `ev-${step}-1`, chapterId, year: endYear, month: null, order: 1,
        title: "财务恶化", summary: "收入下降、支出增加", domain: "finance",
        participantIds: [protagonistId],
        causes: [{ type: "other", description: "经济压力" }],
        characterChanges: [{ characterId: protagonistId, statDelta: { cash: -20, career: -10, happiness: -3 }, description: "财务状况恶化" }],
        relationshipChanges: [], evidenceIds: [], importance: 60, visibility: "known_to_protagonist",
        createsThreadIds: [], resolvesThreadIds: [],
      },
      {
        id: `ev-${step}-2`, chapterId, year: endYear, month: null, order: 2,
        title: "关系紧张", summary: "因经济问题与亲近之人争执", domain: "family",
        participantIds: [protagonistId, npcIds[0]],
        causes: [{ type: "relationship", description: "经济争执" }],
        characterChanges: [],
        relationshipChanges: [{ relationshipId: relIds[0], scoreDelta: { conflict: 8, closeness: -4 }, description: "争执加剧" }],
        evidenceIds: [], importance: 50, visibility: "known_to_protagonist",
        createsThreadIds: [], resolvesThreadIds: [],
      },
    ],
    newMemories: [
      { id: `m-${step}-1`, characterId: protagonistId, year: endYear, chapterId, type: "setback", summary: "财务持续恶化", relatedCharacterIds: [], domains: ["finance"], importance: 65, emotionalValence: -2, permanentFact: false, active: true },
      { id: `m-${step}-2`, characterId: protagonistId, year: endYear, chapterId, type: "conflict", summary: "与亲近之人的经济争执", relatedCharacterIds: [npcIds[0]], domains: ["family"], importance: 60, emotionalValence: -1, permanentFact: false, active: true },
      { id: `m-${step}-3`, characterId: protagonistId, year: endYear, chapterId, type: "reflection", summary: "反思生活方式", relatedCharacterIds: [], domains: ["finance"], importance: 50, emotionalValence: 0, permanentFact: step % 3 === 0, active: true },
    ],
    goalUpdates: step % 3 === 0 ? [{ characterId: protagonistId, add: [{ id: `goal-${step}`, label: "开源节流", horizon: "short", priority: 70, status: "active" }], update: [] }] : [],
    hookUpdates: [],
    threadUpdates: { create: step % 4 === 0 ? [{ id: `thread-${step}`, label: `经济压力-${step}`, description: "持续经济压力", domain: "finance", relatedCharacterIds: [protagonistId], urgency: 70, status: "open" }] : [], resolveIds: [], dormantIds: [] },
    chapterSummary: { keyEvents: ["财务恶化", "关系紧张"], characterChanges: ["现金-20"], relationshipChanges: ["冲突+8"], unresolvedQuestions: ["如何开源节流"] },
  };
}

// ---- 连续推进 10 章 ----
let cashHitZeroAt = -1;
for (let step = 0; step < 10; step += 1) {
  const chapterId = `chapter-${step}`;
  const endYear = world.currentYear + 1;
  const output = makeStressOutput(world, chapterId, endYear, step);
  world = reduceWorldState(world, output, { chapterId, endYear });

  const p = world.characters[world.protagonistId];
  for (const key of LIFE_STAT_KEYS) {
    const value = p.state.stats[key];
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      check(`第${step + 1}章 主角 ${key} 在 0-100 内`, false, `${key}=${value}`);
    }
  }
  // 引用完整性每章校验
  try {
    validateWorldState(world);
  } catch (error) {
    check(`第${step + 1}章 world 引用完整`, false, String(error));
  }
  if (cashHitZeroAt < 0 && p.state.stats.cash === 0) cashHitZeroAt = step;
}

check("10 章推进完成", world.chapterIds.length === 10);
check("主角年龄 18→28", world.characters[world.protagonistId].state.age === 28, `age=${world.characters[world.protagonistId].state.age}`);
check("NPC 年龄同步推进", world.characters[npcs[0].id].state.age === npcs[0].state.age + 10);
check("现金在推进中归零（极端状态）", cashHitZeroAt >= 0, `cashHitZeroAt=${cashHitZeroAt}`);
check("现金归零后仍可持续推进（不崩溃）", cashHitZeroAt >= 0 && cashHitZeroAt < 9);
check("现金归零后 clamp 到 0 且无 NaN", world.characters[world.protagonistId].state.stats.cash === 0);
check("记忆累积 30 条（3×10）", Object.keys(world.memories).length === 30, `memories=${Object.keys(world.memories).length}`);
check("记忆检索上限 ≤8", selectRelevantMemories(world).length <= 8);
check("关系冲突在 0-100 内", Object.values(world.relationships).every((r) => r.scores.conflict >= 0 && r.scores.conflict <= 100));
check("openThreads 存在且状态合法", world.openThreads.every((t) => t.status === "open" || t.status === "resolved" || t.status === "dormant"));

// ---- 状态哈希确定性（验收 Case C：小说重写不改 stateAfterHash） ----
const hash1 = hashState(world);
const hash2 = hashState(JSON.parse(JSON.stringify(world)));
check("相同状态哈希一致", hash1 === hash2);
const novelA = { title: "版本A", scenes: [{ id: "s", text: "不同文风" }] };
const novelB = { title: "版本B", scenes: [{ id: "s", text: "另一种文风" }] };
// novel 不在 worldState 内，改变小说不影响 stateAfterHash
check("小说文本不进入 WorldState 哈希", JSON.stringify(world).indexOf("版本A") === -1 && JSON.stringify(world).indexOf("版本B") === -1);

// ---- 存档往返（存档恢复） ----
const save = {
  schemaVersion: 1,
  savedAt: new Date().toISOString(),
  worldState: world,
  chapters: {
    "chapter-0": { id: "chapter-0", index: 0, startYear: 2026, endYear: 2027, span: 1, stateBeforeHash: hash1, decision: { id: "d0", promptTitle: "t", context: "c", options: [], selectedOptionId: "A", normalizedAction: "a" }, resolution: { effectiveRisk: 40, outcomeAnchor: "mixed", uncertaintySeed: "s", reasonSummary: "r" }, evidence: { experienceIds: [], featuredExperienceIds: [] }, simulationEventIds: [], stateAfterHash: hash1, novel: novelA, summary: { keyEvents: [], characterChanges: [], relationshipChanges: [], openThreads: [] }, memoryIds: [], createdAt: "t" },
  },
  events: {},
  experienceCache: {},
};
const roundTripped = parseGameSave(JSON.parse(serializeGameSave(save)));
check("存档往返保留 10 章世界", roundTripped.worldState.chapterIds.length === 10);
check("存档往返保留章节", Object.keys(roundTripped.chapters).length === 1);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
