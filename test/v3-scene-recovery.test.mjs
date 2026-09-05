import assert from "node:assert/strict";
import test from "node:test";

const buildDir = process.env.V3_TEST_DIR || ".tmp/test-all";
async function load(file) {
  return import(new URL(`../${buildDir}/game/${file}.js`, import.meta.url).href);
}

test("pending chapter recovery rebuilds the original choice and evidence projection", async () => {
  const { recoverChapterChoice, recoverSelection, recoverEvidenceBundle, pendingSpan } = await load("pending-chapter");
  const fixture = await import(new URL("./fixtures/scene-runtime-fixture.mjs", import.meta.url).href);
  const pending = {
    executionId: "execution-1",
    chapterId: "chapter-1",
    startYear: 2026,
    endYear: 2029,
    stateBeforeHash: "before",
    stateAfterHash: "after",
    worldStateBefore: fixture.makeWorld(),
    worldStateAfter: fixture.makeWorld({ currentYear: 2029 }),
    selection: {
      id: "choice-1",
      promptTitle: "测试抉择",
      context: "测试上下文",
      options: [
        { id: "A", label: "选项 A", description: "说明", strategyTag: "守成", estimatedRisk: 20, stateFit: "顺势" },
        { id: "B", label: "选项 B", description: "说明", strategyTag: "转向", estimatedRisk: 50, stateFit: "可行" },
        { id: "C", label: "选项 C", description: "说明", strategyTag: "冒险", estimatedRisk: 80, stateFit: "吃力" },
      ],
      selectedOptionId: "B",
      normalizedAction: "选项 B",
    },
    eventIds: [],
    evidenceIds: ["experience-1"],
    featuredExperienceIds: ["experience-1"],
    stage: "novel",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const choice = recoverChapterChoice(pending);
  assert.equal(choice?.id, "choice-1");
  assert.equal(choice?.options.length, 3);
  assert.deepEqual(recoverSelection(pending), { optionId: "B" });
  assert.equal(pendingSpan(pending), 3);
  const bundle = recoverEvidenceBundle({ experienceCache: { "experience-1": { id: "experience-1" } } }, pending);
  assert.equal(bundle.total, 1);
  assert.deepEqual(bundle.backgroundSimilar.map((item) => item.id), ["experience-1"]);
});

test("pending recovery rejects incomplete chapter decisions", async () => {
  const { recoverChapterChoice, recoverSelection } = await load("pending-chapter");
  assert.equal(recoverChapterChoice({}), null);
  assert.equal(recoverSelection({}), null);
});
