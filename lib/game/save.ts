// GameSave v1 辅助（Phase 0 交付物）
// 客户端 localStorage，versioned JSON（方案 §25）。
// 旧存档（legacy schema）不自动升级（方案 §33）：提示用户旧存档走旧模式。

import type { GameSave } from "../domain/chapter";

export const GAME_SAVE_SCHEMA_VERSION = 1 as const;

const LEGACY_SAVE_MESSAGE =
  "当前存档来自旧版人生重启模式，可继续使用旧模式；新互动人生需要创建新存档。";

export function parseGameSave(raw: unknown): GameSave {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("存档数据不是对象");
  }
  const save = raw as Partial<GameSave>;
  if (save.schemaVersion === undefined || save.schemaVersion === null) {
    throw new Error("存档缺少 schemaVersion 字段");
  }
  if (save.schemaVersion !== GAME_SAVE_SCHEMA_VERSION) {
    throw new Error(LEGACY_SAVE_MESSAGE);
  }
  if (!save.worldState || typeof save.worldState !== "object") {
    throw new Error("存档缺少 worldState");
  }
  if (!save.chapters || typeof save.chapters !== "object") {
    throw new Error("存档缺少 chapters");
  }
  if (!save.events || typeof save.events !== "object") {
    throw new Error("存档缺少 events");
  }
  if (!save.savedAt || typeof save.savedAt !== "string") {
    throw new Error("存档缺少 savedAt");
  }
  return save as GameSave;
}

export function serializeGameSave(save: GameSave): string {
  return JSON.stringify(save);
}
