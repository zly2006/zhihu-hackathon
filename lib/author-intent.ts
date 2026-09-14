/**
 * 对话意图路由与检索词归一化（纯函数，无 IO）。
 *
 * 本地检索零成本，永远都会做；只有需要作者依据的问题才允许发起一次在线检索，
 * 所以误判的代价只是“少查一次在线”或“多查一次在线”，不会影响回答本身。
 */

export type AuthorQuestionIntent = 'conversation' | 'knowledge';

const CONVERSATION_PATTERNS: readonly RegExp[] = [
  /你好|您好|嗨|哈喽|早上好|晚上好|早安|晚安|在吗|在不在/,
  /谢谢|辛苦了|打扰了|别介意/,
  /你是谁|介绍(一下)?(你|自己)|你叫什么|怎么称呼你|你的名字/,
  /你能聊|你会什么|能做什么|可以聊什么|你了解什么|你擅长/,
  /好感度|好感|亲密度|怎么增加|怎么提升|怎么变熟/,
  /游戏怎么玩|这是什么游戏|玩法|怎么玩这个/,
  /喜欢什么|心情|感觉如何|你还好吗|累不累|开心/,
  /随便聊聊|聊聊天|聊一会|陪我说说话|有点无聊/,
  /再见|拜拜|下次聊/,
];

const KNOWLEDGE_PATTERNS: readonly RegExp[] = [
  /作者|本人|知乎|回答(里|中|过)|发过|写过|帖子|专栏/,
  /观点|看法|态度|立场|主张|是否认为|怎么看|如何看/,
  /为什么|原因|依据|事实|数据|统计|研究|论文|文献|实验/,
  /建议|经验|方法|思路|攻略|步骤|要注意|注意什么|避坑/,
  /区别|差异|利弊|优缺点|值得|划算|该不该|要不要|能不能|可不可以/,
  /怎么办|怎么做|怎么选|选哪|如何选择|如何判断|有什么办法/,
  /转专业|考研|保研|高考|志愿|求职|面试|职业|专业|科研|导师|学习方法|实习|留学/,
];

export function classifyAuthorQuestion(text: string): AuthorQuestionIntent {
  const question = String(text ?? '').trim();
  if (!question) return 'conversation';
  const conversationScore = CONVERSATION_PATTERNS.reduce((score, pattern) => score + (pattern.test(question) ? 1 : 0), 0);
  const knowledgeScore = KNOWLEDGE_PATTERNS.reduce((score, pattern) => score + (pattern.test(question) ? 1 : 0), 0);
  if (knowledgeScore > conversationScore) return 'knowledge';
  if (conversationScore > knowledgeScore) return 'conversation';
  return /[?？]/.test(question) && [...question].length >= 6 ? 'knowledge' : 'conversation';
}

/**
 * 在线检索按词精确匹配：多个空格分隔的检索词会命中 0 条，
 * 因此含空格时只保留最长的一段作为实际检索词；本地检索仍使用玩家原话。
 */
export function normalizeOnlineQuery(query: string): string {
  const cleaned = query.replace(/[\s\u3000]+/g, ' ').trim();
  if (!cleaned) return '';
  if (!cleaned.includes(' ')) return cleaned.slice(0, 60);
  const parts = cleaned.split(/[\s,，。、；;：:!！?？"'“”‘’()（）\[\]【】{}<>《》|/\\+~`@#$%^&*=_-]+/).filter(Boolean);
  if (!parts.length) return cleaned.slice(0, 60);
  return parts.reduce((best, part) => (part.length > best.length ? part : best), parts[0]).slice(0, 60);
}
