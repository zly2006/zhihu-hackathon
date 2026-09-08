import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createProtagonist, type ProtagonistDraft } from "@/lib/game/character-factory";
import { ExecutionBudget } from "@/lib/game/execution-budget";
import { generateNpcs } from "@/lib/game/npc-generator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

export async function POST(request: Request) {
  let body: { protagonistDraft: ProtagonistDraft };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求正文不是有效 JSON" }, { status: 400 });
  }
  const draft = body.protagonistDraft;
  if (!draft || typeof draft !== "object" || !draft.name || !draft.name.trim()) {
    return NextResponse.json({ error: "主角信息不完整" }, { status: 400 });
  }
  const birthYear = Number(draft.birthYear);
  if (!Number.isFinite(birthYear) || birthYear < 1950 || birthYear > 2026) {
    return NextResponse.json({ error: "出生年份需在 1950 到 2026 之间" }, { status: 400 });
  }

  try {
    const protagonist = createProtagonist(draft);
    const budget = new ExecutionBudget({
      executionId: randomUUID(),
      timeoutMs: 45_000,
      maxRequests: 2,
      phaseLimits: { npc: 2 },
      signal: request.signal,
    });
    try {
      const npcs = await generateNpcs(protagonist, { budget });
      return NextResponse.json({ protagonist, npcs });
    } finally {
      budget.dispose();
    }
  } catch (error) {
    console.error("NPC generation failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "NPC 生成失败，请重试" },
      { status: 500 },
    );
  }
}
