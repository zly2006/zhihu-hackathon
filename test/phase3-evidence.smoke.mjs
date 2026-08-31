// Phase 3 冒烟测试：验证 EvidenceBundle 组装、结果方向分类、检索上下文推导、Adapter 映射。
// 均为纯逻辑，不触发数据库连接（retrieveEvidence 需真库，另做真机验证）。
// 编译：npx tsc --outDir .tmp/phase3-test --module commonjs --moduleResolution node --target es2022 --esModuleInterop --skipLibCheck lib/domain/*.ts lib/types.ts lib/database.ts lib/game/experience-adapter.ts lib/game/evidence-retriever.ts
// 运行：node test/phase3-evidence.smoke.mjs
const base = process.env.PHASE3_TEST_DIR || ".tmp/phase3-test";
async function load(rel) {
  return import(new URL(`../${base}/${rel}`, import.meta.url).href);
}

const adapter = await load("game/experience-adapter.js");
const retriever = await load("game/evidence-retriever.js");

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`PASS ${name}`);
  else {
    failures += 1;
    console.error(`FAIL ${name} ${detail}`);
  }
}

// ---- Adapter 映射 ----
check("blockingKey health_life → health", adapter.blockingKeyToDomain("health_life") === "health");
check("blockingKey family_relationship → family", adapter.blockingKeyToDomain("family_relationship") === "family");
check("blockingKey 未知 → career 兜底", adapter.blockingKeyToDomain("mystery") === "career");

function candidate(overrides = {}) {
  return {
    id: "c1",
    title: "一段人生",
    url: "https://zhihu.com/q/1",
    context: "在深圳工作两年",
    decision: "要不要离职",
    action: "继续留在公司",
    outcome: "后来升职了",
    confidence: 90,
    blockingKey: "career",
    authorName: "匿名",
    authorAvatarUrl: null,
    authorUrlToken: null,
    authorProfileUrl: null,
    similarity: 0.8,
    ...overrides,
  };
}

const exp = adapter.toLifeExperience(candidate());
check("toLifeExperience 来源平台 zhihu", exp.source.platform === "zhihu");
check("toLifeExperience 缺失字段置 null", exp.context.ageRange === null && exp.context.city === null);
check("toLifeExperience 不确定因果提示", exp.causalNotes.uncertainties.includes("单一个案，不能视为确定因果规律"));
check("toLifeExperience 领域映射", exp.situation.domains[0] === "career");

// ---- 结果方向分类 ----
check("classify 负面", retriever.classifyOutcomeDirection("创业失败了，亏了不少钱") === "negative");
check("classify 正面", retriever.classifyOutcomeDirection("转行成功，升职加薪") === "positive");
check("classify 混合", retriever.classifyOutcomeDirection("虽然顺利跳槽，但也后悔放弃稳定") === "mixed");
check("classify 未知", retriever.classifyOutcomeDirection("后来去了另一个城市") === "unknown");

// ---- 检索上下文推导 ----
const protagonist = {
  id: "p1",
  role: "protagonist",
  identity: { name: "张明", birthYear: 2008, gender: "男", hometown: "武汉", familyBackground: "工薪" },
  core: { personalityTraits: ["务实"], values: ["稳定"], talents: { insight: 50, charm: 50, grit: 50, learning: 50, luck: 50 }, hooks: [] },
  state: {
    age: 25, year: 2033, city: "深圳", occupation: "程序员", socialIdentity: "程序员",
    stats: { cash: 15, health: 80, happiness: 60, knowledge: 50, connections: 30, career: 40, assets: 5 },
    currentGoals: [], currentDilemmas: [], attitudes: {},
  },
  privateState: undefined,
  memoryIds: [],
  createdAt: "t", updatedAt: "t",
};
const npc = { ...protagonist, id: "n1", role: "npc", identity: { ...protagonist.identity, name: "林雨" } };
const world = {
  schemaVersion: 1, gameId: "g1", currentYear: 2033, protagonistId: "p1",
  characters: { p1: protagonist, n1: npc },
  relationships: {
    r1: {
      id: "r1", characterAId: "p1", characterBId: "n1", type: "partner",
      scores: { closeness: 60, trust: 60, conflict: 70, commitment: 50 },
      publicSummary: "恋人", unresolvedIssues: [], milestoneEventIds: [], status: "active", updatedAt: "t",
    },
  },
  memories: {}, chapterIds: [], eraContext: null, openThreads: [], canonicalEventIds: [], updatedAt: "t",
};
const choice = {
  id: "d1", promptTitle: "职业选择", context: "创业公司邀请",
  options: [
    { id: "A", label: "接受创业邀请", description: "加入创业公司", strategyTag: "创业", estimatedRisk: 60, stateFit: "吃力" },
    { id: "B", label: "留任争取晋升", description: "留在现公司", strategyTag: "晋升", estimatedRisk: 30, stateFit: "顺势" },
    { id: "C", label: "回武汉发展", description: "回老家", strategyTag: "迁移", estimatedRisk: 40, stateFit: "可行" },
  ],
};

const ctx = retriever.deriveRetrievalContext(world, choice, "A");
check("derive 领域 career（25岁）", ctx.domain === "career");
check("derive 低现金注入收入关键词", ctx.terms.some((t) => t === "收入"));
check("derive 决策关键词注入", ctx.decisionKeywords.includes("创业"));
check("derive 高冲突注入关系关键词", ctx.relationshipKeywords.includes("矛盾"));
check("derive anchorSeed 确定性", retriever.deriveRetrievalContext(world, choice, "A").anchorSeed === ctx.anchorSeed);

// ---- EvidenceBundle 组装 ----
const experiences = [
  adapter.toLifeExperience(candidate({ id: "e1", context: "和伴侣异地恋", decision: "要不要分手", outcome: "最后分手了，很后悔" })),
  adapter.toLifeExperience(candidate({ id: "e2", context: "创业初期", decision: "接受创业邀请", outcome: "创业成功赚了钱" })),
  adapter.toLifeExperience(candidate({ id: "e3", context: "普通上班", decision: "继续工作", outcome: "过得一般" })),
  adapter.toLifeExperience(candidate({ id: "e4", context: "创业失败", decision: "坚持还是放弃", outcome: "失败了，亏了很多" })),
];
const bundle = retriever.assembleEvidenceBundle(experiences, ctx);
check("total = 4", bundle.total === 4);
check("关系相关命中", bundle.relationshipRelevant.some((e) => e.id === "e1"));
check("结果反例最多 5 条", bundle.outcomeContrasts.length <= 5);
check("balance 各方向计数正确", bundle.balance.negative + bundle.balance.positive + bundle.balance.mixed + bundle.balance.unknown === 4);
check("四类无重复", (() => {
  const ids = [
    ...bundle.backgroundSimilar,
    ...bundle.decisionSimilar,
    ...bundle.relationshipRelevant,
    ...bundle.outcomeContrasts,
  ].map((e) => e.id);
  return new Set(ids).size === ids.length;
})());

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
