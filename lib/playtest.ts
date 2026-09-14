export const PLAYTEST_SESSION_ID = 'playtest-local';

export type PlaytestProfile = {id: string; name: string; avatarUrl: string | null; headline: string | null; url: string | null};

export const PLAYTEST_PROFILE: PlaytestProfile = {
  id: PLAYTEST_SESSION_ID,
  name: '本地试玩',
  avatarUrl: null,
  headline: '本地开发免登录模式',
  url: null,
};

export function playtestEnabled(env: {NODE_ENV?: string; LAMPLIGHT_PLAYTEST?: string} = process.env): boolean {
  if (env.NODE_ENV === 'production') return false;
  return (env.LAMPLIGHT_PLAYTEST || '').trim() === '1';
}
