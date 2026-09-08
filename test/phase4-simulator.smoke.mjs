// Phase 4 冒烟测试：decision-resolver 确定性随机、simulation-validator 结构校验、world-simulator 映射。
// 编译：npx tsc --outDir .tmp/phase4-test --module commonjs --moduleResolution node --target es2022 --esModuleInterop --skipLibCheck lib/domain/*.ts lib/types.ts lib/llm.ts lib/game/decision-resolver.ts lib/game/simulation-validator.ts lib/game/memory-selector.ts lib/game/world-reducer.ts lib/game/world-simulator.ts
// 运行：node test/phase4-simulator.smoke.mjs
const base = process.env.PHASE4_TEST_DIR || ".tmp/phase4-test";
async function load(rel) {
  return import(new URL(`../${base}/${rel}`, import.meta.url).href);
}

const resolver = await load("game/decision-resolver.js");
const validator = await load("game/simulation-validator.js");
const simulator = await load("game/world-simulator.js");

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

// ---- decision-resolver ----
const roll1 = resolver.deterministicRoll("a");
const roll2 = resolver.deterministicRoll("a");
check("deterministicRoll 同种子同值", roll1 === roll2);
check("deterministicRoll 范围 [0,1)", roll1 >= 0 && roll1 < 1);
check("deterministicRoll 异种子异值", resolver.deterministicRoll("a") !== resolver.deterministicRoll("b"));
check("低风险偏 favorable", resolver.outcomeAnchorFromRoll(0.05, 20) === "favorable");
check("中段偏 mixed", resolver.outcomeAnchorFromRoll(0.5, 40) === "mixed");
check("高段偏 setback", resolver.outcomeAnchorFromRoll(0.97, 20) === "setback");

const protagonist = {
  id: "p1", role: "protagonist",
  identity: { name: "张明", birthYear: 2008, gender: "男", hometown: "武汉", familyBackground: "工薪" },
  core: { personalityTraits: ["务实"], values: ["稳定"], talents: { insight: 60, charm: 50, grit: 70, learning: 55, luck: 40 }, hooks: [] },
  state: { age: 25, year: 2033, city: "深圳", occupation: "程序员", socialIdentity: "程序员", stats: { cash: 15, health: 80, happiness: 60, knowledge: 50, connections: 30, career: 40, assets: 5 }, currentGoals: [], currentDilemmas: [], attitudes: {} },
  privateState: undefined, memoryIds: [], createdAt: "t", updatedAt: "t",
};
const resA = resolver.resolveDecision({ saveId: "g1", chapterIndex: 0, decisionId: "d1", normalizedAction: "留在公司", estimatedRisk: 50, stateFit: "可行", protagonist, eraContext: null });
const resB = resolver.resolveDecision({ saveId: "g1", chapterIndex: 0, decisionId: "d1", normalizedAction: "留在公司", estimatedRisk: 50, stateFit: "可行", protagonist, eraContext: null });
check("resolveDecision 确定性", resA.effectiveRisk === resB.effectiveRisk && resA.outcomeAnchor === resB.outcomeAnchor && resA.uncertaintySeed === resB.uncertaintySeed);
check("effectiveRisk 在 3-95", resA.effectiveRisk >= 3 && resA.effectiveRisk <= 95);

// ---- simulation-validator ----
const characterIds = new Set(["p1", "n1"]);
const relationshipIds = new Set(["r1"]);
const evidenceIds = new Set(["e1"]);
const vctx = { chapterId: "c1", startYear: 2033, endYear: 2034, span: 1, characterIds, relationshipIds, evidenceIds, currentRealYear: 2026 };

function validOutput() {
  return {
    events: [
      { id: "ev1", chapterId: "c1", year: 2033, month: 3, order: 1, title: "项目调整", summary: "公司项目调整", domain: "career", participantIds: ["p1"], causes: [{ type: "player_choice", description: "留在公司" }], characterChanges: [{ characterId: "p1", statDelta: { career: -4 }, description: "晋升失败" }], relationshipChanges: [], evidenceIds: ["e1"], importance: 50, visibility: "known_to_protagonist", createsThreadIds: [], resolvesThreadIds: [] },
      { id: "ev2", chapterId: "c1", year: 2034, month: null, order: 2, title: "关系讨论", summary: "讨论定居城市", domain: "relocation", participantIds: ["p1", "n1"], causes: [{ type: "relationship", description: "分歧" }], characterChanges: [], relationshipChanges: [{ relationshipId: "r1", scoreDelta: { conflict: 8 }, description: "分歧加剧" }], evidenceIds: [], importance: 60, visibility: "known_to_protagonist", createsThreadIds: [], resolvesThreadIds: [] },
    ],
    newMemories: [
      { id: "m1", characterId: "p1", year: 2033, chapterId: "c1", type: "setback", summary: "晋升失败", relatedCharacterIds: [], domains: ["career"], importance: 60, emotionalValence: -1, permanentFact: true, active: true },
      { id: "m2", characterId: "p1", year: 2034, chapterId: "c1", type: "conflict", summary: "定居分歧", relatedCharacterIds: ["n1"], domains: ["relocation"], importance: 65, emotionalValence: -1, permanentFact: false, active: true },
      { id: "m3", characterId: "n1", year: 2034, chapterId: "c1", type: "relationship", summary: "想回老家", relatedCharacterIds: ["p1"], domains: ["relocation"], importance: 55, emotionalValence: 0, permanentFact: false, active: true },
    ],
    goalUpdates: [],
    hookUpdates: [],
    threadUpdates: { create: [], resolveIds: [], dormantIds: [] },
    chapterSummary: { keyEvents: [], characterChanges: [], relationshipChanges: [], unresolvedQuestions: [] },
  };
}

check("validator 接受合法输出", !throws(() => validator.validateSimulationOutput(validOutput(), vctx)));

const wrongCount = validOutput();
wrongCount.events = [wrongCount.events[0]];
check("validator 拒绝事件数量不足", throws(() => validator.validateSimulationOutput(wrongCount, vctx)));

const badParticipant = validOutput();
badParticipant.events[0].participantIds = ["ghost"];
check("validator 拒绝幽灵 participantId", throws(() => validator.validateSimulationOutput(badParticipant, vctx)));

const badYear = validOutput();
badYear.events[0].year = 2040;
check("validator 拒绝年份越界", throws(() => validator.validateSimulationOutput(badYear, vctx)));

const badDelta = validOutput();
badDelta.events[1].relationshipChanges[0].scoreDelta = { conflict: 50 };
check("validator 拒绝关系增量超限", throws(() => validator.validateSimulationOutput(badDelta, vctx)));

const badMemory = validOutput();
badMemory.newMemories = badMemory.newMemories.slice(0, 2);
check("validator 拒绝记忆不足 3 条", throws(() => validator.validateSimulationOutput(badMemory, vctx)));

// ---- world-simulator buildSimulationOutput 映射 ----
const input = {
  chapter: { id: "c1", startYear: 2033, endYear: 2034, span: 1 },
  protagonistId: "p1",
  characters: [protagonist, { ...protagonist, id: "n1", role: "npc", identity: { ...protagonist.identity, name: "林雨" } }],
  relationships: [{ id: "r1", characterAId: "p1", characterBId: "n1", type: "partner", scores: { closeness: 60, trust: 60, conflict: 40, commitment: 50 }, publicSummary: "恋人", unresolvedIssues: [], milestoneEventIds: [], status: "active", updatedAt: "t" }],
  relevantMemories: [],
  openThreads: [],
  decision: { id: "d1", promptTitle: "职业", context: "选择", options: [{ id: "A", label: "留任", description: "留", strategyTag: "晋升", estimatedRisk: 40, stateFit: "可行" }], selectedOptionId: "A", normalizedAction: "留任" },
  resolution: resA,
  evidenceBundle: { querySummary: "", total: 1, backgroundSimilar: [{ id: "e1", source: { platform: "zhihu", url: "u", title: "t", author: null, authorUrl: null, avatarUrl: null }, context: { relevantTraits: [] }, situation: { domains: ["career"], eventType: "", trigger: "t", dilemma: "d", constraints: [], goals: [] }, decision: { action: "a", alternatives: [], motivations: [], voluntariness: "未知", riskLevel: "未知" }, outcomes: { shortTerm: [{ dimension: "career", direction: "neutral", magnitude: "unknown", description: "o", horizon: "unknown", explicitInSource: true }], mediumTerm: [], longTerm: [] }, relationshipEffects: [], causalNotes: { claimedReasons: [], possibleMediators: [], uncertainties: [] }, retrieval: { tags: [], keywords: [], qualityScore: 80, similarity: 0.9 } }], decisionSimilar: [], relationshipRelevant: [], outcomeContrasts: [], balance: { positive: 0, negative: 0, mixed: 0, unknown: 1 } },
  eraContext: null,
};
let idCounter = 0;
const newId = () => `id-${++idCounter}`;

const model = {
  events: [
    { year: 2033, month: 3, title: "调整", summary: "项目调整", domain: "career", participantIds: ["C1"], causes: [{ type: "player_choice", description: "留下" }], characterChanges: [{ characterId: "C1", statDelta: { career: -4 }, description: "晋升失败" }], relationshipChanges: [], evidenceIds: ["E1"], importance: 50, visibility: "known_to_protagonist", createsThreadLabels: ["晋升瓶颈"], resolvesThreadIds: [] },
    { year: 2034, month: null, title: "讨论", summary: "定居讨论", domain: "relocation", participantIds: ["C1", "C2"], causes: [{ type: "relationship", description: "分歧" }], characterChanges: [], relationshipChanges: [{ relationshipId: "R1", scoreDelta: { conflict: 8 }, description: "分歧" }], evidenceIds: [], importance: 60, visibility: "known_to_protagonist", createsThreadLabels: [], resolvesThreadIds: ["N1"] },
  ],
  newMemories: [
    { characterId: "C1", year: 2033, type: "setback", summary: "晋升失败", relatedCharacterIds: [], domains: ["career"], importance: 60, emotionalValence: -1, permanentFact: true },
    { characterId: "C1", year: 2034, type: "conflict", summary: "定居分歧", relatedCharacterIds: ["C2"], domains: ["relocation"], importance: 65, emotionalValence: -1, permanentFact: false },
    { characterId: "C2", year: 2034, type: "relationship", summary: "想回老家", relatedCharacterIds: ["C1"], domains: ["relocation"], importance: 55, emotionalValence: 0, permanentFact: false },
  ],
  goalUpdates: [],
  hookUpdates: [],
  threadUpdates: { create: [], resolveIds: [], dormantIds: [] },
  chapterSummary: { keyEvents: ["晋升失败"], characterChanges: ["事业-4"], relationshipChanges: ["冲突+8"], unresolvedQuestions: [] },
};

const mapped = simulator.buildSimulationOutput(model, input, newId);
const simulatorPrompt = simulator.buildSimulatorPrompt(input);
check("模拟提示在输出后再次核对重大事件上限", simulatorPrompt.includes("逐个读取每个事件的 importance") && simulatorPrompt.includes("最多 2 个重大事件"));
const npcGoalPromptInput = {
  ...input,
  characters: input.characters.map((character) => ({
    ...character,
    state: {
      ...character.state,
      currentGoals: character.id === "p1"
        ? [{ id: "hero-goal", label: "主角目标", horizon: "long", priority: 80, status: "active" }]
        : [{ id: "npc-goal", label: "NPC目标", horizon: "medium", priority: 70, status: "active" }],
    },
  })),
  npcAgentDirectives: [{
    id: "npc-agent-1",
    characterId: "n1",
    action: "contact_player",
    targetCharacterIds: ["p1"],
    relationshipIds: ["r1"],
    sourceGoalIds: ["npc-goal"],
    urgency: 80,
    privateIntent: "内部意图",
  }],
};
const npcGoalPrompt = simulator.buildSimulatorPrompt(npcGoalPromptInput);
check(
  "NPC Agent 的 npc_goal 只允许 NPC 目标别名",
  npcGoalPrompt.includes("NPC 当前目标别名：G2") && npcGoalPrompt.includes("禁止使用主角目标别名：G1"),
);
check("映射后事件数 2", mapped.events.length === 2);
check("映射后事件有 id 且 chapterId 正确", mapped.events[0].id.startsWith("event-") && mapped.events[0].chapterId === "c1");
check("别名 C1 解析为真实角色 id p1", mapped.events[0].participantIds.includes("p1") && mapped.events[0].characterChanges[0].characterId === "p1");
check("别名 C2/R1 解析为真实 id", mapped.events[1].participantIds.includes("n1") && mapped.events[1].relationshipChanges[0].relationshipId === "r1");
check("别名 E1 解析为真实证据 id", mapped.events[0].evidenceIds.includes("e1"));
check("映射后记忆有 id", mapped.newMemories.length === 3 && mapped.newMemories[0].id.startsWith("mem-"));
check("映射后 createsThreadLabels 转线程 id", mapped.events[0].createsThreadIds.length === 1 && mapped.threadUpdates.create.length === 1);
check("同一候选的新线程临时别名 N1 可解析", mapped.events[1].resolvesThreadIds[0] === mapped.events[0].createsThreadIds[0]);
const duplicatedThreadModel = JSON.parse(JSON.stringify(model));
duplicatedThreadModel.events[1].resolvesThreadIds = ["晋升瓶颈"];
duplicatedThreadModel.threadUpdates.create = [{ label: "晋升瓶颈", description: "项目调整留下的待解决问题", domain: "career", relatedCharacterIds: ["C1"], urgency: 60 }];
const duplicatedThreadMapped = simulator.buildSimulationOutput(duplicatedThreadModel, input, newId);
check("事件简写与 threadUpdates.create 的同名线索共享临时引用", duplicatedThreadMapped.events[1].resolvesThreadIds[0] === duplicatedThreadMapped.events[0].createsThreadIds[0] && duplicatedThreadMapped.threadUpdates.create.length === 1);
check("映射输出通过 validator", !throws(() => validator.validateSimulationOutput(mapped, vctx)));

let observedCandidate;
await simulator.runWorldSimulator(input, {
  model: async () => model,
  onCandidate: (candidate) => { observedCandidate = candidate; },
});
check("世界推演在结构映射前暴露本次候选供有界校正复用", observedCandidate === model);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
