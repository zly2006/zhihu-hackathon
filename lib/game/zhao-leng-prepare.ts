import type { GameSave } from "../domain/chapter";
import type {
  ZhaoLengBeatId,
  ZhaoLengPreparedArtifact,
} from "../domain/zhao-leng-runtime";
import { ZHAO_LENG_CONTENT_VERSION } from "../domain/zhao-leng-runtime";
import { StoryArtifactCache } from "./story-cache";
import {
  generateZhaoLengBeat,
  type ZhaoLengWriterModel,
} from "./zhao-leng-writer";
import {
  activeZhaoLengSourcePackage,
  nextZhaoLengBeatId,
  projectedZhaoLengWriterSave,
  zhaoLengPrepareFingerprint,
  ZHAO_LENG_PREPARE_PIPELINE_VERSION,
} from "./zhao-leng-prepare-input";
import { validateZhaoLengPreparedArtifact } from "./zhao-leng-artifact-validator";

export {
  nextZhaoLengBeatId,
  zhaoLengPrepareFingerprint,
  ZHAO_LENG_PREPARE_PIPELINE_VERSION,
} from "./zhao-leng-prepare-input";
export { validateZhaoLengPreparedArtifact } from "./zhao-leng-artifact-validator";
export const ZHAO_LENG_PREPARE_TTL_MS = 10 * 60 * 1000;

const preparedArtifactCache = new StoryArtifactCache<ZhaoLengPreparedArtifact>({
  ttlMs: ZHAO_LENG_PREPARE_TTL_MS,
  maxEntries: 32,
});

export type PrepareZhaoLengBeatInput = {
  save: GameSave;
  nextBeatId?: ZhaoLengBeatId;
  now?: string;
  requestId?: string;
  model?: ZhaoLengWriterModel;
  signal?: AbortSignal;
  executionId?: string;
};

export async function prepareZhaoLengBeat(input: PrepareZhaoLengBeatInput): Promise<ZhaoLengPreparedArtifact> {
  const nextBeatId = input.nextBeatId ?? nextZhaoLengBeatId(input.save);
  if (!nextBeatId) throw new Error("当前赵冷节拍没有可准备的下一节拍");
  const expectedNextBeat = nextZhaoLengBeatId(input.save);
  if (expectedNextBeat !== nextBeatId) throw new Error("赵冷下一节拍已经变化，准备结果已作废");
  const projected = projectedZhaoLengWriterSave(input.save);
  const fingerprint = zhaoLengPrepareFingerprint(input.save, nextBeatId);
  const sourcePackage = activeZhaoLengSourcePackage(input.save);
  const branchId = input.save.activeBranchId ?? input.save.sceneRuntime?.branchId ?? "main";
  const mode = input.save.zhaoLeng?.generationMode ?? "scripted";
  const createdAt = input.now ?? new Date().toISOString();
  const expiresAt = new Date(Date.parse(createdAt) + ZHAO_LENG_PREPARE_TTL_MS).toISOString();
  const cached = preparedArtifactCache.get(fingerprint);
  if (cached) {
    try {
      return validateZhaoLengPreparedArtifact(input.save, nextBeatId, cached);
    } catch {
      preparedArtifactCache.invalidate(fingerprint);
    }
  }
  return preparedArtifactCache.getOrPrepare(fingerprint, async () => {
    const written = await generateZhaoLengBeat(
      { save: projected, beatId: nextBeatId, mode },
      { model: input.model, maxAttempts: 2, signal: input.signal, executionId: input.executionId ?? `zhao-prepare:${fingerprint}` },
    );
    const artifact: ZhaoLengPreparedArtifact = {
      schemaVersion: 1,
      artifactId: `zhao-prepare-${fingerprint}`,
      beatId: nextBeatId,
      inputFingerprint: fingerprint,
      generationMode: mode,
      contentVersion: ZHAO_LENG_CONTENT_VERSION,
      pipelineVersion: ZHAO_LENG_PREPARE_PIPELINE_VERSION,
      branchId,
      sourcePackageId: sourcePackage.id,
      sourcePackageVersion: sourcePackage.version,
      written,
      createdAt,
      expiresAt,
    };
    return validateZhaoLengPreparedArtifact(input.save, nextBeatId, artifact, new Date(createdAt));
  });
}

export function clearZhaoLengPreparedArtifactCache(): void {
  preparedArtifactCache.clear();
}
