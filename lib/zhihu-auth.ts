import "server-only";

import { randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { readJsonResponse } from "@/lib/http-response";

const SESSION_COOKIE = "restart_life_zhihu_session";
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

export type ZhihuProfile = {
  name: string | null;
  avatarUrl: string | null;
  headline: string | null;
  url: string | null;
};

type OAuthError = { code: string; message: string };
type OAuthSession = {
  id: string;
  sessionExpiresAt: number;
  state: string | null;
  token: string | null;
  expiresAt: number | null;
  profile: ZhihuProfile | null;
  stateVerified: boolean | null;
  error: OAuthError | null;
};

type SessionStore = Map<string, OAuthSession>;
const globalSessions = globalThis as typeof globalThis & { restartLifeZhihuSessions?: SessionStore };
const sessions = globalSessions.restartLifeZhihuSessions ??= new Map();

function env(name: string) { return process.env[name]?.trim() || ""; }

function configuration() {
  return {
    appId: env("ZHIHU_OAUTH_APP_ID"),
    appKey: env("ZHIHU_OAUTH_APP_KEY"),
    accessSecret: env("ZHIHU_ACCESS_SECRET"),
    redirectUri: env("ZHIHU_OAUTH_REDIRECT_URI"),
  };
}

function safeSecret(value: string, label: string) {
  if (!value || /[\r\n]/.test(value)) throw oauthError("CREDENTIAL_INVALID", `${label} 未配置或格式无效`);
  return value;
}

function oauthError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

function errorPayload(error: unknown): OAuthError {
  const source = error as { code?: unknown; message?: unknown };
  return {
    code: String(source?.code || "OAUTH_FAILED").slice(0, 80),
    message: String(source?.message || "知乎授权失败").slice(0, 200),
  };
}

function equal(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parsePayloadError(payload: unknown, fallback: string) {
  const body = payload as { code?: unknown; Code?: unknown; message?: unknown; Message?: unknown; data?: { message?: unknown } };
  const message = body?.data?.message || body?.message || body?.Message || fallback;
  return oauthError(String(body?.code ?? body?.Code ?? "OAUTH_FAILED"), String(message));
}

function activeSession(request: NextRequest) {
  const id = request.cookies.get(SESSION_COOKIE)?.value;
  if (!id || !/^[A-Za-z0-9_-]{32}$/.test(id)) return null;
  const current = sessions.get(id) || null;
  if (current && current.sessionExpiresAt <= Date.now()) {
    sessions.delete(id);
    return null;
  }
  if (current?.expiresAt && current.expiresAt <= Date.now()) {
    current.token = null;
    current.profile = null;
    current.error = { code: "TOKEN_EXPIRED", message: "知乎授权已过期，请重新登录" };
  }
  return current;
}

export function sessionFor(request: NextRequest) {
  const existing = activeSession(request);
  if (existing) return { session: existing, created: false };
  const id = randomBytes(24).toString("base64url");
  const session: OAuthSession = { id, sessionExpiresAt: Date.now() + SESSION_MAX_AGE_SECONDS * 1000, state: null, token: null, expiresAt: null, profile: null, stateVerified: null, error: null };
  sessions.set(id, session);
  return { session, created: true };
}

export function attachSessionCookie(response: NextResponse, session: OAuthSession) {
  response.cookies.set(SESSION_COOKIE, session.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export function applicationUrl(path: string, request: NextRequest) {
  const redirectUri = configuration().redirectUri;
  if (redirectUri) {
    try { return new URL(path, new URL(redirectUri).origin); }
    catch { /* authorizationUrl will return the precise configuration error */ }
  }
  const forwardedHost = request.headers.get("x-forwarded-host") || request.headers.get("host") || request.nextUrl.host;
  const forwardedProtocol = request.headers.get("x-forwarded-proto") === "https" ? "https" : request.nextUrl.protocol.replace(":", "");
  return new URL(path, `${forwardedProtocol}://${forwardedHost}`);
}

export function publicStatus(request: NextRequest) {
  const { session, created } = sessionFor(request);
  const config = configuration();
  const missingConfiguration = [
    !config.appId && "ZHIHU_OAUTH_APP_ID",
    !config.appKey && "ZHIHU_OAUTH_APP_KEY",
    !config.accessSecret && "ZHIHU_ACCESS_SECRET",
    !config.redirectUri && "ZHIHU_OAUTH_REDIRECT_URI",
  ].filter((name): name is string => Boolean(name));
  return {
    session,
    created,
    payload: {
      configured: Boolean(config.appId && config.appKey && config.accessSecret && config.redirectUri),
      missingConfiguration,
      callbackConfigured: Boolean(config.redirectUri),
      authorized: Boolean(session.token),
      profile: session.profile,
      stateVerified: session.stateVerified,
      expiresAt: session.expiresAt ? new Date(session.expiresAt).toISOString() : null,
      error: session.error,
    },
  };
}

export function authorizationUrl(request: NextRequest) {
  const { session } = sessionFor(request);
  const config = configuration();
  if (!config.appId || !config.appKey || !config.accessSecret || !config.redirectUri) {
    throw oauthError("OAUTH_NOT_CONFIGURED", "知乎登录尚未完成服务端凭据配置");
  }
  if (!/^\d+$/.test(config.appId)) throw oauthError("APP_ID_INVALID", "知乎 OAuth App ID 格式无效");
  if (config.appKey.length <= 8 || config.appKey === config.appId) throw oauthError("APP_KEY_INVALID", "知乎 OAuth App Key 格式无效");
  if (config.accessSecret === config.appKey) throw oauthError("CREDENTIALS_CONFLICT", "OAuth App Key 与 Access Secret 不能相同");
  let redirect: URL;
  try { redirect = new URL(config.redirectUri); }
  catch { throw oauthError("REDIRECT_URI_INVALID", "知乎 OAuth 回调地址格式无效"); }
  if (redirect.protocol !== "https:" || ["localhost", "127.0.0.1"].includes(redirect.hostname) || redirect.pathname !== "/auth/callback") {
    throw oauthError("REDIRECT_URI_INVALID", "知乎 OAuth 回调必须是公网 HTTPS /auth/callback 地址");
  }
  session.state = randomBytes(24).toString("base64url");
  session.error = null;
  const url = new URL("https://openapi.zhihu.com/authorize");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("app_id", config.appId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", session.state);
  return { session, url: url.toString() };
}

export async function completeAuthorization(request: NextRequest) {
  const session = activeSession(request);
  if (!session?.state) throw oauthError("SESSION_MISSING", "登录会话已失效，请重新发起知乎授权");
  const config = configuration();
  const code = request.nextUrl.searchParams.get("authorization_code") || request.nextUrl.searchParams.get("code") || "";
  const returnedState = request.nextUrl.searchParams.get("state");
  if (!code) throw oauthError("CODE_MISSING", "知乎回调缺少 authorization_code");
  if (returnedState && !equal(returnedState, session.state)) throw oauthError("STATE_MISMATCH", "知乎登录 state 校验失败");

  const form = new URLSearchParams({
    app_id: safeSecret(config.appId, "OAuth App ID"),
    app_key: safeSecret(config.appKey, "OAuth App Key"),
    grant_type: "authorization_code",
    redirect_uri: safeSecret(config.redirectUri, "OAuth Redirect URI"),
    code: safeSecret(code, "authorization code"),
  });
  const tokenResponse = await fetch("https://openapi.zhihu.com/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const tokenPayload = await readJsonResponse<{ access_token?: string; expires_in?: number; data?: { access_token?: string; expires_in?: number } }>(tokenResponse, "知乎 OAuth Token 接口");
  const token = tokenPayload.access_token || tokenPayload.data?.access_token;
  if (!tokenResponse.ok || !token) throw parsePayloadError(tokenPayload, "未获得知乎 OAuth access token");
  const expiresIn = Number(tokenPayload.expires_in ?? tokenPayload.data?.expires_in);
  session.token = token;
  session.expiresAt = Number.isFinite(expiresIn) ? Date.now() + expiresIn * 1000 : null;
  session.stateVerified = Boolean(returnedState);
  session.state = null;
  session.error = null;

  try {
    const profileResponse = await fetch("https://openapi.zhihu.com/user", {
      headers: {
        Authorization: `Bearer ${safeSecret(config.accessSecret, "Access Secret")}`,
        "X-OAuth-Token": safeSecret(token, "OAuth token"),
        "X-Request-Timestamp": String(Math.floor(Date.now() / 1000)),
      },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    const profilePayload = await readJsonResponse<Record<string, unknown>>(profileResponse, "知乎账号资料接口");
    const source = (profilePayload.data || profilePayload.Data || profilePayload.user) as Record<string, unknown> | undefined;
    session.profile = source ? {
      name: String(source.name || source.Fullname || source.fullname || "") || null,
      avatarUrl: String(source.avatar_url || source.AvatarUrl || "") || null,
      headline: String(source.headline || source.Headline || "") || null,
      url: String(source.url || source.Url || "") || null,
    } : null;
  } catch {
    session.profile = null;
  }
  return session;
}

export function recordOAuthError(request: NextRequest, error: unknown) {
  const { session } = sessionFor(request);
  session.error = errorPayload(error);
  return session;
}

export function logout(request: NextRequest) {
  const session = activeSession(request);
  if (session) sessions.delete(session.id);
}
