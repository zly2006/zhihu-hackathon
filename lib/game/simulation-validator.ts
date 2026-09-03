// Simulation Validator（Phase 4）
// 只做可机械判定的结构硬约束校验（方案 §20.1）。
// 校验失败时抛出带具体失败项的异常，由编排层追加后重试，不静默修补叙事。

import type { ChapterSpan } from "../domain/shared";
import { isFiniteNumber } from "../domain/shared";
import type { WorldSimulationOutput } from "../domain/simulation";
import {
  EVENTS_PER_YEAR_SPAN,
  MAX_MAJOR_EVENTS_PER_CHAPTER,
  RELATIONSHIP_DELTA_CEILING,
} from "../domain/simulation";
import { MEMORY_PER_CHAPTER_MAX, MEMORY_PER_CHAPTER_MIN } from "../domain/memory";

const MAJOR_EVENT_IMPORTANCE = 70;
const TYPE_CHANGE_MIN_IMPORTANCE = 60;

// 未来年份不得伪造现实政策/公司/名人为事实（方案 §23.2）的轻量启发式
// 只匹配真实“政策/法规出台”与重大现实事件类表述；不含常用词（如“正式”“国家”），避免误伤普通生活表述。
const FUTURE_FABRICATION_PATTERN =
  /(?:国务院|部委|颁布|出台|立法|《[^》]{2,20}》(?:法|条例|政策|规定)|(?:大规模)?裁员\d+|破产清算)/;

export type ValidationContext = {
  chapterId: string;
  startYear: number;
  endYear: number;
  span: ChapterSpan;
  characterIds: Set<string>;
  relationshipIds: Set<string>;
  evidenceIds: Set<string>;
  currentRealYear: number; // 用于未来年份捏造检查
};

export function validateSimulationOutput(
  output: WorldSimulationOutput,
  context: ValidationContext,
): void {
  const { events, newMemories } = output;
  const [minEvents, maxEvents] = EVENTS_PER_YEAR_SPAN[context.span];

  if (events.length < minEvents || events.length > maxEvents) {
    throw new Error(
      `${context.span} 年章节必须包含 ${minEvents} 到 ${maxEvents} 个关键事件，当前 ${events.length} 个`,
    );
  }

  const majorCount = events.filter((event) => event.importance >= MAJOR_EVENT_IMPORTANCE).length;
  if (majorCount > MAX_MAJOR_EVENTS_PER_CHAPTER) {
    throw new Error(`重大转折事件（importance≥${MAJOR_EVENT_IMPORTANCE}）最多 ${MAX_MAJOR_EVENTS_PER_CHAPTER} 个，当前 ${majorCount} 个`);
  }

  const eventIds = new Set<string>();
  for (const event of events) {
    if (!event.id || eventIds.has(event.id)) throw new Error("事件 id 缺失或重复");
    eventIds.add(event.id);

    if (!event.title?.trim() || !event.summary?.trim()) {
      throw new Error(`事件 ${event.id} 缺少标题或摘要`);
    }
    if (!Number.isInteger(event.year) || event.year < context.startYear || event.year > context.endYear) {
      throw new Error(`事件 ${event.id} 的年份 ${event.year} 超出章节区间 ${context.startYear}-${context.endYear}`);
    }
    if (event.month != null && (event.month < 1 || event.month > 12)) {
      throw new Error(`事件 ${event.id} 的月份 ${event.month} 非法`);
    }
    if (!isFiniteNumber(event.importance) || event.importance < 0 || event.importance > 100) {
      throw new Error(`事件 ${event.id} 的 importance 必须是 0-100`);
    }
    if (event.year > context.currentRealYear) {
      const fabricationMatch = event.summary.match(FUTURE_FABRICATION_PATTERN);
      if (fabricationMatch) {
        throw new Error(
          `事件 ${event.id} 疑似在未来年份伪造真实政策/公司/名人为事实（触发词："${fabricationMatch[0]}"）。请改为泛指表述，不要引用具体政策/法规/公司/名人。`,
        );
      }
    }

    for (const participantId of event.participantIds) {
      if (!context.characterIds.has(participantId)) {
        throw new Error(`事件 ${event.id} 的 participantIds 引用了不存在的角色 ${participantId}`);
      }
    }
    for (const evidenceId of event.evidenceIds) {
      if (!context.evidenceIds.has(evidenceId)) {
        throw new Error(`事件 ${event.id} 的 evidenceIds 引用了不在本次 EvidenceBundle 中的 ${evidenceId}`);
      }
    }

    for (const change of event.characterChanges) {
      if (!context.characterIds.has(change.characterId)) {
        throw new Error(`事件 ${event.id} 的 CharacterChange 引用了不存在的角色 ${change.characterId}`);
      }
      if (!change.description?.trim()) {
        throw new Error(`事件 ${event.id} 的 CharacterChange 缺少描述`);
      }
      if (change.statDelta) {
        for (const [key, amount] of Object.entries(change.statDelta)) {
          if (!isFiniteNumber(amount)) {
            throw new Error(`事件 ${event.id} 的 statDelta.${key} 不是有限数字`);
          }
          if (amount < -100 || amount > 100) {
            throw new Error(`事件 ${event.id} 的 statDelta.${key} 超出 -100..100`);
          }
        }
      }
    }

    for (const change of event.relationshipChanges) {
      if (!context.relationshipIds.has(change.relationshipId)) {
        throw new Error(`事件 ${event.id} 的 RelationshipChange 引用了不存在的关系 ${change.relationshipId}`);
      }
      if (!change.description?.trim()) {
        throw new Error(`事件 ${event.id} 的 RelationshipChange 缺少描述`);
      }
      for (const [key, amount] of Object.entries(change.scoreDelta)) {
        if (!isFiniteNumber(amount) || Math.abs(amount) > RELATIONSHIP_DELTA_CEILING) {
          throw new Error(`事件 ${event.id} 的 scoreDelta.${key} 必须是有限数字且绝对值 ≤ ${RELATIONSHIP_DELTA_CEILING}`);
        }
      }
      if (change.typeChange) {
        if (change.typeChange.from === change.typeChange.to) {
          throw new Error(`事件 ${event.id} 的关系类型变化 from/to 相同`);
        }
        if (event.importance < TYPE_CHANGE_MIN_IMPORTANCE) {
          throw new Error(`事件 ${event.id} 的关系类型变化必须对应重要性 ≥ ${TYPE_CHANGE_MIN_IMPORTANCE} 的明显事件`);
        }
      }
    }
  }

  if (newMemories.length < MEMORY_PER_CHAPTER_MIN || newMemories.length > MEMORY_PER_CHAPTER_MAX) {
    throw new Error(
      `每章必须产生 ${MEMORY_PER_CHAPTER_MIN}-${MEMORY_PER_CHAPTER_MAX} 条长期记忆，当前 ${newMemories.length} 条`,
    );
  }
  for (const memory of newMemories) {
    if (!context.characterIds.has(memory.characterId)) {
      throw new Error(`新记忆 ${memory.id} 引用了不存在的角色 ${memory.characterId}`);
    }
    if (!memory.summary?.trim()) throw new Error(`新记忆 ${memory.id} 缺少摘要`);
    if (memory.year < context.startYear || memory.year > context.endYear) {
      throw new Error(`新记忆 ${memory.id} 的年份 ${memory.year} 超出章节区间`);
    }
  }
}
