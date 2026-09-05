import { NextResponse } from "next/server";
import { generateChapterChoice } from "@/lib/game/choice-generator";
import type { ChapterSpan } from "@/lib/domain/shared";
import type { WorldState } from "@/lib/domain/world";
import { normalizeSceneActionContext } from "@/lib/game/scene-action-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { worldState: WorldState; span: ChapterSpan; sceneActionContext?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求正文不是有效 JSON" }, { status: 400 });
  }
  const { worldState, span } = body;
  if (!worldState || worldState.schemaVersion !== 1 || !worldState.protagonistId) {
    return NextResponse.json({ error: "无效的 WorldState" }, { status: 400 });
  }
  if (span !== 1 && span !== 3) {
    return NextResponse.json({ error: "span 必须是 1 或 3" }, { status: 400 });
  }
  let sceneActionContext;
  try {
    sceneActionContext = normalizeSceneActionContext(body.sceneActionContext);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "sceneActionContext 无效" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: "progress" | "complete" | "error", data: object) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        send("progress", { stage: "generating", message: "正在生成本章困境与行动方向" });
        const generatedChoice = await generateChapterChoice(worldState, span);
        const choice = sceneActionContext.length
          ? { ...generatedChoice, sceneActionContext }
          : generatedChoice;
        send("complete", { choice });
      } catch (error) {
        console.error("choice generation failed", error);
        send("error", { message: error instanceof Error ? error.message : "选择生成失败，请重试" });
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
