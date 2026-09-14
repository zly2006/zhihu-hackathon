import {z} from 'zod';
import {validateAnswerSource} from './author-citations';
import {AUTHOR_PROFILE_HOSTS, AUTHOR_URL_TOKEN_PATTERN, authorProfileUrl, isAuthorUrlToken, type DerivedAuthorGender} from './author-identity';
import type {Gender} from './story';

/**
 * 统一 AuthorProvider 抽象。
 *
 * AuthSession、AuthorRef 和 AuthorProvider 是三件不同的事：
 * - AuthSession 只表示玩家是否登录知乎；
 * - AuthorRef 只表示玩家想邀请哪一位答主；
 * - AuthorProvider 才负责获取该答主的公开资料和回答。
 *
 * RAG、Agent 和 UI 都只依赖这一层，不直接依赖 zhurl、OAuth 或文件系统。
 */

export type AuthorRef = {
  provider: 'zhihu';
  urlToken: string;
  profileUrl: string;
};

export type AuthorProviderErrorCode =
  | 'AUTHOR_PROVIDER_UNAVAILABLE'
  | 'AUTHOR_AUTH_REQUIRED'
  | 'AUTHOR_RATE_LIMITED'
  | 'AUTHOR_NOT_FOUND'
  | 'AUTHOR_CONTENT_UNSUPPORTED'
  | 'AUTHOR_EVIDENCE_INVALID';

export class AuthorProviderError extends Error {
  constructor(message: string, readonly code: AuthorProviderErrorCode, readonly status = 503) {
    super(message);
    this.name = 'AuthorProviderError';
  }
}

export const AUTHOR_PROVIDER_MESSAGES: Record<AuthorProviderErrorCode, string> = {
  AUTHOR_PROVIDER_UNAVAILABLE: '这位答主的资料暂时无法获取，请稍后再试。',
  AUTHOR_AUTH_REQUIRED: '读取这位答主的公开内容需要有效授权，请先登录知乎或稍后再试。',
  AUTHOR_RATE_LIMITED: '知乎接口暂时限流，请稍后再试。',
  AUTHOR_NOT_FOUND: '没有找到这个知乎主页，请确认链接是否指向公开的个人主页。',
  AUTHOR_CONTENT_UNSUPPORTED: '当前数据源不支持读取这位答主的公开回答，请换一位答主或稍后再试。',
  AUTHOR_EVIDENCE_INVALID: '在线返回的资料没有通过作者与来源校验，已丢弃。',
};

export function authorProviderErrorMessage(code: AuthorProviderErrorCode): string {
  return AUTHOR_PROVIDER_MESSAGES[code];
}

export function asAuthorProviderError(error: unknown, fallback: AuthorProviderErrorCode = 'AUTHOR_PROVIDER_UNAVAILABLE'): AuthorProviderError {
  if (error instanceof AuthorProviderError) return error;
  return new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES[fallback], fallback);
}

export function assertAuthorRef(ref: AuthorRef): AuthorRef {
  if (!ref || ref.provider !== 'zhihu') throw new AuthorProviderError('只支持知乎答主。', 'AUTHOR_CONTENT_UNSUPPORTED', 400);
  if (!isAuthorUrlToken(ref.urlToken)) throw new AuthorProviderError('知乎主页标识不合法。', 'AUTHOR_EVIDENCE_INVALID', 400);
  const expected = authorProfileUrl(ref.urlToken);
  if (ref.profileUrl !== expected) throw new AuthorProviderError('知乎主页地址与标识不一致。', 'AUTHOR_EVIDENCE_INVALID', 400);
  return ref;
}

export type AuthorProfile = {
  urlToken: string;
  profileUrl: string;
  displayName: string;
  avatarUrl?: string;
  headline?: string;
  answerCount?: number;
  gender: Gender | 'unknown';
  fetchedAt: string;
  source: 'official' | 'zhurl' | 'cache';
  stale?: boolean;
};

export type AnswerCollectionMethod = 'latest' | 'top-voteups' | 'profile-search' | 'runtime-live' | 'cache';

export type AnswerSummary = {
  answerId: string;
  authorUrlToken: string;
  questionTitle: string;
  sourceUrl: string;
  excerpt?: string;
  voteupCount?: number;
  createdAt?: string;
  collectionMethod: AnswerCollectionMethod;
  query?: string;
  stale?: boolean;
};

export type AuthorAnswerCompleteness = 'stored_body_unverified_against_live_page' | 'fetched_api_content_unverified' | 'verified_full_text';

export type AuthorAnswer = {
  answerId: string;
  authorUrlToken: string;
  authorName?: string;
  questionTitle: string;
  sourceUrl: string;
  body: string;
  completeness: AuthorAnswerCompleteness;
  collectedAt?: string;
  contentHash?: string;
  stale?: boolean;
};

export type ListAnswersOptions = {
  sort: 'latest' | 'top-voteups';
  limit: number;
  cursor?: string;
};

export interface AuthorProvider {
  resolveProfile(ref: AuthorRef): Promise<AuthorProfile>;
  listAnswers(ref: AuthorRef, options: ListAnswersOptions): Promise<AnswerSummary[]>;
  searchAnswers(ref: AuthorRef, query: string, limit: number): Promise<AnswerSummary[]>;
  readAnswer(ref: AuthorRef, answerId: string): Promise<AuthorAnswer>;
}

/* ------------------------------------------------------------------ */
/* 校验：在线结果必须先证明属于当前作者，才允许进入证据链。               */
/* ------------------------------------------------------------------ */

export const MAX_PROFILE_NAME_CHARS = 80;
export const MAX_PROFILE_HEADLINE_CHARS = 200;
export const MAX_SUMMARY_EXCERPT_CHARS = 500;
export const MAX_ANSWER_BODY_CHARS = 100_000;

const urlTokenSchema = z.string().regex(AUTHOR_URL_TOKEN_PATTERN);
const profileSchema = z.object({
  urlToken: urlTokenSchema,
  profileUrl: z.string().max(200),
  displayName: z.string().trim().min(1).max(MAX_PROFILE_NAME_CHARS),
  avatarUrl: z.string().max(500).optional(),
  headline: z.string().trim().max(MAX_PROFILE_HEADLINE_CHARS).optional(),
  answerCount: z.number().int().min(0).max(10_000_000).optional(),
  gender: z.enum(['男', '女', 'unknown']),
  fetchedAt: z.string().min(1).max(40),
  source: z.enum(['official', 'zhurl', 'cache']),
  stale: z.boolean().optional(),
}).strict();

const summarySchema = z.object({
  answerId: z.string().regex(/^\d+$/),
  authorUrlToken: urlTokenSchema,
  questionTitle: z.string().trim().min(1).max(500),
  sourceUrl: z.string().max(300),
  excerpt: z.string().max(MAX_SUMMARY_EXCERPT_CHARS).optional(),
  voteupCount: z.number().int().min(0).max(100_000_000).optional(),
  createdAt: z.string().max(40).optional(),
  collectionMethod: z.enum(['latest', 'top-voteups', 'profile-search', 'runtime-live', 'cache']),
  query: z.string().max(200).optional(),
  stale: z.boolean().optional(),
}).strict();

const answerSchema = z.object({
  answerId: z.string().regex(/^\d+$/),
  authorUrlToken: urlTokenSchema,
  authorName: z.string().trim().max(MAX_PROFILE_NAME_CHARS).optional(),
  questionTitle: z.string().trim().min(1).max(500),
  sourceUrl: z.string().max(300),
  body: z.string().trim().min(1).max(MAX_ANSWER_BODY_CHARS),
  completeness: z.enum(['stored_body_unverified_against_live_page', 'fetched_api_content_unverified', 'verified_full_text']),
  collectedAt: z.string().max(40).optional(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  stale: z.boolean().optional(),
}).strict();

function assertAuthorBound<T extends {authorUrlToken: string}>(value: T, ref: AuthorRef): T {
  if (value.authorUrlToken !== ref.urlToken) throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_EVIDENCE_INVALID, 'AUTHOR_EVIDENCE_INVALID');
  return value;
}

function assertSourceUrl(sourceUrl: string, answerId: string): void {
  try {
    validateAnswerSource(sourceUrl, answerId);
  } catch {
    throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_EVIDENCE_INVALID, 'AUTHOR_EVIDENCE_INVALID');
  }
}

export function validateAuthorProfile(value: unknown, ref: AuthorRef): AuthorProfile {
  const parsed = profileSchema.safeParse(value);
  if (!parsed.success) throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_EVIDENCE_INVALID, 'AUTHOR_EVIDENCE_INVALID');
  const profile = parsed.data;
  if (profile.urlToken !== ref.urlToken || profile.profileUrl !== authorProfileUrl(ref.urlToken)) {
    throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_EVIDENCE_INVALID, 'AUTHOR_EVIDENCE_INVALID');
  }
  return profile as AuthorProfile;
}

export function validateAnswerSummary(value: unknown, ref: AuthorRef): AnswerSummary {
  const parsed = summarySchema.safeParse(value);
  if (!parsed.success) throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_EVIDENCE_INVALID, 'AUTHOR_EVIDENCE_INVALID');
  const summary = assertAuthorBound(parsed.data, ref);
  assertSourceUrl(summary.sourceUrl, summary.answerId);
  return summary as AnswerSummary;
}

export function validateAuthorAnswer(value: unknown, ref: AuthorRef): AuthorAnswer {
  const parsed = answerSchema.safeParse(value);
  if (!parsed.success) throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_EVIDENCE_INVALID, 'AUTHOR_EVIDENCE_INVALID');
  const answer = assertAuthorBound(parsed.data, ref);
  assertSourceUrl(answer.sourceUrl, answer.answerId);
  return answer as AuthorAnswer;
}

export function authorProfileHostAllowed(host: string): boolean {
  return (AUTHOR_PROFILE_HOSTS as readonly string[]).includes(host);
}

/* ------------------------------------------------------------------ */
/* 缓存层接口与默认 TTL                                                 */
/* ------------------------------------------------------------------ */

export type CachedSearchResult = {items: AnswerSummary[]; cachedAt: string};

export interface AuthorCacheLike {
  readProfile(ref: AuthorRef, ttlMs: number): Promise<AuthorProfile | null>;
  writeProfile(ref: AuthorRef, profile: AuthorProfile): Promise<void>;
  readAnswers(ref: AuthorRef, sort: 'latest' | 'top-voteups', ttlMs: number): Promise<AnswerSummary[] | null>;
  writeAnswers(ref: AuthorRef, sort: 'latest' | 'top-voteups', items: AnswerSummary[]): Promise<void>;
  readSearch(ref: AuthorRef, query: string, limit: number, ttlMs: number): Promise<CachedSearchResult | null>;
  writeSearch(ref: AuthorRef, query: string, limit: number, items: AnswerSummary[]): Promise<void>;
  readAnswer(ref: AuthorRef, answerId: string, ttlMs: number): Promise<AuthorAnswer | null>;
  writeAnswer(ref: AuthorRef, answer: AuthorAnswer): Promise<void>;
}

export type AuthorCacheTtl = {
  profileMs: number; latestMs: number; topMs: number; searchMs: number; answerMs: number; negativeMs: number;
};

const HOUR = 60 * 60 * 1000;
export const DEFAULT_AUTHOR_CACHE_TTL: AuthorCacheTtl = {
  profileMs: 7 * 24 * HOUR,
  latestMs: 6 * HOUR,
  topMs: 24 * HOUR,
  searchMs: 6 * HOUR,
  answerMs: 7 * 24 * HOUR,
  negativeMs: 10 * 60 * 1000,
};

export type OnlineProviderResolver = () => Promise<AuthorProvider | undefined> | AuthorProvider | undefined;

export type HybridAuthorProviderOptions = {
  cache: AuthorCacheLike;
  online?: OnlineProviderResolver;
  ttl?: Partial<AuthorCacheTtl>;
  now?: () => number;
};

function staleOrThrow<T>(cached: T | null, error: unknown): T {
  if (cached) return cached;
  throw asAuthorProviderError(error);
}

/**
 * Live 模式唯一使用的统一入口：先本地缓存，不足时才最多调用一次在线 Provider。
 * 在线结果必须通过作者 token、answerId、sourceUrl 和正文校验后才写入缓存。
 */
export class HybridAuthorProvider implements AuthorProvider {
  private readonly ttl: AuthorCacheTtl;
  private readonly now: () => number;

  constructor(private readonly options: HybridAuthorProviderOptions) {
    this.ttl = {...DEFAULT_AUTHOR_CACHE_TTL, ...options.ttl};
    this.now = options.now ?? (() => Date.now());
  }

  async resolveProfile(ref: AuthorRef): Promise<AuthorProfile> {
    const bound = assertAuthorRef(ref);
    const cached = await this.options.cache.readProfile(bound, this.ttl.profileMs);
    if (cached) return {...cached, source: 'cache', stale: false};
    const stale = await this.options.cache.readProfile(bound, Number.MAX_SAFE_INTEGER);
    try {
      const online = await this.online();
      const profile = validateAuthorProfile(await online.resolveProfile(bound), bound);
      await this.options.cache.writeProfile(bound, profile);
      return profile;
    } catch (error) {
      if (stale) return {...stale, source: 'cache', stale: true};
      throw asAuthorProviderError(error);
    }
  }

  async listAnswers(ref: AuthorRef, options: ListAnswersOptions): Promise<AnswerSummary[]> {
    const bound = assertAuthorRef(ref);
    const ttl = options.sort === 'top-voteups' ? this.ttl.topMs : this.ttl.latestMs;
    const cached = await this.options.cache.readAnswers(bound, options.sort, ttl);
    if (cached) return cached.map((item) => ({...item, collectionMethod: 'cache', stale: false}));
    const stale = await this.options.cache.readAnswers(bound, options.sort, Number.MAX_SAFE_INTEGER);
    try {
      const online = await this.online();
      const items = (await online.listAnswers(bound, options)).map((item) => validateAnswerSummary(item, bound)).slice(0, options.limit);
      await this.options.cache.writeAnswers(bound, options.sort, items);
      return items;
    } catch (error) {
      if (stale) return stale.map((item) => ({...item, collectionMethod: 'cache' as const, stale: true}));
      throw asAuthorProviderError(error);
    }
  }

  async searchAnswers(ref: AuthorRef, query: string, limit: number): Promise<AnswerSummary[]> {
    const bound = assertAuthorRef(ref);
    const fresh = await this.options.cache.readSearch(bound, query, limit, this.ttl.searchMs);
    if (fresh) {
      const isNegative = fresh.items.length === 0;
      const age = this.now() - Date.parse(fresh.cachedAt);
      if (!isNegative || age <= this.ttl.negativeMs) return fresh.items.map((item) => ({...item, collectionMethod: 'cache', stale: false}));
    }
    const anyAge = await this.options.cache.readSearch(bound, query, limit, Number.MAX_SAFE_INTEGER);
    try {
      const online = await this.online();
      const items = (await online.searchAnswers(bound, query, limit)).map((item) => validateAnswerSummary(item, bound)).slice(0, limit);
      if (items.length) await this.options.cache.writeSearch(bound, query, limit, items);
      else await this.options.cache.writeSearch(bound, query, limit, []);
      return items;
    } catch (error) {
      if (anyAge && anyAge.items.length) return anyAge.items.map((item) => ({...item, collectionMethod: 'cache', stale: true}));
      throw asAuthorProviderError(error);
    }
  }

  async readAnswer(ref: AuthorRef, answerId: string): Promise<AuthorAnswer> {
    const bound = assertAuthorRef(ref);
    if (!/^\d+$/.test(answerId)) throw new AuthorProviderError('回答标识不合法。', 'AUTHOR_EVIDENCE_INVALID', 400);
    const cached = await this.options.cache.readAnswer(bound, answerId, this.ttl.answerMs);
    if (cached) return cached;
    const stale = await this.options.cache.readAnswer(bound, answerId, Number.MAX_SAFE_INTEGER);
    try {
      const online = await this.online();
      const answer = validateAuthorAnswer(await online.readAnswer(bound, answerId), bound);
      await this.options.cache.writeAnswer(bound, {...answer, stale: undefined});
      return answer;
    } catch (error) {
      if (stale) return {...stale, stale: true};
      throw asAuthorProviderError(error);
    }
  }

  async negativeTtlMs(): Promise<number> {
    return this.ttl.negativeMs;
  }

  private async online(): Promise<AuthorProvider> {
    const resolved = typeof this.options.online === 'function' ? await this.options.online() : this.options.online;
    if (!resolved) throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_PROVIDER_UNAVAILABLE, 'AUTHOR_PROVIDER_UNAVAILABLE');
    return resolved;
  }
}

export type {DerivedAuthorGender};
