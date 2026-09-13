import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

class CollectorStop extends Error {
  constructor(message, code) {
    super(message);
    this.name = "CollectorStop";
    this.code = code;
  }
}

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

const authorToken = arg("author", "MarryMea");
if (!/^[A-Za-z0-9_-]{1,100}$/.test(authorToken)) {
  throw new Error("作者 url_token 格式无效。");
}
const mode = arg("mode", arg("sort", "top") === "created" ? "latest" : "top");
if (!["latest", "top", "search"].includes(mode)) {
  throw new Error("--mode 只支持 latest、top 或 search。");
}
const query = arg("query", "");
if (mode === "search" && (!query.trim() || query.length > 100)) {
  throw new Error("--mode search 需要 1 到 100 字符的 --query。");
}
const limit = Number(arg("limit", "40"));
if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
  throw new Error("--limit 必须是 1 到 100 的整数。");
}
const batchSize = Number(arg("batch-size", "30"));
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 30) {
  throw new Error("--batch-size 必须是 1 到 30 的整数（清单协议上限）。");
}
const delayMs = Number(arg("delay-ms", "1500"));
if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60_000) {
  throw new Error("--delay-ms 必须是 0 到 60000 的整数。");
}
const minBody = Number(arg("min-body", "200"));
if (!Number.isInteger(minBody) || minBody < 0) {
  throw new Error("--min-body 必须是非负整数。");
}
const dryRun = flag("dry-run");
const perPage = 20;
const methodLabel = mode === "latest" ? "latest" : mode === "top" ? "top-voteups" : "profile-search";
const sortBy = mode === "latest" ? "created" : "voteups";

function resolveZhurl() {
  const explicit = arg("zhurl") || process.env.ZHURL_BIN;
  if (explicit) return explicit;
  const local = path.join(os.homedir(), ".cargo", "bin", "zhurl.exe");
  return existsSync(local) ? local : "zhurl";
}

const zhurl = resolveZhurl();

function stopIfAuthError(detail) {
  const text = String(detail);
  if (/\b401\b|\b403\b|unauthorized|forbidden|未登录|登录|风控|验证码|安全验证|频繁|限流|rate.?limit/i.test(text)) {
    throw new CollectorStop(`zhurl 认证或限流错误，已停止且不写入任何文件：${text.slice(0, 200)}`, "AUTH_OR_RATE_LIMIT");
  }
}

function callZhurl(url) {
  let raw;
  try {
    raw = execFileSync(zhurl, ["--web", url], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    const detail = String(error.stderr || error.message || "").trim();
    stopIfAuthError(detail);
    throw new Error(`zhurl 调用失败（${url}）：${detail.slice(0, 300)}`);
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error(`zhurl 返回不是 JSON（${url}）：${raw.trim().slice(0, 200)}`);
  }
  if (payload && typeof payload === "object" && payload.error) {
    const detail = JSON.stringify(payload.error).slice(0, 300);
    stopIfAuthError(detail);
    throw new Error(`知乎接口返回错误（${url}）：${detail}`);
  }
  return payload;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…", middot: "·",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
  times: "×", laquo: "«", raquo: "»", copy: "©", reg: "®",
  permil: "‰", deg: "°", plusmn: "±", minus: "−",
};

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-zA-Z]+);/g, (match, name) =>
      Object.hasOwn(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : match,
    );
}

function htmlToText(html) {
  const withoutNoise = String(html).replace(
    /<(script|style|noscript)[\s\S]*?<\/\1>/gi,
    "",
  );
  const withBreaks = withoutNoise
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|blockquote|figcaption|h[1-6]|tr|section|article|pre)>/gi, "\n")
    .replace(/<img[^>]*\balt="([^"]*)"[^>]*>/gi, (_, alt) => (alt ? `[${alt}]` : ""))
    .replace(/<img[^>]*>/gi, "")
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1")
    .replace(/<[^>]+>/g, "");
  const decoded = decodeEntities(withBreaks)
    .replace(/\u200b/g, "")
    .replace(/\r\n?/g, "\n");
  const lines = decoded
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line, index, all) => line || (index > 0 && all[index - 1]));
  return lines.join("\n").trim();
}

function validateAnswerId(value) {
  const answerId = String(value ?? "");
  if (!/^\d+$/.test(answerId)) return "";
  return answerId;
}

function answerSourceUrl(answerId) {
  return `https://www.zhihu.com/answer/${answerId}`;
}

async function listExistingAnswerIds(directory) {
  const ids = new Set();
  if (!existsSync(directory)) return ids;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^batch-\d+$/.test(entry.name)) continue;
    const manifestPath = path.join(directory, entry.name, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    for (const record of manifest.records || []) ids.add(String(record.answerId));
  }
  return ids;
}

function nextBatchIndex(directory) {
  if (!existsSync(directory)) return 1;
  const indexes = readdirSync(directory)
    .filter((name) => /^batch-\d+$/.test(name))
    .map((name) => Number(name.slice("batch-".length)));
  return indexes.length ? Math.max(...indexes) + 1 : 1;
}

const authorDirectory = path.resolve(".data", "author-avatars", authorToken);
const existing = await listExistingAnswerIds(authorDirectory);

console.log(`author=${authorToken} mode=${methodLabel} existing=${existing.size} limit=${limit}`);

const candidates = [];
const seenCandidateIds = new Set();

async function listAnswerPage(offset) {
  const url = `https://www.zhihu.com/api/v4/members/${authorToken}/answers?sort_by=${sortBy}&offset=${offset}&limit=${perPage}`;
  const page = callZhurl(url);
  const items = Array.isArray(page.data) ? page.data : [];
  return { items, isEnd: Boolean(page.paging?.is_end) };
}

async function listSearchPage(offset) {
  const url = `https://www.zhihu.com/api/v4/search_v3?t=general&q=${encodeURIComponent(query)}&correction=1&offset=${offset}&limit=${perPage}&filter_fields=&lc_idx=0&show_all_topics=0`;
  const page = callZhurl(url);
  const items = (Array.isArray(page.data) ? page.data : [])
    .map((entry) => entry?.object)
    .filter((object) => object && object.type === "answer")
    .filter((object) => object?.author?.url_token === authorToken)
    .map((object) => ({
      id: object.id,
      question: object.question,
      voteup_count: object.voteup_count,
    }));
  return { items, isEnd: Boolean(page.paging?.is_end) };
}

for (let offset = 0; offset < limit * 2; offset += perPage) {
  const page = mode === "search" ? await listSearchPage(offset) : await listAnswerPage(offset);
  if (!page.items.length) {
    if (page.isEnd) break;
    if (offset === 0) throw new CollectorStop("列表接口没有返回任何条目，已停止且不写入文件。", "EMPTY_LIST");
    break;
  }
  for (const item of page.items) {
    const answerId = validateAnswerId(item.id);
    if (!answerId || existing.has(answerId) || seenCandidateIds.has(answerId)) continue;
    seenCandidateIds.add(answerId);
    candidates.push({
      answerId,
      questionTitle: String(item.question?.title || "").trim(),
      voteup: Number(item.voteup_count || 0),
    });
    if (candidates.length >= limit) break;
  }
  console.log(`listed offset=${offset} got=${page.items.length} candidates=${candidates.length}`);
  if (page.isEnd || candidates.length >= limit) break;
  await sleep(delayMs);
}

if (dryRun) {
  for (const item of candidates) {
    console.log(`${item.answerId}\tvoteups=${item.voteup}\t${item.questionTitle}`);
  }
  console.log(`dry-run: ${candidates.length} candidates, no files written`);
  process.exit(0);
}

const records = [];
const skipped = [];
const include = "content,excerpt,paid_info,voteup_count,comment_count,created_time,updated_time,question,author";
for (const [index, candidate] of candidates.entries()) {
  const detail = callZhurl(
    `https://www.zhihu.com/api/v4/answers/${candidate.answerId}?include=${include}`,
  );
  if (detail?.paid_info?.is_paid) {
    skipped.push({ answerId: candidate.answerId, reason: "paid" });
    console.log(`skip paid ${candidate.answerId}`);
    await sleep(delayMs);
    continue;
  }
  if (detail?.author?.url_token !== authorToken) {
    skipped.push({ answerId: candidate.answerId, reason: "author-mismatch" });
    console.log(`skip author-mismatch ${candidate.answerId}`);
    await sleep(delayMs);
    continue;
  }
  const authorName = String(detail.author?.name || "").trim();
  if (!authorName) {
    skipped.push({ answerId: candidate.answerId, reason: "author-name-missing" });
    console.log(`skip author-name-missing ${candidate.answerId}`);
    await sleep(delayMs);
    continue;
  }
  const body = htmlToText(detail.content || "");
  if (body.length < minBody || body.length > 100_000) {
    skipped.push({ answerId: candidate.answerId, reason: `body-length-${body.length}` });
    console.log(`skip body-length ${candidate.answerId} len=${body.length}`);
    await sleep(delayMs);
    continue;
  }
  const questionTitle = String(detail.question?.title || candidate.questionTitle).trim();
  if (!questionTitle) {
    skipped.push({ answerId: candidate.answerId, reason: "question-title-missing" });
    console.log(`skip question-title-missing ${candidate.answerId}`);
    await sleep(delayMs);
    continue;
  }
  const answer = {
    answerId: candidate.answerId,
    authorName,
    authorUrlToken: authorToken,
    authorProfileUrl: `https://www.zhihu.com/people/${authorToken}`,
    questionTitle: questionTitle.slice(0, 500),
    sourceUrl: answerSourceUrl(candidate.answerId),
    body,
    completeness: "fetched_api_content_unverified",
  };
  const inputFile = `answer-${candidate.answerId}.json`;
  const raw = Buffer.from(`${JSON.stringify(answer, null, 2)}\n`, "utf8");
  records.push({
    answerId: candidate.answerId,
    inputFile,
    sha256: createHash("sha256").update(raw).digest("hex"),
    raw,
    voteupCount: Number(detail.voteup_count || candidate.voteup || 0),
    createdTime: Number(detail.created_time || 0),
    updatedTime: Number(detail.updated_time || 0),
  });
  console.log(`fetched ${index + 1}/${candidates.length} ${candidate.answerId} len=${body.length}`);
  await sleep(delayMs);
}

if (!records.length) {
  console.log("没有可写入的回答（可能均已采集或全部被过滤）。");
  process.exit(0);
}

const collectedAt = new Date().toISOString();
let batchIndex = nextBatchIndex(authorDirectory);
let batchRecords = [];
let batchBytes = 0;
const writtenBatches = [];

async function flushBatch() {
  if (!batchRecords.length) return;
  const batchId = `batch-${String(batchIndex).padStart(3, "0")}`;
  const finalDirectory = path.join(authorDirectory, batchId);
  const stagingDirectory = path.join(authorDirectory, `.${batchId}.staging`);
  await rm(stagingDirectory, { recursive: true, force: true });
  await mkdir(stagingDirectory, { recursive: true });
  for (const record of batchRecords) {
    await writeFile(path.join(stagingDirectory, record.inputFile), record.raw);
  }
  const manifest = {
    schemaVersion: 1,
    batchId,
    authorUrlToken: authorToken,
    recordCount: batchRecords.length,
    source: "zhurl-web-api",
    collectedAt,
    collection: {
      method: methodLabel,
      query: mode === "search" ? query : null,
      sort: sortBy,
      collectedAt,
      completeness: "fetched_api_content_unverified",
      note: "接口正文未与在线网页逐项比对。",
    },
    records: batchRecords.map((record) => ({
      answerId: record.answerId,
      inputFile: record.inputFile,
      sha256: record.sha256,
    })),
  };
  await writeFile(
    path.join(stagingDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await rename(stagingDirectory, finalDirectory);
  writtenBatches.push({ batchId, recordCount: batchRecords.length });
  console.log(`wrote ${batchId}: ${batchRecords.length} records`);
  batchIndex += 1;
  batchRecords = [];
  batchBytes = 0;
}

for (const record of records) {
  const size = record.raw.length;
  if (batchRecords.length >= batchSize || batchBytes + size > 480_000) await flushBatch();
  batchRecords.push(record);
  batchBytes += size;
}
await flushBatch();

await mkdir(path.join(authorDirectory, "discovery"), { recursive: true });
await writeFile(
  path.join(authorDirectory, "discovery", "collection-report.json"),
  `${JSON.stringify({
    authorToken,
    collectedAt,
    method: methodLabel,
    query: mode === "search" ? query : null,
    sort: sortBy,
    requested: limit,
    fetched: records.length,
    skipped,
    batches: writtenBatches,
    notes: ["接口正文未与在线网页逐项比对，完整性标记为 fetched_api_content_unverified。"],
    answers: records.map((record) => ({
      answerId: record.answerId,
      voteupCount: record.voteupCount,
      createdTime: record.createdTime,
      updatedTime: record.updatedTime,
    })),
  }, null, 2)}\n`,
);
console.log(`done: ${records.length} answers written, ${skipped.length} skipped`);
