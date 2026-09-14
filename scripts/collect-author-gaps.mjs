import path from 'node:path';
import {
  CollectorStop,
  analyzeTopicGaps,
  buildAnswerRecord,
  callZhurl,
  filterNewCandidates,
  generalSearchUrl,
  inspectAnswerDetail,
  listExistingAnswerIds,
  loadExistingCorpusTexts,
  loadProjectEnv,
  memberSearchUrl,
  nextBatchIndex,
  resolveMemberHashId,
  resolveZhurl,
  sleep,
  writeBatchesAtomically,
  writeCollectionReport,
} from './lib/author-collect.mjs';
import {AUTHOR_TOPICS, topicById} from './lib/author-topics.mjs';
import {createDeepseekPlanner, planQueries} from './lib/author-plan.mjs';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

const authorToken = arg('author', 'MarryMea');
if (!/^[A-Za-z0-9_-]{1,100}$/.test(authorToken)) throw new Error('作者 url_token 格式无效。');
const limit = Number(arg('limit', '30'));
if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('--limit 必须是 1 到 100 的整数。');
const batchSize = Number(arg('batch-size', '30'));
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 30) throw new Error('--batch-size 必须是 1 到 30 的整数。');
const delayMs = Number(arg('delay-ms', '1500'));
if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60_000) throw new Error('--delay-ms 必须是 0 到 60000 的整数。');
const maxQueries = Number(arg('max-queries', '5'));
if (!Number.isInteger(maxQueries) || maxQueries < 1 || maxQueries > 8) throw new Error('--max-queries 必须是 1 到 8 的整数。');
const minPerTopic = Number(arg('min-per-topic', '2'));
if (!Number.isInteger(minPerTopic) || minPerTopic < 1) throw new Error('--min-per-topic 必须是正整数。');
const minBody = Number(arg('min-body', '200'));
if (!Number.isInteger(minBody) || minBody < 0) throw new Error('--min-body 必须是非负整数。');
const plannerMode = arg('planner', 'model');
if (!['model', 'deterministic'].includes(plannerMode)) throw new Error('--planner 只支持 model 或 deterministic。');
const dryRun = flag('dry-run');
const perPage = 20;
const maxPagesPerQuery = 2;

const selectedTopics = (() => {
  const raw = arg('topic', '');
  if (!raw) return AUTHOR_TOPICS;
  const ids = raw.split(',').map((value) => value.trim()).filter(Boolean);
  const topics = ids.map((id) => {
    const topic = topicById(id);
    if (!topic) throw new Error(`未知话题：${id}`);
    return topic;
  });
  if (!topics.length) throw new Error('--topic 至少需要一个话题 id。');
  return topics;
})();

const authorDirectory = path.resolve('.data', 'author-avatars', authorToken);
const existingIds = await listExistingAnswerIds(authorDirectory);
const corpusTexts = await loadExistingCorpusTexts(authorDirectory);
const gaps = analyzeTopicGaps(corpusTexts, selectedTopics, minPerTopic);
const openGaps = gaps.filter((gap) => gap.missing > 0);

console.log(`author=${authorToken} corpus=${existingIds.size} topics=${selectedTopics.length} openGaps=${openGaps.length} planner=${plannerMode}`);

if (dryRun) {
  const preview = await planQueries({gaps, topics: selectedTopics, corpusTitles: corpusTexts.map((entry) => entry.title), maxQueries, planner: 'deterministic'});
  for (const gap of gaps) console.log(`gap ${gap.id}\tcount=${gap.count}\tmissing=${gap.missing}`);
  for (const query of preview.queries) console.log(`plan\t${query.topic}\t${query.query}`);
  console.log(`dry-run: ${openGaps.length} open gaps, ${preview.queries.length} planned queries, no network and no files written`);
  process.exit(0);
}

const envApplied = loadProjectEnv();
if (envApplied.length) console.log(`env-loaded=${envApplied.join(',')} (values hidden)`);
const plannerKey = process.env.DEEPSEEK_API_KEY?.trim();
const callModel = plannerMode === 'model' ? createDeepseekPlanner({key: plannerKey, endpoint: process.env.DEEPSEEK_ENDPOINT, model: process.env.DEEPSEEK_MODEL}) : undefined;
const planning = await planQueries({gaps, topics: selectedTopics, corpusTitles: corpusTexts.map((entry) => entry.title), maxQueries, planner: plannerMode, callModel});
console.log(`planner=${planning.planner}${planning.plannerError ? ` (${planning.plannerError})` : ''} queries=${planning.queries.length}`);
for (const query of planning.queries) console.log(`plan\t${query.topic}\t${query.query}\t${query.source}`);

const zhurl = resolveZhurl(arg('zhurl'));
const memberHashId = resolveMemberHashId(zhurl, authorToken);
console.log(`member-scoped-search=${memberHashId ? 'on' : 'off'}`);
const seen = new Set();
const records = [];
const skipped = [];
const queryStats = [];

function searchUrl(query, offset) {
  return memberHashId ? memberSearchUrl({query, offset, limit: perPage, memberHashId}) : generalSearchUrl(query, offset, perPage);
}

for (const planned of planning.queries) {
  if (records.length >= limit) break;
  let fetched = 0;
  let candidatesFound = 0;
  for (let page = 0; page < maxPagesPerQuery && records.length < limit; page += 1) {
    const payload = callZhurl(zhurl, searchUrl(planned.query, page * perPage));
    const items = (Array.isArray(payload.data) ? payload.data : [])
      .map((entry) => entry?.object)
      .filter((object) => object && object.type === 'answer');
    const candidates = filterNewCandidates(items, {existingIds, seen, authorToken});
    candidatesFound += candidates.length;
    console.log(`searched topic=${planned.topic} offset=${page * perPage} got=${items.length} candidates=${candidates.length}`);
    if (!candidates.length) {
      if (payload.paging?.is_end) break;
      await sleep(delayMs);
      continue;
    }
    for (const candidate of candidates) {
      if (records.length >= limit) break;
      const detail = callZhurl(zhurl, `https://www.zhihu.com/api/v4/answers/${candidate.answerId}?include=content,excerpt,paid_info,voteup_count,comment_count,created_time,updated_time,question,author`);
      const inspected = inspectAnswerDetail(detail, {authorToken, answerId: candidate.answerId, minBody});
      if (inspected.status === 'skip') {
        skipped.push({answerId: candidate.answerId, reason: inspected.reason});
        console.log(`skip ${inspected.reason} ${candidate.answerId}`);
      } else {
        records.push(buildAnswerRecord(inspected.answer, {
          voteupCount: Number(detail.voteup_count || candidate.voteup || 0),
          createdTime: Number(detail.created_time || 0),
          updatedTime: Number(detail.updated_time || 0),
        }));
        fetched += 1;
        console.log(`fetched ${records.length}/${limit} ${candidate.answerId} len=${inspected.answer.body.length}`);
      }
      await sleep(delayMs);
    }
    if (payload.paging?.is_end) break;
    await sleep(delayMs);
  }
  queryStats.push({topic: planned.topic, query: planned.query, source: planned.source, candidates: candidatesFound, fetched});
}

const collectedAt = new Date().toISOString();
let batches = [];
if (records.length) {
  batches = await writeBatchesAtomically({
    directory: authorDirectory,
    authorToken,
    records,
    batchStartIndex: nextBatchIndex(authorDirectory),
    batchSize,
    collection: {
      method: 'profile-search',
      query: planning.queries.length === 1 ? planning.queries[0].query : null,
      queries: planning.queries.map((query) => ({topic: query.topic, query: query.query, source: query.source})),
      sort: 'search_v3',
      collectedAt,
      completeness: 'fetched_api_content_unverified',
      note: '接口正文未与在线网页逐项比对。',
    },
  });
}

await writeCollectionReport(authorDirectory, {
  authorToken,
  collectedAt,
  method: 'profile-search',
  memberScoped: Boolean(memberHashId),
  planner: planning.planner,
  ...(planning.plannerError ? {plannerError: planning.plannerError} : {}),
  minPerTopic,
  gaps,
  queries: queryStats,
  requested: limit,
  fetched: records.length,
  skipped,
  batches,
  notes: ['接口正文未与在线网页逐项比对，完整性标记为 fetched_api_content_unverified。'],
  answers: records.map((record) => ({
    answerId: record.answerId,
    voteupCount: record.voteupCount,
    createdTime: record.createdTime,
    updatedTime: record.updatedTime,
  })),
});
console.log(`done: ${records.length} answers written, ${skipped.length} skipped`);
