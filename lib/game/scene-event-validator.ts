import { isFiniteNumber } from "../domain/shared";
import type { SceneActionRecord, ScenePackage, SceneRuntimeState } from "../domain/scene";
import type { SimulationEvent } from "../domain/simulation";
import type { WorldState } from "../domain/world";
import { getSceneChoiceRule } from "./scene-choice-rules";

export class SceneEventValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SceneEventValidationError";
    this.code = code;
  }
}

export type SceneEventValidationContext = {
  world: WorldState;
  package: ScenePackage;
  runtime?: SceneRuntimeState;
  record?: Pick<SceneActionRecord, "id" | "eventIds" | "chapterId" | "packageId" | "packageVersion" | "sceneId" | "blockId" | "ruleId">;
  actionId?: string;
  scope?: "general" | "zhao-leng-demo";
};

function reject(code: string, message: string): never {
  throw new SceneEventValidationError(code, message);
}

export function validateSceneEvent(event: SimulationEvent, context: SceneEventValidationContext): SimulationEvent {
  if (!event || typeof event !== "object") reject("INVALID_EVENT", "场景事件不是对象");
  const source = event.source;
  if (!source || source.kind !== "scene_choice") reject("MISSING_SOURCE", "场景事件缺少 scene_choice source");
  const rule = getSceneChoiceRule(source.ruleId);
  if (!rule) reject("UNKNOWN_RULE", `未注册规则 ${source.ruleId}`);
  if (rule.scope === "zhao-leng-demo" && context.scope !== "zhao-leng-demo") {
    reject("RULE_SCOPE_FORBIDDEN", `规则 ${source.ruleId} 只允许用于赵冷 Demo`);
  }
  if (source.packageId !== context.package.id || source.packageVersion !== context.package.version) reject("PACKAGE_MISMATCH", "事件包版本与当前场景不一致");
  if (context.runtime && (source.sceneId !== context.runtime.sceneId || source.blockId !== context.runtime.blockId)) reject("POSITION_MISMATCH", "事件位置与当前运行时不一致");
  if (context.actionId && source.actionId !== context.actionId) reject("ACTION_MISMATCH", "事件 actionId 不匹配");
  if (context.record) {
    if (source.actionId !== context.record.id || !context.record.eventIds.includes(event.id)) reject("RECORD_MISMATCH", "事件与动作记录不一致");
    if (context.record.chapterId !== event.chapterId || context.record.packageId !== source.packageId || context.record.packageVersion !== source.packageVersion || context.record.sceneId !== source.sceneId || context.record.blockId !== source.blockId || context.record.ruleId !== source.ruleId) reject("RECORD_MISMATCH", "事件元数据与动作记录不一致");
  }
  if (event.chapterId !== context.package.chapterId) reject("CHAPTER_MISMATCH", "场景事件章节不匹配");
  if (event.year !== context.world.currentYear) reject("YEAR_MISMATCH", "即时场景事件必须发生在当前年份");
  if (!Number.isInteger(event.order) || event.order < 0) reject("INVALID_ORDER", "场景事件 order 必须是非负整数");
  const characterIds = new Set(Object.keys(context.world.characters));
  if (new Set(event.participantIds).size !== event.participantIds.length) reject("DUPLICATE_PARTICIPANT", "参与角色不能重复");
  if (event.participantIds.some((id) => !characterIds.has(id))) reject("UNKNOWN_PARTICIPANT", "事件包含不存在的参与角色");
  if (!event.participantIds.includes(context.world.protagonistId)) reject("MISSING_PROTAGONIST", "场景事件必须包含主角");
  if (event.characterChanges.length !== 0) reject("CHARACTER_CHANGE_FORBIDDEN", "即时场景事件不能改变人生七维或角色状态");
  if (event.evidenceIds.length !== 0 || event.createsThreadIds.length !== 0 || event.resolvesThreadIds.length !== 0) reject("MACRO_EFFECT_FORBIDDEN", "即时场景事件不能写入证据或剧情线程");
  if (!event.relationshipChanges || event.relationshipChanges.length > 1) reject("RELATIONSHIP_CHANGE_LIMIT", "即时场景事件最多改变一条关系");
  for (const change of event.relationshipChanges) {
    const relationship = context.world.relationships[change.relationshipId];
    if (!relationship) reject("UNKNOWN_RELATIONSHIP", `关系不存在 ${change.relationshipId}`);
    if (![relationship.characterAId, relationship.characterBId].every((id) => event.participantIds.includes(id))) reject("RELATIONSHIP_PARTICIPANT_MISMATCH", "关系变化的双方必须是参与角色");
    if (change.typeChange || change.addIssue || change.resolveIssueId) reject("RELATIONSHIP_EFFECT_FORBIDDEN", "即时场景只允许四轴关系数值变化");
    for (const key of ["closeness", "trust", "conflict", "commitment"] as const) {
      const amount = change.scoreDelta[key];
      if (amount !== undefined && (!isFiniteNumber(amount) || Math.abs(amount) > 20)) reject("RELATIONSHIP_DELTA_LIMIT", "关系变化必须是有限数字且绝对值不超过 20");
    }
  }
  if (!event.causes.some((cause) => cause.type === "player_choice" && cause.refId === source.actionId)) reject("CAUSE_MISMATCH", "场景事件必须引用对应玩家动作");
  if (typeof event.title !== "string" || !event.title.trim() || typeof event.summary !== "string" || !event.summary.trim()) reject("INVALID_TEXT", "场景事件缺少公开标题或摘要");
  if (!isFiniteNumber(event.importance) || event.importance < 0 || event.importance > 100) reject("INVALID_IMPORTANCE", "事件重要度必须在 0 到 100");
  return JSON.parse(JSON.stringify(event)) as SimulationEvent;
}

export function validateSceneEvents(events: SimulationEvent[], context: SceneEventValidationContext): SimulationEvent[] {
  if (!Array.isArray(events) || events.length !== 1) reject("EVENT_COUNT", "一次场景选择必须产生且只产生一个事件");
  return [validateSceneEvent(events[0], context)];
}

export const validateSceneEventBatch = validateSceneEvents;
