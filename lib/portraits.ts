import {AUTHOR_CAST_REGISTRATIONS} from './author-cast';

export const PORTRAIT_POSES = ['normal', 'happy', 'playful', 'surprised', 'thinking'] as const;
export type CharacterPose = typeof PORTRAIT_POSES[number];

export const PRESET_PORTRAIT_IDS = ['m1', 'm2', 'm3', 'm4', 'f1', 'f2', 'f3', 'f4', 'player'] as const;
export const FEMALE_PORTRAIT_IDS = ['f1', 'f2', 'f3', 'f4'] as const;
export const MALE_PORTRAIT_IDS = ['m1', 'm2', 'm3', 'm4'] as const;

export const DEMO_PORTRAIT_SOURCES: Record<string, string> = {lin: 'f1', tao: 'f2', shen: 'f3'};

/**
 * 知乎答主立绘复用配置。当前为临时产品策略：只复用性别一致的女性和预设立绘，
 * 未来林泠正式立绘就位后，只替换这里的 sourceId 或移除映射，不改动任何调用点。
 */
export const AUTHOR_PORTRAIT_SOURCES: Record<string, {sourceId: string; note: string}> = {
  ling: {sourceId: 'f2', note: '临时复用女性预设立绘 f2，待正式立绘替换。'},
};

export type PortraitPlan =
  | {kind: 'image'; src: string; sourceId: string}
  | {kind: 'placeholder'; reason: 'unknown-character'};

export function isPresetPortraitId(id: string): boolean {
  return (PRESET_PORTRAIT_IDS as readonly string[]).includes(id);
}

export function portraitSourceId(id: string): string | undefined {
  const author = AUTHOR_PORTRAIT_SOURCES[id];
  if (author) return author.sourceId;
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
}

assertPortraitSources(AUTHOR_CAST_REGISTRATIONS.map((registration) => ({castId: registration.castId, gender: registration.gender})));
