import assert from "node:assert/strict";
import test from "node:test";

const buildDir = process.env.NPC_GENERATOR_TEST_DIR || ".tmp/test-all";

async function load(file) {
  return import(new URL(`../${buildDir}/game/${file}.js`, import.meta.url));
}

async function protagonist() {
  const { createProtagonist } = await load("character-factory");
  return createProtagonist({
    name: "主角",
    birthYear: 2008,
    gender: "男",
    hometown: "武汉",
    familyBackground: "普通家庭",
    initialCity: "深圳",
    initialDirection: "学生",
    personalityTraits: ["谨慎", "务实", "念旧"],
    values: ["稳定", "家庭"],
    longTermGoal: "在城市立足",
    initialDilemma: "毕业压力",
    talents: { insight: 50, charm: 50, grit: 50, learning: 50, luck: 50 },
  });
}

function npc(overrides = {}) {
  return {
    name: "测试角色",
    gender: "女",
    age: 30,
    relationshipType: "family",
    basicSetting: "与主角保持联系的家人",
    personalityTraits: ["稳重", "善于倾听"],
    values: ["家庭"],
    hiddenGoal: "完成自己的计划",
    hiddenConcern: "担心关系疏远",
    privateBelief: "重要的事要说清楚",
    ...overrides,
  };
}

test("NPC array fields normalize only an unambiguous delimited string", async () => {
  const { validateNpcs } = await load("npc-generator");
  const parsed = validateNpcs({
    npcs: [
      npc(),
      npc({ relationshipType: "friend" }),
      npc({ relationshipType: "coworker", personalityTraits: "理性、直接" }),
    ],
  });
  assert.deepEqual(parsed[2].personalityTraits, ["理性", "直接"]);

  assert.throws(
    () => validateNpcs({ npcs: [npc(), npc({ relationshipType: "friend" }), npc({ relationshipType: "coworker", personalityTraits: "," })] }),
    /数组|至少|可明确拆分/,
  );
  assert.throws(
    () => validateNpcs({ npcs: [npc(), npc({ relationshipType: "friend" }), npc({ relationshipType: "coworker", personalityTraits: ["理性", 3] })] }),
    /数组项|字符串/,
  );
});

test("NPC generation retries one schema failure inside one bounded budget", async () => {
  const { generateNpcs } = await load("npc-generator");
  const character = await protagonist();
  let calls = 0;
  const prompts = [];
  const result = await generateNpcs(character, {
    model: async (_purpose, _system, prompt) => {
      calls += 1;
      prompts.push(prompt);
      return {
        npcs: [
          npc(),
          npc({ relationshipType: "friend" }),
          npc({ relationshipType: "coworker", personalityTraits: calls === 1 ? "," : ["理性", "直接"] }),
        ],
      };
    },
  });
  assert.equal(calls, 2);
  assert.deepEqual(result[2].personalityTraits, ["理性", "直接"]);
  assert.match(prompts[1], /程序校验反馈/);
});

test("NPC transport retry keeps the original prompt instead of adding semantic correction", async () => {
  const { generateNpcs } = await load("npc-generator");
  const character = await protagonist();
  const prompts = [];
  let attempts = 0;
  await generateNpcs(character, {
    maxAttempts: 2,
    model: async (_purpose, _system, prompt) => {
      prompts.push(prompt);
      attempts += 1;
      if (attempts === 1) {
        const error = new Error("连接中断");
        error.category = "transport";
        error.retryable = true;
        throw error;
      }
      return { npcs: [npc(), npc({ relationshipType: "friend" }), npc({ relationshipType: "coworker" })] };
    },
  });
  assert.equal(prompts.length, 2);
  assert.equal(prompts[1], prompts[0]);
  assert.doesNotMatch(prompts[1], /程序校验反馈/);
});
