import {
  AUTHOR_PROVIDER_MESSAGES,
  AuthorProviderError,
  asAuthorProviderError,
  type AnswerSummary,
  type AuthorAnswer,
  type AuthorProfile,
  type AuthorProvider,
  type AuthorRef,
  type ListAnswersOptions,
  type OnlineProviderResolver,
} from './author-provider';
import {HybridAuthorProvider} from './author-provider';
import {FileAuthorCache} from './author-cache';
import {ZhihuOfficialProvider, type OfficialViewer} from './author-provider-official';

/**
 * Live 模式的 Provider 组装点。
 *
 * 用户只看到“知乎答主”，看不到 online/offline/hybrid。内部按顺序尝试：
 * 1. ZhihuOfficialProvider：只在代表当前授权用户自己时可用；
 * 2. ZhurlProvider：仅本地开发/受控采料，生产构建不加载。
 * 两者都不可用时返回明确的 AUTHOR_AUTH_REQUIRED / AUTHOR_PROVIDER_UNAVAILABLE。
 */

const ERROR_RANK: Record<string, number> = {
  AUTHOR_AUTH_REQUIRED: 4,
  AUTHOR_RATE_LIMITED: 3,
  AUTHOR_CONTENT_UNSUPPORTED: 2,
  AUTHOR_NOT_FOUND: 2,
  AUTHOR_EVIDENCE_INVALID: 1,
  AUTHOR_PROVIDER_UNAVAILABLE: 0,
};

export function rankProviderError(error: unknown): number {
  if (error instanceof AuthorProviderError) return ERROR_RANK[error.code] ?? 0;
  return 0;
}

/** 依次尝试多个来源；全部失败时返回信息量最大的那个错误。 */
export class CompositeAuthorProvider implements AuthorProvider {
  constructor(private readonly providers: readonly AuthorProvider[]) {}

  private async attempt<T>(task: (provider: AuthorProvider) => Promise<T>): Promise<T> {
    let best: unknown = new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_PROVIDER_UNAVAILABLE, 'AUTHOR_PROVIDER_UNAVAILABLE');
    for (const provider of this.providers) {
      try {
        return await task(provider);
      } catch (error) {
        if (rankProviderError(error) > rankProviderError(best)) best = error;
      }
    }
    throw asAuthorProviderError(best);
  }

  resolveProfile(ref: AuthorRef): Promise<AuthorProfile> {
    return this.attempt((provider) => provider.resolveProfile(ref));
  }

  listAnswers(ref: AuthorRef, options: ListAnswersOptions): Promise<AnswerSummary[]> {
    return this.attempt((provider) => provider.listAnswers(ref, options));
  }

  searchAnswers(ref: AuthorRef, query: string, limit: number): Promise<AnswerSummary[]> {
    return this.attempt((provider) => provider.searchAnswers(ref, query, limit));
  }

  readAnswer(ref: AuthorRef, answerId: string): Promise<AuthorAnswer> {
    return this.attempt((provider) => provider.readAnswer(ref, answerId));
  }
}

class UnavailableAuthorProvider implements AuthorProvider {
  constructor(private readonly viewerToken?: string) {}

  private error(ref: AuthorRef): AuthorProviderError {
    if (this.viewerToken && this.viewerToken === ref.urlToken) {
      return new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_AUTH_REQUIRED, 'AUTHOR_AUTH_REQUIRED', 401);
    }
    return new AuthorProviderError(AUTHOR_PROVIDER_MESSAGES.AUTHOR_PROVIDER_UNAVAILABLE, 'AUTHOR_PROVIDER_UNAVAILABLE', 503);
  }

  async resolveProfile(ref: AuthorRef): Promise<AuthorProfile> { throw this.error(ref); }
  async listAnswers(ref: AuthorRef): Promise<AnswerSummary[]> { throw this.error(ref); }
  async searchAnswers(ref: AuthorRef): Promise<AnswerSummary[]> { throw this.error(ref); }
  async readAnswer(ref: AuthorRef): Promise<AuthorAnswer> { throw this.error(ref); }
}

export type ZhurlLoader = (bin: string) => Promise<AuthorProvider>;

/** 开发环境才允许加载 zhurl；生产构建不会执行这条分支。 */
const defaultZhurlLoader: ZhurlLoader = async (bin: string) => {
  const module = await import('./author-provider-zhurl');
  return new module.ZhurlProvider({run: module.createSpawnZhurlRunner(bin)});
};

export type LiveProviderOptions = {
  root: string;
  viewer?: OfficialViewer | null;
  oauthToken?: string;
  accessSecret?: string;
  online?: OnlineProviderResolver;
  cacheRoot?: string;
  loadZhurl?: ZhurlLoader;
  env?: NodeJS.ProcessEnv;
};

export function createLiveAuthorProvider(options: LiveProviderOptions): HybridAuthorProvider {
  const env = options.env ?? process.env;
  const cache = new FileAuthorCache(options.cacheRoot ?? options.root);
  let onlinePromise: Promise<AuthorProvider> | undefined;
  const buildOnline = async (): Promise<AuthorProvider> => {
    const providers: AuthorProvider[] = [];
    if (options.accessSecret && options.oauthToken && options.viewer) {
      providers.push(new ZhihuOfficialProvider({accessSecret: options.accessSecret, oauthToken: options.oauthToken, viewer: options.viewer}));
    }
    const bin = env.ZHURL_BIN?.trim();
    if (bin && env.NODE_ENV !== 'production') {
      try {
        providers.push(await (options.loadZhurl ?? defaultZhurlLoader)(bin));
      } catch {
        // 开发环境加载失败时退化为剩余来源，不静默伪造数据。
      }
    }
    if (!providers.length) return new UnavailableAuthorProvider(options.viewer?.urlToken);
    return providers.length === 1 ? providers[0] : new CompositeAuthorProvider(providers);
  };
  const resolveOnline = async (): Promise<AuthorProvider> => {
    onlinePromise ??= buildOnline();
    return onlinePromise;
  };
  return new HybridAuthorProvider({cache, online: options.online ?? resolveOnline});
}

export function createCachedOnlyAuthorProvider(options: {root: string; online?: OnlineProviderResolver}): HybridAuthorProvider {
  return new HybridAuthorProvider({cache: new FileAuthorCache(options.root), online: options.online});
}
