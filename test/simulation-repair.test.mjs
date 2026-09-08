import assert from "node:assert/strict";
import test from "node:test";

const buildDir = process.env.SIMULATION_REPAIR_TEST_DIR || ".tmp/test-all";

async function load(file) {
  return import(new URL(`../${buildDir}/game/${file}.js`, import.meta.url));
}

test("reference repair is candidate-hash bound and limited to whitelisted replace paths", async () => {
  const repair = await load("simulation-reference-repair");
  const candidate = {
    events: [{ resolvesThreadIds: ["T9", "T1"], createsThreadLabels: ["T9"] }],
    threadUpdates: { resolveIds: ["T1"], dormantIds: [] },
  };
  const candidateHash = repair.hashSimulationCandidate(candidate);
  const fixed = repair.applyReferenceRepair(candidate, {
    candidateHash,
    patches: [
      { op: "replace", path: "events[0].resolvesThreadIds[0]", value: "T1" },
      { op: "replace", path: "events[0].createsThreadLabels[0]", value: "T1" },
    ],
  });
  assert.equal(fixed.events[0].resolvesThreadIds[0], "T1");
  assert.equal(fixed.events[0].createsThreadLabels[0], "T1");
  assert.notEqual(fixed, candidate);
  assert.throws(
    () => repair.applyReferenceRepair(candidate, {
      candidateHash: "wrong-hash",
      patches: [{ op: "replace", path: "events[0].resolvesThreadIds[0]", value: "T1" }],
    }),
    /candidateHash|候选|hash/i,
  );
  assert.throws(
    () => repair.applyReferenceRepair(candidate, {
      candidateHash,
      patches: [{ op: "replace", path: "events[0].characterChanges[0].statDelta.cash", value: 99 }],
    }),
    /whitelist|允许|引用路径/i,
  );
});

test("reference repair is deferred when the same candidate already violates the major-event limit", async () => {
  const service = await load("chapter-simulation-service");
  assert.equal(service.canAttemptReferenceRepair({
    events: [{ importance: 70 }, { importance: 72 }, { importance: 85 }],
  }), false);
  assert.equal(service.canAttemptReferenceRepair({
    events: [{ importance: 70 }, { importance: 69 }, { importance: 85 }],
  }), true);
});
