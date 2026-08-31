// 基础校验（Phase 0 交付物之一）
// 只做可机械判定的检查：字段类型、数值边界、合法引用。
// 世界规则与叙事偏好不在本层校验。

import {
  isFiniteNumber,
  LIFE_STAT_KEYS,
  STAT_MAX,
  STAT_MIN,
  type LifeStatKey,
  type LifeStats,
} from "./shared";
import type { WorldState } from "./world";
import { RELATIONSHIP_DELTA_CEILING } from "./simulation";

export function assertLifeStats(value: unknown, label = "stats"): LifeStats {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  const record = value as Record<string, unknown>;
  for (const key of LIFE_STAT_KEYS) {
    const amount = record[key];
    if (!isFiniteNumber(amount) || amount < STAT_MIN || amount > STAT_MAX) {
      throw new Error(`${label}.${key} 必须是 ${STAT_MIN} 到 ${STAT_MAX} 的有限数字`);
    }
  }
  return record as unknown as LifeStats;
}

// 校验 statDelta：Partial<LifeStats>，数值必须有限且落在 -100..100（实际由结算 clamp）
export function assertStatDelta(value: unknown, label = "statDelta"): Partial<LifeStats> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  const record = value as Record<string, unknown>;
  const delta: Partial<LifeStats> = {};
  for (const key of LIFE_STAT_KEYS) {
    const amount = record[key];
    if (amount === undefined) continue;
    if (!isFiniteNumber(amount)) {
      throw new Error(`${label}.${key} 必须是有限数字`);
    }
    if (amount < -100 || amount > 100) {
      throw new Error(`${label}.${key} 超出允许的增量范围`);
    }
    delta[key] = amount;
  }
  return delta;
}

export function assertRelationshipScoreDelta(
  value: unknown,
  label = "scoreDelta",
  ceiling = RELATIONSHIP_DELTA_CEILING,
): Partial<Record<"closeness" | "trust" | "conflict" | "commitment", number>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  const record = value as Record<string, unknown>;
  const delta: Partial<Record<"closeness" | "trust" | "conflict" | "commitment", number>> = {};
  for (const key of ["closeness", "trust", "conflict", "commitment"] as const) {
    const amount = record[key];
    if (amount === undefined) continue;
    if (!isFiniteNumber(amount) || Math.abs(amount) > ceiling) {
      throw new Error(`${label}.${key} 必须是有限数字且绝对值不超过 ${ceiling}`);
    }
    delta[key] = amount;
  }
  return delta;
}

export function assertIdKnown(id: string, known: Set<string>, label: string): void {
  if (!known.has(id)) {
    throw new Error(`${label} 引用了不存在的 id: ${id}`);
  }
}

// WorldState 引用完整性校验
export function validateWorldState(world: WorldState): void {
  const { characters, relationships, memories } = world;

  if (!characters[world.protagonistId]) {
    throw new Error(`protagonistId 引用了不存在的角色: ${world.protagonistId}`);
  }

  const characterIds = new Set(Object.keys(characters));
  for (const character of Object.values(characters)) {
    for (const memoryId of character.memoryIds) {
      if (!memories[memoryId]) {
        throw new Error(`角色 ${character.id} 的 memoryIds 引用了不存在的记忆: ${memoryId}`);
      }
    }
  }

  for (const relationship of Object.values(relationships)) {
    assertIdKnown(relationship.characterAId, characterIds, `关系 ${relationship.id}.characterAId`);
    assertIdKnown(relationship.characterBId, characterIds, `关系 ${relationship.id}.characterBId`);
    for (const scoreKey of ["closeness", "trust", "conflict", "commitment"] as const) {
      const score = relationship.scores[scoreKey];
      if (!isFiniteNumber(score) || score < STAT_MIN || score > STAT_MAX) {
        throw new Error(
          `关系 ${relationship.id} 的 ${scoreKey} 必须是 ${STAT_MIN} 到 ${STAT_MAX} 的数字`,
        );
      }
    }
  }

  for (const memory of Object.values(memories)) {
    assertIdKnown(memory.characterId, characterIds, `记忆 ${memory.id}.characterId`);
    if (!isFiniteNumber(memory.importance) || memory.importance < 0 || memory.importance > 100) {
      throw new Error(`记忆 ${memory.id} 的 importance 必须是 0 到 100 的数字`);
    }
  }
}

// 数值查询辅助：LifeStats 内某个 key 的当前值
export function statOf(stats: LifeStats, key: LifeStatKey): number {
  return stats[key];
}
