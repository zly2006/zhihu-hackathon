export type GenerationFailureCategory =
  | "transport"
  | "rate_limit"
  | "auth"
  | "quota"
  | "cancelled"
  | "deadline"
  | "schema"
  | "reference"
  | "semantic"
  | "unknown";

export type GenerationFailure = {
  category: GenerationFailureCategory;
  retryable: boolean;
  message: string;
};

export function generationFailure(error: unknown): GenerationFailure {
  const message = error instanceof Error ? error.message : String(error || "生成失败");
  const category = error && typeof error === "object" && "category" in error && typeof error.category === "string"
    ? error.category as GenerationFailureCategory
    : classifyMessage(message);
  const retryable = error && typeof error === "object" && "retryable" in error && typeof error.retryable === "boolean"
    ? error.retryable as boolean
    : category === "transport" || category === "rate_limit" || category === "schema" || category === "reference" || category === "semantic";
  return { category, retryable, message };
}

export function canRetryGeneration(error: unknown): boolean {
  const failure = generationFailure(error);
  return failure.retryable && !["auth", "quota", "cancelled", "deadline"].includes(failure.category);
}

function classifyMessage(message: string): GenerationFailureCategory {
  if (/cancel|取消|AbortError/i.test(message)) return "cancelled";
  if (/deadline|超时|timeout|first.?token|持续超过|请求已耗尽/i.test(message)) return "deadline";
  if (/未配置|401|403|credential|api.?key|权限/i.test(message)) return "auth";
  if (/usage.?limit|用量已达上限|余额|quota/i.test(message)) return "quota";
  if (/429|限流|Too Many Requests|rate.?limit/i.test(message)) return "rate_limit";
  if (/terminated|fetch failed|ECONNRESET|socket hang up|UND_ERR|EPIPE|连接中断/i.test(message)) return "transport";
  if (/重大转折|importance|结果锚点|世界规则|现实后果|后果|NPC.*(?:参与|目标)|当前目标/i.test(message)) return "semantic";
  if (/未知别名|引用|reference|candidateHash|目标|ruleId|字段|JSON|场景|choices|必须|非法|缺失/i.test(message)) return "schema";
  return "unknown";
}
