import type { ChapterDecision } from "../domain/chapter";
import type { NpcProactiveEvent } from "../domain/narrative-experience";
import type { NarrativeRuntimeState, ZhaoLengBeatId } from "../domain/zhao-leng-runtime";
import type { SimulationEvent } from "../domain/simulation";
import type { WorldState } from "../domain/world";
import type { GameSave } from "../domain/chapter";
import { buildNarrativeDirectorBrief } from "./narrative-director";
import { planNpcAgentDirectives, toPublicNpcAgentTrace } from "./npc-agent";
import { planNpcProactiveEvents } from "./npc-proactive-event-policy";
import { ZHAO_LENG_CHAPTER_ID } from "./zhao-leng-demo";

export type NarrativeExperienceInput = {
  chapterId: string;
  state: WorldState;
  decision: ChapterDecision;
  recentEvents?: SimulationEvent[];
  deliveredDirectiveIds?: string[];
  span?: 1 | 3;
  startYear?: number;
  endYear?: number;
};

export type NarrativeExperience = {
  proactiveEvents: NpcProactiveEvent[];
  publicDirectives: ReturnType<typeof toPublicNpcAgentTrace>[];
  directorBrief: ReturnType<typeof buildNarrativeDirectorBrief>;
  pacing: ReturnType<typeof buildNarrativeDirectorBrief>["pacing"];
  span: 1 | 3;
  startYear: number;
  endYear: number;
};

export type ZhaoLengNarrativeExperience = NarrativeExperience & {
  contextKind: "demo-entry" | "zhao-leng-beat";
  pacingSource: "zhao-leng-beat";
  beatId: ZhaoLengBeatId;
};

export function buildNarrativeExperience(input: NarrativeExperienceInput): NarrativeExperience {
  const span = input.span ?? 1;
  const startYear = input.startYear ?? input.state.currentYear;
  const endYear = input.endYear ?? startYear + span;
  const directives = planNpcAgentDirectives({
    chapterId: input.chapterId,
    world: input.state,
    decision: input.decision,
    startYear,
    endYear,
  });
  const directorBrief = buildNarrativeDirectorBrief({
    chapterId: input.chapterId,
    world: input.state,
    events: input.recentEvents ?? [],
    decision: input.decision,
    span,
    startYear,
    endYear,
  });
  return {
    proactiveEvents: planNpcProactiveEvents({
      world: input.state,
      directives,
      deliveredDirectiveIds: input.deliveredDirectiveIds,
    }),
    publicDirectives: directives.map(toPublicNpcAgentTrace),
    directorBrief,
    pacing: directorBrief.pacing,
    span,
    startYear,
    endYear,
  };
}

function zhaoLengPreviewDecision(save: GameSave): ChapterDecision {
  const beatId = save.zhaoLeng?.beatId ?? "zl-01-message";
  return {
    id: `zhao-leng-preview:${beatId}`,
    promptTitle: "赵冷剧情 Demo",
    context: `当前剧情节拍：${beatId}。这是只读主动事件预览，不代表已经发生的选择。`,
    options: [
      { id: "A", label: "进入当前节拍", description: "进入当前赵冷节拍。", strategyTag: "scene", estimatedRisk: 0, stateFit: "可行" },
      { id: "B", label: "查看邀请", description: "查看赵冷或其他 NPC 的公开邀请。", strategyTag: "preview", estimatedRisk: 0, stateFit: "可行" },
      { id: "C", label: "暂不回应", description: "暂不回应主动邀请。", strategyTag: "defer", estimatedRisk: 0, stateFit: "可行" },
    ],
    selectedOptionId: "A",
    normalizedAction: `进入赵冷剧情节拍 ${beatId}`,
  };
}

export function buildZhaoLengNarrativeExperience(input: {
  save: GameSave;
  contextKind: "demo-entry" | "zhao-leng-beat";
  deliveredDirectiveIds?: string[];
}): ZhaoLengNarrativeExperience {
  const beatId = input.save.zhaoLeng?.beatId ?? "zl-01-message";
  const result = buildNarrativeExperience({
    chapterId: ZHAO_LENG_CHAPTER_ID,
    state: input.save.worldState,
    decision: zhaoLengPreviewDecision(input.save),
    recentEvents: Object.values(input.save.events).filter((event) => event.chapterId === ZHAO_LENG_CHAPTER_ID),
    deliveredDirectiveIds: input.deliveredDirectiveIds,
    span: 1,
    startYear: input.save.worldState.currentYear,
    endYear: input.save.worldState.currentYear,
  });
  return {
    ...result,
    contextKind: input.contextKind,
    pacingSource: "zhao-leng-beat",
    beatId,
  };
}

function deliveryKey(contextId: string, directiveId: string): string {
  return `${contextId}:${directiveId}`;
}

export function mergeNarrativeDeliveries(
  runtime: NarrativeRuntimeState,
  events: NpcProactiveEvent[],
  branchId: string,
  contextId: string,
): { runtime: NarrativeRuntimeState; added: string[] } {
  const deliveries = [...runtime.deliveries];
  const added: string[] = [];
  const known = new Set(deliveries.map((item) => deliveryKey(item.contextId, item.directiveId)));
  for (const event of events) {
    const key = deliveryKey(contextId, event.directiveId);
    if (known.has(key)) continue;
    known.add(key);
    deliveries.push({
      source: "npc-agent",
      contextId,
      branchId,
      directiveId: event.directiveId,
      event,
      status: "queued",
    });
    added.push(event.directiveId);
  }
  return { runtime: { ...runtime, deliveries }, added };
}

export function enqueueScriptedBeatDelivery(
  runtime: NarrativeRuntimeState,
  beatId: ZhaoLengBeatId,
  branchId: string,
): NarrativeRuntimeState {
  const contextId = `scripted:${beatId}`;
  const directiveId = `scripted:${beatId}`;
  if (runtime.deliveries.some((item) => deliveryKey(item.contextId, item.directiveId) === deliveryKey(contextId, directiveId))) return runtime;
  return {
    ...runtime,
    deliveries: [
      ...runtime.deliveries,
      { source: "scripted-beat", contextId, branchId, directiveId, scriptedBeatId: beatId, status: "queued" },
    ],
  };
}

export function updateNarrativeDelivery(
  runtime: NarrativeRuntimeState,
  input: {
    contextId: string;
    branchId: string;
    directiveId: string;
    status: NarrativeRuntimeState["deliveries"][number]["status"];
    responseActionId?: string;
  },
): NarrativeRuntimeState {
  let updated = false;
  const deliveries = runtime.deliveries.map((delivery) => {
    if (delivery.contextId !== input.contextId || delivery.directiveId !== input.directiveId) return delivery;
    updated = true;
    return {
      ...delivery,
      branchId: input.branchId,
      status: input.status,
      ...(input.responseActionId ? { responseActionId: input.responseActionId } : {}),
    };
  });
  if (!updated) throw new Error("找不到要更新的叙事投递");
  return { ...runtime, deliveries };
}

export function deliveredDirectiveIds(runtime: NarrativeRuntimeState): string[] {
  return [...new Set(runtime.deliveries.map((item) => item.directiveId))];
}
