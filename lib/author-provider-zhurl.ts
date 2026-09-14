import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {authorProfileUrl} from './author-identity';
import {
  AUTHOR_PROVIDER_MESSAGES,
  AuthorProviderError,
  assertAuthorRef,
  type AnswerSummary,
  type AuthorAnswer,
  type AuthorProfile,
  type AuthorProvider,
  type AuthorRef,
  type ListAnswersOptions,
} from './author-provider';
import type {Gender} from './story';

/**
 * ZhurlProvider：本地开发和受控采料专用的公开内容来源，使用 zhurl 读取
 * 公开作者主页、主页内搜索和回答详情。
 *
 * 边界：
 * - ZHURL_BIN 是唯一环境变量名；
 * - 个人 account.json 只用于本地开发，不部署到生产服务端；
 * - 运行时 Agent 不能直接执行 shell 或 zhurl，只能通过 AuthorProvider；
 * - 每条结果都必须校验 author token、answerId、sourceUrl 和正文。
 *
 * 本模块包含 child_process，只能由构建期 NODE_ENV!=='production' 的动态导入加载，
 * 不得被任何静态模块引用。
 */

export const DEFAULT_ZHURL_TIMEOUT_MS = 25_000;
export const MAX_ZHURL_BODY_CHARS = 100_000;

export type ZhurlJsonRunner = (url: string) => Promise<unknown>;

function flattenAccount(raw: unknown): {login: true; userAgent?: string; cookies: Record<string, string>} | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as {login?: unknown; accounts?: unknown[]; activeAccountId?: unknown};
  if (typeof value.login === 'boolean') return null;
  const accounts = Array.isArray(value.accounts) ? value.accounts : [];
  const active = (accounts.find((account) => (account as {id?: unknown})?.id === value.activeAccountId && (account as {session?: unknown})?.session) as {session?: {login?: unknown; userAgent?: unknown; cookies?: unknown}} | undefined)
    ?? (accounts.find((account) => (account as {session?: {login?: unknown}})?.session?.login) as {session?: {login?: unknown; userAgent?: unknown; cookies?: unknown}} | undefined)
    ?? (accounts[0] as {session?: {login?: unknown; userAgent?: unknown; cookies?: unknown}} | undefined);
  const session = active?.session;
  if (!session || session.login !== true || !session.cookies || typeof session.cookies !== 'object') return null;
  return {
    login: true,
    ...(typeof session.userAgent === 'string' && session.userAgent ? {userAgent: session.userAgent} : {}),
    cookies: session.cookies as Record<string, string>,
  };
}

/** 与 scripts/lib/zhurl-compat.mjs 保持一致的临时 HOME 方案，用后立即清理。 */
function prepareZhurlEnv(home = process.env.HOME || os.homedir()): {env: NodeJS.ProcessEnv; cleanup: () => void} {
  const file = path.join(home, '.zhihu-plus-plus', 'account.json');
  if (!existsSync(file)) return {env: process.env, cleanup: () => {}};
  let flat: ReturnType<typeof flattenAccount>;
  try {
    flat = flattenAccount(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return {env: process.env, cleanup: () => {}};
  }
  if (!flat) return {env: process.env, cleanup: () => {}};
  const directory = mkdtempSync(path.join(os.tmpdir(), 'zhurl-home-'));
  const target = path.join(directory, '.zhihu-plus-plus');
  mkdirSync(target, {recursive: true});
  writeFileSync(path.join(target, 'account.json'), JSON.stringify(flat));
  return {
    env: {...process.env, HOME: directory},
    cleanup: () => {
      try {
        rmSync(directory, {recursive: true, force: true});
      } catch {
        return;
      }
    },
  };
}

/** 把 zhurl 的失败细节映射成明确错误，避免把 404 和风控都压成“不可用”。 */
export function classifyZhurlFailure(detail: string): AuthorProviderError | null {
  const text = String(detail || '');
  if (!text) return null;
  if (/\b404\b|不存在|未找到|not.?found/i.test(text)) return new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_NOT_FOUND, 'AUTHOR_NOT_FOUND', 404);
  if (/\b401\b|\b403\b|未登录|请登录|风控|验证码|安全验证/i.test(text)) return new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_AUTH_REQUIRED, 'AUTHOR_AUTH_REQUIRED', 401);
  if (/频繁|限流|rate.?limit|\b429\b/i.test(text)) return new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_RATE_LIMITED, 'AUTHOR_RATE_LIMITED', 429);
  return null;
}

export function createSpawnZhurlRunner(bin: string, options: {timeoutMs?: number} = {}): ZhurlJsonRunner {
  const timeoutMs = options.timeoutMs ?? DEFAULT_ZHURL_TIMEOUT_MS;
  return (url: string) => new Promise((resolve, reject) => {
    const compat = prepareZhurlEnv();
    let settled = false;
    const child = spawn(bin, ['--web', url], {env: compat.env, windowsHide: true});
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      compat.cleanup();
      reject(new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_PROVIDER_UNAVAILABLE, 'AUTHOR_PROVIDER_UNAVAILABLE', 503));
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => { stdout += String(chunk); if (stdout.length > 8_000_000) stdout = stdout.slice(0, 8_000_000); });
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); if (stderr.length > 20_000) stderr = stderr.slice(0, 20_000); });
    child.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      compat.cleanup();
      reject(new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_PROVIDER_UNAVAILABLE, 'AUTHOR_PROVIDER_UNAVAILABLE', 503));
    });
    child.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      compat.cleanup();
      const text = stdout.trim();
      if (!text) {
        reject(classifyZhurlFailure(stderr) ?? new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_PROVIDER_UNAVAILABLE, 'AUTHOR_PROVIDER_UNAVAILABLE', 503));
        return;
      }
      try {
        const payload = JSON.parse(text) as Record<string, unknown>;
        if (payload && typeof payload === 'object' && payload.error) {
          reject(classifyZhurlFailure(JSON.stringify(payload.error).slice(0, 300)) ?? new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_PROVIDER_UNAVAILABLE, 'AUTHOR_PROVIDER_UNAVAILABLE', 503));
          return;
        }
        resolve(payload);
      } catch {
        reject(classifyZhurlFailure(text.slice(0, 300)) ?? new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_PROVIDER_UNAVAILABLE, 'AUTHOR_PROVIDER_UNAVAILABLE', 503));
      }
    });
  });
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', middot: '·',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  times: '×', laquo: '«', raquo: '»', copy: '©', reg: '®',
  permil: '‰', deg: '°', plusmn: '±', minus: '−',
};

export function htmlToText(html: string): string {
  const decoded = html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|blockquote|figcaption|h[1-6]|tr|section|article|pre)>/gi, '\n')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-zA-Z]+);/g, (match, name: string) => (Object.hasOwn(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : match))
    .replace(/\u200b/g, '')
    .replace(/\r\n?/g, '\n');
  return decoded
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function memberGender(value: unknown): Gender | 'unknown' {
  if (value === '女' || value === 'female' || value === 'Female') return '女';
  if (value === '男' || value === 'male' || value === 'Male') return '男';
  return 'unknown';
}

export function memberSearchUrl(query: string, memberHashId: string, offset = 0, limit = 20): string {
  const params: [string, string][] = [
    ['gk_version', 'gz-gaokao'],
    ['t', 'general'],
    ['q', query],
    ['correction', '1'],
    ['offset', String(offset)],
    ['limit', String(limit)],
    ['search_source', 'Normal'],
    ['show_all_topics', '0'],
    ['filter_fields', ''],
    ['lc_idx', '0'],
    ['restricted_scene', 'member'],
    ['restricted_field', 'member_hash_id'],
    ['restricted_value', memberHashId],
  ];
  return `https://www.zhihu.com/api/v4/search_v3?${params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')}`;
}

export type ZhurlProviderOptions = {run: ZhurlJsonRunner; now?: () => number};

export class ZhurlProvider implements AuthorProvider {
  private readonly now: () => number;

  constructor(private readonly options: ZhurlProviderOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  async resolveProfile(ref: AuthorRef): Promise<AuthorProfile> {
    const bound = assertAuthorRef(ref);
    const include = 'name,headline,avatar_url,answer_count,gender,url_token';
    const payload = await this.call(`https://www.zhihu.com/api/v4/members/${bound.urlToken}?include=${include}`);
    if (String(payload.url_token || '') !== bound.urlToken) throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_EVIDENCE_INVALID, 'AUTHOR_EVIDENCE_INVALID', 502);
    const displayName = String(payload.name || '').trim();
    if (!displayName) throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_NOT_FOUND, 'AUTHOR_NOT_FOUND', 404);
    return {
      urlToken: bound.urlToken,
      profileUrl: authorProfileUrl(bound.urlToken),
      displayName: displayName.slice(0, 80),
      ...(typeof payload.avatar_url === 'string' && payload.avatar_url ? {avatarUrl: payload.avatar_url.slice(0, 500)} : {}),
      ...(typeof payload.headline === 'string' && payload.headline.trim() ? {headline: payload.headline.trim().slice(0, 200)} : {}),
      ...(Number.isFinite(Number(payload.answer_count)) ? {answerCount: Math.max(0, Number(payload.answer_count))} : {}),
      gender: memberGender(payload.gender),
      fetchedAt: new Date(this.now()).toISOString(),
      source: 'zhurl',
    };
  }

  async listAnswers(ref: AuthorRef, options: ListAnswersOptions): Promise<AnswerSummary[]> {
    const bound = assertAuthorRef(ref);
    if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 20) throw new AuthorProviderError('列表数量必须是 1 到 20。', 'AUTHOR_EVIDENCE_INVALID', 400);
    const offset = options.cursor && /^\d+$/.test(options.cursor) ? options.cursor : '0';
    const sortBy = options.sort === 'top-voteups' ? 'voteups' : 'created';
    const include = encodeURIComponent('excerpt,question,author,voteup_count,created_time');
    const payload = await this.call(`https://www.zhihu.com/api/v4/members/${bound.urlToken}/answers?offset=${offset}&limit=${options.limit}&sort_by=${sortBy}&include=${include}`);
    const items = Array.isArray(payload.data) ? payload.data : [];
    return items.map((item) => this.toSummary(item, bound, options.sort === 'top-voteups' ? 'top-voteups' : 'latest')).filter((item): item is AnswerSummary => Boolean(item)).slice(0, options.limit);
  }

  async searchAnswers(ref: AuthorRef, query: string, limit: number): Promise<AnswerSummary[]> {
    const bound = assertAuthorRef(ref);
    const trimmed = query.trim();
    if (!trimmed || trimmed.length > 200) throw new AuthorProviderError('检索词不合法。', 'AUTHOR_EVIDENCE_INVALID', 400);
    if (!Number.isInteger(limit) || limit < 1 || limit > 5) throw new AuthorProviderError('检索数量必须是 1 到 5。', 'AUTHOR_EVIDENCE_INVALID', 400);
    const member = await this.call(`https://www.zhihu.com/api/v4/members/${bound.urlToken}?include=name,url_token`);
    const memberHashId = String(member.id || '').trim();
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(memberHashId)) throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_NOT_FOUND, 'AUTHOR_NOT_FOUND', 404);
    const payload = await this.call(memberSearchUrl(trimmed, memberHashId, 0, Math.max(10, limit)));
    const rows = Array.isArray(payload.data) ? payload.data : [];
    const summaries: AnswerSummary[] = [];
    for (const row of rows) {
      const object = (row as {object?: Record<string, unknown>})?.object;
      if (!object || String(object.type || '') !== 'answer') continue;
      const summary = this.toSummary(object, bound, 'profile-search', trimmed);
      if (summary) summaries.push(summary);
      if (summaries.length >= limit) break;
    }
    return summaries;
  }

  async readAnswer(ref: AuthorRef, answerId: string): Promise<AuthorAnswer> {
    const bound = assertAuthorRef(ref);
    if (!/^\d+$/.test(answerId)) throw new AuthorProviderError('回答标识不合法。', 'AUTHOR_EVIDENCE_INVALID', 400);
    const payload = await this.call(`https://www.zhihu.com/api/v4/answers/${answerId}?include=content,question,author,paid_info`);
    if ((payload.paid_info as {is_paid?: unknown} | undefined)?.is_paid) throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_CONTENT_UNSUPPORTED, 'AUTHOR_CONTENT_UNSUPPORTED', 400);
    const author = (payload.author ?? {}) as Record<string, unknown>;
    if (String(author.url_token || '') !== bound.urlToken) throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_EVIDENCE_INVALID, 'AUTHOR_EVIDENCE_INVALID', 502);
    if (String(payload.id || '') !== answerId) throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_EVIDENCE_INVALID, 'AUTHOR_EVIDENCE_INVALID', 502);
    const body = htmlToText(String(payload.content || ''));
    const questionTitle = String((payload.question as Record<string, unknown> | undefined)?.title || '').trim();
    if (!body || body.length > MAX_ZHURL_BODY_CHARS || !questionTitle) throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_EVIDENCE_INVALID, 'AUTHOR_EVIDENCE_INVALID', 502);
    return {
      answerId,
      authorUrlToken: bound.urlToken,
      authorName: String(author.name || '').trim().slice(0, 80) || undefined,
      questionTitle: questionTitle.slice(0, 500),
      sourceUrl: `https://www.zhihu.com/answer/${answerId}`,
      body,
      completeness: 'fetched_api_content_unverified',
      collectedAt: new Date(this.now()).toISOString(),
      contentHash: createHash('sha256').update(body, 'utf8').digest('hex'),
    };
  }

  private toSummary(item: unknown, ref: AuthorRef, method: AnswerSummary['collectionMethod'], query?: string): AnswerSummary | undefined {
    const record = (item ?? {}) as Record<string, unknown>;
    const answerId = String(record.id ?? '').match(/^\d+$/)?.[0];
    const question = (record.question ?? {}) as Record<string, unknown>;
    const questionTitle = String(question.title ?? question.name ?? record.title ?? '').trim();
    const authorToken = String((record.author as Record<string, unknown> | undefined)?.url_token || ref.urlToken);
    if (!answerId || !questionTitle || (record.author && authorToken !== ref.urlToken)) return undefined;
    const excerpt = typeof record.excerpt === 'string' ? record.excerpt.replace(/<[^>]+>/g, '').trim() : '';
    return {
      answerId,
      authorUrlToken: ref.urlToken,
      questionTitle: questionTitle.slice(0, 500),
      sourceUrl: `https://www.zhihu.com/answer/${answerId}`,
      ...(excerpt ? {excerpt: excerpt.slice(0, 500)} : {}),
      ...(Number.isFinite(Number(record.voteup_count)) ? {voteupCount: Math.max(0, Number(record.voteup_count))} : {}),
      ...(Number.isFinite(Number(record.created_time)) ? {createdAt: new Date(Number(record.created_time) * 1000).toISOString()} : {}),
      collectionMethod: method,
      ...(query ? {query} : {}),
    };
  }

  private async call(url: string): Promise<Record<string, unknown>> {
    let payload: unknown;
    try {
      payload = await this.options.run(url);
    } catch (error) {
      if (error instanceof AuthorProviderError) throw error;
      throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_PROVIDER_UNAVAILABLE, 'AUTHOR_PROVIDER_UNAVAILABLE', 503);
    }
    if (!payload || typeof payload !== 'object') throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_PROVIDER_UNAVAILABLE, 'AUTHOR_PROVIDER_UNAVAILABLE', 503);
    const record = payload as Record<string, unknown>;
    if (record.error) {
      const detail = JSON.stringify(record.error).slice(0, 200);
      if (/\b401\b|\b403\b|未登录|请登录/i.test(detail)) throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_AUTH_REQUIRED, 'AUTHOR_AUTH_REQUIRED', 401);
      if (/频繁|限流|rate.?limit|\b429\b/i.test(detail)) throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_RATE_LIMITED, 'AUTHOR_RATE_LIMITED', 429);
      if (/404|不存在|not.?found/i.test(detail)) throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_NOT_FOUND, 'AUTHOR_NOT_FOUND', 404);
      throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_PROVIDER_UNAVAILABLE, 'AUTHOR_PROVIDER_UNAVAILABLE', 503);
    }
    return record;
  }
}
