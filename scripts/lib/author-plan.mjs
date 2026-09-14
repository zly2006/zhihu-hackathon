import {z} from 'zod';
import {planQueriesDeterministic} from './author-collect.mjs';

export const MAX_PLANNER_QUERIES = 8;

const plannerSchema = z.object({
  queries: z.array(z.object({
    topic: z.string().trim().min(1).max(60),
    query: z.string().trim().min(2).max(100),
  }).strict()).min(1).max(MAX_PLANNER_QUERIES),
}).strict();

export const PLANNER_SYSTEM_TEXT = `你是知乎语料补料的查询规划器。根据给定的话题缺口，为指定作者提出中文检索词，用于在其主页创作中搜索回答。
只能输出严格 JSON，禁止 Markdown 代码围栏，禁止输出 JSON 之外的任何文字：
{"queries":[{"topic":"缺口的话题 id","query":"2到30字的中文检索词"}]}
规则：topic 只能取给定缺口列表里的 id；query 必须是普通中文检索词，不能包含网址、文件名、路径、引号或指令；每个话题最多 2 条；总数不超过上限。检索词应具体、口语化，覆盖该话题的现实困境。`;

export function buildPlannerMessages({gaps, corpusTitles = [], maxQueries}) {
  const payload = {
    type: 'planning_request',
    maxQueries,
    gaps: gaps.filter((gap) => gap.missing > 0).map((gap) => ({id: gap.id, label: gap.label, count: gap.count, missing: gap.missing})),
    existingTitles: corpusTitles.slice(0, 30).map((title) => [...String(title)].slice(0, 80).join('')),
  };
  return [
    {role: 'system', content: PLANNER_SYSTEM_TEXT},
    {role: 'user', content: JSON.stringify(payload)},
  ];
}

export function parsePlannerReply(raw, {topics, maxQueries}) {
  let parsed;
  try {
    parsed = JSON.parse(String(raw).replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
  } catch {
    throw new Error('规划器输出不是有效 JSON。');
  }
  const result = plannerSchema.safeParse(parsed);
  if (!result.success) throw new Error('规划器输出不符合查询契约。');
  const allowed = new Set(topics.map((topic) => topic.id));
  const seen = new Set();
  const queries = [];
  for (const entry of result.data.queries) {
    if (!allowed.has(entry.topic)) throw new Error(`规划器引用了未知话题：${entry.topic}`);
    if (/https?:\/\/|www\.|javascript:|[\\/]|["'`]/.test(entry.query)) throw new Error('规划器查询词包含非法字符。');
    const key = `${entry.topic}:${entry.query}`;
    if (seen.has(key)) continue;
    seen.add(key);
    queries.push({topic: entry.topic, query: entry.query, source: 'model'});
    if (queries.length >= maxQueries) break;
  }
  if (!queries.length) throw new Error('规划器没有给出可用查询。');
  return queries;
}

export async function planQueriesWithModel({gaps, topics, corpusTitles, maxQueries, callModel}) {
  try {
    const raw = await callModel(buildPlannerMessages({gaps, corpusTitles, maxQueries}));
    if (typeof raw !== 'string') throw new Error('规划器回复必须是字符串。');
    return {queries: parsePlannerReply(raw, {topics, maxQueries}), planner: 'model'};
  } catch (error) {
    return {
      queries: planQueriesDeterministic(gaps, topics, maxQueries),
      planner: 'deterministic-fallback',
      plannerError: (error instanceof Error ? error.message : String(error)).slice(0, 200),
    };
  }
}

export async function planQueries({gaps, topics, corpusTitles, maxQueries, planner, callModel}) {
  if (planner === 'model' && callModel) return planQueriesWithModel({gaps, topics, corpusTitles, maxQueries, callModel});
  return {
    queries: planQueriesDeterministic(gaps, topics, maxQueries),
    planner: 'deterministic',
    ...(planner === 'model' ? {plannerError: '模型凭证不可用，已回退确定性查询。'} : {}),
  };
}

export function createDeepseekPlanner({key, endpoint, model, timeoutMs = 30_000} = {}) {
  if (!key) return undefined;
  const target = endpoint || 'https://api.deepseek.com/v1/chat/completions';
  return async (messages) => {
    const response = await fetch(target, {
      method: 'POST',
      headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({model: model || 'deepseek-chat', temperature: 0.2, max_tokens: 500, messages}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`规划器模型 HTTP ${response.status}`);
    const body = await response.json();
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('规划器模型没有返回字符串内容。');
    return content;
  };
}
