// Choice Generator（Phase 2）
// 把旧 /api/event 的"情境 + 选项"能力迁移为 WorldState → ChapterChoice。
// 玩家只选择"行动方向"，不选择"成功/失败"（方案 §3.1）。

import { randomUUID } from "node:crypto";
import { callGameModel, type CallOptions } from "../llm";
import type { ChapterSpan } from "../domain/shared";
import type { ChapterChoice } from "../domain/chapter";
import type { WorldState } from "../domain/world";
import type { Relationship } from "../domain/relationship";
import { hashState } from "./hash";
import { BoundedTtlCache, stableCacheKey } from "./performance-cache";
import { ExecutionBudget } from "./execution-budget";
import { canRetryGeneration, generationFailure } from "./generation-error";

type ModelOption = {
  id?: unknown;
  label?: unknown;
  description?: unknown;
  strategyTag?: unknown;
  estimatedRisk?: unknown;
  stateFit?: unknown;
};

type ModelChoice = {
  promptTitle?: unknown;
  context?: unknown;
  options?: unknown;
};

type ChoiceModel = (
  purpose: string,
  system: string,
  prompt: string,
  options: CallOptions,
) => Promise<ModelChoice>;

export type ChapterChoiceGenerationOptions = {
  model?: ChoiceModel;
  budget?: ExecutionBudget;
  signal?: AbortSignal;
  executionId?: string;
  maxAttempts?: number;
  forceFresh?: boolean;
};

function requireText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`大模型返回字段 ${field} 缺失`);
  }
  const text = value.trim();
  if (text.length > maximum) {
    throw new Error(`大模型返回字段 ${field} 最多 ${maximum} 字，实际 ${text.length} 字`);
  }
  return text;
}

function requireNumber(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`大模型返回字段 ${field} 必须是 ${min} 到 ${max} 的数字`);
  }
  return value;
}

function requireStateFit(value: unknown, field: string): ChapterChoice["options"][number]["stateFit"] {
  if (value !== "顺势" && value !== "可行" && value !== "吃力") {
    throw new Error(`大模型返回字段 ${field} 必须是"顺势""可行"或"吃力"`);
  }
  return value;
}

export function validateChapterChoice(modeled: ModelChoice): ChapterChoice {
  if (!Array.isArray(modeled.options) || modeled.options.length !== 3) {
    throw new Error("大模型必须返回且只能返回三个选项");
  }
  const options = modeled.options.map((raw, index): ChapterChoice["options"][number] => {
    const option = (raw ?? {}) as Record<string, unknown>;
    const id = requireText(option.id, `options[${index}].id`, 2);
    if (id !== "A" && id !== "B" && id !== "C") {
      throw new Error(`options[${index}].id 必须是 A/B/C`);
    }
    return {
      id: id as "A" | "B" | "C",
      label: requireText(option.label, `options[${index}].label`, 16),
      description: requireText(option.description, `options[${index}].description`, 60),
      strategyTag: requireText(option.strategyTag, `options[${index}].strategyTag`, 12),
      estimatedRisk: Math.round(requireNumber(option.estimatedRisk, `options[${index}].estimatedRisk`, 0, 100)),
      stateFit: requireStateFit(option.stateFit, `options[${index}].stateFit`),
    };
  });
  if (new Set(options.map((option) => option.strategyTag)).size !== 3) {
    throw new Error("三个选项的 strategyTag 必须互不相同，代表三种不同的行动机制");
  }
  return {
    id: `decision-${randomUUID()}`,
    promptTitle: requireText(modeled.promptTitle, "promptTitle", 24),
    context: requireText(modeled.context, "context", 1200),
    options,
  };
}

function describeStats(stats: Record<string, number>, labels: Record<string, string>): string {
  return Object.entries(labels)
    .map(([key, label]) => `${label}${Math.round(stats[key] ?? 0)}`)
    .join("，");
}

function describeRelationship(rel: Relationship, world: WorldState): string {
  const a = world.characters[rel.characterAId];
  const b = world.characters[rel.characterBId];
  if (a?.role !== "protagonist" && b?.role !== "protagonist") return "";
  const npc = a?.role === "npc" ? a : b;
  if (!npc) return "";
  const typeLabels: Record<string, string> = {
    family: "家人",
    friend: "朋友",
    close_friend: "密友",
    classmate: "同学",
    coworker: "同事",
    partner: "伴侣",
    spouse: "配偶",
    ex_partner: "前任",
    rival: "对手",
    estranged: "疏远",
    other: "其他",
  };
  return `与 ${npc.identity.name}（${typeLabels[rel.type] ?? rel.type}）：亲密${rel.scores.closeness}，信任${rel.scores.trust}，冲突${rel.scores.conflict}，承诺${rel.scores.commitment}；${rel.publicSummary || "无公开说明"}`;
}

function describeWorld(world: WorldState, span: ChapterSpan): string {
  const protagonist = world.characters[world.protagonistId];
  const statLabels: Record<string, string> = {
    cash: "现金",
    health: "健康",
    happiness: "幸福",
    knowledge: "知识",
    connections: "人脉",
    career: "事业",
    assets: "资产",
  };
  const protagonistLines = [
    `主角：${protagonist.identity.name}，${protagonist.state.age} 岁，${world.currentYear} 年，在${protagonist.state.city || "某地"}`,
    `职业/身份：${protagonist.state.occupation || "未定"}`,
    `性格：${protagonist.core.personalityTraits.join("、") || "未设定"}`,
    `价值观：${protagonist.core.values.join("、") || "未设定"}`,
    `状态：${describeStats(protagonist.state.stats as unknown as Record<string, number>, statLabels)}`,
    `当前目标：${protagonist.state.currentGoals.map((goal) => goal.label).join("、") || "未设定"}`,
    `当前困境：${protagonist.state.currentDilemmas.join("、") || "未设定"}`,
  ];

  const npcLines = Object.values(world.characters)
    .filter((character) => character.role === "npc")
    .map((npc) => {
      const rel = Object.values(world.relationships).find(
        (r) =>
          (r.characterAId === npc.id && r.characterBId === world.protagonistId) ||
          (r.characterBId === npc.id && r.characterAId === world.protagonistId),
      );
      const type = rel ? describeRelationship(rel, world) : `与 ${npc.identity.name} 的关系未记录`;
      const goals = npc.state.currentGoals.map((goal) => goal.label).join("、") || "未设定";
      return `NPC ${npc.identity.name}（${npc.state.age} 岁，${npc.state.occupation || "身份未定"}）：目标「${goals}」；${type}`;
    });

  const threadLines = world.openThreads.length
    ? `未解决的线索：${world.openThreads.map((thread) => `${thread.label}（${thread.status}）`).join("；")}`
    : "暂无未解决线索";

  const eraLine = world.eraContext
    ? `时代背景：${world.eraContext.title}——${world.eraContext.summary}`
    : "时代背景：当前无特定时代事件，按常规当代社会背景处理。";

  return [
    ...protagonistLines,
    ...npcLines,
    threadLines,
    eraLine,
    `本章时间跨度：${span} 年`,
  ].join("\n");
}

const CHOICE_SYSTEM =
  "你是中文互动人生小说的选择生成器。只输出严格 JSON，不写 Markdown。玩家只选择行动方向，不直接选择成功或失败。你必须从主角当前的真实处境、资源状态、关系与目标中生长出一个具体困境，再给出三个机制互不相同的行动方向。不要给低风险选项同时塞多项高收益，也不要把三个选项写成同一风险轴上的稳妥/探索/激进。禁止编造真实政策、名人或历史事件。";

const choiceCache = new BoundedTtlCache<ChapterChoice>({
  ttlMs: 60_000,
  maxEntries: 32,
});

export function clearChoiceCache(): void {
  choiceCache.clear();
}

export async function generateChapterChoice(
  world: WorldState,
  span: ChapterSpan,
  options: ChapterChoiceGenerationOptions = {},
): Promise<ChapterChoice> {
  const key = stableCacheKey("chapter-choice", { stateHash: hashState(world), span });
  const produce = async (): Promise<ChapterChoice> => {
    const worldDescription = describeWorld(world, span);
    const prompt = `请根据以下当前世界状态，生成本章的核心困境与三个行动方向。\n\n${worldDescription}\n\n要求：\n1. context 是一个具体的当下困境（80-200字），从一个可见的处境切入，不要抽象的人生规划。\n2. 三个选项必须改变行动机制（例如：留任争取 / 接受邀请 / 迁移换环境；自己承担 / 借助他人 / 改变目标），strategyTag 互不相同。\n3. estimatedRisk 是资源正常的人执行该行动的 0-100 结构风险；stateFit 表示该行动相对主角当前处境的契合度（顺势/可行/吃力）。\n4. strategyTag 必须是不超过 12 个字符的短标签，只描述行动机制，不要把解释句塞进该字段。\n5. 只输出 JSON，格式如下：\n{"promptTitle":"16字内","context":"200字内困境","options":[{"id":"A","label":"12字内","description":"40字内","strategyTag":"行动机制","estimatedRisk":0到100,"stateFit":"顺势|可行|吃力"},{"id":"B","label":"...","description":"...","strategyTag":"...","estimatedRisk":0到100,"stateFit":"..."},{"id":"C","label":"...","description":"...","strategyTag":"...","estimatedRisk":0到100,"stateFit":"..."}]}`;
    const promptWithConstraints = prompt;
    const executionId = options.executionId ?? `choice-${randomUUID()}`;
    const ownsBudget = !options.budget;
    const budget = options.budget ?? new ExecutionBudget({
      executionId,
      timeoutMs: 45_000,
      maxRequests: 2,
      phaseLimits: { choice: 2 },
      signal: options.signal,
    });
    const maxAttempts = Math.min(options.maxAttempts ?? 2, 2);
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 2) {
      throw new Error("章节选择 maxAttempts 必须是 1 到 2");
    }
    let correction = "";
    try {
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
          const callOptions: CallOptions = {
            signal: budget.signal,
            budget,
            budgetPhase: "choice",
            executionId: budget.executionId,
            deadlineAt: budget.deadlineAt,
            maxTokens: 2400,
            timeoutMs: Math.min(45_000, budget.remainingMs()),
            firstTokenTimeoutMs: Math.min(15_000, budget.remainingMs()),
            stallPolicy: "bounded",
            responseFormat: "json",
            maxTransportRetries: 0,
            logMode: "metadata",
            ...(correction ? { appendMessages: [{ role: "user" as const, content: correction }] } : {}),
          };
          const modeled = options.model
            ? await (async () => {
                const request = budget.reserve("chapter-choice", "choice");
                return options.model!("chapter-choice", CHOICE_SYSTEM, `${promptWithConstraints}${correction}`, {
                  ...callOptions,
                  requestId: request.requestId,
                  executionId: request.executionId,
                });
              })()
            : await callGameModel<ModelChoice>("chapter-choice", CHOICE_SYSTEM, promptWithConstraints, callOptions);
          return validateChapterChoice(modeled);
        } catch (error) {
          const failure = generationFailure(error);
          if (attempt === maxAttempts - 1 || !canRetryGeneration(error)) throw error;
          correction = failure.category === "transport" || failure.category === "rate_limit"
            ? ""
            : `上一次候选只在以下程序校验项失败：${failure.message}。保持当前困境和三种不同的行动机制，只修正该项并重新输出完整 JSON。`;
        }
      }
      throw new Error("章节选择生成失败");
    } finally {
      if (ownsBudget) budget.dispose();
    }
  };
  if (options.model || options.forceFresh) return produce();
  return choiceCache.getOrSet(key, produce);
}
