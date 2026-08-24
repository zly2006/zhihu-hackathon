import { NextResponse } from "next/server";
import { generateEvent } from "@/lib/game";
import type { EventStreamProgress, LifeState, Profile, TimelineEntry } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { profile: Profile; state: LifeState; history?: TimelineEntry[] };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "请求正文不是有效 JSON" }, { status: 400 });
  }
  if (!body.profile || !body.state || body.state.age < 0 || body.state.age > 100) return NextResponse.json({ error: "invalid game state" }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: "progress" | "complete" | "error", data: EventStreamProgress | object) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        const event = await generateEvent(body.profile, body.state, body.history || [], (progress) => send("progress", progress), request.signal);
        send("complete", event);
      } catch (error) {
        send("error", { message: error instanceof Error ? error.message : "事件生成失败" });
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
