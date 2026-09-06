import assert from "node:assert/strict";
import test from "node:test";

const buildDir = process.env.CHOICE_CONTRACT_TEST_DIR || ".tmp/test-all";

async function load() {
  return import(new URL(`../${buildDir}/game/choice-generator.js`, import.meta.url).href);
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
