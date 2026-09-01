// 阶段 1：解析与清洗（TXT → 标准文本 + 章节索引）
// 只处理 rights ∈ {public_domain, internal_eval_only} 的 txt；PDF/MOBI 仅登记元数据不提取。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LOCALDATA = path.join(root, "localdata");
const RAW_DIR = path.join(root, "narrative-kb", "data", "raw");
const TMP_DIR = path.join(root, "narrative-kb", "data", "tmp");

const inventory = JSON.parse(fs.readFileSync(path.join(TMP_DIR, "inventory.json"), "utf8")).entries;

// 稳定 id：src-01 …，按文件名排序
const ids = new Map();
inventory.forEach((entry, index) => ids.set(entry.file, `src-${String(index + 1).padStart(2, "0")}`));

const CHAPTER_RE = /第\s*[一二三四五六七八九十百千万0-9０-９]+\s*[章回节部卷][^\n]{0,40}/g;

function clean(raw) {
  let text = raw.replace(/^\uFEFF/, "");
  text = text.replace(/\r\n?/g, "\n");
  text = text.replace(/\u0000/g, "");
  // 合并连续 3+ 空行为 2 个
  text = text.replace(/\n{3,}/g, "\n\n");
  // 去掉常见站点头尾杂质（保留证据；保守处理）
  text = text.trim();
  return text;
}

function buildChapterIndex(text) {
  const chapters = [];
  let first = true;
  let match;
  CHAPTER_RE.lastIndex = 0;
  while ((match = CHAPTER_RE.exec(text)) !== null) {
    if (first) {
      if (match.index > 0) chapters.push({ title: "前言", start: 0, end: match.index });
      first = false;
    }
    const title = match[0].replace(/\s+/g, " ").slice(0, 40);
    chapters.push({ title, start: match.index, end: null });
  }
  if (chapters.length === 0) {
    chapters.push({ title: "全文", start: 0, end: null });
  }
  for (let i = 0; i < chapters.length - 1; i++) {
    if (chapters[i].end === null) chapters[i].end = chapters[i + 1].start;
  }
  chapters[chapters.length - 1].end = text.length;
  return chapters;
}

function main() {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const sources = [];
  const chapterIndex = [];
  let parsed = 0;
  let skipped = 0;

  for (const entry of inventory) {
    const id = ids.get(entry.file);
    const title = entry.file.replace(/\.[^.]+$/, "");
    if (entry.ext === "mobi") {
      sources.push({ id, file: entry.file, title, ext: "mobi", rights: entry.rights, ingestStatus: "skipped", skipReason: entry.skipReason });
      skipped++;
      continue;
    }
    if (entry.ext === "pdf") {
      sources.push({ id, file: entry.file, title, ext: "pdf", rights: entry.rights, ingestStatus: "discovered", note: "保护期/未授权，仅登记元数据" });
      skipped++;
      continue;
    }
    // txt
    try {
      const raw = fs.readFileSync(path.join(LOCALDATA, entry.file));
      const text = clean(new TextDecoder(entry.encoding === "utf-8-sig" ? "utf-8" : entry.encoding, { fatal: false }).decode(raw));
      if (text.length < 200) throw new Error("清洗后文本过短");
      const chapters = buildChapterIndex(text);
      fs.writeFileSync(path.join(RAW_DIR, `${id}.txt`), text);
      sources.push({ id, file: entry.file, title, ext: "txt", rights: entry.rights, ragAllowed: entry.ragAllowed, ingestStatus: "ready", chars: text.length, chapters: chapters.length });
      chapterIndex.push({ sourceId: id, title, chapters: chapters.map((c) => ({ title: c.title, start: c.start, end: c.end })) });
      parsed++;
    } catch (err) {
      sources.push({ id, file: entry.file, title, ext: "txt", rights: entry.rights, ingestStatus: "skipped", skipReason: err.message });
      skipped++;
      console.error(`SKIP ${entry.file}: ${err.message}`);
    }
  }

  fs.writeFileSync(path.join(TMP_DIR, "sources.json"), JSON.stringify(sources, null, 2));
  fs.writeFileSync(path.join(TMP_DIR, "chapter-index.json"), JSON.stringify(chapterIndex, null, 2));
  console.log(`解析完成：txt 成功 ${parsed} / 跳过 ${skipped}；sources.json + chapter-index.json 已写入`);
}

main();
