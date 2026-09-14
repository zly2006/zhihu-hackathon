import type {CastDetails, Gender} from './story';

/**
 * 任意知乎答主的内部身份规则。
 *
 * 这里只做确定性派生：角色 ID、化名、可公开领域标签和虚构舞台身份都不依赖
 * 网络与文件系统，也不使用 Node 专有模块，因此服务端校验、运行时 Agent 和
 * 前端立绘映射可以共用同一份规则。
 * 真实作者资料只用于邀请确认卡，不进入剧情身份，也不进入模型提示词。
 */

export const AUTHOR_URL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
export const AUTHOR_CAST_ID_PATTERN = /^zhihu-[fmu]-[0-9a-f]{16}$/;
export const AUTHOR_PROFILE_HOSTS = ['www.zhihu.com', 'zhihu.com'] as const;
export const AUTHOR_PROFILE_PATH_PATTERN = /^\/people\/([A-Za-z0-9_-]{1,100})\/?$/;

export type DerivedAuthorGender = 'f' | 'm' | 'u';

export const AUTHOR_DOMAINS = [
  '生物与生命科学',
  '科研方法论',
  '职业规划',
  '升学与考试',
  '心理与关系',
  '编程与工程',
  '医学与健康',
  '教育与成长',
  '法律与规则',
  '金融与经济',
  '写作与阅读',
  '综合话题',
] as const;
export type AuthorDomain = typeof AUTHOR_DOMAINS[number];
export const AUTHOR_DOMAIN_FALLBACK: AuthorDomain = '综合话题';
export const MAX_AUTHOR_DOMAINS = 3;

const DOMAIN_KEYWORDS: readonly {id: AuthorDomain; keywords: readonly string[]}[] = [
  {id: '生物与生命科学', keywords: ['生物', '细胞', '基因', '生态', '生命科学', '合成生物']},
  {id: '科研方法论', keywords: ['科研', '论文', '实验', '学术', '读研', '导师', '文献', '方法论', '读博']},
  {id: '职业规划', keywords: ['职业', '转行', '求职', '面试', '职场', 'offer', '跳槽', '工作选择', '简历']},
  {id: '升学与考试', keywords: ['高考', '考研', '保研', '志愿', '专业选择', '转专业', '留学', '招生']},
  {id: '心理与关系', keywords: ['心理', '情绪', '焦虑', '亲密关系', '情感', '沟通', '家庭', '抑郁', '边界']},
  {id: '编程与工程', keywords: ['编程', '代码', '程序', '算法', '软件', '计算机', '前端', '后端', '工程师', '架构']},
  {id: '医学与健康', keywords: ['医学', '医生', '健康', '疾病', '营养', '睡眠', '临床', '药物', '康复']},
  {id: '教育与成长', keywords: ['教育', '教师', '课堂', '学校', '培训', '学习习惯', '班主任']},
  {id: '法律与规则', keywords: ['法律', '法规', '劳动法', '合同', '维权', '诉讼', '合规']},
  {id: '金融与经济', keywords: ['金融', '投资', '理财', '经济', '保险', '房产', '基金']},
  {id: '写作与阅读', keywords: ['写作', '小说', '文学', '阅读', '书评', '编辑', '翻译']},
];

const RESERVED_AUTHOR_NAMES = ['林泠', '许澄', '赵泠', '顾言川', '周砚', '沈屿', '陆沉', '林见夏', '陶晚晴', '沈知遥', '苏棠'];

const AUTHOR_SURNAMES = ['苏', '顾', '林', '沈', '周', '程', '陆', '叶', '江', '温', '谢', '许', '秦', '宋', '唐', '白', '夏', '闻', '乔', '简'];
const AUTHOR_GIVEN_NAMES = ['见微', '听澜', '予安', '知遥', '叙白', '朝雨', '亦宁', '清和', '行舟', '望舒', '小满', '微澜', '南枝', '照野', '明川', '星阑', '既白', '若谷', '临溪', '砚秋'];

const STAGE_ROLES: Record<string, {age: number; identity: (domains: string) => string}> = {
  'high-school': {age: 17, identity: (domains) => `同校不同班的同学，在${domains}上比同龄人想得多，习惯先问清楚再给建议`},
  university: {age: 21, identity: (domains) => `同一栋教学楼的同届同学，平时在${domains}上能给到具体经验，也正在为自己的选择犹豫`},
  graduate: {age: 25, identity: (domains) => `同门研究生，日常讨论集中在${domains}，愿意把失败和不确定也摊开讲`},
  'early-career': {age: 27, identity: (domains) => `工作后认识的同行，熟悉${domains}里的现实节奏，擅长把复杂问题拆成能执行的小步`},
};

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/** 64 位 FNV-1a：在浏览器和 Node 上结果一致，不依赖 Node 专有模块。 */
function stableHash64(value: string): string {
  let hash = FNV_OFFSET;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, '0');
}

function stableIndex(value: string, modulus: number): number {
  return Number(BigInt(`0x${stableHash64(value)}`) % BigInt(modulus));
}

/** 供前端立绘等场景使用的稳定散列下标（同一 key 永远落在同一档）。 */
export function authorStableIndex(key: string, modulus: number): number {
  if (!Number.isSafeInteger(modulus) || modulus < 1) throw new Error('散列范围不合法。');
  return stableIndex(key, modulus);
}

export function isAuthorUrlToken(value: unknown): value is string {
  return typeof value === 'string' && AUTHOR_URL_TOKEN_PATTERN.test(value);
}

export function isAuthorCastId(value: unknown): value is string {
  return typeof value === 'string' && AUTHOR_CAST_ID_PATTERN.test(value);
}

export function authorProfileUrl(urlToken: string): string {
  if (!isAuthorUrlToken(urlToken)) throw new Error('知乎主页标识不合法。');
  return `https://www.zhihu.com/people/${urlToken}`;
}

export function authorGenderCode(gender: Gender | 'unknown' | null | undefined): DerivedAuthorGender {
  if (gender === '女') return 'f';
  if (gender === '男') return 'm';
  return 'u';
}

export function genderForCastId(castId: string): Gender | 'unknown' | undefined {
  if (!isAuthorCastId(castId)) return undefined;
  const code = castId.charAt('zhihu-'.length);
  if (code === 'f') return '女';
  if (code === 'm') return '男';
  return 'unknown';
}

export function deriveAuthorCastId(urlToken: string, gender: Gender | 'unknown'): string {
  if (!isAuthorUrlToken(urlToken)) throw new Error('知乎主页标识不合法。');
  return `zhihu-${authorGenderCode(gender)}-${stableHash64(`cast:${urlToken}`)}`;
}

export function fictionalAuthorName(urlToken: string): string {
  if (!isAuthorUrlToken(urlToken)) throw new Error('知乎主页标识不合法。');
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const seed = attempt ? `${urlToken}:${attempt}` : urlToken;
    const surname = AUTHOR_SURNAMES[stableIndex(`surname:${seed}`, AUTHOR_SURNAMES.length)];
    const given = AUTHOR_GIVEN_NAMES[stableIndex(`given:${seed}`, AUTHOR_GIVEN_NAMES.length)];
    const candidate = `${surname}${given}`;
    if (!RESERVED_AUTHOR_NAMES.includes(candidate)) return candidate;
  }
  throw new Error('无法为该答主生成化名。');
}

export function fictionalAuthorAge(urlToken: string): number {
  if (!isAuthorUrlToken(urlToken)) throw new Error('知乎主页标识不合法。');
  return 20 + stableIndex(`age:${urlToken}`, 6);
}

/**
 * 冻结快照用的 64 位十六进制摘要。它只用来证明“同一局使用的是同一份身份绑定”，
 * 不承载真实作者资料，也不依赖 Node 专有模块。
 */
export function authorBindingHash(urlToken: string): string {
  if (!isAuthorUrlToken(urlToken)) throw new Error('知乎主页标识不合法。');
  return [0, 1, 2, 3].map((index) => stableHash64(`snapshot:${index}:${urlToken}`)).join('');
}

export function authorDomainTags(hints: readonly unknown[]): AuthorDomain[] {
  const text = hints
    .filter((hint): hint is string => typeof hint === 'string')
    .join('\n')
    .normalize('NFKC')
    .toLowerCase()
    .slice(0, 2000);
  const matched: AuthorDomain[] = [];
  for (const entry of DOMAIN_KEYWORDS) {
    if (entry.keywords.some((keyword) => text.includes(keyword.normalize('NFKC').toLowerCase()))) matched.push(entry.id);
    if (matched.length >= MAX_AUTHOR_DOMAINS) break;
  }
  return matched.length ? matched : [AUTHOR_DOMAIN_FALLBACK];
}

export function normalizeAuthorDomain(value: unknown): AuthorDomain | undefined {
  return (AUTHOR_DOMAINS as readonly string[]).includes(String(value)) ? (String(value) as AuthorDomain) : undefined;
}

export type InvitedAuthorCapabilities = {canChat: true; canEnterStory: true; canEnterRomance: boolean};

/**
 * 邀请进来的答主默认可聊天、可进入剧情，但不进入恋爱线。
 * 只有经过评审、把 urlToken 明确写进这份白名单，才允许开放 romance。
 */
export const INVITED_ROMANCE_ALLOWLIST: readonly string[] = [];

export function invitedAuthorCapabilitiesFor(urlToken: string): InvitedAuthorCapabilities {
  return {canChat: true, canEnterStory: true, canEnterRomance: INVITED_ROMANCE_ALLOWLIST.includes(urlToken)};
}

export function invitedAuthorCapabilities(): InvitedAuthorCapabilities {
  return invitedAuthorCapabilitiesFor('');
}

export function invitedAuthorStageRole(backgroundId: string, domains: readonly string[], urlToken: string): {age: number; identity: string} {
  if (!isAuthorUrlToken(urlToken)) throw new Error('知乎主页标识不合法。');
  const labels = domains.map((domain) => normalizeAuthorDomain(domain)).filter((domain): domain is AuthorDomain => Boolean(domain));
  const domainText = (labels.length ? labels : [AUTHOR_DOMAIN_FALLBACK]).join('、');
  const role = STAGE_ROLES[backgroundId];
  if (!role) return {age: fictionalAuthorAge(urlToken), identity: `同行者，熟悉${domainText}，回答具体，不替别人做决定`};
  return {age: role.age, identity: role.identity(domainText)};
}

export function invitedAuthorDetails(domains: readonly string[]): CastDetails {
  const labels = domains.map((domain) => normalizeAuthorDomain(domain)).filter((domain): domain is AuthorDomain => Boolean(domain));
  const domainText = (labels.length ? labels : [AUTHOR_DOMAIN_FALLBACK]).join('、');
  return {
    voice: `讲${domainText}时先给结论再补理由，不确定的地方会直接说不确定，不替别人做决定`,
    desire: '想把自己在这些问题上绕过的弯讲清楚，又怕听起来像在替对方安排人生',
    object: '一份写满批注的旧笔记',
    route_event: `一起把${domainText}上还没想通的问题推演一遍，分清经验、陪伴和想靠近的人`,
    payoff: '把只属于两人的结论写进新一页，或坦诚承认有些问题需要各自回答',
  };
}
