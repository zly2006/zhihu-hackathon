// Narrative KB 契约 facade（V2.5）
// API 与 Narrative Engine 共用这一层，避免两套检索规则漂移。
// 所有数据来自 query-adapter 的 rag_allowed 只读查询；这里再做输出限长与结构聚合。
import type {
  NarrativeCharacterArcPattern,
  NarrativeChoicePattern,
} from "../domain/narrative";
import {
  loadNarrativePatterns,
  searchFragments,
  type RetrievalResult,
} from "./query-adapter";

const MAX_EVENT_LENGTH = 200;
const MAX_STAGE_LENGTH = 80;
const MAX_RELATIONSHIP_LENGTH = 80;
const MAX_CHARACTER_COUNT = 8;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 8;

export type NarrativeSearchInput = {
  event: string;
  stage?: string;
  limit?: number;
};

export type NarrativeSceneCharacter = string | { name: string };

export type NarrativeSceneInput = {
  event: string;
  characters?: NarrativeSceneCharacter[];
  relationship?: string;
  limit?: number;
};

export type NarrativeEmotionCurve = {
  start: string[];
  peak: string[];
  end: string[];
  curve: string;
};

export type NarrativeScenePattern = {
  fragmentId: string;
  sourceId: string;
  event: string;
  scene_type: string;
  conflict_type: string;
  life_stage: string;
  transferable_rule: string;
  score: number;
};

export type NarrativeSearchResult = {
  kbAvailable: boolean;
  querySummary: {
    event: string;
    stage: string | null;
    total: number;
  };
  scene_pattern: NarrativeScenePattern[];
  choice_pattern: NarrativeChoicePattern[];
  character_arc_pattern: NarrativeCharacterArcPattern[];
  emotion_curve: NarrativeEmotionCurve;
  references: Array<{ fragmentId: string; sourceId: string; score: number }>;
};

export type NarrativeSceneResult = {
  kbAvailable: boolean;
  scene_structure: {
    fragmentId: string;
    scene_type: string;
    conflict_type: string;
    life_stage: string;
    emotion_curve: NarrativeEmotionCurve;
    beats: string[];
  } | null;
  dialogue_style: {
    basis: string;
    technique: string;
    relationship_effect: Record<string, unknown> | null;
    sourceId: string;
  } | null;
  choices: Array<Pick<NarrativeChoicePattern, "type" | "options" | "effects" | "fragmentId">>;
  references: Array<{ fragmentId: string; event: string; sourceId: string; score: number }>;
};

function boundedText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function requiredText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} 不能为空`);
  const text = value.trim();
  if (text.length > maximum) throw new Error(`${field} 超过 ${maximum} 字符`);
  return text;
}

function optionalText(value: unknown, field: string, maximum: number): string {
  if (value === undefined || value === null || value === "") return "";
  return requiredText(value, field, maximum);
}

function normalizeLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_LIMIT;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new Error("limit 必须是正整数");
  return Math.max(1, Math.min(MAX_LIMIT, value));
}

export function normalizeNarrativeSearchInput(input: NarrativeSearchInput): Required<NarrativeSearchInput> {
  return {
    event: requiredText(input?.event, "event", MAX_EVENT_LENGTH),
    stage: optionalText(input?.stage, "stage", MAX_STAGE_LENGTH),
    limit: normalizeLimit(input?.limit),
  };
}

export function normalizeNarrativeSceneInput(input: NarrativeSceneInput): Required<NarrativeSceneInput> {
  const rawCharacters = input?.characters ?? [];
  if (rawCharacters.length > MAX_CHARACTER_COUNT) throw new Error(`characters 不能超过 ${MAX_CHARACTER_COUNT} 项`);
  const characters = rawCharacters.map((character) => {
    if (typeof character === "string") return requiredText(character, "characters.name", 80);
    return requiredText(character?.name, "characters.name", 80);
  });
  return {
    event: requiredText(input?.event, "event", MAX_EVENT_LENGTH),
    characters,
    relationship: optionalText(input?.relationship, "relationship", MAX_RELATIONSHIP_LENGTH),
    limit: normalizeLimit(input?.limit),
  };
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function safeRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
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
    Object.entries(value as Record<string, unknown>)
      .slice(0, 8)
      .map(([key, item]) => [boundedText(key, 60), safeValue(item)])
      .filter(([key]) => Boolean(key)),
  );
}

function aggregateEmotionCurve(rows: RetrievalResult["rows"]): NarrativeEmotionCurve {
  const values: Record<"start" | "peak" | "end" | "curve", string[]> = {
    start: [],
    peak: [],
    end: [],
    curve: [],
  };
  for (const row of rows) {
    const parsed = parseJson(row.emotion_curve);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const curve = parsed as Record<string, unknown>;
    for (const key of ["start", "peak", "end"] as const) {
      const items = Array.isArray(curve[key]) ? curve[key] : [];
      for (const item of items) {
        const text = boundedText(item, 40);
        if (text && !values[key].includes(text)) values[key].push(text);
      }
    }
    const curveName = boundedText(curve.curve, 40);
    if (curveName) values.curve.push(curveName);
  }
  const top = (items: string[]) => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 4)
      .map(([item]) => item);
  };
  return {
    start: top(values.start),
    peak: top(values.peak),
    end: top(values.end),
    curve: top(values.curve)[0] || "mixed",
  };
}

function patternResult(rows: RetrievalResult["rows"]) {
  return loadNarrativePatterns(
    rows.map((row) => row.fragment_id),
    Object.fromEntries(rows.map((row) => [row.fragment_id, row.similarity])),
  );
}

function scenePatternFor(row: RetrievalResult["rows"][number]): NarrativeScenePattern {
  return {
    fragmentId: row.fragment_id,
    sourceId: row.source_id,
    event: boundedText(row.event, 200),
    scene_type: boundedText(row.scene_type, 60),
    conflict_type: boundedText(row.conflict_type, 80),
    life_stage: boundedText(row.life_stage, 60),
    transferable_rule: boundedText(row.transferable_rule, 240),
    score: Math.round(row.similarity * 100) / 100,
  };
}

export function narrativeSearch(input: NarrativeSearchInput): NarrativeSearchResult {
  const normalized = normalizeNarrativeSearchInput(input);
  const retrieval = searchFragments({
    query: normalized.event,
    stage: normalized.stage || undefined,
    limit: normalized.limit,
  });
  const rows = retrieval.rows;
  const patterns = patternResult(rows);
  return {
    kbAvailable: retrieval.available,
    querySummary: {
      event: normalized.event,
      stage: normalized.stage || null,
      total: rows.length,
    },
    scene_pattern: rows.slice(0, 3).map(scenePatternFor),
    choice_pattern: patterns.choicePatterns.slice(0, 12),
    character_arc_pattern: patterns.characterArcPatterns.slice(0, 12),
    emotion_curve: aggregateEmotionCurve(rows),
    references: rows.slice(0, 3).map((row) => ({
      fragmentId: row.fragment_id,
      sourceId: row.source_id,
      score: Math.round(row.similarity * 100) / 100,
    })),
  };
}

export function narrativeScene(input: NarrativeSceneInput): NarrativeSceneResult {
  const normalized = normalizeNarrativeSceneInput(input);
  const query = [normalized.event, normalized.relationship, ...normalized.characters].filter(Boolean).join(" ");
  const retrieval = searchFragments({ query, limit: normalized.limit });
  const rows = retrieval.rows;
  const top = rows[0];
  const dialogueRow = rows.find((row) => ["conflict", "decision", "bonding", "reveal"].includes(row.scene_type)) || top;
  const patterns = patternResult(rows);
  const relationshipEffect = dialogueRow ? parseJson(dialogueRow.relationship_effect) : null;
  const safeRelationshipEffect = safeRecord(relationshipEffect);
  return {
    kbAvailable: retrieval.available,
    scene_structure: top
      ? {
          fragmentId: top.fragment_id,
          scene_type: boundedText(top.scene_type, 60),
          conflict_type: boundedText(top.conflict_type, 80),
          life_stage: boundedText(top.life_stage, 60),
          emotion_curve: aggregateEmotionCurve(rows),
          beats: boundedText(top.transferable_rule, 240)
            .split(/[。；;]/)
            .map((beat) => beat.trim())
            .filter(Boolean)
            .slice(0, 4),
        }
      : null,
    dialogue_style: dialogueRow
      ? {
          basis: boundedText(dialogueRow.scene_type, 60),
          technique: boundedText(dialogueRow.transferable_rule, 240),
          relationship_effect: safeRelationshipEffect,
          sourceId: dialogueRow.source_id,
        }
      : null,
    choices: patterns.choicePatterns.slice(0, 3).map(({ type, options, effects, fragmentId }) => ({
      type,
      options,
      effects,
      fragmentId,
    })),
    references: rows.slice(0, 3).map((row) => ({
      fragmentId: row.fragment_id,
      event: boundedText(row.event, 200),
      sourceId: row.source_id,
      score: Math.round(row.similarity * 100) / 100,
    })),
  };
}
