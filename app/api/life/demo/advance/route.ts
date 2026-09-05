import { NextResponse } from "next/server";
import type { GameSave } from "@/lib/domain/chapter";
import { normalizeSceneSave } from "@/lib/game/scene-save";
import { createNeutralScenePackages } from "@/lib/game/neutral-scene-package";
import { advanceNeutralDemoSave } from "@/lib/game/neutral-demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function POST(request: Request) {
  let body: { gameSave?: unknown; packageId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求正文不是有效 JSON" }, { status: 400 });
  }
  if (!isRecord(body) || !body.gameSave || typeof body.packageId !== "string" || !body.packageId.trim()) {
    return NextResponse.json({ error: "缺少中性 Demo 存档或下一章节 ID" }, { status: 400 });
  }

  try {
    const save = normalizeSceneSave(body.gameSave as GameSave);
    const packageItem = createNeutralScenePackages(2026).find((item) => item.id === body.packageId);
    if (!packageItem) return NextResponse.json({ error: "未知的中性测试章节" }, { status: 400 });
    const gameSave = advanceNeutralDemoSave(save, packageItem, new Date().toISOString());
    return NextResponse.json({
      synthetic: true,
      gameSave,
      scenePackage: gameSave.scenePackages?.[packageItem.chapterId] ?? packageItem,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "中性 Demo 章节切换失败" },
      { status: 409 },
    );
  }
}
