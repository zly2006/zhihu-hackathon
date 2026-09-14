import {AUTHOR_CAST_REGISTRATIONS, FICTIONAL_DISCLOSURE} from './author-cast';
import {resolveAuthorAvatar} from './author-avatars';
import {
  AUTHOR_PROFILE_HOSTS,
  AUTHOR_PROFILE_PATH_PATTERN,
  AUTHOR_URL_TOKEN_PATTERN,
  authorDomainTags,
  authorProfileUrl,
  deriveAuthorCastId,
  fictionalAuthorName,
  isAuthorCastId,
  type AuthorDomain,
} from './author-identity';
import {AuthorProviderError, authorProviderErrorMessage, type AuthorProvider, type AuthorRef} from './author-provider';
import {
  INVITED_AUTHOR_SCHEMA_VERSION,
  defaultAuthorRegistryRoot,
  findInvitedAuthorByToken,
  profileHashOf,
  writeInvitedAuthor,
  type InvitedAuthor,
} from './author-registry';

/**
 * 任意答主邀请流程的服务端实现。
 *
 * 用户输入只能是知乎个人主页链接或 url_token；服务端固定域名和路径校验后才解析标识，
 * 资料读取失败绝不创建半成品角色。
 */

export type AuthorInviteErrorCode =
  | 'AUTHOR_INPUT_INVALID'
  | 'AUTHOR_INPUT_UNSUPPORTED_URL'
  | 'AUTHOR_ALREADY_REGISTERED'
  | 'AUTHOR_PROVIDER_UNAVAILABLE'
  | 'AUTHOR_AUTH_REQUIRED'
  | 'AUTHOR_RATE_LIMITED'
  | 'AUTHOR_NOT_FOUND'
  | 'AUTHOR_CONTENT_UNSUPPORTED'
  | 'AUTHOR_EVIDENCE_INVALID'
  | 'AUTHOR_SOURCE_UNCONFIGURED';

export class AuthorInviteError extends Error {
  constructor(message: string, readonly code: AuthorInviteErrorCode, readonly status = 400) {
    super(message);
    this.name = 'AuthorInviteError';
  }
}

export const MAX_AUTHOR_INPUT_CHARS = 300;

export type ParsedAuthorInput = AuthorRef;

export function parseAuthorProfileInput(raw: unknown): ParsedAuthorInput {
  if (typeof raw !== 'string') throw new AuthorInviteError('请粘贴知乎个人主页链接或主页标识。', 'AUTHOR_INPUT_INVALID');
  const input = raw.trim();
  if (!input || input.length > MAX_AUTHOR_INPUT_CHARS) throw new AuthorInviteError('请粘贴知乎个人主页链接或主页标识。', 'AUTHOR_INPUT_INVALID');
  if (/[\u0000-\u001f\u007f\s]/.test(input)) throw new AuthorInviteError('输入里不能包含空格或控制字符。', 'AUTHOR_INPUT_INVALID');
  if (!/^https?:\/\//i.test(input)) {
    if (!AUTHOR_URL_TOKEN_PATTERN.test(input)) throw new AuthorInviteError('这看起来不是知乎个人主页链接或主页标识。', 'AUTHOR_INPUT_INVALID');
    return {provider: 'zhihu', urlToken: input, profileUrl: authorProfileUrl(input)};
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AuthorInviteError('链接格式不正确。', 'AUTHOR_INPUT_INVALID');
  }
  if (url.protocol !== 'https:') throw new AuthorInviteError('只接受 https 的知乎个人主页链接。', 'AUTHOR_INPUT_UNSUPPORTED_URL');
  if (!(AUTHOR_PROFILE_HOSTS as readonly string[]).includes(url.hostname)) throw new AuthorInviteError('只接受 zhihu.com 的知乎个人主页链接。', 'AUTHOR_INPUT_UNSUPPORTED_URL');
  if (url.port || url.username || url.password || url.search || url.hash) throw new AuthorInviteError('链接不能包含端口、认证信息或参数。', 'AUTHOR_INPUT_UNSUPPORTED_URL');
  const match = AUTHOR_PROFILE_PATH_PATTERN.exec(url.pathname);
  if (!match) throw new AuthorInviteError('只接受 /people/<主页标识> 形式的个人主页链接。', 'AUTHOR_INPUT_UNSUPPORTED_URL');
  const urlToken = match[1];
  if (!AUTHOR_URL_TOKEN_PATTERN.test(urlToken)) throw new AuthorInviteError('主页标识不合法。', 'AUTHOR_INPUT_INVALID');
  return {provider: 'zhihu', urlToken, profileUrl: authorProfileUrl(urlToken)};
}

export type InviteAuthorOptions = {
  input: unknown;
  provider: AuthorProvider;
  registryRoot?: string;
  now?: () => number;
};

export type InviteAuthorResult = {entry: InvitedAuthor; created: boolean; fictionalName: string; domains: AuthorDomain[]};

function mapProviderError(error: unknown): AuthorInviteError {
  if (error instanceof AuthorProviderError) {
    const status = error.code === 'AUTHOR_AUTH_REQUIRED' ? 401 : error.code === 'AUTHOR_RATE_LIMITED' ? 429 : error.code === 'AUTHOR_NOT_FOUND' ? 404 : 503;
    return new AuthorInviteError(authorProviderErrorMessage(error.code), error.code, status);
  }
  return new AuthorInviteError(authorProviderErrorMessage('AUTHOR_PROVIDER_UNAVAILABLE'), 'AUTHOR_PROVIDER_UNAVAILABLE', 503);
}

/**
 * 已经以评审角色注册过的作者不能再被重复邀请，
 * 否则同一作者会以两个化名同时出现在选人页。
 */
export function registeredAuthorForToken(urlToken: string): {castId: string; name: string; profileUrl: string} | undefined {
  for (const registration of AUTHOR_CAST_REGISTRATIONS) {
    const avatar = resolveAuthorAvatar(registration.authorAvatarId);
    if (avatar?.sourceAuthorUrlToken === urlToken) {
      return {castId: registration.castId, name: registration.displayName, profileUrl: avatar.sourceAuthorProfileUrl};
    }
  }
  return undefined;
}

/**
 * 邀请一位答主：解析 → 读取资料 → 冻结快照 → 注册。
 * 已注册过的标识直接返回原记录，不重复请求在线数据。
 */
export async function inviteAuthor(options: InviteAuthorOptions): Promise<InviteAuthorResult> {
  const ref = parseAuthorProfileInput(options.input);
  const known = registeredAuthorForToken(ref.urlToken);
  if (known) throw new AuthorInviteError(`这位作者的公开内容已经以「${known.name}」的身份在答主列表中。`, 'AUTHOR_ALREADY_REGISTERED', 409);
  const root = options.registryRoot ?? defaultAuthorRegistryRoot();
  const existing = await findInvitedAuthorByToken(root, ref.urlToken);
  if (existing) {
    return {entry: existing, created: false, fictionalName: fictionalAuthorName(existing.urlToken), domains: [...existing.domains]};
  }
  let profile;
  try {
    profile = await options.provider.resolveProfile(ref);
  } catch (error) {
    throw mapProviderError(error);
  }
  const displayName = profile.displayName.trim().slice(0, 80);
  if (!displayName) throw new AuthorInviteError('没有读到这位答主的公开资料，请稍后再试。', 'AUTHOR_PROVIDER_UNAVAILABLE', 503);
  if (!isAuthorCastId(deriveAuthorCastId(ref.urlToken, profile.gender))) throw new AuthorInviteError('无法为这位答主创建角色。', 'AUTHOR_EVIDENCE_INVALID', 500);
  const domains = authorDomainTags([displayName, profile.headline]);
  const capturedAt = new Date(options.now?.() ?? Date.now()).toISOString();
  const entry: InvitedAuthor = {
    schemaVersion: INVITED_AUTHOR_SCHEMA_VERSION,
    castId: deriveAuthorCastId(ref.urlToken, profile.gender),
    urlToken: ref.urlToken,
    profileUrl: authorProfileUrl(ref.urlToken),
    gender: profile.gender,
    domains,
    personaStatus: 'fictional',
    disclosure: FICTIONAL_DISCLOSURE,
    authorSnapshot: {
      authorUrlToken: ref.urlToken,
      profileHash: profileHashOf({urlToken: ref.urlToken}),
      capturedAt,
    },
    source: {
      displayName,
      ...(profile.headline ? {headline: profile.headline} : {}),
      ...(profile.avatarUrl ? {avatarUrl: profile.avatarUrl} : {}),
      profileUrl: authorProfileUrl(ref.urlToken),
      fetchedAt: profile.fetchedAt,
      kind: profile.source === 'official' ? 'official' : 'web',
    },
    invitedAt: capturedAt,
  };
  const stored = await writeInvitedAuthor(root, entry);
  return {entry: stored, created: true, fictionalName: fictionalAuthorName(stored.urlToken), domains: [...stored.domains]};
}
