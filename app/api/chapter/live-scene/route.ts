import { NextResponse } from "next/server";
import type { SimulationEvent } from "@/lib/domain/simulation";
import type { WorldState } from "@/lib/domain/world";
import type { LiveSceneChapterContext } from "@/lib/game/live-scene-generator";
import { generateLiveScenePackage } from "@/lib/game/live-scene-generator";
import { validateWorldState } from "@/lib/domain/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

type LiveSceneRequest = {
  worldState: WorldState;
  events: SimulationEvent[];
  chapter: LiveSceneChapterContext;
  version?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateRequest(value: unknown): LiveSceneRequest {
  if (!isRecord(value)) throw new Error("请求正文不是对象");
  const worldState = value.worldState as WorldState;
  if (!worldState || worldState.schemaVersion !== 1 || typeof worldState.protagonistId !== "string") {
    throw new Error("无效的 worldState");
  }
  validateWorldState(worldState);
  if (!Array.isArray(value.events)) throw new Error("events 必须是数组");
  const chapter = value.chapter as LiveSceneChapterContext;
  if (
    !chapter ||
    typeof chapter.id !== "string" ||
    !Number.isInteger(chapter.index) ||
    !Number.isInteger(chapter.startYear) ||
    !Number.isInteger(chapter.endYear) ||
    (chapter.span !== 1 && chapter.span !== 3) ||
    !chapter.decision ||
    !chapter.summary
  ) {
    throw new Error("无效的 chapter 上下文");
  }
  return {
    worldState,
    events: value.events as SimulationEvent[],
    chapter,
    version: value.version as number | undefined,
  };
}

export async function POST(request: Request) {
  let input: LiveSceneRequest;
  try {
    input = validateRequest(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "请求正文无效" },
      { status: 400 },
    );
  }

  try {
    const scenePackage = await generateLiveScenePackage({
      world: input.worldState,
      events: input.events,
      chapter: input.chapter,
      version: input.version,
    }, {
      signal: request.signal,
      executionId: `live-scene:${input.chapter.id}`,
    });
    return NextResponse.json({ scenePackage, generated: "llm" });
  } catch (error) {
    console.error("live scene generation failed:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI 互动场景生成失败，请重试" },
      { status: 502 },
    );
  }
}
