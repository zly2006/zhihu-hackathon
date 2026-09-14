export type AuthorAvatar = {
  id: string;
  displayName: string;
  sourceAuthorName: string;
  sourceAuthorUrlToken: string;
  sourceAuthorProfileUrl: string;
  /** 公开主页头像：选人卡与聊天头像直接使用，加载失败回退预设立绘或首字母。 */
  sourceAuthorAvatarUrl: string;
  status: 'evidence-only';
  styleStatus: 'unreviewed';
};

/**
 * 内置答主化身登记表：化名是虚构角色名，sourceAuthor* 记录公开来源用于署名与核对。
 * 新增答主时先在这里登记，再在 lib/author-cast.ts 补齐角色契约与四套人生背景。
 */
const AVATARS: readonly AuthorAvatar[] = Object.freeze([
  Object.freeze({
    id: 'zhao-ling', sourceAuthorAvatarUrl: 'https://pica.zhimg.com/v2-de30ce08350fcbe111a297af5c00a26c_xl.jpg?source=32738c0c&needBackground=1', displayName: '林泠', sourceAuthorName: '赵泠', sourceAuthorUrlToken: 'MarryMea',
    sourceAuthorProfileUrl: 'https://www.zhihu.com/people/MarryMea', status: 'evidence-only', styleStatus: 'unreviewed',
  }),
  Object.freeze({
    id: 'su-yan', sourceAuthorAvatarUrl: 'https://picx.zhimg.com/v2-91f247a720149571f939d997e5404dd1_xl.jpg?source=32738c0c&needBackground=1', displayName: '苏砚', sourceAuthorName: 'rq cen', sourceAuthorUrlToken: 'rq-cen',
    sourceAuthorProfileUrl: 'https://www.zhihu.com/people/rq-cen', status: 'evidence-only', styleStatus: 'unreviewed',
  }),
  Object.freeze({
    id: 'pei-zhi-yuan', sourceAuthorAvatarUrl: 'https://picx.zhimg.com/v2-31a4ef9e4771a39c65ef34b45ae94038_xl.jpg?source=32738c0c&needBackground=1', displayName: '裴知远', sourceAuthorName: 'Yuhang Liu', sourceAuthorUrlToken: 'yuhang-liu-34',
    sourceAuthorProfileUrl: 'https://www.zhihu.com/people/yuhang-liu-34', status: 'evidence-only', styleStatus: 'unreviewed',
  }),
  Object.freeze({
    id: 'fang-lin', sourceAuthorAvatarUrl: 'https://picx.zhimg.com/v2-3647c81a5a6f8c02183e7f433903440b_xl.jpg?source=32738c0c&needBackground=1', displayName: '方凛', sourceAuthorName: '弗兰克扬', sourceAuthorUrlToken: 'fu-lan-ke-yang',
    sourceAuthorProfileUrl: 'https://www.zhihu.com/people/fu-lan-ke-yang', status: 'evidence-only', styleStatus: 'unreviewed',
  }),
  Object.freeze({
    id: 'wen-yan', sourceAuthorAvatarUrl: 'https://pic1.zhimg.com/df4318a7d28d27d3b27c0ab320fa203a_xl.jpg?source=32738c0c&needBackground=1', displayName: '温言', sourceAuthorName: '小红拖拉机', sourceAuthorUrlToken: 'xhtlj',
    sourceAuthorProfileUrl: 'https://www.zhihu.com/people/xhtlj', status: 'evidence-only', styleStatus: 'unreviewed',
  }),
  Object.freeze({
    id: 'cheng-yi-zhou', sourceAuthorAvatarUrl: 'https://pic1.zhimg.com/v2-50aea4b87aeed8dd361b39ec3e3a2c33_xl.jpg?source=32738c0c&needBackground=1', displayName: '程亦舟', sourceAuthorName: '程墨Morgan', sourceAuthorUrlToken: 'morgancheng',
    sourceAuthorProfileUrl: 'https://www.zhihu.com/people/morgancheng', status: 'evidence-only', styleStatus: 'unreviewed',
  }),
  Object.freeze({
    id: 'jiang-wan', sourceAuthorAvatarUrl: 'https://picx.zhimg.com/v2-7af3fdbdf67525f431e69689917b9f61_xl.jpg?source=32738c0c&needBackground=1', displayName: '江晚', sourceAuthorName: '甜草莓', sourceAuthorUrlToken: 'tiancaomei',
    sourceAuthorProfileUrl: 'https://www.zhihu.com/people/tiancaomei', status: 'evidence-only', styleStatus: 'unreviewed',
  }),
  Object.freeze({
    id: 'xi-nan', sourceAuthorAvatarUrl: 'https://picx.zhimg.com/v2-0d8fae9c0958d4b83478dfc7f9fc383f_xl.jpg?source=32738c0c&needBackground=1', displayName: '席南', sourceAuthorName: 'Sean Ye', sourceAuthorUrlToken: 'sean-yenan',
    sourceAuthorProfileUrl: 'https://www.zhihu.com/people/sean-yenan', status: 'evidence-only', styleStatus: 'unreviewed',
  }),
]);

/** 化名、来源昵称与 token 都可作为查询别名；其余输入一律不认。 */
const ALIASES: Record<string, string> = Object.freeze(
  AVATARS.reduce<Record<string, string>>((map, avatar) => {
    map[avatar.id] = avatar.id;
    map[avatar.displayName] = avatar.id;
    map[avatar.sourceAuthorName] = avatar.id;
    map[avatar.sourceAuthorUrlToken] = avatar.id;
    return map;
  }, { '泠泠': 'zhao-ling' }),
);

const BY_ID = new Map(AVATARS.map((avatar) => [avatar.id, avatar]));

export function authorAvatars(): readonly AuthorAvatar[] {
  return AVATARS;
}

export function resolveAuthorAvatar(value: unknown): Readonly<AuthorAvatar> | undefined {
  if (typeof value !== 'string') return undefined;
  const id = ALIASES[value.trim()];
  return id ? BY_ID.get(id) : undefined;
}

/** 林泠的 Provider 绑定：与邀请答主共用同一套 AuthorRef 结构。 */
export function authorRefForAvatar(avatar: Readonly<AuthorAvatar>): {provider: 'zhihu'; urlToken: string; profileUrl: string} {
  return {provider: 'zhihu', urlToken: avatar.sourceAuthorUrlToken, profileUrl: avatar.sourceAuthorProfileUrl};
}
