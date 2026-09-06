// NPC 主动事件策略（V3.3）。
// 把已生成的 NPC directive 转为玩家可见的“邀请卡片”，而不是自行写入 WorldState。
// 由玩法系统将玩家回应提交给既有 /api/chapter/simulate；World Simulator 仍是唯一 canonical 事件入口。

import type { NpcProactiveEvent, NpcProactiveEventKind } from "../domain/narrative-experience";
import type { NpcAgentDirective } from "../domain/npc-agent";
import type { WorldState } from "../domain/world";

export const MIN_PROACTIVE_EVENT_URGENCY = 48;
export const MAX_PROACTIVE_EVENTS_PER_CHAPTER = 2;

export type ProactiveEventPolicyInput = {
  world: WorldState;
  directives: NpcAgentDirective[];
  // 已展示的 directive id 由调用方随存档保存；同一 directive 不得重复投递。
  deliveredDirectiveIds?: string[];
  maxEvents?: number;
};

type EventCopy = {
  kind: NpcProactiveEventKind;
  preview: (name: string) => string;
  sceneHook: (name: string) => string;
  suggestedAction: string;
};

function copyFor(action: NpcAgentDirective["action"]): EventCopy | null {
  switch (action) {
    case "contact_player":
      return {
        kind: "contact_message",
        preview: (name) => `${name}：这两天有十分钟吗？我想把一件事当面说清楚。`,
        sceneHook: (name) => `${name} 主动约主角短谈，话题从近况切入。`,
        suggestedAction: "回应邀约，选择倾听、说明边界或另约时间。",
      };
    case "seek_support":
      return {
        kind: "support_request",
        preview: (name) => `${name}：我现在有点乱，不需要你替我决定，只想找个人说说。`,
        sceneHook: (name) => `${name} 主动寻求支持；先确认其需要的是陪伴、建议还是空间。`,
        suggestedAction: "先询问对方需要什么，再决定陪伴、建议或留出空间。",
      };
    case "negotiate_relationship":
      return {
        kind: "relationship_conversation",
        preview: (name) => `${name}：我们别再绕开这件事了，找个时间把各自的打算讲清楚吧。`,
        sceneHook: (name) => `${name} 希望重新协商关系中的现实安排。`,
        suggestedAction: "进入关系对话，明确事实、分歧与可承担的代价。",
      };
    case "advance_goal":
      return {
        kind: "goal_invitation",
        preview: (name) => `${name}：我在推进一个计划，想听听你的看法，但最后我会自己做决定。`,
        sceneHook: (name) => `${name} 主动分享正在推进的目标，并保留自主决定权。`,
        suggestedAction: "尊重对方主导权，提供信息、资源或诚实反馈。",
      };
    case "support_player":
      return {
        kind: "check_in",
        preview: (name) => `${name}：你最近的状态我有点在意。要不要一起吃个饭，或者只是走一段路？`,
        sceneHook: (name) => `${name} 主动关心主角的近况，但不替主角下结论。`,
        suggestedAction: "接受关心、说明近况，或礼貌地约定稍后再谈。",
      };
    case "withdraw":
      // 退避同样是 NPC 的主动选择，但不应被包装成强行联络。
      return null;
  }
}

export function planNpcProactiveEvents(input: ProactiveEventPolicyInput): NpcProactiveEvent[] {
  const delivered = new Set(input.deliveredDirectiveIds ?? []);
  const maximum = Math.max(
    0,
    Math.min(input.maxEvents ?? MAX_PROACTIVE_EVENTS_PER_CHAPTER, MAX_PROACTIVE_EVENTS_PER_CHAPTER),
  );
  if (!maximum) return [];

  return [...input.directives]
    .sort((left, right) => right.urgency - left.urgency || left.id.localeCompare(right.id))
    .filter(
      (directive) =>
        directive.urgency >= MIN_PROACTIVE_EVENT_URGENCY && !delivered.has(directive.id),
    )
    .flatMap((directive) => {
      const sender = input.world.characters[directive.characterId];
      const copy = sender ? copyFor(directive.action) : null;
      if (!sender || !copy) return [];
      return [{ directive, sender, copy }];
    })
    .slice(0, maximum)
    .map(({ directive, sender, copy }) => ({
      id: `npc-proactive-${directive.id}`,
      directiveId: directive.id,
      kind: copy.kind,
      senderId: sender.id,
      senderName: sender.identity.name,
      targetCharacterIds: [...directive.targetCharacterIds],
      relationshipIds: [...directive.relationshipIds],
      urgency: directive.urgency,
      preview: copy.preview(sender.identity.name),
      sceneHook: copy.sceneHook(sender.identity.name),
      suggestedAction: copy.suggestedAction,
      action: directive.action,
    }));
}
