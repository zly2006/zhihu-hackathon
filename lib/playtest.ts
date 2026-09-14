export type DevelopmentProfile = {id: string; name: string; avatarUrl: string | null; headline: string | null; url: string | null};

export const DEVELOPMENT_PROFILE: DevelopmentProfile = {
  id: 'playtest-local',
  name: '本地开发',
  avatarUrl: null,
  headline: '开发模式 · 免登录',
  url: null,
};
