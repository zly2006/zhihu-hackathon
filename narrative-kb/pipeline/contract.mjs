// Narrative KB 服务契约（v0 数据侧落地，对齐《执行说明书》§11 两个端点）
// 本模块 = 检索能力的契约化封装：游戏侧（阶段 3 query adapter）按此输入输出接入，
// 后续 narrative-kb 独立 FastAPI 服务化时，路由层直接映射到这两个函数。
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tokenize, buildVector } from "./embed.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DB_PATH = path.join(root, "narrative-kb", "data", "narrative-kb.sqlite");

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export function retrieveFragments(query, { stage, limit = 5 } = {}) {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const rows = db
    .prepare(
      `SELECT e.fragment_id, e.vector, f.event, f.scene_type, f.conflict_type, f.life_stage,
              f.emotion_curve, f.relationship_effect, f.choices, f.tags, f.transferable_rule, f.excerpt,
              f.quality_score, s.title, s.rights_status, s.rag_allowed, s.quote_allowed
       FROM embeddings e
       JOIN narrative_fragment f ON f.id = e.fragment_id
       JOIN source_document s ON s.id = f.source_document_id
       WHERE s.rag_allowed = 1${stage ? " AND f.life_stage = ?" : ""}`,
    )
    .all(...(stage ? [stage] : []));

  const dim = rows.length ? JSON.parse(rows[0].vector).length : 0;
  const queryVec = buildVector(tokenize(query), dim || undefined);
  const results = rows
    .map((row) => ({ ...row, vector: JSON.parse(row.vector), score: 0 }))
    .map((row) => {
      row.score = cosine(queryVec, row.vector);
      return row;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ vector, ...rest }) => rest);
  db.close();
  return results;
}

function aggregateChoicePatterns(results) {
  const seen = new Set();
  const patterns = [];
  for (const result of results) {
    let choices = [];
    try {
      choices = JSON.parse(result.choices || "[]");
    } catch {
      choices = [];
    }
    for (const choice of choices) {
      const key = `${choice.type}|${choice.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      patterns.push({ type: choice.type || "其他", label: choice.label, source: result.title });
      if (patterns.length >= 5) return patterns;
    }
  }
  return patterns;
}

function aggregateEmotionCurve(results) {
  const start = [];
  const peak = [];
  const end = [];
  const curves = [];
  for (const result of results) {
    let curve = null;
    try {
      curve = JSON.parse(result.emotion_curve || "{}");
    } catch {
      curve = {};
    }
    for (const item of curve.start || []) if (!start.includes(item)) start.push(item);
    for (const item of curve.peak || []) if (!peak.includes(item)) peak.push(item);
    for (const item of curve.end || []) if (!end.includes(item)) end.push(item);
    if (curve.curve) curves.push(curve.curve);
    if (start.length >= 6 || peak.length >= 6 || end.length >= 6) break;
  }
  const top = (list) => {
    const counts = {};
    for (const item of list) counts[item] = (counts[item] || 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([item]) => item);
  };
  return { start: top(start), peak: top(peak), end: top(end), curve: top(curves)[0] || "mixed" };
}

// API 1：查询叙事素材（POST /api/narrative/search）——输入 {event, stage}
export function narrativeSearch({ event, stage, limit = 5 } = {}) {
  const results = retrieveFragments(event, { stage, limit });
  const scenePattern = results.slice(0, 3).map((result) => ({
    scene_type: result.scene_type,
    conflict_type: result.conflict_type,
    life_stage: result.life_stage,
    event: result.event,
    transferable_rule: result.transferable_rule,
    source: result.title,
    score: Math.round(result.score * 100) / 100,
  }));
  return {
    querySummary: { event, stage: stage ?? null, total: results.length },
    scene_pattern: scenePattern,
    choice_pattern: aggregateChoicePatterns(results),
    emotion_curve: aggregateEmotionCurve(results),
  };
}

// API 2：生成 Scene 参考（POST /api/narrative/scene）——输入 {event, characters, relationship}
export function narrativeScene({ event, characters = [], relationship = "", limit = 5 } = {}) {
  const query = [event, relationship, ...characters.map((item) => item?.name ?? item)].filter(Boolean).join(" ");
  const results = retrieveFragments(query, { limit });
  const top = results[0];
  const dialogueResults = results.filter((r) => ["conflict", "decision", "bonding", "reveal"].includes(r.scene_type));
  const dialogue = dialogueResults[0] || top;
  const choices = aggregateChoicePatterns(results).slice(0, 3).map((choice) => choice.label);
  return {
    scene_structure: top
      ? {
          scene_type: top.scene_type,
          conflict_type: top.conflict_type,
          emotion_curve: aggregateEmotionCurve(results),
          beats: (top.transferable_rule || "").split(/[。；;]/).filter(Boolean).slice(0, 4),
        }
      : null,
    dialogue_style: dialogue
      ? {
          basis: dialogue.scene_type,
          ...(dialogue.quote_allowed === 1 ? { excerpt: (dialogue.excerpt || "").slice(0, 120) } : {}),
          relationship_effect: dialogue.relationship_effect ? JSON.parse(dialogue.relationship_effect) : null,
          source: dialogue.title,
        }
      : null,
    choices,
    references: results.slice(0, 3).map((r) => ({ event: r.event, title: r.title, score: Math.round(r.score * 100) / 100 })),
  };
}

if (process.argv[1] && process.argv[1].endsWith("contract.mjs")) {
  const command = process.argv[2] || "search";
  const input = process.argv[3] || "创业失败";
  if (command === "scene") {
    console.log(JSON.stringify(narrativeScene({ event: input, characters: [], relationship: "恋人" }), null, 2));
  } else {
    console.log(JSON.stringify(narrativeSearch({ event: input }), null, 2));
  }
}
