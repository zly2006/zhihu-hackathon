import assert from "node:assert/strict";
import test from "node:test";

const buildDir = process.env.EXECUTION_BUDGET_TEST_DIR || ".tmp/test-all";

async function load(file) {
  return import(new URL(`../${buildDir}/game/${file}.js`, import.meta.url));
}

test("absolute execution budget shares one deadline and counts every real request", async () => {
  const { ExecutionBudget, ExecutionBudgetError } = await load("execution-budget");
  let now = 10_000;
  const budget = new ExecutionBudget({
    executionId: "exec-annual-1",
    deadlineAt: 10_225,
    maxRequests: 2,
    now: () => now,
  });

  const first = budget.reserve("world-simulation");
  const second = budget.reserve("world-reference-repair");
  assert.equal(first.executionId, "exec-annual-1");
  assert.equal(first.requestId, "exec-annual-1:request:1");
  assert.equal(second.requestId, "exec-annual-1:request:2");
  assert.equal(budget.snapshot().requestsStarted, 2);
  assert.equal(budget.remainingMs(), 225);

  assert.throws(
    () => budget.reserve("world-semantic-retry"),
    (error) => error instanceof ExecutionBudgetError && error.code === "REQUEST_BUDGET_EXHAUSTED",
  );

  now = 10_226;
  assert.throws(
    () => budget.assertCanStart("late-request"),
    (error) => error instanceof ExecutionBudgetError && error.code === "DEADLINE_EXCEEDED",
  );
});

test("caller cancellation closes the budget and cannot be replaced by a new attempt", async () => {
  const { ExecutionBudget, ExecutionBudgetError } = await load("execution-budget");
  const controller = new AbortController();
  const budget = new ExecutionBudget({
    executionId: "exec-cancel-1",
    timeoutMs: 5_000,
    maxRequests: 2,
    signal: controller.signal,
  });
  controller.abort();
  assert.equal(budget.signal.aborted, true);
  assert.throws(
    () => budget.reserve("after-abort"),
    (error) => error instanceof ExecutionBudgetError && error.code === "CANCELLED",
  );
});

test("phase deadlines share the action clock but give the next phase its own bounded window", async () => {
  const { ExecutionBudget, ExecutionBudgetError } = await load("execution-budget");
  let now = 10_000;
  const budget = new ExecutionBudget({
    executionId: "exec-phase-1",
    deadlineAt: 10_225,
    maxRequests: 4,
    phaseLimits: { annual: 2, interactive: 2 },
    phaseTimeoutsMs: { annual: 180, interactive: 45 },
    now: () => now,
  });

  assert.equal(budget.phaseDeadlineAt("annual"), 10_180);
  budget.reserve("world-simulation", "annual");
  now = 10_181;
  assert.throws(
    () => budget.reserve("world-retry", "annual"),
    (error) => error instanceof ExecutionBudgetError && error.code === "DEADLINE_EXCEEDED",
  );

  assert.equal(budget.phaseDeadlineAt("interactive"), 10_225);
  budget.reserve("story-unit", "interactive");
  assert.equal(budget.snapshot().requestsByPhase.interactive, 1);
});
