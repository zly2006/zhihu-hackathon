// 展示视图模型（V1.3 §6.4）
// UI 不到处直接读 WorldState：本模块把 WorldState / Chapter 折算成纯展示数据。
// 只暴露玩家可见信息，绝不输出 NPC privateState。

import type { Character } from "../domain/character";
import type { WorldState } from "../domain/world";
import type { Chapter } from "../domain/chapter";
import { LIFE_STAT_KEYS, type LifeStatKey } from "../domain/shared";
import { resolveAvatarUrl } from "./avatar-registry";
import { deriveRelationshipLevel, levelLabel, nextRelationshipThreshold } from "./relationship-levels";
import type { RelationshipScores } from "../domain/relationship";

export const STAT_LABELS: Record<LifeStatKey, string> = {
  cash: "现金",
  health: "健康",
  happiness: "幸福",
  knowledge: "学识",
  connections: "人脉",
  career: "事业",
  assets: "资产",
};

export type StatPresentation = {
  key: string;
  label: string;
  value: number;
  delta?: number;
  warning: boolean;
};

export type RelationshipPresentation = {
  characterId: string;
  name: string;
  type: string;
  score: number;
  scores: RelationshipScores;
  level: ReturnType<typeof deriveRelationshipLevel>;
  levelLabel: string;
  nextThreshold: number | null;
  actualDelta?: Partial<RelationshipScores>;
  trend?: number;
  avatarUrl: string | null;
};

export type LifePresentationState = {
  chapter: {
    index: number;
    title: string;
    yearRange: string;
    sceneIndex: number;
    sceneTotal: number;
  };
  protagonist: {
    name: string;
    age: number;
    levelLabel: string;
    occupation: string;
    portraitKey: string;
    avatarUrl: string | null;
    stats: StatPresentation[];
  };
  relationships: RelationshipPresentation[];
  scene: {
    heading?: string;
    timeLabel?: string;
    speakerId?: string;
    speakerName?: string;
    blocks: unknown[];
  };
};

export function levelLabelFor(chapterCount: number): string {
  return `Life ${String(Math.max(1, chapterCount + 1)).padStart(2, "0")}`;
}

export function statDeltaFromEvents(
  characterId: string,
  events: Array<{ characterChanges: Array<{ characterId: string; statDelta?: Partial<Record<LifeStatKey, number>> }> }>,
): Partial<Record<LifeStatKey, number>> {
  const delta: Partial<Record<LifeStatKey, number>> = {};
  for (const event of events) {
    for (const change of event.characterChanges) {
      if (change.characterId !== characterId || !change.statDelta) continue;
      for (const key of LIFE_STAT_KEYS) {
        const value = change.statDelta[key];
        if (typeof value === "number") delta[key] = (delta[key] ?? 0) + value;
      }
    }
  }
  return delta;
}

export function buildLifePresentation(args: {
  world: WorldState;
  chapter?: Chapter | null;
  chapterEvents?: Array<{
    characterChanges: Array<{ characterId: string; statDelta?: Partial<Record<LifeStatKey, number>> }>;
    relationshipChanges?: Array<{ relationshipId: string; scoreDelta?: Partial<RelationshipScores> }>;
  }>;
  sceneIndex?: number;
}): LifePresentationState {
  const { world, chapter, chapterEvents, sceneIndex } = args;
  const protagonist = world.characters[world.protagonistId];
  const chapterCount = world.chapterIds.length;

  const protagonistPresentation = protagonist
    ? {
        name: protagonist.identity.name,
        age: protagonist.state.age,
        levelLabel: levelLabelFor(chapterCount),
        occupation: protagonist.state.occupation || "未定",
        portraitKey: protagonist.visual?.avatarId ?? "",
        avatarUrl: resolveAvatarUrl({
          avatarId: protagonist.visual?.avatarId,
          avatarUrl: protagonist.visual?.avatarUrl,
        }),
        stats: buildStatRows(protagonist, chapterEvents),
      }
    : {
        name: "主角",
        age: 18,
        levelLabel: levelLabelFor(chapterCount),
        occupation: "未定",
        portraitKey: "",
        avatarUrl: null,
        stats: [] as StatPresentation[],
      };

  const relationships: RelationshipPresentation[] = Object.values(world.relationships)
    .filter((rel) => rel.characterAId === world.protagonistId || rel.characterBId === world.protagonistId)
    .map((rel) => {
    const otherId = rel.characterAId === world.protagonistId ? rel.characterBId : rel.characterAId;
    const other = world.characters[otherId];
    const level = deriveRelationshipLevel(rel.scores);
    const actualDelta: Partial<RelationshipScores> = {};
    for (const event of chapterEvents ?? []) {
      for (const change of event.relationshipChanges ?? []) {
        if (change.relationshipId !== rel.id) continue;
        for (const key of ["closeness", "trust", "conflict", "commitment"] as const) {
          const amount = change.scoreDelta?.[key];
          if (typeof amount === "number") actualDelta[key] = (actualDelta[key] ?? 0) + amount;
        }
      }
    }
    return {
      characterId: otherId,
      name: other?.identity.name ?? "未知",
      type: rel.type,
      score: rel.scores.closeness,
      scores: { ...rel.scores },
      level,
      levelLabel: levelLabel(level),
      nextThreshold: nextRelationshipThreshold(level),
      ...(Object.keys(actualDelta).length > 0 ? { actualDelta } : {}),
      avatarUrl: resolveAvatarUrl({
        avatarId: other?.visual?.avatarId,
        avatarUrl: other?.visual?.avatarUrl,
      }),
    };
  });

  const scenes = chapter?.novel.scenes ?? [];
  const activeScene = scenes[sceneIndex ?? 0];
  const scene = {
    heading: activeScene?.heading,
    timeLabel: activeScene?.timeLabel,
    speakerId: undefined,
    speakerName: undefined,
    blocks: [],
  };

  const title = chapter ? `第 ${chapter.index + 1} 章 · ${chapter.novel.title || "未完"}` : "第一章 · 开始";
  const yearRange = chapter ? `${chapter.startYear} → ${chapter.endYear}` : `${world.currentYear} 年起`;

  return {
    chapter: {
      index: chapter?.index ?? chapterCount,
      title,
      yearRange,
      sceneIndex: sceneIndex ?? 0,
      sceneTotal: scenes.length,
    },
    protagonist: protagonistPresentation,
    relationships,
    scene,
  };
}

function buildStatRows(
  character: Character,
  chapterEvents?: Array<{ characterChanges: Array<{ characterId: string; statDelta?: Partial<Record<LifeStatKey, number>> }> }>,
): StatPresentation[] {
  const deltas = chapterEvents ? statDeltaFromEvents(character.id, chapterEvents) : {};
  return LIFE_STAT_KEYS.map((key) => ({
    key,
    label: STAT_LABELS[key],
    value: character.state.stats[key],
    delta: deltas[key],
    warning: character.state.stats[key] <= 20,
  }));
}
