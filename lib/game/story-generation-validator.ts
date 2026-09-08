import type { StorySseEvent, StoryUnit } from "../domain/story";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validatePublishedStoryUnit(value: unknown): StoryUnit {
  if (!isRecord(value)) throw new Error("unit_ready 必须是完整对象");
  if (typeof value.id !== "string" || !value.id.trim()) throw new Error("unit_ready.id 缺失");
  if (typeof value.inputFingerprint !== "string" || !value.inputFingerprint.trim()) throw new Error("unit_ready.inputFingerprint 缺失");
  if (!isRecord(value.identity) || typeof value.identity.source !== "string") throw new Error("unit_ready.identity 不完整");
  if (value.phase !== "opening" && value.phase !== "decision" && value.phase !== "response" && value.phase !== "outcome" && value.phase !== "live" && value.phase !== "ending") {
    throw new Error("unit_ready.phase 无效");
  }
  if (!Array.isArray(value.sourceEventIds) || !isRecord(value.payload)) throw new Error("unit_ready.payload 不完整");
  for (const [index, eventId] of value.sourceEventIds.entries()) {
    if (typeof eventId !== "string" || !eventId.trim()) throw new Error(`unit_ready.sourceEventIds[${index}] 无效`);
  }
  if (value.coverage !== undefined) {
    if (!isRecord(value.coverage)) throw new Error("unit_ready.coverage 不完整");
    for (const key of ["requiredEventIds", "coveredEventIds", "pendingEventIds"]) {
      if (!Array.isArray(value.coverage[key]) || value.coverage[key].some((item) => typeof item !== "string")) {
        throw new Error(`unit_ready.coverage.${key} 无效`);
      }
    }
    const required = new Set(value.coverage.requiredEventIds as string[]);
    for (const eventId of value.coverage.coveredEventIds as string[]) {
      if (!required.has(eventId)) throw new Error("unit_ready.coverage.coveredEventIds 超出 requiredEventIds");
    }
    for (const eventId of value.coverage.pendingEventIds as string[]) {
      if (!required.has(eventId)) throw new Error("unit_ready.coverage.pendingEventIds 超出 requiredEventIds");
    }
  }
  if (value.payload.kind === "scene") {
    const pkg = value.payload.package;
    if (!isRecord(pkg) || pkg.schemaVersion !== 1 || typeof pkg.id !== "string" || !Array.isArray(pkg.scenes) || pkg.scenes.length === 0 || typeof pkg.entrySceneId !== "string") {
      throw new Error("unit_ready.scene package 不完整");
    }
  } else if (value.payload.kind !== "chapter_decision") {
    throw new Error("unit_ready.payload.kind 无效");
  }
  return JSON.parse(JSON.stringify(value)) as StoryUnit;
}

export function validateSseSequence(events: Array<Pick<StorySseEvent, "event" | "seq">>): { terminal: "complete" | "error"; lastSeq: number } {
  if (!events.length) throw new Error("故事流为空");
  let expectedSeq = 1;
  let terminal: "complete" | "error" | undefined;
  for (const item of events) {
    if (!Number.isInteger(item.seq) || item.seq !== expectedSeq) throw new Error("故事流 seq 越序或重复");
    expectedSeq += 1;
    if (terminal) throw new Error("故事流在 terminal 事件后仍有内容");
    if (item.event === "complete" || item.event === "error") terminal = item.event;
  }
  if (!terminal) throw new Error("故事流缺少 terminal 事件");
  return { terminal, lastSeq: expectedSeq - 1 };
}
