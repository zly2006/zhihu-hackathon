// NPC 生成器（Phase 1）
// 根据主角背景，用 LLM 生成 3 个与主角人生有实际连接的核心 NPC。
// 玩家可编辑名字、关系类型、一句公开设定；隐藏心理状态不可编辑。

import { randomUUID } from "node:crypto";
import { callGameModel, type CallOptions } from "../llm";
import type { Character } from "../domain/character";
import type { RelationshipType } from "../domain/relationship";
import type { NpcDraft } from "./character-factory";
import { ExecutionBudget } from "./execution-budget";
import { canRetryGeneration, generationFailure } from "./generation-error";

const VALID_RELATIONSHIP_TYPES: RelationshipType[] = [
  "family",
  "friend",
  "close_friend",
  "classmate",
  "coworker",
  "partner",
  "rival",
  "other",
];

type ModelNpc = {
  name?: unknown;
  gender?: unknown;
  age?: unknown;
  relationshipType?: unknown;
  basicSetting?: unknown;
  personalityTraits?: unknown;
  values?: unknown;
  hiddenGoal?: unknown;
  hiddenConcern?: unknown;
  privateBelief?: unknown;
  speechStyle?: unknown;
};

type ModelNpcOutput = {
  npcs?: unknown;
};

type NpcModel = (
  purpose: string,
  system: string,
  prompt: string,
  options: CallOptions,
) => Promise<ModelNpcOutput>;

export type NpcGenerationOptions = {
  budget?: ExecutionBudget;
  executionId?: string;
  signal?: AbortSignal;
  maxAttempts?: number;
  model?: NpcModel;
};

function requireText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`大模型返回字段 ${field} 缺失`);
  }
  return value.trim().slice(0, maximum);
}

function requireStringArray(value: unknown, field: string, maximum: number): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string" && /[、，,；;|\n]/u.test(value)
      ? value.split(/[、，,；;|\n]+/u)
      : null;
  if (!values) throw new Error(`大模型返回字段 ${field} 必须是数组或可明确拆分的字符串`);
  const normalized = values.map((item) => {
    if (typeof item !== "string") throw new Error(`大模型返回字段 ${field} 的数组项必须是字符串`);
    const text = item.trim();
    if (!text) throw new Error(`大模型返回字段 ${field} 不能包含空数组项`);
    return text;
  });
  return normalized.slice(0, maximum);
}

export function validateNpcs(modeled: ModelNpcOutput): NpcDraft[] {
  if (!Array.isArray(modeled.npcs) || modeled.npcs.length !== 3) {
    throw new Error("大模型必须返回且只能返回三个 NPC");
  }
  const npcs = modeled.npcs.map((raw, index): NpcDraft => {
    const npc = (raw ?? {}) as Record<string, unknown>;
    const relationshipType = requireText(npc.relationshipType, `npcs[${index}].relationshipType`, 20);
    if (!VALID_RELATIONSHIP_TYPES.includes(relationshipType as RelationshipType)) {
      throw new Error(`npcs[${index}].relationshipType 非法: ${relationshipType}`);
    }
    const age = Number(npc.age);
    if (!Number.isFinite(age) || age < 10 || age > 90) {
      throw new Error(`npcs[${index}].age 必须是 10 到 90 的数字`);
    }
    return {
      name: requireText(npc.name, `npcs[${index}].name`, 12),
      gender: requireText(npc.gender, `npcs[${index}].gender`, 6),
      age: Math.round(age),
      relationshipType: relationshipType as RelationshipType,
      basicSetting: requireText(npc.basicSetting, `npcs[${index}].basicSetting`, 80),
      personalityTraits: requireStringArray(npc.personalityTraits, `npcs[${index}].personalityTraits`, 4),
      values: requireStringArray(npc.values, `npcs[${index}].values`, 3),
      hiddenGoal: requireText(npc.hiddenGoal, `npcs[${index}].hiddenGoal`, 80),
      hiddenConcern: requireText(npc.hiddenConcern, `npcs[${index}].hiddenConcern`, 80),
      privateBelief: requireText(npc.privateBelief, `npcs[${index}].privateBelief`, 80),
      speechStyle:
        typeof npc.speechStyle === "string" && npc.speechStyle.trim()
          ? npc.speechStyle.trim().slice(0, 80)
          : undefined,
    };
  });
  const types = npcs.map((npc) => npc.relationshipType);
  if (new Set(types).size !== types.length) {
    throw new Error("三个 NPC 的关系类型必须互不相同");
  }
  return npcs;
}

function describeProtagonist(protagonist: Character): string {
  return [
    `主角姓名：${protagonist.identity.name}`,
    `出生年份：${protagonist.identity.birthYear}（当前 ${protagonist.state.age} 岁）`,
    `性别：${protagonist.identity.gender}`,
    `家乡：${protagonist.identity.hometown}`,
    `家庭背景：${protagonist.identity.familyBackground}`,
    `初始城市：${protagonist.state.city}`,
    `起点方向：${protagonist.state.occupation}`,
    `性格标签：${protagonist.core.personalityTraits.join("、")}`,
    `价值观：${protagonist.core.values.join("、")}`,
    `长期目标：${protagonist.state.currentGoals[0]?.label ?? "未设定"}`,
    `初始困境：${protagonist.state.currentDilemmas[0] ?? "未设定"}`,
  ].join("\n");
}

const NPC_SYSTEM =
  "你是中文互动人生小说的 NPC 设计师。只输出严格 JSON，不写 Markdown。NPC 是虚构人物，不得复制真实知乎作者的人生。每个 NPC 都必须与主角的人生有真实连接，覆盖不同社会关系（家人、好友、同学/同事、潜在伴侣、对手等），不能全是同类关系。NPC 是独立的人：有自己的隐藏目标、隐忧和私人信念，这些不直接展示给玩家，只能通过后续行为暗示。speechStyle 只描述玩家可观察的公开说话方式，不包含隐藏心理。";

export async function generateNpcs(protagonist: Character, options: NpcGenerationOptions = {}): Promise<NpcDraft[]> {
  const prompt = `请根据以下主角背景，生成 3 个与其人生有实际连接的核心 NPC。\n\n${describeProtagonist(protagonist)}\n\n要求：\n1. 三个 NPC 的 relationshipType 必须互不相同，从下列取值中选择：family、friend、close_friend、classmate、coworker、partner、rival、other。\n2. 年龄 10 到 90，与主角建立合理的关系（如同龄同学、年长的家人等）。\n3. basicSetting 是玩家可见的一句公开设定，只描述关系与身份，不泄露隐藏心理。\n4. hiddenGoal / hiddenConcern / privateBelief 是 NPC 的隐藏状态，玩家不可见。\n\n返回 JSON：{"npcs":[{"name":"12字内","gender":"单字或两字","age":数字,"relationshipType":"family","basicSetting":"60字内公开设定","personalityTraits":["2-4个"],"values":["1-3个"],"hiddenGoal":"60字内","hiddenConcern":"60字内","privateBelief":"60字内"}]}`;

  const promptWithSpeechStyle = `${prompt}\n\n补充要求：每个 NPC 增加 speechStyle 字段，描述玩家可观察的公开说话方式，不超过 80 字，不包含隐藏心理。`;
  const maxAttempts = Math.min(options.maxAttempts ?? 2, 2);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 2) {
    throw new Error("NPC 生成 maxAttempts 必须是 1 到 2");
  }
  const executionId = options.executionId ?? randomUUID();
  const ownsBudget = !options.budget;
  const budget = options.budget ?? new ExecutionBudget({
    executionId,
    timeoutMs: 45_000,
    maxRequests: 2,
    phaseLimits: { npc: 2 },
    signal: options.signal,
  });
  const correctionOptions: CallOptions = {
    signal: options.signal,
    budget,
    budgetPhase: "npc",
    executionId: budget.executionId,
    deadlineAt: budget.deadlineAt,
    maxTokens: 2800,
    timeoutMs: Math.min(45_000, budget.remainingMs()),
    firstTokenTimeoutMs: 15_000,
    stallPolicy: "bounded",
    responseFormat: "json",
    maxTransportRetries: 0,
    logMode: "metadata",
  };
  let correction = "";
  try {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      let candidate: ModelNpcOutput | undefined;
      try {
        const modeled = options.model
          ? await (async () => {
              budget.assertCanStart("npc-generation", "npc");
              budget.reserve("npc-generation", "npc");
              return options.model!("npc-generation", NPC_SYSTEM, `${promptWithSpeechStyle}${correction}`, correctionOptions);
            })()
          : await callGameModel<ModelNpcOutput>("npc-generation", NPC_SYSTEM, `${promptWithSpeechStyle}${correction}`, correctionOptions);
        candidate = modeled;
        return validateNpcs(modeled);
      } catch (error) {
        const failure = generationFailure(error);
        if (attempt === maxAttempts - 1 || !canRetryGeneration(error)) throw error;
        const candidateText = candidate ? `\n上一次完整候选（只允许修正结构，不得改变人物事实）：\n${JSON.stringify(candidate)}` : "";
        correction = failure.category === "transport" || failure.category === "rate_limit"
          ? ""
          : `\n\n# 上一次输出的程序校验反馈\n${failure.message}${candidateText}\n请只修正上述问题，并重新输出完整 JSON。`;
      }
    }
    throw new Error("NPC 生成失败");
  } finally {
    if (ownsBudget) budget.dispose();
  }
}
