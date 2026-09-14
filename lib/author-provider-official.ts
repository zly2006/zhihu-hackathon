import {authorProfileUrl, isAuthorUrlToken} from './author-identity';
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
 * ZhihuOfficialProvider 只使用官方明确支持的用户数据 API。
 *
 * 官方接口的身份模型是“Access Secret 识别调用方，X-OAuth-Token 代表当前授权用户”，
 * 因此它只能读取授权用户自己的开放数据，不能读取任意第三方答主的完整回答。
 * 遇到不支持的请求时必须明确返回 AUTHOR_AUTH_REQUIRED / AUTHOR_CONTENT_UNSUPPORTED，
 * 绝不静默改读当前登录用户的数据。
 */

export const DEFAULT_OFFICIAL_BASE_URL = 'https://developer.zhihu.com';

export type OfficialViewer = {
  urlToken: string;
  displayName: string;
  avatarUrl?: string;
  headline?: string;
  gender?: Gender | 'unknown';
};

export type ZhihuOfficialProviderOptions = {
  accessSecret?: string;
  oauthToken?: string;
  viewer?: OfficialViewer | null;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const ANSWER_URL_PATTERN = /^https?:\/\/(?:www\.)?zhihu\.com\/answer\/(\d+)\/?$/;

function toIsoSeconds(value: unknown): string | undefined {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return new Date(seconds * 1000).toISOString();
}

function answerIdFromUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = ANSWER_URL_PATTERN.exec(value.trim());
  return match?.[1];
}

export class ZhihuOfficialProvider implements AuthorProvider {
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;

  constructor(private readonly options: ZhihuOfficialProviderOptions = {}) {
    this.fetchImpl = (options.fetchImpl ?? fetch) as FetchLike;
    this.now = options.now ?? (() => Date.now());
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.baseUrl = (options.baseUrl ?? DEFAULT_OFFICIAL_BASE_URL).replace(/\/$/, '');
  }

  hasCredentials(): boolean {
    return Boolean(this.options.accessSecret && this.options.oauthToken && this.options.viewer?.urlToken);
  }

  private requireViewer(ref: AuthorRef): void {
    if (!this.hasCredentials()) throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_AUTH_REQUIRED, 'AUTHOR_AUTH_REQUIRED', 401);
    if (this.options.viewer?.urlToken !== ref.urlToken) {
      throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_CONTENT_UNSUPPORTED, 'AUTHOR_CONTENT_UNSUPPORTED', 400);
    }
  }

  private async call(pathname: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    const url = new URL(`${this.baseUrl}${pathname}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.options.accessSecret ?? ''}`,
      'X-Request-Timestamp': String(Math.floor(this.now() / 1000)),
      Accept: 'application/json',
    };
    if (this.options.oauthToken) headers['X-OAuth-Token'] = this.options.oauthToken;
    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {headers, signal: AbortSignal.timeout(this.timeoutMs), cache: 'no-store'});
    } catch {
      throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_PROVIDER_UNAVAILABLE, 'AUTHOR_PROVIDER_UNAVAILABLE', 503);
    }
    let body: Record<string, unknown> = {};
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const code = Number(body.Code);
    if (!response.ok || (Number.isFinite(code) && code !== 0)) {
      if (response.status === 401 || response.status === 403 || code === 20001) {
        throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_AUTH_REQUIRED, 'AUTHOR_AUTH_REQUIRED', 401);
      }
      if (response.status === 429 || code === 30001 || code === 30002) {
        throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_RATE_LIMITED, 'AUTHOR_RATE_LIMITED', 429);
      }
      if (Number.isFinite(code) && code === 10001) {
        throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_EVIDENCE_INVALID, 'AUTHOR_EVIDENCE_INVALID', 400);
      }
      throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_PROVIDER_UNAVAILABLE, 'AUTHOR_PROVIDER_UNAVAILABLE', 503);
    }
    return body;
  }

  async resolveProfile(ref: AuthorRef): Promise<AuthorProfile> {
    const bound = assertAuthorRef(ref);
    this.requireViewer(bound);
    const viewer = this.options.viewer!;
    return {
      urlToken: bound.urlToken,
      profileUrl: authorProfileUrl(bound.urlToken),
      displayName: viewer.displayName.slice(0, 80),
      ...(viewer.avatarUrl ? {avatarUrl: viewer.avatarUrl.slice(0, 500)} : {}),
      ...(viewer.headline ? {headline: viewer.headline.slice(0, 200)} : {}),
      gender: viewer.gender && viewer.gender !== 'unknown' ? viewer.gender : 'unknown',
      fetchedAt: new Date(this.now()).toISOString(),
      source: 'official',
    };
  }

  /** 官方接口只提供授权用户自己的内容列表，摘要不能当作完整正文。 */
  async listAnswers(ref: AuthorRef, options: ListAnswersOptions): Promise<AnswerSummary[]> {
    const bound = assertAuthorRef(ref);
    this.requireViewer(bound);
    if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 50) throw new AuthorProviderError('列表数量必须是 1 到 50。', 'AUTHOR_EVIDENCE_INVALID', 400);
    const body = await this.call('/api/v1/user/contents', {
      ContentType: 'answer',
      SortField: options.sort === 'top-voteups' ? 'like_count' : 'ts',
      SortOrder: 'desc',
      Offset: options.cursor && /^\d+$/.test(options.cursor) ? options.cursor : '0',
      Limit: String(options.limit),
    });
    const data = (body.Data ?? {}) as Record<string, unknown>;
    const items = Array.isArray(data.Items) ? data.Items : [];
    const summaries: AnswerSummary[] = [];
    for (const item of items) {
      const record = (item ?? {}) as Record<string, unknown>;
      if (String(record.ContentType || '') !== 'answer') continue;
      const answerId = answerIdFromUrl(record.Url);
      const title = typeof record.Title === 'string' ? record.Title.trim() : '';
      if (!answerId || !title) continue;
      summaries.push({
        answerId,
        authorUrlToken: bound.urlToken,
        questionTitle: title.slice(0, 500),
        sourceUrl: `https://www.zhihu.com/answer/${answerId}`,
        ...(typeof record.Summary === 'string' && record.Summary.trim() ? {excerpt: record.Summary.trim().slice(0, 500)} : {}),
        ...(Number.isFinite(Number(record.LikeCount)) ? {voteupCount: Math.max(0, Number(record.LikeCount))} : {}),
        ...(toIsoSeconds(record.CreatedAt) ? {createdAt: toIsoSeconds(record.CreatedAt)!} : {}),
        collectionMethod: 'runtime-live',
      });
    }
    return summaries.slice(0, options.limit);
  }

  async searchAnswers(ref: AuthorRef): Promise<AnswerSummary[]> {
    assertAuthorRef(ref);
    throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_CONTENT_UNSUPPORTED, 'AUTHOR_CONTENT_UNSUPPORTED', 400);
  }

  async readAnswer(ref: AuthorRef): Promise<AuthorAnswer> {
    assertAuthorRef(ref);
    throw new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_CONTENT_UNSUPPORTED, 'AUTHOR_CONTENT_UNSUPPORTED', 400);
  }
}

export function officialViewerFromProfile(profile: {id: string | null; name: string | null; avatarUrl: string | null; headline: string | null} | null | undefined): OfficialViewer | null {
  if (!profile) return null;
  const urlToken = typeof profile.id === 'string' ? profile.id.trim() : '';
  const displayName = typeof profile.name === 'string' ? profile.name.trim() : '';
  if (!isAuthorUrlToken(urlToken) || !displayName) return null;
  return {
    urlToken,
    displayName,
    ...(profile.avatarUrl ? {avatarUrl: profile.avatarUrl} : {}),
    ...(profile.headline ? {headline: profile.headline} : {}),
    gender: 'unknown',
  };
}
