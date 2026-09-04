import { NextResponse } from "next/server";
import {
  writeNovel,
  writeNovelStream,
  type NovelWriterInput,
} from "@/lib/game/novel-writer";
import type { ChapterSpan } from "@/lib/domain/shared";
import type { CharacterMemory } from "@/lib/domain/memory";
import type { SimulationEvent } from "@/lib/domain/simulation";
import type { LifeExperience } from "@/lib/domain/experience";
import type { WorldState } from "@/lib/domain/world";
import type { NarrativePlan, NarrativeReference } from "@/lib/domain/narrative";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type NovelRequest = {
  stateBefore: WorldState;
  events: SimulationEvent[];
  relevantMemories: CharacterMemory[];
  featuredEvidence: LifeExperience[];
  span: ChapterSpan;
  version?: number;
  // V1.1：可选 Director 规划与叙事参考
  narrativePlan?: NarrativePlan;
  narrativeReferences?: NarrativeReference[];
  // V2.4：存在 Scene Plan 时可显式请求增量 SSE；缺省保持 JSON 兼容。
  stream?: boolean;
};

function streamNovelResponse(input: NovelWriterInput, version: number, signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: "progress" | "scene_start" | "delta" | "scene" | "complete" | "error", data: object) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      try {
        send("progress", { stage: "started", message: "正在准备场景生成" });
        const novel = await writeNovelStream(input, version, {
          signal,
          onSceneStart: (sceneIndex, scenePlan) =>
            send("scene_start", { sceneIndex, scenePlan }),
          onToken: (sceneIndex, token) => send("delta", { sceneIndex, delta: token }),
          onScene: (sceneIndex, scene) => send("scene", { sceneIndex, scene }),
        });
        send("complete", { novel });
      } catch (error) {
        if (!signal.aborted) {
          console.error("streaming novel generation failed", error);
          send("error", { message: error instanceof Error ? error.message : "小说生成失败，请重试" });
        }
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* 客户端提前断开时流已关闭。 */
        }
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

export async function POST(request: Request) {
  let body: NovelRequest;
  try {
    body = (await request.json()) as NovelRequest;
  } catch {
    return NextResponse.json({ error: "请求正文不是有效 JSON" }, { status: 400 });
  }
  const {
    stateBefore,
    events,
    relevantMemories = [],
    featuredEvidence = [],
    span,
    version = 1,
    narrativePlan,
    narrativeReferences,
    stream: streamRequested = false,
  } = body;
  if (!stateBefore || stateBefore.schemaVersion !== 1 || !stateBefore.protagonistId) {
    return NextResponse.json({ error: "无效的 stateBefore" }, { status: 400 });
  }
  if (!Array.isArray(events) || !events.length) {
    return NextResponse.json({ error: "events 不能为空" }, { status: 400 });
  }
  if (span !== 1 && span !== 3) return NextResponse.json({ error: "span 必须是 1 或 3" }, { status: 400 });

  try {
    const protagonist = stateBefore.characters[stateBefore.protagonistId];
    const npcs = Object.values(stateBefore.characters).filter((character) => character.role === "npc");
    const input: NovelWriterInput = {
      protagonist,
      npcs,
      relationships: Object.values(stateBefore.relationships),
      startYear: stateBefore.currentYear,
      endYear: stateBefore.currentYear + span,
      span,
      events,
      relevantMemories,
      featuredEvidence,
      narrativePlan,
      narrativeReferences,
    };
    if (streamRequested && narrativePlan?.scenes?.length) {
      return streamNovelResponse(input, version, request.signal);
    }
    const novel = await writeNovel(input, version);
    return NextResponse.json({ novel });
  } catch (error) {
    console.error("novel generation failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "小说生成失败，请重试" },
      { status: 500 },
    );
  }
}
