import { findScene } from "./scene-catalog";
import type { DialogueCharacter } from "../domain/dialogue";
import type {
  ReadOnlyChoice,
  RelationshipLevel,
  RuntimeBlock,
  RuntimeChoice,
  RuntimeScene,
  SceneCue,
  ScenePackage,
  SceneRequirement,
  SceneTarget,
} from "../domain/scene";
import type { WorldState } from "../domain/world";

export const DEFAULT_SCENE_RULE_IDS = new Set([
  "listen_without_promise",
  "clarify_boundary",
  "avoid_conversation",
  "make_joint_plan",
  "respect_distance",
  "honest_talk",
  "move_forward",
  "separate_paths",
]);

export type SceneValidationContext = {
  world?: WorldState;
  flags?: Record<string, boolean>;
  currentYear?: number;
  chapterId?: string;
  knownRuleIds?: Iterable<string>;
  knownEventIds?: Iterable<string>;
  checkAvailability?: boolean;
};

export class ScenePackageValidationError extends Error {
  readonly path: string;
  readonly code: string;

  constructor(path: string, code: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "ScenePackageValidationError";
    this.path = path;
    this.code = code;
  }
}

type AnyRecord = Record<string, unknown>;

function isRecord(value: unknown): value is AnyRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fail(path: string, code: string, message: string): never {
  throw new ScenePackageValidationError(path, code, message);
}

function requiredString(value: unknown, path: string, code = "invalid_field"): string {
  if (typeof value !== "string" || !value.trim()) fail(path, code, "必须是非空字符串");
  return value;
}

function stableId(value: unknown, path: string): string {
  const id = requiredString(value, path, "invalid_id");
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(id)) {
    fail(path, "invalid_id", "必须是稳定的字母、数字、冒号、下划线或连字符 ID");
  }
  return id;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) fail(path, "invalid_number", "必须是非负整数");
  return value as number;
}

function finiteBounded(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    fail(path, "invalid_requirement", "必须是 0 到 100 的有限数字");
  }
  return value;
}

function relationshipLevel(value: unknown, path: string): RelationshipLevel {
  if (value !== "stranger" && value !== "familiar" && value !== "friend" && value !== "trusted" && value !== "important") {
    fail(path, "invalid_requirement", "不是有效的关系等级");
  }
  return value;
}

function normalizeContext(input?: SceneValidationContext | WorldState): SceneValidationContext {
  if (!input) return {};
  if (isRecord(input) && "world" in input) return input as SceneValidationContext;
  if (isRecord(input) && "characters" in input && "relationships" in input) {
    return { world: input as unknown as WorldState };
  }
  return input as SceneValidationContext;
}

function clonePackage(pkg: ScenePackage): ScenePackage {
  return JSON.parse(JSON.stringify(pkg)) as ScenePackage;
}

function worldCharacterIds(context: SceneValidationContext): Set<string> | undefined {
  return context.world ? new Set(Object.keys(context.world.characters)) : undefined;
}

function relationshipForTarget(world: WorldState, targetCharacterId: string) {
  return Object.values(world.relationships).find(
    (relationship) =>
      (relationship.characterAId === world.protagonistId && relationship.characterBId === targetCharacterId) ||
      (relationship.characterBId === world.protagonistId && relationship.characterAId === targetCharacterId),
  );
}

function affinity(scores: { closeness: number; trust: number; conflict: number }): number {
  return scores.closeness * 0.6 + scores.trust * 0.4 - scores.conflict * 0.3;
}

function levelForAffinity(value: number): RelationshipLevel {
  if (value < 20) return "stranger";
  if (value < 40) return "familiar";
  if (value < 60) return "friend";
  if (value < 80) return "trusted";
  return "important";
}

function requirementSatisfied(requirement: SceneRequirement, context: SceneValidationContext): boolean {
  if (requirement.kind === "flag") {
    return context.flags ? context.flags[requirement.key] === requirement.equals : false;
  }
  if (!context.world) return true;
  const relationship = relationshipForTarget(context.world, requirement.targetCharacterId);
  if (!relationship) return false;
  if (requirement.minLevel && levelForAffinity(affinity(relationship.scores)) !== requirement.minLevel) {
    const order: RelationshipLevel[] = ["stranger", "familiar", "friend", "trusted", "important"];
    if (order.indexOf(levelForAffinity(affinity(relationship.scores))) < order.indexOf(requirement.minLevel)) return false;
  }
  if (requirement.minTrust !== undefined && relationship.scores.trust < requirement.minTrust) return false;
  if (requirement.maxConflict !== undefined && relationship.scores.conflict > requirement.maxConflict) return false;
  if (requirement.minCommitment !== undefined && relationship.scores.commitment < requirement.minCommitment) return false;
  return true;
}

function validateRequirement(
  value: unknown,
  path: string,
  context: SceneValidationContext,
  characterIds: Set<string>,
): SceneRequirement {
  if (!isRecord(value)) fail(path, "invalid_requirement", "必须是对象");
  if (value.kind === "flag") {
    const key = requiredString(value.key, `${path}.key`, "invalid_requirement");
    if (typeof value.equals !== "boolean") fail(`${path}.equals`, "invalid_requirement", "必须是布尔值");
    return { kind: "flag", key, equals: value.equals };
  }
  if (value.kind !== "relationship") fail(`${path}.kind`, "invalid_requirement", "只支持 relationship 或 flag");
  const targetCharacterId = stableId(value.targetCharacterId, `${path}.targetCharacterId`);
  if (!characterIds.has(targetCharacterId)) {
    fail(`${path}.targetCharacterId`, "unknown_character", `不存在角色 ${targetCharacterId}`);
  }
  const normalized: SceneRequirement = { kind: "relationship", targetCharacterId };
  if (value.minLevel !== undefined) normalized.minLevel = relationshipLevel(value.minLevel, `${path}.minLevel`);
  if (value.minTrust !== undefined) normalized.minTrust = finiteBounded(value.minTrust, `${path}.minTrust`);
  if (value.maxConflict !== undefined) normalized.maxConflict = finiteBounded(value.maxConflict, `${path}.maxConflict`);
  if (value.minCommitment !== undefined) normalized.minCommitment = finiteBounded(value.minCommitment, `${path}.minCommitment`);
  if (Object.keys(normalized).length === 1) fail(path, "invalid_requirement", "关系门槛至少要包含一个条件");
  // Keep this call in the validator so a context with a missing relationship is rejected
  // before the package can be presented as executable.
  if (context.world && !relationshipForTarget(context.world, targetCharacterId)) {
    fail(`${path}.targetCharacterId`, "missing_relationship", "当前世界没有对应关系，不能隐式创建关系");
  }
  return normalized;
}

function targetSceneId(target: SceneTarget): string | undefined {
  return target.kind === "scene" ? target.sceneId : undefined;
}

function validateTarget(
  value: unknown,
  path: string,
  sceneIds: Set<string>,
  endingIds: Set<string>,
): SceneTarget {
  if (!isRecord(value) || typeof value.kind !== "string") fail(path, "invalid_target", "必须是带 kind 的目标");
  if (value.kind === "scene") {
    const sceneId = stableId(value.sceneId, `${path}.sceneId`);
    if (!sceneIds.has(sceneId)) fail(`${path}.sceneId`, "unknown_target", `不存在场景 ${sceneId}`);
    return { kind: "scene", sceneId };
  }
  if (value.kind === "ending") {
    const endingId = stableId(value.endingId, `${path}.endingId`);
    if (!endingIds.has(endingId)) fail(`${path}.endingId`, "unknown_target", `不存在结局 ${endingId}`);
    return { kind: "ending", endingId };
  }
  if (value.kind === "chapter_end") return { kind: "chapter_end" };
  fail(`${path}.kind`, "invalid_target", "只支持 scene、chapter_end 或 ending");
}

function validateCharacters(
  characters: unknown,
  path: string,
  context: SceneValidationContext,
): DialogueCharacter[] {
  if (!Array.isArray(characters) || characters.length === 0) fail(path, "invalid_characters", "场景至少需要一个公开角色");
  const knownWorldIds = worldCharacterIds(context);
  const ids = new Set<string>();
  return characters.map((raw, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(raw)) fail(itemPath, "invalid_character", "必须是角色对象");
    const id = stableId(raw.id, `${itemPath}.id`);
    if (ids.has(id)) fail(`${itemPath}.id`, "duplicate_id", `场景内角色 ID 重复 ${id}`);
    if (knownWorldIds && !knownWorldIds.has(id)) fail(`${itemPath}.id`, "unknown_character", `世界中不存在角色 ${id}`);
    ids.add(id);
    const name = requiredString(raw.name, `${itemPath}.name`);
    const result: DialogueCharacter = { id, name };
    if (typeof raw.avatarId === "string") result.avatarId = raw.avatarId;
    if (typeof raw.avatarUrl === "string") result.avatarUrl = raw.avatarUrl;
    if (raw.position === "left" || raw.position === "center" || raw.position === "right") result.position = raw.position;
    if (raw.emotion !== undefined) result.emotion = requiredString(raw.emotion, `${itemPath}.emotion`);
    return result;
  });
}

function validateCues(value: unknown, path: string, characterIds: Set<string>): SceneCue[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) fail(path, "invalid_cue", "必须是 cue 数组");
  return value.map((rawCue, index) => {
    const cuePath = `${path}[${index}]`;
    if (!isRecord(rawCue)) fail(cuePath, "invalid_cue", "必须是 cue 对象");
    const characterId = stableId(rawCue.characterId, `${cuePath}.characterId`);
    if (!characterIds.has(characterId)) fail(`${cuePath}.characterId`, "unknown_character", `场景中不存在角色 ${characterId}`);
    if (rawCue.emotion !== undefined && typeof rawCue.emotion !== "string") fail(`${cuePath}.emotion`, "invalid_cue", "必须是字符串");
    if (rawCue.pose !== undefined && typeof rawCue.pose !== "string") fail(`${cuePath}.pose`, "invalid_cue", "必须是字符串");
    const animation = rawCue.animation;
    const isSupportedAnimation = animation === undefined || animation === "idle" || animation === "speaking" || animation === "focus" || animation === "shake" || animation === "enter" || animation === "exit";
    if (!isSupportedAnimation) {
      fail(`${cuePath}.animation`, "invalid_cue", "不是受支持的动画 cue");
    }
    const normalizedAnimation = animation as SceneCue["animation"];
    return {
      characterId,
      ...(typeof rawCue.emotion === "string" ? { emotion: rawCue.emotion } : {}),
      ...(typeof rawCue.pose === "string" ? { pose: rawCue.pose } : {}),
      ...(normalizedAnimation ? { animation: normalizedAnimation } : {}),
    };
  });
}

function validateBlock(
  raw: unknown,
  path: string,
  scene: { mode: RuntimeScene["mode"]; characters: DialogueCharacter[] },
  context: SceneValidationContext,
  ruleIds: Set<string>,
  sceneIds: Set<string>,
  endingIds: Set<string>,
): RuntimeBlock {
  if (!isRecord(raw)) fail(path, "invalid_block", "必须是对白、旁白或选择块");
  const id = stableId(raw.id, `${path}.id`);
  if (!isRecord(raw.content) || typeof raw.content.type !== "string") fail(`${path}.content`, "invalid_block", "缺少 content.type");
  const characterIds = new Set(scene.characters.map((character) => character.id));
  if (raw.content.type === "narration") {
    const cues = validateCues(raw.cues, `${path}.cues`, characterIds);
    return { id, content: { type: "narration", text: requiredString(raw.content.text, `${path}.content.text`) }, ...(cues ? { cues } : {}) };
  }
  if (raw.content.type === "dialogue") {
    const speakerId = stableId(raw.content.speakerId, `${path}.content.speakerId`);
    if (!characterIds.has(speakerId)) fail(`${path}.content.speakerId`, "unknown_character", `场景中不存在说话角色 ${speakerId}`);
    const emotion = requiredString(raw.content.emotion ?? "平静", `${path}.content.emotion`);
    const content = {
      type: "dialogue" as const,
      speakerId,
      speaker: requiredString(raw.content.speaker, `${path}.content.speaker`),
      text: requiredString(raw.content.text, `${path}.content.text`),
      emotion,
      ...(typeof raw.content.avatar === "string" ? { avatar: raw.content.avatar } : {}),
    };
    const result: RuntimeBlock = { id, content };
    const cues = validateCues(raw.cues, `${path}.cues`, characterIds);
    if (cues) result.cues = cues;
    return result;
  }
  if (raw.content.type !== "choice") fail(`${path}.content.type`, "invalid_block", "未知块类型");
  const readOnly = raw.content.readOnly === true;
  if (!Array.isArray(raw.content.choices)) fail(`${path}.content.choices`, "invalid_choices", "choices 必须是数组");
  if (raw.content.choices.length < (readOnly ? 1 : 2) || raw.content.choices.length > 3) {
    fail(`${path}.content.choices`, "invalid_choice_count", readOnly ? "只读选择数量必须是 1 到 3" : "可执行选择数量必须是 2 到 3");
  }
  const choiceIds = new Set<string>();
  const choices = raw.content.choices.map((rawChoice, index) => {
    const choicePath = `${path}.content.choices[${index}]`;
    if (!isRecord(rawChoice)) fail(choicePath, "invalid_choice", "必须是选择对象");
    const choiceId = rawChoice.id;
    if (choiceId !== "A" && choiceId !== "B" && choiceId !== "C") fail(`${choicePath}.id`, "invalid_choice", "选择 ID 必须是 A、B 或 C");
    if (choiceIds.has(choiceId)) fail(`${choicePath}.id`, "duplicate_id", `选择 ID 重复 ${choiceId}`);
    choiceIds.add(choiceId);
    const label = requiredString(rawChoice.label, `${choicePath}.label`);
    if (readOnly) return { id: choiceId, label } as ReadOnlyChoice;
    if (scene.mode !== "live") fail(`${path}.content`, "retrospective_choice", "回顾场景不能包含可执行选择");
    const ruleId = stableId(rawChoice.ruleId, `${choicePath}.ruleId`);
    if (!ruleIds.has(ruleId)) fail(`${choicePath}.ruleId`, "unknown_rule", `未注册场景规则 ${ruleId}`);
    const targetCharacterId = rawChoice.targetCharacterId === undefined ? undefined : stableId(rawChoice.targetCharacterId, `${choicePath}.targetCharacterId`);
    if (targetCharacterId && !characterIds.has(targetCharacterId)) fail(`${choicePath}.targetCharacterId`, "unknown_character", `场景中不存在目标角色 ${targetCharacterId}`);
    if (!Array.isArray(rawChoice.requirements)) fail(`${choicePath}.requirements`, "invalid_requirement", "必须是数组");
    const requirements = rawChoice.requirements.map((requirement, reqIndex) =>
      validateRequirement(requirement, `${choicePath}.requirements[${reqIndex}]`, context, characterIds),
    );
    const next = validateTarget(rawChoice.next, `${choicePath}.next`, sceneIds, endingIds);
    return { id: choiceId, label, ...(targetCharacterId ? { targetCharacterId } : {}), ruleId, requirements, next } as RuntimeChoice;
  });
  if (context.checkAvailability !== false && !readOnly && scene.mode === "live" && choices.every((choice) => !requirementSatisfiedForChoice(choice as RuntimeChoice, context))) {
    fail(`${path}.content.choices`, "all_choices_locked", "当前状态下没有可执行选择");
  }
  if (typeof raw.content.text !== "string" || !raw.content.text.trim()) fail(`${path}.content.text`, "invalid_choice", "选择提示不能为空");
  const cues = validateCues(raw.cues, `${path}.cues`, characterIds);
  return { id, content: { type: "choice", text: raw.content.text, choices, ...(readOnly ? { readOnly: true } : {}) }, ...(cues ? { cues } : {}) };
}

function requirementSatisfiedForChoice(choice: RuntimeChoice, context: SceneValidationContext): boolean {
  return choice.requirements.every((requirement) => requirementSatisfied(requirement, context));
}

function validateScene(
  raw: unknown,
  path: string,
  context: SceneValidationContext,
  ruleIds: Set<string>,
  sceneIds: Set<string>,
  endingIds: Set<string>,
  knownWorldIds: Set<string> | undefined,
): RuntimeScene {
  if (!isRecord(raw)) fail(path, "invalid_scene", "必须是场景对象");
  const id = stableId(raw.id, `${path}.id`);
  const mode = raw.mode === "live" || raw.mode === "retrospective" ? raw.mode : fail(`${path}.mode`, "invalid_mode", "必须是 live 或 retrospective");
  const yearValue = raw.year;
  if (!Number.isInteger(yearValue)) fail(`${path}.year`, "invalid_number", "必须是整数年份");
  const year = yearValue as number;
  if (mode === "live" && context.currentYear !== undefined && year !== context.currentYear) {
    fail(`${path}.year`, "year_mismatch", `live 场景年份必须等于当前年份 ${context.currentYear}`);
  }
  const characters = validateCharacters(raw.characters, `${path}.characters`, context);
  if (knownWorldIds && characters.some((character) => !knownWorldIds.has(character.id))) {
    fail(`${path}.characters`, "unknown_character", "场景包含世界中不存在的角色");
  }
  if (typeof raw.background !== "string" || !findScene(raw.background)) fail(`${path}.background`, "invalid_background", `场景目录中不存在背景 ${String(raw.background)}`);
  if (!Array.isArray(raw.sourceEventIds)) fail(`${path}.sourceEventIds`, "invalid_event_reference", "必须是事件 ID 数组");
  const sourceEventIds = raw.sourceEventIds.map((eventId, index) => stableId(eventId, `${path}.sourceEventIds[${index}]`));
  const knownEvents = context.knownEventIds ? new Set(context.knownEventIds) : context.world ? new Set(context.world.canonicalEventIds) : undefined;
  if (knownEvents) {
    for (let index = 0; index < sourceEventIds.length; index += 1) {
      if (!knownEvents.has(sourceEventIds[index])) fail(`${path}.sourceEventIds[${index}]`, "unknown_event", `不存在事件 ${sourceEventIds[index]}`);
    }
  }
  if (!Array.isArray(raw.blocks) || raw.blocks.length === 0) fail(`${path}.blocks`, "invalid_blocks", "场景至少需要一个块");
  const blocks = raw.blocks.map((block, index) => validateBlock(block, `${path}.blocks[${index}]`, { mode, characters }, context, ruleIds, sceneIds, endingIds));
  if (mode === "live" && blocks.filter((block) => block.content.type === "choice").length > 1) {
    fail(`${path}.blocks`, "multiple_choice_blocks", "每个 live 场景最多一个选择块");
  }
  const blockIds = new Set<string>();
  for (const [index, block] of blocks.entries()) {
    if (blockIds.has(block.id)) fail(`${path}.blocks[${index}].id`, "duplicate_id", `块 ID 重复 ${block.id}`);
    blockIds.add(block.id);
  }
  return {
    id,
    mode,
    background: raw.background,
    timeLabel: requiredString(raw.timeLabel ?? `${year} 年`, `${path}.timeLabel`),
    year,
    sourceEventIds,
    characters,
    blocks,
    defaultNext: validateTarget(raw.defaultNext, `${path}.defaultNext`, sceneIds, endingIds),
  };
}

function cloneTarget(target: SceneTarget): SceneTarget {
  return target.kind === "scene" ? { kind: "scene", sceneId: target.sceneId } : target.kind === "ending" ? { kind: "ending", endingId: target.endingId } : { kind: "chapter_end" };
}

export function validateScenePackage(value: unknown, input?: SceneValidationContext | WorldState): ScenePackage {
  const context = normalizeContext(input);
  if (!isRecord(value)) fail("package", "invalid_package", "ScenePackage 必须是对象");
  if (value.schemaVersion !== 1) fail("schemaVersion", "unsupported_version", "只支持 ScenePackage schemaVersion=1");
  const id = stableId(value.id, "id");
  if (!Number.isInteger(value.version) || (value.version as number) < 1) fail("version", "invalid_version", "version 必须是正整数");
  const chapterId = stableId(value.chapterId, "chapterId");
  if (context.chapterId && chapterId !== context.chapterId) fail("chapterId", "chapter_mismatch", `包属于 ${chapterId}，当前章节是 ${context.chapterId}`);
  const entrySceneId = stableId(value.entrySceneId, "entrySceneId");
  if (!Array.isArray(value.scenes) || value.scenes.length === 0) fail("scenes", "invalid_scenes", "至少需要一个场景");
  const sceneIds = new Set<string>();
  for (const [index, rawScene] of value.scenes.entries()) {
    if (!isRecord(rawScene)) fail(`scenes[${index}]`, "invalid_scene", "必须是场景对象");
    const sceneId = stableId(rawScene.id, `scenes[${index}].id`);
    if (sceneIds.has(sceneId)) fail(`scenes[${index}].id`, "duplicate_id", `场景 ID 重复 ${sceneId}`);
    sceneIds.add(sceneId);
  }
  if (!sceneIds.has(entrySceneId)) fail("entrySceneId", "missing_entry", `入口场景不存在 ${entrySceneId}`);
  if (!Array.isArray(value.endings)) fail("endings", "invalid_endings", "endings 必须是数组");
  const endingIds = new Set<string>();
  const endings = value.endings.map((rawEnding, index) => {
    const path = `endings[${index}]`;
    if (!isRecord(rawEnding)) fail(path, "invalid_ending", "必须是结局对象");
    const endingId = stableId(rawEnding.id, `${path}.id`);
    if (endingIds.has(endingId)) fail(`${path}.id`, "duplicate_id", `结局 ID 重复 ${endingId}`);
    endingIds.add(endingId);
    return {
      id: endingId,
      title: requiredString(rawEnding.title, `${path}.title`),
      summary: requiredString(rawEnding.summary, `${path}.summary`),
    };
  });
  const ruleIds = new Set(context.knownRuleIds ?? DEFAULT_SCENE_RULE_IDS);
  const knownWorldIds = worldCharacterIds(context);
  const scenes = value.scenes.map((rawScene, index) => validateScene(rawScene, `scenes[${index}]`, context, ruleIds, sceneIds, endingIds, knownWorldIds));
  const allBlockIds = new Set<string>();
  for (const [sceneIndex, scene] of scenes.entries()) {
    for (const [blockIndex, block] of scene.blocks.entries()) {
      if (allBlockIds.has(block.id)) fail(`scenes[${sceneIndex}].blocks[${blockIndex}].id`, "duplicate_id", `块 ID 重复 ${block.id}`);
      allBlockIds.add(block.id);
    }
  }
  const sceneMap = new Map(scenes.map((scene) => [scene.id, scene]));
  const edges = new Map<string, string[]>();
  for (const scene of scenes) {
    const targets: SceneTarget[] = [scene.defaultNext];
    for (const block of scene.blocks) {
      if (block.content.type !== "choice" || block.content.readOnly) continue;
      for (const choice of block.content.choices as RuntimeChoice[]) targets.push(choice.next);
    }
    edges.set(scene.id, targets.map(targetSceneId).filter((target): target is string => Boolean(target)));
  }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (sceneId: string) => {
    if (visiting.has(sceneId)) fail(`scenes[id=${sceneId}]`, "cycle", "场景图必须是 DAG，发现环路");
    if (visited.has(sceneId)) return;
    visiting.add(sceneId);
    for (const nextId of edges.get(sceneId) ?? []) visit(nextId);
    visiting.delete(sceneId);
    visited.add(sceneId);
  };
  visit(entrySceneId);
  if (visited.size !== scenes.length) {
    const unreachable = scenes.find((scene) => !visited.has(scene.id));
    fail(`scenes[id=${unreachable?.id ?? "unknown"}]`, "unreachable", "场景从 entrySceneId 不可达");
  }
  return {
    schemaVersion: 1,
    id,
    version: value.version as number,
    chapterId,
    entrySceneId,
    scenes: scenes.map((scene) => ({ ...scene, defaultNext: cloneTarget(scene.defaultNext) })),
    endings,
  };
}
