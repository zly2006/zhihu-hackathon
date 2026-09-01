// 阶段 4+7：Validator 评分 + 入库（SQLite，node:sqlite）
// 四维 0-5（人生相关性/游戏性/情绪完整度/可迁移性），total ≥ 15 才保留；全部来源可溯源。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TMP = path.join(root, "narrative-kb", "data", "tmp");
const DB_PATH = path.join(root, "narrative-kb", "data", "narrative-kb.sqlite");

const KNOWN_STAGES = new Set([
  "education", "career", "finance", "housing", "relocation", "entrepreneurship",
  "romance", "marriage", "family", "parenting", "friendship", "health", "social", "loss", "aging",
]);

export function scoreFragment(fragment) {
  const relevance = Math.min(5, 3 + (KNOWN_STAGES.has(fragment.life_stage) ? 1 : 0) + (fragment.event && fragment.event.length > 8 ? 0.5 : 0) + (fragment.trigger ? 0.5 : 0));
  const gameability = Math.min(5, 2 + (fragment.choice_points?.length ? 2 : 0) + (fragment.relationship_effect ? 1 : 0));
  const emotion = Math.min(5, 2 + ((fragment.emotion_curve?.start?.length || 0) > 0 ? 1 : 0) + ((fragment.emotion_curve?.end?.length || 0) > 0 ? 1 : 0) + (fragment.emotion_curve?.curve && fragment.emotion_curve.curve !== "flat" ? 1 : 0));
  const transferable = Math.min(5, 2 + (fragment.transferable_rule && fragment.transferable_rule.length > 10 ? 2 : 0) + (fragment.conflict_type ? 1 : 0));
  const total = Math.round((relevance + gameability + emotion + transferable) * 10) / 10;
  return { relevance, gameability, emotion, transferable, total };
}

function main() {
  const sources = JSON.parse(fs.readFileSync(path.join(TMP, "sources.json"), "utf8"));
  const fragments = fs.readFileSync(path.join(TMP, "fragments.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const embeddings = fs.existsSync(path.join(TMP, "embeddings.jsonl"))
    ? fs.readFileSync(path.join(TMP, "embeddings.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : [];

  const db = new DatabaseSync(DB_PATH);
  db.exec(fs.readFileSync(path.join(root, "narrative-kb", "db", "schema.sql"), "utf8"));

  // 1) source_document（含网络语料与仅登记元数据的保护期作品）
  const webSources = [
    { id: "web-01", title: "鲁迅《狂人日记》", author: "鲁迅", sourceType: "literary", uri: "https://zh.wikisource.org/wiki/狂人日記", rights: "public_domain", rag: true },
    { id: "web-02", title: "鲁迅《故乡》", author: "鲁迅", sourceType: "literary", uri: "https://zh.wikisource.org/wiki/故鄉", rights: "public_domain", rag: true },
  ];
  const insertSource = db.prepare(
    `INSERT OR REPLACE INTO source_document (id, source_type, title, author, source_uri, content_hash, rights_status, rag_allowed, training_allowed, quote_allowed, ingest_status, meta_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const now = new Date().toISOString();
  for (const source of sources) {
    insertSource.run(source.id, source.ext === "pdf" ? "novel" : source.ext === "mobi" ? "vn" : "novel", source.title, null, `localdata/${source.file}`, null, source.rights, source.ragAllowed ? 1 : 0, 0, source.rights === "public_domain" ? 1 : 0, source.ingestStatus, JSON.stringify({ file: source.file, ext: source.ext, chars: source.chars, chapters: source.chapters, skipReason: source.skipReason || null }), now);
  }
  for (const web of webSources) {
    insertSource.run(web.id, web.sourceType, web.title, web.author, web.uri, null, web.rights, 1, 0, 1, "ready", null, now);
  }

  // 2) narrative_fragment + choice_pattern + character_arc
  const insertFragment = db.prepare(
    `INSERT OR REPLACE INTO narrative_fragment (id, source_document_id, source_span, scene_type, life_stage, event, conflict_type, emotion_curve, relationship_effect, choices, tags, quality_score, score_json, excerpt, transferable_rule, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertChoice = db.prepare(
    `INSERT OR REPLACE INTO choice_pattern (id, type, options, effects, fragment_id) VALUES (?, ?, ?, ?, ?)`,
  );
  const insertArc = db.prepare(
    `INSERT OR REPLACE INTO character_arc (id, character_name, stage, state_before, state_after, fragment_id) VALUES (?, ?, ?, ?, ?, ?)`,
  );

  let kept = 0;
  let dropped = 0;
  const fragmentIdByIndex = [];
  fragments.forEach((record, index) => {
    const fragment = record.fragment;
    const score = scoreFragment(fragment);
    if (score.total < 15) {
      dropped++;
      return;
    }
    const fragmentId = `frag-${index}`;
    fragmentIdByIndex[index] = fragmentId;
    const span = JSON.stringify({ chapter: record.chapterTitle, startChar: null, endChar: null });
    insertFragment.run(
      fragmentId,
      record.sourceId,
      span,
      fragment.scene_type || "unknown",
      fragment.life_stage || "unknown",
      (fragment.event || "未命名事件").slice(0, 200),
      fragment.conflict_type || "",
      JSON.stringify(fragment.emotion_curve || {}),
      JSON.stringify(fragment.relationship_effect || null),
      JSON.stringify(fragment.choice_points || []),
      JSON.stringify(fragment.tags || []),
      score.total,
      JSON.stringify(score),
      (fragment.excerpt || record.excerpt || "").slice(0, 300),
      fragment.transferable_rule || "",
      now,
    );
    (fragment.choice_points || []).forEach((choice, ci) => {
      insertChoice.run(`choice-${index}-${ci}`, choice.type || "其他", JSON.stringify({ label: choice.label, type: choice.type }), typeof choice.effects === "string" ? JSON.stringify({ description: choice.effects }) : JSON.stringify(choice.effects || {}), fragmentId);
    });
    (fragment.characters || []).forEach((character, ci) => {
      if (!character?.name) return;
      insertArc.run(`arc-${index}-${ci}`, character.name.slice(0, 50), fragment.life_stage || "", character.visibleGoal || "", character.hiddenPressure || "", fragmentId);
    });
    kept++;
  });

  // 3) embeddings（按索引对齐 fragmentId）
  const insertEmbed = db.prepare(
    `INSERT OR REPLACE INTO embeddings (id, fragment_id, embedding_type, vector, model, version) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  let embedded = 0;
  for (const emb of embeddings) {
    const fragmentId = fragmentIdByIndex[Number(emb.fragmentId.replace("emb-", ""))] || emb.fragmentId;
    if (!fragmentId || !db.prepare("SELECT 1 FROM narrative_fragment WHERE id = ?").get(fragmentId)) continue;
    insertEmbed.run(emb.id, fragmentId, emb.embeddingType, JSON.stringify(emb.vector), emb.model, emb.version);
    embedded++;
  }

  console.log(`入库完成：source_document ${sources.length + webSources.length}，fragment ${kept}（评分 <15 丢弃 ${dropped}），choice_pattern/character_arc 随片段，embeddings ${embedded}`);
  console.log(`数据库：${DB_PATH}`);
  db.close();
}

if (process.argv[1] && process.argv[1].endsWith("ingest.mjs")) {
  main();
}
