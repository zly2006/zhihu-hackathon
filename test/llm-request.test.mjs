import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("DeepSeek requests disable thinking and reserve a complete JSON response budget", () => {
  const source = readFileSync(new URL("../lib/llm.ts", import.meta.url), "utf8");

  assert.match(source, /thinking:\s*\{\s*type:\s*"disabled"\s*\}/);
  assert.match(source, /max_tokens:\s*4096/);
  assert.match(source, /setTimeout\(\(\) => controller\.abort\(\), 180_000\)/);
});
