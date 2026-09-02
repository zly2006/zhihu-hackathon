// Character Reflection Engine（V1.2 §5.3-5.5）
// 时机：仅每章 canonical 模拟 + World Reducer 之后运行一次（Batch）。
// 范围：仅对真正受影响的角色（事件参与者 / 关系变化 / 高重要度记忆）生成反思。
// 产物：CharacterReflection → 更新 privateState（信念/情绪趋势/reflectionIds）与目标优先级。
// 原则：反思私有（§5.5 不泄漏）；失败 fail-open（不阻断章节，不修改 canonical）；
//       Prompt 不无限增长（既往反思只取最近 2 条摘要）。
import { randomUUID } from "node:crypto";
import { callGameModel } from "../llm";
import type { CharacterMemory } from "../domain/memory";
import type { SimulationEvent } from "../domain/simulation";
import type { WorldState } from "../domain/world";
import {
  EMOTIONAL_TRENDS,
  type CharacterReflection,
  type EmotionalTrend,
  type ReflectionBatchContext,
  type ReflectionGoalPressure,
} from "../domain/reflection";
import { validateWorldState } from "../domain/validate";

export const MAX_CANDIDATES = 4;
export const MAX_PRIOR_REFLECTIONS_PER_CHARACTER = 2;
export const MAX_BELIEFS = 8;
export const MAX_REFLECTION_IDS = 12;
export const MEMORY_IMPORTANCE_THRESHOLD = 70;
export const GOAL_PRESSURE_LIMIT = 30;

export type ReflectionCandidate = {
  characterId: string;
  score: number;
  reasons: string[];
};

// ---- 候选人选择（纯函数）----
export function collectReflectionCandidates(args: {
  worldBefore: WorldState;
  events: SimulationEvent[];
  newMemories: CharacterMemory[];
}): ReflectionCandidate[] {
  const { worldBefore, events, newMemories } = args;
  const affected = new Map<string, { score: number; reasons: string[] }>();

  const bump = (characterId: string, score: number, reason: string) => {
    const entry = affected.get(characterId) ?? { score: 0, reasons: [] };
    entry.score += score;
    if (entry.reasons.length < 3) entry.reasons.push(reason);
    affected.set(characterId, entry);
  };

  for (const event of events) {
    for (const participantId of event.participantIds) {
      bump(participantId, 2, `参与事件「${event.title.slice(0, 20)}」`);
    }
    for (const change of event.relationshipChanges) {
      const relationship = worldBefore.relationships[change.relationshipId];
      if (!relationship) continue;
      for (const characterId of [relationship.characterAId, relationship.characterBId]) {
        bump(characterId, 2, `关系变化：${change.description.slice(0, 20)}`);
      }
    }
  }
  for (const memory of newMemories) {
    if (memory.importance >= MEMORY_IMPORTANCE_THRESHOLD) {
      bump(memory.characterId, 1, "本章高重要度记忆");
    }
  }

  const candidates: ReflectionCandidate[] = [];
  for (const [characterId, entry] of affected) {
    const character = worldBefore.characters[characterId];
    // 仅对拥有隐藏状态的角色反思（主角无 privateState 时自然排除）
    if (!character?.privateState) continue;
    candidates.push({ characterId, score: entry.score, reasons: entry.reasons });
  }
  return candidates
    .sort((a, b) => b.score - a.score || a.characterId.localeCompare(b.characterId))
    .slice(0, MAX_CANDIDATES);
}

// ---- 上下文组装（含 Prompt 防膨胀截断）----
export function buildReflectionContext(args: {
  chapterId: string;
  year: number;
  worldBefore: WorldState;
  worldAfter: WorldState;
  events: SimulationEvent[];
}): { candidates: ReflectionCandidate[]; context: ReflectionBatchContext | null } {
  const { chapterId, year, worldBefore, worldAfter, events } = args;
  const candidates = collectReflectionCandidates({
    worldBefore,
    events,
    newMemories: Object.values(worldAfter.memories).filter(
      (memory) => !worldBefore.memories[memory.id],
    ),
  });
  if (candidates.length === 0) return { candidates, context: null };

  const chapterDigest = events
    .map((event) => {
      const names = event.participantIds
        .map((id) => worldBefore.characters[id]?.identity.name ?? "某人")
        .join("、");
      return `${event.year}：${event.title}（${names}）——${event.summary}`;
    })
    .join("\n")
    .slice(0, 1600);

  const characters: ReflectionBatchContext["characters"] = {};
  for (const candidate of candidates) {
    const character = worldAfter.characters[candidate.characterId];
    if (!character) continue;
    characters[candidate.characterId] = {
      name: character.identity.name,
      age: character.state.age,
      personalityTraits: character.core.personalityTraits.slice(0, 5),
      privateState: {
        hiddenGoals: character.privateState?.hiddenGoals ?? [],
        hiddenConcerns: character.privateState?.hiddenConcerns ?? [],
        privateBeliefs: character.privateState?.privateBeliefs ?? [],
        currentEmotionalTrend: character.privateState?.currentEmotionalTrend,
      },
      currentGoals: character.state.currentGoals.map((goal) => ({
        id: goal.id,
        label: goal.label,
        priority: goal.priority,
        status: goal.status,
      })),
    };
  }

  // 既往反思摘要：每人只取最近 2 条，单条截断 60 字（§5.6 Prompt 不无限增长）
  const priorReflectionDigest: ReflectionBatchContext["priorReflectionDigest"] = {};
  const prior = Object.values(worldBefore.reflections ?? {});
  for (const candidate of candidates) {
    const mine = prior.filter((reflection) => reflection.characterId === candidate.characterId);
    priorReflectionDigest[candidate.characterId] = mine
      .slice(-MAX_PRIOR_REFLECTIONS_PER_CHARACTER)
      .map((reflection) => `${reflection.insight.slice(0, 60)}（趋势 ${reflection.emotionalTrend}）`)
      .join("；");
  }

  return {
    candidates,
    context: {
      chapterId,
      year,
      candidateIds: candidates.map((candidate) => candidate.characterId),
      characters,
      chapterDigest,
      allowedMemoryIds: Object.keys(worldAfter.memories),
      priorReflectionDigest,
    },
  };
}

// ---- Director 风格 Prompt（硬约束程序追加）----
const REFLECTION_SYSTEM = [
  "你是互动人生小说的角色心理分析师。",
  "你的任务：基于本章已经确定发生的事件（canonical），为真正受到影响的角色生成一段私有的心理反思。",
  "反思解释“这个角色因为这一章发生了什么内心变化”，而不是编造新事实。",
  "只输出严格 JSON，不写 Markdown，不输出 JSON 之外的任何文字。",
].join("\n");

export function buildReflectionPrompt(context: ReflectionBatchContext, previousErrors?: string[]): string {
  const characterCards = context.candidateIds
    .map((characterId) => {
      const character = context.characters[characterId];
      if (!character) return "";
      const prior = context.priorReflectionDigest[characterId];
      return [
        `## ${characterId}｜${character.name}（${character.age} 岁）`,
        `性格：${character.personalityTraits.join("、") || "未设定"}`,
        `当前目标：${character.currentGoals.map((goal) => `${goal.id}:${goal.label}(${goal.priority},${goal.status})`).join("；") || "（无）"}`,
        `隐藏目标：${character.privateState.hiddenGoals.join("；") || "（无）"}`,
        `隐藏担忧：${character.privateState.hiddenConcerns.join("；") || "（无）"}`,
        `私密信念：${character.privateState.privateBeliefs.join("；") || "（无）"}`,
        character.privateState.currentEmotionalTrend ? `当前情绪趋势：${character.privateState.currentEmotionalTrend}` : "",
        prior ? `既往反思摘要：${prior}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const hardConstraints = [
    "# 硬约束（程序生成，逐条必须满足）",
    `1. 只能为下列角色生成反思：${context.candidateIds.join(", ")}。每个角色最多一条。`,
    `2. basedOnMemoryIds 只能引用下列记忆 id：${context.allowedMemoryIds.join(", ") || "（无，必须为 []）"}。`,
    `3. goalPressure 只能引用该角色"当前目标"里列出的 goalId，且只允许调整 status 为 active 的目标；direction 只能是 increase/decrease；amount 为 1-30 的整数。`,
    `4. emotionalTrend 只能是：${EMOTIONAL_TRENDS.join("|")}。`,
    `5. beliefChanges 必须由本章事件支撑（topic 与本章 digest 相关），不得凭空发明重大事实（婚姻/死亡/怀孕/裁员/大病等）。`,
    `6. 不得重置角色人格；反思是演化，不是换人。`,
    `7. 反思内容是私有的：不进入玩家可见字段，不得写入任何公开字段。`,
    `8. 已解决的目标/Hook 不得再当作未解决处理。`,
    `9. insight 不超过 80 字；每个 beliefChange 的 strength 为 0-100。`,
  ].join("\n");

  const outputSpec = [
    "# 输出 JSON（只输出 JSON）",
    JSON.stringify({
      reflections: [
        {
          characterId: "角色 id",
          basedOnMemoryIds: ["记忆 id"],
          insight: "这个角色本章后的内心变化（一句）",
          beliefChanges: [{ topic: "信念主题", from: "原信念（可空）", to: "新信念", strength: 60 }],
          goalPressure: [{ goalId: "目标 id", direction: "increase", amount: 10, reason: "变化原因" }],
          emotionalTrend: "hopeful",
        },
      ],
    }),
  ].join("\n");

  const sections = [
    `# 本章摘要（canonical）`,
    context.chapterDigest || "（无事件）",
    "",
    "# 候选角色",
    characterCards,
    "",
  ];
  if (previousErrors?.length) {
    sections.push(
      "# 上一轮校验失败项（必须全部修复）",
      previousErrors.map((error) => `- ${error}`).join("\n"),
      "",
    );
  }
  sections.push(hardConstraints, outputSpec);
  return sections.join("\n");
}

// ---- 解析 + 校验 ----
type ModelReflection = {
  characterId?: unknown;
  basedOnMemoryIds?: unknown;
  insight?: unknown;
  beliefChanges?: unknown;
  goalPressure?: unknown;
  emotionalTrend?: unknown;
};

export function parseReflections(
  modeled: { reflections?: unknown },
  context: ReflectionBatchContext,
  newId: () => string = randomUUID,
): CharacterReflection[] {
  if (!Array.isArray(modeled?.reflections)) {
    throw new Error("大模型返回缺少 reflections 数组");
  }
  const reflections: CharacterReflection[] = [];
  const seen = new Set<string>();
  for (const raw of modeled.reflections.slice(0, MAX_CANDIDATES)) {
    const item = (raw ?? {}) as ModelReflection;
    const characterId = typeof item.characterId === "string" ? item.characterId : "";
    if (!context.candidateIds.includes(characterId)) {
      throw new Error(`reflection.characterId 非法：${characterId || "（空）"}`);
    }
    if (seen.has(characterId)) throw new Error(`角色 ${characterId} 出现多条反思`);
    seen.add(characterId);

    const basedOnMemoryIds = Array.isArray(item.basedOnMemoryIds)
      ? item.basedOnMemoryIds.map((value) => String(value))
      : [];
    for (const memoryId of basedOnMemoryIds) {
      if (!context.allowedMemoryIds.includes(memoryId)) {
        throw new Error(`basedOnMemoryIds 引用不存在记忆：${memoryId}`);
      }
    }

    const character = context.characters[characterId];
    const activeGoalIds = new Set(character.currentGoals.filter((goal) => goal.status === "active").map((goal) => goal.id));
    const goalPressure: ReflectionGoalPressure[] = Array.isArray(item.goalPressure)
      ? item.goalPressure.slice(0, 4).map((pressure) => {
          const raw = (pressure ?? {}) as Record<string, unknown>;
          const goalId = String(raw.goalId ?? "");
          if (!activeGoalIds.has(goalId)) throw new Error(`goalPressure 引用非 active 目标：${goalId}`);
          const direction = raw.direction === "decrease" ? "decrease" : "increase";
          const amount = Math.max(1, Math.min(GOAL_PRESSURE_LIMIT, Number(raw.amount) || 0));
          const reason = typeof raw.reason === "string" ? raw.reason.slice(0, 100) : "";
          return { goalId, direction, amount, reason };
        })
      : [];

    const beliefChanges = Array.isArray(item.beliefChanges)
      ? item.beliefChanges.slice(0, 3).map((change) => {
          const raw = (change ?? {}) as Record<string, unknown>;
          return {
            topic: typeof raw.topic === "string" ? raw.topic.slice(0, 60) : "",
            from: typeof raw.from === "string" && raw.from.trim() ? raw.from.slice(0, 60) : undefined,
            to: typeof raw.to === "string" ? raw.to.slice(0, 80) : "",
            strength: Math.max(0, Math.min(100, Number(raw.strength) || 0)),
          };
        })
      : [];
    for (const change of beliefChanges) {
      if (!change.topic || !change.to) throw new Error("beliefChanges 必须含 topic 与 to");
    }

    const emotionalTrend = item.emotionalTrend as EmotionalTrend;
    if (!EMOTIONAL_TRENDS.includes(emotionalTrend)) {
      throw new Error(`emotionalTrend 非法：${String(item.emotionalTrend)}`);
    }

    reflections.push({
      id: `reflection-${newId()}`,
      characterId,
      chapterId: context.chapterId,
      year: context.year,
      basedOnMemoryIds,
      insight: typeof item.insight === "string" ? item.insight.trim().slice(0, 160) : "",
      beliefChanges,
      goalPressure,
      emotionalTrend,
      private: true,
    });
  }
  if (reflections.length === 0) throw new Error("反思数组为空");
  return reflections;
}

// ---- 应用反思（不可变更新）----
export function applyReflections(
  worldAfter: WorldState,
  reflections: CharacterReflection[],
  now = new Date().toISOString(),
): WorldState {
  const characters = { ...worldAfter.characters };
  const reflectionsMap = { ...(worldAfter.reflections ?? {}) };

  for (const reflection of reflections) {
    const character = characters[reflection.characterId];
    if (!character) continue;

    const pressureById = new Map(reflection.goalPressure.map((pressure) => [pressure.goalId, pressure]));
    const currentGoals = character.state.currentGoals.map((goal) => {
      const pressure = pressureById.get(goal.id);
      if (!pressure || goal.status !== "active") return goal;
      const delta = pressure.direction === "increase" ? pressure.amount : -pressure.amount;
      const priority = Math.max(0, Math.min(100, goal.priority + delta));
      return { ...goal, priority };
    });

    const privateState = character.privateState
      ? {
          hiddenGoals: character.privateState.hiddenGoals,
          hiddenConcerns: character.privateState.hiddenConcerns,
          privateBeliefs: [
            ...character.privateState.privateBeliefs,
            ...reflection.beliefChanges.map((change) => change.to),
          ].slice(-MAX_BELIEFS),
          currentEmotionalTrend: reflection.emotionalTrend,
          reflectionIds: Array.from(
            new Set([...(character.privateState.reflectionIds ?? []), reflection.id]),
          ).slice(-MAX_REFLECTION_IDS),
        }
      : undefined;

    characters[reflection.characterId] = {
      ...character,
      state: { ...character.state, currentGoals },
      privateState,
      updatedAt: now,
    };
    reflectionsMap[reflection.id] = reflection;
  }

  const next: WorldState = { ...worldAfter, characters, reflections: reflectionsMap, updatedAt: now };
  validateWorldState(next);
  return next;
}

// ---- 编排（fail-open）----
export type ReflectionBatchResult = {
  reflections: CharacterReflection[];
  applied: boolean;
  metrics: { candidateCount: number; attempts: number; error?: string };
};

export async function runReflectionBatch(args: {
  chapterId: string;
  year: number;
  worldBefore: WorldState;
  worldAfter: WorldState;
  events: SimulationEvent[];
}): Promise<ReflectionBatchResult> {
  const { candidates, context } = buildReflectionContext(args);
  if (!context) {
    return { reflections: [], applied: false, metrics: { candidateCount: 0, attempts: 0 } };
  }

  let previousErrors: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const modeled = await callGameModel<{ reflections?: unknown }>(
        "character-reflection",
        REFLECTION_SYSTEM,
        buildReflectionPrompt(context, previousErrors),
        { maxTokens: 3000, timeoutMs: 180_000 },
      );
      const reflections = parseReflections(modeled, context);
      return {
        reflections,
        applied: true,
        metrics: { candidateCount: candidates.length, attempts: attempt },
      };
    } catch (error) {
      previousErrors = [error instanceof Error ? error.message : String(error)];
      console.warn(`reflection batch attempt ${attempt} failed:`, previousErrors[0]);
    }
  }
  // fail-open：反思失败不阻断章节、不修改 canonical
  return {
    reflections: [],
    applied: false,
    metrics: {
      candidateCount: candidates.length,
      attempts: 2,
      error: previousErrors[0] ?? "未知错误",
    },
  };
}
