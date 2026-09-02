// Narrative Evidence Retriever（V1.1 §4.8 第二步）
// NarrativeNeed → NarrativeEvidenceBundle：按叙事功能分桶检索 KB，聚合为
// arc/scene/dialogue/pacing/ending 五类 NarrativeReference。
import type { NarrativeEvidenceBundle, NarrativeNeed, NarrativeReference } from "../domain/narrative";
import { searchFragments, type RetrievalResult } from "./query-adapter";

const SCENE_FUNCTION_SCENES = ["conflict", "decision", "reversal", "climax"];
const DIALOGUE_SCENES = ["conflict", "bonding", "decision", "reveal"];
const PACING_SCENES = ["setup", "transition", "aftermath"];
const ENDING_SCENES = ["aftermath", "ending_hook", "loss", "reconciliation"];

function rowToReference(row: RetrievalResult["rows"][number]): NarrativeReference {
  let emotionCurve: string[] = [];
  let relationshipTags: string[] = [];
  try {
    const curve = JSON.parse(row.emotion_curve || "{}") as { start?: string[]; peak?: string[]; end?: string[] };
    emotionCurve = [...(curve.start ?? []), ...(curve.peak ?? []), ...(curve.end ?? [])];
    const effect = JSON.parse(row.relationship_effect || "null") as { description?: string } | null;
    if (effect?.description) relationshipTags = [effect.description];
  } catch {
    /* 容错 */
  }
  let tags: string[] = [];
  try {
    tags = JSON.parse(row.tags || "[]");
  } catch {
    /* 容错 */
  }
  return {
    fragmentId: row.fragment_id,
    sourceId: row.source_id,
    functionTags: [row.scene_type, ...tags].filter(Boolean),
    conflictTags: [row.conflict_type].filter(Boolean),
    relationshipTags,
    techniqueSummary: row.transferable_rule || "",
    structureSummary: `${row.scene_type}｜${row.life_stage}｜${row.conflict_type}`,
    emotionalCurve: emotionCurve.slice(0, 8),
    safeExcerpt: (row.excerpt || "").slice(0, 300) || undefined,
    similarity: Math.round(row.similarity * 1000) / 1000,
    qualityScore: row.quality_score,
  };
}

function dedupe(references: NarrativeReference[]): NarrativeReference[] {
  const seen = new Set<string>();
  return references.filter((reference) => {
    if (seen.has(reference.fragmentId)) return false;
    seen.add(reference.fragmentId);
    return true;
  });
}

function composeQuery(need: NarrativeNeed): string {
  return [
    ...need.centralEvents,
    ...need.conflictTypes,
    ...need.lifeDomains,
    ...need.relationshipTypes,
    need.desiredTone,
  ]
    .filter(Boolean)
    .join(" ");
}

export function retrieveNarrativeEvidence(need: NarrativeNeed): NarrativeEvidenceBundle {
  const query = composeQuery(need);
  const primaryStage = need.lifeDomains[0];

  const scene = searchFragments({ query, stage: primaryStage, limit: 8 });
  const dialogue = searchFragments({ query, sceneTypes: DIALOGUE_SCENES, limit: 8 });
  const pacing = searchFragments({ query, sceneTypes: PACING_SCENES, limit: 8 });
  const ending = searchFragments({ query, sceneTypes: ENDING_SCENES, limit: 8 });
  const arc = searchFragments({ query, limit: 8 });

  const kbAvailable = scene.available;
  const reasons = [scene, dialogue, pacing, ending, arc]
    .filter((result) => !result.available)
    .map((result) => result.reason)
    .filter(Boolean);

  const scenePatterns = dedupe(scene.rows.filter((row) => SCENE_FUNCTION_SCENES.includes(row.scene_type)).map(rowToReference));
  const dialoguePatterns = dedupe(dialogue.rows.map(rowToReference));
  const pacingPatterns = dedupe(pacing.rows.map(rowToReference));
  const endingPatterns = dedupe(ending.rows.map(rowToReference));
  const arcPatterns = dedupe(arc.rows.map(rowToReference));

  const all = dedupe([...scenePatterns, ...dialoguePatterns, ...pacingPatterns, ...endingPatterns, ...arcPatterns]);
  const querySummary = kbAvailable
    ? `章节 ${need.chapterId}｜领域 ${need.lifeDomains.join("/")}｜中心事件 ${need.centralEvents.slice(0, 3).join("；")}｜检索 ${all.length} 条参考`
    : `Narrative KB 不可用（${reasons.join("；")}），返回空证据包，Director 以无参考模式生成计划`;

  return {
    querySummary,
    arcPatterns,
    scenePatterns,
    dialoguePatterns,
    pacingPatterns,
    endingPatterns,
    total: all.length,
  };
}

export function bundleFragmentIds(bundle: NarrativeEvidenceBundle): Set<string> {
  return new Set(
    [
      ...bundle.arcPatterns,
      ...bundle.scenePatterns,
      ...bundle.dialoguePatterns,
      ...bundle.pacingPatterns,
      ...bundle.endingPatterns,
    ].map((reference) => reference.fragmentId),
  );
}
