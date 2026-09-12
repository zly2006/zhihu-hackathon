import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const sources = ["content/campus-life-events.v1.json"];
const sourceLibraries = await Promise.all(
  sources.map((source) =>
    readFile(resolve(process.cwd(), source), "utf8").then(JSON.parse),
  ),
);
const library = {
  schemaVersion: 2,
  events: sourceLibraries.flatMap((source) => source.events ?? []),
};
const lifeStages = new Set(["high-school", "university", "graduate"]);
const domains = new Set([
  "education",
  "career",
  "finance",
  "housing",
  "relocation",
  "entrepreneurship",
  "romance",
  "marriage",
  "family",
  "parenting",
  "friendship",
  "health",
  "social",
  "loss",
  "aging",
]);
const errors = [];
const reject = (path, message) => errors.push(`${path}: ${message}`);
function normalizeTitle(title) {
  return String(title || "")
    .replace(/\s*-\s*知乎\s*$/u, "")
    .replace(/\s+/g, "")
    .trim();
}
function validateEvidence(evidence, path) {
  if (!Array.isArray(evidence) || evidence.length < 3) {
    reject(path, "至少需要 3 条知乎回答");
    return;
  }
  if (new Set(evidence.map((item) => item.url)).size !== evidence.length)
    reject(path, "知乎回答链接必须去重");
  if (new Set(evidence.map((item) => item.contentId)).size !== evidence.length)
    reject(path, "知乎回答 ContentID 必须去重");
  if (new Set(evidence.map((item) => normalizeTitle(item.title))).size < 2)
    reject(path, "至少需要来自 2 个不同知乎问题，不能只堆同一问题的多个回答");
  for (const [index, item] of evidence.entries()) {
    const itemPath = `${path}[${index}]`;
    if (item.contentType !== "Answer") reject(itemPath, "来源必须是知乎回答");
    if (
      !/^https:\/\/(?:www\.)?zhihu\.com\/question\/\d+\/answer\/\d+/.test(
        item.url || "",
      )
    )
      reject(`${itemPath}.url`, "必须是可追溯的知乎回答链接");
    if (!item.title?.trim() || !item.author?.trim() || !item.excerpt?.trim())
      reject(itemPath, "必须保留标题、作者和原始摘要");
    if (item.authorAvatarUrl && !/^https:\/\/(?:[\w-]+\.)?zhimg\.com\//.test(item.authorAvatarUrl))
      reject(`${itemPath}.authorAvatarUrl`, "头像必须来自知乎图片域名");
    if (item.authorProfileUrl && !/^https:\/\/www\.zhihu\.com\/people\//.test(item.authorProfileUrl))
      reject(`${itemPath}.authorProfileUrl`, "答主主页必须是知乎 people 链接");
  }
}
if (library.schemaVersion !== 2) reject("schemaVersion", "必须为 2");
if (!Array.isArray(library.events) || library.events.length < 10)
  reject("events", "首批至少 10 条");
const ids = new Set();
for (const [index, event] of (library.events ?? []).entries()) {
  const path = `events[${index}]`;
  if (!/^life-[a-z0-9-]+$/.test(event.id ?? ""))
    reject(`${path}.id`, "格式非法");
  if (ids.has(event.id)) reject(`${path}.id`, "重复");
  ids.add(event.id);
  if (event.version !== 2) reject(`${path}.version`, "必须为 2");
  if (!domains.has(event.domain)) reject(`${path}.domain`, "领域非法");
  if (
    !Array.isArray(event.lifeStages) ||
    !event.lifeStages.length ||
    event.lifeStages.some((stage) => !lifeStages.has(stage))
  )
    reject(`${path}.lifeStages`, "必须声明高中、本科或硕士阶段");
  if (
    !Number.isInteger(event.ageRange?.min) ||
    !Number.isInteger(event.ageRange?.max) ||
    event.ageRange.min < 14 ||
    event.ageRange.max > 80 ||
    event.ageRange.min > event.ageRange.max
  )
    reject(`${path}.ageRange`, "年龄范围非法");
  if (
    event.sourcePolicy?.mode !== "zhihu-answers-only" ||
    event.sourcePolicy?.minimumAnswersPerOption !== 3
  )
    reject(`${path}.sourcePolicy`, "必须声明只使用知乎回答且每个选项至少 3 条");
  validateEvidence(event.zhihuEvidence, `${path}.zhihuEvidence`);
  if (!Array.isArray(event.options) || event.options.length !== 3) {
    reject(`${path}.options`, "必须恰好三个选项");
    continue;
  }
  const optionIds = event.options.map((option) => option.id).join("");
  if (optionIds !== "ABC") reject(`${path}.options`, "选项必须按 A/B/C 排列");
  if (new Set(event.options.map((option) => option.strategyTag)).size !== 3)
    reject(`${path}.options`, "行动机制必须互不相同");
  for (const [optionIndex, option] of event.options.entries()) {
    const optionPath = `${path}.options[${optionIndex}]`;
    for (const key of ["label", "action", "strategyTag", "tradeoff"])
      if (typeof option[key] !== "string" || !option[key].trim())
        reject(`${optionPath}.${key}`, "不能为空");
    if (typeof option.searchQuery !== "string" || !option.searchQuery.trim())
      reject(`${optionPath}.searchQuery`, "必须保留官方 CLI 使用的检索词");
    validateEvidence(option.zhihuEvidence, `${optionPath}.zhihuEvidence`);
    if (option.zhihuEvidence?.length < 3)
      reject(`${optionPath}.zhihuEvidence`, "每个选项至少需要 3 条知乎回答");
    for (const forbidden of ["immediate", "delayed", "flags", "followUpHooks"])
      if (forbidden in option)
        reject(`${optionPath}.${forbidden}`, "静态模板不得预写 AI 推断结果");
  }
}
for (const stage of lifeStages) {
  const count = library.events.filter((event) =>
    event.lifeStages?.includes(stage),
  ).length;
  if (count < 3)
    reject("events", `${stage} 阶段至少需要 3 条事件，当前 ${count} 条`);
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
const stageCounts = Object.fromEntries(
  [...lifeStages].map((stage) => [
    stage,
    library.events.filter((event) => event.lifeStages?.includes(stage)).length,
  ]),
);
const optionCount = library.events.reduce(
  (total, event) => total + (event.options?.length ?? 0),
  0,
);
console.log(
  `life event library: ${library.events.length} Zhihu-grounded events, ${optionCount} options, ${new Set(library.events.map((event) => event.domain)).size} primary domains; stages high-school=${stageCounts["high-school"]}, university=${stageCounts.university}, graduate=${stageCounts.graduate}`,
);
