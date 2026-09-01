// Narrative KB 冒烟测试（不依赖 LLM / 网络）
// 运行：node --test narrative-kb/tests/smoke.test.mjs
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const root = join(process.cwd(), "narrative-kb");
const tmp = join(root, "data", "tmp");

test("inventory 产物：24 个文件，权利分类齐全", () => {
  const inventory = JSON.parse(readFileSync(join(tmp, "inventory.json"), "utf8"));
  assert.equal(inventory.total, 24);
  const byRights = inventory.entries.reduce((map, entry) => {
    map[entry.rights] = (map[entry.rights] || 0) + 1;
    return map;
  }, {});
  assert.ok(byRights.public_domain >= 1, "至少 1 个公版（赵树理）");
  assert.ok(byRights.internal_eval_only >= 18, "18 个网文 internal_eval_only");
  assert.ok(byRights.discovered >= 5, "保护期作品仅登记");
});

test("parse 产物：19 个 txt ready，4 PDF 仅登记（discovered），1 MOBI 跳过", () => {
  const sources = JSON.parse(readFileSync(join(tmp, "sources.json"), "utf8"));
  assert.equal(sources.filter((s) => s.ingestStatus === "ready").length, 19);
  assert.equal(sources.filter((s) => s.ingestStatus === "discovered").length, 4);
  assert.equal(sources.filter((s) => s.ingestStatus === "skipped").length, 1);
});

test("chunk 产物：抽样章节文本长度受限且可溯源", () => {
  const samples = readFileSync(join(tmp, "sample.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.ok(samples.length >= 60, `抽样章节应 ≥60，实际 ${samples.length}`);
  for (const sample of samples) {
    assert.ok(sample.sourceId && sample.title && sample.chapterTitle);
    assert.ok(sample.text.length >= 150 && sample.text.length <= 2200, "章节文本应在 150-2200 字符");
  }
});

test("评分：结构化越完整的片段得分越高，且 >15 才入库", async () => {
  const { scoreFragment } = await import("../pipeline/ingest.mjs");
  const rich = scoreFragment({
    life_stage: "career",
    event: "创业失败后与合伙人分道扬镳",
    trigger: "资金链断裂",
    choice_points: [{ label: "坦白" }, { label: "隐瞒" }],
    relationship_effect: { dimension: "trust", direction: "decrease" },
    emotion_curve: { start: ["焦虑"], peak: ["崩溃"], end: ["释然"], curve: "rise_fall" },
    conflict_type: "目标冲突",
    transferable_rule: "先用日常细节建立信任，再让一次违约成为关系转折点",
  });
  assert.ok(rich.total >= 15, `rich 应 ≥15，实际 ${rich.total}`);
  const poor = scoreFragment({ life_stage: "unknown", event: "日常", choice_points: [], emotion_curve: {}, transferable_rule: "" });
  assert.ok(poor.total < 15, `poor 应 <15，实际 ${poor.total}`);
});

test("SQLite 数据库结构：五张表 + 索引", () => {
  const dbPath = join(root, "data", "narrative-kb.sqlite");
  if (!existsSync(dbPath)) return; // 未入库时跳过
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
  for (const expected of ["source_document", "narrative_fragment", "choice_pattern", "character_arc", "embeddings"]) {
    assert.ok(tables.includes(expected), `缺少表 ${expected}`);
  }
  const count = db.prepare("SELECT COUNT(*) AS n FROM narrative_fragment").get().n;
  assert.ok(count > 0, "fragment 应有数据");
  db.close();
});
