import { NextResponse } from "next/server";
import type { GameSave } from "@/lib/domain/chapter";
import { createInitialNarrativeRuntime } from "@/lib/domain/zhao-leng-runtime";
import {
  buildZhaoLengNarrativeExperience,
  deliveredDirectiveIds,
  mergeNarrativeDeliveries,
} from "@/lib/game/narrative-experience-service";
import { isZhaoLengDemoSave } from "@/lib/game/zhao-leng-demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseRequest(value: unknown): { save: GameSave; contextKind: "demo-entry" | "zhao-leng-beat" } {
  if (!isRecord(value) || !isRecord(value.save)) throw new Error("缺少赵冷 Demo 存档");
  const contextKind = value.contextKind === "demo-entry" ? "demo-entry" : "zhao-leng-beat";
  const save = value.save as unknown as GameSave;
  if (!isZhaoLengDemoSave(save)) throw new Error("不是有效的赵冷 Demo 存档");
  return { save, contextKind };
}

export async function POST(request: Request) {
  try {
    const input = parseRequest(await request.json());
    const branchId = input.save.activeBranchId ?? input.save.sceneRuntime?.branchId ?? "main";
    const runtime = input.save.narrativeRuntime ?? createInitialNarrativeRuntime();
    const preview = buildZhaoLengNarrativeExperience({
      save: input.save,
      contextKind: input.contextKind,
      deliveredDirectiveIds: deliveredDirectiveIds(runtime),
    });
    const merged = mergeNarrativeDeliveries(runtime, preview.proactiveEvents, branchId, preview.contextKind);
    const saveAfter: GameSave = {
      ...input.save,
      narrativeRuntime: merged.runtime,
      savedAt: new Date().toISOString(),
    };
    return NextResponse.json({
      ...preview,
      narrativeRuntime: merged.runtime,
      saveAfter,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "赵冷叙事预览请求无效" },
      { status: 400 },
    );
  }
}
