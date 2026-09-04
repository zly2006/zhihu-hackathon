// Narrative KB 查询适配器（V1.1 游戏侧）
// 直接读取 narrative-kb/data/narrative-kb.sqlite（只读），复用与 KB 管线一致的
// 字符二元组哈希袋向量（8192 维 + L2 归一化 + 余弦）。
// 故障降级：DB 缺失/损坏/查询失败 → 返回空结果并给出原因，绝不抛出（验收：KB 故障有 fallback）。
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import type { NarrativeCharacterArcPattern, NarrativeChoicePattern } from "../domain/narrative";

export const VECTOR_DIM = 8192;

type FragmentDbRow = {
  fragment_id: string;
  source_id: string;
  source_title: string;
  event: string;
  scene_type: string;
  conflict_type: string;
  life_stage: string;
  emotion_curve: string;
  relationship_effect: string;
  tags: string;
  transferable_rule: string;
  excerpt: string;
  quality_score: number;
  rights_status: string;
  rag_allowed: number;
  quote_allowed: number;
  vector: string;
};

type FragmentRow = Omit<FragmentDbRow, "vector" | "rights_status" | "rag_allowed" | "quote_allowed"> & {
  rightsStatus: string;
  ragAllowed: number;
  quoteAllowed: number;
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
    const conditions: string[] = ["s.rag_allowed = 1"];
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
                f.event, f.scene_type, f.conflict_type, f.life_stage, f.emotion_curve, f.relationship_effect,
                f.tags, f.transferable_rule, f.excerpt, f.quality_score,
                s.rights_status, s.rag_allowed, s.quote_allowed, e.vector
         FROM narrative_fragment f
         JOIN source_document s ON s.id = f.source_document_id
         JOIN embeddings e ON e.fragment_id = f.id AND e.embedding_type = 'lexical'
         ${where}`,
      )
      .all(...params) as FragmentDbRow[];

    const queryVec = buildQueryVector(tokenize(args.query));
    const scored = rows
      .map((row) => {
        const vector = JSON.parse(row.vector) as number[];
        return {
          ...row,
          rightsStatus: row.rights_status,
          ragAllowed: Number(row.rag_allowed),
          quoteAllowed: Number(row.quote_allowed),
          vector,
          similarity: cosine(queryVec, vector),
        };
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

type ChoicePatternDbRow = {
  id: string;
  type: string | null;
  options: string | null;
  effects: string | null;
  fragment_id: string;
  source_id: string;
};

type CharacterArcDbRow = {
  id: string;
  stage: string | null;
  state_before: string | null;
  state_after: string | null;
  fragment_id: string;
  source_id: string;
};

export type NarrativePatternResult = {
  available: boolean;
  reason?: string;
  choicePatterns: NarrativeChoicePattern[];
  characterArcPatterns: NarrativeCharacterArcPattern[];
};

const MAX_PATTERN_TEXT = 180;

function boundedText(value: unknown, maximum = MAX_PATTERN_TEXT): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseOptions(value: unknown): string[] {
  const parsed = parseJson(value);
  const items = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  return items
    .map((item) => {
      if (typeof item === "string") return boundedText(item, 100);
      if (item && typeof item === "object" && "label" in item) {
        return boundedText((item as { label?: unknown }).label, 100);
      }
      return "";
    })
    .filter(Boolean)
    .slice(0, 3);
}

function parseEffects(value: unknown): Record<string, unknown> {
  const parsed = parseJson(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const safeValue = (item: unknown): unknown => {
    if (item === null || typeof item === "number" || typeof item === "boolean") return item;
    if (typeof item === "string") return boundedText(item, 160);
    try {
      return JSON.stringify(item).slice(0, 160);
    } catch {
      return "";
    }
  };
  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>)
      .slice(0, 8)
      .map(([key, item]) => [boundedText(key, 60), safeValue(item)])
      .filter(([key]) => Boolean(key)),
  );
}

function scoreFor(fragmentId: string, similarityByFragmentId: Record<string, number>): number {
  const score = similarityByFragmentId[fragmentId];
  return typeof score === "number" && Number.isFinite(score) ? Math.round(score * 1000) / 1000 : 0;
}

export function loadNarrativePatterns(
  fragmentIds: string[],
  similarityByFragmentId: Record<string, number> = {},
): NarrativePatternResult {
  const ids = [...new Set(fragmentIds.filter((id) => typeof id === "string" && id.trim()))].slice(0, 64);
  if (!ids.length) {
    return { available: true, choicePatterns: [], characterArcPatterns: [] };
  }
  const dbPath = resolveDbPath();
  if (!dbPath) {
    return {
      available: false,
      reason: "Narrative KB 数据库文件不存在",
      choicePatterns: [],
      characterArcPatterns: [],
    };
  }
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const placeholders = ids.map(() => "?").join(",");
    const choiceRows = db
      .prepare(
        `SELECT p.id, p.type, p.options, p.effects, p.fragment_id, s.id AS source_id
         FROM choice_pattern p
         JOIN narrative_fragment f ON f.id = p.fragment_id
         JOIN source_document s ON s.id = f.source_document_id
         WHERE s.rag_allowed = 1 AND p.fragment_id IN (${placeholders})`,
      )
      .all(...ids) as ChoicePatternDbRow[];
    const arcRows = db
      .prepare(
        `SELECT a.id, a.stage, a.state_before, a.state_after, a.fragment_id, s.id AS source_id
         FROM character_arc a
         JOIN narrative_fragment f ON f.id = a.fragment_id
         JOIN source_document s ON s.id = f.source_document_id
         WHERE s.rag_allowed = 1 AND a.fragment_id IN (${placeholders})`,
      )
      .all(...ids) as CharacterArcDbRow[];
    db.close();

    const choicePatterns = choiceRows
      .map((row) => ({
        id: row.id,
        fragmentId: row.fragment_id,
        type: boundedText(row.type, 80) || "其他",
        options: parseOptions(row.options),
        effects: parseEffects(row.effects),
        sourceId: row.source_id,
        similarity: scoreFor(row.fragment_id, similarityByFragmentId),
      }))
      .filter((pattern) => pattern.options.length > 0)
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, 24);
    const characterArcPatterns = arcRows
      .map((row) => ({
        id: row.id,
        fragmentId: row.fragment_id,
        stage: boundedText(row.stage, 80) || "未标注阶段",
        stateBefore: boundedText(row.state_before),
        stateAfter: boundedText(row.state_after),
        sourceId: row.source_id,
        similarity: scoreFor(row.fragment_id, similarityByFragmentId),
      }))
      .filter((pattern) => pattern.stateBefore || pattern.stateAfter)
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, 24);
    return { available: true, choicePatterns, characterArcPatterns };
  } catch (error) {
    return {
      available: false,
      reason: `Narrative KB 结构模式查询失败：${error instanceof Error ? error.message : String(error)}`,
      choicePatterns: [],
      characterArcPatterns: [],
    };
  }
}
