import assert from "node:assert/strict";
import test from "node:test";

const buildDir = process.env.GENERATION_ERROR_TEST_DIR || ".tmp/test-all";

async function load(file) {
  return import(new URL(`../${buildDir}/game/${file}.js`, import.meta.url));
}

test("deadline and cancellation are never classified as semantic correction", async () => {
  const { generationFailure, canRetryGeneration } = await load("generation-error");
  assert.equal(generationFailure(new Error("大模型请求超时")).category, "deadline");
  assert.equal(canRetryGeneration(new Error("大模型请求超时")), false);
  assert.equal(generationFailure(new Error("大模型请求已取消")).category, "cancelled");
  assert.equal(canRetryGeneration(new Error("大模型请求已取消")), false);
  assert.equal(generationFailure(new Error("大模型返回字段 events 缺失")).category, "schema");
  assert.equal(canRetryGeneration(new Error("大模型返回字段 events 缺失")), true);
  assert.equal(generationFailure(new Error("重大转折事件（importance≥70）最多 2 个，当前 3 个")).category, "semantic");
  assert.equal(canRetryGeneration(new Error("重大转折事件（importance≥70）最多 2 个，当前 3 个")), true);
});
