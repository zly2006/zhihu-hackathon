import { NextResponse } from "next/server";
import type { ChapterChoice } from "@/lib/domain/chapter";
import type { ChapterSpan } from "@/lib/domain/shared";
import type { WorldState } from "@/lib/domain/world";
import {
  runChapterSimulation,
  type ChapterSimulationInput,
} from "@/lib/game/chapter-simulation-service";
import { ExecutionBudget } from "@/lib/game/execution-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseInput(value: unknown): ChapterSimulationInput {
  if (!isRecord(value)) throw new Error("请求正文不是对象");
  if (!isRecord(value.worldState) || !isRecord(value.choice) || !isRecord(value.selection)) {
    throw new Error("请求缺少 worldState、choice 或 selection");
  }
  if (value.span !== 1 && value.span !== 3) throw new Error("span 必须是 1 或 3");
  return {
    worldState: value.worldState as unknown as WorldState,
    choice: value.choice as unknown as ChapterChoice,
    selection: value.selection as ChapterSimulationInput["selection"],
    span: value.span as ChapterSpan,
    usedExperienceIds: Array.isArray(value.usedExperienceIds)
      ? value.usedExperienceIds.filter((item): item is string => typeof item === "string")
      : [],
    sceneActionContext: value.sceneActionContext,
    ...(typeof value.executionId === "string" && value.executionId.trim() ? { executionId: value.executionId.trim() } : {}),
    ...(typeof value.branchId === "string" && value.branchId.trim() ? { branchId: value.branchId.trim() } : {}),
  };
}

function eventLine(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  let input: ChapterSimulationInput;
  try {
    input = parseInput(await request.json());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "请求正文不是有效 JSON" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const executionId = input.executionId ?? `execution-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
  const executionInput: ChapterSimulationInput = { ...input, executionId };
  const budget = new ExecutionBudget({
    executionId,
    timeoutMs: 180_000,
    maxRequests: 2,
    phaseLimits: { annual: 2 },
    phaseTimeoutsMs: { annual: 180_000 },
    signal: request.signal,
  });
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed || budget.signal.aborted) return;
        try { controller.enqueue(encoder.encode(eventLine(event, data))); }
        catch { closed = true; budget.abort("stream-closed"); }
      };
      void runChapterSimulation(executionInput, {
        budget,
        signal: request.signal,
        onProgress: (progress) => send("progress", progress),
      })
        .then((result) => send("complete", result))
        .catch((error) => {
          console.error("world simulation failed", error);
          send("error", { message: error instanceof Error ? error.message : "世界推演失败，请重试" });
        })
        .finally(() => {
          closed = true;
          budget.dispose();
          try { controller.close(); } catch { /* stream already closed */ }
        });
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
