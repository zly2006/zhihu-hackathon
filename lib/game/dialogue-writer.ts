// Dialogue Writer（V2.1）
// 只把已结算的公开世界信息转换为结构化表现数据；不参与 WorldState 结算。

import { callGameModel } from "../llm";
import type { Character } from "../domain/character";
import type { NovelScene } from "../domain/chapter";
import type { DialogueBlock, DialogueChoice, DialogueChoiceId, DialogueScene } from "../domain/dialogue";
import type { NarrativePlan } from "../domain/narrative";
import type { SimulationEvent } from "../domain/simulation";
import type { WorldState } from "../domain/world";
import { resolveAvatarUrl } from "./avatar-registry";
import { SCENES, findScene, pickSceneForNovelScene } from "./scene-catalog";

export type DialogueWriterInput = {
  world: WorldState;
  events: SimulationEvent[];
  novelScenes: NovelScene[];
  narrativePlan?: NarrativePlan;
};

type ModelDialogue = {
  scenes?: unknown;
};

type PublicCharacter = {
  alias: string;
  character: Character;
};

const MAX_BLOCK_TEXT = 1600;
const MAX_CHOICE_LABEL = 120;
const VALID_POSITIONS = new Set(["left", "center", "right"]);
const VALID_CHOICE_IDS = new Set<DialogueChoiceId>(["A", "B", "C"]);

const DIALOGUE_SYSTEM =
  "你是中文视觉小说 Dialogue Writer。只输出严格 JSON，不写 Markdown。你只能把已结算的公开事件和小说场景改写成对白、旁白与展示选择，不能创造或改变世界状态。角色的未知心理只能通过可观察行为暗示，不能泄露任何未公开信息。";

function requireText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Dialogue 字段 ${field} 缺失`);
  }
  const text = value.trim();
  if (text.length > maximum) {
    throw new Error(`Dialogue 字段 ${field} 超过 ${maximum} 字符`);
  }
  return text;
}

function optionalText(value: unknown, field: string, maximum: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requireText(value, field, maximum);
}

function expectedSceneCount(input: DialogueWriterInput): number {
  const plannedCount = input.narrativePlan?.scenes.length ?? 0;
  return Math.max(1, plannedCount || input.novelScenes.length);
}

function publicCharacters(input: DialogueWriterInput): PublicCharacter[] {
  const protagonist = input.world.characters[input.world.protagonistId];
  const others = Object.values(input.world.characters)
    .filter((character) => character.id !== input.world.protagonistId)
    .sort((left, right) => left.id.localeCompare(right.id));
  return [protagonist, ...others].filter(Boolean).map((character, index) => ({
    alias: `C${index + 1}`,
    character,
  }));
}

function characterByAlias(input: DialogueWriterInput): Map<string, PublicCharacter> {
  return new Map(publicCharacters(input).map((item) => [item.alias, item]));
}

function characterAvatar(character: Character): string | undefined {
  return (
    resolveAvatarUrl({
      avatarId: character.visual?.avatarId,
      avatarUrl: character.visual?.avatarUrl,
    }) ?? undefined
  );
}

function describePublicCharacter(item: PublicCharacter, input: DialogueWriterInput): string {
  const { character } = item;
  const relationships = Object.values(input.world.relationships)
    .filter((relationship) => relationship.characterAId === character.id || relationship.characterBId === character.id)
    .map((relationship) => `${relationship.type}：${relationship.publicSummary}`)
    .join("；");
  const memories =
    character.id === input.world.protagonistId
      ? character.memoryIds
          .map((memoryId) => input.world.memories[memoryId])
          .filter((memory) => memory?.active)
          .slice(-3)
          .map((memory) => `${memory.year}年：${memory.summary}`)
          .join("；")
      : "";
  const history = (character.relationshipHistory ?? [])
    .slice(-3)
    .map((entry) => `${entry.year}年${entry.relationshipType}：${entry.summary}`)
    .join("；");
  return [
    `${item.alias}｜${character.identity.name}｜${character.role === "protagonist" ? "主角" : "NPC"}`,
    `年龄：${character.state.age}；城市：${character.state.city || "未设定"}；职业：${character.state.occupation || "未设定"}`,
    `公开性格：${character.core.personalityTraits.join("、") || "未设定"}；价值观：${character.core.values.join("、") || "未设定"}`,
    `说话方式：${character.speechStyle || "表达自然，先说当下事实"}；当前表层情绪：${character.emotionState || "平静"}`,
    `公开关系：${relationships || "无"}`,
    `已知记忆：${memories || "无"}`,
    `关系历史摘要：${history || "无"}`,
  ].join("；");
}

function describeEvent(event: SimulationEvent, input: DialogueWriterInput): string {
  const participants = event.participantIds
    .map((id) => {
      const item = publicCharacters(input).find((candidate) => candidate.character.id === id);
      return item ? `${item.alias}（${item.character.identity.name}）` : "未知角色";
    })
    .join("、");
  const visibility = event.visibility === "partially_known" ? "；主角只部分知情，只写可观察表象" : "";
  return `${event.year}年｜${event.title}｜${event.summary}｜参与者：${participants || "无"}${visibility}`;
}

function describePlan(plan: NarrativePlan, input: DialogueWriterInput): string {
  return plan.scenes
    .map((scene) => {
      const participants = scene.participantIds
        .map((id) => publicCharacters(input).find((item) => item.character.id === id)?.alias ?? id)
        .join("、");
      return [
        `${scene.order}. ${scene.id}｜${scene.timeLabel}｜${scene.location}｜${scene.purpose}`,
        `参与者：${participants}；目标：${scene.visibleGoal}；冲突：${scene.conflict}`,
        `必须呈现：${scene.mustShow.join("；") || "无"}；禁止编造：${scene.mustNotInvent.join("；") || "无"}`,
      ].join("；");
    })
    .join("\n");
}

export function buildDialoguePrompt(input: DialogueWriterInput): string {
  const characters = publicCharacters(input);
  const scenes = input.novelScenes.length
    ? input.novelScenes.map((scene, index) => `${index + 1}. ${scene.id}｜${scene.timeLabel || "未标时间"}｜${scene.heading || ""}\n${scene.text}`).join("\n")
    : "（无 NovelScene，按导演规划生成结构化场景）";
  const expected = expectedSceneCount(input);
  const sections = [
    "# 公开角色上下文",
    characters.map((item) => describePublicCharacter(item, input)).join("\n"),
    "",
    "# 已确定的 canonical 事件",
    input.events.map((event) => describeEvent(event, input)).join("\n") || "（无）",
    "",
    "# 小说场景草稿",
    scenes,
  ];
  if (input.narrativePlan) {
    sections.push("", "# 叙事导演规划", describePlan(input.narrativePlan, input));
  }
  sections.push(
    "",
    "# 输出格式",
    '{"scenes":[{"id":"scene-1","background":"urban-home-apartment-night-v1","timeLabel":"2027.03","characters":[{"characterId":"C1","position":"left","emotion":"平静"}],"blocks":[{"type":"narration","text":"旁白"},{"type":"dialogue","speakerId":"C2","text":"对白","emotion":"克制"}],"choices":[]}]}' ,
    "",
    "# 结构硬约束",
    `1. 必须返回恰好 ${expected} 个 scenes，顺序对应小说场景或导演规划。`,
    `2. background 只能从以下 scene-catalog ID 选择：${SCENES.map((scene) => scene.id).join("、")}。`,
    `3. characterId 和 speakerId 只能使用上述 C 别名；不得创建幽灵角色、外部头像或新事实。`,
    "4. block.type 只能是 dialogue、narration、choice；所有 text 必须非空。",
    "5. dialogue 只能写角色可观察、玩家可知的内容；不得输出任何隐藏心理、隐藏目标、私密信念或未公开因果。",
    "6. choice 的 id 只能是 A/B/C 且每个场景最多 3 个；本次选择仅供展示，不改变 canonical 结算。",
    "7. 只能输出 JSON，不要输出解释、Markdown 或额外字段说明。",
  );
  return sections.join("\n");
}

function resolveCharacterAlias(
  alias: unknown,
  aliases: Map<string, PublicCharacter>,
  field: string,
): PublicCharacter {
  if (typeof alias !== "string" || !aliases.has(alias)) {
    throw new Error(`未知角色别名：${String(alias)}（字段 ${field}）`);
  }
  return aliases.get(alias) as PublicCharacter;
}

function parseChoices(value: unknown, field: string, required: boolean): DialogueChoice[] {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value)) throw new Error(`Dialogue 字段 ${field} 必须是数组`);
  if (value.length > 3 || (required && value.length === 0)) {
    throw new Error(`Dialogue 字段 ${field} 必须包含 1 到 3 个选项`);
  }
  const ids = new Set<string>();
  return value.map((raw, index) => {
    const choice = (raw ?? {}) as Record<string, unknown>;
    const id = requireText(choice.id, `${field}[${index}].id`, 1) as DialogueChoiceId;
    if (!VALID_CHOICE_IDS.has(id) || ids.has(id)) throw new Error(`Dialogue 字段 ${field}[${index}].id 非法或重复`);
    ids.add(id);
    return { id, label: requireText(choice.label, `${field}[${index}].label`, MAX_CHOICE_LABEL) };
  });
}

function parseBlock(
  raw: unknown,
  field: string,
  aliases: Map<string, PublicCharacter>,
): DialogueBlock {
  const block = (raw ?? {}) as Record<string, unknown>;
  if (block.type === "narration") {
    return { type: "narration", text: requireText(block.text, `${field}.text`, MAX_BLOCK_TEXT) };
  }
  if (block.type === "dialogue") {
    const speaker = resolveCharacterAlias(block.speakerId, aliases, `${field}.speakerId`);
    const avatar = characterAvatar(speaker.character);
    return {
      type: "dialogue",
      speaker: speaker.character.identity.name,
      speakerId: speaker.character.id,
      text: requireText(block.text, `${field}.text`, MAX_BLOCK_TEXT),
      emotion:
        optionalText(block.emotion, `${field}.emotion`, 20) || speaker.character.emotionState || "平静",
      ...(avatar ? { avatar } : {}),
    };
  }
  if (block.type === "choice") {
    return {
      type: "choice",
      text: requireText(block.text, `${field}.text`, MAX_BLOCK_TEXT),
      choices: parseChoices(block.choices, `${field}.choices`, true),
    };
  }
  throw new Error(`非法 block type：${String(block.type)}`);
}

export function parseDialogue(modeled: unknown, input: DialogueWriterInput): DialogueScene[] {
  const output = (modeled ?? {}) as ModelDialogue;
  if (!Array.isArray(output.scenes)) throw new Error("Dialogue 输出缺少 scenes 数组");
  const expected = expectedSceneCount(input);
  if (output.scenes.length !== expected) {
    throw new Error(`Dialogue 场景数 ${output.scenes.length} 与预期 ${expected} 不一致`);
  }
  const aliases = characterByAlias(input);
  const seenSceneIds = new Set<string>();
  return output.scenes.map((raw, sceneIndex) => {
    const scene = (raw ?? {}) as Record<string, unknown>;
    const id = requireText(scene.id ?? input.novelScenes[sceneIndex]?.id ?? `scene-${sceneIndex + 1}`, `scenes[${sceneIndex}].id`, 80);
    if (seenSceneIds.has(id)) throw new Error(`Dialogue 场景 id 重复：${id}`);
    seenSceneIds.add(id);
    const background = requireText(scene.background, `scenes[${sceneIndex}].background`, 80);
    if (!findScene(background)) throw new Error(`Dialogue 背景不在 scene-catalog：${background}`);
    if (!Array.isArray(scene.characters)) throw new Error(`Dialogue 字段 scenes[${sceneIndex}].characters 必须是数组`);
    const seenCharacters = new Set<string>();
    const characters = scene.characters.map((rawCharacter, characterIndex) => {
      const item = (rawCharacter ?? {}) as Record<string, unknown>;
      const alias = item.characterId ?? item.id;
      const resolved = resolveCharacterAlias(alias, aliases, `scenes[${sceneIndex}].characters[${characterIndex}]`);
      if (seenCharacters.has(resolved.character.id)) throw new Error(`Dialogue 角色重复：${String(alias)}`);
      seenCharacters.add(resolved.character.id);
      const position = item.position;
      if (position !== undefined && (typeof position !== "string" || !VALID_POSITIONS.has(position))) {
        throw new Error(`Dialogue 角色位置非法：${String(position)}`);
      }
      const avatar = characterAvatar(resolved.character);
      const emotion =
        optionalText(item.emotion, `scenes[${sceneIndex}].characters[${characterIndex}].emotion`, 20) ||
        resolved.character.emotionState;
      return {
        id: resolved.character.id,
        name: resolved.character.identity.name,
        ...(avatar ? { avatarUrl: avatar } : {}),
        ...(position ? { position: position as "left" | "center" | "right" } : {}),
        ...(emotion ? { emotion } : {}),
      };
    });
    if (!Array.isArray(scene.blocks) || scene.blocks.length === 0) {
      throw new Error(`Dialogue 场景 ${id} 缺少 blocks`);
    }
    const blocks = scene.blocks.map((block, blockIndex) =>
      parseBlock(block, `scenes[${sceneIndex}].blocks[${blockIndex}]`, aliases),
    );
    const choices = parseChoices(scene.choices, `scenes[${sceneIndex}].choices`, false);
    if (choices.length > 0) {
      throw new Error(`Dialogue 场景 ${id} 的 choices 必须为空，本 Sprint 不接入新结算入口`);
    }
    return {
      id,
      background,
      timeLabel:
        optionalText(scene.timeLabel, `scenes[${sceneIndex}].timeLabel`, 30) || input.novelScenes[sceneIndex]?.timeLabel,
      characters,
      blocks,
      choices: [],
    };
  });
}

export function buildFallbackDialogueScenes(input: DialogueWriterInput): DialogueScene[] {
  const protagonist = input.world.characters[input.world.protagonistId];
  return input.novelScenes.map((novelScene) => {
    const background = pickSceneForNovelScene(novelScene);
    const avatar = protagonist ? characterAvatar(protagonist) : undefined;
    return {
      id: novelScene.id,
      background: background.id,
      timeLabel: novelScene.timeLabel,
      characters: protagonist
        ? [
            {
              id: protagonist.id,
              name: protagonist.identity.name,
              ...(avatar ? { avatarUrl: avatar } : {}),
              position: "center" as const,
              emotion: protagonist.emotionState || "平静",
            },
          ]
        : [],
      blocks: [{ type: "narration" as const, text: novelScene.text }],
      choices: [],
    };
  });
}

export async function writeDialogue(input: DialogueWriterInput): Promise<DialogueScene[]> {
  const modeled = await callGameModel<ModelDialogue>("chapter-dialogue", DIALOGUE_SYSTEM, buildDialoguePrompt(input), {
    maxTokens: 5000,
    timeoutMs: 120_000,
  });
  return parseDialogue(modeled, input);
}
