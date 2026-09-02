import { NextResponse } from "next/server";
import type { SimulationEvent } from "@/lib/domain/simulation";
import type { WorldState } from "@/lib/domain/world";
import { runReflectionBatch, applyReflections } from "@/lib/game/reflection-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// V1.2 角色反思端点：与 /api/chapter/narrative-plan 并行调用，缩短章节生成总时长。
// 失败返回 500，由前端 fail-open 降级为无反思状态（不阻断章节、不修改 canonical）。
type ReflectionsRequest = {
  chapterId: string;
  worldBefore: WorldState;
  worldAfter: WorldState;
  events: SimulationEvent[];
};

export async function POST(request: Request) {
  let body: ReflectionsRequest;
  try {
    body = (await request.json()) as ReflectionsRequest;
  } catch {
    return NextResponse.json({ error: "请求正文不是有效 JSON" }, { status: 400 });
  }
  const { chapterId, worldBefore, worldAfter, events } = body;
  if (!chapterId || !worldBefore || worldBefore.schemaVersion !== 1 || !worldBefore.protagonistId) {
    return NextResponse.json({ error: "无效的 worldBefore" }, { status: 400 });
  }
  if (!worldAfter || worldAfter.schemaVersion !== 1) {
    return NextResponse.json({ error: "无效的 worldAfter" }, { status: 400 });
  }
  if (!Array.isArray(events) || !events.length) {
    return NextResponse.json({ error: "events 不能为空" }, { status: 400 });
  }

  try {
    const result = await runReflectionBatch({
      chapterId,
      year: worldAfter.currentYear,
      worldBefore,
      worldAfter,
      events,
    });
    const finalWorldState = result.applied
      ? applyReflections(worldAfter, result.reflections)
      : worldAfter;
    return NextResponse.json({
      worldStateAfter: finalWorldState,
      reflectionCount: result.reflections.length,
      metrics: result.metrics,
    });
  } catch (error) {
    console.error("reflections failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "角色反思失败" },
      { status: 500 },
    );
  }
}
