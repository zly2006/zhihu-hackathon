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
import {createZhihuWebProvider} from './author-provider-zhihu-web';
import {resolveWebCredentials, type WebCredentials} from './author-web-credentials';

/**
 * Live 模式的 Provider 组装点。
 *
 * 用户只看到“知乎答主”，看不到 online/offline/hybrid。内部按顺序尝试：
 * 1. ZhihuOfficialProvider：只在代表当前授权用户自己时可用（OAuth + Access Secret）；
 * 2. ZhihuWebProvider：服务端公开内容来源（纯 TS），凭证来自环境变量 ZHIHU_WEB_COOKIE，
 *    本地自动回退到知乎++ account.json；未配置时明确返回 AUTHOR_SOURCE_UNCONFIGURED。
 *
 * 同一套实现同时用于本地与线上，功能不再按环境分叉。
 */

const ERROR_RANK: Record<string, number> = {
  AUTHOR_AUTH_REQUIRED: 4,
  AUTHOR_SOURCE_UNCONFIGURED: 4,
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

export type LiveProviderOptions = {
  root: string;
  viewer?: OfficialViewer | null;
  oauthToken?: string;
  accessSecret?: string;
  online?: OnlineProviderResolver;
  cacheRoot?: string;
  credentials?: WebCredentials | null;
  env?: NodeJS.ProcessEnv;
  /** 测试注入：跳过凭证解析与真实网络。 */
  webProvider?: AuthorProvider;
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
    if (options.webProvider) {
      providers.push(options.webProvider);
    } else {
      const credentials = options.credentials !== undefined ? options.credentials : resolveWebCredentials(env);
      providers.push(createZhihuWebProvider({credentials}));
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
