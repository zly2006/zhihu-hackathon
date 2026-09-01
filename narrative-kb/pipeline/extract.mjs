// 阶段 3：LLM 结构化抽取（DeepSeek，每章 1 次调用，返回 1-5 个事件）
// 断点续跑：已完成章节写入 checkpoint，重复运行自动跳过。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TMP_DIR = path.join(root, "narrative-kb", "data", "tmp");
const SAMPLE = path.join(TMP_DIR, "sample.jsonl");
const PROMPT_FILE = path.join(root, "narrative-kb", "prompts", "narrative_extract.md");
const CHECKPOINT = path.join(TMP_DIR, "extract-checkpoint.json");
const OUT = path.join(TMP_DIR, "fragments.jsonl");

const env = loadEnv();
const ENDPOINT = env.DEEPSEEK_ENDPOINT || "https://api.deepseek.com/chat/completions";
const API_KEY = env.DEEPSEEK_API_KEY;
const MODEL = env.DEEPSEEK_MODEL || "deepseek-chat";

if (!API_KEY) {
  console.error("缺少 DEEPSEEK_API_KEY");
  process.exit(1);
}

const systemPrompt = fs.readFileSync(PROMPT_FILE, "utf8");

async function callLlm(text) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ],
        temperature: 0.4,
        max_tokens: 3000,
        response_format: { type: "json_object" },
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status} ${body.slice(0, 200)}`);
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    return parseJson(content);
  } finally {
    clearTimeout(timer);
  }
}

function isSkippable(sample) {
  // 前言/作者简介类短章不含可抽取的人生事件
  return (sample.chapterTitle === "前言" || sample.chapterTitle.includes("作者简介")) && sample.chars < 800;
}

function parseJson(content) {
  let cleaned = content.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const parsed = JSON.parse(cleaned);
  if (Array.isArray(parsed)) return { fragments: parsed };
  if (parsed && Array.isArray(parsed.fragments)) return parsed;
  throw new Error("JSON 缺少 fragments 数组");
}

function loadCheckpoint() {
  if (fs.existsSync(CHECKPOINT)) return JSON.parse(fs.readFileSync(CHECKPOINT, "utf8"));
  return { done: [], results: [] };
}

function saveCheckpoint(checkpoint) {
  fs.writeFileSync(CHECKPOINT, JSON.stringify(checkpoint, null, 1));
}

async function main() {
  const samples = fs.readFileSync(SAMPLE, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const checkpoint = loadCheckpoint();
  const doneKeys = new Set(checkpoint.done);
  const pending = samples.filter(
    (sample) => !doneKeys.has(`${sample.sourceId}#${sample.chapterIndex}`) && !isSkippable(sample),
  );
  console.log(`待抽取：${pending.length} 章（已完成 ${checkpoint.done.length}，跳过前言短章）`);

  let ok = 0;
  let fail = 0;
  for (let i = 0; i < pending.length; i++) {
    const sample = pending[i];
    const key = `${sample.sourceId}#${sample.chapterIndex}`;
    const userText = `文本标题：${sample.title}\n章节：${sample.chapterTitle}\n\n${sample.text}`;
    let fragments = null;
    let lastError = "";
    for (let attempt = 0; attempt < 3 && !fragments; attempt++) {
      try {
        fragments = (await callLlm(userText)).fragments;
      } catch (err) {
        lastError = err.message;
        await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
      }
    }
    if (!fragments) {
      fail++;
      console.error(`FAIL ${key}: ${lastError}`);
    } else {
      const records = fragments.map((fragment) =>
        JSON.stringify({
          fragment,
          sourceId: sample.sourceId,
          title: sample.title,
          chapterTitle: sample.chapterTitle,
          chapterIndex: sample.chapterIndex,
          excerpt: sample.text.slice(0, 260),
        }),
      );
      fs.appendFileSync(OUT, records.join("\n") + (records.length ? "\n" : ""));
      ok += fragments.length;
    }
    checkpoint.done.push(key);
    if ((i + 1) % 5 === 0) saveCheckpoint(checkpoint);
    if ((i + 1) % 5 === 0) console.log(`进度 ${i + 1}/${pending.length}，累计事件 ${ok}，失败 ${fail}`);
  }
  saveCheckpoint(checkpoint);
  console.log(`抽取完成：事件 ${ok}，失败章节 ${fail}（断点已保存，可续跑）`);
}

main().catch((err) => {
  console.error("抽取中断：", err.message);
  process.exit(1);
});
