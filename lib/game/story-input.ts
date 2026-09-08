import type { StoryIdentity, StoryRequestIdentity, StorySource } from "../domain/story";

const IGNORED_READING_KEYS = new Set([
  "readingBlockId",
  "readBlockIds",
  "readAt",
  "displayedAt",
  "savedAt",
  "updatedAt",
  "pureReadingRevision",
]);

function normalize(value: unknown, key?: string): unknown {
  if (key && IGNORED_READING_KEYS.has(key)) return undefined;
  if (Array.isArray(value)) return value.map((item) => normalize(item)).filter((item) => item !== undefined);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.keys(record)
    .sort()
    .reduce<Record<string, unknown>>((result, childKey) => {
      const child = normalize(record[childKey], childKey);
      if (child !== undefined) result[childKey] = child;
      return result;
    }, {});
}

export function stableStorySerialize(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function hashText(value: string): string {
  // Fingerprints are request identities, not authentication tokens. A small
  // deterministic hash keeps this module safe to import from client bundles.
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createStoryInputFingerprint(input: {
  source: StorySource;
  saveId: string;
  runId: string;
  branchId: string;
  pipelineVersion: number;
  unitId: string;
  facts: unknown;
}): string {
  return `story-fp-${hashText(stableStorySerialize({
    source: input.source,
    saveId: input.saveId,
    runId: input.runId,
    branchId: input.branchId,
    pipelineVersion: input.pipelineVersion,
    unitId: input.unitId,
    facts: input.facts,
  }))}`;
}

export function createStoryRequestIdentity(
  identity: StoryIdentity,
  input: { requestId: string; sourceUnitId: string; facts: unknown },
): StoryRequestIdentity {
  return {
    ...identity,
    requestId: input.requestId,
    sourceUnitId: input.sourceUnitId,
    inputFingerprint: createStoryInputFingerprint({
      source: identity.source,
      saveId: identity.saveId,
      runId: identity.runId,
      branchId: identity.branchId,
      pipelineVersion: identity.pipelineVersion,
      unitId: input.sourceUnitId,
      facts: input.facts,
    }),
  };
}

export function assertStoryInputFingerprint(expected: string, actual: string): void {
  if (!expected || expected !== actual) throw new Error("故事请求事实指纹不匹配，已拒绝应用结果");
}
