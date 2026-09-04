// Narrative Director Brief（V3.2）
// 从 canonical 事件和公开 WorldState 推导“下一幕应该聚焦什么”。
// 只提供呈现方向，不生成事件、不修改状态、不读取 NPC privateState。

import type { ChapterDecision } from "../domain/chapter";
import type { NarrativeDirectorBrief, NarrativeDirectorTrigger } from "../domain/narrative";
import type { ChapterSpan } from "../domain/shared";
import type { SimulationEvent } from "../domain/simulation";
import type { WorldState } from "../domain/world";

export type NarrativeDirectorBriefInput = {
  chapterId: string;
  world: WorldState;
  events: SimulationEvent[];
  decision: ChapterDecision;
  span: ChapterSpan;
  startYear: number;
  endYear: number;
};

type ScoredEvent = {
  event: SimulationEvent;
  score: number;
};

function relationshipDeltaPressure(event: SimulationEvent | undefined): number {
  if (!event) return 0;
  return event.relationshipChanges.reduce((total, change) => {
    const delta = Object.values(change.scoreDelta).reduce((sum, value) => sum + Math.abs(value), 0);
    return Math.max(total, delta);
  }, 0);
}

function eventScore(event: SimulationEvent, protagonistId: string): number {
  const hasNpcParticipant = event.participantIds.some((id) => id !== protagonistId);
  const hasNpcGoal = event.causes.some((cause) => cause.type === "npc_goal");
  const hasRelationshipChange = event.relationshipChanges.length > 0;
  const hasPlayerChoice = event.causes.some((cause) => cause.type === "player_choice");
  return (
    event.importance +
    (hasNpcParticipant ? 20 : 0) +
    (hasNpcGoal ? 24 : 0) +
    (hasRelationshipChange ? 16 : 0) +
    (hasPlayerChoice ? 8 : 0) +
    Math.min(12, relationshipDeltaPressure(event))
  );
}

function chooseTrigger(event: SimulationEvent | undefined, decision: ChapterDecision): NarrativeDirectorTrigger {
  if (event?.causes.some((cause) => cause.type === "npc_goal")) return "npc_goal";
  if (event?.relationshipChanges.length) return "relationship";
  if (event?.causes.some((cause) => cause.type === "player_choice") || decision.normalizedAction.trim()) {
    return "player_choice";
  }
  return "canonical_event";
}

function chooseFocusCharacter(event: SimulationEvent | undefined, world: WorldState): string {
  const protagonistId = world.protagonistId;
  const eventCharacter = event?.participantIds.find((id) => id !== protagonistId && world.characters[id]);
  return eventCharacter ?? protagonistId;
}

function chooseFocusThreads(focusCharacterId: string, world: WorldState): string[] {
  const openThreads = world.openThreads
    .filter((thread) => thread.status === "open")
    .sort((left, right) => right.urgency - left.urgency || left.id.localeCompare(right.id));
  const related = openThreads.filter((thread) => thread.relatedCharacterIds.includes(focusCharacterId));
  const candidates = related.length ? related : openThreads;
  return candidates.slice(0, 2).map((thread) => thread.id);
}

function chooseTension(event: SimulationEvent | undefined, focusThreads: string[], world: WorldState): NarrativeDirectorBrief["tensionLevel"] {
  if (!event && !focusThreads.length) return "quiet";
  const threadPressure = focusThreads.some((threadId) => {
    const thread = world.openThreads.find((item) => item.id === threadId);
    return (thread?.urgency ?? 0) >= 80;
  });
  if (
    (event?.importance ?? 0) >= 75 ||
    relationshipDeltaPressure(event) >= 8 ||
    event?.causes.some((cause) => cause.type === "npc_goal") ||
    threadPressure
  ) {
    return "high";
  }
  return "rising";
}

function dramaticQuestion(
  trigger: NarrativeDirectorTrigger,
  focusName: string,
  event: SimulationEvent | undefined,
  decision: ChapterDecision,
): string {
  const eventTitle = event?.title ? `围绕“${event.title}”` : "在新的现实安排中";
  switch (trigger) {
    case "npc_goal":
      return `当${focusName}的现实目标${eventTitle}与主角的选择交汇，关系会靠近、僵持，还是付出代价？`;
    case "relationship":
      return `${focusName}与主角的关系变化，下一步会通过一次坦白、一次妥协，还是更大的距离显现？`;
    case "player_choice":
      return `主角选择“${decision.normalizedAction.trim().slice(0, 40)}”之后，谁会被推向新的位置？`;
    case "canonical_event":
      return `${eventTitle}留下的现实后果，会先改变谁的日常？`;
  }
}

export function buildNarrativeDirectorBrief(input: NarrativeDirectorBriefInput): NarrativeDirectorBrief {
  const scoredEvents: ScoredEvent[] = input.events
    .map((event) => ({ event, score: eventScore(event, input.world.protagonistId) }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.event.order - right.event.order ||
        left.event.id.localeCompare(right.event.id),
    );
  const focusEvent = scoredEvents[0]?.event;
  const focusCharacterId = chooseFocusCharacter(focusEvent, input.world);
  const focusThreadIds = chooseFocusThreads(focusCharacterId, input.world);
  const trigger = chooseTrigger(focusEvent, input.decision);
  const focusName = input.world.characters[focusCharacterId]?.identity.name ?? "主角身边的人";

  // chapterId/year/span 是输入契约的一部分；Brief 不把它们拼入叙事文本，避免同一状态因调用上下文产生漂移。
  void input.chapterId;
  void input.span;
  void input.startYear;
  void input.endYear;

  return {
    trigger,
    focusCharacterId,
    focusEventIds: focusEvent ? [focusEvent.id] : [],
    focusThreadIds,
    dramaticQuestion: dramaticQuestion(trigger, focusName, focusEvent, input.decision),
    tensionLevel: chooseTension(focusEvent, focusThreadIds, input.world),
  };
}
