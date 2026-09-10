import test from "node:test";
import assert from "node:assert/strict";
import {
  LIFE_EVENT_LIBRARY,
  LIFE_STAGE_SEQUENCE,
  getLifeEvent,
  lifeEventForStoryStage,
  lifeStageForStoryStage,
  planLifeEvents,
  renderLifeEvent,
} from "./life-events";

test("merged life event library keeps all reviewed events and three choices each", () => {
  assert.equal(LIFE_EVENT_LIBRARY.events.length, 21);
  assert.equal(
    LIFE_EVENT_LIBRARY.events.reduce(
      (sum, event) => sum + event.options.length,
      0,
    ),
    63,
  );
  assert.equal(
    new Set(LIFE_EVENT_LIBRARY.events.map((event) => event.id)).size,
    21,
  );
  for (const event of LIFE_EVENT_LIBRARY.events)
    assert.deepEqual(
      event.options.map((option) => option.id),
      ["A", "B", "C"],
    );
});

test("seven story segments follow high school, university, and graduate order", () => {
  assert.deepEqual(LIFE_STAGE_SEQUENCE, [
    "high-school",
    "high-school",
    "university",
    "university",
    "graduate",
    "graduate",
    "graduate",
  ]);
  assert.equal(lifeStageForStoryStage(-1), "high-school");
  assert.equal(lifeStageForStoryStage(99), "graduate");
});

test("event planning is deterministic and uses campus events from the correct stage", () => {
  const first = planLifeEvents("story-seed");
  const second = planLifeEvents("story-seed");
  assert.deepEqual(first, second);
  for (const [stage, id] of Object.entries(first)) {
    const event = getLifeEvent(id);
    assert.ok(event);
    assert.ok(event.lifeStages.includes(stage as keyof typeof first));
    assert.match(id, new RegExp(`^life-${stage}`));
  }
});

test("rendered event guidance carries actions, costs, immediate results, and delayed consequences", () => {
  const plan = planLifeEvents("render-seed");
  const { event, lifeStage } = lifeEventForStoryStage(plan, 0);
  const text = renderLifeEvent(event, lifeStage);
  assert.match(text, /具体处境/);
  assert.match(text, /代价/);
  assert.match(text, /即时后果/);
  assert.match(text, /关系变化/);
  assert.match(text, /延迟收益/);
  assert.match(text, /延迟风险/);
  assert.match(text, /A\./);
  assert.match(text, /B\./);
  assert.match(text, /C\./);
});
