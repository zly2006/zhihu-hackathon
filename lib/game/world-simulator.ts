// World Simulator（Phase 4）
// 不写小说，只决定这一章发生什么。输入结构化世界状态 + 决策 + 结果锚点 + 知乎证据，
// 输出结构化 WorldSimulationOutput（SimulationEvent[] + 记忆 + 目标/Hook/线程更新）。
// 职责边界（方案 §17.2.3）：程序只确定 effectiveRisk / outcomeAnchor / uncertaintySeed，
// World Simulator 负责把结果锚点解释成一组合理的事件与状态变化。
//
// 关键设计：模型只引用短别名（C1/R1/E1/T1/G1/H1/I1），服务端负责映射回真实 id，
// 避免模型抄写/截断长 UUID 导致的引用失效。

import { randomUUID } from "node:crypto";
import { callGameModel } from "../llm";
import type { ModelProgress } from "../llm";
import type { ExecutionBudget } from "./execution-budget";
import { applyReferenceRepair, hashSimulationCandidate, type ReferenceRepair } from "./simulation-reference-repair";
import type { ChapterSpan, LifeDomain } from "../domain/shared";
import type { Character } from "../domain/character";
import type { CharacterMemory } from "../domain/memory";
import type { Relationship } from "../domain/relationship";
import type { StoryThread } from "../domain/world";
import type {
  SimulationEvent,
  WorldSimulationInput,
  WorldSimulationOutput,
} from "../domain/simulation";
import type { LifeExperience } from "../domain/experience";
import type { NpcAgentDirective } from "../domain/npc-agent";

// ---- 模型原始输出（服务器负责补齐 id 与引用） ----

type ModelEvent = Record<string, unknown>;
export type ModelSimulation = {
  events?: unknown;
  newMemories?: unknown;
  goalUpdates?: unknown;
  hookUpdates?: unknown;
  threadUpdates?: unknown;
  chapterSummary?: unknown;
};

export class SimulationReferenceError extends Error {
  readonly category = "reference" as const;
  readonly retryable = true;
  candidate?: ModelSimulation;
  readonly field: string;
  readonly alias: string;

  constructor(field: string, alias: string) {
    super(`${field} 引用了未知别名 ${alias}，只能使用给定别名`);
    this.name = "SimulationReferenceError";
    this.field = field;
    this.alias = alias;
  }
}

export type WorldSimulatorModel = (
  purpose: string,
  system: string,
  prompt: string,
  options?: {
    maxTokens?: number;
    timeoutMs?: number;
    responseFormat?: "json" | "text";
    signal?: AbortSignal;
    deadlineAt?: number;
    requestId?: string;
    executionId?: string;
    attempt?: number;
  },
) => Promise<ModelSimulation>;

const VALID_DOMAINS: LifeDomain[] = [
  "education", "career", "finance", "housing", "relocation", "entrepreneurship",
  "romance", "marriage", "family", "parenting", "friendship", "health", "social", "loss", "aging",
];
const VALID_MEMORY_TYPES = ["event", "relationship", "achievement", "setback", "promise", "conflict", "reflection"];

function requireText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`大模型返回字段 ${field} 缺失`);
  return value.trim().slice(0, maximum);
}

// 可选数组：字段缺失或非数组时返回空数组，不抛错（模型可省略无变化的字段）
function optionalStringArray(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maximum);
}

function requireNumber(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`大模型返回字段 ${field} 必须是 ${min} 到 ${max} 的数字`);
  }
  return value;
}

// ---- 别名映射（避免模型抄写长 UUID） ----

type AliasMaps = {
  character: Record<string, string>; // 别名 -> 真实 id
  relationship: Record<string, string>;
  evidence: Record<string, string>;
  thread: Record<string, string>;
  goal: Record<string, string>;
  hook: Record<string, string>;
  issue: Record<string, string>;
};

function assignAliases(ids: string[], prefix: string): Record<string, string> {
  const map: Record<string, string> = {};
  ids.forEach((id, index) => {
    map[`${prefix}${index + 1}`] = id;
  });
  return map;
}

function reverseAlias(map: Record<string, string>, id: string, prefix: string): string {
  const entry = Object.entries(map).find(([, value]) => value === id);
  return entry ? entry[0] : `${prefix}?`;
}

function buildAliasMaps(input: WorldSimulationInput) {
  const characterIds = [
    input.protagonistId,
    ...input.characters.filter((c) => c.id !== input.protagonistId).map((c) => c.id),
  ];
  const relationshipIds = input.relationships.map((r) => r.id);
  const evidenceIds = [
    ...input.evidenceBundle.backgroundSimilar,
    ...input.evidenceBundle.decisionSimilar,
    ...input.evidenceBundle.relationshipRelevant,
    ...input.evidenceBundle.outcomeContrasts,
  ].map((e) => e.id);
  const threadIds = input.openThreads.map((t) => t.id);
  const goalIds = input.characters.flatMap((c) => c.state.currentGoals.map((g) => g.id));
  const hookIds = input.characters.flatMap((c) => c.core.hooks.map((h) => h.id));
  const issueIds = input.relationships.flatMap((r) => r.unresolvedIssues.map((i) => i.id));

  const maps: AliasMaps = {
    character: assignAliases(characterIds, "C"),
    relationship: assignAliases(relationshipIds, "R"),
    evidence: assignAliases(evidenceIds, "E"),
    thread: assignAliases(threadIds, "T"),
    goal: assignAliases(goalIds, "G"),
    hook: assignAliases(hookIds, "H"),
    issue: assignAliases(issueIds, "I"),
  };

  const characterById = (id: string) => input.characters.find((c) => c.id === id);

  return {
    maps,
    charAlias: (id: string) => reverseAlias(maps.character, id, "C"),
    relAlias: (id: string) => reverseAlias(maps.relationship, id, "R"),
    threadAlias: (id: string) => reverseAlias(maps.thread, id, "T"),
    goalAlias: (id: string) => reverseAlias(maps.goal, id, "G"),
    hookAlias: (id: string) => reverseAlias(maps.hook, id, "H"),
    issueAlias: (id: string) => reverseAlias(maps.issue, id, "I"),
    characterById,
  };
}

function resolveAlias(alias: string, map: Record<string, string>, field: string): string {
  const id = map[alias];
  if (!id) throw new SimulationReferenceError(field, alias);
  return id;
}

function normalizeAlias(value: unknown, map: Record<string, string>, labels: Array<[string, string]>): unknown {
  if (typeof value !== "string") return value;
  if (map[value]) return value;
  const direct = Object.entries(map).find(([, id]) => id === value)?.[0];
  if (direct) return direct;
  const matchingLabels = labels.filter(([label]) => label === value).map(([, alias]) => alias);
  return matchingLabels.length === 1 ? matchingLabels[0] : value;
}

function normalizeAliasArray(value: unknown, map: Record<string, string>, labels: Array<[string, string]>): unknown {
  return Array.isArray(value) ? value.map((item) => normalizeAlias(item, map, labels)) : value;
}

type CandidateThreadAlias = {
  alias: string;
  label: string;
};

type CandidateThreadGroup = {
  label: string;
  eventCreateCount: number;
  detailCreateCount: number;
};

function candidateThreadAliases(modeled: ModelSimulation): {
  entries: CandidateThreadAlias[];
  uniqueByLabel: Map<string, string>;
} {
  const groups = new Map<string, CandidateThreadGroup>();
  const add = (value: unknown, source: "event" | "detail") => {
    if (typeof value !== "string" || !value.trim()) return;
    const label = value.trim();
    const group = groups.get(label) ?? { label, eventCreateCount: 0, detailCreateCount: 0 };
    if (source === "event") group.eventCreateCount += 1;
    else group.detailCreateCount += 1;
    groups.set(label, group);
  };

  if (Array.isArray(modeled.events)) {
    for (const rawEvent of modeled.events) {
      const event = (rawEvent ?? {}) as Record<string, unknown>;
      for (const label of optionalStringArray(event.createsThreadLabels, 3)) add(label, "event");
    }
  }
  const threadUpdates = (modeled.threadUpdates ?? {}) as Record<string, unknown>;
  if (Array.isArray(threadUpdates.create)) {
    for (const rawThread of threadUpdates.create) {
      const thread = (rawThread ?? {}) as Record<string, unknown>;
      add(thread.label, "detail");
    }
  }

  const entries: CandidateThreadAlias[] = [];
  const uniqueByLabel = new Map<string, string>();
  for (const group of groups.values()) {
    // The compact event field and one detailed declaration are two views of
    // the same newly-created thread. Repeated declarations in either source
    // remain ambiguous and must not be guessed into a reference.
    if (group.eventCreateCount > 1 || group.detailCreateCount > 1) continue;
    const alias = `N${entries.length + 1}`;
    entries.push({ alias, label: group.label });
    uniqueByLabel.set(group.label, alias);
  }
  return { entries, uniqueByLabel };
}

function normalizeThreadReference(
  value: unknown,
  map: Record<string, string>,
  labels: Array<[string, string]>,
  candidateAliases: ReturnType<typeof candidateThreadAliases>,
): unknown {
  if (typeof value !== "string") return value;
  if (map[value]) return value;
  const direct = Object.entries(map).find(([, id]) => id === value)?.[0];
  if (direct) return direct;
  const existing = labels.filter(([label]) => label === value).map(([, alias]) => alias);
  const created = candidateAliases.uniqueByLabel.get(value);
  // A label is only a valid temporary reference when it matches exactly one
  // new thread in this candidate and does not collide with an existing label.
  if (created && existing.length === 0) return created;
  if (!created && existing.length === 1) return existing[0];
  return value;
}

function normalizeThreadAliasArray(
  value: unknown,
  map: Record<string, string>,
  labels: Array<[string, string]>,
  candidateAliases: ReturnType<typeof candidateThreadAliases>,
): unknown {
  return Array.isArray(value)
    ? value.map((item) => normalizeThreadReference(item, map, labels, candidateAliases))
    : value;
}

/** Deterministic normalization only converts exact IDs/labels to the supplied short alias. */
export function normalizeSimulationCandidateReferences(
  modeled: ModelSimulation,
  input: WorldSimulationInput,
): ModelSimulation {
  const { maps } = buildAliasMaps(input);
  const candidateAliases = candidateThreadAliases(modeled);
  const labels = {
    character: input.characters.flatMap((character) => [
      [character.id, reverseAlias(maps.character, character.id, "C")] as [string, string],
      [character.identity.name, reverseAlias(maps.character, character.id, "C")] as [string, string],
    ]),
    thread: input.openThreads.flatMap((thread) => [
      [thread.id, reverseAlias(maps.thread, thread.id, "T")] as [string, string],
      [thread.label, reverseAlias(maps.thread, thread.id, "T")] as [string, string],
    ]),
    goal: input.characters.flatMap((character) => character.state.currentGoals.flatMap((goal) => [
      [goal.id, reverseAlias(maps.goal, goal.id, "G")] as [string, string],
      [goal.label, reverseAlias(maps.goal, goal.id, "G")] as [string, string],
    ])),
    hook: input.characters.flatMap((character) => character.core.hooks.flatMap((hook) => [
      [hook.id, reverseAlias(maps.hook, hook.id, "H")] as [string, string],
      [hook.label, reverseAlias(maps.hook, hook.id, "H")] as [string, string],
    ])),
    issue: input.relationships.flatMap((relationship) => relationship.unresolvedIssues.flatMap((issue) => [
      [issue.id, reverseAlias(maps.issue, issue.id, "I")] as [string, string],
      [issue.description, reverseAlias(maps.issue, issue.id, "I")] as [string, string],
    ])),
    relationship: input.relationships.map((relationship) => [relationship.id, reverseAlias(maps.relationship, relationship.id, "R")] as [string, string]),
    evidence: [
      ...input.evidenceBundle.backgroundSimilar,
      ...input.evidenceBundle.decisionSimilar,
      ...input.evidenceBundle.relationshipRelevant,
      ...input.evidenceBundle.outcomeContrasts,
    ].map((experience) => [experience.id, reverseAlias(maps.evidence, experience.id, "E")] as [string, string]),
  };
  const next = JSON.parse(JSON.stringify(modeled)) as ModelSimulation;
  const events = Array.isArray(next.events) ? next.events : [];
  events.forEach((rawEvent) => {
    const event = (rawEvent ?? {}) as Record<string, unknown>;
    event.participantIds = normalizeAliasArray(event.participantIds, maps.character, labels.character);
    event.evidenceIds = normalizeAliasArray(event.evidenceIds, maps.evidence, labels.evidence);
    event.resolvesThreadIds = normalizeThreadAliasArray(event.resolvesThreadIds, maps.thread, labels.thread, candidateAliases);
    if (Array.isArray(event.causes)) {
      event.causes = event.causes.map((rawCause) => {
        const cause = (rawCause ?? {}) as Record<string, unknown>;
        const normalizedThreadRef = normalizeThreadReference(cause.refId, maps.thread, labels.thread, candidateAliases);
        return {
          ...cause,
          ...(cause.refId !== undefined
            ? {
                refId: normalizedThreadRef === cause.refId
                  ? normalizeAlias(cause.refId, { ...maps.character, ...maps.thread, ...maps.goal, ...maps.hook, ...maps.issue, ...maps.relationship, ...Object.fromEntries(candidateAliases.entries.map((entry) => [entry.alias, entry.alias])) }, [])
                  : normalizedThreadRef,
              }
            : {}),
        };
      });
    }
    if (Array.isArray(event.characterChanges)) {
      event.characterChanges = event.characterChanges.map((rawChange) => {
        const change = (rawChange ?? {}) as Record<string, unknown>;
        return {
          ...change,
          ...(change.characterId !== undefined ? { characterId: normalizeAlias(change.characterId, maps.character, labels.character) } : {}),
          ...(change.resolveGoalIds !== undefined ? { resolveGoalIds: normalizeAliasArray(change.resolveGoalIds, maps.goal, labels.goal) } : {}),
        };
      });
    }
    if (Array.isArray(event.relationshipChanges)) {
      event.relationshipChanges = event.relationshipChanges.map((rawChange) => {
        const change = (rawChange ?? {}) as Record<string, unknown>;
        return {
          ...change,
          ...(change.relationshipId !== undefined ? { relationshipId: normalizeAlias(change.relationshipId, maps.relationship, labels.relationship) } : {}),
          ...(change.resolveIssueId !== undefined ? { resolveIssueId: normalizeAlias(change.resolveIssueId, maps.issue, labels.issue) } : {}),
        };
      });
    }
  });
  if (Array.isArray(next.newMemories)) {
    next.newMemories = next.newMemories.map((rawMemory) => {
      const memory = (rawMemory ?? {}) as Record<string, unknown>;
      return {
        ...memory,
        ...(memory.characterId !== undefined ? { characterId: normalizeAlias(memory.characterId, maps.character, labels.character) } : {}),
        ...(memory.relatedCharacterIds !== undefined ? { relatedCharacterIds: normalizeAliasArray(memory.relatedCharacterIds, maps.character, labels.character) } : {}),
      };
    });
  }
  if (Array.isArray(next.goalUpdates)) {
    next.goalUpdates = next.goalUpdates.map((rawUpdate) => ({
      ...(rawUpdate as Record<string, unknown>),
      ...((rawUpdate as Record<string, unknown>)?.characterId !== undefined ? { characterId: normalizeAlias((rawUpdate as Record<string, unknown>).characterId, maps.character, labels.character) } : {}),
    }));
  }
  if (Array.isArray(next.hookUpdates)) {
    next.hookUpdates = next.hookUpdates.map((rawUpdate) => {
      const update = (rawUpdate ?? {}) as Record<string, unknown>;
      return {
        ...update,
        ...(update.characterId !== undefined ? { characterId: normalizeAlias(update.characterId, maps.character, labels.character) } : {}),
        ...(update.resolveHookIds !== undefined ? { resolveHookIds: normalizeAliasArray(update.resolveHookIds, maps.hook, labels.hook) } : {}),
      };
    });
  }
  const threadUpdates = (next.threadUpdates ?? {}) as Record<string, unknown>;
  threadUpdates.resolveIds = normalizeThreadAliasArray(threadUpdates.resolveIds, maps.thread, labels.thread, candidateAliases);
  threadUpdates.dormantIds = normalizeThreadAliasArray(threadUpdates.dormantIds, maps.thread, labels.thread, candidateAliases);
  if (Array.isArray(threadUpdates.create)) {
    threadUpdates.create = threadUpdates.create.map((rawThread) => {
      const thread = (rawThread ?? {}) as Record<string, unknown>;
      return { ...thread, ...(thread.relatedCharacterIds !== undefined ? { relatedCharacterIds: normalizeAliasArray(thread.relatedCharacterIds, maps.character, labels.character) } : {}) };
    });
  }
  next.threadUpdates = threadUpdates;
  return next;
}

// ---- Prompt 组装 ----

function describeRelationship(rel: Relationship, alias: string, characterById: (id: string) => Character | undefined, issueAlias: (id: string) => string): string {
  const a = characterById(rel.characterAId);
  const b = characterById(rel.characterBId);
  const issues = rel.unresolvedIssues.map((i) => `${i.description}（${issueAlias(i.id)}）`).join("、") || "无";
  return `【${alias}】${a?.identity.name ?? "?"}↔${b?.identity.name ?? "?"}（${rel.type}）：亲密${rel.scores.closeness}，信任${rel.scores.trust}，冲突${rel.scores.conflict}，承诺${rel.scores.commitment}；未解决：${issues}`;
}

function describeEvidence(experiences: LifeExperience[], evidenceToAlias: Record<string, string>): string {
  if (!experiences.length) return "（无召回证据）";
  return experiences
    .map((exp) => {
      const outcome = exp.outcomes.shortTerm[0]?.description ?? "";
      return `${reverseAlias(evidenceToAlias, exp.id, "E")}. ${exp.source.title}｜背景:${exp.situation.trigger.slice(0, 60)}｜行动:${exp.decision.action.slice(0, 60)}｜结果:${outcome.slice(0, 60)}`;
    })
    .join("\n");
}

function describeNpcAgentDirectives(
  directives: NpcAgentDirective[] | undefined,
  charAlias: (id: string) => string,
  relAlias: (id: string) => string,
  goalAlias: (id: string) => string,
): string {
  if (!directives?.length) return "（本章没有满足条件的 NPC Agent 自主驱动）";
  return [
    "# V3.1 NPC Agent（本章一次，非后台常驻）",
    "以下驱动由程序根据 NPC 当前状态预先整理，仅用于本章世界推演。每条驱动最多落为一个自主事件，也可以合并到已有事件；NPC Agent 不直接修改 WorldState。",
    ...directives.map((directive) => {
      const targets = directive.targetCharacterIds.map(charAlias).join("、") || "无指定对象";
      const relationships = directive.relationshipIds.map(relAlias).join("、") || "无关系引用";
      const goals = directive.sourceGoalIds.map(goalAlias).join("、") || "无可公开目标引用（可用 npc_goal 但不得伪造 goal refId）";
      return [
        `- ${directive.id}｜角色 ${charAlias(directive.characterId)}｜行动 ${directive.action}｜紧迫度 ${directive.urgency}`,
        `  目标角色：${targets}；关系：${relationships}；当前目标：${goals}`,
        `  服务端私有行动意图（只能通过可观察行为体现，不得原文写入主角知情内容）：${directive.privateIntent}`,
      ].join("\n");
    }),
  ].join("\n");
}

const SIMULATOR_SYSTEM =
  "你是中文互动人生小说的世界模拟器。只输出严格 JSON，不写 Markdown。你不是在写小说，而是在决定这一章结构化发生什么。你只能改变程序允许的 delta，不能改写已经发生的历史事实。知乎证据只是个案参考，不代表同样行动必然成功。NPC 是独立的人，不会为了服务主角而自动服从。禁止在未来年份伪造真实政策、公司、价格或名人的行为。引用任何人物、关系、证据、线索、目标、Hook、矛盾时，只能使用程序给出的短别名（如 C1、R1、E3、T1、G1、H1、I1），绝不使用长字符串 id。";

export function buildSimulatorPrompt(input: WorldSimulationInput): string {
  const { chapter, decision, resolution, evidenceBundle } = input;
  const { maps, charAlias, relAlias, threadAlias, goalAlias, hookAlias, issueAlias, characterById } = buildAliasMaps(input);

  const characterLines = input.characters.map((c) => describeCharacterWithAlias(c, charAlias(c.id), goalAlias)).join("\n\n");
  const relationshipLines = input.relationships
    .map((rel) => describeRelationship(rel, relAlias(rel.id), characterById, issueAlias))
    .join("\n") || "无";
  const threadLines = input.openThreads
    .map((t) => `【${threadAlias(t.id)}】${t.label}：${t.description}（紧急度 ${t.urgency}）`)
    .join("\n") || "无";
  const memoryLines = input.relevantMemories
    .map((m) => `- ${m.year}年 ${m.type}：${m.summary}（重要度${m.importance}）`)
    .join("\n") || "无";
  const allEvidence = [
    ...evidenceBundle.backgroundSimilar,
    ...evidenceBundle.decisionSimilar,
    ...evidenceBundle.relationshipRelevant,
    ...evidenceBundle.outcomeContrasts,
  ];
  const evidenceLines = describeEvidence(allEvidence, maps.evidence);

  const characterIdList = Object.entries(maps.character)
    .map(([alias, id]) => `${alias}=${characterById(id)?.identity.name ?? "?"}`)
    .join("，");
  const relationshipIdList = Object.entries(maps.relationship)
    .map(([alias, id]) => {
      const rel = input.relationships.find((r) => r.id === id);
      const a = rel ? characterById(rel.characterAId)?.identity.name : "?";
      const b = rel ? characterById(rel.characterBId)?.identity.name : "?";
      return `${alias}=${a}↔${b}`;
    })
    .join("，");
  const evidenceIdList = Object.keys(maps.evidence).join("，") || "无";
  const threadIdList = Object.entries(maps.thread)
    .map(([alias, id]) => `${alias}=${input.openThreads.find((t) => t.id === id)?.label ?? "?"}`)
    .join("，") || "无";
  const temporaryThreadRule = [
    "本候选中新建线索的临时引用：按首次出现顺序从 N1 编号；同一标签若恰好在一次事件 createsThreadLabels 和一次 threadUpdates.create 中出现，视为同一条线索、只占一个 N#。同一来源重复声明仍属歧义，不得猜测引用。",
    "解析已有线索使用 T#；不能把任意自然语言标签、事件标题或不存在的线索当作 T#。如果没有可解析的已有线索，只省略 resolvesThreadIds/resolveIds/dormantIds 或写空数组。",
  ].join("\n");
  const goalIdList = Object.entries(maps.goal)
    .map(([alias, id]) => {
      const owner = input.characters.find((c) => c.state.currentGoals.some((g) => g.id === id));
      const goal = owner?.state.currentGoals.find((g) => g.id === id);
      return `${alias}=${owner?.identity.name ?? "?"}的「${goal?.label ?? "?"}」`;
    })
    .join("，") || "无";
  const hookIdList = Object.entries(maps.hook)
    .map(([alias, id]) => {
      const owner = input.characters.find((c) => c.core.hooks.some((h) => h.id === id));
      const hook = owner?.core.hooks.find((h) => h.id === id);
      return `${alias}=${owner?.identity.name ?? "?"}的「${hook?.label ?? "?"}」`;
    })
    .join("，") || "无";
  const issueIdList = Object.entries(maps.issue)
    .map(([alias, id]) => {
      const rel = input.relationships.find((r) => r.unresolvedIssues.some((i) => i.id === id));
      const issue = rel?.unresolvedIssues.find((i) => i.id === id);
      return `${alias}=${issue?.description ?? "?"}`;
    })
    .join("，") || "无";
  const protagonistGoalAliases = Array.from(new Set(
    (input.characters.find((character) => character.id === input.protagonistId)?.state.currentGoals ?? [])
      .map((goal) => reverseAlias(maps.goal, goal.id, "G")),
  ));
  const npcGoalAliases = Array.from(new Set(
    input.characters
      .filter((character) => character.id !== input.protagonistId)
      .flatMap((character) => character.state.currentGoals.map((goal) => reverseAlias(maps.goal, goal.id, "G"))),
  ));
  const npcGoalDirectiveRules = (input.npcAgentDirectives ?? [])
    .map((directive) => {
      const sourceGoalAliases = directive.sourceGoalIds
        .map((goalId) => reverseAlias(maps.goal, goalId, "G"))
        .filter((alias) => alias !== "G?");
      return `${directive.id}：refId 只能用 ${sourceGoalAliases.join("、") || "省略"}，participantIds 必须包含 ${charAlias(directive.characterId)}`;
    })
    .join("；") || "无可用 directive";
  const npcGoalReferenceBoundary = [
    `NPC Agent 引用边界：NPC 当前目标别名：${npcGoalAliases.join("、") || "无"}；禁止使用主角目标别名：${protagonistGoalAliases.join("、") || "无"}。`,
    `按 directive 匹配 npc_goal：${npcGoalDirectiveRules}。没有可公开 NPC 目标时省略 refId，但 participantIds 仍必须包含对应 NPC；不得把主角目标或其他 NPC 的 G# 当作当前 directive 的 refId。`,
  ].join("\n");

  const sections = [
    `# 本章信息`,
    `章节 ${chapter.id}，时间跨度 ${chapter.span} 年，从 ${chapter.startYear} 年到 ${chapter.endYear} 年。`,
    ``,
    `# 人物（含 NPC 隐藏状态，仅供你决定 NPC 自主行为，不得直接泄露给主角）`,
    characterLines,
    ``,
    `# 关系`,
    relationshipLines,
    ``,
    `# 未解决线索`,
    threadLines,
    ``,
    `# 相关记忆`,
    memoryLines,
    ``,
    `# 本章决策`,
    `标题：${decision.promptTitle}`,
    `处境：${decision.context}`,
    `玩家选择：${decision.selectedOptionId} —— ${decision.normalizedAction}`,
    ``,
    `# 结果锚点（由程序确定性计算，必须遵守）`,
    `有效风险 ${resolution.effectiveRisk}，结果锚点：${resolution.outcomeAnchor}`,
    resolution.outcomeAnchor === "favorable"
      ? "favorable = 顺遂：目标大体达成，但仍可存在代价和副作用，不是毫无代价的成功。"
      : resolution.outcomeAnchor === "mixed"
        ? "mixed = 有得有失：同时包含收益、代价与未解决问题，是最常见的结果。"
        : "setback = 受挫：主目标受挫，但必须保留现实可恢复性，不等于人生毁灭。",
    ``,
    describeNpcAgentDirectives(input.npcAgentDirectives, charAlias, relAlias, goalAlias),
    npcGoalReferenceBoundary,
    ``,
    `# 知乎现实参照（个案，非因果）`,
    evidenceLines,
    ``,
    `# 时代背景`,
    input.eraContext ? `${input.eraContext.title}：${input.eraContext.summary}` : "按常规当代社会背景处理，不得编造真实政策或事件。",
    ``,
    `# 合法引用别名（只能引用这些短别名，禁止使用长 id）`,
    `角色：${characterIdList}`,
    `关系：${relationshipIdList}`,
    `知乎证据：${evidenceIdList}`,
    `线索：${threadIdList}`,
    temporaryThreadRule,
    `目标：${goalIdList}`,
    `Hook：${hookIdList}`,
    `矛盾：${issueIdList}`,
  ];

  const hardConstraints = [
    `# 结构硬约束（必须逐项满足）`,
    `1. ${chapter.span} 年章节必须生成 ${chapter.span === 1 ? "2 到 4" : "4 到 8"} 个事件；importance≥70 的重大事件最多 2 个。`,
    `生成 JSON 后，逐个读取每个事件的 importance；本章最多 2 个重大事件（importance≥70）。${chapter.span === 3 ? "三年中的普通推进、日常影响和次要转折保留为事件，但必须按实际重要性标为 69 或以下，不能删除事件、篡改后果或把同一转折拆成多个重大事件来规避上限。" : "普通推进不要为了强调而抬成重大转折。"}`,
    `2. 每个事件的 year 必须在 ${chapter.startYear} 到 ${chapter.endYear} 之间；month 可选（1-12 或省略）。`,
    `3. 所有 id 引用只能使用上述短别名：participantIds/characterId 用 C#，relationshipId 用 R#，evidenceIds 用 E#，relatedCharacterIds 用 C#，解析已有线索的 resolvesThreadIds/resolveIds/dormantIds 用 T#；同一候选中新建线索只能用按创建顺序分配的 N#；resolveGoalIds 用 G#，resolveHookIds 用 H#，resolveIssueId 用 I#。`,
    `4. characterChanges 的 statDelta 只能是 cash/health/happiness/knowledge/connections/career/assets 的部分子集，每个是 -100 到 100 的有限数字；不要给每个事件都塞满 7 项。`,
    `5. relationshipChanges 的 scoreDelta 只能是 closeness/trust/conflict/commitment 的子集，每个绝对值 ≤ 20。`,
    `6. 关系类型变化（typeChange）必须发生在 importance≥60 的明显事件中。`,
    `7. 每章必须产生 3 到 6 条 newMemories，每条 year 在章节区间内、characterId 用 C#、importance 0-100、emotionalValence 取 -2/-1/0/1/2。`,
    `8. newMemories 的 type 只能是 event/relationship/achievement/setback/promise/conflict/reflection。`,
    `9. 可选字段（如 characterChanges、relationshipChanges、evidenceIds、causes、createsThreadLabels、resolvesThreadIds、goalUpdates、hookUpdates）在无变化时省略或给空数组 []。`,
    `10. 如果采用 V3.1 NPC Agent 驱动，事件原因可使用 npc_goal；refId 只能引用上述当前目标 G#，隐藏目标没有对应 G# 时省略 refId。每条 directive 在本章最多对应一个自主事件，不得把私有行动意图原文写进主角已知信息。`,
  ].join("\n");

  const worldRules = [
    `# 世界规则`,
    `1. 结果锚点必须体现：setback 不得偷改成全面成功，favorable 不得偷改成彻底失败，mixed 要真的有得有失。`,
    `2. NPC 独立：主角回武汉，伴侣不一定跟随；NPC 依据自己的目标、工作、城市、价值观和对关系的承诺选择留下、等待、妥协或离开。`,
    `3. 知乎证据是个案，不是因果：某个答主做了某事成功，不代表主角同样行动必然成功。`,
    `4. 不得凭空改变已经发生的事实（城市、职业、关系类型）；不得在未来年份伪造现实政策/公司/名人行为。`,
    `5. 事件之间要有因果与时间推进；不必让每章所有矛盾同时爆炸，优先推进 1-2 条线索，允许部分保留或转为 dormant。`,
    `6. 数值要现实：高回报伴随失败概率与代价；低风险选项不能同时多项高收益；各分支不因整齐而平均化。`,
  ].join("\n");

  const outputSpec = [
    `# 输出 JSON 格式（只输出 JSON）`,
    `{"events":[{"year":数字,"month":1到12或省略,"title":"16字内","summary":"120字内","domain":"${VALID_DOMAINS.join("|")}之一","participantIds":["C#"],"causes":[{"type":"player_choice|prior_event|relationship|npc_goal|era|other","refId":"C#、T#、N# 或省略","description":"原因"}],"characterChanges":[{"characterId":"C#","statDelta":{"cash":-8到8},"cityChange":{"from":"旧","to":"新"},"occupationChange":{"from":"旧","to":"新"},"socialIdentityChange":{"from":"旧","to":"新"},"resolveGoalIds":["G#"],"description":"变化描述"}],"relationshipChanges":[{"relationshipId":"R#","scoreDelta":{"conflict":-20到20},"typeChange":{"from":"friend","to":"partner"},"addIssue":"新增未解决矛盾","resolveIssueId":"I#","description":"变化描述"}],"evidenceIds":["E#"],"importance":0到100,"visibility":"known_to_protagonist|partially_known","createsThreadLabels":["新线索标签"],"resolvesThreadIds":["T# 或本候选 N#"]}],"newMemories":[{"characterId":"C#","year":数字,"type":"event","summary":"记忆摘要","relatedCharacterIds":["C#"],"domains":["${VALID_DOMAINS.join("|")}之一"],"importance":0到100,"emotionalValence":-2到2,"permanentFact":true或false}],"goalUpdates":[{"characterId":"C#","add":[{"label":"新目标","horizon":"short|medium|long","priority":0到100}]}],"hookUpdates":[{"characterId":"C#","add":[{"label":"新Hook","description":"描述"}],"resolveHookIds":["H#"]}],"threadUpdates":{"create":[{"label":"线索标签","description":"描述","domain":"${VALID_DOMAINS.join("|")}之一","relatedCharacterIds":["C#"],"urgency":0到100}],"resolveIds":["T# 或本候选 N#"],"dormantIds":["T# 或本候选 N#"]},"chapterSummary":{"keyEvents":["..."],"characterChanges":["..."],"relationshipChanges":["..."],"unresolvedQuestions":["..."]}}`,
    ``,
    `注意：只写实际发生变化的事件；statDelta 只写变化字段，没变化的字段省略；所有引用只用短别名。`,
  ].join("\n");

  return [sections.join("\n"), hardConstraints, worldRules, outputSpec].join("\n\n");
}

// 供 describeCharacter 使用的目标别名（内联辅助）
function describeCharacterWithAlias(character: Character, charAlias: string, goalAlias: (id: string) => string): string {
  const stats = character.state.stats;
  const lines = [
    `【${charAlias}】${character.identity.name}（${character.role === "protagonist" ? "主角" : "NPC"}，${character.state.age} 岁，${character.state.year} 年）`,
    `城市/职业：${character.state.city || "未知"} / ${character.state.occupation || "未定"}`,
    `性格：${character.core.personalityTraits.join("、") || "未设定"}`,
    `价值观：${character.core.values.join("、") || "未设定"}`,
    `状态：现金${stats.cash}，健康${stats.health}，幸福${stats.happiness}，知识${stats.knowledge}，人脉${stats.connections}，事业${stats.career}，资产${stats.assets}`,
    `目标：${character.state.currentGoals.map((g) => `${g.label}（${goalAlias(g.id)}）`).join("、") || "无"}`,
    `困境：${character.state.currentDilemmas.join("、") || "无"}`,
  ];
  if (character.role === "npc" && character.privateState?.currentEmotionalTrend) {
    lines.push(`当前情绪趋势：${character.privateState.currentEmotionalTrend}`);
  }
  if (character.role === "npc" && character.privateState) {
    lines.push(
      `隐藏目标：${character.privateState.hiddenGoals.join("、") || "无"}`,
      `隐藏隐忧：${character.privateState.hiddenConcerns.join("、") || "无"}`,
      `私人信念：${character.privateState.privateBeliefs.join("、") || "无"}`,
    );
  }
  return lines.join("\n");
}

// ---- 模型输出 → WorldSimulationOutput ----

function buildSimulationOutputInternal(
  modeled: ModelSimulation,
  input: WorldSimulationInput,
  newId: () => string = randomUUID,
): WorldSimulationOutput {
  const { chapter } = input;
  const { maps } = buildAliasMaps(input);
  const candidateAliases = candidateThreadAliases(modeled);
  const plannedThreadIds = candidateAliases.entries.map(() => `thread-${newId()}`);
  const threadReferenceMap: Record<string, string> = { ...maps.thread };
  candidateAliases.entries.forEach((entry, index) => {
    threadReferenceMap[entry.alias] = plannedThreadIds[index];
  });
  const threadIdForLabel = (label: string): string => {
    const alias = candidateAliases.uniqueByLabel.get(label);
    return alias && threadReferenceMap[alias] ? threadReferenceMap[alias] : `thread-${newId()}`;
  };
  const C = (alias: string, field: string) => resolveAlias(alias, maps.character, field);
  const R = (alias: string, field: string) => resolveAlias(alias, maps.relationship, field);
  const E = (alias: string, field: string) => resolveAlias(alias, maps.evidence, field);
  const T = (alias: string, field: string) => resolveAlias(alias, threadReferenceMap, field);
  const G = (alias: string, field: string) => resolveAlias(alias, maps.goal, field);
  const H = (alias: string, field: string) => resolveAlias(alias, maps.hook, field);
  const I = (alias: string, field: string) => resolveAlias(alias, maps.issue, field);

  const rawEvents = Array.isArray(modeled.events) ? modeled.events : [];
  const threadCreates: StoryThread[] = [];

  const events: SimulationEvent[] = rawEvents.map((rawEvent, index) => {
    const e = (rawEvent ?? {}) as Record<string, unknown>;
    const domain = requireText(e.domain, `events[${index}].domain`, 20) as LifeDomain;
    if (!VALID_DOMAINS.includes(domain)) throw new Error(`events[${index}].domain 非法: ${domain}`);

    const createsThreadLabels = optionalStringArray(e.createsThreadLabels, 3);
    const createsThreadIds: string[] = [];
    for (const label of createsThreadLabels) {
      const thread: StoryThread = {
        id: threadIdForLabel(label),
        label,
        description: "",
        domain,
        relatedCharacterIds: [],
        urgency: 50,
        status: "open",
      };
      threadCreates.push(thread);
      createsThreadIds.push(thread.id);
    }

    const characterChanges = (Array.isArray(e.characterChanges) ? e.characterChanges : []).map(
      (rawChange, changeIndex): SimulationEvent["characterChanges"][number] => {
        const change = (rawChange ?? {}) as Record<string, unknown>;
        return {
          characterId: C(String(change.characterId ?? ""), `events[${index}].characterChanges[${changeIndex}].characterId`),
          statDelta: change.statDelta ? (change.statDelta as Record<string, number>) : undefined,
          cityChange: change.cityChange as { from: string; to: string } | undefined,
          occupationChange: change.occupationChange as { from: string; to: string } | undefined,
          socialIdentityChange: change.socialIdentityChange as { from: string; to: string } | undefined,
          resolveGoalIds: change.resolveGoalIds
            ? (change.resolveGoalIds as unknown[]).map((id, i) => G(String(id), `events[${index}].characterChanges[${changeIndex}].resolveGoalIds[${i}]`))
            : undefined,
          description: requireText(change.description, `events[${index}].characterChanges[${changeIndex}].description`, 200),
        };
      },
    );

    const relationshipChanges = (Array.isArray(e.relationshipChanges) ? e.relationshipChanges : []).map(
      (rawChange, changeIndex): SimulationEvent["relationshipChanges"][number] => {
        const change = (rawChange ?? {}) as Record<string, unknown>;
        return {
          relationshipId: R(String(change.relationshipId ?? ""), `events[${index}].relationshipChanges[${changeIndex}].relationshipId`),
          scoreDelta: change.scoreDelta as Record<string, number>,
          typeChange: change.typeChange as { from: Relationship["type"]; to: Relationship["type"] } | undefined,
          addIssue: change.addIssue ? String(change.addIssue) : undefined,
          resolveIssueId: change.resolveIssueId ? I(String(change.resolveIssueId), `events[${index}].relationshipChanges[${changeIndex}].resolveIssueId`) : undefined,
          description: requireText(change.description, `events[${index}].relationshipChanges[${changeIndex}].description`, 200),
        };
      },
    );

    const causes = (Array.isArray(e.causes) ? e.causes : []).map((rawCause) => {
      const cause = (rawCause ?? {}) as Record<string, unknown>;
      const refAlias = cause.refId ? String(cause.refId) : undefined;
      return {
        type: requireText(cause.type, `events[${index}].causes.type`, 20) as SimulationEvent["causes"][number]["type"],
        refId: refAlias ? resolveRef(refAlias, maps, `events[${index}].causes.refId`, threadReferenceMap) : undefined,
        description: requireText(cause.description, `events[${index}].causes.description`, 120),
      };
    });

    return {
      id: `event-${newId()}`,
      chapterId: chapter.id,
      year: requireNumber(e.year, `events[${index}].year`, 1900, 2200),
      month: e.month == null ? null : requireNumber(e.month, `events[${index}].month`, 1, 12),
      order: index + 1,
      title: requireText(e.title, `events[${index}].title`, 32),
      summary: requireText(e.summary, `events[${index}].summary`, 240),
      domain,
      participantIds: (Array.isArray(e.participantIds) ? e.participantIds : []).map((id, i) => C(String(id), `events[${index}].participantIds[${i}]`)),
      causes,
      characterChanges,
      relationshipChanges,
      evidenceIds: (Array.isArray(e.evidenceIds) ? e.evidenceIds : []).map((id, i) => E(String(id), `events[${index}].evidenceIds[${i}]`)),
      importance: requireNumber(e.importance, `events[${index}].importance`, 0, 100),
      visibility: requireText(e.visibility, `events[${index}].visibility`, 20) as SimulationEvent["visibility"],
      createsThreadIds,
      resolvesThreadIds: (Array.isArray(e.resolvesThreadIds) ? e.resolvesThreadIds : []).map((id, i) => T(String(id), `events[${index}].resolvesThreadIds[${i}]`)),
    };
  });

  const newMemories: CharacterMemory[] = (Array.isArray(modeled.newMemories) ? modeled.newMemories : []).map(
    (rawMemory, index): CharacterMemory => {
      const memory = (rawMemory ?? {}) as Record<string, unknown>;
      const type = requireText(memory.type, `newMemories[${index}].type`, 20);
      if (!VALID_MEMORY_TYPES.includes(type)) throw new Error(`newMemories[${index}].type 非法: ${type}`);
      return {
        id: `mem-${newId()}`,
        characterId: C(String(memory.characterId ?? ""), `newMemories[${index}].characterId`),
        year: requireNumber(memory.year, `newMemories[${index}].year`, 1900, 2200),
        chapterId: chapter.id,
        type: type as CharacterMemory["type"],
        summary: requireText(memory.summary, `newMemories[${index}].summary`, 240),
        relatedCharacterIds: (Array.isArray(memory.relatedCharacterIds) ? memory.relatedCharacterIds : []).map((id, i) => C(String(id), `newMemories[${index}].relatedCharacterIds[${i}]`)),
        domains: (Array.isArray(memory.domains) ? memory.domains : []).map((d) => String(d) as LifeDomain),
        importance: requireNumber(memory.importance, `newMemories[${index}].importance`, 0, 100),
        emotionalValence: requireNumber(memory.emotionalValence, `newMemories[${index}].emotionalValence`, -2, 2) as CharacterMemory["emotionalValence"],
        permanentFact: memory.permanentFact === true,
        active: true,
      };
    },
  );

  const goalUpdates = (Array.isArray(modeled.goalUpdates) ? modeled.goalUpdates : []).map(
    (rawUpdate, index): WorldSimulationOutput["goalUpdates"][number] => {
      const update = (rawUpdate ?? {}) as Record<string, unknown>;
      return {
        characterId: C(String(update.characterId ?? ""), `goalUpdates[${index}].characterId`),
        add: (Array.isArray(update.add) ? update.add : []).map((rawGoal) => {
          const goal = (rawGoal ?? {}) as Record<string, unknown>;
          return {
            id: `goal-${newId()}`,
            label: requireText(goal.label, `goalUpdates[${index}].add.label`, 80),
            horizon: requireText(goal.horizon, `goalUpdates[${index}].add.horizon`, 10) as "short" | "medium" | "long",
            priority: requireNumber(goal.priority, `goalUpdates[${index}].add.priority`, 0, 100),
            status: "active" as const,
          };
        }),
        update: [],
      };
    },
  );

  const hookUpdates = (Array.isArray(modeled.hookUpdates) ? modeled.hookUpdates : []).map(
    (rawUpdate, index): WorldSimulationOutput["hookUpdates"][number] => {
      const update = (rawUpdate ?? {}) as Record<string, unknown>;
      return {
        characterId: C(String(update.characterId ?? ""), `hookUpdates[${index}].characterId`),
        add: (Array.isArray(update.add) ? update.add : []).map((rawHook) => {
          const hook = (rawHook ?? {}) as Record<string, unknown>;
          return {
            id: `hook-${newId()}`,
            label: requireText(hook.label, `hookUpdates[${index}].add.label`, 40),
            description: requireText(hook.description, `hookUpdates[${index}].add.description`, 200),
            status: "active" as const,
          };
        }),
        resolveIds: (Array.isArray(update.resolveHookIds) ? update.resolveHookIds : []).map((id, i) => H(String(id), `hookUpdates[${index}].resolveHookIds[${i}]`)),
      };
    },
  );

  const threadRaw = (modeled.threadUpdates ?? {}) as Record<string, unknown>;
  const extraThreads: StoryThread[] = (Array.isArray(threadRaw.create) ? threadRaw.create : []).map((rawThread, threadIndex) => {
    const thread = (rawThread ?? {}) as Record<string, unknown>;
    const label = requireText(thread.label, `threadUpdates.create[${threadIndex}].label`, 60);
    return {
      id: threadIdForLabel(label),
      label,
      description: requireText(thread.description, `threadUpdates.create[${threadIndex}].description`, 200),
      domain: requireText(thread.domain, `threadUpdates.create[${threadIndex}].domain`, 20) as LifeDomain,
      relatedCharacterIds: (Array.isArray(thread.relatedCharacterIds) ? thread.relatedCharacterIds : []).map((id, i) => C(String(id), `threadUpdates.create.relatedCharacterIds[${i}]`)),
      urgency: requireNumber(thread.urgency, `threadUpdates.create[${threadIndex}].urgency`, 0, 100),
      status: "open" as const,
    };
  });
  const mergedThreads = new Map<string, StoryThread>();
  for (const thread of [...threadCreates, ...extraThreads]) {
    const existing = mergedThreads.get(thread.id);
    if (!existing) {
      mergedThreads.set(thread.id, thread);
      continue;
    }
    mergedThreads.set(thread.id, {
      ...existing,
      ...thread,
      description: thread.description || existing.description,
      relatedCharacterIds: thread.relatedCharacterIds.length > 0 ? thread.relatedCharacterIds : existing.relatedCharacterIds,
      urgency: thread.urgency !== 50 || existing.urgency === 50 ? thread.urgency : existing.urgency,
    });
  }

  const summaryRaw = (modeled.chapterSummary ?? {}) as Record<string, unknown>;

  return {
    events,
    newMemories,
    goalUpdates,
    hookUpdates,
    threadUpdates: {
      create: [...mergedThreads.values()],
      resolveIds: (Array.isArray(threadRaw.resolveIds) ? threadRaw.resolveIds : []).map((id, i) => T(String(id), `threadUpdates.resolveIds[${i}]`)),
      dormantIds: (Array.isArray(threadRaw.dormantIds) ? threadRaw.dormantIds : []).map((id, i) => T(String(id), `threadUpdates.dormantIds[${i}]`)),
    },
    chapterSummary: {
      keyEvents: optionalStringArray(summaryRaw.keyEvents, 20),
      characterChanges: optionalStringArray(summaryRaw.characterChanges, 20),
      relationshipChanges: optionalStringArray(summaryRaw.relationshipChanges, 20),
      unresolvedQuestions: optionalStringArray(summaryRaw.unresolvedQuestions, 20),
    },
  };
}

function resolveRef(refAlias: string, maps: AliasMaps, field: string, threadReferenceMap = maps.thread): string {
  for (const map of [maps.character, threadReferenceMap, maps.goal, maps.hook, maps.issue, maps.relationship]) {
    if (map[refAlias]) return map[refAlias];
  }
  throw new SimulationReferenceError(field, refAlias);
}

export function buildSimulationOutput(
  modeled: ModelSimulation,
  input: WorldSimulationInput,
  newId: () => string = randomUUID,
): WorldSimulationOutput {
  const normalized = normalizeSimulationCandidateReferences(modeled, input);
  try {
    return buildSimulationOutputInternal(normalized, input, newId);
  } catch (error) {
    if (error instanceof SimulationReferenceError) error.candidate = normalized;
    throw error;
  }
}

export async function runWorldSimulator(
  input: WorldSimulationInput,
  options: {
    correction?: string;
    budget?: ExecutionBudget;
    signal?: AbortSignal;
    model?: WorldSimulatorModel;
    onProgress?: (progress: ModelProgress) => void;
    onCandidate?: (candidate: ModelSimulation) => void;
  } = {},
): Promise<WorldSimulationOutput> {
  const prompt = buildSimulatorPrompt(input);
  const phaseDeadlineAt = options.budget?.phaseDeadlineAt("annual", 180_000);
  const phaseRemainingMs = options.budget?.remainingMsFor("annual", 180_000) ?? 180_000;
  const callOptions = {
    appendMessages: options.correction
      ? [{ role: "user" as const, content: options.correction }]
      : undefined,
    maxTokens: 8000,
    timeoutMs: Math.min(180_000, phaseRemainingMs),
    signal: options.signal ?? options.budget?.signal,
    deadlineAt: phaseDeadlineAt,
    maxTransportRetries: 0,
    stallPolicy: "bounded" as const,
    firstTokenTimeoutMs: Math.min(15_000, options.budget?.remainingMs() ?? 15_000),
    budget: options.budget,
    budgetPhase: "annual",
    onProgress: options.onProgress,
    auditMetadata: {
      executionId: options.budget?.executionId,
      stage: "annual-world-simulation",
    },
    responseFormat: "json" as const,
  };
  const customModel = options.model;
  const modeled = customModel
    ? await (async () => {
        const request = options.budget?.reserve("world-simulation", "annual");
        return customModel("world-simulation", SIMULATOR_SYSTEM, `${prompt}${options.correction ? `\n\n${options.correction}` : ""}`, {
          maxTokens: callOptions.maxTokens,
          timeoutMs: callOptions.timeoutMs,
          responseFormat: "json",
          signal: options.signal ?? options.budget?.signal,
           deadlineAt: phaseDeadlineAt,
          requestId: request?.requestId,
          executionId: request?.executionId ?? options.budget?.executionId,
          attempt: request?.attempt,
        });
      })()
    : await callGameModel<ModelSimulation>("world-simulation", SIMULATOR_SYSTEM, prompt, callOptions);
  options.onCandidate?.(modeled);
  return buildSimulationOutput(modeled, input);
}

export async function repairWorldSimulationReferences(
  input: WorldSimulationInput,
  candidate: ModelSimulation,
  issue: SimulationReferenceError,
  options: {
    budget: ExecutionBudget;
    signal?: AbortSignal;
    model?: (purpose: string, system: string, prompt: string, options?: Record<string, unknown>) => Promise<unknown>;
    onProgress?: (progress: ModelProgress) => void;
  },
): Promise<WorldSimulationOutput> {
  const candidateHash = hashSimulationCandidate(candidate);
  const { maps } = buildAliasMaps(input);
  const candidateAliases = candidateThreadAliases(candidate);
  const existingThreadAliases = Object.entries(maps.thread)
    .map(([alias, id]) => `${alias}=${input.openThreads.find((thread) => thread.id === id)?.label ?? "?"}`)
    .join("、") || "无";
  const newThreadAliases = candidateAliases.entries
    .map((entry) => `${entry.alias}=${entry.label}`)
    .join("、") || "无";
  const repairPrompt = [
    "只修复一个世界模拟输出的引用别名错误，不要重写整年，也不要改变任何数值、事件、因果或后果。",
    `失败路径：${issue.field}`,
    `非法别名：${issue.alias}`,
    `候选哈希：${candidateHash}`,
    `当前已有线索别名：${existingThreadAliases}`,
    `本候选新建线索临时别名：${newThreadAliases}`,
    "resolvesThreadIds/resolveIds/dormantIds 只能替换为当前已有 T# 或本候选确实新建的 N#；如果非法值不是这些别名，不能猜测、删除数组项或改动其他字段。",
    `候选 JSON：${JSON.stringify(candidate)}`,
    "只输出 {\"candidateHash\":\"原值\",\"patches\":[{\"op\":\"replace\",\"path\":\"events[0].participantIds[0]\",\"value\":\"C1\"}]}；path 只能修复引用字段，value 只能使用上下文中已有短别名或本候选明确分配的 N#。",
  ].join("\n");
  const customModel = options.model;
  const phaseDeadlineAt = options.budget.phaseDeadlineAt("annual", 180_000);
  const phaseRemainingMs = options.budget.remainingMsFor("annual", 180_000);
  const repair = customModel
    ? await (async () => {
        const request = options.budget.reserve("world-reference-repair", "annual");
        return customModel("world-reference-repair", SIMULATOR_SYSTEM, repairPrompt, {
        responseFormat: "json",
        maxTokens: 1200,
         timeoutMs: Math.min(45_000, phaseRemainingMs),
        signal: options.signal ?? options.budget.signal,
         deadlineAt: phaseDeadlineAt,
          requestId: request.requestId,
          executionId: request.executionId,
        });
      })()
    : await callGameModel<ReferenceRepair>("world-reference-repair", SIMULATOR_SYSTEM, repairPrompt, {
        responseFormat: "json",
        maxTokens: 1200,
         timeoutMs: Math.min(45_000, phaseRemainingMs),
        signal: options.signal ?? options.budget.signal,
         deadlineAt: phaseDeadlineAt,
        maxTransportRetries: 0,
        stallPolicy: "bounded",
        firstTokenTimeoutMs: Math.min(15_000, options.budget.remainingMs()),
        budget: options.budget,
        budgetPhase: "annual",
        onProgress: options.onProgress,
        auditMetadata: { executionId: options.budget.executionId, stage: "annual-reference-repair" },
      });
  const repairedCandidate = applyReferenceRepair(candidate, repair as ReferenceRepair);
  return buildSimulationOutput(repairedCandidate as ModelSimulation, input);
}
