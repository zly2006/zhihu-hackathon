import { NextResponse } from "next/server";
import type { NovelScene } from "@/lib/domain/chapter";
import type { NarrativeEvidenceBundle, NarrativePlan } from "@/lib/domain/narrative";
import type { SimulationEvent } from "@/lib/domain/simulation";
import type { WorldState } from "@/lib/domain/world";
import {
  buildFallbackDialogueScenes,
  writeDialogue,
  type DialogueWriterInput,
} from "@/lib/game/dialogue-writer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DialogueRequestBody = {
  stateBefore: WorldState;
  events: SimulationEvent[];
  novelScenes: NovelScene[];
  narrativePlan?: NarrativePlan;
  narrativeEvidence?: NarrativeEvidenceBundle;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseBody(value: unknown): DialogueRequestBody {
  if (!isRecord(value)) throw new Error("请求正文不是对象");
  const stateBefore = value.stateBefore;
  if (!isRecord(stateBefore) || stateBefore.schemaVersion !== 1 || typeof stateBefore.protagonistId !== "string") {
    throw new Error("stateBefore 无效");
  }
  if (!isRecord(stateBefore.characters) || !isRecord(stateBefore.characters[stateBefore.protagonistId])) {
    throw new Error("stateBefore 缺少主角");
  }
  if (!isRecord(stateBefore.relationships) || !isRecord(stateBefore.memories)) {
    throw new Error("stateBefore 缺少关系或记忆表");
  }
  if (
    !Array.isArray(value.events) ||
    !value.events.every(
      (event) =>
        isRecord(event) &&
        typeof event.id === "string" &&
        typeof event.title === "string" &&
        Array.isArray(event.participantIds),
    )
  ) {
    throw new Error("events 结构无效");
  }
  if (
    !Array.isArray(value.novelScenes) ||
    value.novelScenes.length === 0 ||
    !value.novelScenes.every(
      (scene) => isRecord(scene) && typeof scene.id === "string" && typeof scene.text === "string" && scene.text.trim(),
    )
  ) {
    throw new Error("novelScenes 不能为空");
  }
  return {
    stateBefore: stateBefore as unknown as WorldState,
    events: value.events as SimulationEvent[],
    novelScenes: value.novelScenes as NovelScene[],
    narrativePlan: isRecord(value.narrativePlan) ? (value.narrativePlan as unknown as NarrativePlan) : undefined,
    narrativeEvidence: isRecord(value.narrativeEvidence)
      ? (value.narrativeEvidence as unknown as NarrativeEvidenceBundle)
      : undefined,
  };
}

export async function POST(request: Request) {
  let input: DialogueWriterInput;
  try {
    const body = parseBody(await request.json());
    input = {
      world: body.stateBefore,
      events: body.events,
      novelScenes: body.novelScenes,
      narrativePlan: body.narrativePlan,
      narrativeEvidence: body.narrativeEvidence,
    };
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "请求正文无效" },
      { status: 400 },
    );
  }

  try {
    const dialogue = await writeDialogue(input);
    return NextResponse.json({ dialogue, degraded: false });
  } catch (error) {
    console.warn(
      "chapter dialogue degraded:",
      error instanceof Error ? error.message : "unknown dialogue error",
    );
    return NextResponse.json({
      dialogue: buildFallbackDialogueScenes(input),
      degraded: true,
    });
  }
}
