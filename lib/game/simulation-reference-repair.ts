import { createHash } from "node:crypto";

export type ReferenceRepairPatch = {
  op: "replace";
  path: string;
  value: string;
};

export type ReferenceRepair = {
  candidateHash: string;
  patches: ReferenceRepairPatch[];
};

const REFERENCE_PATH = /^(?:events|newMemories|goalUpdates|hookUpdates|threadUpdates)\[\d+\](?:\.(?:causes|characterChanges|relationshipChanges|create)\[\d+\])?\.(?:refId|characterId|relationshipId|resolveIssueId|resolveGoalIds|resolveHookIds|evidenceIds|participantIds|relatedCharacterIds|createsThreadLabels|resolvesThreadIds|resolveIds|dormantIds)(?:\[\d+\])?$/;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stableCandidate(value: unknown): string {
  return JSON.stringify(value);
}

export function hashSimulationCandidate(value: unknown): string {
  return createHash("sha256").update(stableCandidate(value)).digest("hex");
}

export function isWhitelistedReferencePath(path: string): boolean {
  return REFERENCE_PATH.test(path);
}

function pathParts(path: string): Array<string | number> {
  const parts: Array<string | number> = [];
  const matcher = /([A-Za-z][A-Za-z0-9_]*)|(\[(\d+)\])/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(path))) {
    if (match.index !== cursor && path.slice(cursor, match.index) !== ".") throw new Error(`引用修正路径非法：${path}`);
    if (match[1]) parts.push(match[1]);
    else parts.push(Number(match[3]));
    cursor = matcher.lastIndex;
  }
  if (cursor !== path.length) throw new Error(`引用修正路径非法：${path}`);
  return parts;
}

function replaceAt(root: unknown, path: string, value: string): unknown {
  const parts = pathParts(path);
  if (!parts.length) throw new Error("引用修正路径不能为空");
  let current: unknown = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (!current || typeof current !== "object" || !(part in (current as Record<string | number, unknown>))) {
      throw new Error(`引用修正路径不存在：${path}`);
    }
    current = (current as Record<string | number, unknown>)[part];
  }
  const last = parts.at(-1) as string | number;
  if (!current || typeof current !== "object" || !(last in (current as Record<string | number, unknown>))) {
    throw new Error(`引用修正路径不存在：${path}`);
  }
  (current as Record<string | number, unknown>)[last] = value;
  return root;
}

export function applyReferenceRepair(candidate: unknown, repair: ReferenceRepair): unknown {
  if (!repair || typeof repair.candidateHash !== "string" || repair.candidateHash !== hashSimulationCandidate(candidate)) {
    throw new Error("引用修正 candidateHash 与原始候选不匹配，拒绝覆盖原候选");
  }
  if (!Array.isArray(repair.patches) || repair.patches.length === 0 || repair.patches.length > 8) {
    throw new Error("引用修正必须是 1 到 8 个有限 patch");
  }
  const next = clone(candidate);
  for (const patch of repair.patches) {
    if (patch?.op !== "replace" || typeof patch.path !== "string" || typeof patch.value !== "string") {
      throw new Error("引用修正只允许 replace 字符串 patch");
    }
    if (!isWhitelistedReferencePath(patch.path)) {
      throw new Error(`引用修正路径不在 whitelist：${patch.path}`);
    }
    replaceAt(next, patch.path, patch.value);
  }
  return next;
}
