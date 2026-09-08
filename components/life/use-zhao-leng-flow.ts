"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { GameSave } from "@/lib/domain/chapter";
import type {
  RuntimeBlock,
  SceneChoiceResponse,
  ScenePackage,
  SceneRuntimeState,
  SceneFlowPosition,
} from "@/lib/domain/scene";
import type { ZhaoLengCommand, ZhaoLengPreparedArtifact } from "@/lib/domain/zhao-leng-runtime";
import {
  mergeSceneProjection,
  projectGameSave,
} from "@/lib/game/scene-save";
import { appendSceneChoiceCheckpoint } from "@/lib/game/snapshot-manager";
import {
  captureZhaoLengNarrativeIdentity,
  createPendingSceneFlow,
  isCurrentZhaoLengNarrativeContext,
  mergeNarrativePreviewSave,
  presentSceneChoiceResponse,
  resolveZhaoLengBoundary,
  sceneFlowPosition,
  type ZhaoLengBoundaryResult,
} from "@/lib/game/zhao-leng-flow";
import {
  recordSceneBlockRead,
  type SceneReadingBlockInput,
} from "@/lib/game/scene-reading";
import {
  nextZhaoLengBeatId,
  zhaoLengPrepareFingerprint,
} from "@/lib/game/zhao-leng-prepare-input";

type FlowSource = "button" | "click" | "keyboard" | "auto" | "recovery";

type CommandResponse = {
  gameSave: GameSave;
  scenePackage?: ScenePackage;
  runtime: SceneRuntimeState;
  replayed: boolean;
  endingId?: string;
};

type ExperienceResponse = { saveAfter: GameSave };

export type ZhaoLengSavePublisher = (
  next: GameSave,
  options?: { allowPending?: boolean },
) => boolean;

export type ZhaoLengFlowOptions = {
  saveRef: RefObject<GameSave | null>;
  activePackage?: ScenePackage;
  publishSave: ZhaoLengSavePublisher;
  postJson: (url: string, body: unknown) => Promise<unknown>;
  onError: (message: string) => void;
};

function samePosition(
  left: SceneFlowPosition | null | undefined,
  right: SceneFlowPosition | null | undefined,
): boolean {
  if (!left || !right) return false;
  return (
    left.branchId === right.branchId &&
    left.chapterId === right.chapterId &&
    left.packageId === right.packageId &&
    left.packageVersion === right.packageVersion &&
    left.sceneId === right.sceneId &&
    left.blockId === right.blockId &&
    left.revision === right.revision
  );
}

function blockType(block: RuntimeBlock): SceneReadingBlockInput["blockType"] {
  return block.content.type === "choice" ? "choice" : block.content.type;
}

function commandIsZhaoLengType(value: string): value is ZhaoLengCommand["type"] {
  return [
    "observe_library_card",
    "advance_beat",
    "open_hidden",
    "finish_hidden",
    "finish_normal",
    "finish_ending",
  ].includes(value);
}

function flowError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function readPrepareStream(response: Response): Promise<ZhaoLengPreparedArtifact> {
  if (!response.ok) throw new Error(`赵冷下一节拍准备失败（HTTP ${response.status}）`);
  if (!response.body) throw new Error("赵冷下一节拍准备流为空");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let artifact: ZhaoLengPreparedArtifact | undefined;
  let terminal: "complete" | "error" | undefined;
  const consume = (chunk: string) => {
    buffer += chunk;
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim();
      const data = block.match(/^data:\s*(.+)$/m)?.[1];
      if (!event || !data) continue;
      const payload = JSON.parse(data) as { artifact?: ZhaoLengPreparedArtifact; message?: string };
      if (event === "unit_ready" && payload.artifact) artifact = payload.artifact;
      if (event === "error") {
        terminal = "error";
        throw new Error(payload.message || "赵冷下一节拍准备失败");
      }
      if (event === "complete") terminal = "complete";
    }
  };
  while (true) {
    const next = await reader.read();
    if (next.done) {
      consume(decoder.decode());
      break;
    }
    consume(decoder.decode(next.value, { stream: true }));
  }
  if (terminal !== "complete" || !artifact) throw new Error("赵冷下一节拍准备流未完成");
  return artifact;
}

async function readStorySceneAction(response: Response): Promise<SceneChoiceResponse> {
  if (!response.ok) throw new Error(`故事选择失败（HTTP ${response.status}）`);
  if (!response.body) throw new Error("故事选择流为空");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: SceneChoiceResponse | undefined;
  let terminal = false;
  const consume = (chunk: string) => {
    buffer += chunk;
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim();
      const data = block.match(/^data:\s*(.+)$/m)?.[1];
      if (!event || !data) continue;
      const payload = JSON.parse(data) as { response?: SceneChoiceResponse; message?: string };
      if (event === "canonical_committed" && payload.response) result = payload.response;
      if (event === "error") throw new Error(payload.message || "故事选择失败");
      if (event === "complete") terminal = true;
    }
  };
  while (true) {
    const next = await reader.read();
    if (next.done) {
      consume(decoder.decode());
      break;
    }
    consume(decoder.decode(next.value, { stream: true }));
  }
  if (!terminal || !result) throw new Error("故事选择流未完成");
  return result;
}

export function useZhaoLengFlow(options: ZhaoLengFlowOptions) {
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState("");
  const generation = useRef(0);
  const busyRef = useRef(false);
  const exclusiveToken = useRef(0);
  const attemptedBoundaries = useRef(new Set<string>());
  const prepareRef = useRef<{ fingerprint: string; promise: Promise<ZhaoLengPreparedArtifact> } | null>(null);
  const packageIdentity = `${options.activePackage?.id ?? "none"}:v${options.activePackage?.version ?? 0}:${options.saveRef.current?.activeBranchId ?? "main"}`;

  useEffect(() => {
    generation.current += 1;
    attemptedBoundaries.current.clear();
    prepareRef.current = null;
    setPreparing(false);
  }, [packageIdentity]);

  const invalidateSession = useCallback(() => {
    generation.current += 1;
    attemptedBoundaries.current.clear();
    exclusiveToken.current += 1;
    prepareRef.current = null;
    busyRef.current = false;
    setBusy(false);
    setPreparing(false);
  }, []);

  const runExclusive = useCallback(async (work: (requestGeneration: number) => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const token = exclusiveToken.current + 1;
    exclusiveToken.current = token;
    const requestGeneration = generation.current;
    try {
      await work(requestGeneration);
    } finally {
      if (exclusiveToken.current === token) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }, []);

  const refreshNarrative = useCallback(async (next: GameSave, contextKind: "demo-entry" | "zhao-leng-beat") => {
    const identity = captureZhaoLengNarrativeIdentity(next, generation.current);
    if (!identity) return;
    try {
      const result = await options.postJson("/api/life/zhao-leng/experience", { save: next, contextKind }) as ExperienceResponse;
      const current = options.saveRef.current;
      if (!current || generation.current !== identity.generation || !isCurrentZhaoLengNarrativeContext(current, identity, generation.current)) return;
      const merged = mergeNarrativePreviewSave(current, result.saveAfter, identity, generation.current);
      if (merged && merged !== current) options.publishSave(merged);
    } catch {
      // 叙事预览是附加内容；场景结算已经成功时不阻断玩家继续。
    }
  }, [options]);

  const onBlockRead = useCallback((input: {
    block: RuntimeBlock;
    state: SceneRuntimeState;
    source: "button" | "click" | "keyboard" | "auto";
    choiceId?: "A" | "B" | "C";
    selectedChoiceLabel?: string;
  }) => {
    const current = options.saveRef.current;
    if (!current?.zhaoLeng || !current.sceneRuntime) return;
    if (
      current.sceneRuntime.branchId !== input.state.branchId ||
      current.sceneRuntime.packageId !== input.state.packageId ||
      current.sceneRuntime.packageVersion !== input.state.packageVersion
    ) return;
    const readingInput: SceneReadingBlockInput = {
      mode: current.zhaoLeng.generationMode,
      branchId: input.state.branchId,
      chapterId: input.state.chapterId,
      packageId: input.state.packageId,
      packageVersion: input.state.packageVersion,
      sceneId: input.state.sceneId,
      blockId: input.state.blockId,
      blockType: blockType(input.block),
      text: input.block.content.text,
      ...(input.block.content.type === "dialogue" && input.block.content.speaker ? { speaker: input.block.content.speaker } : {}),
      ...(input.choiceId ? { selectedChoiceId: input.choiceId } : {}),
      ...(input.selectedChoiceLabel ? { selectedChoiceLabel: input.selectedChoiceLabel } : {}),
    };
    const nextReading = recordSceneBlockRead(current.sceneReading, readingInput, new Date().toISOString());
    if (JSON.stringify(nextReading) === JSON.stringify(current.sceneReading)) return;
    options.publishSave({ ...current, sceneReading: nextReading, savedAt: new Date().toISOString() });
  }, [options]);

  const onPersistPosition = useCallback((runtime: SceneRuntimeState) => {
    const current = options.saveRef.current;
    if (!current?.sceneRuntime || !current.zhaoLeng) return;
    if (
      current.sceneRuntime.branchId !== runtime.branchId ||
      current.sceneRuntime.packageId !== runtime.packageId ||
      current.sceneRuntime.packageVersion !== runtime.packageVersion
    ) return;
    if (JSON.stringify(current.sceneRuntime) === JSON.stringify(runtime)) return;
    options.publishSave({ ...current, sceneRuntime: runtime, savedAt: new Date().toISOString() });
  }, [options]);

  const prepareNextBeat = useCallback(async (candidate: GameSave): Promise<ZhaoLengPreparedArtifact | undefined> => {
    if (!candidate.zhaoLeng) return undefined;
    const nextBeatId = nextZhaoLengBeatId(candidate);
    if (!nextBeatId) return undefined;
    const fingerprint = zhaoLengPrepareFingerprint(candidate, nextBeatId);
    const existing = candidate.zhaoLeng.preparedArtifact;
    if (existing?.inputFingerprint === fingerprint && existing.beatId === nextBeatId) return existing;
    const active = prepareRef.current;
    if (active?.fingerprint === fingerprint) return active.promise;
    setPrepareError("");
    setPreparing(true);
    const requestGenerationForPrepare = generation.current;
    const promise = (async () => {
      const response = await fetch("/api/life/zhao-leng/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          save: candidate,
          nextBeatId,
          inputFingerprint: fingerprint,
          requestId: `zhao-prepare-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`,
        }),
      });
      const artifact = await readPrepareStream(response);
      const current = options.saveRef.current;
      if (!current || generation.current !== requestGenerationForPrepare || !current.zhaoLeng) return artifact;
      if (nextZhaoLengBeatId(current) !== nextBeatId || zhaoLengPrepareFingerprint(current, nextBeatId) !== fingerprint) return artifact;
      options.publishSave({
        ...current,
        savedAt: new Date().toISOString(),
        zhaoLeng: { ...current.zhaoLeng, preparedArtifact: artifact },
      }, { allowPending: true });
      return artifact;
    })();
    prepareRef.current = { fingerprint, promise };
    try {
      return await promise;
    } catch (error) {
      setPrepareError(flowError(error, "赵冷下一节拍准备失败"));
      throw error;
    } finally {
      if (prepareRef.current?.fingerprint === fingerprint) prepareRef.current = null;
      setPreparing(false);
    }
  }, [options]);

  const executeCommand = useCallback(async (
    type: ZhaoLengCommand["type"],
    source: FlowSource,
    requestGeneration: number,
    providedPending?: NonNullable<GameSave["sceneFlow"]>["pendingCommand"],
  ) => {
    const current = options.saveRef.current;
    const packageItem = options.activePackage;
    if (!current?.sceneRuntime || !current.zhaoLeng || !packageItem) throw new Error("赵冷 Demo 场景尚未就绪");
    const currentPosition = sceneFlowPosition(current, current.sceneRuntime);
    if (!currentPosition) throw new Error("赵冷 Demo 缺少可恢复的场景位置");
    const savedPending = current.sceneFlow?.pendingCommand;
    const pending = providedPending ?? (
      savedPending &&
      savedPending.type === type &&
      samePosition(current.sceneFlow?.sourcePosition, currentPosition)
        ? savedPending
        : undefined
    );
    const command: ZhaoLengCommand = pending && commandIsZhaoLengType(pending.type)
      ? {
          type: pending.type,
          requestId: pending.requestId,
          issuedAt: pending.issuedAt,
          expectedRevision: pending.expectedRevision,
          expectedPackageId: pending.expectedPackageId,
          ...(pending.expectedBranchId ? { expectedBranchId: pending.expectedBranchId } : {}),
        }
      : {
          type,
          requestId: `zhao-${type}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`,
          issuedAt: new Date().toISOString(),
          expectedRevision: current.saveRevision ?? 0,
          expectedPackageId: packageItem.id,
          expectedBranchId: current.activeBranchId ?? current.sceneRuntime.branchId,
        };
    if (command.type !== type && !pending) throw new Error("待处理命令与当前位置不一致");
    const pendingState = createPendingSceneFlow(current, {
      type: command.type,
      requestId: command.requestId,
      issuedAt: command.issuedAt,
      expectedRevision: command.expectedRevision,
      expectedPackageId: command.expectedPackageId,
      ...(command.expectedBranchId ? { expectedBranchId: command.expectedBranchId } : {}),
      source: pending?.source ?? source,
    }, current.sceneRuntime);
    if (!pendingState) throw new Error("赵冷 Demo 无法保存待处理位置");
    let prepared: GameSave = {
      ...current,
      sceneFlow: pendingState,
      savedAt: new Date().toISOString(),
    };
    if (!options.publishSave(prepared)) throw new Error("命令发送前自动保存失败，请先重试保存");
    let preparedArtifact = prepared.zhaoLeng?.preparedArtifact;
    if (command.type === "advance_beat") {
      preparedArtifact = await prepareNextBeat(prepared);
      prepared = options.saveRef.current ?? prepared;
    }
    const result = await options.postJson("/api/life/zhao-leng/command", {
      save: prepared,
      command,
      ...(preparedArtifact ? { preparedArtifact } : {}),
    }) as CommandResponse;
    if (generation.current !== requestGeneration) return;
    const saved = options.publishSave(result.gameSave, { allowPending: true });
    if (saved && (command.type === "advance_beat" || command.type === "observe_library_card")) {
      await refreshNarrative(result.gameSave, "zhao-leng-beat");
    }
  }, [options, prepareNextBeat, refreshNarrative]);

  const runCommand = useCallback((type: ZhaoLengCommand["type"], source: FlowSource = "button") =>
    runExclusive(async (requestGeneration) => {
      try {
        await executeCommand(type, source, requestGeneration);
      } catch (error) {
        options.onError(flowError(error, "赵冷 Demo 命令失败"));
      }
    }), [executeCommand, options, runExclusive]);

  const onSelect = useCallback(async (input: {
    requestId: string;
    issuedAt: string;
    expectedRevision: number;
    choiceId: "A" | "B" | "C";
  }): Promise<SceneChoiceResponse> => {
    const current = options.saveRef.current;
    const packageItem = options.activePackage;
    if (!current?.sceneRuntime || !packageItem) throw new Error("赵冷 Demo 场景尚未就绪");
    const checkpoint = appendSceneChoiceCheckpoint(current, {
      chapterId: current.sceneRuntime.chapterId,
      packageId: current.sceneRuntime.packageId,
      packageVersion: current.sceneRuntime.packageVersion,
      sceneId: current.sceneRuntime.sceneId,
      blockId: current.sceneRuntime.blockId,
      runtime: current.sceneRuntime,
      actions: current.sceneActions,
      flags: current.sceneFlags,
      sceneReading: current.sceneReading,
      sceneFlow: current.sceneFlow,
      now: input.issuedAt,
    });
    if (!options.publishSave(checkpoint)) throw new Error("选择前自动保存失败，请先重试保存");
    const projection = projectGameSave(checkpoint, checkpoint.sceneRuntime ?? current.sceneRuntime, checkpoint.sceneActions, checkpoint.sceneFlags);
    const response = await fetch("/api/story/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionKind: "scene_choice", projection, package: packageItem, ...input }),
    });
    const sceneChoice = await readStorySceneAction(response);
    const presented = presentSceneChoiceResponse(packageItem, sceneChoice, "seamless");
    const next = mergeSceneProjection(checkpoint, presented.projectionAfter);
    const savedNext = { ...next, savedAt: new Date().toISOString() };
    options.publishSave(savedNext, { allowPending: true });
    void prepareNextBeat(savedNext).catch(() => undefined);
    return presented;
  }, [options, prepareNextBeat]);

  const onBoundary = useCallback(async (input: { completedRuntime: SceneRuntimeState; source: "button" | "click" | "keyboard" | "auto" }) => {
    const current = options.saveRef.current;
    if (!current?.sceneRuntime || !current.zhaoLeng) return;
    const completedSave = JSON.stringify(current.sceneRuntime) === JSON.stringify(input.completedRuntime)
      ? current
      : { ...current, sceneRuntime: input.completedRuntime, savedAt: new Date().toISOString() };
    if (completedSave !== current && !options.publishSave(completedSave)) {
      options.onError("场景完成位置尚未写入浏览器存档，请先重试保存。");
      return;
    }
    const boundary = resolveZhaoLengBoundary({ save: completedSave, completedRuntime: input.completedRuntime });
    if (boundary.kind !== "command") return;
    const key = `${input.completedRuntime.packageId}:${input.completedRuntime.sceneId}:${input.completedRuntime.blockId}:${completedSave.saveRevision ?? 0}:${boundary.type}`;
    if (attemptedBoundaries.current.has(key) && !completedSave.sceneFlow?.pendingCommand) return;
    attemptedBoundaries.current.add(key);
    await runCommand(boundary.type, input.source);
  }, [options, runCommand]);

  const chooseBoundary = useCallback((type: "open_hidden" | "finish_normal") => {
    const current = options.saveRef.current;
    if (!current?.sceneRuntime) return;
    const boundary = resolveZhaoLengBoundary({ save: current, completedRuntime: current.sceneRuntime });
    if (boundary.kind !== "decision" || !boundary.options.includes(type)) return;
    void runCommand(type, "button");
  }, [options, runCommand]);

  const retryPendingCommand = useCallback(() => {
    const pending = options.saveRef.current?.sceneFlow?.pendingCommand;
    if (!pending || !commandIsZhaoLengType(pending.type)) return;
    const pendingType = pending.type;
    void runExclusive(async (requestGeneration) => {
      try {
        await executeCommand(pendingType, "recovery", requestGeneration, pending);
      } catch (error) {
        options.onError(flowError(error, "赵冷 Demo 命令重试失败"));
      }
    });
  }, [executeCommand, options, runExclusive]);

  useEffect(() => {
    const current = options.saveRef.current;
    const runtime = current?.sceneRuntime;
    const pending = current?.sceneFlow?.pendingCommand;
    if (!current || !runtime || runtime.status !== "completed" || current.zhaoLeng?.stage === "ended") return;
    const recoveryKey = `${runtime.packageId}:${runtime.sceneId}:${runtime.blockId}:${current.saveRevision ?? 0}:${pending?.requestId ?? "boundary"}`;
    if (attemptedBoundaries.current.has(recoveryKey)) return;
    attemptedBoundaries.current.add(recoveryKey);
    if (pending && commandIsZhaoLengType(pending.type)) {
      void retryPendingCommand();
      return;
    }
    const boundary: ZhaoLengBoundaryResult = resolveZhaoLengBoundary({ save: current, completedRuntime: runtime });
    if (boundary.kind === "command") void runCommand(boundary.type, "recovery");
  }, [options.activePackage, options.saveRef, retryPendingCommand, runCommand]);

  return {
    busy,
    preparing,
    prepareError,
    onSelect,
    onBlockRead,
    onPersistPosition,
    onBoundary,
    runCommand,
    chooseBoundary,
    retryPendingCommand,
    prepareNextBeat,
    refreshNarrative,
    invalidateSession,
  };
}
