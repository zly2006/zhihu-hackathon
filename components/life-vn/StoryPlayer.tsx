"use client";

import type { CSSProperties, MouseEvent, ReactNode } from "react";
import type { DialogueCharacter } from "@/lib/domain/dialogue";
import type { SceneDef } from "@/lib/game/scene-catalog";
import { SceneRuntimePlayer, type SceneRuntimePlayerProps } from "./SceneRuntimePlayer";
import { DialogueBox, type DialogueOption } from "./DialogueBox";
import { SceneStage } from "./SceneStage";
import { useStoryInput } from "./use-story-input";

export type StoryDecisionPlayerProps = {
  decision: {
    scene: SceneDef;
    meta: string;
    characters: DialogueCharacter[];
    activeCharacterId?: string | null;
    copy: string;
    options: DialogueOption[];
    selectedOptionId?: string | null;
  };
  disabled?: boolean;
  feedback?: string;
  children?: ReactNode;
  onSelect: (choiceId: "A" | "B" | "C") => void;
  onStageClick?: (event: MouseEvent<HTMLDivElement>) => void;
  style?: CSSProperties;
};

export type StoryPlayerProps = SceneRuntimePlayerProps | StoryDecisionPlayerProps;

function isDecisionPlayer(props: StoryPlayerProps): props is StoryDecisionPlayerProps {
  return "decision" in props;
}

function DecisionStoryPlayer(props: StoryDecisionPlayerProps) {
  const { decision, disabled = false, feedback, children, onSelect, onStageClick, style } = props;
  useStoryInput({
    onChoice: onSelect,
    enabled: !disabled,
  });
  return (
    <SceneStage
      scene={decision.scene}
      meta={decision.meta}
      characters={decision.characters}
      activeCharacterId={decision.activeCharacterId}
      onClick={onStageClick}
    >
      <DialogueBox
        variant="macro"
        copy={decision.copy}
        options={disabled ? undefined : decision.options}
        selectedOptionId={decision.selectedOptionId}
        feedback={feedback}
        onSelect={onSelect}
        choiceDisabled={disabled}
        style={style}
      >
        {children}
      </DialogueBox>
    </SceneStage>
  );
}

/**
 * The story-facing player owns both the macro decision node and the live
 * scene runtime. They share the same stage, dialogue box, choice semantics,
 * keyboard input and downstream callbacks; providers still own content and
 * canonical consequences.
 */
export function StoryPlayer(props: StoryPlayerProps) {
  return isDecisionPlayer(props)
    ? <DecisionStoryPlayer {...props} />
    : <SceneRuntimePlayer {...props} />;
}
