import path from 'node:path';
import {resolveAuthorAvatar} from './author-avatars';
import {AUTHOR_CAST_REGISTRATIONS, resolveAuthorCastRegistration, type AuthorCastRegistration} from './author-cast';
import {countAuthorCorpus} from './author-corpus';
import {AUTHOR_CAST_ID_PATTERN, fictionalAuthorAge, fictionalAuthorName, invitedAuthorCapabilitiesFor, type AuthorDomain} from './author-identity';
import {listInvitedAuthors, defaultAuthorRegistryRoot, type InvitedAuthor} from './author-registry';
import {isStyleCardFresh} from './author-style';
import {readStyleCard} from './author-style-runtime';
import {defaultAuthorDataRoot} from './author-chat';
import type {Gender} from './story';

/**
 * 选人页使用的答主目录条目：只包含化名、领域、资料状态和虚构声明，
 * 真实作者公开资料只以“来源”标注出现，不作为剧情身份。
 */
export type AuthorCatalogEntry = {
  id: string;
  name: string;
  kind: 'zhihu-author';
  gender: Gender | 'unknown';
  age: number;
  identity: string;
  domains: string[];
  personaStatus: 'fictional';
  corpusStatus: 'evidence-only' | 'unavailable';
  corpusCount: number;
  styleStatus: 'unreviewed' | 'auto' | 'reviewed';
  disclosure: string;
  selectable: boolean;
  capabilities: {canChat: boolean; canEnterStory: boolean; canEnterRomance: boolean};
  source: 'registered' | 'invited';
  profileUrl?: string;
  sourceDisplayName?: string;
  sourceHeadline?: string;
  avatarUrl?: string;
  invitedAt?: string;
  capturedAt?: string;
};

/** 头像统一走服务端缓存路由：热链可能被拦，代理还能离线回放。 */
export function authorAvatarProxyUrl(castId: string): string {
  return `/api/authors/avatar/${castId}`;
}

export function registeredAuthorCatalogEntry(registration: AuthorCastRegistration, corpusCount: number, styleStatus: AuthorCatalogEntry['styleStatus'] = registration.styleStatus): AuthorCatalogEntry {
  const avatar = resolveAuthorAvatar(registration.authorAvatarId);
  return {
    id: registration.castId,
    name: registration.displayName,
    kind: 'zhihu-author',
    gender: registration.gender,
    age: registration.age,
    identity: registration.identity,
    domains: [...registration.domains],
    personaStatus: 'fictional',
    corpusStatus: avatar && corpusCount > 0 ? registration.corpusStatus : 'unavailable',
    corpusCount,
    styleStatus,
    disclosure: registration.disclosure,
    selectable: true,
    capabilities: {canChat: true, canEnterStory: true, canEnterRomance: registration.canEnterRomance},
    source: 'registered',
    ...(avatar ? {profileUrl: avatar.sourceAuthorProfileUrl, sourceDisplayName: avatar.sourceAuthorName} : {}),
    avatarUrl: authorAvatarProxyUrl(registration.castId),
  };
}

export function invitedAuthorCatalogEntry(entry: InvitedAuthor, corpusCount: number, styleStatus: AuthorCatalogEntry['styleStatus'] = 'unreviewed'): AuthorCatalogEntry {
  const capabilities = invitedAuthorCapabilitiesFor(entry.urlToken);
  return {
    id: entry.castId,
    name: fictionalAuthorName(entry.urlToken),
    kind: 'zhihu-author',
    gender: entry.gender,
    age: fictionalAuthorAge(entry.urlToken),
    identity: `邀请答主 · ${entry.domains.join('、')}`,
    domains: [...entry.domains] as AuthorDomain[],
    personaStatus: 'fictional',
    corpusStatus: corpusCount > 0 ? 'evidence-only' : 'unavailable',
    corpusCount,
    styleStatus,
    disclosure: entry.disclosure,
    selectable: true,
    capabilities,
    source: 'invited',
    profileUrl: entry.profileUrl,
    sourceDisplayName: entry.source.displayName,
    avatarUrl: authorAvatarProxyUrl(entry.castId),
    ...(entry.source.headline ? {sourceHeadline: entry.source.headline} : {}),
    invitedAt: entry.invitedAt,
    capturedAt: entry.authorSnapshot.capturedAt,
  };
}

export function isInvitedAuthorCastId(value: string): boolean {
  return AUTHOR_CAST_ID_PATTERN.test(value);
}

/** 选人页目录：注册答主 + 已成功邀请的答主，附带各自本地语料条数与风格卡状态。 */
export async function buildAuthorCatalog(root = defaultAuthorDataRoot(), registryRoot = defaultAuthorRegistryRoot()): Promise<AuthorCatalogEntry[]> {
  const corpusCount = async (urlToken: string): Promise<number> => {
    try {
      return await countAuthorCorpus(path.join(root, urlToken), urlToken);
    } catch {
      return 0;
    }
  };
  const styleStatus = async (urlToken: string): Promise<AuthorCatalogEntry['styleStatus']> => {
    const card = await readStyleCard(root, urlToken);
    if (card?.status === 'reviewed') return 'reviewed';
    if (card?.status === 'auto' && isStyleCardFresh(card)) return 'auto';
    return 'unreviewed';
  };
  const registered: AuthorCatalogEntry[] = [];
  for (const registration of AUTHOR_CAST_REGISTRATIONS) {
    const avatar = resolveAuthorAvatar(registration.authorAvatarId);
    registered.push(registeredAuthorCatalogEntry(
      registration,
      avatar ? await corpusCount(avatar.sourceAuthorUrlToken) : 0,
      avatar ? await styleStatus(avatar.sourceAuthorUrlToken) : 'unreviewed',
    ));
  }
  const invited: AuthorCatalogEntry[] = [];
  for (const entry of await listInvitedAuthors(registryRoot)) {
    invited.push(invitedAuthorCatalogEntry(entry, await corpusCount(entry.urlToken), await styleStatus(entry.urlToken)));
  }
  return [...registered, ...invited];
}
