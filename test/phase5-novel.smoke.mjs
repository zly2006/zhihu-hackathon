// Phase 5 冒烟测试：novel-writer 的 prompt 组装与 novel 解析（纯逻辑）。
// 编译：npx tsc --outDir .tmp/phase5-test --module commonjs --moduleResolution node --target es2022 --esModuleInterop --skipLibCheck lib/domain/*.ts lib/types.ts lib/llm.ts lib/game/novel-writer.ts
// 运行：node test/phase5-novel.smoke.mjs
const base = process.env.PHASE5_TEST_DIR || ".tmp/phase5-test";
async function load(rel) {
  return import(new URL(`../${base}/${rel}`, import.meta.url).href);
}
const writer = await load("game/novel-writer.js");

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`PASS ${name}`);
  else {
    failures += 1;
    console.error(`FAIL ${name} ${detail}`);
  }
}
function throws(fn) {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

const protagonist = {
  id: "p1", role: "protagonist",
  identity: { name: "张明", birthYear: 2008, gender: "男", hometown: "武汉", familyBackground: "工薪" },
  core: { personalityTraits: ["务实", "谨慎"], values: ["稳定"], talents: { insight: 60, charm: 50, grit: 70, learning: 55, luck: 40 }, hooks: [] },
  state: { age: 25, year: 2033, city: "深圳", occupation: "程序员", socialIdentity: "程序员", stats: { cash: 40, health: 80, happiness: 60, knowledge: 50, connections: 30, career: 40, assets: 5 }, currentGoals: [], currentDilemmas: [], attitudes: {} },
  privateState: undefined, memoryIds: [], createdAt: "t", updatedAt: "t",
};
const npc = { ...protagonist, id: "n1", role: "npc", identity: { ...protagonist.identity, name: "林雨" } };
const input = {
  protagonist,
  npcs: [npc],
  relationships: [{ id: "r1", characterAId: "p1", characterBId: "n1", type: "partner", scores: { closeness: 60, trust: 60, conflict: 40, commitment: 50 }, publicSummary: "恋人", unresolvedIssues: [], milestoneEventIds: [], status: "active", updatedAt: "t" }],
  startYear: 2033,
  endYear: 2034,
  span: 1,
  events: [
    { id: "ev1", chapterId: "c1", year: 2033, month: 4, order: 1, title: "晋升失败", summary: "公司调整，晋升名额取消", domain: "career", participantIds: ["p1"], causes: [], characterChanges: [{ characterId: "p1", statDelta: { career: -5 }, description: "事业受挫" }], relationshipChanges: [], evidenceIds: [], importance: 60, visibility: "known_to_protagonist", createsThreadIds: [], resolvesThreadIds: [] },
    { id: "ev2", chapterId: "c1", year: 2034, month: null, order: 2, title: "定居讨论", summary: "林雨想回武汉", domain: "relocation", participantIds: ["p1", "n1"], causes: [], characterChanges: [], relationshipChanges: [{ relationshipId: "r1", scoreDelta: { conflict: 10 }, description: "分歧" }], evidenceIds: [], importance: 70, visibility: "partially_known", createsThreadIds: [], resolvesThreadIds: [] },
  ],
  relevantMemories: [{ id: "m1", characterId: "p1", year: 2033, chapterId: "c1", type: "setback", summary: "晋升失败", relatedCharacterIds: [], domains: ["career"], importance: 60, emotionalValence: -1, permanentFact: true, active: true }],
  featuredEvidence: [{ id: "e1", source: { platform: "zhihu", url: "u", title: "深圳程序员", author: null, authorUrl: null, avatarUrl: null }, context: { relevantTraits: [] }, situation: { domains: ["career"], eventType: "", trigger: "t", dilemma: "d", constraints: [], goals: [] }, decision: { action: "a", alternatives: [], motivations: [], voluntariness: "未知", riskLevel: "未知" }, outcomes: { shortTerm: [{ dimension: "career", direction: "neutral", magnitude: "unknown", description: "后来回老家了", horizon: "unknown", explicitInSource: true }], mediumTerm: [], longTerm: [] }, relationshipEffects: [], causalNotes: { claimedReasons: [], possibleMediators: [], uncertainties: [] }, retrieval: { tags: [], keywords: [], qualityScore: 80, similarity: 0.9 } }],
};

const prompt = writer.buildNovelPrompt(input);
check("prompt 含主角名", prompt.includes("张明"));
check("prompt 含事件标题", prompt.includes("晋升失败"));
check("prompt 含第二人称约束", prompt.includes("第二人称"));
check("prompt 含 canonical 标记", prompt.includes("canonical"));
check("prompt 含部分知情标记", prompt.includes("部分知情") || prompt.includes("只部分知情"));
check("prompt 含 NPC 名", prompt.includes("林雨"));

const novel = writer.parseNovel(
  { title: "深圳没有春天", subtitle: "", scenes: [{ heading: "三月", timeLabel: "2033.04", text: "你站在公司楼下。" }] },
  "2026-08-31T00:00:00.000Z",
  1,
  2033,
  2034,
);
check("parseNovel 标题", novel.title === "深圳没有春天");
check("parseNovel 场景数", novel.scenes.length === 1);
check("parseNovel 副标题回退年份区间", novel.subtitle === "2033—2034");
check("parseNovel 版本号", novel.version === 1);
check("parseNovel 拒绝空场景", throws(() => writer.parseNovel({ title: "t", scenes: [] }, "t", 1, 2033, 2034)));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
