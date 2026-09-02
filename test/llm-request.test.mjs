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
  assert.match(source, /transientStreamError/, "必须识别瞬时传输错误并自动重试一次");
  assert.match(source, /模型服务连接中断/, "瞬时错误必须映射为友好提示，不得把原始 terminated 透传到 UI");
  assert.match(source, /isRateLimit/, "必须识别 HTTP 429 限流");
  assert.match(source, /模型服务繁忙，请稍等 1-2 分钟后重试/, "429 二次失败后必须是友好提示");
  assert.match(source, /await sleep\(waitMs\)/, "429 重试前必须有退避等待");
  assert.match(source, /isUsageLimit/, "必须识别用量上限（GoUsageLimitError）");
  assert.match(source, /模型用量已达上限/, "用量上限必须提示重置时长，不做无效重试");
});
