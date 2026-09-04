"use client";

import type { ReactNode } from "react";
import type { DialogueChoiceId } from "@/lib/domain/dialogue";
import { ChoicePanel, type ChoicePanelOption } from "./ChoicePanel";

export type DialogueOption = ChoicePanelOption;

// 对白框：说话人 + 正文 + 选项（可选）+ 右下角继续
export function DialogueBox({
  speaker,
  copy,
  options,
  selectedOptionId,
  feedback,
  onSelect,
  onContinue,
  continueLabel = "继续剧情",
  continueDisabled,
  children,
}: {
  speaker?: string;
  copy: string;
  options?: DialogueOption[];
  selectedOptionId?: string | null;
  feedback?: string;
  onSelect?: (id: "A" | "B" | "C") => void;
  onContinue?: () => void;
  continueLabel?: string;
  continueDisabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="life-vn-dialogue">
      {speaker && <span className="life-vn-speaker">{speaker}</span>}
      <p className="life-vn-copy">{copy}</p>
      {options && options.length > 0 && (
        <ChoicePanel
          options={options}
          selectedOptionId={selectedOptionId}
          onSelect={(id: DialogueChoiceId) => onSelect?.(id)}
        />
      )}
      {children}
      <div className="life-vn-dialogue-foot">
        <span className="life-vn-feedback" aria-live="polite">
          {feedback ?? ""}
        </span>
        {onContinue && (
          <button
            type="button"
            className="life-vn-continue"
            onClick={onContinue}
            disabled={continueDisabled}
          >
            {continueLabel}
          </button>
        )}
      </div>
    </div>
  );
}
