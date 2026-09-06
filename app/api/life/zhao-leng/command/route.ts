import { NextResponse } from "next/server";
import type { GameSave } from "@/lib/domain/chapter";
import type { ZhaoLengCommand } from "@/lib/domain/zhao-leng-runtime";
import { normalizeSceneSave } from "@/lib/game/scene-save";
import { applyZhaoLengCommand, ZhaoLengCommandError } from "@/lib/game/zhao-leng-progress";
import { compileZhaoLengBeat } from "@/lib/game/zhao-leng-package";
import { generateZhaoLengBeat } from "@/lib/game/zhao-leng-writer";
import { listZhaoLengBeatIds } from "@/lib/game/zhao-leng-package";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMMAND_TYPES = new Set([
  "observe_library_card",
  "advance_beat",
  "open_hidden",
  "finish_hidden",
  "finish_normal",
  "finish_ending",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function parseCommand(value: unknown): ZhaoLengCommand {
  if (!isRecord(value) || typeof value.type !== "string" || !COMMAND_TYPES.has(value.type)) {
    throw new Error("赵冷 Demo command.type 无效");
  }
  if (typeof value.requestId !== "string" || !value.requestId.trim()) throw new Error("command.requestId 不能为空");
  if (!Number.isInteger(value.expectedRevision) || (value.expectedRevision as number) < 0) throw new Error("command.expectedRevision 无效");
  if (typeof value.expectedPackageId !== "string" || !value.expectedPackageId.trim()) throw new Error("command.expectedPackageId 不能为空");
  if (typeof value.issuedAt !== "string" || !value.issuedAt.trim()) throw new Error("command.issuedAt 不能为空");
  return {
    type: value.type as ZhaoLengCommand["type"],
    requestId: value.requestId,
    expectedRevision: value.expectedRevision,
    expectedPackageId: value.expectedPackageId,
    issuedAt: value.issuedAt,
  } as ZhaoLengCommand;
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
    const command = parseCommand(body.command);
    let dependencies: Parameters<typeof applyZhaoLengCommand>[2] = { now: command.issuedAt };
    if (command.type === "advance_beat" && save.zhaoLeng?.generationMode === "llm") {
      const beatIds = listZhaoLengBeatIds();
      const currentIndex = beatIds.indexOf(save.zhaoLeng.beatId);
      const nextBeatId = currentIndex >= 0 ? beatIds[currentIndex + 1] : undefined;
      if (nextBeatId) {
        const written = await generateZhaoLengBeat({ save, beatId: nextBeatId, mode: "llm" });
        dependencies = {
          now: command.issuedAt,
          compileBeat: ({ save: prepared, beatId }) =>
            compileZhaoLengBeat({ save: prepared, beatId, written: beatId === nextBeatId ? written : undefined }),
        };
      }
    }
    const result = applyZhaoLengCommand(save, command, dependencies);
    return NextResponse.json({
      gameSave: result.saveAfter,
      scenePackage: result.saveAfter.scenePackages?.[result.saveAfter.sceneRuntime?.chapterId ?? ""],
      runtime: result.saveAfter.sceneRuntime,
      replayed: result.replayed,
      endingId: result.saveAfter.zhaoLeng?.endingId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "赵冷 Demo 命令失败";
    const status = error instanceof ZhaoLengCommandError && error.retryable ? 409 : /AI|模型/.test(message) ? 502 : 400;
    return NextResponse.json({ error: message, code: error instanceof ZhaoLengCommandError ? error.code : "ZHAO_LENG_COMMAND_FAILED" }, { status });
  }
}
