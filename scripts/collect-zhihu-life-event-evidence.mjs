import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const cliFlag = process.argv.indexOf("--cli");
const cli =
  cliFlag >= 0 ? process.argv[cliFlag + 1] : process.env.ZHIHU_CLI_PATH;

if (!cli) {
  throw new Error(
    "请通过 --cli 或 ZHIHU_CLI_PATH 指定官方 zhihu-cli 绝对路径。",
  );
}

const files = [
  "content/life-events.v1.json",
  "content/campus-life-events.v1.json",
];

const optionQueries = {
  "life-grad-school-or-offer": ["考研录取 offer 选择", "应届生 offer 入职 选择", ["延毕 延期入职 沟通", "毕业延期 offer 入职怎么办"]],
  "life-advisor-boundary": ["研究生 导师 任务 边界 沟通", "研究生 导师 任务太多 怎么办", ["研究生 导师 任务 协调 沟通", "导师安排任务不合理 找谁协调"]],
  "life-long-distance-decision": ["异地恋 约定 未来规划", "为了恋人 去对方城市 工作 值得吗", "异地恋 暂停关系 冷静期"],
  "life-roommate-common-space": ["合租 公共区域 卫生 分工 沟通", "合租 室友卫生 帮忙打扫", "合租 室友矛盾 搬家 退租"],
  "life-first-offer-values": ["异地 高薪 offer 选择", "应届生 offer 团队 导师 选择", "应届生 初创公司 offer 选择"],
  "life-parent-care-opportunity": ["父母 手术 请假 照护 工作", "父母生病 住院 请护工 工作 怎么办", "父母住院 工作项目 选择"],
  "life-friend-loan-boundary": ["朋友借钱 借条 限额", "朋友借钱 小额赠予 拒绝", "瞒着伴侣 借钱给朋友"],
  "life-credit-taken-at-work": ["工作功劳被抢 私下沟通", "工作功劳被抢 公开澄清", "工作成果被抢 暂不争取"],
  "life-city-return-or-stay": ["伴侣 回老家 工作 选择", "留在大城市 父母养老", "双城生活 试住 决策"],
  "life-burnout-medical-leave": ["工作压力 病假 检查", "工作压力 协商 减少工作量", "身体不舒服 工作项目 坚持还是休息"],
  "life-friend-business-invitation": ["朋友创业 兼职验证", "朋友创业 股权 合伙协议", "朋友创业邀请 拒绝加入"],
  "life-high-school-subject-track": ["高中 文理分科 怎么选择 兴趣 擅长", "高中选科 听父母建议", "高中选科 试听 再决定"],
  "life-high-school-competition-team": ["高中竞赛 名额 个人成果 公平", "团队竞赛 贡献 成果分配 怎么办", "竞赛 团队共同成果 署名 分配"],
  "life-high-school-friend-cheating": ["朋友考试作弊 劝主动承认", "朋友作弊 一起复习 帮助", "朋友作弊 沉默 不举报"],
  "life-university-change-major": ["大学转专业 申请 建议", "不喜欢专业 不转专业 发展", "转专业 试听 试读 再决定"],
  "life-university-club-budget": [["大学社团 经费 核账", "大学社团 财务 管理 做账"], "社团活动 垫付 报销", "社团经费不足 缩减活动"],
  "life-university-group-project": ["小组作业 队友没做 如实记录", "小组作业 队友没完成 重新分工", "小组作业 帮队友完成"],
  "life-university-scholarship-rivalry": [["奖学金 材料有问题 要不要提醒同学", "奖学金 申请材料写错 怎么办"], ["奖学金 评选 材料造假 举报 公平", "奖学金 评选不公平 申诉"], ["奖学金 评选 材料错误 不举报", "发现同学奖学金材料作假 怎么办"]],
  "life-graduate-paper-authorship": ["论文 作者贡献 协商署名", ["论文署名 妥协 投稿", "论文临时加作者 接受 署名"], "论文署名争议 申诉"],
  "life-graduate-data-anomaly": ["实验复现失败 补实验", "实验结果不理想 论文 如实写 局限性", "实验复现失败 沿用结论 风险"],
  "life-graduate-internship-thesis": [["研究生 实习 论文 中期", "研究生 实习和论文冲突 怎么选择"], "实习 论文 排期 沟通", "实习转正 论文 冲突"],
};
const libraries = await Promise.all(
  files.map(async (file) => ({
    file,
    data: JSON.parse(await readFile(path.resolve(file), "utf8")),
  })),
);

const cache = new Map();

function search(query) {
  if (cache.has(query)) return cache.get(query);
  const raw = execFileSync(
    cli,
    ["search", "zhihu", "--query", query, "--count", "10"],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const payload = JSON.parse(raw);
  if (payload.Code !== 0) {
    throw new Error(`知乎搜索失败：${payload.Message || payload.Code}`);
  }
  const answers = (payload.Data?.Items || [])
    .filter(
      (item) =>
        item.ContentType === "Answer" &&
        /^https:\/\/(?:www\.)?zhihu\.com\/question\/\d+\/answer\/\d+/.test(
          item.Url || "",
        ),
    )
    .map((item) => ({
      contentId: String(item.ContentID),
      contentType: "Answer",
      title: String(item.Title || "知乎回答").trim(),
      author: String(item.AuthorName || "知乎用户").trim(),
      url: new URL(String(item.Url)).origin + new URL(String(item.Url)).pathname,
      excerpt: String(item.ContentText || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 360),
      voteUpCount: Number(item.VoteUpCount || 0),
      authorityLevel: String(item.AuthorityLevel || ""),
    }))
    .filter((item) => item.excerpt.length >= 40);
  cache.set(query, answers);
  return answers;
}

function addDistinct(target, answers) {
  const contentIds = new Set(target.map((item) => item.contentId));
  for (const answer of answers) {
    if (contentIds.has(answer.contentId)) continue;
    contentIds.add(answer.contentId);
    target.push(answer);
  }
}

function normalizeTitle(title) {
  return title.replace(/\s*-\s*知乎\s*$/u, "").replace(/\s+/g, "").trim();
}

function selectEvidence(candidates, pathLabel) {
  if (candidates.length < 3)
    throw new Error(`${pathLabel} 只有 ${candidates.length} 条知乎回答，禁止写入。`);
  const first = candidates[0];
  const differentQuestion = candidates.find(
    (item) => normalizeTitle(item.title) !== normalizeTitle(first.title),
  );
  if (!differentQuestion)
    throw new Error(`${pathLabel} 只命中同一个知乎问题，禁止写入。`);
  const selected = [first, differentQuestion];
  addDistinct(selected, candidates);
  return selected.slice(0, 3);
}

for (const { data } of libraries) {
  data.schemaVersion = 2;
  data.updatedAt = new Date().toISOString().slice(0, 10);
  for (const event of data.events) {
    event.version = 2;
    const queries = optionQueries[event.id];
    if (!queries || queries.length !== event.options.length)
      throw new Error(`${event.id} 缺少逐选项人工查询词。`);
    for (const [optionIndex, option] of event.options.entries()) {
      const configuredQuery = queries[optionIndex];
      const searchQueries = Array.isArray(configuredQuery)
        ? configuredQuery
        : [configuredQuery];
      const evidence = [];
      for (const query of searchQueries) {
        addDistinct(evidence, search(query));
        if (evidence.length >= 3) break;
      }
      option.zhihuEvidence = selectEvidence(evidence, `${event.id}.${option.id}`);
      option.searchQuery = searchQueries.join(" | ");
      delete option.immediate;
      delete option.delayed;
      delete option.flags;
      delete option.followUpHooks;
    }
    const eventAnswers = [];
    addDistinct(eventAnswers, event.options.flatMap((option) => option.zhihuEvidence));
    event.zhihuEvidence = selectEvidence(eventAnswers, event.id);
    event.sourcePolicy = {
      mode: "zhihu-answers-only",
      minimumAnswersPerOption: 3,
      query: queries.flat().join(" | "),
      collectedAt: new Date().toISOString(),
    };
    delete event.situation;
    delete event.dilemma;
    delete event.stakes;
    delete event.editorial;
  }
}

for (const { file, data } of libraries) {
  await writeFile(path.resolve(file), `${JSON.stringify(data, null, 2)}\n`);
}

const events = libraries.flatMap(({ data }) => data.events);
const evidenceCount = events.reduce(
  (sum, event) =>
    sum +
    event.options.reduce(
      (optionSum, option) => optionSum + option.zhihuEvidence.length,
      0,
    ),
  0,
);
console.log(
  `collected ${evidenceCount} option citations for ${events.length} events from Zhihu answers`,
);
