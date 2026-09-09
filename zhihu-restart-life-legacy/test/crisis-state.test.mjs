import assert from "node:assert/strict";
import test from "node:test";
import { newlyZeroedCrises } from "../lib/mechanics.ts";

const before = {
  age: 30,
  cash: 8,
  health: 8,
  happiness: 5,
  knowledge: 5,
  connections: 4,
  career: 6,
  assets: 9,
};

test("reports qualifying positive-to-zero transitions", () => {
  assert.deepEqual(
    newlyZeroedCrises(before, {
      ...before,
      cash: 0,
      health: 0,
      happiness: 0,
      connections: 0,
      career: 0,
      assets: 0,
    }),
    ["cash", "health", "happiness", "connections", "career", "assets"],
  );
});

test("does not report knowledge, initial zero assets, or an underage career transition", () => {
  assert.deepEqual(
    newlyZeroedCrises(
      { ...before, age: 14, assets: 0 },
      { ...before, age: 14, assets: 0, knowledge: 0, career: 0 },
    ),
    [],
  );
});
