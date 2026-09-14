export const AUTHOR_TOPICS = [
  {id: 'biology', label: '生物', keywords: ['生物', '细胞', '基因', '进化', '生态', '免疫', '物种', '生命科学'], queries: ['生物学 学习', '生物学 科普', '基因 科普']},
  {id: 'research-method', label: '科研方法论', keywords: ['科研', '研究方法', '实验设计', '论文', '文献', '统计', '科学方法', '对照组'], queries: ['科研方法', '科研入门', '实验 设计']},
  {id: 'career-planning', label: '职业规划', keywords: ['职业规划', '就业', '求职', '转行', '行业', '面试', '简历', '工作选择'], queries: ['职业规划', '转行 经验', '求职 建议']},
  {id: 'education', label: '学业与专业', keywords: ['专业', '转专业', '考研', '保研', '升学', '高考', '志愿', '大学选择'], queries: ['转专业 经验', '考研 选择', '专业 选择']},
  {id: 'romance', label: '亲密关系', keywords: ['恋爱', '表白', '异地恋', '感情', '分手', '亲密关系'], queries: ['异地恋 经验', '表白 建议']},
  {id: 'friendship', label: '友情与社交', keywords: ['友情', '朋友', '室友', '社交', '人际', '边界'], queries: ['室友 相处', '朋友 边界']},
  {id: 'family', label: '家庭期待', keywords: ['家庭', '父母', '家里', '亲情', '期待'], queries: ['父母 期待', '家庭 沟通']},
  {id: 'finance', label: '金钱与生活成本', keywords: ['理财', '收入', '房租', '存款', '负债', '生活费'], queries: ['年轻人 理财', '房租 压力']},
  {id: 'relocation', label: '城市选择', keywords: ['城市', '搬家', '返乡', '异地', '大城市', '回家乡'], queries: ['大城市 还是 回家', '城市 选择']},
  {id: 'health', label: '身心健康', keywords: ['健康', '焦虑', '失眠', '心理', '情绪', '抑郁', '身体'], queries: ['焦虑 缓解', '心理健康']},
  {id: 'entrepreneurship', label: '创业与副业', keywords: ['创业', '副业', '自由职业', '个体', '接单'], queries: ['副业 经验', '自由职业']},
  {id: 'high-school', label: '高中阶段', keywords: ['高中', '分科', '艺考', '竞赛', '校刊', '志愿填报'], queries: ['高中 分科', '艺考 经验']},
  {id: 'graduate', label: '研究生阶段', keywords: ['研究生', '导师', '课题', '组会', '读研', '开题'], queries: ['研究生 导师', '读研 体验']},
  {id: 'early-career', label: '毕业初期', keywords: ['职场', '同事', '加班', '试用期', '跳槽', '第一份工作'], queries: ['第一份工作', '职场 新人']},
];

export function topicById(id) {
  return AUTHOR_TOPICS.find((topic) => topic.id === id);
}
