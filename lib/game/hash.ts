// 状态哈希（Phase 6）：用于 Chapter 的 stateBeforeHash / stateAfterHash，
// 验证"小说重写不改变 WorldState"（方案 §16、验收 Case C）。

import { createHash } from "node:crypto";

export function hashState(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}
