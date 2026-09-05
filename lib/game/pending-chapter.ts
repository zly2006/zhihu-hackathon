import type { ChapterChoice, ChapterDecision, PendingChapter } from "../domain/chapter";
import type { EvidenceBundle, LifeExperience } from "../domain/experience";
import type { ChapterSpan } from "../domain/shared";
import type { GameSave } from "../domain/chapter";

function isPending(value: Partial<PendingChapter>): value is PendingChapter & { selection: ChapterDecision } {
  return Boolean(
    value.selection &&
      typeof value.selection.id === "string" &&
      typeof value.selection.promptTitle === "string" &&
      typeof value.selection.context === "string" &&
      Array.isArray(value.selection.options),
  );
}

export function recoverChapterChoice(value: Partial<PendingChapter>): ChapterChoice | null {
  if (!isPending(value)) return null;
  return {
    id: value.selection.id,
    promptTitle: value.selection.promptTitle,
    context: value.selection.context,
    options: value.selection.options,
  };
}

export function recoverSelection(
  value: Partial<PendingChapter>,
): { optionId: ChapterDecision["selectedOptionId"]; customAction?: string } | null {
  if (!isPending(value)) return null;
  const selectedOptionId = value.selection.selectedOptionId;
  if (selectedOptionId !== "A" && selectedOptionId !== "B" && selectedOptionId !== "C" && selectedOptionId !== "CUSTOM") return null;
  return {
    optionId: selectedOptionId,
    ...(value.selection.customAction ? { customAction: value.selection.customAction } : {}),
  };
}

export function pendingSpan(value: Pick<PendingChapter, "startYear" | "endYear">): ChapterSpan {
  return value.endYear - value.startYear === 3 ? 3 : 1;
}

export function recoverEvidenceBundle(
  save: Pick<GameSave, "experienceCache">,
  value: Pick<PendingChapter, "evidenceIds">,
): EvidenceBundle {
  const experiences = value.evidenceIds
    .map((id) => save.experienceCache[id])
    .filter((item): item is LifeExperience => Boolean(item));
  return {
    querySummary: "恢复中的已保存现实经历",
    total: experiences.length,
    backgroundSimilar: experiences,
    decisionSimilar: [],
    relationshipRelevant: [],
    outcomeContrasts: [],
    balance: { positive: 0, negative: 0, mixed: 0, unknown: experiences.length },
  };
}
