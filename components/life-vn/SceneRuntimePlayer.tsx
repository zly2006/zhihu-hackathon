"use client";

import type { DialogueChoiceId, DialogueCharacter } from "@/lib/domain/dialogue";
import type { SceneChoiceResponse, SceneCue, ScenePackage, SceneRuntimeState, SceneSaveProjection } from "@/lib/domain/scene";
import { resolveSceneCharacterVisuals, type CharacterVisualProfile } from "@/lib/game/visual-resolver";
import { createSceneRuntime, getActiveBlock } from "@/lib/game/scene-runtime";
import { findScene, DEFAULT_SCENE_ID } from "@/lib/game/scene-catalog";
import { useSceneRuntime } from "@/components/life/use-scene-runtime";
import { DialogueBox } from "./DialogueBox";
import { ScenePlaybackControls } from "./ScenePlaybackControls";
import { SceneStage } from "./SceneStage";

export type SceneRuntimePlayerProps = {
  scenePackage: ScenePackage;
  initialState?: SceneRuntimeState;
  projection?: SceneSaveProjection;
  readOnly?: boolean;
  visualProfiles?: Record<string, CharacterVisualProfile | CharacterVisualProfile[]>;
  onSelect: (input: {
    requestId: string;
    issuedAt: string;
    expectedRevision: number;
    choiceId: DialogueChoiceId;
  }) => Promise<SceneChoiceResponse>;
  onPersistPosition?: (state: SceneRuntimeState) => void;
};

function charactersWithVisuals(
  characters: DialogueCharacter[],
  profiles: SceneRuntimePlayerProps["visualProfiles"],
  cues?: SceneCue[],
): DialogueCharacter[] {
  return resolveSceneCharacterVisuals({ characters, profiles, cues }).map((item) => item.character);
}

export function SceneRuntimePlayer({
  scenePackage,
  initialState,
  projection,
  readOnly = false,
  visualProfiles,
  onSelect,
  onPersistPosition,
}: SceneRuntimePlayerProps) {
  const initial = initialState ?? createSceneRuntime(scenePackage, { branchId: projection?.activeBranchId ?? "main", readOnly });
  const runtime = useSceneRuntime({
    scenePackage,
    initialState: initial,
    projection,
    readOnly,
    onSelect,
    onPersistPosition,
  });
  const scene = runtime.activeScene;
  const block = runtime.activeBlock ?? (scene ? getActiveBlock(scenePackage, runtime.state) : undefined);
  if (!scene || !block) {
    return <div className="life-vn-error" role="alert">场景内容暂时不可用。</div>;
  }
  const sceneDef = findScene(scene.background) ?? findScene(DEFAULT_SCENE_ID);
  if (!sceneDef) return <div className="life-vn-error" role="alert">场景背景暂时不可用。</div>;
  const cues = "cues" in block ? block.cues : undefined;
  const displayCharacters = charactersWithVisuals(scene.characters, visualProfiles, cues);
  const dialogue = block.content.type === "dialogue" ? block.content : undefined;
  const copy = block.content.type === "choice" ? block.content.text : block.content.text;
  const options = block.content.type === "choice" ? runtime.choices : undefined;
  const activeCharacterId = dialogue?.speakerId;
  const continueAction = runtime.state.status === "feedback" ? runtime.acknowledgeFeedback : runtime.next;
  const continueDisabled = runtime.state.status !== "reading" && runtime.state.status !== "feedback";
  const errorMessage = runtime.state.status === "error" ? `场景暂时无法继续：${runtime.state.errorCode ?? "未知错误"}` : "";
  return (
    <SceneStage
      scene={sceneDef}
      meta={scene.timeLabel}
      characters={displayCharacters}
      activeCharacterId={activeCharacterId}
      cues={cues}
      cueKey={block.id}
    >
      <DialogueBox
        speaker={dialogue?.speaker}
        copy={copy}
        options={options}
        selectedOptionId={runtime.state.pendingAction?.choiceId ?? null}
        feedback={runtime.feedback || errorMessage}
        onSelect={runtime.select}
        onContinue={continueAction}
        continueDisabled={continueDisabled}
        choiceDisabled={runtime.inFlight || runtime.state.status !== "awaiting_choice"}
        choicesReadOnly={readOnly || Boolean(block.content.type === "choice" && block.content.readOnly)}
      >
        <ScenePlaybackControls
          playbackMode={runtime.state.playbackMode}
          status={runtime.state.status}
          readOnly={readOnly}
          onNext={runtime.next}
          onSkip={runtime.skip}
          onToggleAuto={runtime.toggleAuto}
        />
        {runtime.state.status === "error" && (
          <button type="button" className="life-vn-btn ghost" onClick={runtime.resume}>
            重试当前选择
          </button>
        )}
        <div aria-live="polite" className="sr-only">
          {runtime.state.status === "submitting" ? "正在提交选择" : runtime.feedback || errorMessage}
        </div>
      </DialogueBox>
    </SceneStage>
  );
}
