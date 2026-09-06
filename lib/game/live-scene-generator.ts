// Live Scene Generator
// 只生成当前章节的公开互动表现，不拥有 WorldState，也不直接结算选择后果。

import { callGameModel } from "../llm";
import { assertNoPrivateNarrativeLeak } from "./public-narrative-guard";
import type { Character } from "../domain/character";
import type { Chapter } from "../domain/chapter";
import type { NarrativePlan } from "../domain/narrative";
import type { DialogueCharacter, DialogueChoiceId } from "../domain/dialogue";
import type { SimulationEvent } from "../domain/simulation";
import type {
  RuntimeBlock,
  RuntimeChoice,
  RuntimeScene,
  ScenePackage,
  SceneRequirement,
  SceneTarget,
} from "../domain/scene";
import type { WorldState } from "../domain/world";
import { resolveAvatarUrl } from "./avatar-registry";
import { SCENE_CHOICE_RULES, listSceneChoiceRuleIds } from "./scene-choice-rules";
import { SCENES } from "./scene-catalog";
import { validateScenePackage } from "./scene-package-validator";

export type LiveSceneChapterContext = Pick<
  Chapter,
  "id" | "index" | "startYear" | "endYear" | "span" | "decision" | "summary"
> & {
  narrativePlan?: NarrativePlan;
};

export type LiveSceneGenerationInput = {
  world: WorldState;
  events: SimulationEvent[];
  chapter: LiveSceneChapterContext;
  version?: number;
};

type ModelCallOptions = {
  maxTokens?: number;
  timeoutMs?: number;
  responseFormat?: "json" | "text";
};

export type LiveSceneModel = (
  purpose: string,
  system: string,
  prompt: string,
  options?: ModelCallOptions,
) => Promise<unknown>;

export type LiveSceneGenerationOptions = {
  model?: LiveSceneModel;
  maxAttempts?: number;
};

type AnyRecord = Record<string, unknown>;

type DraftChoice = {
  id: DialogueChoiceId;
  label: string;
  ruleId: string;
  targetCharacterId: string;
  requirements: unknown[];
  next: unknown;
};

type DraftBlock =
  | { type: "narration"; text: string }
  | { type: "dialogue"; speakerId: string; text: string; emotion: string }
  | { type: "choice"; text: string; choices: DraftChoice[] };

type DraftScene = {
  key: string;
  background: string;
  timeLabel: string;
  characters: DialogueCharacter[];
  blocks: DraftBlock[];
  defaultNext: unknown;
  sourceEventIds: string[];
};

const LIVE_SCENE_SYSTEM =
  "你是中文视觉小说的 live 场景生成器。只输出严格 JSON，不写 Markdown。你只负责把当前公开世界状态写成可播放的对白、旁白和行动选项；程序规则才是关系和事件后果的唯一权威。不得输出或修改 WorldState，不得输出 statDelta、事件对象、私密 NPC 目标或隐藏心理。";

function isRecord(value: unknown): value is AnyRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value: unknown, path: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${path} 必须是非空字符串`);
  const text = value.trim();
  if (text.length > maximum) throw new Error(`${path} 不能超过 ${maximum} 个字符`);
  return text;
}

function stableKey(value: unknown, path: string): string {
  const key = requiredText(value, path, 80);
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(key)) {
    throw new Error(`${path} 必须是稳定的字母、数字、冒号、下划线或连字符 key`);
  }
  return key;
}

function record(value: unknown, path: string): AnyRecord {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  return value;
}

function describeCharacter(character: Character, world: WorldState): string {
  const isProtagonist = character.id === world.protagonistId;
  const publicGoals = character.state.currentGoals
    .filter((goal) => goal.status === "active")
    .slice(0, 3)
    .map((goal) => goal.label)
    .join("、");
  const publicDilemmas = character.state.currentDilemmas.slice(0, 3).join("、");
  const stats = isProtagonist
    ? `；公开资源：现金${character.state.stats.cash}、健康${character.state.stats.health}、幸福${character.state.stats.happiness}、事业${character.state.stats.career}、人脉${character.state.stats.connections}`
    : "";
  return [
    `${character.id}｜${character.identity.name}｜${isProtagonist ? "主角" : "NPC"}`,
    `年龄 ${character.state.age}；城市 ${character.state.city || "未设定"}；身份 ${character.state.occupation || character.state.socialIdentity || "未设定"}`,
    `公开性格 ${character.core.personalityTraits.slice(0, 5).join("、") || "未设定"}；价值观 ${character.core.values.slice(0, 4).join("、") || "未设定"}`,
    `说话方式 ${character.speechStyle || "表达自然，先说当下事实"}；表层情绪 ${character.emotionState || "平静"}`,
    `公开目标 ${publicGoals || "无"}；公开困境 ${publicDilemmas || "无"}${stats}`,
  ].join("；");
}

function describeRelationships(world: WorldState): string {
  const protagonistId = world.protagonistId;
  const lines = Object.values(world.relationships)
    .filter((relationship) => relationship.characterAId === protagonistId || relationship.characterBId === protagonistId)
    .map((relationship) => {
      const targetId = relationship.characterAId === protagonistId ? relationship.characterBId : relationship.characterAId;
      const target = world.characters[targetId];
      return `${targetId}（${target?.identity.name ?? "未知角色"}）｜类型 ${relationship.type}｜亲密 ${relationship.scores.closeness}｜信任 ${relationship.scores.trust}｜冲突 ${relationship.scores.conflict}｜承诺 ${relationship.scores.commitment}｜公开说明 ${relationship.publicSummary || "无"}`;
    });
  return lines.length ? lines.join("\n") : "（当前没有可用于互动的公开关系）";
}

function describeEvents(input: LiveSceneGenerationInput): string {
  return input.events.length
    ? input.events
        .slice(-12)
        .map((event) => {
          const visibility = event.visibility === "partially_known" ? "；主角只部分知情，只写可观察表象" : "";
          return `${event.id}｜${event.year}年｜${event.title}｜${event.summary}｜参与者 ${event.participantIds.join("、") || "无"}${visibility}`;
        })
        .join("\n")
    : "（本章没有额外 canonical 事件）";
}

function describeRules(): string {
  return listSceneChoiceRuleIds()
    .map((ruleId) => {
      const rule = SCENE_CHOICE_RULES[ruleId];
      const effects = Object.entries(rule.scoreDelta)
        .map(([key, value]) => `${key}${value >= 0 ? "+" : ""}${value}`)
        .join("、");
      return `- ${rule.ruleId}：${rule.title}；程序结算反馈：${rule.feedback}；关系轴变化由程序按 ${effects || "无"} 计算；必须有关系目标：${rule.requiresTargetRelationship ? "是" : "否"}`;
    })
    .join("\n");
}

function describeNarrativePlan(plan: NarrativePlan | undefined): string {
  if (!plan) return "（暂无导演规划；按当前事实组织一个短场景）";
  return [
    `主题：${plan.theme}`,
    `主冲突：${plan.mainConflict}`,
    `情绪内核：${plan.emotionalCore}`,
    `结尾方向：${plan.endingHook.type}｜${plan.endingHook.textGoal}`,
    plan.directorBrief
      ? `当前聚焦：${plan.directorBrief.focusCharacterId}｜${plan.directorBrief.dramaticQuestion}｜张力 ${plan.directorBrief.tensionLevel}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function availableTargetIds(world: WorldState): string[] {
  return Object.values(world.relationships)
    .filter((relationship) => relationship.characterAId === world.protagonistId || relationship.characterBId === world.protagonistId)
    .map((relationship) => relationship.characterAId === world.protagonistId ? relationship.characterBId : relationship.characterAId)
    .filter((id, index, ids) => ids.indexOf(id) === index && Boolean(world.characters[id]));
}

export function buildLiveScenePrompt(input: LiveSceneGenerationInput): string {
  const characters = Object.values(input.world.characters)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((character) => describeCharacter(character, input.world))
    .join("\n");
  const sceneIds = SCENES.map((scene) => scene.id).join("、");
  const targetIds = availableTargetIds(input.world).join("、") || "（无）";
  const eventIds = input.events.map((event) => event.id).join("、") || "（无）";
  const sceneSample = JSON.stringify({
    scenes: [{
      id: "scene-1",
      background: "urban-public-cafe-rain-v1",
      timeLabel: "此刻 · 临窗咖啡馆",
      characters: [{ id: input.world.protagonistId, position: "center", emotion: "平静" }],
      blocks: [
        { type: "narration", text: "可观察的环境与动作。" },
        { type: "dialogue", speakerId: targetIds === "（无）" ? input.world.protagonistId : targetIds.split("、")[0], text: "角色说出的公开对白。", emotion: "克制" },
        {
          type: "choice",
          text: "你准备怎样回应？",
          choices: [
            { id: "A", label: "行动 A", ruleId: "listen_without_promise", targetCharacterId: targetIds === "（无）" ? input.world.protagonistId : targetIds.split("、")[0], requirements: [], next: "scene-2" },
            { id: "B", label: "行动 B", ruleId: "clarify_boundary", targetCharacterId: targetIds === "（无）" ? input.world.protagonistId : targetIds.split("、")[0], requirements: [], next: "scene-2" },
            { id: "C", label: "行动 C", ruleId: "avoid_conversation", targetCharacterId: targetIds === "（无）" ? input.world.protagonistId : targetIds.split("、")[0], requirements: [], next: "chapter_end" },
          ],
        },
      ],
      defaultNext: "scene-2",
    }],
    endings: [],
  });
  const sections = [
    "# 当前公开世界状态",
    `当前年份：${input.world.currentYear}；本章：${input.chapter.id}；章节序号：${input.chapter.index + 1}；本章结算区间：${input.chapter.startYear}—${input.chapter.endYear}`,
    `主角 ID：${input.world.protagonistId}`,
    characters,
    "",
    "# 主角与 NPC 的公开关系",
    describeRelationships(input.world),
    "",
    "# 本章已确定的 canonical 事实",
    describeEvents(input),
    `玩家本章行动：${input.chapter.decision.normalizedAction}`,
    `本章公开摘要：${input.chapter.summary.keyEvents.join("；") || "无"}`,
    "",
    "# 叙事偏好（不能覆盖硬约束）",
    describeNarrativePlan(input.chapter.narrativePlan),
    "",
    "# 世界规则（由程序解释，不由模型发明）",
    describeRules(),
    "",
    "# 输出格式",
    sceneSample,
    "",
    "# 结构硬约束",
    "1. 生成 1 到 4 个 scene，所有 scene 都必须是当前年份的 live 场景；至少包含一个可执行 choice block。",
    "2. 每个 choice block 必须放在所在 scene 的最后，并且必须恰好包含 A、B、C 三个不同的行动选项；三个 ruleId 必须互不相同。",
    "3. 每个选项必须带 targetCharacterId、requirements 数组和 next；只能引用下方允许的角色、规则和目标。",
    "4. 只能写玩家可观察到的行为、对白和环境；不得写 NPC privateState、隐藏目标、私密信念或未公开因果。",
    "5. 不得输出 worldState、statDelta、relationshipDelta、events、flagsAfter 或任何直接结算字段。",
    "6. 场景图必须从第一个 scene 可达，不能有环；next 可以是 scene key、ending key 或 chapter_end；如果只生成一个 scene，所有 next/defaultNext 必须使用 chapter_end。",
    "7. background 只能从 scene-catalog ID 中选择；characters / speakerId / targetCharacterId 只能使用公开角色 ID。",
    "8. 只输出 JSON，不输出解释、Markdown 或代码围栏。",
    "",
    "# 当前状态硬约束（必须放在所有上下文之后执行）",
    `live 场景年份必须固定为 ${input.world.currentYear}；允许的角色 ID：${Object.keys(input.world.characters).sort().join("、")}`,
    `允许的关系目标 ID：${targetIds}`,
    `允许的 scene-catalog ID：${sceneIds}`,
    `允许引用的 canonical event ID：${eventIds}`,
    `允许的 ruleId：${listSceneChoiceRuleIds().join("、")}`,
    "选择的后果只能由 /api/chapter/scene-choice 的注册规则和 reducer 计算；不要在 JSON 中自行填写任何数值后果。",
  ];
  return sections.join("\n");
}

function parseCharacterList(value: unknown, path: string, world: WorldState): DialogueCharacter[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${path} 必须是非空数组`);
  const ids = new Set<string>();
  return value.map((raw, index) => {
    const item = record(raw, `${path}[${index}]`);
    const id = requiredText(item.id ?? item.characterId, `${path}[${index}].id`, 120);
    const character = world.characters[id];
    if (!character) throw new Error(`${path}[${index}].id 引用了未知角色 ${id}`);
    if (ids.has(id)) throw new Error(`${path}[${index}].id 角色重复 ${id}`);
    ids.add(id);
    const position = item.position;
    if (position !== undefined && position !== "left" && position !== "center" && position !== "right") {
      throw new Error(`${path}[${index}].position 只能是 left、center 或 right`);
    }
    const normalizedPosition = position as DialogueCharacter["position"];
    const emotion = item.emotion === undefined ? character.emotionState || "平静" : requiredText(item.emotion, `${path}[${index}].emotion`, 20);
    const avatarUrl = resolveAvatarUrl({ avatarId: character.visual?.avatarId, avatarUrl: character.visual?.avatarUrl });
    return {
      id,
      name: character.identity.name,
      ...(avatarUrl ? { avatarUrl } : {}),
      ...(normalizedPosition ? { position: normalizedPosition } : {}),
      emotion,
    };
  });
}

function parseDraftBlock(value: unknown, path: string, world: WorldState): DraftBlock {
  const item = record(value, path);
  if (item.type === "narration") return { type: "narration", text: requiredText(item.text, `${path}.text`, 1600) };
  if (item.type === "dialogue") {
    const speakerId = requiredText(item.speakerId, `${path}.speakerId`, 120);
    if (!world.characters[speakerId]) throw new Error(`${path}.speakerId 引用了未知角色 ${speakerId}`);
    return {
      type: "dialogue",
      speakerId,
      text: requiredText(item.text, `${path}.text`, 1600),
      emotion: item.emotion === undefined ? world.characters[speakerId].emotionState || "平静" : requiredText(item.emotion, `${path}.emotion`, 20),
    };
  }
  if (item.type !== "choice") throw new Error(`${path}.type 只能是 narration、dialogue 或 choice`);
  const choices = item.choices;
  if (!Array.isArray(choices) || choices.length !== 3) throw new Error(`${path}.choices 必须恰好包含三个选项`);
  const ids = new Set<string>();
  const parsed = choices.map((raw, index): DraftChoice => {
    const choice = record(raw, `${path}.choices[${index}]`);
    const id = requiredText(choice.id, `${path}.choices[${index}].id`, 1);
    if (id !== "A" && id !== "B" && id !== "C") throw new Error(`${path}.choices[${index}].id 必须是 A、B 或 C`);
    if (ids.has(id)) throw new Error(`${path}.choices[${index}].id 重复 ${id}`);
    ids.add(id);
    const targetCharacterId = requiredText(choice.targetCharacterId, `${path}.choices[${index}].targetCharacterId`, 120);
    if (!world.characters[targetCharacterId]) throw new Error(`${path}.choices[${index}].targetCharacterId 引用了未知角色 ${targetCharacterId}`);
    if (!availableTargetIds(world).includes(targetCharacterId)) {
      throw new Error(`${path}.choices[${index}].targetCharacterId ${targetCharacterId} 不是主角当前可互动的公开关系目标`);
    }
    if (!Array.isArray(choice.requirements)) throw new Error(`${path}.choices[${index}].requirements 必须是数组`);
    return {
      id: id as DialogueChoiceId,
      label: requiredText(choice.label, `${path}.choices[${index}].label`, 120),
      ruleId: requiredText(choice.ruleId, `${path}.choices[${index}].ruleId`, 80),
      targetCharacterId,
      requirements: choice.requirements,
      next: choice.next,
    };
  });
  if (new Set(parsed.map((choice) => choice.ruleId)).size !== 3) throw new Error(`${path}.choices 的三个 ruleId 必须互不相同`);
  return { type: "choice", text: requiredText(item.text, `${path}.text`, 1600), choices: parsed };
}

function parseDraftScenes(value: unknown, input: LiveSceneGenerationInput): DraftScene[] {
  const root = record(value, "liveScenePackage");
  if ("worldState" in root || "statDelta" in root || "relationshipDelta" in root || "events" in root || "flagsAfter" in root) {
    throw new Error("模型输出包含被禁止的直接结算字段");
  }
  if (!Array.isArray(root.scenes) || root.scenes.length < 1 || root.scenes.length > 4) {
    throw new Error("scenes 必须包含 1 到 4 个场景");
  }
  const scenes: DraftScene[] = root.scenes.map((raw, index) => {
    const scene = record(raw, `scenes[${index}]`);
    const key = stableKey(scene.id ?? scene.key ?? `scene-${index + 1}`, `scenes[${index}].id`);
    if (!Array.isArray(scene.blocks) || scene.blocks.length === 0) throw new Error(`scenes[${index}].blocks 必须是非空数组`);
    const blocks = scene.blocks.map((block, blockIndex) => parseDraftBlock(block, `scenes[${index}].blocks[${blockIndex}]`, input.world));
    if (blocks.filter((block) => block.type === "choice").length > 1) throw new Error(`scenes[${index}] 最多只能有一个 choice block`);
    const choiceIndex = blocks.findIndex((block) => block.type === "choice");
    if (choiceIndex >= 0 && choiceIndex !== blocks.length - 1) throw new Error(`scenes[${index}] 的 choice block 必须位于最后`);
    return {
      key,
      background: requiredText(scene.background, `scenes[${index}].background`, 100),
      timeLabel: requiredText(scene.timeLabel ?? `${input.world.currentYear} 年 · 当前场景`, `scenes[${index}].timeLabel`, 60),
      characters: parseCharacterList(scene.characters, `scenes[${index}].characters`, input.world),
      blocks,
      defaultNext: scene.defaultNext ?? scene.next,
      sourceEventIds: parseSourceEventIds(scene.sourceEventIds, `scenes[${index}].sourceEventIds`, input.events),
    };
  });
  const keys = new Set<string>();
  for (const scene of scenes) {
    if (keys.has(scene.key)) throw new Error(`场景 key 重复 ${scene.key}`);
    keys.add(scene.key);
  }
  return scenes;
}

function parseSourceEventIds(value: unknown, path: string, events: SimulationEvent[]): string[] {
  const known = new Set(events.map((event) => event.id));
  if (value === undefined) return [...known];
  if (!Array.isArray(value)) throw new Error(`${path} 必须是数组`);
  const result = value.map((eventId, index) => requiredText(eventId, `${path}[${index}]`, 160));
  for (const eventId of result) if (!known.has(eventId)) throw new Error(`${path} 引用了当前章节之外的事件 ${eventId}`);
  return [...new Set(result)];
}

function parseEndings(value: unknown, packageId: string): { endings: ScenePackage["endings"]; keys: Map<string, string> } {
  if (value === undefined) return { endings: [], keys: new Map() };
  if (!Array.isArray(value) || value.length > 4) throw new Error("endings 必须是 0 到 4 个结局");
  const keys = new Map<string, string>();
  const endings = value.map((raw, index) => {
    const item = record(raw, `endings[${index}]`);
    const key = stableKey(item.id ?? item.key ?? `ending-${index + 1}`, `endings[${index}].id`);
    if (keys.has(key)) throw new Error(`结局 key 重复 ${key}`);
    const id = `${packageId}:ending:${index + 1}`;
    keys.set(key, id);
    keys.set(`ending-${index + 1}`, id);
    return {
      id,
      title: requiredText(item.title, `endings[${index}].title`, 80),
      summary: requiredText(item.summary, `endings[${index}].summary`, 400),
    };
  });
  return { endings, keys };
}

function refMap(scenes: DraftScene[], packageId: string): Map<string, string> {
  const map = new Map<string, string>();
  scenes.forEach((scene, index) => {
    const id = `${packageId}:scene:${index + 1}`;
    map.set(scene.key, id);
    map.set(`scene-${index + 1}`, id);
    map.set(`s${index + 1}`, id);
  });
  return map;
}

function resolveReference(value: unknown, path: string, sceneKeys: Map<string, string>, endingKeys: Map<string, string>): SceneTarget {
  if (value === undefined || value === null || value === "") throw new Error(`${path} 缺失`);
  if (typeof value === "string") {
    const ref = value.trim();
    if (ref === "chapter_end" || ref === "chapter-end" || ref === "end") return { kind: "chapter_end" };
    const sceneRef = ref.startsWith("scene:") ? ref.slice(6) : ref;
    if (sceneKeys.has(sceneRef)) return { kind: "scene", sceneId: sceneKeys.get(sceneRef) as string };
    const endingRef = ref.startsWith("ending:") ? ref.slice(8) : ref;
    if (endingKeys.has(endingRef)) return { kind: "ending", endingId: endingKeys.get(endingRef) as string };
    throw new Error(`${path} 引用了未知目标 ${ref}`);
  }
  const target = record(value, path);
  if (target.kind === "chapter_end") return { kind: "chapter_end" };
  if (target.kind === "scene") {
    const sceneRef = target.sceneId ?? target.sceneKey;
    if (typeof sceneRef !== "string" || !sceneKeys.has(sceneRef)) {
      throw new Error(`${path}.sceneId 引用了未知场景 ${String(sceneRef)}`);
    }
    return { kind: "scene", sceneId: sceneKeys.get(sceneRef) as string };
  }
  if (target.kind === "ending") {
    const endingId = target.endingId ?? target.endingKey;
    if (typeof endingId !== "string" || !endingKeys.has(endingId)) throw new Error(`${path}.endingId 引用了未知结局 ${String(endingId)}`);
    return { kind: "ending", endingId: endingKeys.get(endingId) as string };
  }
  throw new Error(`${path}.kind 只能是 scene、ending 或 chapter_end`);
}

function normalizeRequirements(value: unknown[], path: string): SceneRequirement[] {
  return value.map((requirement, index) => {
    const item = record(requirement, `${path}[${index}]`);
    if (item.kind === "flag") {
      const key = requiredText(item.key, `${path}[${index}].key`, 100);
      if (typeof item.equals !== "boolean") throw new Error(`${path}[${index}].equals 必须是布尔值`);
      return { kind: "flag", key, equals: item.equals };
    }
    if (item.kind !== "relationship") throw new Error(`${path}[${index}].kind 只能是 relationship 或 flag`);
    const targetCharacterId = requiredText(item.targetCharacterId, `${path}[${index}].targetCharacterId`, 120);
    const result: SceneRequirement = { kind: "relationship", targetCharacterId };
    for (const key of ["minLevel", "minTrust", "maxConflict", "minCommitment"] as const) {
      if (item[key] !== undefined) (result as Record<string, unknown>)[key] = item[key];
    }
    return result;
  });
}

export function parseLiveScenePackage(value: unknown, input: LiveSceneGenerationInput): ScenePackage {
  assertNoPrivateNarrativeLeak(value, input.world, "live 场景");
  if (input.world.currentYear !== input.chapter.endYear) {
    throw new Error(`live 场景生成要求 WorldState 当前年份 ${input.world.currentYear} 等于章节结束年 ${input.chapter.endYear}`);
  }
  if (!availableTargetIds(input.world).length) throw new Error("当前世界没有可用于互动场景的公开关系目标");
  const version = Number.isInteger(input.version) && (input.version as number) > 0 ? (input.version as number) : 1;
  const packageId = `live-${stableKey(input.chapter.id, "chapter.id")}-v${version}`;
  const drafts = parseDraftScenes(value, input);
  const sceneKeys = refMap(drafts, packageId);
  const endings = parseEndings(isRecord(value) ? value.endings : undefined, packageId);
  const scenes: RuntimeScene[] = drafts.map((draft, index) => {
    const fallbackNext: SceneTarget = index + 1 < drafts.length
      ? { kind: "scene", sceneId: sceneKeys.get(drafts[index + 1].key) as string }
      : { kind: "chapter_end" };
    const defaultNext = draft.defaultNext === undefined ? fallbackNext : resolveReference(draft.defaultNext, `scenes[${index}].defaultNext`, sceneKeys, endings.keys);
    const blocks: RuntimeBlock[] = draft.blocks.map((block, blockIndex) => {
      const blockId = `${packageId}:scene:${index + 1}:block:${blockIndex + 1}`;
      if (block.type === "narration") return { id: blockId, content: block };
      if (block.type === "dialogue") {
        const speaker = input.world.characters[block.speakerId];
        return {
          id: blockId,
          content: { type: "dialogue", speakerId: block.speakerId, speaker: speaker.identity.name, text: block.text, emotion: block.emotion },
          cues: [{ characterId: block.speakerId, emotion: block.emotion, animation: "speaking" }],
        };
      }
      const choices: RuntimeChoice[] = block.choices.map((choice, choiceIndex) => ({
        id: choice.id,
        label: choice.label,
        ruleId: choice.ruleId,
        targetCharacterId: choice.targetCharacterId,
        requirements: normalizeRequirements(choice.requirements, `scenes[${index}].blocks[${blockIndex}].choices[${choiceIndex}].requirements`),
        next: choice.next === undefined
          ? defaultNext
          : resolveReference(choice.next, `scenes[${index}].blocks[${blockIndex}].choices[${choiceIndex}].next`, sceneKeys, endings.keys),
      }));
      return { id: blockId, content: { type: "choice", text: block.text, choices } };
    });
    return {
      id: sceneKeys.get(draft.key) as string,
      mode: "live",
      background: draft.background,
      timeLabel: draft.timeLabel,
      year: input.world.currentYear,
      sourceEventIds: draft.sourceEventIds,
      characters: draft.characters,
      blocks,
      defaultNext,
    };
  });
  if (!scenes.some((scene) => scene.blocks.some((block) => block.content.type === "choice" && block.content.readOnly !== true))) {
    throw new Error("live 场景必须至少包含一个可执行选择块");
  }
  const entryKey = isRecord(value) ? value.entrySceneId ?? value.entrySceneKey : undefined;
  let entrySceneId = scenes[0].id;
  if (entryKey !== undefined) {
    const entryTarget = resolveReference(entryKey, "entrySceneId", sceneKeys, endings.keys);
    if (entryTarget.kind !== "scene") throw new Error("entrySceneId 必须指向场景");
    entrySceneId = entryTarget.sceneId;
  }
  return validateScenePackage({
    schemaVersion: 1,
    id: packageId,
    version,
    chapterId: input.chapter.id,
    entrySceneId,
    scenes,
    endings: endings.endings,
  }, {
    world: input.world,
    flags: {},
    currentYear: input.world.currentYear,
    chapterId: input.chapter.id,
    knownRuleIds: listSceneChoiceRuleIds(),
    knownEventIds: input.events.map((event) => event.id),
    checkAvailability: true,
    scope: "general",
  });
}

export async function generateLiveScenePackage(
  input: LiveSceneGenerationInput,
  options: LiveSceneGenerationOptions = {},
): Promise<ScenePackage> {
  const maxAttempts = options.maxAttempts ?? 3;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 4) throw new Error("maxAttempts 必须是 1 到 4");
  const model = options.model ?? (callGameModel as unknown as LiveSceneModel);
  const basePrompt = buildLiveScenePrompt(input);
  let correction = "";
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const modeled = await model(
        "chapter-live-scene",
        LIVE_SCENE_SYSTEM,
        `${basePrompt}${correction}`,
        { maxTokens: 6500, timeoutMs: 120_000, responseFormat: "json" },
      );
      return parseLiveScenePackage(modeled, input);
    } catch (error) {
      const message = error instanceof Error ? error.message : "live 场景未通过程序校验";
      if (attempt === maxAttempts - 1) throw new Error(`AI 互动场景生成失败：${message}`);
      correction = `\n\n# 上一次输出的程序校验反馈（只修正这些问题，然后重新输出完整 JSON）\n${message}\n不要改变当前年份、角色 ID、事件 ID 或已允许的 ruleId。`;
    }
  }
  throw new Error("AI 互动场景生成失败");
}
