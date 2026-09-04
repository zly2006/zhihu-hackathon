"use client";

import type { KeyboardEvent } from "react";
import type { DialogueChoiceId } from "@/lib/domain/dialogue";

export type ChoicePanelOption = {
  id: DialogueChoiceId;
  label: string;
  description?: string;
  disabled?: boolean;
};

function activateWithKeyboard(
  event: KeyboardEvent<HTMLButtonElement>,
  option: ChoicePanelOption,
  disabled: boolean,
  onSelect?: (id: DialogueChoiceId) => void,
) {
  // Enter is handled by the native button activation; Space needs an explicit
  // handler so keyboard activation follows the same controlled path.
  if (event.key !== " ") return;
  event.preventDefault();
  if (disabled || option.disabled) return;
  onSelect?.(option.id);
}

// 受控选择面板只发出选项 id，不承担模拟、存档或网络请求。
export function ChoicePanel({
  options,
  selectedOptionId,
  onSelect,
  disabled = false,
  ariaLabel = "对话选择",
}: {
  options: ChoicePanelOption[];
  selectedOptionId?: string | null;
  onSelect?: (id: DialogueChoiceId) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  if (options.length === 0) return null;
  return (
    <div className="life-vn-choices" role="group" aria-label={ariaLabel}>
      {options.map((option) => {
        const optionDisabled = disabled || Boolean(option.disabled);
        return (
          <button
            key={option.id}
            type="button"
            className="life-vn-choice"
            aria-pressed={selectedOptionId === option.id}
            disabled={optionDisabled}
            onClick={() => {
              if (!optionDisabled) onSelect?.(option.id);
            }}
            onKeyDown={(event) => activateWithKeyboard(event, option, optionDisabled, onSelect)}
          >
            <span className="life-vn-choice-key">{option.id}</span>
            <span className="life-vn-choice-copy">
              <b>{option.label}</b>
              {option.description && <small>{option.description}</small>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
