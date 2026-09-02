// Narrative Director（V1.1 §4.4/4.5：Director + Scene Planner 合并为一次 LLM 调用）
// SimulationEvent = What happened；NarrativePlan = How to reveal it；Novel = How to write it。
// Director 只能决定“如何呈现”，不能新增/篡改 canonical 事实。
import { callGameModel } from "../llm";
import type { ChapterSpan } from "../domain/shared";
import type { NarrativeEvidenceBundle, NarrativeNeed, NarrativePlan } from "../domain/narrative";
import type { SimulationEvent } from "../domain/simulation";
import type { WorldState } from "../domain/world";
import type { ChapterDecision } from "../domain/chapter";
import { SCENE_COUNT_RANGE } from "./validator";
import { buildAliasTables, characterLabelFor, eventLabelFor, resolvePlanAliases } from "./aliases";

export type DirectorWorldInfo = {
  world: WorldState;
  events: SimulationEvent[];
  decision: ChapterDecision;
  span: ChapterSpan;
  startYear: number;
  endYear: number;
};

const DIRECTOR_SYSTEM = [
  "你是中文互动人生小说的叙事导演（Narrative Director）。",
  "你的输入是本章已确定发生的结构化事件（canonical），你的任务不是改写事实，而是决定“如何呈现”：",
  "选择切入视角、场景顺序、对白目的、情绪曲线、主题与结尾余味。",
  "你输出 NarrativePlan，由小说写手严格按计划写作。",
  "只输出严格 JSON，不写 Markdown，不输出 JSON 之外的任何文字。",
].join("\n");

function describeEvents(info: DirectorWorldInfo): string {
  return info.events
    .map((event) => {
      const participants = event.participantIds
        .map((id) => info.world.characters[id]?.identity.name ?? "未知")
        .join("、");
      const changes = event.characterChanges.map((change) => change.description).join("；");
      return [
        `- id=${event.id}｜${event.year}${event.month ? `.${event.month}` : ""}｜${event.title}（重要度 ${event.importance}，${event.visibility === "partially_known" ? "主角只部分知情" : "主角已知"}）`,
        `  摘要：${event.summary}`,
        `  参与者：${participants}`,
        changes ? `  人物变化：${changes}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}

function describeCharacters(info: DirectorWorldInfo): string {
  return Object.values(info.world.characters)
    .map((character) => {
      const state = character.state;
      return [
        `- id=${character.id}｜${character.identity.name}（${state.age} 岁，${character.role === "protagonist" ? "主角" : "NPC"}）`,
        `  性格：${character.core.personalityTraits.join("、") || "未设定"}`,
        `  现状：${state.occupation || "无业"}｜${state.city || "未知城市"}`,
        state.currentGoals.length ? `  当前目标：${state.currentGoals.map((goal) => goal.label).join("；")}` : "",
        state.currentDilemmas.length ? `  当前困境：${state.currentDilemmas.join("；")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}

function describeRelationships(info: DirectorWorldInfo): string {
  return Object.values(info.world.relationships)
    .map((relationship) => {
      const otherId = relationship.characterAId === info.world.protagonistId ? relationship.characterBId : relationship.characterAId;
      const other = info.world.characters[otherId];
      return `- ${relationship.id}｜${other?.identity.name ?? "某人"}｜类型 ${relationship.type}｜亲密度 ${relationship.scores.closeness} 信任 ${relationship.scores.trust} 冲突 ${relationship.scores.conflict}｜${relationship.publicSummary || ""}`;
    })
    .join("\n");
}

function describeEvidence(bundle: NarrativeEvidenceBundle): string {
  const lines: string[] = [];
  const sections: Array<[string, NarrativeEvidenceBundle["scenePatterns"]]> = [
    ["场景模式", bundle.scenePatterns],
    ["对白模式", bundle.dialoguePatterns],
    ["节奏模式", bundle.pacingPatterns],
    ["结尾模式", bundle.endingPatterns],
    ["人物弧光", bundle.arcPatterns],
  ];
  for (const [label, references] of sections) {
    if (!references.length) continue;
    lines.push(`## ${label}`);
    for (const reference of references.slice(0, 4)) {
      lines.push(
        `- id=${reference.fragmentId}｜功能 ${reference.functionTags.join("/")}｜冲突 ${reference.conflictTags.join("/")}｜可迁移机制：${reference.techniqueSummary || "无"}${reference.safeExcerpt ? `｜样例：${reference.safeExcerpt.slice(0, 80)}` : ""}`,
      );
    }
  }
  return lines.join("\n");
}

export function buildDirectorPrompt(args: {
  need: NarrativeNeed;
  bundle: NarrativeEvidenceBundle;
  info: DirectorWorldInfo;
  previousErrors?: string[];
}): string {
  const { need, bundle, info, previousErrors } = args;
  const [minScenes, maxScenes] = SCENE_COUNT_RANGE[info.span];
  const aliasTables = buildAliasTables(info.events, info.world);
  const allowedFragmentIds = [
    ...bundle.arcPatterns,
    ...bundle.scenePatterns,
    ...bundle.dialoguePatterns,
    ...bundle.pacingPatterns,
    ...bundle.endingPatterns,
  ].map((reference) => reference.fragmentId);

  const hardConstraints = [
    "# 硬约束（程序生成，逐条必须满足）",
    `1. 事件代号：${eventLabelFor(info.events) || "（无）"}。canonicalEventIds 与每个场景的 sourceEventIds 只能引用这些事件代号。`,
    `2. 场景数量必须在 ${minScenes}-${maxScenes} 之间（${info.span} 年章）。`,
    `3. 角色代号：${characterLabelFor(info.world)}。participantIds、povCharacterId 与 characterArcs.characterId 只能引用这些角色代号，且 povCharacterId 必须在 participantIds 内。`,
    `4. 场景时间标签（timeLabel）中的年份必须在 ${info.startYear}-${info.endYear} 内；回忆场景须在 timeLabel 或 location 中显式标注“回忆”。`,
    `5. referenceFragmentIds 只能引用下方参考知识中出现的 id：${allowedFragmentIds.join(", ") || "（本 bundle 为空，referenceFragmentIds 必须为 []）"}。`,
    `6. 至少一个场景 purpose 为 conflict / turning_point / climax；必须给出 endingHook。`,
    `7. 每个场景必须给出 visibleGoal、conflict、endingBeat、location。`,
    `8. 不得新增重大人生事实（婚姻/死亡/怀孕/裁员/重大疾病等），不得改变事件年份、结果、人物变化、关系变化；不得把参考知识中的角色或情节复制进游戏；不得把 NPC 隐藏状态当作主角已知事实；不得为戏剧化让 NPC 突然反常。`,
    `9. 本章主题与主冲突必须能在 JSON 的 theme / mainConflict 字段中被明确指出（不可含糊）。`,
  ].join("\n");

  const outputSpec = [
    "# 输出 JSON（只输出 JSON，符合以下结构）",
    JSON.stringify({
      version: 1,
      titleDirection: "标题方向（10字内）",
      theme: "本章主题（一句明确的话）",
      emotionalCore: "情绪内核（一句）",
      mainConflict: "主冲突（一句）",
      characterArcs: [
        {
          characterId: "角色 id",
          startState: "章节开始时该角色的可见状态",
          pressure: "本章对其施加的压力",
          change: "本章中可见的变化",
          endState: "章节结束时该角色的可见状态",
        },
      ],
      scenes: [
        {
          id: "scene-1",
          order: 1,
          timeLabel: "2027.03",
          location: "地点",
          participantIds: ["角色 id"],
          povCharacterId: "角色 id",
          sourceEventIds: ["事件 id"],
          purpose: "setup|development|conflict|turning_point|climax|aftermath|hook",
          visibleGoal: "本场景主角/视角人物的可见目标",
          conflict: "本场景的冲突或张力（可低冲突）",
          startEmotion: "开场情绪",
          endEmotion: "结尾情绪",
          mustShow: ["必须呈现的事实"],
          mustNotInvent: ["本场景禁止编造的事项"],
          dialogueIntent: "对白目的（可选）",
          narrativeTechniques: ["本场景可用的叙事手法，来自参考知识，不抄袭原文"],
          endingBeat: "本场景的结尾余味",
        },
      ],
      endingHook: {
        textGoal: "结尾余味要实现的目标",
        type: "open_question|relationship_tension|new_opportunity|unresolved_cost|quiet_aftershock",
      },
      referenceFragmentIds: ["引用过的参考知识 id"],
      canonicalEventIds: ["本章事件 id"],
    }),
  ].join("\n");

  const sections = [
    "# 章节参数",
    `章节 ${need.chapterId}｜${info.span} 年章｜${info.startYear}-${info.endYear}｜期望基调：${need.desiredTone}`,
    `玩家决策：${info.decision.promptTitle}｜选择：${info.decision.normalizedAction}`,
    "",
    "# 人物（只含玩家可见信息）",
    describeCharacters(info),
    "",
    "# 关系",
    describeRelationships(info),
    "",
    "# Canonical 事件（本章已确定发生，不可改变）",
    describeEvents(info),
    "",
    "# 叙事知识库参考（结构化机制，可借鉴手法，禁止复制情节/角色/原文）",
    describeEvidence(bundle),
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

type ModelPlan = Record<string, unknown>;

// 粗解析 + 结构归一：字段类型与取值范围由 validator 兜底，这里只保证形状存在
export function parsePlan(modeled: ModelPlan): NarrativePlan {
  const plan = (modeled ?? {}) as Partial<NarrativePlan>;
  if (typeof plan.version !== "number") throw new Error("NarrativePlan 缺少 version");
  if (!Array.isArray(plan.scenes)) throw new Error("NarrativePlan 缺少 scenes 数组");
  if (!plan.endingHook || typeof plan.endingHook !== "object") throw new Error("NarrativePlan 缺少 endingHook");
  const normalize = (value: unknown, maximum: number): string =>
    typeof value === "string" ? value.trim().slice(0, maximum) : "";
  return {
    version: 1,
    titleDirection: normalize(plan.titleDirection, 40),
    theme: normalize(plan.theme, 120),
    emotionalCore: normalize(plan.emotionalCore, 120),
    mainConflict: normalize(plan.mainConflict, 120),
    characterArcs: Array.isArray(plan.characterArcs)
      ? plan.characterArcs.slice(0, 6).map((arc) => {
          const item = (arc ?? {}) as Record<string, unknown>;
          return {
            characterId: normalize(item.characterId, 40),
            startState: normalize(item.startState, 120),
            pressure: normalize(item.pressure, 120),
            change: normalize(item.change, 120),
            endState: normalize(item.endState, 120),
          };
        })
      : [],
    scenes: plan.scenes.slice(0, 10).map((scene, index) => {
      const item = (scene ?? {}) as Record<string, unknown>;
      return {
        id: normalize(item.id, 30) || `scene-${index + 1}`,
        order: typeof item.order === "number" ? item.order : index + 1,
        timeLabel: normalize(item.timeLabel, 20),
        location: normalize(item.location, 60),
        participantIds: Array.isArray(item.participantIds) ? item.participantIds.map((value) => normalize(value, 40)) : [],
        povCharacterId: normalize(item.povCharacterId, 40),
        sourceEventIds: Array.isArray(item.sourceEventIds) ? item.sourceEventIds.map((value) => normalize(value, 40)) : [],
        purpose: (item.purpose as ScenePlanPurpose) ?? "development",
        visibleGoal: normalize(item.visibleGoal, 160),
        conflict: normalize(item.conflict, 160),
        startEmotion: normalize(item.startEmotion, 40),
        endEmotion: normalize(item.endEmotion, 40),
        mustShow: Array.isArray(item.mustShow) ? item.mustShow.map((value) => normalize(value, 120)).filter(Boolean) : [],
        mustNotInvent: Array.isArray(item.mustNotInvent) ? item.mustNotInvent.map((value) => normalize(value, 120)).filter(Boolean) : [],
        dialogueIntent: item.dialogueIntent ? normalize(item.dialogueIntent, 160) : undefined,
        narrativeTechniques: Array.isArray(item.narrativeTechniques) ? item.narrativeTechniques.map((value) => normalize(value, 120)).filter(Boolean) : [],
        endingBeat: normalize(item.endingBeat, 160),
      };
    }),
    endingHook: {
      textGoal: normalize((plan.endingHook as Record<string, unknown>)?.textGoal, 160),
      type: ((plan.endingHook as Record<string, unknown>)?.type as NarrativePlan["endingHook"]["type"]) ?? "quiet_aftershock",
    },
    referenceFragmentIds: Array.isArray(plan.referenceFragmentIds) ? plan.referenceFragmentIds.map((value) => normalize(value, 60)).filter(Boolean) : [],
    canonicalEventIds: Array.isArray(plan.canonicalEventIds) ? plan.canonicalEventIds.map((value) => normalize(value, 60)).filter(Boolean) : [],
  };
}

type ScenePlanPurpose = "setup" | "development" | "conflict" | "turning_point" | "climax" | "aftermath" | "hook";

export async function generateNarrativePlan(args: {
  need: NarrativeNeed;
  bundle: NarrativeEvidenceBundle;
  info: DirectorWorldInfo;
  previousErrors?: string[];
}): Promise<NarrativePlan> {
  const prompt = buildDirectorPrompt(args);
  const modeled = await callGameModel<ModelPlan>("narrative-plan", DIRECTOR_SYSTEM, prompt, {
    maxTokens: 6000,
    timeoutMs: 180_000,
  });
  const aliasTables = buildAliasTables(args.info.events, args.info.world);
  return resolvePlanAliases(parsePlan(modeled), aliasTables);
}
