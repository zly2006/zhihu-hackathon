import { createHash } from "node:crypto";
import { Pool } from "pg";
import type { Experience, LifeState, Profile, Stats } from "./types";

type CandidateRow = {
  id: string;
  title: string;
  url: string;
  external_id: string;
  context: string;
  decision: string;
  action: string;
  outcome: string;
  confidence: number;
  blocking_key: string;
  vector: Buffer;
  author_name: string | null;
  author_avatar: string | null;
  author_token: string | null;
  author_profile_url: string | null;
};

let pool: Pool | undefined;

function db() {
  if (!pool) {
    const connectionString = process.env.DK_DATABASE_URL;
    if (!connectionString) throw new Error("DK_DATABASE_URL 未配置");
    pool = new Pool({
      connectionString,
      max: 8,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return pool;
}

export async function getDatabaseStats(): Promise<Stats> {
  const result = await db().query<Stats>(`
    SELECT
      (SELECT count(*)::int FROM content_snapshot) snapshots,
      (SELECT count(*)::int FROM decision_episode_candidate) candidates,
      (SELECT count(*)::int FROM candidate_embedding WHERE status = 'READY') vectors,
      (SELECT count(*)::int FROM decision_scenario WHERE review_status = 'CONFIRMED') scenarios
  `);
  return result.rows[0];
}

function hashNumber(value: string) {
  return Number.parseInt(createHash("sha256").update(value).digest("hex").slice(0, 8), 16);
}

function stageSearch(age: number, profile: Profile, state: LifeState) {
  const incomeTerms = state.cash < 22 ? ["收入", "赚钱", "兼职", "副业"] : [];
  if (state.health < 28)
    return { domain: "health_life", terms: ["健康", "恢复", "治疗", "休息", "工作强度"] };
  if (age < 6)
    return { domain: "family_relationship", terms: ["家庭", "父母", "孩子", ...incomeTerms] };
  if (age < 13) return { domain: "education", terms: ["学习", "学校", "兴趣"] };
  if (age < 18) return { domain: "education", terms: ["高考", "专业", "学习"] };
  if (age < 23) return { domain: "education", terms: ["大学", "考研", "专业", "就业"] };
  if (age < 29)
    return { domain: "career", terms: ["工作", "转行", "职业", "创业", ...incomeTerms] };
  if (age < 36) return { domain: "career", terms: ["买房", "结婚", "工作", "创业"] };
  if (age < 46) return { domain: "career", terms: ["职业", "家庭", "健康", "投资"] };
  if (age < 56) return { domain: "health_life", terms: ["健康", "生活", "家庭", "工作"] };
  return { domain: "health_life", terms: ["退休", "养老", "健康", "生活"] };
}

function decodeVector(payload: Buffer) {
  return new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4);
}

function cosine(left: Float32Array, right: Float32Array) {
  let value = 0;
  for (let index = 0; index < left.length; index += 1) value += left[index] * right[index];
  return value;
}

function compact(...values: string[]) {
  return values.join(" ").replace(/\s+/g, " ").trim();
}

function toExperience(row: CandidateRow, similarity: number): Experience {
  const authorName = compact(row.author_name || "");
  return {
    id: row.id,
    title: compact(row.title).slice(0, 72) || "一段匿名人生经历",
    url: row.url,
    avatar: row.author_avatar || null,
    author: authorName || "作者信息未采集",
    authorUrl: row.author_profile_url,
    authorKnown: Boolean(authorName),
    excerpt: compact(row.context, row.decision).slice(0, 150),
    action: compact(row.action).slice(0, 120),
    outcome: compact(row.outcome).slice(0, 130),
    similarity: Math.max(0, Math.min(1, similarity)),
  };
}

export async function retrieveExperiences(
  profile: Profile,
  age: number,
  historyKey: string,
  state: LifeState,
) {
  const stage = stageSearch(age, profile, state);
  const statements = stage.terms
    .map((_, index) => `(c.context LIKE $${index * 2 + 2} OR c.decision LIKE $${index * 2 + 3})`)
    .join(" OR ");
  const termParams = stage.terms.flatMap((term) => [`%${term}%`, `%${term}%`]);
  let anchors = (
    await db().query<CandidateRow>(
      `
    SELECT c.id, s.title, s.source_url url, i.external_id, c.context, c.decision,
           c.action, c.outcome, c.confidence, e.blocking_key, e.vector,
           s.author_name, s.author_avatar_url author_avatar, s.author_url_token author_token,
           s.author_profile_url
    FROM decision_episode_candidate c
    JOIN candidate_embedding e ON e.candidate_id = c.id AND e.status = 'READY'
    JOIN content_snapshot s ON s.id = c.content_snapshot_id
    JOIN content_item i ON i.id = s.content_item_id
    WHERE c.review_status != 'REJECTED' AND c.confidence >= 80
      AND e.blocking_key = $1 AND (${statements})
      AND s.author_name IS NOT NULL
    LIMIT 180
  `,
      [stage.domain, ...termParams],
    )
  ).rows;

  if (!anchors.length) {
    anchors = (
      await db().query<CandidateRow>(
        `
      SELECT c.id, s.title, s.source_url url, i.external_id, c.context, c.decision,
             c.action, c.outcome, c.confidence, e.blocking_key, e.vector,
             s.author_name, s.author_avatar_url author_avatar, s.author_url_token author_token,
             s.author_profile_url
      FROM decision_episode_candidate c
      JOIN candidate_embedding e ON e.candidate_id = c.id AND e.status = 'READY'
      JOIN content_snapshot s ON s.id = c.content_snapshot_id
      JOIN content_item i ON i.id = s.content_item_id
      WHERE c.review_status != 'REJECTED' AND c.confidence >= 80 AND e.blocking_key = $1
        AND s.author_name IS NOT NULL
      LIMIT 180
    `,
        [stage.domain],
      )
    ).rows;
  }

  if (!anchors.length) return { domain: stage.domain, items: [] };

  const anchor =
    anchors[
      hashNumber(`${profile.birthYear}:${age}:${profile.family}:${historyKey}`) % anchors.length
    ];
  const candidates = (
    await db().query<CandidateRow>(
      `
    SELECT c.id, s.title, s.source_url url, i.external_id, c.context, c.decision,
           c.action, c.outcome, c.confidence, e.blocking_key, e.vector,
           s.author_name, s.author_avatar_url author_avatar, s.author_url_token author_token,
           s.author_profile_url
    FROM candidate_embedding e
    JOIN decision_episode_candidate c ON c.id = e.candidate_id
    JOIN content_snapshot s ON s.id = c.content_snapshot_id
    JOIN content_item i ON i.id = s.content_item_id
    WHERE e.status = 'READY' AND e.embedding_version = 'bge-large-zh-v1.5:scenario-text-v2'
      AND e.blocking_key = $1 AND c.review_status != 'REJECTED' AND c.confidence >= 75
      AND s.author_name IS NOT NULL
    LIMIT 420
  `,
      [anchor.blocking_key],
    )
  ).rows;

  const anchorVector = decodeVector(anchor.vector);
  const neighbors = candidates
    .filter((row) => row.id !== anchor.id)
    .map((row) => ({ row, score: cosine(anchorVector, decodeVector(row.vector)) }))
    .sort((left, right) => right.score - left.score);

  const distinct: { row: CandidateRow; score: number }[] = [{ row: anchor, score: 1 }];
  const urls = new Set([anchor.url]);
  for (const item of neighbors) {
    if (urls.has(item.row.url)) continue;
    urls.add(item.row.url);
    distinct.push(item);
    if (distinct.length === 18) break;
  }
  return {
    domain: anchor.blocking_key,
    items: distinct.map(({ row, score }) => toExperience(row, score)),
  };
}
