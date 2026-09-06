import assert from "node:assert/strict";
import test from "node:test";

const buildDir = process.env.CHAPTER_SUBMISSION_TEST_DIR || ".tmp/test-all";
async function load() {
  return import(new URL(`../${buildDir}/game/chapter-submission.js`, import.meta.url).href);
}

const selection = { optionId: "B" };

test("submission keeps one decision and request id across a pre-commit retry", async () => {
  const flow = await load();
  const submitted = flow.beginChapterSubmission({ decisionId: "decision-1", selection, requestId: "request-1", startedAt: "2026-09-06T00:00:00.000Z" });
  const failed = flow.failChapterSubmission(submitted, { message: "网络中断", finishedAt: "2026-09-06T00:00:02.000Z" });
  const retry = flow.retryChapterSubmission(failed, "2026-09-06T00:00:03.000Z");

  assert.equal(failed.phase, "failed_before_commit");
  assert.equal(retry.phase, "submitting");
  assert.equal(retry.requestId, "request-1");
  assert.equal(retry.decisionId, "decision-1");
  assert.deepEqual(retry.selection, selection);
});
test("presentation failure remains recoverable and cannot be re-chosen", async () => {
  const flow = await load();
  const submitted = flow.beginChapterSubmission({ decisionId: "decision-1", selection, requestId: "request-1", startedAt: "2026-09-06T00:00:00.000Z" });
  const committed = flow.commitChapterSubmission(submitted, { chapterId: "chapter-1", finishedAt: "2026-09-06T00:00:05.000Z" });
  const failed = flow.failChapterSubmission(committed, { message: "互动场景加载失败", finishedAt: "2026-09-06T00:00:06.000Z" });

  assert.equal(failed.phase, "presentation_failed");
  assert.equal(flow.canRechooseChapterSubmission(failed), false);
  assert.equal(flow.canResumeCommittedChapter(failed), true);
  assert.deepEqual(flow.toChapterSubmissionDiagnostic(failed), {
    requestId: "request-1",
    decisionId: "decision-1",
    chapterId: "chapter-1",
    phase: "presentation_failed",
    durationMs: 6000,
    terminal: "error",
    recovery: "resume_committed",
  });
});
