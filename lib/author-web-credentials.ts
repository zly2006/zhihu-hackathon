import {existsSync, readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * 服务端公开内容来源的凭证解析。
 *
 * 两种来源，同一套代码路径：
 * - 线上：环境变量 ZHIHU_WEB_COOKIE（可选 ZHIHU_WEB_USER_AGENT），只放服务端，不进仓库；
 * - 本地开发：知乎++ 的 account.json（可用 ZHIHU_WEB_ACCOUNT_FILE 覆盖路径）。
 *
 * 凭证只用于请求知乎公开页面/接口，不参与任何鉴权展示，也不写入日志。
 */

export const DEFAULT_WEB_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

export type WebCredentials = {
  cookie: string;
  userAgent: string;
  source: 'env' | 'account-file';
};

type SessionLike = {login?: unknown; userAgent?: unknown; cookie?: unknown; cookies?: unknown};

function cookieHeaderFrom(value: unknown): string {
  if (typeof value === 'string' && value.includes('=')) return value;
  if (value && typeof value === 'object') {
    const pairs = Object.entries(value as Record<string, unknown>).filter(([, val]) => typeof val === 'string' && val);
    if (pairs.length) return pairs.map(([key, val]) => `${key}=${val}`).join('; ');
  }
  return '';
}

function flattenAccount(raw: unknown): {cookie: string; userAgent?: string} | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as {login?: unknown; accounts?: unknown[]; activeAccountId?: unknown};
  // 旧版扁平结构
  if (typeof value.login === 'boolean') return null;
  const accounts = Array.isArray(value.accounts) ? value.accounts : [];
  const sessionOf = (account: unknown): SessionLike | undefined => (account as {session?: SessionLike} | undefined)?.session;
  const ordered = [
    accounts.find((account) => (account as {id?: unknown})?.id === value.activeAccountId && sessionOf(account)?.login === true),
    accounts.find((account) => sessionOf(account)?.login === true),
    ...accounts,
  ];
  for (const account of ordered) {
    const session = sessionOf(account);
    if (!session || session.login !== true) continue;
    const cookie = cookieHeaderFrom(session.cookie ?? session.cookies);
    if (!cookie) continue;
    return {cookie, userAgent: typeof session.userAgent === 'string' && session.userAgent ? session.userAgent : undefined};
  }
  return null;
}

export function accountFileFrom(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.ZHIHU_WEB_ACCOUNT_FILE?.trim();
  if (override) return override;
  return path.join(env.HOME || env.USERPROFILE || os.homedir(), '.zhihu-plus-plus', 'account.json');
}

let cached: {at: number; credentials: WebCredentials | null; key: string} | null = null;

export function resolveWebCredentials(env: NodeJS.ProcessEnv = process.env, now = Date.now()): WebCredentials | null {
  const cookie = env.ZHIHU_WEB_COOKIE?.trim();
  const userAgent = env.ZHIHU_WEB_USER_AGENT?.trim() || DEFAULT_WEB_USER_AGENT;
  if (cookie) return {cookie, userAgent, source: 'env'};
  const file = accountFileFrom(env);
  if (cached && cached.key === file && now - cached.at < 60_000) return cached.credentials;
  let credentials: WebCredentials | null = null;
  try {
    if (existsSync(file)) {
      const flat = flattenAccount(JSON.parse(readFileSync(file, 'utf8')));
      if (flat) credentials = {cookie: flat.cookie, userAgent: flat.userAgent?.trim() || userAgent, source: 'account-file'};
    }
  } catch {
    credentials = null;
  }
  cached = {at: now, credentials, key: file};
  return credentials;
}

export function resetWebCredentialCache(): void {
  cached = null;
}
