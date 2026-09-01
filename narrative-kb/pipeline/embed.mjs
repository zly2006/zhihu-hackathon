// 阶段 5：本地词法向量（v0）——字符二元组哈希袋 + L2 归一化
// 固定维度（默认 8192），查询与索引使用同一哈希映射，天然对齐、零依赖。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TMP = path.join(root, "narrative-kb", "data", "tmp");
const OUT = path.join(TMP, "embeddings.jsonl");

export const VECTOR_DIM = 8192;

export function tokenize(text) {
  const tokens = [];
  const clean = String(text).toLowerCase();
  for (let i = 0; i < clean.length - 1; i++) {
    const pair = clean.slice(i, i + 2);
    if (/[\u4e00-\u9fff]/.test(pair)) tokens.push(pair);
  }
  for (const word of clean.match(/[a-z0-9_]{2,}/g) || []) tokens.push(word);
  return tokens;
}

export function hashToDim(token, dim = VECTOR_DIM) {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % dim;
}

export function buildVector(tokens, dim = VECTOR_DIM) {
  const vec = new Array(dim).fill(0);
  for (const token of tokens) vec[hashToDim(token, dim)]++;
  let norm = 0;
  for (const value of vec) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  return vec.map((value) => value / norm);
}

function composeFragmentText(fragment) {
  const parts = [
    fragment.event || "",
    fragment.scene_type || "",
    fragment.conflict_type || "",
    fragment.life_stage || "",
    Array.isArray(fragment.tags) ? fragment.tags.join(" ") : "",
    fragment.transferable_rule || "",
    fragment.excerpt || "",
  ];
  if (fragment.emotion_curve) {
    const curve = fragment.emotion_curve;
    parts.push([...(curve.start || []), ...(curve.peak || []), ...(curve.end || [])].join(" "));
  }
  return parts.join(" ");
}

function main() {
  const lines = fs.readFileSync(path.join(TMP, "fragments.jsonl"), "utf8").split("\n").filter(Boolean);
  const records = lines.map((line) => JSON.parse(line));
  if (records.length === 0) {
    console.error("fragments.jsonl 为空，先运行 extract.mjs");
    process.exit(1);
  }

  const out = records.map((record, index) =>
    JSON.stringify({
      id: `emb-${index}`,
      fragmentId: record.fragmentId || `frag-${index}`,
      embeddingType: "lexical",
      vector: buildVector(tokenize(composeFragmentText(record.fragment))),
      model: "local-char-bigram-hash",
      version: "v0.2",
    }),
  );

  fs.writeFileSync(OUT, out.join("\n"));
  console.log(`向量化完成：${out.length} 条，维度 ${VECTOR_DIM} → embeddings.jsonl`);
}

if (process.argv[1] && process.argv[1].endsWith("embed.mjs")) {
  main();
}
