const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  408: "Request Timeout",
  409: "Conflict",
  413: "Payload Too Large",
  422: "Unprocessable Content",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

function httpStatus(response: Response) {
  const reason = response.statusText.trim() || STATUS_TEXT[response.status] || "Unknown Status";
  return `HTTP ${response.status} ${reason}`;
}

function errorDetail(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const body = payload as { error?: unknown; message?: unknown };
  if (typeof body.error === "string") return body.error;
  if (body.error && typeof body.error === "object" && "message" in body.error) return String(body.error.message || "");
  return typeof body.message === "string" ? body.message : "";
}

export async function readJsonResponse<T>(response: Response, purpose: string): Promise<T> {
  const rawBody = await response.text();
  let payload: unknown = null;
  let validJson = false;
  if (rawBody.trim()) {
    try {
      payload = JSON.parse(rawBody);
      validJson = true;
    } catch { /* HTTP status remains the primary error for non-2xx responses. */ }
  }

  if (!response.ok) {
    const detail = validJson ? errorDetail(payload) : "";
    throw new Error(`${purpose}失败：${httpStatus(response)}${detail ? `：${detail}` : ""}`);
  }
  if (!rawBody.trim()) throw new Error(`${purpose}失败：${httpStatus(response)}，响应正文为空`);
  if (!validJson) throw new Error(`${purpose}失败：${httpStatus(response)}，服务返回的正文不是 JSON`);
  return payload as T;
}
