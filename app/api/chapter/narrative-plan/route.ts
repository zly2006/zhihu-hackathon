import { NextResponse } from "next/server";
import { runNarrativeEngine } from "@/lib/narrative/engine";
import { buildNarrativeDirectorBrief } from "@/lib/game/narrative-director";
import type { ChapterSpan } from "@/lib/domain/shared";
import type { ChapterDecision } from "@/lib/domain/chapter";
import type { SimulationEvent } from "@/lib/domain/simulation";
import type { WorldState } from "@/lib/domain/world";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type NarrativePlanRequest = {
  chapterId: string;
  stateBefore: WorldState;
  events: SimulationEvent[];
  decision: ChapterDecision;
  span: ChapterSpan;
};

export async function POST(request: Request) {
  let body: NarrativePlanRequest;
  try {
    body = (await request.json()) as NarrativePlanRequest;
  } catch {
    return NextResponse.json({ error: "请求正文不是有效 JSON" }, { status: 400 });
  }
  const { chapterId, stateBefore, events, decision, span } = body;
  if (!chapterId || !stateBefore || stateBefore.schemaVersion !== 1 || !stateBefore.protagonistId) {
    return NextResponse.json({ error: "无效的请求参数" }, { status: 400 });
  }
  if (!Array.isArray(events) || !events.length) {
    return NextResponse.json({ error: "events 不能为空" }, { status: 400 });
  }
  if (!decision || !decision.normalizedAction) {
    return NextResponse.json({ error: "无效的 decision" }, { status: 400 });
  }
  if (span !== 1 && span !== 3) return NextResponse.json({ error: "span 必须是 1 或 3" }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: "progress" | "complete" | "error", data: object) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        send("progress", { stage: "retrieving", message: "正在从叙事知识库检索本章参考" });
        const directorBrief = buildNarrativeDirectorBrief({
          chapterId,
          world: stateBefore,
          events,
          decision,
          span,
          startYear: stateBefore.currentYear,
          endYear: stateBefore.currentYear + span,
        });
        const result = await runNarrativeEngine({
          chapterId,
          span,
          world: stateBefore,
          events,
          decision,
          startYear: stateBefore.currentYear,
          endYear: stateBefore.currentYear + span,
          directorBrief,
        });
        send("progress", {
          stage: "validating",
          message: `已生成叙事计划（检索 ${result.metrics.retrievalTotal} 条参考，导演尝试 ${result.metrics.directorAttempts} 次）`,
        });
        send("complete", result);
      } catch (error) {
        console.error("narrative plan generation failed", error);
        send("error", { message: error instanceof Error ? error.message : "叙事规划失败，请重试" });
      } finally {
        controller.close();
      }
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
