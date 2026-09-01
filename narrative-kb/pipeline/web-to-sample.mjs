// 开源数据 → 抽样集：维基文库鲁迅《狂人日记》《故乡》（公版，Tier A）
// 解析 HTML → 纯文本 → 追加到 sample.jsonl，供后续 LLM 抽取。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TMP = path.join(root, "narrative-kb", "data", "tmp");

function htmlToText(html) {
  let text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>|<\/div>|<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  text = text.replace(/\u3000/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return text;
}

const pages = [
  {
    sourceId: "web-01",
    title: "鲁迅《狂人日记》",
    author: "鲁迅",
    uri: "https://zh.wikisource.org/wiki/%E7%8B%82%E4%BA%BA%E6%97%A5%E8%A8%98",
    file: "wk-kr3.json",
  },
  {
    sourceId: "web-02",
    title: "鲁迅《故乡》",
    author: "鲁迅",
    uri: "https://zh.wikisource.org/wiki/%E6%95%85%E9%84%89",
    file: "wk-gx3.json",
  },
];

function main() {
  const samplePath = path.join(TMP, "sample.jsonl");
  const existing = fs.existsSync(samplePath)
    ? fs.readFileSync(samplePath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : [];
  const existingKeys = new Set(existing.map((entry) => `${entry.sourceId}#${entry.chapterIndex}`));
  const added = [];

  for (const page of pages) {
    const data = JSON.parse(fs.readFileSync(path.join(TMP, "web", page.file), "utf8"));
    const html = data.parse?.text?.["*"] ?? "";
    const text = htmlToText(html);
    if (text.length < 500) {
      console.log(`SKIP ${page.title}：文本过短 ${text.length}`);
      continue;
    }
    // 长文按 2000 字切段（与 extract 的 MAX_CHAPTER_CHARS 对齐）
    const segments = [];
    for (let i = 0; i < text.length; i += 2000) segments.push(text.slice(i, i + 2000));
    segments.forEach((segment, index) => {
      const key = `${page.sourceId}#${index}`;
      if (existingKeys.has(key)) return;
      existing.push({
        sourceId: page.sourceId,
        title: page.title,
        chapterTitle: segments.length > 1 ? `第 ${index + 1} 段` : "全文",
        chapterIndex: index,
        chars: segment.length,
        text: segment,
      });
      added.push(key);
    });
  }

  fs.writeFileSync(samplePath, existing.map((entry) => JSON.stringify(entry)).join("\n"));
  console.log(`追加网络语料：${added.length} 段（${pages.map((p) => p.title).join("、")}）`);
}

main();
