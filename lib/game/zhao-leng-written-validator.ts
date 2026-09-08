import type { GameSave } from "../domain/chapter";
import type {
  ZhaoLengBeatId,
  ZhaoLengWrittenBeat,
  ZhaoLengWrittenLine,
} from "../domain/zhao-leng-runtime";
import { getZhaoLengBeatScript } from "../narrative/zhao-leng-script";
import { assertNoPrivateNarrativeLeak } from "./public-narrative-guard";

export type ZhaoLengWrittenBeatInput = {
  save: GameSave;
  beatId: ZhaoLengBeatId;
};

const FORBIDDEN_KEYS = new Set([
  "worldState",
  "statDelta",
  "relationshipDelta",
  "flagsAfter",
  "next",
  "ruleId",
  "delta",
  "events",
  "privateState",
  "hiddenGoals",
  "hiddenConcerns",
  "privateBeliefs",
]);
const SPEAKER_IDS = new Set(["protagonist", "npc-zhao-leng"]);
const BEAT_ID_PATTERN = /^zl-(0[1-9]|1[0-2])-[a-z-]+$/;

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} 必须是对象`);
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, path: string, max = 1600): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${path} 必须是非空文本`);
  const text = value.trim();
  if (text.length > max) throw new Error(`${path} 超过 ${max} 字符`);
  return text;
}

function assertNoForbiddenKeys(value: unknown, path = "output"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error(`${path}.${key} 是禁止的结算字段`);
    assertNoForbiddenKeys(child, `${path}.${key}`);
  }
}

function parseLine(value: unknown, path: string): ZhaoLengWrittenLine {
  const item = record(value, path);
  if (item.type === "narration") {
    if (Object.keys(item).some((key) => key !== "type" && key !== "text")) {
      throw new Error(`${path} 只能包含 type、text`);
    }
    return { type: "narration", text: requiredText(item.text, `${path}.text`) };
  }
  if (item.type !== "dialogue") throw new Error(`${path}.type 必须是 narration 或 dialogue`);
  if (Object.keys(item).some((key) => !["type", "speakerId", "text", "emotion"].includes(key))) {
    throw new Error(`${path} 含有未知对白字段`);
  }
  if (typeof item.speakerId !== "string" || !SPEAKER_IDS.has(item.speakerId)) {
    throw new Error(`${path}.speakerId 不是允许的公开角色`);
  }
  return {
    type: "dialogue",
    speakerId: item.speakerId as "protagonist" | "npc-zhao-leng",
    text: requiredText(item.text, `${path}.text`),
    emotion: requiredText(item.emotion, `${path}.emotion`, 30),
  };
}

function parseLines(value: unknown, path: string, min = 1): ZhaoLengWrittenLine[] {
  if (!Array.isArray(value) || value.length < min || value.length > 16) {
    throw new Error(`${path} 必须包含 ${min} 到 16 行`);
  }
  return value.map((line, index) => parseLine(line, `${path}[${index}]`));
}

export function parseZhaoLengWrittenBeat(
  value: unknown,
  input: ZhaoLengWrittenBeatInput,
): ZhaoLengWrittenBeat {
  assertNoForbiddenKeys(value);
  const root = record(value, "output");
  if (root.beatId !== input.beatId || typeof root.beatId !== "string" || !BEAT_ID_PATTERN.test(root.beatId)) {
    throw new Error(`output.beatId 必须精确等于当前节拍 ${input.beatId}`);
  }
  const feedback = record(root.feedback, "output.feedback");
  const expectedChoiceIds = getZhaoLengBeatScript(input.beatId).choices.map((choice) => choice.id);
  const feedbackIds = Object.keys(feedback).sort();
  if (feedbackIds.join(",") !== [...expectedChoiceIds].sort().join(",")) {
    throw new Error(
      expectedChoiceIds.length === 0
        ? "无选择节拍的 output.feedback 必须为空对象"
        : "output.feedback 必须恰好包含 A、B、C",
    );
  }
  const parsedFeedback: Partial<Record<"A" | "B" | "C", ZhaoLengWrittenLine[]>> = {};
  for (const choiceId of expectedChoiceIds) {
    parsedFeedback[choiceId] = parseLines(feedback[choiceId], `output.feedback.${choiceId}`);
  }
  const parsed: ZhaoLengWrittenBeat = {
    beatId: input.beatId,
    opening: parseLines(root.opening, "output.opening"),
    feedback: parsedFeedback,
  };
  assertNoPrivateNarrativeLeak(parsed, input.save.worldState, "赵冷 Demo 写作结果");
  return parsed;
}
