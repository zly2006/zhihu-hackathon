// Narrative Plan 代号映射（V1.1 加固）
// 根因：真实事件/角色 id 是 uuid，Director LLM 常"近似伪造"出长得像的假 uuid，
// 导致校验全部失败并触发重试风暴（实测单章浪费 2+ 分钟）。
// 方案：Prompt 中只用短代号（E1..En / C1..Cn），生成后由本模块映射回真实 id。
// 纯函数，无 LLM 依赖，便于测试。
import type { NarrativePlan } from "../domain/narrative";
import type { SimulationEvent } from "../domain/simulation";
import type { WorldState } from "../domain/world";

export type AliasTables = {
  eventAliasToId: Map<string, string>;
  characterAliasToId: Map<string, string>;
};

export function buildAliasTables(events: SimulationEvent[], world: WorldState): AliasTables {
  const eventAliasToId = new Map<string, string>();
  events.forEach((event, index) => {
    eventAliasToId.set(`E${index + 1}`, event.id);
  });
  const characterAliasToId = new Map<string, string>();
  const orderedIds = [
    world.protagonistId,
    ...Object.keys(world.characters)
      .filter((id) => id !== world.protagonistId)
      .sort(),
  ];
  orderedIds.forEach((id, index) => {
    characterAliasToId.set(`C${index + 1}`, id);
  });
  return { eventAliasToId, characterAliasToId };
}

export function eventLabelFor(events: SimulationEvent[]): string {
  return events.map((event, index) => `E${index + 1}=${event.title.slice(0, 14)}`).join("；");
}

export function characterLabelFor(world: WorldState): string {
  const orderedIds = [
    world.protagonistId,
    ...Object.keys(world.characters)
      .filter((id) => id !== world.protagonistId)
      .sort(),
  ];
  return orderedIds
    .map((id, index) => {
      const character = world.characters[id];
      return `C${index + 1}=${character.identity.name}${character.role === "protagonist" ? "(主角)" : ""}`;
    })
    .join("；");
}

function resolveIds(values: string[] | undefined, table: Map<string, string>): string[] {
  if (!Array.isArray(values)) return [];
  const resolved: string[] = [];
  for (const value of values) {
    const mapped = table.get(value);
    if (mapped && !resolved.includes(mapped)) resolved.push(mapped);
    else if (!resolved.includes(value)) resolved.push(value);
  }
  return resolved;
}

export function resolvePlanAliases(plan: NarrativePlan, tables: AliasTables): NarrativePlan {
  return {
    ...plan,
    canonicalEventIds: resolveIds(plan.canonicalEventIds, tables.eventAliasToId),
    scenes: plan.scenes.map((scene) => ({
      ...scene,
      sourceEventIds: resolveIds(scene.sourceEventIds, tables.eventAliasToId),
      participantIds: resolveIds(scene.participantIds, tables.characterAliasToId),
      povCharacterId: tables.characterAliasToId.get(scene.povCharacterId) ?? scene.povCharacterId,
    })),
    characterArcs: plan.characterArcs.map((arc) => ({
      ...arc,
      characterId: tables.characterAliasToId.get(arc.characterId) ?? arc.characterId,
    })),
  };
}
