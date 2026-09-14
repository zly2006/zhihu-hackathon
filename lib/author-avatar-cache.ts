import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';

/**
 * 答主主页头像的本地缓存：服务端取一次公开头像存到作者目录，之后由路由直接回，
 * 既避免浏览器热链被拦，也让离线时仍能显示头像。来源 URL 只由服务端决定，不接受客户端输入。
 */

export const AVATAR_FETCH_TIMEOUT_MS = 15_000;
export const MAX_AVATAR_BYTES = 512 * 1024;
export const AVATAR_CACHE_DIR = 'avatar';

const EXTENSIONS = ['jpg', 'png', 'webp', 'gif'] as const;
export type AvatarExtension = typeof EXTENSIONS[number];

export type CachedAvatar = {bytes: Buffer; contentType: string};

const CONTENT_TYPES: Record<string, string> = {jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif'};

function extensionFor(contentType: string): AvatarExtension | null {
  const normalized = contentType.split(';')[0].trim().toLowerCase();
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg';
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/gif') return 'gif';
  return null;
}

export function avatarDirectory(root: string, urlToken: string): string {
  return path.join(root, urlToken, AVATAR_CACHE_DIR);
}

export async function readCachedAvatar(root: string, urlToken: string): Promise<CachedAvatar | null> {
  for (const extension of EXTENSIONS) {
    try {
      const bytes = await readFile(path.join(avatarDirectory(root, urlToken), `avatar.${extension}`));
      if (bytes.byteLength > 0 && bytes.byteLength <= MAX_AVATAR_BYTES) return {bytes, contentType: CONTENT_TYPES[extension]};
    } catch {
      continue;
    }
  }
  return null;
}

async function writeCachedAvatar(root: string, urlToken: string, extension: AvatarExtension, bytes: Buffer): Promise<void> {
  const directory = avatarDirectory(root, urlToken);
  await mkdir(directory, {recursive: true});
  const file = path.join(directory, `avatar.${extension}`);
  for (const other of EXTENSIONS) {
    if (other !== extension) await rm(path.join(directory, `avatar.${other}`), {force: true});
  }
  await writeFile(`${file}.tmp`, bytes);
  await rename(`${file}.tmp`, file);
}

export async function fetchAndCacheAvatar(options: {
  root: string;
  urlToken: string;
  sourceUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<CachedAvatar | null> {
  if (!/^https:\/\//.test(options.sourceUrl)) return null;
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(options.sourceUrl, {
      headers: {
        Referer: 'https://www.zhihu.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
        Accept: 'image/*',
      },
      signal: AbortSignal.timeout(AVATAR_FETCH_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const extension = extensionFor(response.headers.get('content-type') ?? '');
  if (!extension) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > MAX_AVATAR_BYTES) return null;
  await writeCachedAvatar(options.root, options.urlToken, extension, bytes);
  return {bytes, contentType: CONTENT_TYPES[extension]};
}

export async function cachedOrFetchAvatar(options: {
  root: string;
  urlToken: string;
  sourceUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<CachedAvatar | null> {
  const cached = await readCachedAvatar(options.root, options.urlToken);
  if (cached) return cached;
  if (!options.sourceUrl) return null;
  return fetchAndCacheAvatar({root: options.root, urlToken: options.urlToken, sourceUrl: options.sourceUrl, fetchImpl: options.fetchImpl});
}

/** 目录内只接受规定的头像文件名，防止任何越界读取。 */
export function isAvatarCacheFile(file: string): boolean {
  return /^(?:avatar\.(?:jpg|png|webp|gif))$/.test(file);
}
