import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("DeepSeek requests disable thinking and reserve a complete JSON response budget", () => {
  const source = readFileSync(new URL("../lib/llm.ts", import.meta.url), "utf8");

  assert.match(source, /thinking:\s*\{\s*type:\s*"disabled"\s*\}/);
  assert.match(source, /response_format:\s*\{\s*type:\s*"json_object"\s*\}/);
  assert.match(source, /max_tokens:\s*options\.maxTokens \?\? 4096/);
  assert.match(source, /const deadlineAt = options\.deadlineAt[\s\S]*?options\.budget\?\.phaseDeadlineAt/);
  assert.match(source, /setTimeout\(\(\) => controller\.abort\(\), Math\.max\(1, callTimeoutMs\)\)/);
  assert.match(source, /fenceMatch/, "必须剥离模型输出的 Markdown 代码围栏（opencodego 网关无 json_object 约束）");
  assert.match(source, /transientStreamError/, "必须识别瞬时传输错误并自动重试一次");
  assert.match(source, /模型服务连接中断/, "瞬时错误必须映射为友好提示，不得把原始 terminated 透传到 UI");
  assert.match(source, /isRateLimit/, "必须识别 HTTP 429 限流");
  assert.match(source, /模型服务繁忙，请稍等 1-2 分钟后重试/, "429 二次失败后必须是友好提示");
  assert.match(source, /await sleep\(waitMs\)/, "429 重试前必须有退避等待");
  assert.match(source, /isUsageLimit/, "必须识别用量上限（GoUsageLimitError）");
  assert.match(source, /模型用量已达上限/, "用量上限必须提示重置时长，不做无效重试");
});

test("DeepSeek official V4 Flash is the default provider and model", () => {
  const source = readFileSync(new URL("../lib/llm.ts", import.meta.url), "utf8");
  const envExample = readFileSync(new URL("../.env.example", import.meta.url), "utf8");

  assert.match(source, /const DEFAULT_PROVIDER = "deepseek"/);
  assert.match(source, /environment\("MODEL_PROVIDER"\) \|\| DEFAULT_PROVIDER/);
  assert.match(source, /const DEEPSEEK_ENDPOINT = "https:\/\/api\.deepseek\.com\/chat\/completions"/);
  assert.match(source, /const DEFAULT_MODEL = "deepseek-v4-flash"/);
  assert.match(envExample, /^MODEL_PROVIDER=deepseek$/m);
  assert.match(envExample, /^DEEPSEEK_ENDPOINT=https:\/\/api\.deepseek\.com\/chat\/completions$/m);
  assert.match(envExample, /^DEEPSEEK_MODEL=deepseek-v4-flash$/m);
});

test("narrative constraint corrections reuse the validator's alignment anchors", () => {
  const source = readFileSync(new URL("../lib/game.ts", import.meta.url), "utf8");

  assert.match(source, /narrativeAlignmentAnchors/, "语境修正必须复用校验器使用的情境锚点集合");
  assert.match(source, /当前情境锚点词/, "语境修正必须把实际锚点词明确告诉模型");
});

test("bounded JSON call can finish at a complete object before a slow stream tail", async () => {
  const llm = await import(new URL("../.tmp/test-all/llm.js", import.meta.url));
  const originalFetch = globalThis.fetch;
  const originalProvider = process.env.MODEL_PROVIDER;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  let slowTailTimer;
  try {
    process.env.MODEL_PROVIDER = "deepseek";
    process.env.DEEPSEEK_API_KEY = "test-key";
    globalThis.fetch = async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"{\\"ok\\":true}"}}]}\n\n'));
        slowTailTimer = setTimeout(() => controller.close(), 1200);
      },
      cancel() {
        clearTimeout(slowTailTimer);
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } });
    const startedAt = performance.now();
    const result = await llm.callGameModel("bounded-json-test", "只输出 JSON", "{}", {
      responseFormat: "json",
      maxTransportRetries: 0,
      stallPolicy: "bounded",
      firstTokenTimeoutMs: 500,
      timeoutMs: 1000,
    });
    assert.deepEqual(result, { ok: true });
    assert.ok(performance.now() - startedAt < 800, "完整 JSON 不应等待慢尾流结束");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalProvider === undefined) delete process.env.MODEL_PROVIDER;
    else process.env.MODEL_PROVIDER = originalProvider;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});
