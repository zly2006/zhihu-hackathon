"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DialogueChoiceId } from "@/lib/domain/dialogue";
import type {
  RuntimeBlock,
  SceneChoiceResponse,
  ScenePackage,
  SceneRuntimeState,
  SceneSaveProjection,
} from "@/lib/domain/scene";
import { evaluateSceneRequirements } from "@/lib/game/relationship-levels";
import {
  createSceneRuntime,
  getActiveBlock,
  getActiveScene,
  transitionSceneRuntime,
  type SceneFlowPolicy,
} from "@/lib/game/scene-runtime";
import {
  autoDelayMs,
  canAutoAdvance,
  type SceneReadingPreferences,
} from "@/lib/game/scene-reading";

export type SceneAdvanceSource = "button" | "click" | "keyboard" | "auto";

export type UseSceneRuntimeOptions = {
  scenePackage: ScenePackage;
  initialState: SceneRuntimeState;
  projection?: SceneSaveProjection;
  readOnly?: boolean;
  flowPolicy?: SceneFlowPolicy;
  autoSpeed?: SceneReadingPreferences["autoSpeed"];
  autoPaused?: boolean;
  observationWindow?: boolean;
  interactionDisabled?: boolean;
  onSelect: (input: {
    requestId: string;
    issuedAt: string;
    expectedRevision: number;
    choiceId: DialogueChoiceId;
  }) => Promise<SceneChoiceResponse>;
  onRetrySave?: (input: {
    requestId: string;
    issuedAt: string;
    expectedRevision: number;
    choiceId: DialogueChoiceId;
  }) => Promise<SceneChoiceResponse>;
  onPersistPosition?: (state: SceneRuntimeState) => void;
  onBlockRead?: (input: {
    block: RuntimeBlock;
    state: SceneRuntimeState;
    source: SceneAdvanceSource;
    choiceId?: DialogueChoiceId;
    selectedChoiceLabel?: string;
  }) => void;
  onBoundary?: (input: { completedRuntime: SceneRuntimeState; source: SceneAdvanceSource }) => void | Promise<void>;
  onPlaybackModeChange?: (mode: SceneRuntimeState["playbackMode"]) => void;
};

function runtimeMarker(state: SceneRuntimeState): string {
  return `${state.packageId}:v${state.packageVersion}:${state.sceneId}:${state.blockId}:${state.status}`;
}

function requestIdForSceneChoice(): string {
  return globalThis.crypto?.randomUUID?.() ?? `scene-request-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

export function useSceneRuntime(options: UseSceneRuntimeOptions) {
  const [state, setState] = useState<SceneRuntimeState>(() =>
    options.readOnly && !options.initialState.readOnly
      ? { ...options.initialState, readOnly: true }
      : options.initialState,
  );
  const [feedback, setFeedback] = useState("");
  const stateRef = useRef(state);
  const inFlight = useRef<string | null>(null);
  const generation = useRef(0);
  const lastAdvanceMarker = useRef<string | null>(null);
  const lastBoundaryMarker = useRef<string | null>(null);
  const onBlockReadRef = useRef(options.onBlockRead);
  const onRetrySaveRef = useRef(options.onRetrySave);
  const onBoundaryRef = useRef(options.onBoundary);
  const onPersistPositionRef = useRef(options.onPersistPosition);
  const onPlaybackModeChangeRef = useRef(options.onPlaybackModeChange);
  const sceneIdentity = `${options.scenePackage.id}:${options.scenePackage.version}:${options.initialState.branchId}`;

  useEffect(() => {
    onBlockReadRef.current = options.onBlockRead;
    onRetrySaveRef.current = options.onRetrySave;
    onBoundaryRef.current = options.onBoundary;
    onPersistPositionRef.current = options.onPersistPosition;
    onPlaybackModeChangeRef.current = options.onPlaybackModeChange;
  }, [options.onBlockRead, options.onBoundary, options.onPersistPosition, options.onPlaybackModeChange, options.onRetrySave]);

  useEffect(() => {
    generation.current += 1;
    inFlight.current = null;
    const next = options.readOnly && !options.initialState.readOnly
      ? { ...options.initialState, readOnly: true }
      : options.initialState;
    stateRef.current = next;
    lastAdvanceMarker.current = null;
    lastBoundaryMarker.current = null;
    setState(next);
    setFeedback("");
    return () => {
      generation.current += 1;
      inFlight.current = null;
    };
    // The identity is deliberately stable across ordinary block transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneIdentity]);

  const activeScene = getActiveScene(options.scenePackage, state);
  const activeBlock = getActiveBlock(options.scenePackage, state);
  const choices = useMemo(() => {
    if (!activeBlock || activeBlock.content.type !== "choice") return [];
    const choiceContent = activeBlock.content;
    return choiceContent.choices.map((choice) => {
      const requirements = "requirements" in choice ? choice.requirements : undefined;
      const executable = Boolean(requirements && "next" in choice);
      const available = executable && !choiceContent.readOnly && !state.readOnly && options.projection
        ? evaluateSceneRequirements(requirements ?? [], options.projection.worldState, options.projection.flags).ok
        : executable && !choiceContent.readOnly && !state.readOnly;
      return {
        id: choice.id,
        label: choice.label,
        disabled:
          !available ||
          options.interactionDisabled === true ||
          state.status === "submitting" ||
          state.status === "feedback" ||
          state.status === "completed",
      };
    });
  }, [activeBlock, options.interactionDisabled, options.projection, state.readOnly, state.status]);

  const commitState = useCallback((next: SceneRuntimeState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const dispatch = useCallback((action: Parameters<typeof transitionSceneRuntime>[2]) => {
    const next = transitionSceneRuntime(options.scenePackage, stateRef.current, action);
    commitState(next);
    return next;
  }, [commitState, options.scenePackage]);

  const emitBoundary = useCallback((next: SceneRuntimeState, source: SceneAdvanceSource) => {
    if (next.status !== "completed" || next.readOnly || options.readOnly || !onBoundaryRef.current) return;
    const marker = `${runtimeMarker(next)}:${JSON.stringify(next.completion ?? null)}`;
    if (lastBoundaryMarker.current === marker) return;
    lastBoundaryMarker.current = marker;
    Promise.resolve(onBoundaryRef.current({ completedRuntime: next, source })).catch(() => {
      // Boundary handlers own their visible error state; stale/unmounted handlers are ignored.
    });
  }, [options.readOnly]);

  const emitBlockRead = useCallback((current: SceneRuntimeState, block: RuntimeBlock, source: SceneAdvanceSource, choiceId?: DialogueChoiceId, selectedChoiceLabel?: string) => {
    if (current.readOnly || options.readOnly || !onBlockReadRef.current) return;
    onBlockReadRef.current({ block, state: current, source, choiceId, selectedChoiceLabel });
  }, [options.readOnly]);

  const advance = useCallback((source: SceneAdvanceSource = "button") => {
    if (options.interactionDisabled || options.readOnly) return;
    const current = stateRef.current;
    if (current.readOnly || current.status !== "reading" || !isVisible()) return;
    const marker = runtimeMarker(current);
    if (lastAdvanceMarker.current === marker) return;
    const block = getActiveBlock(options.scenePackage, current);
    if (!block) return;
    const next = transitionSceneRuntime(options.scenePackage, current, source === "auto" ? { type: "AUTO_TICK" } : { type: "NEXT" });
    if (next === current || (next.sceneId === current.sceneId && next.blockId === current.blockId && next.status === current.status)) return;
    lastAdvanceMarker.current = marker;
    commitState(next);
    emitBlockRead(current, block, source);
    emitBoundary(next, source);
  }, [commitState, emitBlockRead, emitBoundary, options.interactionDisabled, options.readOnly, options.scenePackage]);

  const next = useCallback((source: SceneAdvanceSource = "button") => advance(source), [advance]);
  const autoTick = useCallback(() => advance("auto"), [advance]);
  const skip = useCallback(() => {
    if (options.interactionDisabled || options.readOnly) return;
    const current = stateRef.current;
    if (current.status !== "reading" || !isVisible()) return;
    const nextState = transitionSceneRuntime(options.scenePackage, current, { type: "SKIP" });
    if (nextState === current || (nextState.sceneId === current.sceneId && nextState.blockId === current.blockId && nextState.status === current.status)) return;
    lastAdvanceMarker.current = runtimeMarker(current);
    const block = getActiveBlock(options.scenePackage, current);
    commitState(nextState);
    if (block) emitBlockRead(current, block, "button");
    emitBoundary(nextState, "button");
  }, [commitState, emitBlockRead, emitBoundary, options.interactionDisabled, options.readOnly, options.scenePackage]);
  const acknowledgeFeedback = useCallback(() => {
    if (options.interactionDisabled || options.readOnly) return;
    lastAdvanceMarker.current = null;
    const next = dispatch({ type: "ACK_FEEDBACK" });
    emitBoundary(next, "button");
  }, [dispatch, emitBoundary, options.interactionDisabled, options.readOnly]);
  const resume = useCallback(() => {
    if (options.interactionDisabled || options.readOnly) return;
    lastAdvanceMarker.current = null;
    dispatch({ type: "RESUME" });
  }, [dispatch, options.interactionDisabled, options.readOnly]);
  const toggleAuto = useCallback(() => {
    if (options.interactionDisabled || options.readOnly || stateRef.current.status === "completed") return;
    if (stateRef.current.playbackMode === "auto" && options.autoPaused) {
      onPlaybackModeChangeRef.current?.("auto");
      return;
    }
    const playbackMode = stateRef.current.playbackMode === "auto" ? "manual" : "auto";
    const nextState = dispatch({ type: "SET_PLAYBACK_MODE", playbackMode });
    if (nextState.playbackMode === playbackMode) onPlaybackModeChangeRef.current?.(playbackMode);
  }, [dispatch, options.interactionDisabled, options.readOnly]);

  const select = useCallback(async (choiceId: DialogueChoiceId) => {
    const current = stateRef.current;
    if (options.interactionDisabled || current.readOnly || options.readOnly || current.status !== "awaiting_choice" || inFlight.current) return;
    const selected = choices.find((choice) => choice.id === choiceId);
    if (!selected || selected.disabled) return;
    const choiceBlock = getActiveBlock(options.scenePackage, current);
    const requestId = requestIdForSceneChoice();
    const issuedAt = new Date().toISOString();
    const expectedRevision = options.projection?.revision ?? 0;
    const requestGeneration = generation.current;
    inFlight.current = requestId;
    setFeedback("");
    const submitting = transitionSceneRuntime(options.scenePackage, current, {
      type: "SELECT_STARTED",
      requestId,
      choiceId,
      issuedAt,
      expectedRevision,
    });
    commitState(submitting);
    try {
      const response = await options.onSelect({ requestId, issuedAt, expectedRevision, choiceId });
      if (generation.current !== requestGeneration || inFlight.current !== requestId) return;
      inFlight.current = null;
      const selectedChoiceLabel = choiceBlock?.content.type === "choice"
        ? choiceBlock.content.choices.find((item) => item.id === choiceId)?.label
        : undefined;
      if (choiceBlock) emitBlockRead(current, choiceBlock, "button", choiceId, selectedChoiceLabel);
      const presented = transitionSceneRuntime(options.scenePackage, submitting, {
        type: "SELECT_SUCCEEDED",
        flowPolicy: options.flowPolicy,
        record: response.record,
      });
      lastAdvanceMarker.current = null;
      commitState(presented);
      setFeedback(options.flowPolicy === "seamless" ? "" : response.feedback);
      emitBoundary(presented, "button");
    } catch (error) {
      if (generation.current !== requestGeneration || inFlight.current !== requestId) return;
      inFlight.current = null;
      const failed = transitionSceneRuntime(options.scenePackage, stateRef.current, {
        type: "SELECT_FAILED",
        errorCode: error instanceof Error ? error.message : "SCENE_CHOICE_FAILED",
      });
      commitState(failed);
    }
  }, [choices, commitState, emitBlockRead, emitBoundary, options.flowPolicy, options.interactionDisabled, options.onSelect, options.projection?.revision, options.readOnly, options.scenePackage]);

  const retrySave = useCallback(async () => {
    const current = stateRef.current;
    const pending = current.pendingAction;
    if (
      options.interactionDisabled ||
      options.readOnly ||
      current.readOnly ||
      current.status !== "error" ||
      !pending ||
      !onRetrySaveRef.current ||
      inFlight.current
    ) return;
    const requestGeneration = generation.current;
    inFlight.current = pending.requestId;
    const submitting = transitionSceneRuntime(options.scenePackage, current, {
      type: "SELECT_STARTED",
      requestId: pending.requestId,
      choiceId: pending.choiceId,
      issuedAt: pending.issuedAt,
      expectedRevision: pending.expectedRevision,
    });
    commitState(submitting);
    try {
      const response = await onRetrySaveRef.current({
        requestId: pending.requestId,
        issuedAt: pending.issuedAt,
        expectedRevision: pending.expectedRevision,
        choiceId: pending.choiceId,
      });
      if (generation.current !== requestGeneration || inFlight.current !== pending.requestId) return;
      inFlight.current = null;
      const choiceBlock = getActiveBlock(options.scenePackage, current);
      const selectedChoiceLabel = choiceBlock?.content.type === "choice"
        ? choiceBlock.content.choices.find((item) => item.id === pending.choiceId)?.label
        : undefined;
      if (choiceBlock) emitBlockRead(current, choiceBlock, "button", pending.choiceId, selectedChoiceLabel);
      const presented = transitionSceneRuntime(options.scenePackage, submitting, {
        type: "SELECT_SUCCEEDED",
        flowPolicy: options.flowPolicy,
        record: response.record,
      });
      lastAdvanceMarker.current = null;
      commitState(presented);
      setFeedback(options.flowPolicy === "seamless" ? "" : response.feedback);
      emitBoundary(presented, "button");
    } catch (error) {
      if (generation.current !== requestGeneration || inFlight.current !== pending.requestId) return;
      inFlight.current = null;
      commitState(transitionSceneRuntime(options.scenePackage, stateRef.current, {
        type: "SELECT_FAILED",
        errorCode: error instanceof Error ? error.message : "SCENE_SAVE_FAILED",
      }));
    }
  }, [commitState, emitBlockRead, emitBoundary, options.flowPolicy, options.interactionDisabled, options.readOnly, options.scenePackage]);

  useEffect(() => {
    if (!canAutoAdvance({
      visibility: isVisible() ? "visible" : "hidden",
      status: state.status,
      readOnly: state.readOnly || options.readOnly,
      modalOpen: options.autoPaused,
      observationWindow: options.observationWindow,
      error: state.status === "error",
    }) || state.playbackMode !== "auto" || options.interactionDisabled) return;
    let timer: number | undefined;
    const clearTimer = () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
    };
    const schedule = () => {
      clearTimer();
      if (!isVisible() || stateRef.current.status !== "reading") return;
      const block = getActiveBlock(options.scenePackage, stateRef.current);
      if (!block || block.content.type === "choice") return;
      timer = window.setTimeout(autoTick, autoDelayMs(block.content.text, options.autoSpeed));
    };
    const onVisibility = () => {
      clearTimer();
      if (isVisible()) schedule();
    };
    document.addEventListener("visibilitychange", onVisibility);
    schedule();
    return () => {
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [autoTick, options.autoPaused, options.autoSpeed, options.interactionDisabled, options.observationWindow, options.readOnly, options.scenePackage, state.blockId, state.playbackMode, state.readOnly, state.status]);

  useEffect(() => {
    if (state.status === "reading" || state.status === "awaiting_choice" || state.status === "completed") {
      onPersistPositionRef.current?.(state);
    }
  }, [state]);

  return {
    state,
    activeScene,
    activeBlock,
    choices,
    next,
    autoTick,
    skip,
    select,
    retrySave,
    acknowledgeFeedback,
    resume,
    toggleAuto,
    feedback,
    inFlight: Boolean(inFlight.current),
  };
}

export { createSceneRuntime };
