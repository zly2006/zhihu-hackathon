import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ModelConversationMessage } from "./types";

const DEFAULT_ENDPOINT = "https://opencode.ai/zen/go/v1/chat/completions";
const DEFAULT_MODEL = "deepseek-v4-flash";
const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
export type ModelProgress = {
  stage: "connected" | "generating" | "complete" | "retrying";
  elapsedMs: number;
  firstTokenMs: number | null;
  completionTokens: number;
  tokenCountEstimated: boolean;
  tokensPerSecond: number;
  retryAttempt: number;
  retryReason?: string;
  promptCacheHitTokens: number;
  promptCacheMissTokens: number;
};

export type ModelMessage = ModelConversationMessage;
type CallOptions = {
  onProgress?: (progress: ModelProgress) => void;
  signal?: AbortSignal;
  prefixMessages?: ModelMessage[];
  appendMessages?: ModelMessage[];
  onCompletedMessage?: (content: string) => void;
  slowRetryAttempt?: number;
  maxTokens?: number;
  timeoutMs?: number;
};
function environment(name: string) {
  return process.env[name];
}

function reasoningEffort() {
  const value = environment("CPA_REASONING_EFFORT") || "low";
  if (value !== "low" && value !== "medium" && value !== "high") {
    throw new Error("CPA_REASONING_EFFORT 必须是 low、medium 或 high");
  }
  return value;
}

type ModelProvider = "opencodego" | "deepseek";

function providerConfig() {
  const provider = (environment("MODEL_PROVIDER") || "opencodego") as ModelProvider;
  if (provider === "deepseek") {
    return {
      provider,
      endpoint: environment("DEEPSEEK_ENDPOINT") || DEEPSEEK_ENDPOINT,
      model: environment("DEEPSEEK_MODEL") || DEFAULT_MODEL,
      apiKey: environment("DEEPSEEK_API_KEY") || "",
    };
  }
  if (provider === "opencodego") {
    return {
      provider,
      endpoint: environment("CPA_ENDPOINT") || DEFAULT_ENDPOINT,
      model: environment("CPA_MODEL") || DEFAULT_MODEL,
      apiKey: environment("CPA_API_KEY") || "",
    };
  }
  throw new Error("MODEL_PROVIDER 必须是 opencodego 或 deepseek");
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (typeof part === "object" && part && "text" in part ? String(part.text) : ""))
    .join("");
}

function estimatedTokens(text: string) {
  let tokens = 0;
  let latinRun = 0;
  for (const character of text) {
    if (/\p{Script=Han}/u.test(character)) {
      tokens += 1;
      latinRun = 0;
    } else if (/\s/u.test(character)) {
      if (latinRun) tokens += Math.ceil(latinRun / 4);
      latinRun = 0;
    } else latinRun += 1;
  }
  return Math.max(0, tokens + Math.ceil(latinRun / 4));
}

function callLogPath(startedAt: Date, purpose: string) {
  const logDirectory =
    environment("LLM_CALL_LOG_DIR") || path.join(process.cwd(), ".tmp", "llm-calls");
  fs.mkdirSync(logDirectory, { recursive: true });
  const timestamp = startedAt.toISOString().replace(/[:.]/g, "-");
  const safePurpose =
    purpose
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32) || "call";
  return path.join(
    logDirectory,
    `llm-call-${timestamp}-${safePurpose}-${randomUUID().slice(0, 8)}.log`,
  );
}

export async function callGameModel<T>(
  purpose: string,
  system: string,
  prompt: string,
  options: CallOptions = {},
): Promise<T> {
  const provider = providerConfig();
  const { endpoint, model } = provider;
  const effort = reasoningEffort();
  const startedAt = new Date();
  const startedClock = performance.now();
  const logPath = callLogPath(startedAt, purpose);
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 90_000);
  const retryAttempt = options.slowRetryAttempt || 0;
  let httpStatus: number | null = null;
  let rawHttpResponse = "";
  let modelContent = "";
  let parsedResponse: T | null = null;
  let terminalError = "";
  let firstTokenMs: number | null = null;
  let completionTokens = 0;
  let tokenCountEstimated = true;
  let tokensPerSecond = 0;
  let lastProgressAt = 0;
  let slowStreamDetected = false;
  let promptCacheHitTokens = 0;
  let promptCacheMissTokens = 0;
  const messages = [
    { role: "system", content: system },
    ...(options.prefixMessages || []),
    { role: "user", content: prompt },
    ...(options.appendMessages || []),
  ];

  const progress = (stage: ModelProgress["stage"], force = false) => {
    const elapsedMs = Math.round(performance.now() - startedClock);
    if (!force && elapsedMs - lastProgressAt < 250) return;
    lastProgressAt = elapsedMs;
    const measuredTokens = completionTokens || estimatedTokens(modelContent);
    const generationMs = firstTokenMs === null ? 0 : Math.max(1, elapsedMs - firstTokenMs);
    tokensPerSecond = generationMs
      ? Number((measuredTokens / (generationMs / 1000)).toFixed(1))
      : 0;
    options.onProgress?.({
      stage,
      elapsedMs,
      firstTokenMs,
      completionTokens: measuredTokens,
      tokenCountEstimated,
      tokensPerSecond,
      retryAttempt,
      promptCacheHitTokens,
      promptCacheMissTokens,
    });
  };

  const slowStreamMonitor = setInterval(() => {
    if (provider.provider !== "deepseek" || slowStreamDetected) return;
    const elapsedMs = performance.now() - startedClock;
    if (elapsedMs <= 10_000) return;
    const measuredTokens = completionTokens || estimatedTokens(modelContent);
    const generationMs = firstTokenMs === null ? elapsedMs : elapsedMs - firstTokenMs;
    const currentTokensPerSecond = generationMs > 0 ? measuredTokens / (generationMs / 1000) : 0;
    tokensPerSecond = Number(currentTokensPerSecond.toFixed(1));
    if (currentTokensPerSecond < 10) {
      slowStreamDetected = true;
      controller.abort();
    }
  }, 250);

  try {
    if (!provider.apiKey) {
      throw new Error(
        `未配置 ${provider.provider === "deepseek" ? "DEEPSEEK_API_KEY" : "CPA_API_KEY"}，无法调用大模型`,
      );
    }
    const providerOptions =
      provider.provider === "deepseek"
        ? { thinking: { type: "disabled" }, response_format: { type: "json_object" } }
        : { reasoning_effort: effort };
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.65,
        max_tokens: options.maxTokens ?? 3200,
        ...providerOptions,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    httpStatus = response.status;
    if (!response.ok) {
      rawHttpResponse = await response.text();
      throw new Error(
        `大模型接口返回 HTTP ${response.status} ${response.statusText || "Unknown Status"}`,
      );
    }
    if (!response.body) throw new Error("大模型接口没有返回流式响应正文");
    progress("connected", true);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let activityContent = "";
    const consumeLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") return;
      let payload: {
        choices?: Array<{ delta?: { content?: unknown; reasoning_content?: unknown } }>;
        usage?: {
          completion_tokens?: number;
          prompt_cache_hit_tokens?: number;
          prompt_cache_miss_tokens?: number;
        };
        error?: { message?: string };
      };
      try {
        payload = JSON.parse(data);
      } catch {
        throw new Error("大模型流中包含无法解析的 JSON 数据");
      }
      if (payload.error) throw new Error(payload.error.message || "大模型流返回错误");
      const delta = payload.choices?.[0]?.delta;
      const content = contentText(delta?.content);
      const reasoning = contentText(delta?.reasoning_content);
      if (content || reasoning) {
        if (firstTokenMs === null) firstTokenMs = Math.round(performance.now() - startedClock);
        modelContent += content;
        activityContent += content || reasoning;
        if (tokenCountEstimated) completionTokens = estimatedTokens(activityContent);
        progress("generating");
      }
      if (typeof payload.usage?.completion_tokens === "number") {
        completionTokens = payload.usage.completion_tokens;
        tokenCountEstimated = false;
      }
      if (typeof payload.usage?.prompt_cache_hit_tokens === "number")
        promptCacheHitTokens = payload.usage.prompt_cache_hit_tokens;
      if (typeof payload.usage?.prompt_cache_miss_tokens === "number")
        promptCacheMissTokens = payload.usage.prompt_cache_miss_tokens;
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      rawHttpResponse += chunk;
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) consumeLine(line);
    }
    buffer += decoder.decode();
    if (buffer.trim()) consumeLine(buffer);
    modelContent = modelContent.trim();
    progress("complete", true);
    if (!modelContent.startsWith("{") || !modelContent.endsWith("}"))
      throw new Error("大模型未返回完整 JSON 对象");
    try {
      parsedResponse = JSON.parse(modelContent) as T;
    } catch {
      throw new Error("大模型返回的 JSON 无法解析");
    }
    options.onCompletedMessage?.(modelContent);
    return parsedResponse;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError" && slowStreamDetected) {
      terminalError = "DeepSeek API 持续超过 10 秒且速度低于 10 token/s";
      if (retryAttempt < 1 && !options.signal?.aborted) {
        options.onProgress?.({
          stage: "retrying",
          elapsedMs: Math.round(performance.now() - startedClock),
          firstTokenMs,
          completionTokens: completionTokens || estimatedTokens(modelContent),
          tokenCountEstimated,
          tokensPerSecond,
          retryAttempt: retryAttempt + 1,
          retryReason: terminalError,
          promptCacheHitTokens,
          promptCacheMissTokens,
        });
        return callGameModel<T>(purpose, system, prompt, {
          ...options,
          slowRetryAttempt: retryAttempt + 1,
        });
      }
    } else if (error instanceof Error && error.name === "AbortError") {
      terminalError = options.signal?.aborted ? "大模型请求已取消" : "大模型请求超时";
    } else terminalError = error instanceof Error ? error.message : "大模型请求失败";
    throw new Error(terminalError);
  } finally {
    clearTimeout(timeout);
    clearInterval(slowStreamMonitor);
    options.signal?.removeEventListener("abort", abortFromCaller);
    const endedAt = new Date();
    const log = [
      "LLM CALL AUDIT",
      `purpose: ${purpose}`,
      `provider: ${provider.provider}`,
      `model: ${model}`,
      `reasoning_effort: ${provider.provider === "deepseek" ? "thinking-disabled" : effort}`,
      `retry_attempt: ${retryAttempt}`,
      `endpoint: ${endpoint}`,
      `started_at: ${startedAt.toISOString()}`,
      `ended_at: ${endedAt.toISOString()}`,
      `duration_ms: ${Math.round(performance.now() - startedClock)}`,
      `http_status: ${httpStatus ?? "n/a"}`,
      `first_token_ms: ${firstTokenMs ?? "n/a"}`,
      `completion_tokens: ${completionTokens}`,
      `prompt_cache_hit_tokens: ${promptCacheHitTokens}`,
      `prompt_cache_miss_tokens: ${promptCacheMissTokens}`,
      `token_count_estimated: ${tokenCountEstimated}`,
      `tokens_per_second: ${tokensPerSecond}`,
      `error: ${terminalError || "none"}`,
      "",
      "===== SYSTEM PROMPT =====",
      system,
      "",
      "===== FULL APPEND-ONLY CONVERSATION =====",
      messages.map((message) => `${message.role.toUpperCase()}:\n${message.content}`).join("\n\n"),
      "",
      "===== RAW HTTP RESPONSE =====",
      rawHttpResponse || "<empty>",
      "",
      "===== MODEL CONTENT =====",
      modelContent || "<empty>",
      "",
      "===== PARSED RESPONSE =====",
      parsedResponse === null ? "<unavailable>" : JSON.stringify(parsedResponse, null, 2),
      "",
    ].join("\n");
    fs.writeFileSync(logPath, log, { encoding: "utf8", mode: 0o600 });
  }
}
