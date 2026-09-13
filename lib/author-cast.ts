import type { CastDetails, Gender } from './story';

export type AuthorCastKind = 'zhihu-author';
export type PersonaStatus = 'fictional';
export type CorpusStatus = 'evidence-only' | 'unavailable';
export type StyleStatus = 'unreviewed' | 'reviewed';

export type AuthorCastBackgroundRole = { age: number; identity: string };

/**
 * 作者角色的唯一注册处。预设 NPC 仍由 story-public.json / story-config.json /
 * story-backgrounds.json 提供；知乎答主只在这里注册，再统一转换成 CastMember。
 */
export type AuthorCastRegistration = {
  castId: string;
  displayName: string;
  gender: Gender;
  kind: AuthorCastKind;
  age: number;
  identity: string;
  domains: string[];
  personaStatus: PersonaStatus;
  corpusStatus: CorpusStatus;
  styleStatus: StyleStatus;
  disclosure: string;
  authorAvatarId: string;
  backgrounds: Record<string, AuthorCastBackgroundRole>;
  details: CastDetails;
};

export const FICTIONAL_DISCLOSURE = '基于知乎公开内容改编的虚构 AI 角色';

const ling: AuthorCastRegistration = {
  castId: 'ling',
  displayName: '林泠',
  gender: '女',
  kind: 'zhihu-author',
  age: 20,
  identity: '同专业的普通学生',
  domains: ['生物', '科研方法论', '职业规划'],
  personaStatus: 'fictional',
  corpusStatus: 'evidence-only',
  styleStatus: 'unreviewed',
  disclosure: FICTIONAL_DISCLOSURE,
  authorAvatarId: 'zhao-ling',
  backgrounds: {
    'high-school': { age: 17, identity: '转学来的同桌，理科和校刊都插得上话，习惯先问清楚再给建议' },
    university: { age: 20, identity: '同专业同学，正在认真考虑转专业，对课程和科研方向都有自己的犹豫' },
    graduate: { age: 24, identity: '同门研究生，做数据与实验方法方向，愿意把失败和不确定也摊开讲' },
    'early-career': { age: 25, identity: '同部门同事，从实验室转进行业，擅长把复杂问题拆成能执行的小步' },
  },
  details: {
    voice: '先确认问题边界再回答，习惯把感受拆成具体事实；不确定时会直接说不确定',
    desire: '想把自己绕过的弯路讲给许澄听，又怕这听起来像在替对方做决定',
    object: '一本写满批注的旧笔记',
    route_event: '一起补完笔记里最后一页没有答案的推演，分清建议、陪伴和想靠近的人',
    payoff: '把只属于两人的结论写进新一页，或坦诚承认有些问题需要各自回答',
  },
};

export const AUTHOR_CAST_REGISTRATIONS: readonly AuthorCastRegistration[] = Object.freeze([ling]);

export function resolveAuthorCastRegistration(castId: string): AuthorCastRegistration | undefined {
  return AUTHOR_CAST_REGISTRATIONS.find((entry) => entry.castId === castId);
}

export function authorCastBackgroundRole(registration: AuthorCastRegistration, backgroundId: string): AuthorCastBackgroundRole | undefined {
  return registration.backgrounds[backgroundId];
}
