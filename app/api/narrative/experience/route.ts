import { NextResponse } from "next/server";
import type { ChapterDecision } from "@/lib/domain/chapter";
import type { SimulationEvent } from "@/lib/domain/simulation";
import type { WorldState } from "@/lib/domain/world";
import { buildNarrativeExperience } from "@/lib/game/narrative-experience-service";

// buildNarrativeExperience 统一调用 planNpcProactiveEvents，并通过 toPublicNpcAgentTrace 输出公开投影。

// V3.3 的只读叙事预览接口。
// 前端显示主动消息后，应把玩家回应作为下一次既有 /api/chapter/simulate 的 action 提交；
// 本接口不写入 WorldState，不产生 canonical SimulationEvent，也不泄露私有行动意图。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type NarrativeExperienceRequest = {
  chapterId: string;
  state: WorldState;
  decision: ChapterDecision;
  recentEvents?: SimulationEvent[];
  deliveredDirectiveIds?: string[];
  span?: 1 | 3;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseRequest(value: unknown): NarrativeExperienceRequest {
  if (!isRecord(value)) throw new Error("请求正文不是对象");
  const state = value.state;
  const decision = value.decision;
  if (typeof value.chapterId !== "string" || !value.chapterId.trim())
    throw new Error("chapterId 不能为空");
  if (!isRecord(state) || state.schemaVersion !== 1 || typeof state.protagonistId !== "string") {
    throw new Error("state 无效");
  }
  if (
    !isRecord(state.characters) ||
    !isRecord(state.relationships) ||
    !Array.isArray(state.openThreads)
  ) {
    throw new Error("state 缺少角色、关系或线索");
  }
  if (!isRecord(decision) || typeof decision.normalizedAction !== "string")
    throw new Error("decision 无效");
  if (value.span !== undefined && value.span !== 1 && value.span !== 3)
    throw new Error("span 必须是 1 或 3");
  if (value.recentEvents !== undefined && !Array.isArray(value.recentEvents))
    throw new Error("recentEvents 必须是数组");
  if (
    value.deliveredDirectiveIds !== undefined &&
    (!Array.isArray(value.deliveredDirectiveIds) ||
      value.deliveredDirectiveIds.length > 20 ||
      !value.deliveredDirectiveIds.every((id) => typeof id === "string"))
  ) {
    throw new Error("deliveredDirectiveIds 无效");
  }
  return {
    chapterId: value.chapterId.trim(),
    state: state as unknown as WorldState,
    decision: decision as unknown as ChapterDecision,
    recentEvents: (value.recentEvents ?? []) as SimulationEvent[],
    deliveredDirectiveIds: value.deliveredDirectiveIds as string[] | undefined,
    span: value.span as 1 | 3 | undefined,
  };
}

export async function POST(request: Request) {
  try {
    const input = parseRequest(await request.json());
    return NextResponse.json(buildNarrativeExperience(input));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "叙事预览请求无效" },
      { status: 400 },
    );
  }
}
