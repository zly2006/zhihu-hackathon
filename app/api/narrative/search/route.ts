import { NextResponse } from "next/server";
import {
  narrativeSearch,
  type NarrativeSearchInput,
} from "@/lib/narrative/kb-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseLimit(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) throw new Error("limit 必须是整数");
  return value;
}

function parseBody(value: unknown): NarrativeSearchInput {
  if (!isRecord(value)) throw new Error("请求正文不是对象");
  return {
    event: typeof value.event === "string" ? value.event : "",
    stage: typeof value.stage === "string" ? value.stage : undefined,
    limit: parseLimit(value.limit),
  };
}

export async function POST(request: Request) {
  try {
    const input = parseBody(await request.json());
    if (!input.event.trim()) throw new Error("event 不能为空");
    return NextResponse.json(narrativeSearch(input));
  } catch (error) {
    const message = error instanceof Error ? error.message : "请求参数无效";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
