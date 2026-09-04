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
type ModelSimulation = {
  events?: unknown;
  newMemories?: unknown;
  goalUpdates?: unknown;
  hookUpdates?: unknown;
  threadUpdates?: unknown;
  chapterSummary?: unknown;
};

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
  if (!id) throw new Error(`${field} 引用了未知别名 ${alias}，只能使用给定别名`);
  return id;
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
    `目标：${goalIdList}`,
    `Hook：${hookIdList}`,
    `矛盾：${issueIdList}`,
  ];

  const hardConstraints = [
    `# 结构硬约束（必须逐项满足）`,
    `1. ${chapter.span} 年章节必须生成 ${chapter.span === 1 ? "2 到 4" : "4 到 8"} 个事件；importance≥70 的重大事件最多 2 个。`,
    `2. 每个事件的 year 必须在 ${chapter.startYear} 到 ${chapter.endYear} 之间；month 可选（1-12 或省略）。`,
    `3. 所有 id 引用只能使用上述短别名：participantIds/characterId 用 C#，relationshipId 用 R#，evidenceIds 用 E#，relatedCharacterIds 用 C#，resolvesThreadIds/resolveIds/dormantIds 用 T#，resolveGoalIds 用 G#，resolveHookIds 用 H#，resolveIssueId 用 I#。`,
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
    `{"events":[{"year":数字,"month":1到12或省略,"title":"16字内","summary":"120字内","domain":"${VALID_DOMAINS.join("|")}之一","participantIds":["C#"],"causes":[{"type":"player_choice|prior_event|relationship|npc_goal|era|other","refId":"可选别名","description":"原因"}],"characterChanges":[{"characterId":"C#","statDelta":{"cash":-8到8},"cityChange":{"from":"旧","to":"新"},"occupationChange":{"from":"旧","to":"新"},"socialIdentityChange":{"from":"旧","to":"新"},"resolveGoalIds":["G#"],"description":"变化描述"}],"relationshipChanges":[{"relationshipId":"R#","scoreDelta":{"conflict":-20到20},"typeChange":{"from":"friend","to":"partner"},"addIssue":"新增未解决矛盾","resolveIssueId":"I#","description":"变化描述"}],"evidenceIds":["E#"],"importance":0到100,"visibility":"known_to_protagonist|partially_known","createsThreadLabels":["新线索标签"],"resolvesThreadIds":["T#"]}],"newMemories":[{"characterId":"C#","year":数字,"type":"event","summary":"记忆摘要","relatedCharacterIds":["C#"],"domains":["${VALID_DOMAINS.join("|")}之一"],"importance":0到100,"emotionalValence":-2到2,"permanentFact":true或false}],"goalUpdates":[{"characterId":"C#","add":[{"label":"新目标","horizon":"short|medium|long","priority":0到100}]}],"hookUpdates":[{"characterId":"C#","add":[{"label":"新Hook","description":"描述"}],"resolveHookIds":["H#"]}],"threadUpdates":{"create":[{"label":"线索标签","description":"描述","domain":"${VALID_DOMAINS.join("|")}之一","relatedCharacterIds":["C#"],"urgency":0到100}],"resolveIds":["T#"],"dormantIds":["T#"]},"chapterSummary":{"keyEvents":["..."],"characterChanges":["..."],"relationshipChanges":["..."],"unresolvedQuestions":["..."]}}`,
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

export function buildSimulationOutput(
  modeled: ModelSimulation,
  input: WorldSimulationInput,
  newId: () => string = randomUUID,
): WorldSimulationOutput {
  const { chapter } = input;
  const { maps } = buildAliasMaps(input);
  const C = (alias: string, field: string) => resolveAlias(alias, maps.character, field);
  const R = (alias: string, field: string) => resolveAlias(alias, maps.relationship, field);
  const E = (alias: string, field: string) => resolveAlias(alias, maps.evidence, field);
  const T = (alias: string, field: string) => resolveAlias(alias, maps.thread, field);
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
        id: `thread-${newId()}`,
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
        refId: refAlias ? resolveRef(refAlias, maps) : undefined,
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
  const extraThreads: StoryThread[] = (Array.isArray(threadRaw.create) ? threadRaw.create : []).map((rawThread) => {
    const thread = (rawThread ?? {}) as Record<string, unknown>;
    return {
      id: `thread-${newId()}`,
      label: requireText(thread.label, "threadUpdates.create.label", 60),
      description: requireText(thread.description, "threadUpdates.create.description", 200),
      domain: requireText(thread.domain, "threadUpdates.create.domain", 20) as LifeDomain,
      relatedCharacterIds: (Array.isArray(thread.relatedCharacterIds) ? thread.relatedCharacterIds : []).map((id, i) => C(String(id), `threadUpdates.create.relatedCharacterIds[${i}]`)),
      urgency: requireNumber(thread.urgency, "threadUpdates.create.urgency", 0, 100),
      status: "open" as const,
    };
  });

  const summaryRaw = (modeled.chapterSummary ?? {}) as Record<string, unknown>;

  return {
    events,
    newMemories,
    goalUpdates,
    hookUpdates,
    threadUpdates: {
      create: [...threadCreates, ...extraThreads],
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

function resolveRef(refAlias: string, maps: AliasMaps): string {
  for (const map of [maps.character, maps.thread, maps.goal, maps.hook, maps.issue, maps.relationship]) {
    if (map[refAlias]) return map[refAlias];
  }
  return refAlias;
}

export async function runWorldSimulator(
  input: WorldSimulationInput,
  options: { correction?: string } = {},
): Promise<WorldSimulationOutput> {
  const prompt = buildSimulatorPrompt(input);
  const modeled = await callGameModel<ModelSimulation>("world-simulation", SIMULATOR_SYSTEM, prompt, {
    appendMessages: options.correction
      ? [{ role: "user", content: options.correction }]
      : undefined,
    maxTokens: 8000,
    timeoutMs: 180_000,
  });
  return buildSimulationOutput(modeled, input);
}
