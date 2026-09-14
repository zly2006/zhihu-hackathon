export const DEVELOPMENT_SESSION_ID = 'playtest-local';
export const PLAYTEST_SESSION_ID = DEVELOPMENT_SESSION_ID;

export type DevelopmentProfile = {id: string; name: string; avatarUrl: string | null; headline: string | null; url: string | null};

export const DEVELOPMENT_PROFILE: DevelopmentProfile = {
  id: DEVELOPMENT_SESSION_ID,
  name: '本地开发',
  avatarUrl: null,
  headline: '开发模式 · 免登录',
  url: null,
};

export const PLAYTEST_PROFILE = DEVELOPMENT_PROFILE;

export type DevelopmentEnv = {NODE_ENV?: string; LAMPLIGHT_DEV_MODE?: string; LAMPLIGHT_PLAYTEST?: string};

export function developmentModeEnabled(env: DevelopmentEnv = process.env): boolean {
  if (env.NODE_ENV === 'production') return false;
  const flag = (env.LAMPLIGHT_DEV_MODE || env.LAMPLIGHT_PLAYTEST || '').trim().toLowerCase();
  return flag === '1' || flag === 'true';
}

export const playtestEnabled = developmentModeEnabled;

export const DEVELOPMENT_MODE_MESSAGE = '开发模式已启用：跳过知乎 OAuth，仅用于本地开发与验收，生产构建自动失效。';
