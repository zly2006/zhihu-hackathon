"use client";

import { useEffect } from "react";

type StoryChoiceId = "A" | "B" | "C";

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest("button,a,input,textarea,select,[role='button'],[role='tab'],[contenteditable='true']"));
}

/** Shared keyboard contract for the macro decision and live scene player. */
export function useStoryInput(options: {
  onContinue?: () => void;
  onChoice?: (choiceId: StoryChoiceId) => void;
  enabled?: boolean;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!options.enabled || event.defaultPrevented || event.repeat || event.isComposing || document.visibilityState !== "visible") return;
      if (isInteractiveTarget(event.target)) return;
      if (event.key === " " || event.key === "Enter") {
        if (!options.onContinue) return;
        event.preventDefault();
        options.onContinue();
        return;
      }
      const key = event.key.toUpperCase();
      if ((key === "A" || key === "B" || key === "C") && options.onChoice) {
        event.preventDefault();
        options.onChoice(key);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [options.enabled, options.onChoice, options.onContinue]);
}
