import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const sources = [
  "content/life-events.v1.json",
  "content/campus-life-events.v1.json",
];
const sourceLibraries = await Promise.all(
  sources.map((source) =>
    readFile(resolve(process.cwd(), source), "utf8").then(JSON.parse),
  ),
);
const library = {
  schemaVersion: 1,
  events: sourceLibraries.flatMap((source) => source.events ?? []),
};
const statKeys = new Set([
  "cash",
  "health",
  "happiness",
  "knowledge",
  "connections",
  "career",
  "assets",
]);
const relationKeys = new Set(["closeness", "trust", "conflict", "commitment"]);
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
if (library.schemaVersion !== 1) reject("schemaVersion", "必须为 1");
if (!Array.isArray(library.events) || library.events.length < 10)
  reject("events", "首批至少 10 条");
const ids = new Set();
for (const [index, event] of (library.events ?? []).entries()) {
  const path = `events[${index}]`;
  if (!/^life-[a-z0-9-]+$/.test(event.id ?? ""))
    reject(`${path}.id`, "格式非法");
  if (ids.has(event.id)) reject(`${path}.id`, "重复");
  ids.add(event.id);
  if (event.version !== 1) reject(`${path}.version`, "必须为 1");
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
  if (typeof event.situation !== "string" || event.situation.length < 45)
    reject(`${path}.situation`, "情境必须具体且不少于 45 字");
  if (!Array.isArray(event.stakes) || event.stakes.length < 3)
    reject(`${path}.stakes`, "至少说明三项利害关系");
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
    if (!option.immediate?.narrative)
      reject(`${optionPath}.immediate.narrative`, "缺少即时后果");
    const statEntries = Object.entries(option.immediate?.statDelta ?? {});
    if (!statEntries.length)
      reject(`${optionPath}.immediate.statDelta`, "至少改变一项人生状态");
    for (const [key, value] of statEntries)
      if (
        !statKeys.has(key) ||
        !Number.isInteger(value) ||
        Math.abs(value) > 12
      )
        reject(
          `${optionPath}.immediate.statDelta.${key}`,
          "必须是绝对值不超过 12 的整数",
        );
    const effects = option.immediate?.relationshipEffects;
    if (!Array.isArray(effects) || effects.length === 0)
      reject(`${optionPath}.immediate.relationshipEffects`, "至少影响一段关系");
    for (const [effectIndex, effect] of (effects ?? []).entries()) {
      if (!event.requiredRelationshipRoles.includes(effect.targetRole))
        reject(
          `${optionPath}.relationshipEffects[${effectIndex}]`,
          "关系角色未在事件前置条件中声明",
        );
      if (!effect.reason?.trim())
        reject(
          `${optionPath}.relationshipEffects[${effectIndex}].reason`,
          "必须说明关系变化原因",
        );
      const deltas = Object.entries(effect.delta ?? {});
      if (!deltas.length)
        reject(
          `${optionPath}.relationshipEffects[${effectIndex}].delta`,
          "关系变化不能为空",
        );
      for (const [key, value] of deltas)
        if (
          !relationKeys.has(key) ||
          !Number.isInteger(value) ||
          Math.abs(value) > 20
        )
          reject(
            `${optionPath}.relationshipEffects[${effectIndex}].delta.${key}`,
            "必须是绝对值不超过 20 的整数",
          );
    }
    const hasVisibleCost =
      statEntries.some(([, value]) => value < 0) ||
      (effects ?? []).some((effect) =>
        Object.entries(effect.delta ?? {}).some(
          ([key, value]) => value < 0 || (key === "conflict" && value > 0),
        ),
      );
    if (!hasVisibleCost)
      reject(
        optionPath,
        "选项必须包含可见的资源代价或关系代价，不能成为无代价最优解",
      );
    if (
      !option.delayed?.likely ||
      !option.delayed?.risk ||
      option.delayed.likely === option.delayed.risk
    )
      reject(`${optionPath}.delayed`, "必须分别说明可能收益与风险");
    if (
      !Array.isArray(option.followUpHooks) ||
      option.followUpHooks.length === 0
    )
      reject(`${optionPath}.followUpHooks`, "至少一个后续钩子");
  }
  if (
    event.editorial?.sourceMode !== "zhihu-topic-human-adaptation" ||
    event.editorial?.reviewStatus !== "reviewed"
  )
    reject(`${path}.editorial`, "首批事件必须注明人工改编并完成审阅");
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
  `life event library: ${library.events.length} reviewed events, ${optionCount} options, ${new Set(library.events.map((event) => event.domain)).size} primary domains; stages high-school=${stageCounts["high-school"]}, university=${stageCounts.university}, graduate=${stageCounts.graduate}`,
);
