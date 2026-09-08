import { NextResponse } from "next/server";
import type { SimulationEvent } from "@/lib/domain/simulation";
import type { StoryUnit } from "@/lib/domain/story";
import type { WorldState } from "@/lib/domain/world";
import type { LiveSceneChapterContext } from "@/lib/game/live-scene-generator";
import {
  lifeStoryInputFingerprint,
} from "@/lib/game/story-generation";
import { createLifeAiProvider } from "@/lib/game/story-provider";
import { ExecutionBudget } from "@/lib/game/execution-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requestIdentity(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  return `story-prepare-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function eventLine(event: string, payload: Record<string, unknown>, seq: number): string {
  return `event: ${event}\ndata: ${JSON.stringify({ seq, ...payload })}\n\n`;
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!isRecord(parsed)) throw new Error("请求正文不是对象");
    body = parsed;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "请求正文不是有效 JSON" }, { status: 400 });
  }

  try {
    if (!isRecord(body.worldState) || !Array.isArray(body.events) || !isRecord(body.chapter)) {
      throw new Error("story prepare 缺少 worldState、events 或 chapter");
    }
    const world = body.worldState as WorldState;
    const events = body.events as SimulationEvent[];
    const chapter = body.chapter as LiveSceneChapterContext;
    const requestId = requestIdentity(body.requestId);
    const budget = new ExecutionBudget({
      executionId: requestId,
      timeoutMs: 45_000,
      maxRequests: 2,
      phaseLimits: { interactive: 2 },
      signal: request.signal,
    });
    const input = {
      world,
      events,
      chapter,
      saveId: typeof body.saveId === "string" ? body.saveId : world.gameId,
      runId: typeof body.runId === "string" ? body.runId : world.gameId,
      branchId: typeof body.branchId === "string" ? body.branchId : "main",
      unitId: typeof body.unitId === "string" ? body.unitId : `chapter-${chapter.id}-unit-1`,
      requiredEventIds: Array.isArray(body.requiredEventIds)
        ? body.requiredEventIds.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
        : events.map((event) => event.id),
      revealedEventIds: Array.isArray(body.revealedEventIds)
        ? body.revealedEventIds.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
        : [],
      ...(typeof body.isFinalUnit === "boolean" ? { isFinalUnit: body.isFinalUnit } : {}),
      ...(typeof body.nextUnitId === "string" && body.nextUnitId.trim() ? { nextUnitId: body.nextUnitId.trim() } : {}),
      ...(typeof body.inputFingerprint === "string" ? { inputFingerprint: body.inputFingerprint } : {}),
      signal: request.signal,
      budget,
    };
    const inputFingerprint = lifeStoryInputFingerprint(input);
    const encoder = new TextEncoder();
    let seq = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const write = (event: string, payload: Record<string, unknown>) => {
          if (closed || budget.signal.aborted) return;
          seq += 1;
          try {
            controller.enqueue(encoder.encode(eventLine(event, { requestId, inputFingerprint, ...payload }, seq)));
          } catch {
            closed = true;
            budget.abort("stream-closed");
          }
        };
        void (async () => {
          write("accepted", { unitId: input.unitId });
          try {
            const unit = await createLifeAiProvider().prepare({ life: input });
            if (!("payload" in unit)) throw new Error("主游戏 provider 未返回互动单元");
            const storyUnit = unit as StoryUnit;
            write("unit_ready", { unit: storyUnit });
            write("complete", { unitId: storyUnit.id });
          } catch (error) {
            write("error", { code: "STORY_PREPARE_FAILED", message: error instanceof Error ? error.message : "主游戏互动单元准备失败", committed: false });
          } finally {
            closed = true;
            budget.dispose();
            try { controller.close(); } catch { /* stream already closed */ }
          }
        })();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "story prepare 请求失败" }, { status: 400 });
  }
}
