import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ModelConversationMessage } from "./types";
import type { GenerationFailureCategory } from "./game/generation-error";
import { ExecutionBudgetError, type ExecutionBudget } from "./game/execution-budget";

const DEFAULT_ENDPOINT = "https://opencode.ai/zen/go/v1/chat/completions";
const DEFAULT_MODEL = "deepseek-v4-flash";
const DEFAULT_PROVIDER = "deepseek";
const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
const CCFUCK_BASE_URL = "https://api.ccfuck.me";
const FREEAPP_BASE_URL = "https://newapi.freeapp.tech";
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
export type CallOptions = {
  onProgress?: (progress: ModelProgress) => void;
  onToken?: (token: string) => void;
  signal?: AbortSignal;
  prefixMessages?: ModelMessage[];
  appendMessages?: ModelMessage[];
  onCompletedMessage?: (content: string) => void;
  slowRetryAttempt?: number;
  maxTokens?: number;
  timeoutMs?: number;
  responseFormat?: "json" | "text";
  /** Set to 0 for a single transport attempt. Undefined keeps legacy retry policy. */
  maxTransportRetries?: number;
  /** Demo writers use metadata-only audit logs so prompts and model output never persist. */
  logMode?: "metadata" | "full";
  auditMetadata?: Record<string, string | number | boolean | null | undefined>;
  /** Absolute deadline inherited from the user action. */
  deadlineAt?: number;
  /** Optional shared budget. Reserving here counts this invocation as a real request. */
  budget?: ExecutionBudget;
  budgetPhase?: string;
  requestId?: string;
  executionId?: string;
  /** New chains use a first-token deadline; they never use average-speed aborts. */
  firstTokenTimeoutMs?: number;
  stallPolicy?: "legacy" | "bounded";
};

export class ModelCallError extends Error {
  readonly code: string;
  readonly category: GenerationFailureCategory;
  readonly retryable: boolean;
  readonly committed: boolean;

  constructor(
    code: string,
    message: string,
    category: GenerationFailureCategory,
    retryable: boolean,
    committed = false,
  ) {
    super(message);
    this.name = "ModelCallError";
    this.code = code;
    this.category = category;
    this.retryable = retryable;
    this.committed = committed;
  }
}
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

type ModelProvider = "opencodego" | "deepseek" | "ccfuck" | "freeapp";

function chatCompletionsEndpoint(baseUrl: string) {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (base.endsWith("/chat/completions")) return base;
  return `${base}${base.endsWith("/v1") ? "" : "/v1"}/chat/completions`;
}

function providerConfig() {
  const provider = (environment("MODEL_PROVIDER") || DEFAULT_PROVIDER) as ModelProvider;
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
  if (provider === "ccfuck") {
    return {
      provider,
      endpoint: chatCompletionsEndpoint(environment("CCFUCK_BASE_URL") || CCFUCK_BASE_URL),
      model: environment("CCFUCK_MODEL") || DEFAULT_MODEL,
      apiKey: environment("CCFUCK_API_KEY") || "",
    };
  }
  if (provider === "freeapp") {
    return {
      provider,
      endpoint: chatCompletionsEndpoint(environment("FREEAPP_BASE_URL") || FREEAPP_BASE_URL),
      model: environment("FREEAPP_MODEL") || DEFAULT_MODEL,
      apiKey: environment("FREEAPP_API_KEY") || "",
    };
  }
  throw new Error("MODEL_PROVIDER 必须是 opencodego、deepseek、ccfuck 或 freeapp");
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
  options.budget?.signal.addEventListener("abort", abortFromCaller, { once: true });
  const deadlineAt = options.deadlineAt
    ?? options.budget?.phaseDeadlineAt(options.budgetPhase ?? "default")
    ?? options.budget?.deadlineAt;
  const requestedTimeoutMs = options.timeoutMs ?? 180_000;
  const deadlineRemainingMs = deadlineAt === undefined ? requestedTimeoutMs : Math.max(0, deadlineAt - Date.now());
  const callTimeoutMs = Math.min(requestedTimeoutMs, deadlineRemainingMs);
  const timeout = setTimeout(() => controller.abort(), Math.max(1, callTimeoutMs));
  const retryAttempt = options.slowRetryAttempt || 0;
  let reservation: { requestId: string; executionId: string; phase: string; attempt: number } | undefined;
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
  let firstTokenTimeoutDetected = false;
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

  const boundedStallPolicy = options.stallPolicy === "bounded" || options.maxTransportRetries === 0 || Boolean(options.budget);
  const slowStreamMonitor = setInterval(() => {
    if (boundedStallPolicy || provider.provider !== "deepseek" || slowStreamDetected) return;
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
  const firstTokenTimeoutMs = options.firstTokenTimeoutMs === undefined
    ? (boundedStallPolicy ? Math.min(15_000, callTimeoutMs) : undefined)
    : Math.min(options.firstTokenTimeoutMs, callTimeoutMs);
  const firstTokenMonitor = firstTokenTimeoutMs === undefined ? undefined : setInterval(() => {
    if (firstTokenMs !== null || firstTokenTimeoutDetected) return;
    if (performance.now() - startedClock >= firstTokenTimeoutMs) {
      firstTokenTimeoutDetected = true;
      controller.abort();
    }
  }, 250);

  try {
    if (!provider.apiKey) {
      const apiKeyName =
        provider.provider === "opencodego"
          ? "CPA_API_KEY"
          : provider.provider === "deepseek"
            ? "DEEPSEEK_API_KEY"
            : provider.provider === "ccfuck"
              ? "CCFUCK_API_KEY"
              : "FREEAPP_API_KEY";
      throw new Error(
        `未配置 ${apiKeyName}，无法调用大模型`,
      );
    }
    if (callTimeoutMs <= 0) {
      throw new ModelCallError("DEADLINE_EXCEEDED", "大模型请求在 deadline 前没有剩余时间", "deadline", false);
    }
    if (options.budget) {
      const request = options.budget.reserve(purpose, options.budgetPhase ?? "default");
      reservation = request;
    }
    const providerOptions =
      provider.provider === "deepseek"
        ? {
            thinking: { type: "disabled" },
            ...(options.responseFormat === "text"
              ? {}
              : { response_format: { type: "json_object" } }),
          }
        : provider.provider === "opencodego"
          ? { reasoning_effort: effort }
          : options.responseFormat === "text"
            ? {}
            : { response_format: { type: "json_object" } };
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.65,
        max_tokens: options.maxTokens ?? 4096,
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
    const tryParseCompleteJson = (): T | null => {
      if (options.responseFormat === "text") return null;
      const trimmed = modelContent.trim();
      const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
      const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;
      if (!candidate.startsWith("{") || !candidate.endsWith("}")) return null;
      try {
        const parsed = JSON.parse(candidate) as T;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    };
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
        if (content) options.onToken?.(content);
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
      for (const line of lines) {
        consumeLine(line);
        const completeJson = tryParseCompleteJson();
        if (completeJson) {
          const trimmed = modelContent.trim();
          const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
          modelContent = fenceMatch ? fenceMatch[1].trim() : trimmed;
          parsedResponse = completeJson;
          progress("complete", true);
          options.onCompletedMessage?.(modelContent);
          await reader.cancel();
          return parsedResponse;
        }
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      consumeLine(buffer);
      const completeJson = tryParseCompleteJson();
      if (completeJson) {
        const trimmed = modelContent.trim();
        const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
        modelContent = fenceMatch ? fenceMatch[1].trim() : trimmed;
        parsedResponse = completeJson;
        progress("complete", true);
        options.onCompletedMessage?.(modelContent);
        await reader.cancel();
        return parsedResponse;
      }
    }
    modelContent = modelContent.trim();
    progress("complete", true);
    if (options.responseFormat === "text") {
      if (!modelContent) throw new Error("大模型未返回文本内容");
      parsedResponse = modelContent as T;
    } else {
      // 无 response_format 约束的网关（如 opencodego）模型可能包裹 ```json ... ``` 围栏，统一剥除
      const fenceMatch = modelContent.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
      if (fenceMatch) modelContent = fenceMatch[1].trim();
      if (!modelContent.startsWith("{") || !modelContent.endsWith("}"))
        throw new Error("大模型未返回完整 JSON 对象");
      try {
        parsedResponse = JSON.parse(modelContent) as T;
      } catch {
        throw new Error("大模型返回的 JSON 无法解析");
      }
    }
    options.onCompletedMessage?.(modelContent);
    return parsedResponse;
  } catch (error) {
    if (error instanceof ExecutionBudgetError) {
      terminalError = error.message;
      throw new ModelCallError(error.code, error.message, error.code === "CANCELLED" ? "cancelled" : "deadline", false);
    }
    if (error instanceof ModelCallError) {
      terminalError = error.message;
      throw error;
    }
    // 瞬时传输错误（网关丢流 / 连接重置等）的识别：opencode-go 等代理网关长调用偶发
    const transientStreamError =
      error instanceof Error &&
      /terminated|fetch failed|ECONNRESET|socket hang up|UND_ERR_|EPIPE/i.test(error.message || "");
    const serverError = httpStatus !== null && httpStatus >= 500;
    // 限流（HTTP 429）：立即重试只会加剧限流，采用退避重试
    const isRateLimit =
      error instanceof Error && /429|Too Many Requests|rate ?limit/i.test(error.message || "");
    // 用量上限（GoUsageLimitError 等，响应体可见）：窗口内重试无用，直接给准确提示
    const isUsageLimit = isRateLimit && /UsageLimit|usage limit|balance/i.test(rawHttpResponse);
    const usageResetHint = rawHttpResponse.match(/Resets? in ([^."\]]+)/i)?.[1];
    const sleep = (ms: number) => new Promise<"elapsed" | "cancelled" | "deadline">((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const signals = [options.signal, options.budget?.signal].filter((signal): signal is AbortSignal => Boolean(signal));
      const finish = (result: "elapsed" | "cancelled" | "deadline") => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        for (const signal of signals) signal.removeEventListener("abort", onAbort);
        resolve(result);
      };
      const onAbort = () => finish("cancelled");
      for (const signal of signals) {
        if (signal.aborted) {
          finish("cancelled");
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }
      const remainingMs = deadlineAt === undefined ? ms : Math.min(ms, Math.max(0, deadlineAt - Date.now()));
      if (remainingMs <= 0) {
        finish("deadline");
        return;
      }
      timer = setTimeout(() => finish(deadlineAt !== undefined && remainingMs < ms ? "deadline" : "elapsed"), remainingMs);
    });
    const callerCancelled = Boolean(options.signal?.aborted || options.budget?.signal.aborted);
    const retryAllowed = (defaultLimit: number) =>
      !callerCancelled &&
      (options.maxTransportRetries === undefined
        ? !options.budget && retryAttempt < defaultLimit
        : retryAttempt < options.maxTransportRetries) &&
      (deadlineAt === undefined || deadlineAt - Date.now() > 100);
    if (error instanceof Error && error.name === "AbortError" && firstTokenTimeoutDetected) {
      terminalError = "模型首 token 超过 deadline";
      throw new ModelCallError("FIRST_TOKEN_TIMEOUT", terminalError, "deadline", false);
    } else if (error instanceof Error && error.name === "AbortError" && slowStreamDetected) {
      terminalError = "DeepSeek API 持续超过 10 秒且速度低于 10 token/s";
      if (retryAllowed(1)) {
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
      throw new ModelCallError("SLOW_STREAM_ABORTED", terminalError, "deadline", false);
    } else if (error instanceof Error && error.name === "AbortError") {
      terminalError = callerCancelled ? "大模型请求已取消" : "大模型请求超时";
      throw new ModelCallError(callerCancelled ? "MODEL_CANCELLED" : "DEADLINE_EXCEEDED", terminalError, callerCancelled ? "cancelled" : "deadline", false);
    } else if ((transientStreamError || serverError) && retryAllowed(1)) {
      // 网关中断：整次调用重试一次（不携带"修正"语义，避免与校验重试混淆）
      terminalError = "模型服务连接中断，正在自动重试";
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
    } else if (isRateLimit && isUsageLimit) {
      // 用量上限：退避重试无效（窗口期内必败），立即给出含重置时长的提示
      terminalError = usageResetHint
        ? `模型用量已达上限，约 ${usageResetHint} 后重置；如需立即继续请到 opencode.ai 工作区启用余额`
        : "模型用量已达上限，请稍后再试或到 opencode.ai 工作区启用余额";
      throw new ModelCallError("QUOTA_EXHAUSTED", terminalError, "quota", false);
    } else if (isRateLimit && retryAllowed(2)) {
      // 限流退避：首次等 8s、二次等 25s，然后再整次调用
      const waitMs = retryAttempt === 0 ? 8000 : 25_000;
      terminalError = `模型服务繁忙（HTTP 429），等待 ${Math.round(waitMs / 1000)} 秒后自动重试`;
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
      const waitResult = await sleep(waitMs);
      if (waitResult === "cancelled") {
        throw new ModelCallError("MODEL_CANCELLED", "大模型请求已取消", "cancelled", false);
      }
      if (waitResult === "deadline") {
        throw new ModelCallError("DEADLINE_EXCEEDED", "大模型请求在重试退避期间超过 deadline", "deadline", false);
      }
      return callGameModel<T>(purpose, system, prompt, {
        ...options,
        slowRetryAttempt: retryAttempt + 1,
      });
    } else {
      terminalError = isRateLimit
        ? "模型服务繁忙，请稍等 1-2 分钟后重试"
        : transientStreamError
          ? "模型服务连接中断，请重试"
          : error instanceof Error
            ? error.message
            : "大模型请求失败";
      const authError = /未配置|HTTP 401|HTTP 403|credential|api.?key|权限/i.test(terminalError);
      const category = isRateLimit ? "rate_limit" : authError ? "auth" : (transientStreamError || serverError) ? "transport" : "schema";
      const code = isRateLimit ? "RATE_LIMIT" : authError ? "AUTH_REQUIRED" : (transientStreamError || serverError) ? "MODEL_TRANSPORT_ERROR" : "MODEL_OUTPUT_INVALID";
      // Schema failure is retryable by the bounded outer validator. It is not
      // a transport retry: the caller decides whether one concrete correction
      // is still within its request/deadline budget.
      throw new ModelCallError(code, terminalError, category, category === "rate_limit" || category === "transport" || category === "schema");
    }
  } finally {
    clearTimeout(timeout);
    clearInterval(slowStreamMonitor);
    if (firstTokenMonitor) clearInterval(firstTokenMonitor);
    options.signal?.removeEventListener("abort", abortFromCaller);
    options.budget?.signal.removeEventListener("abort", abortFromCaller);
    const endedAt = new Date();
    const audit = [
      "LLM CALL AUDIT",
      `purpose: ${purpose}`,
      `provider: ${provider.provider}`,
      `model: ${model}`,
      `reasoning_effort: ${provider.provider === "deepseek" ? "thinking-disabled" : effort}`,
      `retry_attempt: ${retryAttempt}`,
      `request_id: ${reservation?.requestId ?? options.requestId ?? "n/a"}`,
      `execution_id: ${reservation?.executionId ?? options.executionId ?? options.budget?.executionId ?? "n/a"}`,
      `budget_phase: ${reservation?.phase ?? options.budgetPhase ?? "n/a"}`,
      `budget_attempt: ${reservation?.attempt ?? "n/a"}`,
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
      ...Object.entries(options.auditMetadata ?? {}).map(([key, value]) => `meta_${key}: ${value ?? "n/a"}`),
    ];
    const log = options.logMode === "metadata"
      ? [...audit, "", "metadata_only: true", ""].join("\n")
      : [
          ...audit,
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
