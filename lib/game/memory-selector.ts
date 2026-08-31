// Memory Selector（Phase 4）
// 为 World Simulator 挑选相关记忆（方案 §11.3）：
// 永久事实 + 按 重要性×recency 排序的近期记忆，最多 8 条，不做最近 N 条简单截断。

import type { CharacterMemory } from "../domain/memory";
import type { WorldState } from "../domain/world";

export function selectRelevantMemories(world: WorldState, limit = 8): CharacterMemory[] {
  const memories = Object.values(world.memories).filter((memory) => memory.active);
  const permanent = memories.filter((memory) => memory.permanentFact);
  const others = memories
    .filter((memory) => !memory.permanentFact)
    .sort((a, b) => {
      const score = (memory: CharacterMemory) => memory.importance * 0.7 + memory.year * 0.3;
      return score(b) - score(a);
    });

  const selected: CharacterMemory[] = [];
  const seen = new Set<string>();
  for (const memory of [...permanent, ...others]) {
    if (seen.has(memory.id)) continue;
    seen.add(memory.id);
    selected.push(memory);
    if (selected.length === limit) break;
  }
  return selected;
}
