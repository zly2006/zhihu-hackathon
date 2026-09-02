// Narrative Need Builder（V1.1 §4.8 第一步）
// 从 canonical SimulationEvent + 决策 + 世界状态，推导本章“需要什么样的叙事知识”。
// 纯函数，不调用 LLM。
import type { ChapterSpan, LifeDomain } from "../domain/shared";
import type { SimulationEvent } from "../domain/simulation";
import type { ChapterDecision } from "../domain/chapter";
import type { WorldState } from "../domain/world";
import type { NarrativeFunction, NarrativeNeed } from "../domain/narrative";

export type NarrativeNeedInput = {
  chapterId: string;
  span: ChapterSpan;
  world: WorldState;
  events: SimulationEvent[];
  decision: ChapterDecision;
};

const SPAN_FUNCTIONS: Record<ChapterSpan, NarrativeFunction[]> = {
  1: ["setup", "conflict", "decision", "climax", "aftermath", "hook"],
  3: ["setup", "bonding", "conflict", "reversal", "decision", "climax", "aftermath", "hook"],
};

export function buildNarrativeNeed(input: NarrativeNeedInput): NarrativeNeed {
  const { chapterId, span, events, decision } = input;

  const lifeDomains = Array.from(new Set(events.map((event) => event.domain))).filter(
    (domain): domain is LifeDomain => Boolean(domain),
  );
  const relationshipTypes = Array.from(
    new Set(
      events
        .flatMap((event) => event.relationshipChanges.map((change) => change.relationshipId))
        .map((relationshipId) => input.world.relationships[relationshipId]?.type)
        .filter(Boolean),
    ),
  );

  const sortedEvents = [...events].sort((a, b) => b.importance - a.importance);
  const centralEvents = sortedEvents.slice(0, 4).map((event) => event.title);

  const conflictTypes = Array.from(
    new Set(
      decision.options.map((option) => option.strategyTag).filter(Boolean),
    ),
  ).slice(0, 4);

  return {
    chapterId,
    lifeDomains: lifeDomains.length ? lifeDomains : ["social"],
    relationshipTypes: relationshipTypes.slice(0, 4),
    centralEvents,
    conflictTypes,
    desiredTone: "克制、有日常质感、情绪有余味，不煽情不堆砌极端事件",
    narrativeFunctions: SPAN_FUNCTIONS[span],
  };
}
