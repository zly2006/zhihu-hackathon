import assert from "node:assert/strict";
import test from "node:test";

test("assigns each unassigned experience to the least-populated option", async () => {
  const { completeExperienceCoverage } = await import("../lib/experience-coverage.ts");
  const options = [
    { experienceIds: ["one", "two", "three"] },
    { experienceIds: ["four", "five", "six"] },
    { experienceIds: ["seven", "eight", "nine"] },
  ];

  completeExperienceCoverage(options, ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"]);

  assert.deepEqual(options.map((option) => option.experienceIds), [
    ["one", "two", "three", "ten"],
    ["four", "five", "six", "eleven"],
    ["seven", "eight", "nine", "twelve"],
  ]);
});
