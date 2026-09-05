import type {
  SceneRuntimeState,
  SceneTriggerCandidate,
  SceneTriggerRecord,
  SceneTriggerStatus,
} from "../domain/scene";
import type { WorldState } from "../domain/world";
import { validateScenePackage } from "./scene-package-validator";

export type EnqueueSceneTriggerInput = {
  branchId: string;
  candidate: SceneTriggerCandidate;
  existing?: SceneTriggerRecord[];
  world: WorldState;
  flags?: Record<string, boolean>;
  runtime?: SceneRuntimeState;
  now?: string;
};

export type EnqueueSceneTriggerResult = {
  accepted: boolean;
  reason: "queued" | "duplicate";
  queue: SceneTriggerRecord[];
  record: SceneTriggerRecord;
};

export type ActivateSceneTriggerResult = {
  trigger?: SceneTriggerRecord;
  reason: "activated" | "busy" | "empty";
  queue: SceneTriggerRecord[];
};

const TRIGGER_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]*$/;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function requiredStableId(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || !TRIGGER_ID.test(value)) {
    throw new Error(`${label} 必须是稳定 ID`);
  }
  return value;
}

function validateCandidate(input: EnqueueSceneTriggerInput): void {
  requiredStableId(input.branchId, "branchId");
  if (!input.candidate || typeof input.candidate !== "object") throw new Error("trigger candidate 必须是对象");
  requiredStableId(input.candidate.triggerId, "triggerId");
  if (!input.candidate || (input.candidate.kind !== "contact" && input.candidate.kind !== "emotional" && input.candidate.kind !== "hidden")) {
    throw new Error("trigger kind 无效");
  }
  requiredStableId(input.candidate.characterId, "characterId");
  if (!input.world.characters[input.candidate.characterId]) throw new Error(`角色不存在: ${input.candidate.characterId}`);
  if (!Array.isArray(input.candidate.sourceEventIds)) throw new Error("sourceEventIds 必须是数组");
  for (const [index, eventId] of input.candidate.sourceEventIds.entries()) {
    requiredStableId(eventId, `sourceEventIds[${index}]`);
    if (!input.world.canonicalEventIds.includes(eventId)) throw new Error(`来源事件不存在: ${eventId}`);
  }
  validateScenePackage(input.candidate.package, {
    world: input.world,
    flags: input.flags ?? {},
    currentYear: input.world.currentYear,
    chapterId: input.candidate.package.chapterId,
    knownEventIds: input.world.canonicalEventIds,
    checkAvailability: false,
  });
  if (input.candidate.package.scenes.some((scene) => scene.mode !== "live")) {
    throw new Error("主动场景包必须全部是 live 内容");
  }
}

function sameTrigger(record: SceneTriggerRecord, branchId: string, triggerId: string): boolean {
  return record.branchId === branchId && record.triggerId === triggerId;
}

export function enqueueSceneTrigger(input: EnqueueSceneTriggerInput): EnqueueSceneTriggerResult {
  validateCandidate(input);
  const existing = clone(input.existing ?? []);
  const duplicate = existing.find((record) => sameTrigger(record, input.branchId, input.candidate.triggerId));
  if (duplicate) {
    return { accepted: false, reason: "duplicate", queue: existing, record: clone(duplicate) };
  }
  const queuedAt = input.now ?? new Date().toISOString();
  const record: SceneTriggerRecord = {
    ...clone(input.candidate),
    branchId: input.branchId,
    status: "queued",
    queuedAt,
  };
  return { accepted: true, reason: "queued", queue: [...existing, record], record: clone(record) };
}

function canActivate(runtime: SceneRuntimeState): boolean {
  // reading/completed 是不会截断提交或反馈的安全边界；选择、失败恢复和请求中都要等玩家处理完。
  return runtime.status === "reading" || runtime.status === "completed";
}

export function activateNextSceneTrigger(
  queue: SceneTriggerRecord[],
  branchId: string,
  runtime: SceneRuntimeState,
  now = new Date().toISOString(),
): ActivateSceneTriggerResult {
  const copied = clone(queue);
  if (!canActivate(runtime)) return { reason: "busy", queue: copied };
  const index = copied.findIndex((record) => record.branchId === branchId && record.status === "queued");
  if (index < 0) return { reason: "empty", queue: copied };
  const record = { ...copied[index], status: "active" as const, activatedAt: now };
  copied[index] = record;
  return { reason: "activated", queue: copied, trigger: clone(record) };
}

export function completeSceneTrigger(
  queue: SceneTriggerRecord[],
  branchId: string,
  triggerId: string,
  status: Extract<SceneTriggerStatus, "consumed" | "dismissed"> = "consumed",
  now = new Date().toISOString(),
): SceneTriggerRecord[] {
  requiredStableId(branchId, "branchId");
  requiredStableId(triggerId, "triggerId");
  return clone(queue).map((record) => {
    if (!sameTrigger(record, branchId, triggerId) || record.status === "consumed" || record.status === "dismissed") return record;
    return { ...record, status, completedAt: now };
  });
}
