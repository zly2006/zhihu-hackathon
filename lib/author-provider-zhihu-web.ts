import {createHash} from 'node:crypto';
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
import {authorRateLimiter, type AuthorRateLimiter} from './author-rate-limit';
import {DEFAULT_WEB_USER_AGENT, resolveWebCredentials, type WebCredentials} from './author-web-credentials';
import type {Gender} from './story';

/**
 * 知乎网页公开内容 Provider（纯 TypeScript，无子进程、无本地二进制）。
 *
 * 与本地/线上同一套实现，区别只在凭证来源：
 * - 线上：ZHIHU_WEB_COOKIE（+ 可选 ZHIHU_WEB_USER_AGENT）写在服务端环境变量；
 * - 本地：自动读取知乎++ 的 account.json（ZHIHU_WEB_ACCOUNT_FILE 可覆盖）。
 *
 * 无凭证或凭证失效时必须返回 AUTHOR_AUTH_REQUIRED / AUTHOR_SOURCE_UNCONFIGURED，
 * 不允许静默改读登录用户自己的数据。所有请求走进程内限速，避免风控。
 */

export const WEB_REQUEST_TIMEOUT_MS = 20_000;
export const MAX_ANSWER_BODY_CHARS = 100_000;

export type ZhihuWebProviderOptions = {
  credentials: WebCredentials;
  limiter?: AuthorRateLimiter;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

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

function memberGender(value: unknown): Gender | 'unknown' {
  if (value === '女' || value === 'female' || value === 'Female') return '女';
  if (value === '男' || value === 'male' || value === 'Male') return '男';
  return 'unknown';
}

function classifyFailure(status: number, detail: string): AuthorProviderError {
  const text = String(detail || '');
  if (status === 404 || /不存在|未找到|not.?found/i.test(text)) return new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_NOT_FOUND, 'AUTHOR_NOT_FOUND', 404);
  // 凭证失效优先于风控：need_login 表示 cookie 过期/无效，提示用户去轮换凭证更有用。
  if (/need_login|unauthorized|forbidden|未登录|请登录/i.test(text) || status === 401) return new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_AUTH_REQUIRED, 'AUTHOR_AUTH_REQUIRED', 401);
  if (/unhuman|验证码|安全验证|风控|异常流量|频繁|限流|rate.?limit/i.test(text) || status === 403 || status === 429) return new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_RATE_LIMITED, 'AUTHOR_RATE_LIMITED', 429);
  return new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_PROVIDER_UNAVAILABLE, 'AUTHOR_PROVIDER_UNAVAILABLE', 503);
}

export class ZhihuWebProvider implements AuthorProvider {
  private readonly fetchImpl: FetchLike;
  private readonly limiter: AuthorRateLimiter;
  private readonly now: () => number;
  private readonly timeoutMs: number;

  constructor(private readonly options: ZhihuWebProviderOptions) {
    this.fetchImpl = (options.fetchImpl ?? fetch) as FetchLike;
    this.limiter = options.limiter ?? authorRateLimiter();
    this.now = options.now ?? (() => Date.now());
    this.timeoutMs = options.timeoutMs ?? WEB_REQUEST_TIMEOUT_MS;
  }

  get credentialSource(): WebCredentials['source'] {
    return this.options.credentials.source;
  }

  async resolveProfile(ref: AuthorRef): Promise<AuthorProfile> {
    const bound = assertAuthorRef(ref);
    const include = 'name,headline,avatar_url,answer_count,gender,url_token';
    let payload: Record<string, unknown>;
    try {
      payload = await this.call(`https://www.zhihu.com/api/v4/members/${bound.urlToken}?include=${include}`);
    } catch (error) {
      // 接口被拦时退回公开主页解析；拿不到就保留原错误，绝不伪造资料。
      const fallback = await this.profileFromPublicPage(bound).catch(() => null);
      if (fallback) return fallback;
      throw error;
    }
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
      source: 'web',
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
    if (!body || body.length > MAX_ANSWER_BODY_CHARS || !questionTitle) throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_EVIDENCE_INVALID, 'AUTHOR_EVIDENCE_INVALID', 502);
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

  /** 公开主页兜底：只解析昵称/头像/简介，拿不到回答正文，不冒充接口数据。 */
  private async profileFromPublicPage(ref: AuthorRef): Promise<AuthorProfile | null> {
    const response = await this.request(`https://www.zhihu.com/people/${ref.urlToken}`);
    if (!response.ok) return null;
    const html = await response.text();
    const meta = (property: string) => new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i').exec(html)?.[1]?.trim();
    const displayName = meta('og:title');
    if (!displayName) return null;
    const avatarUrl = meta('og:image');
    const headline = meta('og:description');
    return {
      urlToken: ref.urlToken,
      profileUrl: authorProfileUrl(ref.urlToken),
      displayName: displayName.slice(0, 80),
      ...(avatarUrl ? {avatarUrl: avatarUrl.slice(0, 500)} : {}),
      ...(headline ? {headline: headline.slice(0, 200)} : {}),
      gender: 'unknown',
      fetchedAt: new Date(this.now()).toISOString(),
      source: 'web',
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

  private async request(url: string): Promise<Response> {
    try {
      return await this.fetchImpl(url, {
        headers: {
          Cookie: this.options.credentials.cookie,
          'User-Agent': this.options.credentials.userAgent || DEFAULT_WEB_USER_AGENT,
          Accept: 'application/json, text/plain, */*',
          Referer: 'https://www.zhihu.com/',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(this.timeoutMs),
        cache: 'no-store',
      });
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_PROVIDER_UNAVAILABLE, 'AUTHOR_PROVIDER_UNAVAILABLE', 503);
      }
      throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_PROVIDER_UNAVAILABLE, 'AUTHOR_PROVIDER_UNAVAILABLE', 503);
    }
  }

  private async call(url: string): Promise<Record<string, unknown>> {
    const response = await this.limiter.run(this.options.credentials.cookie.slice(0, 12), () => this.request(url));
    const text = await response.text();
    if (!response.ok) throw classifyFailure(response.status, text);
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw classifyFailure(response.status, text.slice(0, 300));
    }
    if (!payload || typeof payload !== 'object') throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_PROVIDER_UNAVAILABLE, 'AUTHOR_PROVIDER_UNAVAILABLE', 503);
    const record = payload as Record<string, unknown>;
    if (record.error) throw classifyFailure(response.status, JSON.stringify(record.error).slice(0, 300));
    return record;
  }
}

/** 公开主页兜底：只解析昵称/头像/简介，拿不到回答正文，不冒充接口数据。 */
export function profileFromPublicPageHtml(html: string, ref: AuthorRef, now = Date.now()): AuthorProfile | null {
  const meta = (property: string) => new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i').exec(html)?.[1]?.trim();
  const displayName = meta('og:title');
  if (!displayName) return null;
  const avatarUrl = meta('og:image');
  const headline = meta('og:description');
  return {
    urlToken: ref.urlToken,
    profileUrl: authorProfileUrl(ref.urlToken),
    displayName: displayName.slice(0, 80),
    ...(avatarUrl ? {avatarUrl: avatarUrl.slice(0, 500)} : {}),
    ...(headline ? {headline: headline.slice(0, 200)} : {}),
    gender: 'unknown',
    fetchedAt: new Date(now).toISOString(),
    source: 'web',
  };
}

/**
 * 未配置服务端 cookie 时的兜底 Provider：
 * 只尝试公开主页解析（部分网络环境可用），回答列表/检索/详情一律明确报「未配置内容来源」。
 */
export class PublicProfileOnlyProvider implements AuthorProvider {
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  constructor(options: {fetchImpl?: typeof fetch; now?: () => number} = {}) {
    this.fetchImpl = (options.fetchImpl ?? fetch) as FetchLike;
    this.now = options.now ?? (() => Date.now());
  }

  private unconfigured(): AuthorProviderError {
    return new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_SOURCE_UNCONFIGURED, 'AUTHOR_SOURCE_UNCONFIGURED', 503);
  }

  async resolveProfile(ref: AuthorRef): Promise<AuthorProfile> {
    const bound = assertAuthorRef(ref);
    let response: Response | null = null;
    try {
      response = await this.fetchImpl(`https://www.zhihu.com/people/${bound.urlToken}`, {
        headers: {'User-Agent': DEFAULT_WEB_USER_AGENT, Accept: 'text/html,application/xhtml+xml'},
        redirect: 'follow',
        signal: AbortSignal.timeout(WEB_REQUEST_TIMEOUT_MS),
        cache: 'no-store',
      });
    } catch {
      response = null;
    }
    if (response?.ok) {
      const profile = profileFromPublicPageHtml(await response.text(), bound, this.now());
      if (profile) return profile;
    }
    throw this.unconfigured();
  }

  async listAnswers(_ref?: AuthorRef, _options?: ListAnswersOptions): Promise<AnswerSummary[]> { throw this.unconfigured(); }
  async searchAnswers(_ref?: AuthorRef, _query?: string, _limit?: number): Promise<AnswerSummary[]> { throw this.unconfigured(); }
  async readAnswer(_ref?: AuthorRef, _answerId?: string): Promise<AuthorAnswer> { throw this.unconfigured(); }
}

/** 没有配置任何内容来源时的占位 Provider：不发出任何请求，直接报「未配置」。 */
export class UnconfiguredSourceProvider implements AuthorProvider {
  async resolveProfile(_ref?: AuthorRef): Promise<AuthorProfile> {
    throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_SOURCE_UNCONFIGURED, 'AUTHOR_SOURCE_UNCONFIGURED', 503);
  }
  async listAnswers(_ref?: AuthorRef, _options?: ListAnswersOptions): Promise<AnswerSummary[]> {
    throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_SOURCE_UNCONFIGURED, 'AUTHOR_SOURCE_UNCONFIGURED', 503);
  }
  async searchAnswers(_ref?: AuthorRef, _query?: string, _limit?: number): Promise<AnswerSummary[]> {
    throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_SOURCE_UNCONFIGURED, 'AUTHOR_SOURCE_UNCONFIGURED', 503);
  }
  async readAnswer(_ref?: AuthorRef, _answerId?: string): Promise<AuthorAnswer> {
    throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_SOURCE_UNCONFIGURED, 'AUTHOR_SOURCE_UNCONFIGURED', 503);
  }
}

export function createZhihuWebProvider(options: {
  credentials?: WebCredentials | null;
  limiter?: AuthorRateLimiter;
  fetchImpl?: typeof fetch;
  now?: () => number;
  env?: NodeJS.ProcessEnv;
  /** 未配置凭证时是否尝试公开主页兜底（默认尝试）。 */
  allowPublicPageFallback?: boolean;
} = {}): AuthorProvider {
  // credentials 为 undefined 时按环境解析；显式传 null 表示“确认没有凭证”（测试与禁用场景）。
  const credentials = options.credentials === undefined ? resolveWebCredentials(options.env ?? process.env) : options.credentials;
  if (!credentials) {
    return options.allowPublicPageFallback === false
      ? new UnconfiguredSourceProvider()
      : new PublicProfileOnlyProvider({fetchImpl: options.fetchImpl, now: options.now});
  }
  return new ZhihuWebProvider({credentials, limiter: options.limiter, fetchImpl: options.fetchImpl, now: options.now});
}
