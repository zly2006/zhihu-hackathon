import assert from "node:assert/strict";
import test from "node:test";

const base = process.env.EVENT_CONTENT_TEST_DIR || ".tmp/test-all";

async function load(rel) {
  return import(new URL(`../${base}/${rel}`, import.meta.url).href);
}

test("event narrative rejects unsupported concrete currency amounts without truncating copy", async () => {
  const game = await load("game.js");

  assert.deepEqual(game.findUnsupportedCurrencyAmounts("现金余量低，预算紧张"), []);
  assert.deepEqual(game.findUnsupportedCurrencyAmounts("换主板要几百元"), ["几百元"]);
  assert.deepEqual(
    game.findUnsupportedCurrencyAmounts("维修需要几百元", "真实经历记录维修需要几百元"),
    [],
  );
  assert.deepEqual(game.findUnsupportedCurrencyAmounts("元气恢复"), []);

  const candidate = {
    title: "设备维护",
    background: "网课设备出现故障",
    dilemma: "需要继续网课同时控制家庭预算",
    detail: "设备维修会影响学习安排",
    options: [],
  };
  const state = { cash: 35 };
  assert.throws(
    () => game.validateNarrativeHygiene({ ...candidate, detail: "设备维修要几百元" }, state, null),
    /状态指数被误写成现实金额/,
  );
  assert.doesNotThrow(() => game.validateNarrativeHygiene({ ...candidate, detail: "设备维修要几百元" }, state, null, "证据写明设备维修要几百元"));
});
