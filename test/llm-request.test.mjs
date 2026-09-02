import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("DeepSeek requests disable thinking and reserve a complete JSON response budget", () => {
  const source = readFileSync(new URL("../lib/llm.ts", import.meta.url), "utf8");

  assert.match(source, /thinking:\s*\{\s*type:\s*"disabled"\s*\}/);
  assert.match(source, /response_format:\s*\{\s*type:\s*"json_object"\s*\}/);
  assert.match(source, /max_tokens:\s*options\.maxTokens \?\? 4096/);
  assert.match(source, /setTimeout\(\(\) => controller\.abort\(\), options\.timeoutMs \?\? 180_000\)/);
  assert.match(source, /fenceMatch/, "必须剥离模型输出的 Markdown 代码围栏（opencodego 网关无 json_object 约束）");
});
