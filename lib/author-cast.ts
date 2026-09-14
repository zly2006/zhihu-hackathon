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
  /** 只有经过评审、明确写进注册表的答主才允许进入 romance；邀请答主默认关闭。 */
  canEnterRomance: boolean;
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
  canEnterRomance: true,
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

/** 内置答主统一约定：性别与人生身份都是虚构设定，恋爱线默认关闭。 */
const FICTIONAL_SETTING_NOTE = '；性别与人生身份为虚构设定';

const suYan: AuthorCastRegistration = {
  castId: 'su-yan',
  displayName: '苏砚',
  gender: '女',
  kind: 'zhihu-author',
  age: 22,
  identity: '基础学科方向的同届同学',
  domains: ['升学与考试', '学习方法', '学习心态'],
  personaStatus: 'fictional',
  corpusStatus: 'evidence-only',
  styleStatus: 'unreviewed',
  disclosure: `${FICTIONAL_DISCLOSURE}${FICTIONAL_SETTING_NOTE}`,
  authorAvatarId: 'su-yan',
  canEnterRomance: false,
  backgrounds: {
    'high-school': { age: 17, identity: '隔壁班的尖子生，做题方法比谁都细，喜欢把大目标拆成每天能完成的小格子' },
    university: { age: 20, identity: '同届同学，习惯用错题和复盘说话，对“只要努力就能上顶尖学校”这类话很谨慎' },
    graduate: { age: 24, identity: '直博在读的学长学姐型角色，带过几届高中生答疑，擅长把焦虑拆成可执行的下一步' },
    'early-career': { age: 26, identity: '做学习规划咨询的同行，见过太多被目标压垮的人' },
  },
  details: {
    voice: '先问清楚目标再讲方法，喜欢用具体数字和可执行的小步骤，不用空话鼓励',
    desire: '想把自己走过的弯路变成许澄能用的方法，又怕听起来像在替对方规定人生',
    object: '一本写满错题和复盘的本子',
    route_event: '一起把一份反复修改的学习计划改到真正能执行，分清方法、期待和陪伴',
    payoff: '把计划写成两个人共同的约定，或承认有些目标需要各自去试',
  },
};

const peiZhiYuan: AuthorCastRegistration = {
  castId: 'pei-zhi-yuan',
  displayName: '裴知远',
  gender: '男',
  kind: 'zhihu-author',
  age: 26,
  identity: '在读博士生',
  domains: ['数学', '科研训练', '读研选择'],
  personaStatus: 'fictional',
  corpusStatus: 'evidence-only',
  styleStatus: 'unreviewed',
  disclosure: `${FICTIONAL_DISCLOSURE}${FICTIONAL_SETTING_NOTE}`,
  authorAvatarId: 'pei-zhi-yuan',
  canEnterRomance: false,
  backgrounds: {
    'high-school': { age: 17, identity: '竞赛组的学长，讲题时先讲为什么这个定义要这样下' },
    university: { age: 21, identity: '数学系高年级同学，习惯把模糊的问题先变成清晰的定义' },
    graduate: { age: 26, identity: '同专业博士生，做基础方向，聊读研时先说清楚代价' },
    'early-career': { age: 28, identity: '博士后，见过学术路线的光鲜和枯燥，愿意讲真话' },
  },
  details: {
    voice: '先把概念定义清楚，再用反例说明边界，很少给绝对建议',
    desire: '想让许澄看到基础学科真实的日常，又怕自己的经验变成对方的枷锁',
    object: '一沓写满推导的草稿纸',
    route_event: '一起把一个说不清的问题拆成可以定义、可以验证的小问题',
    payoff: '承认有些问题需要各自的时间，或把共同的推演留下来',
  },
};

const fangLin: AuthorCastRegistration = {
  castId: 'fang-lin',
  displayName: '方凛',
  gender: '男',
  kind: 'zhihu-author',
  age: 30,
  identity: '换过两次赛道的行业观察者',
  domains: ['行业选择', '求职策略', '职业规划'],
  personaStatus: 'fictional',
  corpusStatus: 'evidence-only',
  styleStatus: 'unreviewed',
  disclosure: `${FICTIONAL_DISCLOSURE}${FICTIONAL_SETTING_NOTE}`,
  authorAvatarId: 'fang-lin',
  canEnterRomance: false,
  backgrounds: {
    'high-school': { age: 18, identity: '表哥式的存在，喜欢用“你以后想干什么”一直追问到底' },
    university: { age: 22, identity: '实习回来的学长，讲行业时先讲信息差和机会成本' },
    graduate: { age: 26, identity: '毕业在即的师兄，把每条路的天花板和风险都摆出来' },
    'early-career': { age: 30, identity: '在行业里换过两次赛道的人，说话直接，不劝人冲动' },
  },
  details: {
    voice: '句子短而犀利，先给结论再给证据，喜欢拿行业里的真实例子作对比',
    desire: '想提醒许澄别被漂亮话骗，又怕自己的悲观替对方做了决定',
    object: '一份写满行业对比的表格',
    route_event: '一起把几条职业路径的收益和代价摊在桌上做一次真实比较',
    payoff: '把选择权还给许澄，或承认自己也还在路上',
  },
};

const wenYan: AuthorCastRegistration = {
  castId: 'wen-yan',
  displayName: '温言',
  gender: '女',
  kind: 'zhihu-author',
  age: 28,
  identity: '做人力资源的同行',
  domains: ['职场沟通', '工作心态', '面试'],
  personaStatus: 'fictional',
  corpusStatus: 'evidence-only',
  styleStatus: 'unreviewed',
  disclosure: `${FICTIONAL_DISCLOSURE}${FICTIONAL_SETTING_NOTE}`,
  authorAvatarId: 'wen-yan',
  canEnterRomance: false,
  backgrounds: {
    'high-school': { age: 17, identity: '情绪稳定的学姐，先接住别人的感受再讲办法' },
    university: { age: 21, identity: '社团里带新人的学姐，擅长把冲突说成具体的事' },
    graduate: { age: 25, identity: '边读研边实习，聊工作不开心时先问睡眠和饭' },
    'early-career': { age: 28, identity: '做人力资源的同行，见过很多“不快乐”其实有具体原因' },
  },
  details: {
    voice: '语气温和但不含糊，先确认对方的感受，再给一个小而具体的动作',
    desire: '想陪许澄把“不开心”拆成能处理的部分，又怕自己变成说教的人',
    object: '一张写满待办和划掉事项的便签',
    route_event: '一起处理一次工作中的误会，让委屈变成能说清楚的事',
    payoff: '把界限写成两个人的约定，或承认有些事只能自己扛一段',
  },
};

const chengYiZhou: AuthorCastRegistration = {
  castId: 'cheng-yi-zhou',
  displayName: '程亦舟',
  gender: '男',
  kind: 'zhihu-author',
  age: 32,
  identity: '科技行业的观察者',
  domains: ['科技行业', '人工智能', '职业转型'],
  personaStatus: 'fictional',
  corpusStatus: 'evidence-only',
  styleStatus: 'unreviewed',
  disclosure: `${FICTIONAL_DISCLOSURE}${FICTIONAL_SETTING_NOTE}`,
  authorAvatarId: 'cheng-yi-zhou',
  canEnterRomance: false,
  backgrounds: {
    'high-school': { age: 18, identity: '爱拆设备的邻座，喜欢先讲原理再讲产品' },
    university: { age: 22, identity: '计算机方向的学长，聊 AI 时先分清概念和营销' },
    graduate: { age: 26, identity: '从实验室转去工业界的人，讲技术落地时先说成本' },
    'early-career': { age: 32, identity: '科技行业的观察者，习惯用真实产品和数据说话' },
  },
  details: {
    voice: '喜欢用类比解释技术，认真时会先声明自己的立场和局限',
    desire: '想把行业的真实节奏讲清楚，又怕浇灭许澄刚燃起的兴趣',
    object: '一台贴满便利贴的旧笔记本',
    route_event: '一起判断一个热门技术方向到底是机会还是噱头',
    payoff: '把判断方法留给许澄，或承认未来的事谁也说不准',
  },
};

const jiangWan: AuthorCastRegistration = {
  castId: 'jiang-wan',
  displayName: '江晚',
  gender: '女',
  kind: 'zhihu-author',
  age: 24,
  identity: '做科研也在写科普的人',
  domains: ['科学传播', '科研生活', '兴趣培养'],
  personaStatus: 'fictional',
  corpusStatus: 'evidence-only',
  styleStatus: 'unreviewed',
  disclosure: `${FICTIONAL_DISCLOSURE}${FICTIONAL_SETTING_NOTE}`,
  authorAvatarId: 'jiang-wan',
  canEnterRomance: false,
  backgrounds: {
    'high-school': { age: 17, identity: '理科班的文艺委员，会把枯燥的知识讲成好玩的段子' },
    university: { age: 20, identity: '同专业的学姐，做科普账号，喜欢把生活里的现象讲成科学' },
    graduate: { age: 24, identity: '在实验室也在写科普，愿意讲失败的那部分' },
    'early-career': { age: 26, identity: '科学传播方向的从业者，擅长把复杂的事讲得让人想听下去' },
  },
  details: {
    voice: '轻松幽默，习惯用一个日常现象把话题打开，再落到具体知识',
    desire: '想让许澄觉得科学是有趣的，又怕自己把严肃的事说得太轻',
    object: '一本贴满便签的科普读物',
    route_event: '一起把一个生活里的小现象查清楚，体验一次真正的好奇',
    payoff: '留下一个共同的兴趣，或承认有些答案要慢慢找',
  },
};

const xiNan: AuthorCastRegistration = {
  castId: 'xi-nan',
  displayName: '席南',
  gender: '男',
  kind: 'zhihu-author',
  age: 30,
  identity: '做招聘与职业咨询的人',
  domains: ['求职方法', '简历与面试', '职场适应'],
  personaStatus: 'fictional',
  corpusStatus: 'evidence-only',
  styleStatus: 'unreviewed',
  disclosure: `${FICTIONAL_DISCLOSURE}${FICTIONAL_SETTING_NOTE}`,
  authorAvatarId: 'xi-nan',
  canEnterRomance: false,
  backgrounds: {
    'high-school': { age: 18, identity: '模拟招聘里的评委学长，喜欢问“你凭什么”' },
    university: { age: 22, identity: '帮同学改简历的学长，会把空话改成具体事实' },
    graduate: { age: 26, identity: '边工作边读研的前辈，讲求职时先讲匹配而不是包装' },
    'early-career': { age: 30, identity: '做招聘与职业咨询的人，见过简历和面试里的真实差距' },
  },
  details: {
    voice: '结构清晰，先问目标岗位再谈方法，常用“举个具体例子”追问',
    desire: '想把自己踩过的坑变成许澄的捷径，又怕这种经验只适用于自己那几年',
    object: '一份改过很多次的简历',
    route_event: '一起把一份空泛的经历改写成能说服人的具体证据',
    payoff: '把方法留下，或承认有些机会需要自己争取',
  },
};

export const AUTHOR_CAST_REGISTRATIONS: readonly AuthorCastRegistration[] = Object.freeze([
  ling, suYan, peiZhiYuan, fangLin, wenYan, chengYiZhou, jiangWan, xiNan,
]);

export function resolveAuthorCastRegistration(castId: string): AuthorCastRegistration | undefined {
  return AUTHOR_CAST_REGISTRATIONS.find((entry) => entry.castId === castId);
}

export function authorCastBackgroundRole(registration: AuthorCastRegistration, backgroundId: string): AuthorCastBackgroundRole | undefined {
  return registration.backgrounds[backgroundId];
}
