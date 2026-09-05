"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DialogueChoiceId,
} from "@/lib/domain/dialogue";
import type {
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
} from "@/lib/game/scene-runtime";

export type UseSceneRuntimeOptions = {
  scenePackage: ScenePackage;
  initialState: SceneRuntimeState;
  projection?: SceneSaveProjection;
  readOnly?: boolean;
  onSelect: (input: {
    requestId: string;
    issuedAt: string;
    expectedRevision: number;
    choiceId: DialogueChoiceId;
  }) => Promise<SceneChoiceResponse>;
  onPersistPosition?: (state: SceneRuntimeState) => void;
};

export function useSceneRuntime(options: UseSceneRuntimeOptions) {
  const [state, setState] = useState<SceneRuntimeState>(() =>
    options.readOnly && !options.initialState.readOnly
      ? { ...options.initialState, readOnly: true }
      : options.initialState,
  );
  const [feedback, setFeedback] = useState("");
  const inFlight = useRef<string | null>(null);
  const generation = useRef(0);
  const sceneIdentity = `${options.scenePackage.id}:${options.scenePackage.version}:${options.initialState.branchId}`;

  useEffect(() => {
    generation.current += 1;
    inFlight.current = null;
    setState(
      options.readOnly && !options.initialState.readOnly
        ? { ...options.initialState, readOnly: true }
        : options.initialState,
    );
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
        disabled: !available || state.status === "submitting" || state.status === "feedback" || state.status === "completed",
      };
    });
  }, [activeBlock, options.projection, state.readOnly, state.status]);

  const dispatch = useCallback((action: Parameters<typeof transitionSceneRuntime>[2]) => {
    setState((previous) => transitionSceneRuntime(options.scenePackage, previous, action));
  }, [options.scenePackage]);

  const next = useCallback(() => dispatch({ type: "NEXT" }), [dispatch]);
  const autoTick = useCallback(() => dispatch({ type: "AUTO_TICK" }), [dispatch]);
  const skip = useCallback(() => dispatch({ type: "SKIP" }), [dispatch]);
  const acknowledgeFeedback = useCallback(() => dispatch({ type: "ACK_FEEDBACK" }), [dispatch]);
  const resume = useCallback(() => dispatch({ type: "RESUME" }), [dispatch]);
  const toggleAuto = useCallback(
    () => dispatch({ type: "SET_PLAYBACK_MODE", playbackMode: state.playbackMode === "auto" ? "manual" : "auto" }),
    [dispatch, state.playbackMode],
  );

  const select = useCallback(async (choiceId: DialogueChoiceId) => {
    if (state.readOnly || state.status !== "awaiting_choice" || inFlight.current) return;
    const selected = choices.find((choice) => choice.id === choiceId);
    if (!selected || selected.disabled) return;
    const requestId = globalThis.crypto?.randomUUID?.() ?? `scene-request-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const issuedAt = new Date().toISOString();
    const expectedRevision = options.projection?.revision ?? 0;
    const requestGeneration = generation.current;
    inFlight.current = requestId;
    setFeedback("");
    dispatch({ type: "SELECT_STARTED", requestId, choiceId, issuedAt, expectedRevision });
    try {
      const response = await options.onSelect({ requestId, issuedAt, expectedRevision, choiceId });
      if (generation.current !== requestGeneration || inFlight.current !== requestId) return;
      inFlight.current = null;
      setFeedback(response.feedback);
      setState((previous) => {
        if (previous.pendingAction?.requestId !== requestId) return previous;
        return transitionSceneRuntime(options.scenePackage, previous, { type: "SELECT_SUCCEEDED", record: response.record });
      });
    } catch (error) {
      if (generation.current !== requestGeneration || inFlight.current !== requestId) return;
      inFlight.current = null;
      dispatch({ type: "SELECT_FAILED", errorCode: error instanceof Error ? error.message : "SCENE_CHOICE_FAILED" });
    }
  }, [choices, dispatch, options, state.readOnly, state.status]);

  useEffect(() => {
    if (state.status !== "reading" || state.playbackMode !== "auto" || state.readOnly) return;
    let timer: number | undefined;
    const tick = () => {
      if (document.visibilityState === "visible") timer = window.setTimeout(autoTick, 900);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && timer !== undefined) window.clearTimeout(timer);
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    tick();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [autoTick, state.blockId, state.playbackMode, state.readOnly, state.status]);

  useEffect(() => {
    if (state.status === "reading" || state.status === "awaiting_choice" || state.status === "completed") {
      options.onPersistPosition?.(state);
    }
  }, [options, state]);

  return {
    state,
    activeScene,
    activeBlock,
    choices,
    next,
    autoTick,
    skip,
    select,
    acknowledgeFeedback,
    resume,
    toggleAuto,
    feedback,
    inFlight: Boolean(inFlight.current),
  };
}

export { createSceneRuntime };
