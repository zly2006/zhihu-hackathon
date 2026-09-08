import assert from "node:assert/strict";
import test from "node:test";

const buildDir = process.env.CHOICE_CONTRACT_TEST_DIR || ".tmp/test-all";

async function load() {
  return import(new URL(`../${buildDir}/game/choice-generator.js`, import.meta.url).href);
}

async function loadFixture() {
  return import(new URL("./fixtures/scene-runtime-fixture.mjs", import.meta.url).href);
}

function modeledChoice(context) {
  return {
    promptTitle: "毕业前的十字路口",
    context,
    options: [
      { id: "A", label: "争取线长职位", description: "向主管表达晋升意愿并学习管理技能。", strategyTag: "内部晋升", estimatedRisk: 35, stateFit: "顺势" },
      { id: "B", label: "赴上海交流", description: "请假参加交流会，探索新的职业机会。", strategyTag: "外部探索", estimatedRisk: 56, stateFit: "可行" },
      { id: "C", label: "和父亲协商", description: "共同制定家庭的经济应急计划。", strategyTag: "家庭协同", estimatedRisk: 43, stateFit: "可行" },
    ],
  };
}

test("chapter choice keeps a 206-character committed context byte-for-byte", async () => {
  const choice = await load();
  const context = "困".repeat(206);
  const parsed = choice.validateChapterChoice(modeledChoice(context));
  assert.equal(parsed.context, context);
  assert.equal(parsed.context.length, 206);
  assert.deepEqual(parsed.options.map((option) => option.id), ["A", "B", "C"]);
});
test("chapter choice rejects over-limit text instead of silently shortening it", async () => {
  const choice = await load();
  assert.throws(
    () => choice.validateChapterChoice(modeledChoice("困".repeat(1201))),
    /context.*最多 1200 字/,
  );
});

test("chapter choice retries one schema failure inside a bounded generation budget", async () => {
  const [choice, fixture] = await Promise.all([load(), loadFixture()]);
  const prompts = [];
  let calls = 0;
  const result = await choice.generateChapterChoice(fixture.makeWorld(), 1, {
    model: async (_purpose, _system, prompt) => {
      prompts.push(prompt);
      calls += 1;
      const modeled = modeledChoice("一个具体的当下困境");
      if (calls === 1) modeled.options[2].strategyTag = modeled.options[1].strategyTag;
      return modeled;
    },
  });
  assert.equal(calls, 2);
  assert.match(prompts[1], /程序校验反馈|重新输出/);
  assert.equal(result.options.length, 3);
});
