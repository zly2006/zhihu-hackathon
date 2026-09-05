import { NextResponse } from "next/server";
import type { SceneChoiceRequest, SceneSaveProjection } from "@/lib/domain/scene";
import type { ScenePackage } from "@/lib/domain/scene";
import { applySceneChoice, SceneChoiceServiceError } from "@/lib/game/scene-choice-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseRequest(value: unknown): SceneChoiceRequest {
  if (!isRecord(value)) throw new Error("请求正文不是对象");
  if (!isRecord(value.projection) || !isRecord(value.package)) throw new Error("缺少场景存档投影或内容包");
  if (typeof value.requestId !== "string" || !value.requestId.trim()) throw new Error("requestId 无效");
  if (typeof value.issuedAt !== "string" || !value.issuedAt.trim()) throw new Error("issuedAt 无效");
  if (!Number.isInteger(value.expectedRevision) || (value.expectedRevision as number) < 0) throw new Error("expectedRevision 无效");
  if (value.choiceId !== "A" && value.choiceId !== "B" && value.choiceId !== "C") throw new Error("choiceId 无效");
  return {
    projection: value.projection as unknown as SceneSaveProjection,
    package: value.package as unknown as ScenePackage,
    requestId: value.requestId,
    issuedAt: value.issuedAt,
    expectedRevision: value.expectedRevision as number,
    choiceId: value.choiceId,
  };
}

function errorPayload(code: string, message: string, retryable: boolean) {
  return { error: { code, message, retryable } };
}

export async function POST(request: Request) {
  let input: SceneChoiceRequest;
  try {
    input = parseRequest(await request.json());
  } catch (error) {
    return NextResponse.json(
      errorPayload("INVALID_REQUEST", error instanceof Error ? error.message : "请求正文无效", false),
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(applySceneChoice(input));
  } catch (error) {
    if (error instanceof SceneChoiceServiceError) {
      if (error.code === "CHOICE_LOCKED") {
        return NextResponse.json(errorPayload(error.code, error.message, error.retryable), { status: 422 });
      }
      if (["REVISION_CONFLICT", "CHOICE_SLOT_CONFLICT", "PACKAGE_MISMATCH"].includes(error.code)) {
        return NextResponse.json(errorPayload(error.code, error.message, error.retryable), { status: 409 });
      }
      return NextResponse.json(errorPayload(error.code, error.message, error.retryable), { status: 500 });
    }
    return NextResponse.json(errorPayload("SCENE_CHOICE_FAILED", "场景选择失败，请稍后重试", true), { status: 500 });
  }
}
