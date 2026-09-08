import { callGameModel } from "../llm";
import { ExecutionBudget } from "./execution-budget";
import { canRetryGeneration, generationFailure } from "./generation-error";
import type { GameSave } from "../domain/chapter";
import type {
  ZhaoLengBeatId,
  ZhaoLengGenerationMode,
  ZhaoLengWrittenBeat,
} from "../domain/zhao-leng-runtime";
import { getZhaoLengCharacters, getZhaoLengRelationship } from "./zhao-leng-demo";
import { getZhaoLengBeatScript } from "../narrative/zhao-leng-script";
import { buildZhaoLengStyleReferences } from "../narrative/zhao-leng-style";
import { parseZhaoLengWrittenBeat as parseValidatedZhaoLengWrittenBeat } from "./zhao-leng-written-validator";

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
  budget?: ExecutionBudget;
  executionId?: string;
};

export const ZHAO_LENG_WRITER_SYSTEM =
  "你是赵冷 Demo 的视觉小说写作者。只输出严格 JSON，把已给出的公开事实写成克制、具体、可观察的中文对白与旁白。不得替角色解释未公开心理，不得修改关系数值、事件、旗标、目标或运行时。";

export function parseZhaoLengWrittenBeat(value: unknown, input: ZhaoLengWriterInput): ZhaoLengWrittenBeat {
  return parseValidatedZhaoLengWrittenBeat(value, input);
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
    `只输出 JSON：{"beatId":"${input.beatId}","opening":[line],"feedback":${script.choices.length ? '{"A":[line],"B":[line],"C":[line]}' : "{}"}}。每个 opening/反馈数组至少 1 行；无选择节拍的 feedback 必须为空对象；line 只能是 {"type":"narration","text":"..."} 或 {"type":"dialogue","speakerId":"protagonist|npc-zhao-leng","text":"...","emotion":"..."}。不得输出世界状态、数值结算、运行时路由、事件对象或任何内部角色字段。不要直接写分数，不要替程序结算后果。`,
    "所有事实只能来自上述公开上下文；赵冷的未公开目标、担忧、私密信念只能保持未知。",
    correction,
  ].join("\n");
}

function scriptedBeat(input: ZhaoLengWriterInput): ZhaoLengWrittenBeat {
  const script = getZhaoLengBeatScript(input.beatId);
  return JSON.parse(JSON.stringify({
    beatId: input.beatId,
    opening: script.opening,
    feedback: script.choices.length
      ? {
          A: script.feedback.A,
          B: script.feedback.B,
          C: script.feedback.C,
        }
      : {},
  })) as ZhaoLengWrittenBeat;
}

export async function generateZhaoLengBeat(
  input: ZhaoLengWriterInput,
  options: ZhaoLengWriterOptions = {},
): Promise<ZhaoLengWrittenBeat> {
  const mode = input.mode ?? input.save.zhaoLeng?.generationMode ?? "scripted";
  if (mode === "scripted") return parseZhaoLengWrittenBeat(scriptedBeat(input), input);
  const maxAttempts = Math.min(options.maxAttempts ?? 2, 2);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 2) throw new Error("赵冷 Demo 写作 maxAttempts 必须是 1 到 2");
  const executionId = options.executionId ?? `zhao-leng-${input.beatId}`;
  const ownsBudget = !options.budget;
  const budget = options.budget ?? new ExecutionBudget({
    executionId,
    timeoutMs: 45_000,
    maxRequests: 2,
    phaseLimits: { interactive: 2 },
    signal: options.signal,
  });
  const providedModel = options.model;
  const model = providedModel ?? ((purpose, system, prompt, callOptions) =>
    callGameModel<ZhaoLengWrittenBeat>(purpose, system, prompt, {
      ...(callOptions as object),
      signal: options.signal,
      budget,
      budgetPhase: "interactive",
      executionId: budget.executionId,
      deadlineAt: budget.deadlineAt,
      maxTokens: 2800,
      timeoutMs: Math.min(45_000, budget.remainingMs()),
      firstTokenTimeoutMs: 15_000,
      stallPolicy: "bounded",
      responseFormat: "json",
      maxTransportRetries: 0,
      logMode: "metadata",
    }));
  const basePrompt = buildZhaoLengWriterPrompt(input);
  let correction = "";
  try {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        budget.assertCanStart("zhao-leng-beat", "interactive");
        if (providedModel) budget.reserve("zhao-leng-beat", "interactive");
        const modeled = await model("zhao-leng-beat", ZHAO_LENG_WRITER_SYSTEM, `${basePrompt}${correction}`, {
          maxTokens: 2800,
          timeoutMs: Math.min(45_000, budget.remainingMs()),
          deadlineAt: budget.deadlineAt,
          executionId: budget.executionId,
          signal: budget.signal,
          responseFormat: "json",
          maxTransportRetries: 0,
          logMode: "metadata",
        });
        return parseZhaoLengWrittenBeat(modeled, input);
      } catch (error) {
        const failure = generationFailure(error);
        if (attempt === maxAttempts - 1 || !canRetryGeneration(error)) {
          throw new Error(`赵冷 Demo AI 写作失败：${failure.message}`);
        }
        correction = failure.category === "transport" || failure.category === "rate_limit"
          ? ""
          : `\n\n# 上一次输出的程序校验反馈\n${failure.message}\n请只修正上述问题，并重新输出完整 JSON。`;
      }
    }
    throw new Error("赵冷 Demo AI 写作失败");
  } finally {
    if (ownsBudget) budget.dispose();
  }
}
