import {mkdir, readFile, readdir, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {
  AUTHOR_CAST_ID_PATTERN,
  AUTHOR_DOMAINS,
  AUTHOR_URL_TOKEN_PATTERN,
  MAX_AUTHOR_DOMAINS,
  authorBindingHash,
  authorProfileUrl,
  deriveAuthorCastId,
  invitedAuthorCapabilitiesFor,
  normalizeAuthorDomain,
  type AuthorDomain,
} from './author-identity';
import type {Gender} from './story';

/**
 * 已邀请答主注册表。
 *
 * 只保存“服务端已成功读取过资料”的答主；每条记录冻结本局使用的 authorSnapshot。
 * 真实作者的公开资料只用于邀请确认卡，剧情身份始终使用派生化名与虚构领域标签。
 */

export const INVITED_AUTHOR_SCHEMA_VERSION = 1;

const snapshotSchema = z.object({
  authorUrlToken: z.string().regex(AUTHOR_URL_TOKEN_PATTERN),
  profileHash: z.string().regex(/^[0-9a-f]{64}$/),
  corpusVersion: z.string().max(80).optional(),
  capturedAt: z.string().min(1).max(40),
}).strict();

const sourceSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  headline: z.string().trim().max(200).optional(),
  avatarUrl: z.string().max(500).optional(),
  profileUrl: z.string().max(200),
  fetchedAt: z.string().min(1).max(40),
  kind: z.enum(['official', 'web', 'zhurl']).transform((value) => (value === 'zhurl' ? 'web' : value)),
}).strict();

export const invitedAuthorSchema = z.object({
  schemaVersion: z.literal(INVITED_AUTHOR_SCHEMA_VERSION),
  castId: z.string().regex(AUTHOR_CAST_ID_PATTERN),
  urlToken: z.string().regex(AUTHOR_URL_TOKEN_PATTERN),
  profileUrl: z.string().max(200),
  gender: z.enum(['女', '男', 'unknown']),
  domains: z.array(z.enum(AUTHOR_DOMAINS)).min(1).max(MAX_AUTHOR_DOMAINS),
  personaStatus: z.literal('fictional'),
  disclosure: z.string().trim().min(1).max(120),
  authorSnapshot: snapshotSchema,
  source: sourceSchema,
  invitedAt: z.string().min(1).max(40),
}).strict().superRefine((entry, context) => {
  if (entry.profileUrl !== authorProfileUrl(entry.urlToken)) context.addIssue({code: 'custom', message: '主页地址与标识不一致'});
  if (entry.authorSnapshot.authorUrlToken !== entry.urlToken) context.addIssue({code: 'custom', message: '快照作者与记录不一致'});
  const expectedCastId = deriveAuthorCastId(entry.urlToken, entry.gender);
  if (entry.castId !== expectedCastId) context.addIssue({code: 'custom', message: '角色 ID 与作者标识不一致'});
  if (entry.domains.some((domain) => !normalizeAuthorDomain(domain))) context.addIssue({code: 'custom', message: '领域标签不在白名单内'});
});

export type InvitedAuthor = z.infer<typeof invitedAuthorSchema>;

export function defaultAuthorRegistryRoot(cwd = process.cwd()): string {
  return path.join(cwd, '.data', 'author-cast');
}

/** 快照摘要只依赖主页标识，保证同一标识在任何实例上都得到同一份身份绑定。 */
export function profileHashOf(input: {urlToken: string}): string {
  return authorBindingHash(input.urlToken);
}

export function invitedAuthorCapabilities(entry: Pick<InvitedAuthor, 'urlToken'>) {
  return invitedAuthorCapabilitiesFor(entry.urlToken);
}

/** 本局使用的作者绑定：由服务端从注册表推导，客户端提交的同名字段一律忽略。 */
export function invitedAuthorProfileBinding(entry: InvitedAuthor) {
  return {
    authorRef: {provider: 'zhihu' as const, urlToken: entry.urlToken, profileUrl: entry.profileUrl},
    authorSnapshot: {...entry.authorSnapshot},
    domains: [...entry.domains] as string[],
    capabilities: invitedAuthorCapabilitiesFor(entry.urlToken),
  };
}

function entryFile(root: string, castId: string): string {
  if (!AUTHOR_CAST_ID_PATTERN.test(castId)) throw new Error('答主角色 ID 不合法。');
  return path.join(root, `${castId}.json`);
}

export async function readInvitedAuthor(root: string, castId: string): Promise<InvitedAuthor | null> {
  try {
    const parsed = invitedAuthorSchema.safeParse(JSON.parse(await readFile(entryFile(root, castId), 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function listInvitedAuthors(root: string): Promise<InvitedAuthor[]> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }
  const entries: InvitedAuthor[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith('.json')) continue;
    const entry = await readInvitedAuthor(root, name.slice(0, -'.json'.length));
    if (entry) entries.push(entry);
  }
  return entries;
}

export async function findInvitedAuthorByToken(root: string, urlToken: string): Promise<InvitedAuthor | null> {
  if (!AUTHOR_URL_TOKEN_PATTERN.test(urlToken)) return null;
  const entries = await listInvitedAuthors(root);
  return entries.find((entry) => entry.urlToken === urlToken) ?? null;
}

export async function writeInvitedAuthor(root: string, entry: InvitedAuthor): Promise<InvitedAuthor> {
  const parsed = invitedAuthorSchema.parse(entry);
  const existing = await readInvitedAuthor(root, parsed.castId);
  if (existing && existing.urlToken !== parsed.urlToken) throw new Error('答主角色 ID 冲突，请更换主页标识。');
  await mkdir(root, {recursive: true});
  const file = entryFile(root, parsed.castId);
  await writeFile(`${file}.tmp`, `${JSON.stringify(parsed, null, 2)}\n`);
  await rename(`${file}.tmp`, file);
  return parsed;
}

export function invitedAuthorGender(entry: Pick<InvitedAuthor, 'gender'>): Gender | 'unknown' {
  return entry.gender;
}

export type InvitedAuthorCard = {
  id: string;
  name: string;
  kind: 'zhihu-author';
  gender: Gender;
  age: number;
  identity: string;
  domains: AuthorDomain[];
  personaStatus: 'fictional';
  disclosure: string;
  selectable: boolean;
  capabilities: {canChat: true; canEnterStory: true; canEnterRomance: boolean};
  profileUrl: string;
  sourceDisplayName: string;
  sourceHeadline?: string;
  avatarUrl?: string;
  invitedAt: string;
  capturedAt: string;
  corpusVersion?: string;
};
