// 阶段 2：事件抽样切分（Event Based Sampling）
// 不做固定字数切全本；按「开头 + 均匀中段 + 结尾 + 随机」抽样代表性章节，
// 每章文本上限 MAX_CHARS（默认 5000），供 LLM 抽取事件（每章一次调用返回 1-5 个事件）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RAW_DIR = path.join(root, "narrative-kb", "data", "raw");
const TMP_DIR = path.join(root, "narrative-kb", "data", "tmp");

const SAMPLE_CHAPTERS = Number(process.env.SAMPLE_CHAPTERS || 10);
const MAX_CHARS = Number(process.env.MAX_CHAPTER_CHARS || 5000);

function pickChapters(total) {
  if (total <= SAMPLE_CHAPTERS) return Array.from({ length: total }, (_, i) => i);
  const picks = new Set();
  // 开头
  for (let i = 0; i < 3 && i < total; i++) picks.add(i);
  // 结尾
  for (let i = total - 2; i < total; i++) if (i >= 0) picks.add(i);
  // 均匀中段
  const remaining = SAMPLE_CHAPTERS - picks.size;
  if (remaining > 0 && total - picks.size > 0) {
    const middle = Array.from({ length: total }, (_, i) => i).filter((i) => !picks.has(i));
    const step = middle.length / remaining;
    for (let k = 0; k < remaining; k++) picks.add(middle[Math.min(middle.length - 1, Math.floor(k * step))]);
  }
  // 随机补足
  while (picks.size < Math.min(SAMPLE_CHAPTERS, total)) {
    const idx = Math.floor(Math.random() * total);
    picks.add(idx);
  }
  return Array.from(picks).sort((a, b) => a - b);
}

function main() {
  const sources = JSON.parse(fs.readFileSync(path.join(TMP_DIR, "sources.json"), "utf8"));
  const chapterIndex = JSON.parse(fs.readFileSync(path.join(TMP_DIR, "chapter-index.json"), "utf8"));
  const ready = sources.filter((s) => s.ingestStatus === "ready");
  const out = [];
  let totalChapters = 0;
  let totalChars = 0;

  for (const source of ready) {
    const idxEntry = chapterIndex.find((c) => c.sourceId === source.id);
    if (!idxEntry) continue;
    const text = fs.readFileSync(path.join(RAW_DIR, `${source.id}.txt`), "utf8");
    const chapters = idxEntry.chapters;
    const picks = pickChapters(chapters.length);
    for (const ci of picks) {
      const chapter = chapters[ci];
      const slice = text.slice(chapter.start, chapter.end).trim();
      if (slice.length < 150) continue;
      const capped = slice.slice(0, MAX_CHARS);
      out.push({
        sourceId: source.id,
        title: source.title,
        chapterTitle: chapter.title,
        chapterIndex: ci,
        chars: capped.length,
        text: capped,
      });
      totalChapters++;
      totalChars += capped.length;
    }
  }

  fs.writeFileSync(path.join(TMP_DIR, "sample.jsonl"), out.map((entry) => JSON.stringify(entry)).join("\n"));
  console.log(`抽样完成：${ready.length} 个文本 → ${out.length} 章样本（${Math.round(totalChars / 1000)}K 字符）`);
  console.log(`预计 LLM 调用：${out.length} 次（每章 1 次，返回 1-5 个事件）`);
}

main();
