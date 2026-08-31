// Novel Writer（Phase 5）
// 只根据已经确定的 SimulationEvent 写小说，不能创造与 canonical 冲突的重大事实。
// 可以创造场景、对白、过渡、氛围、日常细节；不能改变事件年份、结果、关系变化。
// 重新生成小说只重写文风，不改 canonical events（方案 §21、§35.3）。

import { callGameModel } from "../llm";
import type { Character } from "../domain/character";
import type { ChapterSpan } from "../domain/shared";
import type { Chapter, NovelScene } from "../domain/chapter";
import type { CharacterMemory } from "../domain/memory";
import type { Relationship } from "../domain/relationship";
import type { SimulationEvent } from "../domain/simulation";
import type { LifeExperience } from "../domain/experience";

export type NovelWriterInput = {
  protagonist: Character;
  npcs: Character[];
  relationships: Relationship[];
  startYear: number;
  endYear: number;
  span: ChapterSpan;
  events: SimulationEvent[];
  relevantMemories: CharacterMemory[];
  featuredEvidence: LifeExperience[];
};

type ModelNovel = {
  title?: unknown;
  subtitle?: unknown;
  scenes?: unknown;
};

const NOVEL_SYSTEM =
  "你是中文互动人生小说的章节写手。只输出严格 JSON，不写 Markdown。你只能根据已经确定的结构化事件来写小说，不能改变事件的事实。用第二人称“你”叙述。通过场景、对白、细节表现人物，不要直接交代主角不可能知道的他人秘密心理，只能通过行为暗示。不要把知乎作者的真实经历复制给游戏角色，也不要大段引用知乎原文。避免“第一年……第二年……第三年……”的流水账，用多个具体场景推进。";

function requireText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`大模型返回字段 ${field} 缺失`);
  return value.trim().slice(0, maximum);
}

function describeCharacterForNovel(character: Character): string {
  const lines = [
    `${character.identity.name}（${character.state.age} 岁，${character.role === "protagonist" ? "主角" : "NPC"}）`,
    `性格：${character.core.personalityTraits.join("、") || "未设定"}`,
  ];
  return lines.join("，");
}

function describeEvent(event: SimulationEvent, world: NovelWriterInput): string {
  const participants = event.participantIds
    .map((id) => [world.protagonist, ...world.npcs].find((c) => c.id === id)?.identity.name ?? "某人")
    .join("、");
  const relationshipChanges = event.relationshipChanges
    .map((change) => {
      const rel = world.relationships.find((r) => r.id === change.relationshipId);
      const other = world.npcs.find((n) => n.id === rel?.characterAId || n.id === rel?.characterBId);
      const delta = Object.entries(change.scoreDelta)
        .map(([k, v]) => `${k}${Number(v) >= 0 ? "+" : ""}${v}`)
        .join("，");
      return `与${other?.identity.name ?? "某人"}：${change.description}${delta ? `（${delta}）` : ""}`;
    })
    .join("；");
  const characterChanges = event.characterChanges
    .map((change) => change.description)
    .join("；");
  const visibilityNote =
    event.visibility === "partially_known" ? "（主角只部分知情，只能写可观察的表象）" : "";
  return [
    `${event.year}${event.month ? `年${event.month}月` : "年"}：${event.title}——${event.summary}${visibilityNote}`,
    characterChanges ? `人物变化：${characterChanges}` : "",
    relationshipChanges ? `关系变化：${relationshipChanges}` : "",
  ]
    .filter(Boolean)
    .join("｜");
}

export function buildNovelPrompt(input: NovelWriterInput): string {
  const { protagonist, npcs, relationships, startYear, endYear, span, events } = input;
  const npcLines = npcs
    .map((npc) => {
      const rel = relationships.find(
        (r) => r.characterAId === npc.id || r.characterBId === npc.id,
      );
      return `${describeCharacterForNovel(npc)}${rel ? `，与主角关系：${rel.type}` : ""}`;
    })
    .join("\n");
  const memoryLines = input.relevantMemories.length
    ? input.relevantMemories.map((m) => `- ${m.year}年：${m.summary}`).join("\n")
    : "（无）";
  const evidenceLines = input.featuredEvidence.length
    ? input.featuredEvidence
        .map((e) => `- ${e.source.title}：${e.outcomes.shortTerm[0]?.description ?? ""}`)
        .join("\n")
    : "（无）";

  const sections = [
    `# 本章信息`,
    `时间跨度 ${span} 年，从 ${startYear} 年到 ${endYear} 年。`,
    ``,
    `# 人物底色`,
    `${describeCharacterForNovel(protagonist)}`,
    npcLines,
    ``,
    `# 本章已经确定发生的事件（canonical，不可改变）`,
    events.map((event) => describeEvent(event, input)).join("\n"),
    ``,
    `# 相关记忆（用于连续性，非本章新发生）`,
    memoryLines,
    ``,
    `# 知乎现实参照（仅供现实感参考，不要复制、不要引用大段原文）`,
    evidenceLines,
  ];

  const hardConstraints = [
    `# 硬约束`,
    `1. 第二人称“你”，主角是 ${protagonist.identity.name}。`,
    `2. 不得改变上述任何事件的年份、结果、人物变化或关系变化；可以补充场景、对白、过渡、氛围与日常细节。`,
    `3. 对标记“只部分知情”的事件，只写主角可观察的表象，不写主角不可能知道的他人秘密；但可以通过行为暗示。`,
    `4. 不复制知乎作者的真实经历给游戏角色，不引用大段知乎原文。`,
    `5. ${span === 1 ? "本章约 1200-2000 中文字" : "本章约 2500-4000 中文字"}，用多个场景推进，避免“第一年/第二年/第三年”流水账。`,
  ].join("\n");

  const outputSpec = [
    `# 输出 JSON（只输出 JSON）`,
    `{"title":"20字内章节标题","subtitle":"${startYear}—${endYear}","scenes":[{"heading":"场景小标题（可选）","timeLabel":"如 2027.03","text":"该场景的正文"}]}`,
    `scenes 数量不限，按时间顺序排列；每个 scene 的 text 是该场景的完整正文段落。`,
  ].join("\n");

  return [sections.join("\n"), hardConstraints, outputSpec].join("\n\n");
}

export function parseNovel(
  modeled: ModelNovel,
  generatedAt: string,
  version: number,
  startYear: number,
  endYear: number,
): Chapter["novel"] {
  const rawScenes = Array.isArray(modeled.scenes) ? modeled.scenes : [];
  if (!rawScenes.length) throw new Error("大模型必须返回至少一个场景");
  const scenes: NovelScene[] = rawScenes.map((rawScene, index) => {
    const scene = (rawScene ?? {}) as Record<string, unknown>;
    return {
      id: `scene-${index + 1}`,
      heading: typeof scene.heading === "string" && scene.heading.trim() ? scene.heading.trim().slice(0, 40) : undefined,
      timeLabel: typeof scene.timeLabel === "string" && scene.timeLabel.trim() ? scene.timeLabel.trim().slice(0, 20) : undefined,
      text: requireText(scene.text, `scenes[${index}].text`, 4000),
    };
  });
  return {
    title: requireText(modeled.title, "title", 40),
    subtitle:
      typeof modeled.subtitle === "string" && modeled.subtitle.trim()
        ? modeled.subtitle.trim().slice(0, 40)
        : `${startYear}—${endYear}`,
    scenes,
    generatedAt,
    version,
  };
}

export async function writeNovel(input: NovelWriterInput, version = 1): Promise<Chapter["novel"]> {
  const prompt = buildNovelPrompt(input);
  const modeled = await callGameModel<ModelNovel>("chapter-novel", NOVEL_SYSTEM, prompt);
  return parseNovel(modeled, new Date().toISOString(), version, input.startYear, input.endYear);
}
