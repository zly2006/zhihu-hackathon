import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const base = process.env.V21_TEST_DIR || ".tmp/v21-test";
async function load(rel) {
  return import(new URL(`../${base}/${rel}`, import.meta.url).href);
}

const now = "2026-09-03T00:00:00.000Z";

function protagonist() {
  return {
    id: "p1",
    role: "protagonist",
    identity: { name: "张明", birthYear: 2008, gender: "男", hometown: "武汉", familyBackground: "工薪" },
    core: {
      personalityTraits: ["谨慎", "务实", "念旧"],
      values: ["稳定", "家庭"],
      talents: { insight: 50, charm: 50, grit: 50, learning: 50, luck: 50 },
      hooks: [],
    },
    state: {
      age: 18,
      year: 2026,
      city: "深圳",
      occupation: "程序员",
      socialIdentity: "程序员",
      stats: { cash: 35, health: 80, happiness: 60, knowledge: 50, connections: 25, career: 15, assets: 5 },
      currentGoals: [{ id: "g1", label: "立足", horizon: "long", priority: 80, status: "active" }],
      currentDilemmas: ["就业压力"],
      attitudes: {},
    },
    memoryIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

function npc() {
  return {
    id: "n1",
    role: "npc",
    identity: { name: "林雨", birthYear: 2006, gender: "女", hometown: "武汉", familyBackground: "普通家庭" },
    core: {
      personalityTraits: ["坚定"],
      values: ["自由"],
      talents: { insight: 50, charm: 50, grit: 50, learning: 50, luck: 50 },
      hooks: [],
    },
    state: {
      age: 20,
      year: 2026,
      city: "深圳",
      occupation: "产品经理",
      socialIdentity: "产品经理",
      stats: { cash: 35, health: 80, happiness: 60, knowledge: 50, connections: 25, career: 40, assets: 5 },
      currentGoals: [],
      currentDilemmas: [],
      attitudes: {},
    },
    privateState: { hiddenGoals: ["不想异地"], hiddenConcerns: ["职业停滞"], privateBeliefs: ["稳定很重要"] },
    memoryIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

function world() {
  const p = protagonist();
  const n = npc();
  const relationship = {
    id: "r1",
    characterAId: p.id,
    characterBId: n.id,
    type: "partner",
    scores: { closeness: 55, trust: 55, conflict: 20, commitment: 45 },
    publicSummary: "正在磨合的恋人",
    unresolvedIssues: [],
    milestoneEventIds: [],
    status: "active",
    updatedAt: now,
  };
  return {
    schemaVersion: 1,
    gameId: "game-1",
    currentYear: 2026,
    protagonistId: p.id,
    characters: { [p.id]: p, [n.id]: n },
    relationships: { [relationship.id]: relationship },
    memories: {},
    chapterIds: [],
    eraContext: null,
    openThreads: [],
    canonicalEventIds: [],
    updatedAt: now,
  };
}

test("V2.1: 新存档保存选择的模式，旧存档缺失或非法模式默认 galgame", async () => {
  const factory = await load("game/character-factory.js");
  const saveModule = await load("game/save.js");
  const save = factory.createInitialGameSave(world(), now, "novel");
  assert.equal(save.presentationMode, "novel");
  assert.equal(saveModule.parseGameSave({ ...save, presentationMode: undefined }).presentationMode, "galgame");
  assert.equal(saveModule.parseGameSave({ ...save, presentationMode: "other" }).presentationMode, "galgame");
});

test("V2.1: 工厂初始化说话风格、表层情绪和空关系历史", async () => {
  const factory = await load("game/character-factory.js");
  const p = factory.createProtagonist({
    name: "张明", birthYear: 2008, gender: "男", hometown: "武汉", familyBackground: "工薪",
    initialCity: "深圳", initialDirection: "程序员", personalityTraits: ["谨慎", "务实", "念旧"],
    values: ["稳定", "家庭"], longTermGoal: "立足", initialDilemma: "就业压力",
    talents: { insight: 50, charm: 50, grit: 50, learning: 50, luck: 50 },
  });
  const n = factory.createNpc({
    name: "林雨", gender: "女", age: 20, relationshipType: "partner", basicSetting: "恋人",
    personalityTraits: ["坚定"], values: ["自由"], hiddenGoal: "不想异地", hiddenConcern: "职业停滞", privateBelief: "稳定很重要",
  }, p.state.year);
  assert.ok(p.speechStyle);
  assert.equal(p.emotionState, "平静");
  assert.deepEqual(p.relationshipHistory, []);
  assert.ok(n.speechStyle);
  assert.equal(n.emotionState, "平静");
  assert.deepEqual(n.relationshipHistory, []);
});

test("V2.1: 关系变化为双方累积最近 12 条历史且不修改原世界", async () => {
  const { reduceWorldState } = await load("game/world-reducer.js");
  const before = world();
  const relationshipChange = {
    relationshipId: "r1",
    scoreDelta: { trust: -3 },
    description: "一次关于去留的争执让双方暂时失去耐心",
  };
  const outputs = Array.from({ length: 13 }, (_, index) => ({
    events: [{
      id: `event-${index}`,
      chapterId: `chapter-${index}`,
      year: 2026 + index,
      order: 1,
      title: `关系事件 ${index}`,
      summary: "关系发生变化",
      domain: "relationship",
      participantIds: ["p1", "n1"],
      causes: [],
      characterChanges: [],
      relationshipChanges: [relationshipChange],
      evidenceIds: [],
      importance: 50,
      visibility: "known_to_protagonist",
      createsThreadIds: [],
      resolvesThreadIds: [],
    }],
    newMemories: [], goalUpdates: [], hookUpdates: [],
    threadUpdates: { create: [], resolveIds: [], dormantIds: [] },
    chapterSummary: { keyEvents: [], characterChanges: [], relationshipChanges: [], unresolvedQuestions: [] },
  }));
  let current = before;
  for (let index = 0; index < outputs.length; index += 1) {
    current = reduceWorldState(current, outputs[index], { chapterId: `chapter-${index}`, endYear: 2026 + index, now, newId: () => `issue-${index}` });
  }
  assert.equal(current.characters.p1.relationshipHistory.length, 12);
  assert.equal(current.characters.n1.relationshipHistory.length, 12);
  assert.equal(before.characters.p1.relationshipHistory, undefined);
  assert.equal(before.characters.n1.relationshipHistory, undefined);
});

test("V2.1: Dialogue Prompt 只包含公开角色和 canonical 事件", async () => {
  const { buildDialoguePrompt } = await load("game/dialogue-writer.js");
  const prompt = buildDialoguePrompt({
    world: world(),
    events: [{ id: "event-1", year: 2027, title: "去留谈话", summary: "双方讨论是否异地", participantIds: ["p1", "n1"], characterChanges: [], relationshipChanges: [] }],
    novelScenes: [{ id: "scene-1", heading: "夜谈", timeLabel: "2027.03", text: "两个人在雨夜谈到未来。" }],
  });
  assert.match(prompt, /去留谈话/);
  assert.match(prompt, /张明/);
  assert.ok(!prompt.includes("privateState"));
  assert.ok(!prompt.includes("不想异地"));
  assert.ok(!prompt.includes("职业停滞"));
  assert.match(prompt, /结构硬约束/);
});

test("V2.1: Dialogue 解析将短别名映射为真实角色并补齐头像", async () => {
  const { parseDialogue } = await load("game/dialogue-writer.js");
  const parsed = parseDialogue({ scenes: [{
    id: "scene-1", background: "urban-home-apartment-night-v1", timeLabel: "2027.03",
    characters: [{ characterId: "C1", position: "left" }, { characterId: "C2", position: "right" }],
    blocks: [
      { type: "narration", text: "雨落在窗上。" },
      { type: "dialogue", speakerId: "C2", text: "你真的决定留下吗？", emotion: "克制" },
    ], choices: [],
  }] }, {
    world: world(),
    events: [{ id: "event-1", year: 2027, title: "去留谈话", summary: "双方讨论是否异地", participantIds: ["p1", "n1"], characterChanges: [], relationshipChanges: [] }],
    novelScenes: [{ id: "scene-1", heading: "夜谈", timeLabel: "2027.03", text: "两个人在雨夜谈到未来。" }],
  });
  assert.equal(parsed[0].characters[0].id, "p1");
  assert.equal(parsed[0].blocks[1].speakerId, "n1");
  assert.equal(parsed[0].blocks[1].speaker, "林雨");
  assert.equal(parsed[0].blocks[1].avatar, undefined);
  assert.equal(parsed[0].choices.length, 0);
});

test("V2.1: Dialogue 解析拒绝幽灵角色和非法块类型", async () => {
  const { parseDialogue } = await load("game/dialogue-writer.js");
  const input = {
    world: world(),
    events: [{ id: "event-1", year: 2027, title: "去留谈话", summary: "双方讨论是否异地", participantIds: ["p1", "n1"], characterChanges: [], relationshipChanges: [] }],
    novelScenes: [{ id: "scene-1", timeLabel: "2027.03", text: "两个人在雨夜谈到未来。" }],
  };
  assert.throws(() => parseDialogue({ scenes: [{ id: "scene-1", background: "urban-home-apartment-night-v1", characters: [], blocks: [{ type: "dialogue", speakerId: "C9", text: "不存在的人", emotion: "冷淡" }], choices: [] }] }, input), /未知角色别名/);
  assert.throws(() => parseDialogue({ scenes: [{ id: "scene-1", background: "urban-home-apartment-night-v1", characters: [], blocks: [{ type: "monologue", text: "非法" }], choices: [] }] }, input), /非法 block type/);
});

test("V2.1: Dialogue 降级结果按 NovelScene 生成注册场景和旁白块", async () => {
  const { buildFallbackDialogueScenes } = await load("game/dialogue-writer.js");
  const result = buildFallbackDialogueScenes({
    world: world(),
    events: [],
    novelScenes: [
      { id: "scene-1", heading: "办公室", timeLabel: "2027.03", text: "你走进办公室。" },
      { id: "scene-2", heading: "雨夜", timeLabel: "2027.08", text: "雨落下来。" },
    ],
  });
  assert.equal(result.length, 2);
  assert.equal(result[0].background, "urban-work-office-day-v1");
  assert.equal(result[1].background, "urban-public-cafe-rain-v1");
  assert.equal(result[0].blocks[0].type, "narration");
  assert.equal(result[0].blocks[0].text, "你走进办公室。");
});

test("V2.1: 页面已接入模式入口、Dialogue API 和 Chapter.dialogue", () => {
  const lifeApp = readFileSync(join(process.cwd(), "components", "life", "LifeApp.tsx"), "utf8");
  const summary = readFileSync(join(process.cwd(), "components", "life", "ChapterSummary.tsx"), "utf8");
  assert.match(lifeApp, /ModeSelect/);
  assert.match(lifeApp, /presentationMode/);
  assert.match(lifeApp, /\/api\/chapter\/dialogue/);
  assert.match(summary, /chapter\.dialogue/);
  assert.match(summary, /presentationMode/);
});
