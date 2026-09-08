import type {
  StoryIdentity,
  StoryJournal,
  StorySessionState,
  StoryTrace,
  StoryUnit,
} from "../domain/story";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nowMs(value: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("故事时间戳无效");
  return timestamp;
}

function assertAction(state: StorySessionState): StoryJournal {
  if (!state.journal) throw new Error("当前没有可恢复的故事行动");
  return state.journal;
}

export function createStorySession(input: { identity: StoryIdentity; now?: string }): StorySessionState {
  return {
    schemaVersion: 1,
    identity: clone(input.identity),
    status: "idle",
    canonicalRevision: 0,
    publishedUnitIds: [],
    trace: {
      transportAttempts: 0,
      validationAttempts: 0,
      artifactReuse: false,
      discardedTokens: 0,
    },
  };
}

export function beginStoryAction(
  state: StorySessionState,
  input: {
    requestId: string;
    actionKind: StoryJournal["actionKind"];
    inputFingerprint: string;
    expectedRevision: number;
    now: string;
  },
): StorySessionState {
  const sameJournal = state.journal
    && state.journal.requestId === input.requestId
    && state.journal.inputFingerprint === input.inputFingerprint
    && state.journal.expectedRevision === input.expectedRevision;
  if (sameJournal && state.journal && ["canonical_committed", "presentation_ready"].includes(state.journal.phase)) {
    return clone(state);
  }
  if ((state.status === "submitting" || state.status === "canonical_committed" || state.status === "presenting") && !sameJournal) {
    throw new Error("已有故事行动正在进行");
  }
  if (input.expectedRevision !== state.canonicalRevision) throw new Error("故事存档版本已经变化");
  const receivedAt = nowMs(input.now);
  const journal: StoryJournal = {
    actionKind: input.actionKind,
    requestId: input.requestId,
    inputFingerprint: input.inputFingerprint,
    expectedRevision: input.expectedRevision,
    phase: "submitted",
    acceptedAt: input.now,
  };
  return {
    ...clone(state),
    status: "submitting",
    journal,
    trace: { ...state.trace, requestId: input.requestId, actionReceived: receivedAt },
    lastError: undefined,
  };
}

export function commitCanonical(
  state: StorySessionState,
  input: { requestId: string; receiptId: string; canonicalRevision: number; now: string },
): StorySessionState {
  const journal = assertAction(state);
  if (journal.requestId !== input.requestId) throw new Error("故事 requestId 不匹配");
  if (journal.phase === "canonical_committed" || journal.phase === "presentation_ready") return clone(state);
  if (input.canonicalRevision !== state.canonicalRevision + 1) throw new Error("canonical revision 必须只推进一次");
  const canonicalReady = nowMs(input.now);
  return {
    ...clone(state),
    status: "canonical_committed",
    canonicalRevision: input.canonicalRevision,
    journal: { ...journal, phase: "canonical_committed", canonicalReceiptId: input.receiptId, canonicalRevision: input.canonicalRevision },
    trace: {
      ...state.trace,
      canonicalReady,
      canonicalMs: state.trace.actionReceived === undefined ? undefined : Math.max(0, canonicalReady - state.trace.actionReceived),
    },
  };
}

export function markStoryPresentationReady(state: StorySessionState, unitId: string, at: string): StorySessionState {
  const journal = assertAction(state);
  if (journal.phase !== "canonical_committed" && journal.phase !== "presentation_ready") {
    throw new Error("canonical 结果未提交，不能发布故事内容");
  }
  const readyAt = nowMs(at);
  return {
    ...clone(state),
    status: "presenting",
    activeUnitId: unitId,
    journal: { ...journal, phase: "presentation_ready", unitId },
    trace: {
      ...state.trace,
      unitReady: readyAt,
      writerMs: state.trace.canonicalReady === undefined ? undefined : Math.max(0, readyAt - state.trace.canonicalReady),
    },
  };
}

export function publishStoryUnit(state: StorySessionState, unit: StoryUnit, at: string): StorySessionState {
  const journal = assertAction(state);
  const readyAt = nowMs(at);
  if (state.publishedUnitIds.includes(unit.id)) {
    if (journal.phase !== "canonical_committed" && journal.phase !== "presentation_ready") return clone(state);
    return markStoryPresentationReady(state, unit.id, at);
  }
  if (journal.phase !== "canonical_committed" && journal.phase !== "presentation_ready") throw new Error("canonical 结果未提交，不能发布故事内容");
  return {
    ...clone(state),
    status: "presenting",
    activeUnitId: unit.id,
    journal: { ...journal, phase: "presentation_ready", unitId: unit.id },
    publishedUnitIds: [...state.publishedUnitIds, unit.id],
    trace: {
      ...state.trace,
      unitReady: readyAt,
      writerMs: state.trace.canonicalReady === undefined ? undefined : Math.max(0, readyAt - state.trace.canonicalReady),
    },
  };
}

export function markStoryDisplayed(state: StorySessionState, unitId: string, at: string): StorySessionState {
  if (!state.publishedUnitIds.includes(unitId)) throw new Error("未发布的故事单元不能标记展示");
  const displayedAt = nowMs(at);
  return { ...clone(state), trace: { ...state.trace, displayed: true, displayedAt } };
}

export function reachStoryBoundary(state: StorySessionState, at: string): StorySessionState {
  const boundaryReached = nowMs(at);
  const waitStart = state.trace.unitReady ?? state.trace.canonicalReady;
  return {
    ...clone(state),
    status: "awaiting_input",
    trace: {
      ...state.trace,
      boundaryReached,
      boundaryWaitMs: waitStart === undefined ? undefined : Math.max(0, boundaryReached - waitStart),
    },
  };
}

export function failStorySession(state: StorySessionState, error: { code: string; message: string }): StorySessionState {
  return {
    ...clone(state),
    status: "error",
    lastError: { ...error },
    journal: state.journal ? { ...state.journal, phase: "failed", error: { ...error } } : undefined,
  };
}
