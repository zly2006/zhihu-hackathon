import { NextResponse } from "next/server";
import { writeNovel, type NovelWriterInput } from "@/lib/game/novel-writer";
import type { ChapterSpan } from "@/lib/domain/shared";
import type { CharacterMemory } from "@/lib/domain/memory";
import type { SimulationEvent } from "@/lib/domain/simulation";
import type { LifeExperience } from "@/lib/domain/experience";
import type { WorldState } from "@/lib/domain/world";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type NovelRequest = {
  stateBefore: WorldState;
  events: SimulationEvent[];
  relevantMemories: CharacterMemory[];
  featuredEvidence: LifeExperience[];
  span: ChapterSpan;
  version?: number;
};

export async function POST(request: Request) {
  let body: NovelRequest;
  try {
    body = (await request.json()) as NovelRequest;
  } catch {
    return NextResponse.json({ error: "请求正文不是有效 JSON" }, { status: 400 });
  }
  const { stateBefore, events, relevantMemories = [], featuredEvidence = [], span, version = 1 } = body;
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
    };
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
