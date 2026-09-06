import { callGameModel } from "../llm";
import type { GameSave } from "../domain/chapter";
import type {
  ZhaoLengBeatId,
  ZhaoLengGenerationMode,
  ZhaoLengWrittenBeat,
  ZhaoLengWrittenLine,
} from "../domain/zhao-leng-runtime";
import { getZhaoLengCharacters, getZhaoLengRelationship } from "./zhao-leng-demo";
import { assertNoPrivateNarrativeLeak } from "./public-narrative-guard";
import { getZhaoLengBeatScript } from "../narrative/zhao-leng-script";
import { buildZhaoLengStyleReferences } from "../narrative/zhao-leng-style";

export { buildZhaoLengStyleReferences } from "../narrative/zhao-leng-style";

export type ZhaoLengWriterInput = {
  save: GameSave;
  beatId: ZhaoLengBeatId;
  mode?: ZhaoLengGenerationMode;
};

export type ZhaoLengWriterModel = (
  purpose: string,
  system: string,
  prompt: string,
  options?: Record<string, unknown>,
) => Promise<unknown>;

export type ZhaoLengWriterOptions = {
  model?: ZhaoLengWriterModel;
  maxAttempts?: number;
  signal?: AbortSignal;
};

export const ZHAO_LENG_WRITER_SYSTEM =
  "你是赵冷 Demo 的视觉小说写作者。只输出严格 JSON，把已给出的公开事实写成克制、具体、可观察的中文对白与旁白。不得替角色解释未公开心理，不得修改关系数值、事件、旗标、目标或运行时。";

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

export function parseZhaoLengWrittenBeat(value: unknown, input: ZhaoLengWriterInput): ZhaoLengWrittenBeat {
  assertNoForbiddenKeys(value);
  const root = record(value, "output");
  if (root.beatId !== input.beatId || typeof root.beatId !== "string" || !BEAT_ID_PATTERN.test(root.beatId)) {
    throw new Error(`output.beatId 必须精确等于当前节拍 ${input.beatId}`);
  }
  const feedback = record(root.feedback, "output.feedback");
  const feedbackIds = Object.keys(feedback).sort();
  if (feedbackIds.join(",") !== "A,B,C") throw new Error("output.feedback 必须恰好包含 A、B、C");
  const parsed: ZhaoLengWrittenBeat = {
    beatId: input.beatId,
    opening: parseLines(root.opening, "output.opening"),
    feedback: {
      A: parseLines(feedback.A, "output.feedback.A"),
      B: parseLines(feedback.B, "output.feedback.B"),
      C: parseLines(feedback.C, "output.feedback.C"),
    },
  };
  assertNoPrivateNarrativeLeak(parsed, input.save.worldState, "赵冷 Demo 写作结果");
  return parsed;
}

function publicWorldPrompt(input: ZhaoLengWriterInput): string {
  const { protagonist, zhaoLeng } = getZhaoLengCharacters(input.save);
  const relationship = getZhaoLengRelationship(input.save);
  return [
    "# 仅限公开世界事实",
    `当前年份：${input.save.worldState.currentYear}`,
    `主角：${protagonist.identity.name}；城市：${protagonist.state.city || "未设定"}；职业：${protagonist.state.occupation || "未设定"}`,
    `赵冷：${zhaoLeng.identity.name}；公开身份：${zhaoLeng.state.occupation || zhaoLeng.identity.familyBackground || "城市档案编辑"}；公开性格：${zhaoLeng.core.personalityTraits.join("、")}`,
    `赵冷公开表达方式：${zhaoLeng.speechStyle || "先说事实，再说判断"}`,
    `公开关系：${relationship.publicSummary}`,
    `关系阶段分数（仅作节奏参考，不得在文本中直接说出）：亲近 ${relationship.scores.closeness}，信任 ${relationship.scores.trust}，冲突 ${relationship.scores.conflict}，承诺 ${relationship.scores.commitment}`,
  ].join("\n");
}

export function buildZhaoLengWriterPrompt(input: ZhaoLengWriterInput, correction = ""): string {
  const script = getZhaoLengBeatScript(input.beatId);
  const references = buildZhaoLengStyleReferences({ beatId: input.beatId });
  const choices = script.choices.length
    ? script.choices.map((choice) => `${choice.id}. ${choice.label}｜玩家可能说：${choice.prompt}`).join("\n")
    : "（本节不生成选择反馈）";
  return [
    publicWorldPrompt(input),
    "",
    "# 当前节拍",
    `节拍 ID：${script.id}；标题：${script.title}；地点：${script.location}；时间：${script.timeLabel}`,
    `选择提示：${script.choicePrompt || "无"}`,
    `公开选择结构：\n${choices}`,
    "",
    "# 写作技法卡（只有抽象技法，没有原文摘录）",
    references.map((reference) => `- ${reference.sourceId}｜${reference.title}：${reference.technique} 用法：${reference.usage}`).join("\n"),
    "",
    "# 输出格式与硬约束",
    `只输出 JSON：{"beatId":"${input.beatId}","opening":[line],"feedback":{"A":[line],"B":[line],"C":[line]}}。每个数组至少 1 行；line 只能是 {"type":"narration","text":"..."} 或 {"type":"dialogue","speakerId":"protagonist|npc-zhao-leng","text":"...","emotion":"..."}。不得输出世界状态、数值结算、运行时路由、事件对象或任何内部角色字段。不要直接写分数，不要替程序结算后果。`,
    "所有事实只能来自上述公开上下文；赵冷的未公开目标、担忧、私密信念只能保持未知。",
    correction,
  ].join("\n");
}

function scriptedBeat(input: ZhaoLengWriterInput): ZhaoLengWrittenBeat {
  const script = getZhaoLengBeatScript(input.beatId);
  return JSON.parse(JSON.stringify({
    beatId: input.beatId,
    opening: script.opening,
    feedback: {
      A: script.feedback.A,
      B: script.feedback.B,
      C: script.feedback.C,
    },
  })) as ZhaoLengWrittenBeat;
}

export async function generateZhaoLengBeat(
  input: ZhaoLengWriterInput,
  options: ZhaoLengWriterOptions = {},
): Promise<ZhaoLengWrittenBeat> {
  const mode = input.mode ?? input.save.zhaoLeng?.generationMode ?? "scripted";
  if (mode === "scripted") return parseZhaoLengWrittenBeat(scriptedBeat(input), input);
  const maxAttempts = options.maxAttempts ?? 3;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) throw new Error("赵冷 Demo 写作 maxAttempts 必须是 1 到 3");
  const model = options.model ?? ((purpose, system, prompt, callOptions) =>
    callGameModel<ZhaoLengWrittenBeat>(purpose, system, prompt, {
      ...(callOptions as object),
      signal: options.signal,
      maxTokens: 2800,
      timeoutMs: 120_000,
      responseFormat: "json",
      maxTransportRetries: 0,
      logMode: "metadata",
    }));
  const basePrompt = buildZhaoLengWriterPrompt(input);
  let correction = "";
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const modeled = await model("zhao-leng-beat", ZHAO_LENG_WRITER_SYSTEM, `${basePrompt}${correction}`, {
        maxTokens: 2800,
        timeoutMs: 120_000,
        responseFormat: "json",
        maxTransportRetries: 0,
        logMode: "metadata",
      });
      return parseZhaoLengWrittenBeat(modeled, input);
    } catch (error) {
      const message = error instanceof Error ? error.message : "输出未通过程序校验";
      if (attempt === maxAttempts - 1) throw new Error(`赵冷 Demo AI 写作失败：${message}`);
      correction = `\n\n# 上一次输出的程序校验反馈\n${message}\n请只修正上述问题，并重新输出完整 JSON。`;
    }
  }
  throw new Error("赵冷 Demo AI 写作失败");
}
