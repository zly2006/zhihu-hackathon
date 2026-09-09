import assert from "node:assert/strict";
import test from "node:test";
import { applyDebugState } from "../lib/mechanics.ts";

const state = {
  age: 30,
  cash: 20,
  health: 50,
  happiness: 40,
  knowledge: 60,
  connections: 30,
  career: 25,
  assets: 10,
};

test("applies a bounded integer draft and reports newly zeroed crises", () => {
  const result = applyDebugState(state, {
    cash: -5,
    health: 101.8,
    happiness: 0,
    knowledge: 49.6,
    connections: Number.NaN,
    career: 0,
    assets: 8,
  });

  assert.deepEqual(result.state, {
    ...state,
    cash: 0,
    health: 100,
    happiness: 0,
    knowledge: 50,
    connections: 30,
    career: 0,
    assets: 8,
  });
  assert.deepEqual(result.crisisKeys, ["cash", "happiness", "career"]);
});

test("does not report a resource that was already zero", () => {
  const result = applyDebugState(
    { ...state, cash: 0 },
    {
      ...state,
      cash: 0,
      health: 50,
      happiness: 40,
      knowledge: 60,
      connections: 30,
      career: 25,
      assets: 10,
    },
  );

  assert.deepEqual(result.crisisKeys, []);
});
