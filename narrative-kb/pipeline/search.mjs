// 检索验证：query → 词法向量（同 embed 的哈希袋）→ 余弦 Top-K
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

export function search(query, { limit = 5, sceneType, conflictType, lifeStage } = {}) {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const filters = [];
  if (sceneType) filters.push(`scene_type = '${sceneType}'`);
  if (conflictType) filters.push(`conflict_type = '${conflictType}'`);
  if (lifeStage) filters.push(`life_stage = '${lifeStage}'`);
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  const rows = db
    .prepare(
      `SELECT e.fragment_id, e.vector, f.event, f.scene_type, f.conflict_type, f.life_stage, f.excerpt, f.quality_score, s.title, s.rights_status
       FROM embeddings e
       JOIN narrative_fragment f ON f.id = e.fragment_id
       JOIN source_document s ON s.id = f.source_document_id
       ${where}`,
    )
    .all();

  const tokens = tokenize(query);
  const dim = rows.length ? JSON.parse(rows[0].vector).length : 0;
  const queryVec = buildVector(tokens, dim || undefined);

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

if (process.argv[1] && process.argv[1].endsWith("search.mjs")) {
  const args = process.argv.slice(2);
  const options = { limit: 5, sceneType: undefined, conflictType: undefined, lifeStage: undefined };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit") options.limit = Number(args[++i]);
    else if (args[i] === "--sceneType") options.sceneType = args[++i];
    else if (args[i] === "--conflictType") options.conflictType = args[++i];
    else if (args[i] === "--lifeStage") options.lifeStage = args[++i];
    else positional.push(args[i]);
  }
  const query = positional.join(" ") || "创业失败";
  const results = search(query, options);
  console.log(`查询「${query}」Top ${results.length}：\n`);
  for (const result of results) {
    console.log(`[${(result.score * 100).toFixed(1)}%] ${result.title}｜${result.event}`);
    console.log(`    场景=${result.scene_type} 冲突=${result.conflict_type} 阶段=${result.life_stage} 评分=${result.quality_score} 权利=${result.rights_status}`);
    console.log(`    ${(result.excerpt || "").slice(0, 60)}`);
    console.log();
  }
}
