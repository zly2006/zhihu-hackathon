"use client";

import { useEffect, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import type { DialogueChoiceId } from "@/lib/domain/dialogue";
import { ChoicePanel, type ChoicePanelOption } from "./ChoicePanel";

export type DialogueOption = ChoicePanelOption;

// subtitle 用于逐段播放；macro 仅用于章节困境和其 A/B/C 行动方向。
export function DialogueBox({
  speaker, copy, options, selectedOptionId, feedback, onSelect, onContinue, continueLabel = "继续", continueDisabled,
  choiceDisabled, choicesReadOnly = false, children, variant = "subtitle",
  style,
}: {
  speaker?: string;
  copy: string;
  options?: DialogueOption[];
  selectedOptionId?: string | null;
  feedback?: string;
  onSelect?: (id: "A" | "B" | "C") => void;
  onContinue?: (event: MouseEvent<HTMLButtonElement>) => void;
  continueLabel?: string;
  continueDisabled?: boolean;
  choiceDisabled?: boolean;
  choicesReadOnly?: boolean;
  children?: ReactNode;
  variant?: "subtitle" | "macro";
  style?: CSSProperties;
}) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = variant === "subtitle" && copy.length > 120;
  useEffect(() => setExpanded(false), [copy, variant]);

  return <div className={`life-vn-dialogue life-vn-dialogue--${variant}`} style={style}>
    {speaker && <span className="life-vn-speaker">{speaker}</span>}
    <p className={`life-vn-copy${expanded ? " expanded" : ""}`}>{copy}</p>
    {canExpand && <button type="button" className="life-vn-copy-toggle" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
      {expanded ? "收起全文" : "展开全文"}
    </button>}
    {options && options.length > 0 && <ChoicePanel options={options} selectedOptionId={selectedOptionId} disabled={choiceDisabled || choicesReadOnly} onSelect={(id: DialogueChoiceId) => onSelect?.(id)} ariaLabel={variant === "macro" ? "本章行动方向" : "对话选择"} />}
    {children}
    <div className="life-vn-dialogue-foot">
      <span className="life-vn-feedback" aria-live="polite">{feedback ?? ""}</span>
      {onContinue && <button type="button" className="life-vn-continue" onClick={onContinue} disabled={continueDisabled}>{continueLabel}</button>}
    </div>
  </div>;
}
