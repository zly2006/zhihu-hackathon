"use client";

import { useCallback, type CSSProperties, type MouseEvent } from "react";
import type { DialogueChoiceId, DialogueCharacter } from "@/lib/domain/dialogue";
import type { SceneChoiceResponse, SceneCue, ScenePackage, SceneRuntimeState, SceneSaveProjection } from "@/lib/domain/scene";
import { resolveSceneCharacterVisuals, type CharacterVisualProfile } from "@/lib/game/visual-resolver";
import { createSceneRuntime, getActiveBlock } from "@/lib/game/scene-runtime";
import { findScene, DEFAULT_SCENE_ID } from "@/lib/game/scene-catalog";
import { type SceneReadingPreferences } from "@/lib/game/scene-reading";
import { useSceneRuntime, type UseSceneRuntimeOptions } from "@/components/life/use-scene-runtime";
import { DialogueBox } from "./DialogueBox";
import { ScenePlaybackControls } from "./ScenePlaybackControls";
import { SceneStage } from "./SceneStage";
import { useStoryInput } from "./use-story-input";

export type SceneRuntimePlayerProps = {
  scenePackage: ScenePackage;
  initialState?: SceneRuntimeState;
  projection?: SceneSaveProjection;
  readOnly?: boolean;
  flowPolicy?: "confirm" | "seamless";
  readingPreferences?: SceneReadingPreferences;
  autoPaused?: boolean;
  observationWindow?: boolean;
  interactionDisabled?: boolean;
  hasPendingSave?: boolean;
  visualProfiles?: Record<string, CharacterVisualProfile | CharacterVisualProfile[]>;
  onSelect: (input: SceneRuntimeChoiceInput) => Promise<SceneChoiceResponse>;
  onRetrySave?: (input: SceneRuntimeChoiceInput) => Promise<SceneChoiceResponse>;
  onPersistPosition?: (state: SceneRuntimeState) => void;
  onBlockRead?: UseSceneRuntimeOptions["onBlockRead"];
  onBoundary?: UseSceneRuntimeOptions["onBoundary"];
  onPlaybackModeChange?: UseSceneRuntimeOptions["onPlaybackModeChange"];
};

export type SceneRuntimeChoiceInput = {
  requestId: string;
  issuedAt: string;
  expectedRevision: number;
  choiceId: DialogueChoiceId;
};

function charactersWithVisuals(
  characters: DialogueCharacter[],
  profiles: SceneRuntimePlayerProps["visualProfiles"],
  cues?: SceneCue[],
): DialogueCharacter[] {
  return resolveSceneCharacterVisuals({ characters, profiles, cues }).map((item) => item.character);
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest("button,a,input,textarea,select,[role='button'],[role='tab'],[contenteditable='true']"));
}

function readingStyle(preferences?: SceneReadingPreferences): CSSProperties {
  const fontScale = preferences?.fontScale === "small" ? "0.9" : preferences?.fontScale === "large" ? "1.12" : "1";
  const subtitleBackground = preferences?.subtitleBackground === "soft" ? "0.62" : preferences?.subtitleBackground === "strong" ? "0.94" : "0.86";
  return {
    "--lv-reading-font-scale": fontScale,
    "--lv-subtitle-bg-alpha": subtitleBackground,
  } as CSSProperties;
}

export function SceneRuntimePlayer({
  scenePackage,
  initialState,
  projection,
  readOnly = false,
  flowPolicy = "confirm",
  readingPreferences,
  autoPaused = false,
  observationWindow = false,
  interactionDisabled = false,
  hasPendingSave = false,
  visualProfiles,
  onSelect,
  onRetrySave,
  onPersistPosition,
  onBlockRead,
  onBoundary,
  onPlaybackModeChange,
}: SceneRuntimePlayerProps) {
  const initial = initialState ?? createSceneRuntime(scenePackage, { branchId: projection?.activeBranchId ?? "main", readOnly });
  const runtime = useSceneRuntime({
    scenePackage,
    initialState: initial,
    projection,
    readOnly,
    flowPolicy,
    autoSpeed: readingPreferences?.autoSpeed,
    autoPaused,
    observationWindow,
    interactionDisabled,
    onSelect,
    onRetrySave,
    onPersistPosition,
    onBlockRead,
    onBoundary,
    onPlaybackModeChange,
  });
  const scene = runtime.activeScene;
  const block = runtime.activeBlock ?? (scene ? getActiveBlock(scenePackage, runtime.state) : undefined);

  const keyboardContinue = useCallback(() => runtime.next("keyboard"), [runtime.next]);
  const keyboardChoice = useCallback((choiceId: "A" | "B" | "C") => { void runtime.select(choiceId); }, [runtime.select]);
  useStoryInput({
    onContinue: keyboardContinue,
    onChoice: keyboardChoice,
    enabled: !readOnly && !interactionDisabled,
  });

  if (!scene || !block) {
    return <div className="life-vn-error" role="alert">场景内容暂时不可用。</div>;
  }
  const sceneDef = findScene(scene.background) ?? findScene(DEFAULT_SCENE_ID);
  if (!sceneDef) return <div className="life-vn-error" role="alert">场景背景暂时不可用。</div>;
  const cues = "cues" in block ? block.cues : undefined;
  const displayCharacters = charactersWithVisuals(scene.characters, visualProfiles, cues);
  const dialogue = block.content.type === "dialogue" ? block.content : undefined;
  const copy = block.content.text;
  const options = block.content.type === "choice" ? runtime.choices : undefined;
  const activeCharacterId = dialogue?.speakerId;
  const continueAction = runtime.state.status === "feedback" ? runtime.acknowledgeFeedback : runtime.next;
  const continueDisabled = interactionDisabled || (runtime.state.status !== "reading" && runtime.state.status !== "feedback");
  const errorMessage = runtime.state.status === "error" ? `场景暂时无法继续：${runtime.state.errorCode ?? "未知错误"}` : "";
  const handleContinue = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail > 1) return;
    continueAction();
  };
  const handleStageClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.detail > 1 || isInteractiveTarget(event.target) || window.getSelection()?.toString()) return;
    runtime.next("click");
  };
  return (
    <SceneStage
      scene={sceneDef}
      meta={scene.timeLabel}
      characters={displayCharacters}
      activeCharacterId={activeCharacterId}
      cues={cues}
      cueKey={block.id}
      onClick={handleStageClick}
    >
      <DialogueBox
        variant="subtitle"
        speaker={dialogue?.speaker}
        copy={copy}
        options={options}
        selectedOptionId={runtime.state.pendingAction?.choiceId ?? null}
        feedback={runtime.feedback || errorMessage}
        onSelect={runtime.select}
        onContinue={handleContinue}
        continueDisabled={continueDisabled}
        choiceDisabled={runtime.inFlight || interactionDisabled || runtime.state.status !== "awaiting_choice"}
        choicesReadOnly={readOnly || Boolean(block.content.type === "choice" && block.content.readOnly)}
        style={readingStyle(readingPreferences)}
      >
        <ScenePlaybackControls
          playbackMode={runtime.state.playbackMode}
          status={runtime.state.status}
          readOnly={readOnly}
          autoPaused={autoPaused || observationWindow}
          onSkip={runtime.skip}
          onToggleAuto={runtime.toggleAuto}
        />
        {runtime.state.status === "error" && (
          <button
            type="button"
            className="life-vn-btn ghost"
            onClick={() => (onRetrySave && hasPendingSave && runtime.state.pendingAction ? void runtime.retrySave() : runtime.resume())}
            disabled={interactionDisabled || runtime.inFlight}
          >
            {onRetrySave && hasPendingSave && runtime.state.pendingAction ? "重试保存" : "重试当前选择"}
          </button>
        )}
        {runtime.state.status === "completed" && runtime.state.completion && (
          <div className="life-vn-flow-status" role="status">
            {runtime.state.completion.kind === "unit_end"
              ? "这一段互动已完成，正在衔接后续故事。"
              : runtime.state.completion.kind === "ending"
                ? "本章已到达结局。"
                : "本章互动已完成。"}
          </div>
        )}
        <div aria-live="polite" className="sr-only">
          {runtime.state.status === "submitting" ? "正在提交选择" : runtime.feedback || errorMessage}
        </div>
      </DialogueBox>
    </SceneStage>
  );
}
