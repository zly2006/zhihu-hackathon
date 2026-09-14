import {AUTHOR_CAST_ID_PATTERN} from './author-identity';
import {AUTHOR_CAST_REGISTRATIONS} from './author-cast';
import {authorStableIndex} from './author-identity';

export const PORTRAIT_POSES = ['normal', 'happy', 'playful', 'surprised', 'thinking'] as const;
export type CharacterPose = typeof PORTRAIT_POSES[number];

export const PRESET_PORTRAIT_IDS = ['m1', 'm2', 'm3', 'm4', 'f1', 'f2', 'f3', 'f4', 'player'] as const;
export const FEMALE_PORTRAIT_IDS = ['f1', 'f2', 'f3', 'f4'] as const;
export const MALE_PORTRAIT_IDS = ['m1', 'm2', 'm3', 'm4'] as const;

export const DEMO_PORTRAIT_SOURCES: Record<string, string> = {lin: 'f1', tao: 'f2', shen: 'f3'};

/**
 * 知乎答主立绘复用配置。当前为临时产品策略：只复用性别一致的女性和预设立绘，
 * 未来正式立绘就位后，只替换这里的 sourceId 或移除映射，不改动任何调用点。
 */
export const AUTHOR_PORTRAIT_SOURCES: Record<string, {sourceId: string; note: string}> = {
  ling: {sourceId: 'f2', note: '临时复用女性预设立绘 f2，待正式立绘替换。'},
  'su-yan': {sourceId: 'f1', note: '临时复用女性预设立绘 f1，待正式立绘替换。'},
  'jiang-wan': {sourceId: 'f3', note: '临时复用女性预设立绘 f3，待正式立绘替换。'},
  'wen-yan': {sourceId: 'f4', note: '临时复用女性预设立绘 f4，待正式立绘替换。'},
  'pei-zhi-yuan': {sourceId: 'm1', note: '临时复用男性预设立绘 m1，待正式立绘替换。'},
  'fang-lin': {sourceId: 'm2', note: '临时复用男性预设立绘 m2，待正式立绘替换。'},
  'cheng-yi-zhou': {sourceId: 'm3', note: '临时复用男性预设立绘 m3，待正式立绘替换。'},
  'xi-nan': {sourceId: 'm4', note: '临时复用男性预设立绘 m4，待正式立绘替换。'},
};

/**
 * 任意邀请答主直接复用现有 8 个预设立绘，按性别取一套，并用角色 ID 稳定散列到
 * 同一性别的四套之一，避免只请求不存在的 `ling_*.webp`。
 * 性别未公开（zhihu-u-）时按剧情角色的默认性别复用女性立绘，并在卡片上标注性别未公开。
 */
export const AUTHOR_PORTRAIT_POOLS = {
  f: FEMALE_PORTRAIT_IDS,
  m: MALE_PORTRAIT_IDS,
} as const;

export const AUTHOR_PORTRAIT_NOTES = {
  f: '女性答主复用现有女性立绘（f1–f4），待正式立绘替换。',
  m: '男性答主复用现有男性立绘（m1–m4），待正式立绘替换。',
  u: '性别未公开，按虚构角色的默认性别复用女性立绘（f1–f4），待正式立绘替换。',
} as const;

export function invitedPortraitSourceId(castId: string): string | undefined {
  const match = AUTHOR_CAST_ID_PATTERN.exec(castId);
  if (!match) return undefined;
  const genderCode = castId.charAt('zhihu-'.length);
  const pool = genderCode === 'm' ? AUTHOR_PORTRAIT_POOLS.m : AUTHOR_PORTRAIT_POOLS.f;
  return pool[authorStableIndex(castId, pool.length)];
}

export type PortraitPlan =
  | {kind: 'image'; src: string; sourceId: string}
  | {kind: 'placeholder'; reason: 'unknown-character'};

export function isPresetPortraitId(id: string): boolean {
  return (PRESET_PORTRAIT_IDS as readonly string[]).includes(id);
}

export function portraitSourceId(id: string): string | undefined {
  const author = AUTHOR_PORTRAIT_SOURCES[id];
  if (author) return author.sourceId;
  const invited = invitedPortraitSourceId(id);
  if (invited) return invited;
  const demo = DEMO_PORTRAIT_SOURCES[id];
  if (demo) return demo;
  if (isPresetPortraitId(id)) return id;
  return undefined;
}

export function portraitAssetPath(sourceId: string, pose: CharacterPose): string {
  return `/art/${sourceId}_${pose}.webp`;
}

export function resolvePortrait(id: string, pose: CharacterPose = 'happy'): PortraitPlan {
  const sourceId = portraitSourceId(id);
  if (!sourceId) return {kind: 'placeholder', reason: 'unknown-character'};
  return {kind: 'image', src: portraitAssetPath(sourceId, pose), sourceId};
}

export function assertPortraitSources(authors: readonly {castId: string; gender: string}[]): void {
  for (const author of authors) {
    const mapped = AUTHOR_PORTRAIT_SOURCES[author.castId];
    if (!mapped) continue;
    const allowed: readonly string[] = author.gender === '女' ? FEMALE_PORTRAIT_IDS : MALE_PORTRAIT_IDS;
    if (!allowed.includes(mapped.sourceId)) throw new Error(`答主${author.castId}的立绘来源与性别不匹配。`);
  }
  for (const [code, pool] of Object.entries(AUTHOR_PORTRAIT_POOLS)) {
    const expected: readonly string[] = code === 'm' ? MALE_PORTRAIT_IDS : FEMALE_PORTRAIT_IDS;
    if (pool.length !== expected.length || pool.some((sourceId) => !expected.includes(sourceId))) {
      throw new Error(`答主立绘池${code}与性别不匹配。`);
    }
  }
}

assertPortraitSources(AUTHOR_CAST_REGISTRATIONS.map((registration) => ({castId: registration.castId, gender: registration.gender})));
