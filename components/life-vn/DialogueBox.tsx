"use client";

import type { ReactNode } from "react";

export type DialogueOption = {
  id: "A" | "B" | "C";
  label: string;
  description?: string;
  disabled?: boolean;
};

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
        <div className="life-vn-choices" aria-label="对话选择">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              className="life-vn-choice"
              aria-pressed={selectedOptionId === option.id}
              disabled={option.disabled}
              onClick={() => onSelect?.(option.id)}
            >
              <span className="life-vn-choice-key">{option.id}</span>
              <span>{option.label}</span>
            </button>
          ))}
        </div>
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
