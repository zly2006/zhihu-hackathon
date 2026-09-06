import { NextResponse } from "next/server";
import type { GameSave } from "@/lib/domain/chapter";
import { normalizeSceneSave } from "@/lib/game/scene-save";
import { startZhaoLengDemo } from "@/lib/game/zhao-leng-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function parseMode(value: unknown): "scripted" | "llm" {
  if (value === undefined || value === "scripted" || value === "llm") return value ?? "scripted";
  throw new Error("赵冷 Demo mode 必须是 scripted 或 llm");
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
    const mode = parseMode(body.mode);
    const save = body.save ? normalizeSceneSave(body.save as GameSave) : undefined;
    const result = await startZhaoLengDemo({
      save,
      mode,
      currentYear: typeof body.currentYear === "number" ? body.currentYear : undefined,
      now: new Date().toISOString(),
    });
    return NextResponse.json({
      saveKey: result.saveAfter.zhaoLeng?.generationMode === "llm"
        ? "restart-life-zhao-leng-demo-v1-llm"
        : "restart-life-zhao-leng-demo-v1-scripted",
      gameSave: result.saveAfter,
      scenePackage: result.scenePackage,
      reused: result.reused,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "赵冷 Demo 启动失败";
    const status = /模型|AI|生成/.test(message) ? 502 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
