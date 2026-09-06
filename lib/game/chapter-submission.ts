export type ChapterSelectionInput = {
  optionId: "A" | "B" | "C" | "CUSTOM";
  customAction?: string;
};

export type ChapterSubmissionPhase =
  | "idle"
  | "submitting"
  | "committed"
  | "failed_before_commit"
  | "presentation_failed";

export type ChapterSubmissionState = {
  phase: ChapterSubmissionPhase;
  requestId?: string;
  decisionId?: string;
  selection?: ChapterSelectionInput;
  chapterId?: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
};

export const idleChapterSubmission: ChapterSubmissionState = { phase: "idle" };

export function beginChapterSubmission(input: {
  requestId: string;
  decisionId: string;
  selection: ChapterSelectionInput;
  startedAt: string;
}): ChapterSubmissionState {
  return { phase: "submitting", ...input };
}

export function commitChapterSubmission(
  state: ChapterSubmissionState,
  input: { chapterId: string; finishedAt: string },
): ChapterSubmissionState {
  if (state.phase !== "submitting") return state;
  return { ...state, phase: "committed", ...input, error: undefined };
}

export function failChapterSubmission(
  state: ChapterSubmissionState,
  input: { message: string; finishedAt: string },
): ChapterSubmissionState {
  if (state.phase !== "submitting" && state.phase !== "committed") return state;
  return {
    ...state,
    phase: state.phase === "committed" ? "presentation_failed" : "failed_before_commit",
    error: input.message,
    finishedAt: input.finishedAt,
  };
}

export function retryChapterSubmission(state: ChapterSubmissionState, startedAt: string): ChapterSubmissionState {
  if (state.phase !== "failed_before_commit" || !state.requestId || !state.decisionId || !state.selection) return state;
  return {
    ...state,
    phase: "submitting",
    startedAt,
    finishedAt: undefined,
    error: undefined,
  };
}

export function canRechooseChapterSubmission(state: ChapterSubmissionState): boolean {
  return state.phase === "failed_before_commit";
}

export function canResumeCommittedChapter(state: ChapterSubmissionState): boolean {
  return state.phase === "presentation_failed" && Boolean(state.chapterId);
}

function elapsedMilliseconds(startedAt?: string, finishedAt?: string): number | undefined {
  if (!startedAt || !finishedAt) return undefined;
  const elapsed = Date.parse(finishedAt) - Date.parse(startedAt);
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : undefined;
}

export function toChapterSubmissionDiagnostic(state: ChapterSubmissionState): {
  requestId?: string;
  decisionId?: string;
  chapterId?: string;
  phase: ChapterSubmissionPhase;
  durationMs?: number;
  terminal: "complete" | "error" | null;
  recovery: "retry_same_request" | "rechoose" | "resume_committed" | null;
} {
  const failedBeforeCommit = state.phase === "failed_before_commit";
  const presentationFailed = state.phase === "presentation_failed";
  return {
    requestId: state.requestId,
    decisionId: state.decisionId,
    chapterId: state.chapterId,
    phase: state.phase,
    ...(elapsedMilliseconds(state.startedAt, state.finishedAt) !== undefined
      ? { durationMs: elapsedMilliseconds(state.startedAt, state.finishedAt) }
      : {}),
    terminal: state.phase === "committed" ? "complete" : failedBeforeCommit || presentationFailed ? "error" : null,
    recovery: failedBeforeCommit ? "retry_same_request" : presentationFailed ? "resume_committed" : null,
  };
}
