import type { GameSave } from "../domain/chapter";
import type { ZhaoLengBeatId, ZhaoLengPreparedArtifact } from "../domain/zhao-leng-runtime";
import { ZHAO_LENG_CONTENT_VERSION } from "../domain/zhao-leng-runtime";
import { parseZhaoLengWrittenBeat } from "./zhao-leng-written-validator";
import {
  activeZhaoLengSourcePackage,
  currentZhaoLengBeat,
  projectedZhaoLengWriterSave,
  zhaoLengPrepareFingerprint,
  ZHAO_LENG_PREPARE_PIPELINE_VERSION,
} from "./zhao-leng-prepare-input";
import { isZhaoLengDemoSave } from "./zhao-leng-demo";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function ensurePreparePosition(save: GameSave, nextBeatId: ZhaoLengBeatId): void {
  if (!isZhaoLengDemoSave(save) || !save.zhaoLeng) throw new Error("当前存档不是有效的赵冷 Demo 存档");
  const expected = currentZhaoLengBeat(save);
  const next = [
    "zl-01-message",
    "zl-02-library",
    "zl-03-boundary",
    "zl-04-opportunity",
    "zl-05-argument",
    "zl-06-distance",
    "zl-07-return",
    "zl-08-choice",
    "zl-09-consequence",
    "zl-10-letter",
    "zl-11-future",
    "zl-12-hook",
  ] as const;
  const index = next.indexOf(expected);
  if (index < 0 || next[index + 1] !== nextBeatId) throw new Error("赵冷下一节拍已经变化，准备结果已作废");
  activeZhaoLengSourcePackage(save);
}

export function validateZhaoLengPreparedArtifact(
  save: GameSave,
  nextBeatId: ZhaoLengBeatId,
  artifact: ZhaoLengPreparedArtifact,
  now = new Date(),
): ZhaoLengPreparedArtifact {
  ensurePreparePosition(save, nextBeatId);
  const packageItem = activeZhaoLengSourcePackage(save);
  const expectedFingerprint = zhaoLengPrepareFingerprint(save, nextBeatId);
  const branchId = save.activeBranchId ?? save.sceneRuntime?.branchId ?? "main";
  if (artifact.schemaVersion !== 1) throw new Error("赵冷 prepare artifact schemaVersion 无效");
  if (artifact.beatId !== nextBeatId || artifact.written?.beatId !== nextBeatId) throw new Error("赵冷 prepare artifact 节拍不匹配");
  if (artifact.inputFingerprint !== expectedFingerprint) throw new Error("赵冷 prepare artifact 指纹不匹配，内容已失效");
  if (artifact.contentVersion !== ZHAO_LENG_CONTENT_VERSION || artifact.pipelineVersion !== ZHAO_LENG_PREPARE_PIPELINE_VERSION) {
    throw new Error("赵冷 prepare artifact 内容版本不匹配");
  }
  if (artifact.generationMode !== save.zhaoLeng?.generationMode) throw new Error("赵冷 prepare artifact 生成模式不匹配");
  if (artifact.branchId !== branchId || artifact.sourcePackageId !== packageItem.id || artifact.sourcePackageVersion !== packageItem.version) {
    throw new Error("赵冷 prepare artifact 来源场景已经变化");
  }
  if (!Number.isFinite(Date.parse(artifact.expiresAt)) || Date.parse(artifact.expiresAt) <= now.getTime()) {
    throw new Error("赵冷 prepare artifact 已过期");
  }
  const projected = projectedZhaoLengWriterSave(save);
  const parsed = parseZhaoLengWrittenBeat(artifact.written, { save: projected, beatId: nextBeatId });
  return { ...clone(artifact), written: parsed };
}
