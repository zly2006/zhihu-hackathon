import {defaultAuthorDataRoot} from './author-chat';
import {createLiveAuthorProvider} from './author-live-provider';
import {officialViewerFromProfile, type OfficialViewer} from './author-provider-official';

export type SessionLike = {
  accessToken?: string | null;
  profile?: {id: string | null; name: string | null; avatarUrl: string | null; headline: string | null} | null;
} | null;

export function officialAccessSecret(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = (env.ZHIHU_OAUTH_ACCESS_SECRET || env.ZHIHU_ACCESS_SECRET || '').trim();
  return value || undefined;
}

export function sessionViewer(session: SessionLike): OfficialViewer | null {
  return officialViewerFromProfile(session?.profile ?? null);
}

/**
 * 运行时 Provider：OAuth 会话只用来判断“是否代表当前授权用户自己”，
 * 与目标答主的公开内容来源严格分开。
 *
 * 公开内容来源由 ZHIHU_WEB_COOKIE（服务端环境变量）驱动；本地开发未配置时自动
 * 回退到知乎++ 的 account.json。两者都没有时，邀请仍会尝试公开主页兜底，
 * 回答检索则明确返回 AUTHOR_SOURCE_UNCONFIGURED。
 */
export function createSessionAuthorProvider(session: SessionLike, env: NodeJS.ProcessEnv = process.env) {
  return createLiveAuthorProvider({
    root: defaultAuthorDataRoot(),
    viewer: sessionViewer(session),
    oauthToken: session?.accessToken ?? undefined,
    accessSecret: officialAccessSecret(env),
    env,
  });
}
