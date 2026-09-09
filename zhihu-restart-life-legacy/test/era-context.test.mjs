import assert from "node:assert/strict";
import test from "node:test";
import { selectEraContext } from "../lib/era.ts";
import { settleChoice } from "../lib/mechanics.ts";

const profile = (birthYear, hometown = "普通城市") => ({
  name: "测试玩家",
  birthYear,
  gender: "不设定",
  hometown,
  family: "普通工薪",
  precision: 1,
  talents: { insight: 3, charm: 3, grit: 3, learning: 3, luck: 3 },
});

const state = (age, overrides = {}) => ({
  age,
  cash: 40,
  health: 60,
  happiness: 50,
  knowledge: 30,
  connections: 30,
  career: 30,
  assets: 30,
  ...overrides,
});

test("matches the COVID context by calendar year and age frame", () => {
  const context = selectEraContext(profile(1998), state(22), []);
  assert.equal(context?.id, "covid-2019");
  assert.equal(context?.year, 2020);
  assert.match(context?.ageFrame || "", /毕业|实习|求职/);
});

test("uses a different age frame for a child in the same era", () => {
  const context = selectEraContext(profile(2010), state(10), []);
  assert.equal(context?.id, "covid-2019");
  assert.equal(context?.domain, "education");
  assert.match(context?.ageFrame || "", /网课|学习/);
});

test("does not repeat an era context on consecutive nodes", () => {
  const context = selectEraContext(profile(1998), state(22), [{ eraContextId: "covid-2019" }]);
  assert.equal(context, null);
});

test("matches the financial crisis for an adult in 2009", () => {
  const context = selectEraContext(profile(1980), state(29), []);
  assert.equal(context?.id, "financial-crisis-2008");
  assert.equal(context?.year, 2009);
  assert.equal(context?.domain, "career");
});

test("applies the selected era mechanism during settlement", () => {
  const context = selectEraContext(profile(1998), state(22), []);
  const option = {
    id: "A",
    label: "保护健康",
    description: "",
    tone: "稳",
    effects: {
      cash: 0,
      health: 0,
      happiness: 0,
      knowledge: 0,
      connections: 0,
      career: 0,
      assets: 0,
    },
    setbackEffects: {
      cash: -1,
      health: -1,
      happiness: 0,
      knowledge: 0,
      connections: 0,
      career: 0,
      assets: 0,
    },
    result: "",
    experienceIds: [],
    strategyTag: "保护",
    baseRisk: 20,
    stateFit: "可行",
    stateReason: "",
    setback: "",
    eraContextId: "covid-2019",
    eraMechanism: "protect",
  };
  const settled = settleChoice(state(22), profile(1998), option, 99, context);
  assert.equal(settled.riskOccurred, false);
  assert.equal(settled.effects.health, 1);
});
