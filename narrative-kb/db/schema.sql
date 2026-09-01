-- Narrative KB v0 schema（对齐《Narrative KB 开发执行说明书》四表 + 《设记》溯源表）
-- 数据库：SQLite（node:sqlite），后续可平滑迁移 PostgreSQL + pgvector（表结构同构）。

PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS source_document (
  id               TEXT PRIMARY KEY,
  source_type      TEXT NOT NULL,               -- novel / vn / literary / web_metadata / other
  title            TEXT NOT NULL,
  author           TEXT,
  language         TEXT DEFAULT 'zh',
  source_uri       TEXT,                        -- 可溯源 URL / 项目内路径
  content_hash     TEXT,
  rights_status    TEXT NOT NULL,               -- public_domain / internal_eval_only / unknown / discovered / rejected
  rag_allowed      INTEGER DEFAULT 0,
  training_allowed INTEGER DEFAULT 0,
  quote_allowed    INTEGER DEFAULT 0,
  ingest_status    TEXT DEFAULT 'discovered',   -- discovered / ready / skipped
  meta_json        TEXT,                        -- 文件信息 / 页数 / 编码 等
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS narrative_fragment (
  id                 TEXT PRIMARY KEY,
  source_document_id TEXT NOT NULL,
  source_span        TEXT,                      -- JSON {chapter, startChar, endChar}
  scene_type         TEXT,                      -- scene_function（setup/conflict/reversal/loss/reconciliation/ending_hook...）
  life_stage         TEXT,                      -- 人生阶段（education/career/romance/family...）
  event              TEXT NOT NULL,             -- 人生事件（如：创业失败 / 毕业选择 / 关系冲突）
  conflict_type      TEXT,
  emotion_curve      TEXT,                      -- JSON 数组（start/peak/end）
  relationship_effect TEXT,
  choices            TEXT,                      -- JSON 数组（choice_pattern 引用）
  tags               TEXT,                      -- JSON 数组
  quality_score      REAL,
  score_json         TEXT,                      -- JSON 四维评分（人生相关性/游戏性/情绪完整度/可迁移性）
  excerpt            TEXT,                      -- 短样例（不超过 300 字）
  transferable_rule  TEXT,
  created_at         TEXT NOT NULL,
  FOREIGN KEY (source_document_id) REFERENCES source_document(id)
);

CREATE TABLE IF NOT EXISTS choice_pattern (
  id         TEXT PRIMARY KEY,
  type       TEXT,                              -- dream_vs_stability / career_vs_romance / self_vs_family ...
  options    TEXT NOT NULL,                     -- JSON 数组
  effects    TEXT,                              -- JSON {relationship, memory, future_flags}
  fragment_id TEXT,
  FOREIGN KEY (fragment_id) REFERENCES narrative_fragment(id)
);

CREATE TABLE IF NOT EXISTS character_arc (
  id             TEXT PRIMARY KEY,
  character_name TEXT NOT NULL,
  stage          TEXT,                          -- 阶段（如 career_setback / romance_climax）
  state_before   TEXT,
  state_after    TEXT,
  fragment_id    TEXT,
  FOREIGN KEY (fragment_id) REFERENCES narrative_fragment(id)
);

CREATE TABLE IF NOT EXISTS embeddings (
  id             TEXT PRIMARY KEY,
  fragment_id    TEXT NOT NULL,
  embedding_type TEXT NOT NULL,                 -- lexical(v0) / scene / conflict / emotion / choice
  vector         BLOB NOT NULL,                 -- JSON float 数组（v0 本地词法 TF 向量）
  model          TEXT,
  version        TEXT,
  FOREIGN KEY (fragment_id) REFERENCES narrative_fragment(id)
);

CREATE INDEX IF NOT EXISTS idx_fragment_scene    ON narrative_fragment(scene_type);
CREATE INDEX IF NOT EXISTS idx_fragment_conflict ON narrative_fragment(conflict_type);
CREATE INDEX IF NOT EXISTS idx_fragment_stage    ON narrative_fragment(life_stage);
CREATE INDEX IF NOT EXISTS idx_fragment_source   ON narrative_fragment(source_document_id);
CREATE INDEX IF NOT EXISTS idx_embedding_type    ON embeddings(embedding_type);
