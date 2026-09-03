import { NextResponse } from "next/server";
import {
  createInitialGameSave,
  createInitialWorldState,
  createNpc,
  createRelationship,
  type NpcDraft,
} from "@/lib/game/character-factory";
import type { Character } from "@/lib/domain/character";
import type { GameMode } from "@/lib/domain/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { protagonist: Character; npcs: NpcDraft[]; presentationMode?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求正文不是有效 JSON" }, { status: 400 });
  }
  const { protagonist, npcs } = body;
  if (!protagonist || !protagonist.id || protagonist.role !== "protagonist") {
    return NextResponse.json({ error: "主角数据无效" }, { status: 400 });
  }
  if (!Array.isArray(npcs) || npcs.length !== 3) {
    return NextResponse.json({ error: "必须提供 3 个 NPC" }, { status: 400 });
  }
  if (body.presentationMode !== undefined && body.presentationMode !== "novel" && body.presentationMode !== "galgame") {
    return NextResponse.json({ error: "presentationMode 无效" }, { status: 400 });
  }

  try {
    const now = new Date().toISOString();
    const currentYear = protagonist.state.year;
    const npcCharacters = npcs.map((npc) => createNpc(npc, currentYear, now));
    const relationships = npcCharacters.map((npc, index) =>
      createRelationship(protagonist.id, npc.id, npcs[index].relationshipType, npcs[index].basicSetting, now),
    );
    const world = createInitialWorldState(protagonist, npcCharacters, relationships, now);
    const presentationMode = (body.presentationMode ?? "galgame") as GameMode;
    const gameSave = createInitialGameSave(world, now, presentationMode);
    return NextResponse.json({ gameSave });
  } catch (error) {
    console.error("life creation failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "人生创建失败，请重试" },
      { status: 500 },
    );
  }
}
