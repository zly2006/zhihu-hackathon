import path from 'node:path';
import {
  CollectorStop,
  buildAnswerRecord,
  callZhurl,
  generalSearchUrl,
  inspectAnswerDetail,
  listExistingAnswerIds,
  memberSearchUrl,
  nextBatchIndex,
  resolveMemberHashId,
  resolveZhurl,
  sleep,
  validateAnswerId,
  writeBatchesAtomically,
  writeCollectionReport,
} from './lib/author-collect.mjs';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

const authorToken = arg('author', 'MarryMea');
if (!/^[A-Za-z0-9_-]{1,100}$/.test(authorToken)) throw new Error('作者 url_token 格式无效。');
const mode = arg('mode', arg('sort', 'top') === 'created' ? 'latest' : 'top');
if (!['latest', 'top', 'search'].includes(mode)) throw new Error('--mode 只支持 latest、top 或 search。');
const query = arg('query', '');
if (mode === 'search' && (!query.trim() || query.length > 100)) throw new Error('--mode search 需要 1 到 100 字符的 --query。');
const limit = Number(arg('limit', '40'));
if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('--limit 必须是 1 到 100 的整数。');
const batchSize = Number(arg('batch-size', '30'));
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 30) throw new Error('--batch-size 必须是 1 到 30 的整数（清单协议上限）。');
const delayMs = Number(arg('delay-ms', '1500'));
if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60_000) throw new Error('--delay-ms 必须是 0 到 60000 的整数。');
const minBody = Number(arg('min-body', '200'));
if (!Number.isInteger(minBody) || minBody < 0) throw new Error('--min-body 必须是非负整数。');
const dryRun = flag('dry-run');
const perPage = 20;
const methodLabel = mode === 'latest' ? 'latest' : mode === 'top' ? 'top-voteups' : 'profile-search';
const sortBy = mode === 'latest' ? 'created' : 'voteups';

const zhurl = resolveZhurl(arg('zhurl'));
const authorDirectory = path.resolve('.data', 'author-avatars', authorToken);
const memberHashId = mode === 'search' ? resolveMemberHashId(zhurl, authorToken) : '';
if (mode === 'search') console.log(`member-scoped-search=${memberHashId ? 'on' : 'off'}`);

const existing = await listExistingAnswerIds(authorDirectory);

console.log(`author=${authorToken} mode=${methodLabel} existing=${existing.size} limit=${limit}`);

const candidates = [];
const seenCandidateIds = new Set();

async function listAnswerPage(offset) {
  const url = `https://www.zhihu.com/api/v4/members/${authorToken}/answers?sort_by=${sortBy}&offset=${offset}&limit=${perPage}`;
  const page = callZhurl(zhurl, url);
  return {items: Array.isArray(page.data) ? page.data : [], isEnd: Boolean(page.paging?.is_end)};
}

async function listSearchPage(offset) {
  const url = memberHashId ? memberSearchUrl({query, offset, limit: perPage, memberHashId}) : generalSearchUrl(query, offset, perPage);
  const page = callZhurl(zhurl, url);
  const items = (Array.isArray(page.data) ? page.data : [])
    .map((entry) => entry?.object)
    .filter((object) => object && object.type === 'answer')
    .filter((object) => object?.author?.url_token === authorToken)
    .map((object) => ({id: object.id, question: object.question, voteup_count: object.voteup_count}));
  return {items, isEnd: Boolean(page.paging?.is_end)};
}

for (let offset = 0; offset < limit * 2; offset += perPage) {
  const page = mode === 'search' ? await listSearchPage(offset) : await listAnswerPage(offset);
  if (!page.items.length) {
    if (page.isEnd) break;
    if (offset === 0) throw new CollectorStop('列表接口没有返回任何条目，已停止且不写入文件。', 'EMPTY_LIST');
    break;
  }
  for (const item of page.items) {
    const answerId = validateAnswerId(item.id);
    if (!answerId || existing.has(answerId) || seenCandidateIds.has(answerId)) continue;
    seenCandidateIds.add(answerId);
    candidates.push({answerId, questionTitle: String(item.question?.title || '').trim(), voteup: Number(item.voteup_count || 0)});
    if (candidates.length >= limit) break;
  }
  console.log(`listed offset=${offset} got=${page.items.length} candidates=${candidates.length}`);
  if (page.isEnd || candidates.length >= limit) break;
  await sleep(delayMs);
}

if (dryRun) {
  for (const item of candidates) console.log(`${item.answerId}\tvoteups=${item.voteup}\t${item.questionTitle}`);
  console.log(`dry-run: ${candidates.length} candidates, no files written`);
  process.exit(0);
}

const records = [];
const skipped = [];
const include = 'content,excerpt,paid_info,voteup_count,comment_count,created_time,updated_time,question,author';
for (const [index, candidate] of candidates.entries()) {
  const detail = callZhurl(zhurl, `https://www.zhihu.com/api/v4/answers/${candidate.answerId}?include=${include}`);
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
    console.log(`fetched ${index + 1}/${candidates.length} ${candidate.answerId} len=${inspected.answer.body.length}`);
  }
  await sleep(delayMs);
}

if (!records.length) {
  console.log('没有可写入的回答（可能均已采集或全部被过滤）。');
  process.exit(0);
}

const collectedAt = new Date().toISOString();
const batches = await writeBatchesAtomically({
  directory: authorDirectory,
  authorToken,
  records,
  batchStartIndex: nextBatchIndex(authorDirectory),
  batchSize,
  collection: {
    method: methodLabel,
    query: mode === 'search' ? query : null,
    sort: sortBy,
    collectedAt,
    completeness: 'fetched_api_content_unverified',
    note: '接口正文未与在线网页逐项比对。',
  },
});
for (const batch of batches) console.log(`wrote ${batch.batchId}: ${batch.recordCount} records`);

await writeCollectionReport(authorDirectory, {
  authorToken,
  collectedAt,
  method: methodLabel,
  query: mode === 'search' ? query : null,
  sort: sortBy,
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
