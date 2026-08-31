// WorldState Reducer（Phase 0 交付物）
// 纯函数：把 World Simulator 的结构化输出应用到一个 WorldState 上，产生新的 WorldState。
// - 不可变更新（不修改入参）；
// - 数值变化全部由程序应用并 clamp 到 0..100；
// - 只处理结构化 delta，不承载叙事判断。
// 这是“没有小说文本参与状态计算，WorldState 也能连续推进”的关键工程节点。

import { randomUUID } from "node:crypto";
import {
  clampStat,
  isFiniteNumber,
  LIFE_STAT_KEYS,
  type ChapterId,
  type LifeStats,
} from "../domain/shared";
import type { Character } from "../domain/character";
import type { CharacterMemory } from "../domain/memory";
import type { Relationship } from "../domain/relationship";
import type {
  CharacterChange,
  RelationshipChange,
  WorldSimulationOutput,
} from "../domain/simulation";
import type { StoryThread, WorldState } from "../domain/world";
import { validateWorldState } from "../domain/validate";

export type ReduceOptions = {
  chapterId: ChapterId;
  endYear: number;
  now?: string;
  newId?: () => string;
};

function defaultNow(): string {
  return new Date().toISOString();
}

export function applyStatDelta(stats: LifeStats, delta: Partial<LifeStats> | undefined): LifeStats {
  if (!delta) return stats;
  const next = { ...stats };
  for (const key of LIFE_STAT_KEYS) {
    const amount = delta[key];
    if (amount === undefined) continue;
    if (!isFiniteNumber(amount)) {
      throw new Error(`statDelta.${key} 不是有限数字`);
    }
    next[key] = clampStat(next[key] + amount);
  }
  return next;
}

export function applyCharacterChange(
  character: Character,
  change: CharacterChange,
  now: string,
): Character {
  if (change.characterId !== character.id) {
    throw new Error(`CharacterChange 与角色 id 不匹配: ${change.characterId} != ${character.id}`);
  }
  const resolvedGoalIds = new Set(change.resolveGoalIds ?? []);
  const currentGoals = character.state.currentGoals.map((goal) =>
    resolvedGoalIds.has(goal.id) ? { ...goal, status: "achieved" as const } : goal,
  );
  return {
    ...character,
    state: {
      ...character.state,
      stats: applyStatDelta(character.state.stats, change.statDelta),
      city: change.cityChange?.to ?? character.state.city,
      occupation: change.occupationChange?.to ?? character.state.occupation,
      socialIdentity: change.socialIdentityChange?.to ?? character.state.socialIdentity,
      currentGoals,
    },
    updatedAt: now,
  };
}

export function applyRelationshipChange(
  relationship: Relationship,
  change: RelationshipChange,
  now: string,
  newId: () => string,
  chapterId: string,
): Relationship {
  if (change.relationshipId !== relationship.id) {
    throw new Error(
      `RelationshipChange 与关系 id 不匹配: ${change.relationshipId} != ${relationship.id}`,
    );
  }
  const scores = { ...relationship.scores };
  for (const key of ["closeness", "trust", "conflict", "commitment"] as const) {
    const amount = change.scoreDelta[key];
    if (amount === undefined) continue;
    if (!isFiniteNumber(amount)) {
      throw new Error(`scoreDelta.${key} 不是有限数字`);
    }
    scores[key] = clampStat(scores[key] + amount);
  }

  let unresolvedIssues = relationship.unresolvedIssues;
  if (change.resolveIssueId) {
    unresolvedIssues = unresolvedIssues.filter((issue) => issue.id !== change.resolveIssueId);
  }
  if (change.addIssue) {
    unresolvedIssues = [
      ...unresolvedIssues,
      {
        id: newId(),
        description: change.addIssue,
        severity: 50,
        introducedAtChapterId: chapterId,
      },
    ];
  }

  return {
    ...relationship,
    type: change.typeChange?.to ?? relationship.type,
    scores,
    unresolvedIssues,
    updatedAt: now,
  };
}

// 推进角色时间：所有角色的 year 前进到章节结束年，年龄按跨度同步增长。
function advanceCharacterClock(
  character: Character,
  endYear: number,
  now: string,
): Character {
  const span = Math.max(0, endYear - character.state.year);
  if (span === 0) {
    return character.state.year === endYear ? character : { ...character, updatedAt: now };
  }
  return {
    ...character,
    state: {
      ...character.state,
      year: endYear,
      age: Math.max(0, character.state.age + span),
    },
    updatedAt: now,
  };
}

export function reduceWorldState(
  world: WorldState,
  output: WorldSimulationOutput,
  options: ReduceOptions,
): WorldState {
  const now = options.now ?? defaultNow();
  const newId = options.newId ?? randomUUID;

  // 复制顶层容器（浅拷贝 + 逐对象更新，保证不可变）
  const characters: Record<string, Character> = { ...world.characters };
  const relationships: Record<string, Relationship> = { ...world.relationships };
  const memories: Record<string, CharacterMemory> = { ...world.memories };

  const characterIds = new Set(Object.keys(characters));
  const relationshipIds = new Set(Object.keys(relationships));

  // 1. 逐事件应用角色与关系变化
  for (const event of output.events) {
    for (const participantId of event.participantIds) {
      if (!characterIds.has(participantId)) {
        throw new Error(`事件 ${event.id} 的 participantIds 引用了不存在的角色: ${participantId}`);
      }
    }
    for (const change of event.characterChanges) {
      if (!characterIds.has(change.characterId)) {
        throw new Error(`事件 ${event.id} 的 CharacterChange 引用了不存在的角色: ${change.characterId}`);
      }
      characters[change.characterId] = applyCharacterChange(characters[change.characterId], change, now);
    }
    for (const change of event.relationshipChanges) {
      if (!relationshipIds.has(change.relationshipId)) {
        throw new Error(
          `事件 ${event.id} 的 RelationshipChange 引用了不存在的关系: ${change.relationshipId}`,
        );
      }
      relationships[change.relationshipId] = applyRelationshipChange(
        relationships[change.relationshipId],
        change,
        now,
        newId,
        options.chapterId,
      );
    }
  }

  // 2. 应用目标更新（新增 + 覆盖）
  for (const goalUpdate of output.goalUpdates) {
    if (!characterIds.has(goalUpdate.characterId)) continue;
    const character = characters[goalUpdate.characterId];
    const existing = new Set(character.state.currentGoals.map((goal) => goal.id));
    const added = goalUpdate.add.filter((goal) => !existing.has(goal.id));
    const updated = character.state.currentGoals.map((goal) => {
      const replacement = goalUpdate.update.find((item) => item.id === goal.id);
      return replacement ? { ...goal, ...replacement } : goal;
    });
    characters[goalUpdate.characterId] = {
      ...character,
      state: { ...character.state, currentGoals: [...updated, ...added] },
      updatedAt: now,
    };
  }

  // 3. 应用 Hook 更新
  for (const hookUpdate of output.hookUpdates) {
    if (!characterIds.has(hookUpdate.characterId)) continue;
    const character = characters[hookUpdate.characterId];
    const resolveIds = new Set(hookUpdate.resolveIds ?? []);
    const hooks = character.core.hooks.map((hook) =>
      resolveIds.has(hook.id) ? { ...hook, status: "resolved" as const, resolvedAtChapterId: options.chapterId } : hook,
    );
    const existingHookIds = new Set(hooks.map((hook) => hook.id));
    const addedHooks = (hookUpdate.add ?? []).filter((hook) => !existingHookIds.has(hook.id));
    characters[hookUpdate.characterId] = {
      ...character,
      core: { ...character.core, hooks: [...hooks, ...addedHooks] },
      updatedAt: now,
    };
  }

  // 4. 新增记忆：写入 memories，并挂到对应角色的 memoryIds
  for (const memory of output.newMemories) {
    if (!characterIds.has(memory.characterId)) {
      throw new Error(`新记忆 ${memory.id} 引用了不存在的角色: ${memory.characterId}`);
    }
    memories[memory.id] = memory;
    const character = characters[memory.characterId];
    if (!character.memoryIds.includes(memory.id)) {
      characters[memory.characterId] = {
        ...character,
        memoryIds: [...character.memoryIds, memory.id],
        updatedAt: now,
      };
    }
  }

  // 5. 事件进入 canonical
  const canonicalEventIds = [...world.canonicalEventIds];
  for (const event of output.events) {
    if (!canonicalEventIds.includes(event.id)) canonicalEventIds.push(event.id);
  }

  // 6. 线程更新
  const openThreads = world.openThreads.map((thread) => {
    if (output.threadUpdates.resolveIds.includes(thread.id)) {
      return { ...thread, status: "resolved" as const };
    }
    if (output.threadUpdates.dormantIds.includes(thread.id)) {
      return { ...thread, status: "dormant" as const };
    }
    return thread;
  });
  const existingThreadIds = new Set(openThreads.map((thread) => thread.id));
  for (const thread of output.threadUpdates.create) {
    if (!existingThreadIds.has(thread.id)) {
      openThreads.push({ ...thread, status: "open" });
      existingThreadIds.add(thread.id);
    }
  }

  // 7. 章节记录
  const chapterIds = world.chapterIds.includes(options.chapterId)
    ? world.chapterIds
    : [...world.chapterIds, options.chapterId];

  // 8. 角色时间推进
  for (const characterId of Object.keys(characters)) {
    characters[characterId] = advanceCharacterClock(characters[characterId], options.endYear, now);
  }

  const next: WorldState = {
    ...world,
    currentYear: options.endYear,
    characters,
    relationships,
    memories,
    chapterIds,
    openThreads,
    canonicalEventIds,
    updatedAt: now,
  };

  validateWorldState(next);
  return next;
}

export type { StoryThread };
