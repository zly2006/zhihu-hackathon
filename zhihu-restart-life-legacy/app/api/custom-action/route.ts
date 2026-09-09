import { NextResponse } from "next/server";
import { resolveCustomAction } from "@/lib/game";
import type { GameEvent, LifeState } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { event: GameEvent; state: LifeState; action: string };
    const action = String(body.action || "")
      .trim()
      .slice(0, 300);
    if (!action || !body.event || !body.state)
      return NextResponse.json({ error: "请写下你的选择" }, { status: 400 });
    return NextResponse.json(await resolveCustomAction(body.event, action, body.state));
  } catch (error) {
    const message = error instanceof Error ? error.message : "自由行动解析失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
