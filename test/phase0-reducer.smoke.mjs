// Phase 0 冒烟测试：验证 WorldState reducer 与 GameSave v1 辅助。
// 编译：npx tsc --outDir .tmp/phase0-test --module commonjs --moduleResolution node
//       --target es2022 lib/domain/*.ts lib/game/world-reducer.ts lib/game/save.ts
// 运行：node test/phase0-reducer.smoke.mjs
import { createHash } from "node:crypto";

const base = process.env.PHASE0_TEST_DIR || ".tmp/phase0-test";

async function load(rel) {
  return import(new URL(`../${base}/${rel}`, import.meta.url).href);
}

function hash(seed) {
  return createHash("sha256").update(seed).digest("hex").slice(0, 13);
}

const { reduceWorldState } = await load("game/world-reducer.js");
const { parseGameSave, serializeGameSave } = await load("game/save.js");
const { validateWorldState } = await load("domain/validate.js");
const { clampStat } = await load("domain/shared.js");

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL ${name} ${detail}`);
  }
}

// ---- 构造最小 WorldState ----
const now = "2026-08-31T12:00:00.000Z";
const protagonist = {
  id: "protagonist-1",
  role: "protagonist",
  identity: {
    name: "张明",
    birthYear: 2008,
    gender: "男",
    hometown: "武汉",
    familyBackground: "普通工薪家庭",
  },
  core: {
    personalityTraits: ["谨慎", "务实"],
    values: ["稳定"],
    talents: { insight: 60, charm: 50, grit: 70, learning: 55, luck: 40 },
    hooks: [],
  },
  state: {
    age: 18,
    year: 2026,
    city: "深圳",
    occupation: "程序员",
    socialIdentity: "软件工程师",
    stats: { cash: 40, health: 80, happiness: 70, knowledge: 60, connections: 45, career: 50, assets: 10 },
    currentGoals: [
      { id: "goal-1", label: "攒钱买房", horizon: "long", priority: 80, status: "active" },
    ],
    currentDilemmas: [],
    attitudes: { risk: 40 },
  },
  privateState: undefined,
  memoryIds: [],
  createdAt: now,
  updatedAt: now,
};

const npc = {
  id: "npc-lin",
  role: "npc",
  identity: {
    name: "林雨",
    birthYear: 2007,
    gender: "女",
    hometown: "武汉",
    familyBackground: "教师家庭",
  },
  core: {
    personalityTraits: ["独立", "要强"],
    values: ["家庭"],
    talents: { insight: 65, charm: 70, grit: 60, learning: 50, luck: 45 },
    hooks: [],
  },
  state: {
    age: 19,
    year: 2026,
    city: "深圳",
    occupation: "设计师",
    socialIdentity: "设计师",
    stats: { cash: 50, health: 75, happiness: 65, knowledge: 55, connections: 50, career: 45, assets: 5 },
    currentGoals: [
      { id: "goal-lin-1", label: "回武汉发展", horizon: "medium", priority: 90, status: "active" },
    ],
    currentDilemmas: [],
    attitudes: { risk: 20 },
  },
  privateState: { hiddenGoals: ["希望父母养老"], hiddenConcerns: [], privateBeliefs: [] },
  memoryIds: [],
  createdAt: now,
  updatedAt: now,
};

const relationship = {
  id: "rel-1",
  characterAId: "protagonist-1",
  characterBId: "npc-lin",
  type: "partner",
  scores: { closeness: 72, trust: 68, conflict: 31, commitment: 54 },
  publicSummary: "在深圳的恋人",
  unresolvedIssues: [],
  milestoneEventIds: [],
  status: "active",
  updatedAt: now,
};

const world = {
  schemaVersion: 1,
  gameId: "game-1",
  currentYear: 2026,
  protagonistId: "protagonist-1",
  characters: { [protagonist.id]: protagonist, [npc.id]: npc },
  relationships: { [relationship.id]: relationship },
  memories: {},
  chapterIds: [],
  eraContext: null,
  openThreads: [],
  canonicalEventIds: [],
  updatedAt: now,
};

// ---- 构造 WorldSimulationOutput ----
const chapterId = "chapter-1";
const uncertaintySeed = hash("game-1:0:decision-1:留在深圳争取晋升");
const output = {
  events: [
    {
      id: "event-1",
      chapterId,
      year: 2027,
      month: 4,
      order: 1,
      title: "晋升失败",
      summary: "公司组织调整，晋升名额取消",
      domain: "career",
      participantIds: ["protagonist-1"],
      causes: [{ type: "player_choice", description: "选择留在现公司" }],
      characterChanges: [
        {
          characterId: "protagonist-1",
          statDelta: { career: -6, happiness: -4, cash: 2 },
          description: "晋升失败，收入小幅增长但信心受挫",
        },
      ],
      relationshipChanges: [],
      evidenceIds: [],
      importance: 70,
      visibility: "known_to_protagonist",
      createsThreadIds: [],
      resolvesThreadIds: [],
    },
    {
      id: "event-2",
      chapterId,
      year: 2028,
      order: 2,
      title: "林雨认真讨论回武汉",
      summary: "林雨开始认真讨论未来定居城市",
      domain: "relocation",
      participantIds: ["protagonist-1", "npc-lin"],
      causes: [{ type: "npc_goal", refId: "goal-lin-1", description: "林雨想回武汉" }],
      characterChanges: [],
      relationshipChanges: [
        {
          relationshipId: "rel-1",
          scoreDelta: { conflict: 12, closeness: -5 },
          addIssue: "对定居城市的分歧",
          description: "定居城市分歧成为关系中的未解决问题",
        },
      ],
      evidenceIds: [],
      importance: 65,
      visibility: "known_to_protagonist",
      createsThreadIds: ["thread-city"],
      resolvesThreadIds: [],
    },
  ],
  newMemories: [
    {
      id: "mem-1",
      characterId: "protagonist-1",
      year: 2028,
      chapterId,
      eventId: "event-1",
      type: "setback",
      summary: "晋升失败但获得小幅加薪",
      relatedCharacterIds: [],
      domains: ["career"],
      importance: 72,
      emotionalValence: -1,
      permanentFact: true,
      active: true,
    },
  ],
  goalUpdates: [
    {
      characterId: "protagonist-1",
      add: [
        { id: "goal-2", label: "积累管理经验", horizon: "medium", priority: 70, status: "active" },
      ],
      update: [],
    },
  ],
  hookUpdates: [
    {
      characterId: "protagonist-1",
      add: [
        { id: "hook-1", label: "害怕阶层下滑", description: "晋升失败后更焦虑于收入地位", status: "active" },
      ],
      resolveIds: [],
    },
  ],
  threadUpdates: {
    create: [
      {
        id: "thread-city",
        label: "定居城市分歧",
        description: "林雨希望回武汉，张明犹豫",
        domain: "relocation",
        relatedCharacterIds: ["protagonist-1", "npc-lin"],
        urgency: 75,
        status: "open",
      },
    ],
    resolveIds: [],
    dormantIds: [],
  },
  chapterSummary: {
    keyEvents: ["晋升失败", "林雨讨论回武汉"],
    characterChanges: ["事业-6"],
    relationshipChanges: ["冲突+12"],
    unresolvedQuestions: ["是否回武汉"],
  },
};

// ---- 执行 reducer ----
const next = reduceWorldState(world, output, { chapterId, endYear: 2028, now });

check("stats 应用并 clamp", next.characters["protagonist-1"].state.stats.career === 44, `career=${next.characters["protagonist-1"].state.stats.career}`);
check("stats 负数 clamp 到 0", clampStat(-5) === 0);
check("stats 超界 clamp 到 100", clampStat(150) === 100);
check("关系数值应用", next.relationships["rel-1"].scores.conflict === 43, `conflict=${next.relationships["rel-1"].scores.conflict}`);
check("关系新增未解决问题", next.relationships["rel-1"].unresolvedIssues.length === 1);
check("关系类型未变", next.relationships["rel-1"].type === "partner");
check("新增记忆写入", Boolean(next.memories["mem-1"]));
check("记忆挂到角色", next.characters["protagonist-1"].memoryIds.includes("mem-1"));
check("目标新增", next.characters["protagonist-1"].state.currentGoals.some((g) => g.id === "goal-2"));
check("Hook 新增", next.characters["protagonist-1"].core.hooks.some((h) => h.id === "hook-1"));
check("线程创建", next.openThreads.some((t) => t.id === "thread-city"));
check("canonical 事件记录", next.canonicalEventIds.length === 2);
check("章节记录", next.chapterIds.includes("chapter-1"));
check("世界年份推进", next.currentYear === 2028, `currentYear=${next.currentYear}`);
check("角色年龄推进", next.characters["protagonist-1"].state.age === 20, `age=${next.characters["protagonist-1"].state.age}`);
check("角色年份推进", next.characters["npc-lin"].state.year === 2028);
check("updatedAt 更新", next.updatedAt === now);
check("不可变：原 world 未被修改", world.currentYear === 2026 && world.characters["protagonist-1"].state.stats.career === 50);

// ---- 引用完整性校验（错误路径） ----
let threw = false;
try {
  const broken = {
    ...next,
    protagonistId: "ghost",
  };
  validateWorldState(broken);
} catch {
  threw = true;
}
check("引用完整性校验拒绝幽灵 protagonistId", threw);

// ---- GameSave v1 辅助 ----
const save = {
  schemaVersion: 1,
  savedAt: now,
  worldState: next,
  chapters: {
    [chapterId]: {
      id: chapterId,
      index: 0,
      startYear: 2026,
      endYear: 2028,
      span: 1,
      stateBeforeHash: hash("before"),
      decision: {
        id: "decision-1",
        promptTitle: "职业选择",
        context: "公司调整，创业公司邀请",
        options: [
          { id: "A", label: "留任晋升", description: "留在现公司争取晋升", strategyTag: "稳守晋升", estimatedRisk: 30, stateFit: "顺势" },
        ],
        selectedOptionId: "A",
        normalizedAction: "留在现公司争取晋升",
      },
      resolution: {
        effectiveRisk: 32,
        outcomeAnchor: "setback",
        uncertaintySeed,
        reasonSummary: "晋升名额取消",
      },
      evidence: { experienceIds: [], featuredExperienceIds: [] },
      simulationEventIds: ["event-1", "event-2"],
      stateAfterHash: hash("after"),
      novel: { title: "深圳没有春天", scenes: [], generatedAt: now, version: 1 },
      summary: { keyEvents: [], characterChanges: [], relationshipChanges: [], openThreads: [] },
      memoryIds: ["mem-1"],
      createdAt: now,
    },
  },
  events: {},
  experienceCache: {},
};

const parsed = parseGameSave(JSON.parse(serializeGameSave(save)));
check("GameSave 序列化/解析往返", parsed.worldState.gameId === "game-1" && parsed.schemaVersion === 1);

let legacyRejected = false;
try {
  parseGameSave({ schemaVersion: 99, savedAt: now });
} catch (error) {
  legacyRejected = String(error.message).includes("旧版人生重启模式");
}
check("旧版存档被拒绝并给出指引", legacyRejected);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
