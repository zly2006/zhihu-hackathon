import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync, readdirSync} from 'node:fs';
import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const MAX_BATCH_RECORDS = 30;
export const MAX_BATCH_BYTES = 480_000;
export const MAX_ANSWER_BYTES = 128_000;
export const MAX_ANSWER_CHARS = 100_000;

export class CollectorStop extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'CollectorStop';
    this.code = code;
  }
}

export function resolveZhurl(explicit) {
  if (explicit) return explicit;
  if (process.env.ZHURL_BIN) return process.env.ZHURL_BIN;
  const local = path.join(os.homedir(), '.cargo', 'bin', 'zhurl.exe');
  return existsSync(local) ? local : 'zhurl';
}

export function stopIfAuthError(detail) {
  const text = String(detail);
  if (/\b401\b|\b403\b|unauthorized|forbidden|未登录|请登录|风控|验证码|安全验证|频繁|限流|rate.?limit/i.test(text)) {
    throw new CollectorStop(`zhurl 认证或限流错误，已停止且不写入任何文件：${text.slice(0, 200)}`, 'AUTH_OR_RATE_LIMIT');
  }
}

function zhurlCommand(zhurl, url, options) {
  const args = [];
  if (options.mode === 'android') args.push('--android');
  else args.push('--web');
  if (options.method && options.method !== 'GET') args.push('-X', options.method);
  for (const header of options.headers || []) args.push('-H', header);
  for (const data of options.data || []) args.push('-d', data);
  args.push(url);
  if (/\.(?:mjs|cjs|js)$/.test(zhurl)) return {command: process.execPath, args: [zhurl, ...args]};
  return {command: zhurl, args};
}

export function callZhurl(zhurl, url, options = {}) {
  const {command, args} = zhurlCommand(zhurl, url, options);
  let raw;
  try {
    raw = execFileSync(command, args, {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
  } catch (error) {
    const detail = String(error.stderr || error.message || '').trim();
    stopIfAuthError(detail);
    throw new Error(`zhurl 调用失败（${url}）：${detail.slice(0, 300)}`);
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    stopIfAuthError(raw);
    throw new Error(`zhurl 返回不是 JSON（${url}）：${raw.trim().slice(0, 200)}`);
  }
  if (payload && typeof payload === 'object' && payload.error) {
    const detail = JSON.stringify(payload.error).slice(0, 300);
    stopIfAuthError(detail);
    throw new Error(`知乎接口返回错误（${url}）：${detail}`);
  }
  return payload;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', middot: '·',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  times: '×', laquo: '«', raquo: '»', copy: '©', reg: '®',
  permil: '‰', deg: '°', plusmn: '±', minus: '−',
};

export function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-zA-Z]+);/g, (match, name) => (Object.hasOwn(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : match));
}

export function htmlToText(html) {
  const withoutNoise = String(html).replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, '');
  const withBreaks = withoutNoise
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|blockquote|figcaption|h[1-6]|tr|section|article|pre)>/gi, '\n')
    .replace(/<img[^>]*\balt="([^"]*)"[^>]*>/gi, (_, alt) => (alt ? `[${alt}]` : ''))
    .replace(/<img[^>]*>/gi, '')
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1')
    .replace(/<[^>]+>/g, '');
  const decoded = decodeEntities(withBreaks).replace(/\u200b/g, '').replace(/\r\n?/g, '\n');
  const lines = decoded
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line, index, all) => line || (index > 0 && all[index - 1]));
  return lines.join('\n').trim();
}

export function validateAnswerId(value) {
  const answerId = String(value ?? '');
  return /^\d+$/.test(answerId) ? answerId : '';
}

export function answerSourceUrl(answerId) {
  return `https://www.zhihu.com/answer/${answerId}`;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function inspectAnswerDetail(detail, {authorToken, answerId, minBody}) {
  if (detail?.paid_info?.is_paid) return {status: 'skip', reason: 'paid'};
  if (detail?.author?.url_token !== authorToken) return {status: 'skip', reason: 'author-mismatch'};
  const authorName = String(detail.author?.name || '').trim();
  if (!authorName) return {status: 'skip', reason: 'author-name-missing'};
  const body = htmlToText(detail.content || '');
  if (body.length < minBody || body.length > MAX_ANSWER_CHARS) return {status: 'skip', reason: `body-length-${body.length}`};
  const questionTitle = String(detail.question?.title || '').trim();
  if (!questionTitle) return {status: 'skip', reason: 'question-title-missing'};
  return {
    status: 'ok',
    answer: {
      answerId,
      authorName,
      authorUrlToken: authorToken,
      authorProfileUrl: `https://www.zhihu.com/people/${authorToken}`,
      questionTitle: questionTitle.slice(0, 500),
      sourceUrl: answerSourceUrl(answerId),
      body,
      completeness: 'fetched_api_content_unverified',
    },
  };
}

export function buildAnswerRecord(answer, metrics = {}) {
  const inputFile = `answer-${answer.answerId}.json`;
  const raw = Buffer.from(`${JSON.stringify(answer, null, 2)}\n`, 'utf8');
  return {
    answerId: answer.answerId,
    inputFile,
    sha256: sha256(raw),
    raw,
    voteupCount: Number(metrics.voteupCount || 0),
    createdTime: Number(metrics.createdTime || 0),
    updatedTime: Number(metrics.updatedTime || 0),
  };
}

export async function listExistingAnswerIds(directory) {
  const ids = new Set();
  if (!existsSync(directory)) return ids;
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    if (!entry.isDirectory() || !/^batch-\d+$/.test(entry.name)) continue;
    const manifestPath = path.join(directory, entry.name, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      for (const record of manifest.records || []) {
        const answerId = validateAnswerId(record.answerId);
        if (answerId) ids.add(answerId);
      }
    } catch {
      continue;
    }
  }
  return ids;
}

export function nextBatchIndex(directory) {
  if (!existsSync(directory)) return 1;
  const indexes = readdirSync(directory)
    .filter((name) => /^batch-\d+$/.test(name))
    .map((name) => Number(name.slice('batch-'.length)));
  return indexes.length ? Math.max(...indexes) + 1 : 1;
}

export function planBatchSplits(records, {batchSize = MAX_BATCH_RECORDS, maxBytes = MAX_BATCH_BYTES} = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_RECORDS) throw new Error(`每批记录数必须是 1 到 ${MAX_BATCH_RECORDS} 的整数。`);
  if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new Error('批次字节上限必须是正整数。');
  const batches = [];
  let current = [];
  let bytes = 0;
  for (const record of records) {
    const size = record.raw.length;
    if (current.length >= batchSize || bytes + size > maxBytes) {
      if (current.length) batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(record);
    bytes += size;
  }
  if (current.length) batches.push(current);
  return batches;
}

export async function writeBatchesAtomically({directory, authorToken, records, batchStartIndex, batchSize, maxBytes, collection}) {
  const batches = planBatchSplits(records, {batchSize, maxBytes});
  const written = [];
  let batchIndex = batchStartIndex;
  for (const batchRecords of batches) {
    const batchId = `batch-${String(batchIndex).padStart(3, '0')}`;
    const finalDirectory = path.join(directory, batchId);
    const stagingDirectory = path.join(directory, `.${batchId}.staging`);
    await rm(stagingDirectory, {recursive: true, force: true});
    await mkdir(stagingDirectory, {recursive: true});
    for (const record of batchRecords) {
      await writeFile(path.join(stagingDirectory, record.inputFile), record.raw);
    }
    const manifest = {
      schemaVersion: 1,
      batchId,
      authorUrlToken: authorToken,
      recordCount: batchRecords.length,
      source: 'zhurl-web-api',
      collectedAt: collection?.collectedAt,
      collection,
      records: batchRecords.map((record) => ({answerId: record.answerId, inputFile: record.inputFile, sha256: record.sha256})),
    };
    await writeFile(path.join(stagingDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await rename(stagingDirectory, finalDirectory);
    written.push({batchId, recordCount: batchRecords.length});
    batchIndex += 1;
  }
  return written;
}

export async function loadExistingCorpusTexts(directory, {maxRecords = 500, maxBytes = 5_000_000} = {}) {
  const texts = [];
  const seen = new Set();
  let bytes = 0;
  if (!existsSync(directory)) return texts;
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    if (!entry.isDirectory() || !/^batch-\d+$/.test(entry.name)) continue;
    const batchDirectory = path.join(directory, entry.name);
    const manifestPath = path.join(batchDirectory, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    let manifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    } catch {
      continue;
    }
    for (const record of manifest.records || []) {
      const answerId = validateAnswerId(record.answerId);
      const inputFile = String(record.inputFile || '');
      if (!answerId || seen.has(answerId) || !/^answer-\d+\.json$/.test(inputFile)) continue;
      const file = path.join(batchDirectory, inputFile);
      if (!existsSync(file)) continue;
      let answer;
      try {
        answer = JSON.parse(await readFile(file, 'utf8'));
      } catch {
        continue;
      }
      const title = String(answer.questionTitle || '').trim();
      const body = String(answer.body || '');
      const size = Buffer.byteLength(title + body, 'utf8');
      if (!title && !body) continue;
      if (texts.length + 1 > maxRecords || bytes + size > maxBytes) return texts;
      bytes += size;
      seen.add(answerId);
      texts.push({answerId, title, text: `${title}\n${body}`});
    }
  }
  return texts;
}

export function matchTopicIds(text, topics) {
  const normalized = String(text || '').normalize('NFKC').toLowerCase();
  const matched = [];
  for (const topic of topics) {
    if ((topic.keywords || []).some((keyword) => normalized.includes(String(keyword).normalize('NFKC').toLowerCase()))) matched.push(topic.id);
  }
  return matched;
}

export function analyzeTopicGaps(corpusTexts, topics, minPerTopic = 2) {
  if (!Number.isInteger(minPerTopic) || minPerTopic < 1) throw new Error('minPerTopic 必须是正整数。');
  return topics
    .map((topic) => {
      const matchedAnswerIds = corpusTexts
        .filter((entry) => matchTopicIds(entry.text, [topic]).length > 0)
        .map((entry) => entry.answerId);
      return {id: topic.id, label: topic.label, count: matchedAnswerIds.length, missing: Math.max(0, minPerTopic - matchedAnswerIds.length), matchedAnswerIds};
    })
    .sort((a, b) => a.count - b.count || a.id.localeCompare(b.id));
}

export function planQueriesDeterministic(gaps, topics, maxQueries = 5) {
  if (!Number.isInteger(maxQueries) || maxQueries < 1 || maxQueries > 8) throw new Error('maxQueries 必须是 1 到 8 的整数。');
  const byId = new Map(topics.map((topic) => [topic.id, topic]));
  const planned = [];
  const seen = new Set();
  for (const gap of gaps) {
    if (planned.length >= maxQueries) break;
    if (gap.missing <= 0) continue;
    const topic = byId.get(gap.id);
    if (!topic) continue;
    for (const query of topic.queries || []) {
      if (planned.length >= maxQueries) break;
      const normalized = query.trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      planned.push({topic: topic.id, query: normalized, source: 'deterministic'});
    }
  }
  return planned;
}

export function filterNewCandidates(items, {existingIds, seen, authorToken}) {
  const candidates = [];
  for (const item of items) {
    const answerId = validateAnswerId(item?.id);
    if (!answerId || existingIds.has(answerId) || seen.has(answerId)) continue;
    if (item?.author?.url_token !== authorToken) continue;
    seen.add(answerId);
    candidates.push({
      answerId,
      questionTitle: String(item?.question?.title || '').trim(),
      voteup: Number(item?.voteup_count || 0),
    });
  }
  return candidates;
}

export async function writeCollectionReport(directory, report) {
  await mkdir(path.join(directory, 'discovery'), {recursive: true});
  await writeFile(path.join(directory, 'discovery', 'collection-report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
