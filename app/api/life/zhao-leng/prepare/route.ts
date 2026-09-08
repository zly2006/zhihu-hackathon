import { NextResponse } from "next/server";
import type { GameSave } from "@/lib/domain/chapter";
import type { ZhaoLengBeatId } from "@/lib/domain/zhao-leng-runtime";
import { normalizeSceneSave } from "@/lib/game/scene-save";
import {
  nextZhaoLengBeatId,
  validateZhaoLengPreparedArtifact,
  zhaoLengPrepareFingerprint,
} from "@/lib/game/zhao-leng-prepare";
import { createZhaoLengAiProvider, createZhaoLengScriptedProvider } from "@/lib/game/story-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requestIdentity(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  return `zhao-prepare-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
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
    if (!body.save) throw new Error("缺少赵冷 Demo 存档");
    const save = normalizeSceneSave(body.save as GameSave);
    const nextBeatId = typeof body.nextBeatId === "string"
      ? body.nextBeatId as ZhaoLengBeatId
      : nextZhaoLengBeatId(save);
    if (!nextBeatId) throw new Error("当前赵冷节拍没有可准备的下一节拍");
    const inputFingerprint = zhaoLengPrepareFingerprint(save, nextBeatId);
    if (body.inputFingerprint !== undefined && body.inputFingerprint !== inputFingerprint) {
      throw new Error("赵冷 prepare inputFingerprint 与服务端事实不匹配");
    }
    const requestId = requestIdentity(body.requestId);
    const encoder = new TextEncoder();
    let seq = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const write = (event: string, payload: Record<string, unknown>) => {
          if (closed || request.signal.aborted) return;
          seq += 1;
          try {
            controller.enqueue(encoder.encode(eventLine(event, { requestId, inputFingerprint, ...payload }, seq)));
          } catch {
            closed = true;
          }
        };
        void (async () => {
          write("accepted", { nextBeatId });
          try {
            const provider = save.zhaoLeng?.generationMode === "llm"
              ? createZhaoLengAiProvider()
              : createZhaoLengScriptedProvider();
            const artifact = await provider.prepare({ save, nextBeatId, signal: request.signal, executionId: requestId });
            if (!("artifactId" in artifact)) throw new Error("赵冷 provider 未返回有效准备产物");
            const validated = validateZhaoLengPreparedArtifact(save, nextBeatId, artifact);
            write("unit_ready", { artifact: validated });
            write("complete", { artifactId: validated.artifactId, nextBeatId });
          } catch (error) {
            write("error", { code: "ZHAO_LENG_PREPARE_FAILED", message: error instanceof Error ? error.message : "赵冷下一节拍准备失败" });
          } finally {
            closed = true;
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
    return NextResponse.json({ error: error instanceof Error ? error.message : "赵冷 prepare 请求失败" }, { status: 400 });
  }
}
