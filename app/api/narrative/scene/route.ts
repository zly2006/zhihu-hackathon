import { NextResponse } from "next/server";
import {
  narrativeScene,
  type NarrativeSceneCharacter,
  type NarrativeSceneInput,
} from "@/lib/narrative/kb-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseCharacters(value: unknown): NarrativeSceneCharacter[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) throw new Error("characters 必须是不超过 8 项的数组");
  return value.map((character) => {
    if (typeof character === "string") return character;
    if (isRecord(character) && typeof character.name === "string") return { name: character.name };
    throw new Error("characters 中每项必须是字符串或 {name} 对象");
  });
}

function parseLimit(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) throw new Error("limit 必须是整数");
  return value;
}

function parseBody(value: unknown): NarrativeSceneInput {
  if (!isRecord(value)) throw new Error("请求正文不是对象");
  return {
    event: typeof value.event === "string" ? value.event : "",
    characters: parseCharacters(value.characters),
    relationship: typeof value.relationship === "string" ? value.relationship : undefined,
    limit: parseLimit(value.limit),
  };
}

export async function POST(request: Request) {
  try {
    const input = parseBody(await request.json());
    if (!input.event.trim()) throw new Error("event 不能为空");
    return NextResponse.json(narrativeScene(input));
  } catch (error) {
    const message = error instanceof Error ? error.message : "请求参数无效";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
