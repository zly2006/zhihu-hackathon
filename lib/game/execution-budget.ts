/**
 * A request budget is deliberately independent from transport retry policy.
 * Every invocation which could reach a model must reserve one slot before it
 * starts.  The deadline is absolute so a correction attempt cannot reset the
 * clock of the original user action.
 */

export type ExecutionBudgetOptions = {
  executionId: string;
  timeoutMs?: number;
  deadlineAt?: number;
  maxRequests: number;
  phaseLimits?: Record<string, number>;
  /** Optional wall-clock windows for phases inside the shared action deadline. */
  phaseTimeoutsMs?: Record<string, number>;
  signal?: AbortSignal;
  now?: () => number;
};

export type ExecutionRequest = {
  executionId: string;
  requestId: string;
  purpose: string;
  phase: string;
  attempt: number;
  startedAt: number;
  signal: AbortSignal;
};

export type ExecutionBudgetSnapshot = {
  executionId: string;
  deadlineAt: number;
  remainingMs: number;
  maxRequests: number;
  requestsStarted: number;
  requestsByPhase: Record<string, number>;
  aborted: boolean;
};

export class ExecutionBudgetError extends Error {
  readonly code: "DEADLINE_EXCEEDED" | "REQUEST_BUDGET_EXHAUSTED" | "CANCELLED";
  readonly retryable = false;

  constructor(
    code: ExecutionBudgetError["code"],
    message: string,
  ) {
    super(message);
    this.name = "ExecutionBudgetError";
    this.code = code;
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} 必须是正整数`);
  return value;
}

export class ExecutionBudget {
  readonly executionId: string;
  readonly deadlineAt: number;
  readonly maxRequests: number;
  readonly signal: AbortSignal;

  private readonly now: () => number;
  private readonly controller: AbortController;
  private readonly phaseLimits: Record<string, number>;
  private readonly phaseTimeoutsMs: Record<string, number>;
  private readonly phaseDeadlinesState = new Map<string, number>();
  private readonly requestsByPhaseState = new Map<string, number>();
  private requestsStartedState = 0;
  private removeParentAbort?: () => void;

  constructor(options: ExecutionBudgetOptions) {
    if (!options.executionId?.trim()) throw new Error("executionId 不能为空");
    this.executionId = options.executionId.trim();
    this.now = options.now ?? Date.now;
    this.maxRequests = positiveInteger(options.maxRequests, "maxRequests");
    const timeoutMs = options.timeoutMs ?? 180_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("timeoutMs 必须是正数");
    this.deadlineAt = options.deadlineAt ?? this.now() + timeoutMs;
    if (!Number.isFinite(this.deadlineAt)) throw new Error("deadlineAt 必须是有限时间戳");
    this.phaseLimits = Object.fromEntries(
      Object.entries(options.phaseLimits ?? {}).map(([phase, limit]) => [phase, positiveInteger(limit, `phaseLimits.${phase}`)]),
    );
    this.phaseTimeoutsMs = Object.fromEntries(
      Object.entries(options.phaseTimeoutsMs ?? {}).map(([phase, timeout]) => {
        if (!Number.isFinite(timeout) || timeout <= 0) throw new Error(`phaseTimeoutsMs.${phase} 必须是正数`);
        return [phase, timeout];
      }),
    );
    this.controller = new AbortController();
    this.signal = this.controller.signal;
    if (options.signal) {
      const abort = () => this.controller.abort(options.signal?.reason);
      if (options.signal.aborted) abort();
      else {
        options.signal.addEventListener("abort", abort, { once: true });
        this.removeParentAbort = () => options.signal?.removeEventListener("abort", abort);
      }
    }
  }

  remainingMs(): number {
    return Math.max(0, Math.floor(this.deadlineAt - this.now()));
  }

  /**
   * Return a phase's absolute deadline. The phase clock starts on its first
   * use, while it can never outlive the parent action deadline. Calling this
   * repeatedly is idempotent, which keeps retries in the same phase window.
   */
  phaseDeadlineAt(phase: string, timeoutMs?: number): number {
    const existing = this.phaseDeadlinesState.get(phase);
    if (existing !== undefined) return Math.min(existing, this.deadlineAt);
    const configuredTimeoutMs = timeoutMs ?? this.phaseTimeoutsMs[phase];
    if (configuredTimeoutMs === undefined) return this.deadlineAt;
    if (!Number.isFinite(configuredTimeoutMs) || configuredTimeoutMs <= 0) {
      throw new Error(`phaseTimeoutsMs.${phase} 必须是正数`);
    }
    const deadline = Math.min(this.deadlineAt, this.now() + configuredTimeoutMs);
    this.phaseDeadlinesState.set(phase, deadline);
    return deadline;
  }

  remainingMsFor(phase: string, timeoutMs?: number): number {
    return Math.max(0, Math.floor(this.phaseDeadlineAt(phase, timeoutMs) - this.now()));
  }

  isAborted(): boolean {
    return this.controller.signal.aborted;
  }

  abort(reason?: unknown): void {
    if (!this.controller.signal.aborted) this.controller.abort(reason);
  }

  assertCanStart(purpose: string, phase = "default"): void {
    if (this.controller.signal.aborted) {
      throw new ExecutionBudgetError("CANCELLED", `${purpose} 已取消，不能开始新的模型请求`);
    }
    if (this.remainingMs() <= 0) {
      throw new ExecutionBudgetError("DEADLINE_EXCEEDED", `${purpose} 已超过执行 deadline`);
    }
    if (this.remainingMsFor(phase) <= 0) {
      throw new ExecutionBudgetError("DEADLINE_EXCEEDED", `${phase} 阶段已超过执行 deadline`);
    }
    if (this.requestsStartedState >= this.maxRequests) {
      throw new ExecutionBudgetError("REQUEST_BUDGET_EXHAUSTED", `${purpose} 已耗尽执行请求预算`);
    }
    const phaseLimit = this.phaseLimits[phase];
    if (phaseLimit !== undefined && (this.requestsByPhaseState.get(phase) ?? 0) >= phaseLimit) {
      throw new ExecutionBudgetError("REQUEST_BUDGET_EXHAUSTED", `${phase} 阶段已耗尽执行请求预算`);
    }
  }

  reserve(purpose: string, phase = "default"): ExecutionRequest {
    this.assertCanStart(purpose, phase);
    this.requestsStartedState += 1;
    const phaseAttempt = (this.requestsByPhaseState.get(phase) ?? 0) + 1;
    this.requestsByPhaseState.set(phase, phaseAttempt);
    return {
      executionId: this.executionId,
      requestId: `${this.executionId}:request:${this.requestsStartedState}`,
      purpose,
      phase,
      attempt: phaseAttempt,
      startedAt: this.now(),
      signal: this.controller.signal,
    };
  }

  snapshot(): ExecutionBudgetSnapshot {
    return {
      executionId: this.executionId,
      deadlineAt: this.deadlineAt,
      remainingMs: this.remainingMs(),
      maxRequests: this.maxRequests,
      requestsStarted: this.requestsStartedState,
      requestsByPhase: Object.fromEntries(this.requestsByPhaseState),
      aborted: this.controller.signal.aborted,
    };
  }

  dispose(): void {
    this.removeParentAbort?.();
    this.removeParentAbort = undefined;
  }
}
