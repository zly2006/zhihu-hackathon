// Narrative KB 查询适配器（V1.1 游戏侧）
// 直接读取 narrative-kb/data/narrative-kb.sqlite（只读），复用与 KB 管线一致的
// 字符二元组哈希袋向量（8192 维 + L2 归一化 + 余弦）。
// 故障降级：DB 缺失/损坏/查询失败 → 返回空结果并给出原因，绝不抛出（验收：KB 故障有 fallback）。
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export const VECTOR_DIM = 8192;

type FragmentRow = {
  fragment_id: string;
  source_id: string;
  source_title: string;
  scene_type: string;
  conflict_type: string;
  life_stage: string;
  emotion_curve: string;
  relationship_effect: string;
  tags: string;
  transferable_rule: string;
  excerpt: string;
  quality_score: number;
  vector: number[];
  similarity: number;
};

function resolveDbPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "narrative-kb", "data", "narrative-kb.sqlite"),
    path.resolve(__dirname, "../../narrative-kb/data/narrative-kb.sqlite"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const clean = String(text).toLowerCase();
  for (let i = 0; i < clean.length - 1; i++) {
    const pair = clean.slice(i, i + 2);
    if (/[\u4e00-\u9fff]/.test(pair)) tokens.push(pair);
  }
  for (const word of clean.match(/[a-z0-9_]{2,}/g) || []) tokens.push(word);
  return tokens;
}

export function hashToDim(token: string, dim = VECTOR_DIM): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % dim;
}

export function buildQueryVector(tokens: string[], dim = VECTOR_DIM): number[] {
  const vec = new Array(dim).fill(0);
  for (const token of tokens) vec[hashToDim(token, dim)]++;
  let norm = 0;
  for (const value of vec) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  return vec.map((value) => value / norm);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

export type RetrievalResult = {
  available: boolean;
  reason?: string;
  rows: FragmentRow[];
};

export function searchFragments(args: {
  query: string;
  stage?: string;
  sceneTypes?: string[];
  limit?: number;
}): RetrievalResult {
  const dbPath = resolveDbPath();
  if (!dbPath) {
    return { available: false, reason: "Narrative KB 数据库文件不存在", rows: [] };
  }
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    if (args.stage) {
      conditions.push("f.life_stage = ?");
      params.push(args.stage);
    }
    if (args.sceneTypes?.length) {
      conditions.push(`f.scene_type IN (${args.sceneTypes.map(() => "?").join(",")})`);
      params.push(...args.sceneTypes);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = db
      .prepare(
        `SELECT f.id AS fragment_id, s.id AS source_id, s.title AS source_title,
                f.scene_type, f.conflict_type, f.life_stage, f.emotion_curve, f.relationship_effect,
                f.tags, f.transferable_rule, f.excerpt, f.quality_score, e.vector
         FROM narrative_fragment f
         JOIN source_document s ON s.id = f.source_document_id
         JOIN embeddings e ON e.fragment_id = f.id AND e.embedding_type = 'lexical'
         ${where}`,
      )
      .all(...params) as Array<Omit<FragmentRow, "vector" | "similarity"> & { vector: string }>;

    const queryVec = buildQueryVector(tokenize(args.query));
    const scored = rows
      .map((row) => {
        const vector = JSON.parse(row.vector) as number[];
        return { ...row, vector, similarity: cosine(queryVec, vector) };
      })
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, args.limit ?? 8);
    db.close();
    return { available: true, rows: scored };
  } catch (error) {
    return {
      available: false,
      reason: `Narrative KB 查询失败：${error instanceof Error ? error.message : String(error)}`,
      rows: [],
    };
  }
}
