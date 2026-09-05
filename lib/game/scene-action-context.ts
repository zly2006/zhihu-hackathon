import type { GameSave } from "../domain/chapter";
import type { SceneActionRecord, SceneTarget } from "../domain/scene";
import type { RelationshipScores } from "../domain/relationship";

export type PublicSceneActionContext = {
  actionId: string;
  chapterId: string;
  sceneId: string;
  blockId: string;
  choiceId: SceneActionRecord["choiceId"];
  label: string;
  ruleId: string;
  targetCharacterId?: string;
  appliedEffects: {
    relationshipDelta: Partial<RelationshipScores>;
    hasFlagEffect: boolean;
  };
  next: SceneTarget;
};

export type SceneActionContextInput = {
  actions: SceneActionRecord[];
  activeBranchId?: string;
  lastCompletedChapterId?: string;
};

const PUBLIC_ACTION_CONTEXT_LIMIT = 3;
const PUBLIC_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]*$/;
const RELATIONSHIP_AXES = ["closeness", "trust", "conflict", "commitment"] as const;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sourceInput(input: SceneActionContextInput | GameSave): SceneActionContextInput {
  if ("sceneActions" in input || "worldState" in input && "chapters" in input) {
    const save = input as GameSave;
    return {
      actions: save.sceneActions ?? [],
      activeBranchId: save.activeBranchId,
      lastCompletedChapterId: save.worldState.chapterIds.at(-1),
    };
  }
  return input as SceneActionContextInput;
}

function requiredPublicText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} 必须是非空字符串`);
  const text = value.trim();
  if (text.length > maximum) throw new Error(`${field} 不能超过 ${maximum} 个字符`);
  return text;
}

function publicId(value: unknown, field: string): string {
  const id = requiredPublicText(value, field, 160);
  if (!PUBLIC_ID_PATTERN.test(id)) throw new Error(`${field} 不是稳定公开 ID`);
  return id;
}

function normalizeNext(value: unknown, field: string): SceneTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} 必须是场景目标`);
  const target = value as Record<string, unknown>;
  if (target.kind === "chapter_end") return { kind: "chapter_end" };
  if (target.kind === "scene") return { kind: "scene", sceneId: publicId(target.sceneId, `${field}.sceneId`) };
  if (target.kind === "ending") return { kind: "ending", endingId: publicId(target.endingId, `${field}.endingId`) };
  throw new Error(`${field}.kind 不是受支持的场景目标`);
}

function normalizeRelationshipDelta(value: unknown, field: string): Partial<RelationshipScores> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} 必须是关系变化对象`);
  const source = value as Record<string, unknown>;
  const result: Partial<RelationshipScores> = {};
  for (const axis of RELATIONSHIP_AXES) {
    if (source[axis] === undefined) continue;
    if (typeof source[axis] !== "number" || !Number.isFinite(source[axis]) || source[axis] < -100 || source[axis] > 100) {
      throw new Error(`${field}.${axis} 必须是 -100 到 100 的有限数字`);
    }
    result[axis] = source[axis];
  }
  return result;
}

function normalizePublicAction(value: unknown, index: number): PublicSceneActionContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`sceneActionContext[${index}] 必须是对象`);
  const source = value as Record<string, unknown>;
  const choiceId = source.choiceId;
  if (choiceId !== "A" && choiceId !== "B" && choiceId !== "C") throw new Error(`sceneActionContext[${index}].choiceId 无效`);
  const effects = source.appliedEffects;
  if (!effects || typeof effects !== "object" || Array.isArray(effects)) throw new Error(`sceneActionContext[${index}].appliedEffects 必须是对象`);
  const effectRecord = effects as Record<string, unknown>;
  if (typeof effectRecord.hasFlagEffect !== "boolean") throw new Error(`sceneActionContext[${index}].appliedEffects.hasFlagEffect 必须是布尔值`);
  return {
    actionId: publicId(source.actionId, `sceneActionContext[${index}].actionId`),
    chapterId: publicId(source.chapterId, `sceneActionContext[${index}].chapterId`),
    sceneId: publicId(source.sceneId, `sceneActionContext[${index}].sceneId`),
    blockId: publicId(source.blockId, `sceneActionContext[${index}].blockId`),
    choiceId,
    label: requiredPublicText(source.label, `sceneActionContext[${index}].label`, 120),
    ruleId: publicId(source.ruleId, `sceneActionContext[${index}].ruleId`),
    ...(source.targetCharacterId !== undefined
      ? { targetCharacterId: publicId(source.targetCharacterId, `sceneActionContext[${index}].targetCharacterId`) }
      : {}),
    appliedEffects: {
      relationshipDelta: normalizeRelationshipDelta(effectRecord.relationshipDelta, `sceneActionContext[${index}].appliedEffects.relationshipDelta`),
      hasFlagEffect: effectRecord.hasFlagEffect,
    },
    next: normalizeNext(source.next, `sceneActionContext[${index}].next`),
  };
}

export function normalizeSceneActionContext(value: unknown): PublicSceneActionContext[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("sceneActionContext 必须是数组");
  if (value.length > PUBLIC_ACTION_CONTEXT_LIMIT) throw new Error(`sceneActionContext 最多 ${PUBLIC_ACTION_CONTEXT_LIMIT} 条`);
  return value.map(normalizePublicAction);
}

export function compileSceneActionContext(
  input: SceneActionContextInput | GameSave,
): PublicSceneActionContext[] {
  const source = sourceInput(input);
  const lastChapterId = source.lastCompletedChapterId;
  const actions = source.actions
    .filter((action) => !source.activeBranchId || action.branchId === source.activeBranchId)
    .filter((action) => !lastChapterId || action.chapterId === lastChapterId);
  return actions
    .flatMap((action, index) => {
      try {
        return [
          normalizePublicAction(
            {
              actionId: action.id,
              chapterId: action.chapterId,
              sceneId: action.sceneId,
              blockId: action.blockId,
              choiceId: action.choiceId,
              label: action.label,
              ruleId: action.ruleId,
              ...(action.targetCharacterId ? { targetCharacterId: action.targetCharacterId } : {}),
              appliedEffects: {
                relationshipDelta: clone(action.actualRelationshipDelta),
                hasFlagEffect: Object.keys(action.flagsAfter).length > 0,
              },
              next: clone(action.next),
            },
            index,
          ),
        ];
      } catch {
        return [];
      }
    })
    .slice(-PUBLIC_ACTION_CONTEXT_LIMIT);
}
