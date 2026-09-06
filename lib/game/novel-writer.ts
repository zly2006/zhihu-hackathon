// Novel Writer（Phase 5）
// 只根据已经确定的 SimulationEvent 写小说，不能创造与 canonical 冲突的重大事实。
// 可以创造场景、对白、过渡、氛围、日常细节；不能改变事件年份、结果、关系变化。
// 重新生成小说只重写文风，不改 canonical events（方案 §21、§35.3）。

import { callGameModel } from "../llm";
import type { Character } from "../domain/character";
import type { ChapterSpan } from "../domain/shared";
import type { Chapter, NovelScene } from "../domain/chapter";
import type { CharacterMemory } from "../domain/memory";
import type { Relationship } from "../domain/relationship";
import type { SimulationEvent } from "../domain/simulation";
import type { LifeExperience } from "../domain/experience";
import type { NarrativePlan, NarrativeReference, ScenePlan } from "../domain/narrative";

export type NovelWriterInput = {
  protagonist: Character;
  npcs: Character[];
  relationships: Relationship[];
  startYear: number;
  endYear: number;
  span: ChapterSpan;
  events: SimulationEvent[];
  relevantMemories: CharacterMemory[];
  featuredEvidence: LifeExperience[];
  // V1.1：可选 Director 规划；缺省时按 V1.0 行为写
  narrativePlan?: NarrativePlan;
  narrativeReferences?: NarrativeReference[];
};

export type NovelSceneWriterInput = NovelWriterInput & {
  scenePlan: ScenePlan;
  sceneIndex: number;
};

export type NovelStreamCallbacks = {
  signal?: AbortSignal;
  onSceneStart?: (sceneIndex: number, scenePlan: ScenePlan) => void;
  onToken?: (sceneIndex: number, token: string) => void;
  onScene?: (sceneIndex: number, scene: NovelScene) => void;
};

type ModelNovel = {
  title?: unknown;
  subtitle?: unknown;
  scenes?: unknown;
};

const NOVEL_SYSTEM =
  "你是中文互动人生小说的章节写手。只输出严格 JSON，不写 Markdown。你只能根据已经确定的结构化事件来写小说，不能改变事件的事实。用第二人称“你”叙述。通过场景、对白、细节表现人物，不要直接交代主角不可能知道的他人秘密心理，只能通过行为暗示。不要把知乎作者的真实经历复制给游戏角色，也不要大段引用知乎原文。避免“第一年……第二年……第三年……”的流水账，用多个具体场景推进。";
const NOVEL_SCENE_SYSTEM =
  "你是中文互动人生小说的场景写手。只输出可直接展示给玩家的纯中文正文，不写 JSON、Markdown 或解释。你只能根据已经确定的结构化事件来写场景，不能改变事件事实。用第二人称“你”叙述，通过可观察的动作、对白、具体物件与环境表现人物，不要直接交代主角不可能知道的他人秘密心理。不要复制知乎作者的真实经历或大段引用知乎原文。";

function requireText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`大模型返回字段 ${field} 缺失`);
  return value.trim().slice(0, maximum);
}

function describeCharacterForNovel(character: Character): string {
  const lines = [
    `${character.identity.name}（${character.state.age} 岁，${character.role === "protagonist" ? "主角" : "NPC"}）`,
    `性格：${character.core.personalityTraits.join("、") || "未设定"}`,
  ];
  return lines.join("，");
}

function describeEvent(event: SimulationEvent, world: NovelWriterInput): string {
  const participants = event.participantIds
    .map(
      (id) => [world.protagonist, ...world.npcs].find((c) => c.id === id)?.identity.name ?? "某人",
    )
    .join("、");
  const relationshipChanges = event.relationshipChanges
    .map((change) => {
      const rel = world.relationships.find((r) => r.id === change.relationshipId);
      const other = world.npcs.find(
        (n) => n.id === rel?.characterAId || n.id === rel?.characterBId,
      );
      const delta = Object.entries(change.scoreDelta)
        .map(([k, v]) => `${k}${Number(v) >= 0 ? "+" : ""}${v}`)
        .join("，");
      return `与${other?.identity.name ?? "某人"}：${change.description}${delta ? `（${delta}）` : ""}`;
    })
    .join("；");
  const characterChanges = event.characterChanges.map((change) => change.description).join("；");
  const visibilityNote =
    event.visibility === "partially_known" ? "（主角只部分知情，只能写可观察的表象）" : "";
  return [
    `${event.year}${event.month ? `年${event.month}月` : "年"}：${event.title}——${event.summary}${visibilityNote}`,
    characterChanges ? `人物变化：${characterChanges}` : "",
    relationshipChanges ? `关系变化：${relationshipChanges}` : "",
  ]
    .filter(Boolean)
    .join("｜");
}

export function buildNovelPrompt(input: NovelWriterInput): string {
  const { protagonist, npcs, relationships, startYear, endYear, span, events, narrativePlan } =
    input;
  const npcLines = npcs
    .map((npc) => {
      const rel = relationships.find((r) => r.characterAId === npc.id || r.characterBId === npc.id);
      return `${describeCharacterForNovel(npc)}${rel ? `，与主角关系：${rel.type}` : ""}`;
    })
    .join("\n");
  const memoryLines = input.relevantMemories.length
    ? input.relevantMemories.map((m) => `- ${m.year}年：${m.summary}`).join("\n")
    : "（无）";
  const evidenceLines = input.featuredEvidence.length
    ? input.featuredEvidence
        .map((e) => `- ${e.source.title}：${e.outcomes.shortTerm[0]?.description ?? ""}`)
        .join("\n")
    : "（无）";

  const sections = [
    `# 本章信息`,
    `时间跨度 ${span} 年，从 ${startYear} 年到 ${endYear} 年。`,
    ``,
    `# 人物底色`,
    `${describeCharacterForNovel(protagonist)}`,
    npcLines,
    ``,
    `# 本章已经确定发生的事件（canonical，不可改变）`,
    events.map((event) => describeEvent(event, input)).join("\n"),
    ``,
    `# 相关记忆（用于连续性，非本章新发生）`,
    memoryLines,
    ``,
    `# 知乎现实参照（仅供现实感参考，不要复制、不要引用大段原文）`,
    evidenceLines,
  ];

  const hardConstraints = [
    `# 硬约束`,
    `1. 第二人称“你”，主角是 ${protagonist.identity.name}。`,
    `2. 不得改变上述任何事件的年份、结果、人物变化或关系变化；可以补充场景、对白、过渡、氛围与日常细节。`,
    `3. 对标记“只部分知情”的事件，只写主角可观察的表象，不写主角不可能知道的他人秘密；但可以通过行为暗示。`,
    `4. 不复制知乎作者的真实经历给游戏角色，不引用大段知乎原文。`,
  ];

  let outputSpec: string;
  if (narrativePlan) {
    sections.push(
      `# 叙事导演规划（NarrativePlan：本章的结构与情绪路线，写作必须严格遵守）`,
      describePlanForWriter(narrativePlan),
      ``,
      `# 叙事参考知识（只借鉴机制，禁止复制情节/角色/原文）`,
      (input.narrativeReferences ?? [])
        .slice(0, 10)
        .map((r) => `- ${r.fragmentId}｜${r.functionTags.join("/")}｜${r.techniqueSummary || "无"}`)
        .join("\n") || "（无）",
    );
    hardConstraints.push(
      `5. 小说场景数必须等于导演规划的场景数（${narrativePlan.scenes.length} 个），按规划的 order 顺序一一对应；每个场景的 timeLabel 必须使用规划的时间标签，heading 与内容必须落实该场景的 purpose / visibleGoal / conflict / endingBeat，不得改写为其它场景。`,
      `6. 每个规划场景的 mustNotInvent 清单是硬禁令，正文不得违反。`,
      `7. 结尾必须实现导演规划的 endingHook（${narrativePlan.endingHook.type}：${narrativePlan.endingHook.textGoal}）。`,
      `8. 本章约 ${span === 1 ? "1200-2000" : "2500-4000"} 中文字，均匀分配到各场景，避免“第一年/第二年/第三年”流水账。`,
    );
    outputSpec = [
      `# 输出 JSON（只输出 JSON）`,
      `{"title":"20字内章节标题（呼应导演规划的标题方向）","subtitle":"${startYear}—${endYear}","scenes":[${narrativePlan.scenes.map(() => `{"heading":"该场景小标题（可选）","timeLabel":"按规划","text":"该场景的正文"}`).join(",")}]}`,
      `scenes 数组长度必须等于 ${narrativePlan.scenes.length}，顺序与规划一致；每个 scene 的 text 是该场景的完整正文段落。`,
    ].join("\n");
  } else {
    hardConstraints.push(
      `5. ${span === 1 ? "本章约 1200-2000 中文字" : "本章约 2500-4000 中文字"}，用多个场景推进，避免“第一年/第二年/第三年”流水账。`,
    );
    outputSpec = [
      `# 输出 JSON（只输出 JSON）`,
      `{"title":"20字内章节标题","subtitle":"${startYear}—${endYear}","scenes":[{"heading":"场景小标题（可选）","timeLabel":"如 2027.03","text":"该场景的正文"}]}`,
      `scenes 数量不限，按时间顺序排列；每个 scene 的 text 是该场景的完整正文段落。`,
    ].join("\n");
  }

  return [sections.join("\n"), hardConstraints.join("\n"), outputSpec].join("\n\n");
}

function describePlanForWriter(plan: NarrativePlan): string {
  const lines = [
    `主题：${plan.theme}`,
    `主冲突：${plan.mainConflict}`,
    `情绪内核：${plan.emotionalCore}`,
    `结尾余味：${plan.endingHook.type}｜${plan.endingHook.textGoal}`,
    ``,
  ];
  if (plan.directorBrief) {
    lines.unshift(
      `下一幕聚焦（Narrative Director）：${plan.directorBrief.dramaticQuestion}`,
      `聚焦角色：${plan.directorBrief.focusCharacterId}；张力：${plan.directorBrief.tensionLevel}`,
      ...(plan.directorBrief.pacing
        ? [
            `节奏阶段：${plan.directorBrief.pacing.phase}；避免：${plan.directorBrief.pacing.avoid.join("；")}`,
          ]
        : []),
      "",
    );
  }
  for (const scene of plan.scenes) {
    lines.push(
      `场景 ${scene.order}（${scene.id}｜${scene.timeLabel}｜${scene.location}｜${scene.purpose}）`,
      `- 视角：${scene.povCharacterId}；参与者：${scene.participantIds.join("、")}`,
      `- 可见目标：${scene.visibleGoal}`,
      `- 冲突/张力：${scene.conflict}`,
      `- 情绪：${scene.startEmotion} → ${scene.endEmotion}`,
      `- 必须呈现：${scene.mustShow.join("；") || "（无）"}`,
      `- 禁止编造：${scene.mustNotInvent.join("；") || "（无）"}`,
      scene.dialogueIntent ? `- 对白目的：${scene.dialogueIntent}` : "",
      `- 结尾余味：${scene.endingBeat}`,
    );
  }
  return lines.join("\n");
}

export function parseNovel(
  modeled: ModelNovel,
  generatedAt: string,
  version: number,
  startYear: number,
  endYear: number,
  plan?: NarrativePlan,
): Chapter["novel"] {
  const rawScenes = Array.isArray(modeled.scenes) ? modeled.scenes : [];
  if (!rawScenes.length) throw new Error("大模型必须返回至少一个场景");
  if (plan && rawScenes.length !== plan.scenes.length) {
    throw new Error(`小说场景数 ${rawScenes.length} 与导演规划 ${plan.scenes.length} 不一致`);
  }
  const scenes: NovelScene[] = rawScenes.map((rawScene, index) => {
    const scene = (rawScene ?? {}) as Record<string, unknown>;
    const planned = plan?.scenes[index];
    return {
      id: `scene-${index + 1}`,
      heading:
        typeof scene.heading === "string" && scene.heading.trim()
          ? scene.heading.trim().slice(0, 40)
          : undefined,
      timeLabel:
        typeof scene.timeLabel === "string" && scene.timeLabel.trim()
          ? scene.timeLabel.trim().slice(0, 20)
          : planned?.timeLabel,
      text: requireText(scene.text, `scenes[${index}].text`, 4000),
    };
  });
  return {
    title: requireText(modeled.title, "title", 40),
    subtitle:
      typeof modeled.subtitle === "string" && modeled.subtitle.trim()
        ? modeled.subtitle.trim().slice(0, 40)
        : `${startYear}—${endYear}`,
    scenes,
    generatedAt,
    version,
  };
}

function sceneEvents(input: NovelSceneWriterInput): SimulationEvent[] {
  const sourceIds = new Set(input.scenePlan.sourceEventIds);
  const selected = input.events.filter((event) => sourceIds.has(event.id));
  return selected.length ? selected : input.events;
}

function scenePlanDescription(plan: ScenePlan): string {
  return [
    `场景 ${plan.order}（${plan.id}）`,
    `时间：${plan.timeLabel}；地点：${plan.location}；目的：${plan.purpose}`,
    `视角角色：${plan.povCharacterId}；参与者：${plan.participantIds.join("、") || "无"}`,
    `可见目标：${plan.visibleGoal}`,
    `冲突/张力：${plan.conflict}`,
    `情绪：${plan.startEmotion} → ${plan.endEmotion}`,
    `必须呈现：${plan.mustShow.join("；") || "（无）"}`,
    `禁止编造：${plan.mustNotInvent.join("；") || "（无）"}`,
    plan.dialogueIntent ? `对白目的：${plan.dialogueIntent}` : "",
    `结尾余味：${plan.endingBeat}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildNovelScenePrompt(input: NovelSceneWriterInput): string {
  const protagonist = input.protagonist;
  const npcLines = input.npcs
    .map((npc) => {
      const rel = input.relationships.find(
        (relationship) =>
          relationship.characterAId === npc.id || relationship.characterBId === npc.id,
      );
      return `${describeCharacterForNovel(npc)}${rel ? `，与主角关系：${rel.type}` : ""}`;
    })
    .join("\n");
  const memoryLines = input.relevantMemories.length
    ? input.relevantMemories.map((memory) => `- ${memory.year}年：${memory.summary}`).join("\n")
    : "（无）";
  const evidenceLines = input.featuredEvidence.length
    ? input.featuredEvidence
        .map(
          (experience) =>
            `- ${experience.source.title}：${experience.outcomes.shortTerm[0]?.description ?? ""}`,
        )
        .join("\n")
    : "（无）";
  const sections = [
    "# 本章上下文",
    `时间跨度 ${input.span} 年，从 ${input.startYear} 年到 ${input.endYear} 年。`,
    "",
    "# 人物底色",
    describeCharacterForNovel(protagonist),
    npcLines || "（无其他角色）",
    "",
    "# 本场景已经确定发生的事件（canonical，不可改变）",
    sceneEvents(input)
      .map((event) => describeEvent(event, input))
      .join("\n"),
    "",
    "# 相关记忆（用于连续性，非本场景新发生）",
    memoryLines,
    "",
    "# 知乎现实参照（仅供现实感参考，不要复制、不要引用大段原文）",
    evidenceLines,
    "",
    "# 本场景导演规划",
    scenePlanDescription(input.scenePlan),
    "",
    "# 输出要求",
    "只输出本场景的中文正文，不要输出 JSON、Markdown 标题、场景编号或解释。用第二人称“你”叙述，正文应是可直接展示给玩家的完整段落。",
  ];
  const hardConstraints = [
    "# 硬约束",
    `1. 主角必须是 ${protagonist.identity.name}，只能使用第二人称“你”。`,
    "2. 不得改变 canonical 事件的年份、结果、人物变化或关系变化；只能补充可观察的场景、对白、过渡与氛围。",
    "3. 对部分知情事件只能写主角可观察的表象，不得写主角不可能知道的他人秘密心理。",
    "4. 不复制知乎作者的真实经历，不引用大段知乎原文。",
    `5. 必须落实本场景的 visibleGoal、conflict、mustShow 与 endingBeat；必须遵守 mustNotInvent。`,
  ];
  // 硬约束必须位于 prompt 末尾，避免被后续输出格式说明稀释。
  return [...sections, "", hardConstraints.join("\n")].join("\n");
}

function plainSceneText(modeled: unknown): string {
  let raw =
    typeof modeled === "string"
      ? modeled
      : modeled && typeof modeled === "object" && "text" in modeled
        ? String((modeled as { text?: unknown }).text ?? "")
        : "";
  let trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed) as { text?: unknown };
      if (typeof parsed.text === "string") raw = parsed.text;
    } catch {
      /* 纯文本正文可能恰好包含花括号，交给普通文本校验。 */
    }
    trimmed = raw.trim();
  }
  const fenceMatch = trimmed.match(/^```(?:text|markdown)?\s*([\s\S]*?)\s*```$/i);
  return (fenceMatch ? fenceMatch[1] : trimmed).trim();
}

export function parseNovelScene(
  modeled: unknown,
  plan: ScenePlan,
  sceneIndex: number,
  generatedAt = new Date().toISOString(),
): NovelScene {
  const text = plainSceneText(modeled);
  if (!text) throw new Error(`大模型返回场景 ${sceneIndex + 1} 正文缺失`);
  return {
    id: `scene-${sceneIndex + 1}`,
    heading: plan.location.trim().slice(0, 40) || undefined,
    timeLabel: plan.timeLabel.trim().slice(0, 20) || undefined,
    text: text.slice(0, 4000),
  };
}

export async function writeNovelScene(
  input: NovelSceneWriterInput,
  callbacks: NovelStreamCallbacks = {},
): Promise<NovelScene> {
  callbacks.onSceneStart?.(input.sceneIndex, input.scenePlan);
  const modeled = await callGameModel<string>(
    "chapter-novel-scene",
    NOVEL_SCENE_SYSTEM,
    buildNovelScenePrompt(input),
    {
      responseFormat: "text",
      signal: callbacks.signal,
      onToken: (token) => callbacks.onToken?.(input.sceneIndex, token),
      maxTokens: 2200,
      timeoutMs: 180_000,
    },
  );
  const scene = parseNovelScene(modeled, input.scenePlan, input.sceneIndex);
  callbacks.onScene?.(input.sceneIndex, scene);
  return scene;
}

function streamedNovelTitle(input: NovelWriterInput): string {
  const candidate = input.narrativePlan?.titleDirection?.trim() || input.events[0]?.title?.trim();
  return (candidate || `${input.startYear}年的转弯`).slice(0, 40);
}

export async function writeNovelStream(
  input: NovelWriterInput,
  version = 1,
  callbacks: NovelStreamCallbacks = {},
): Promise<Chapter["novel"]> {
  const plans = [...(input.narrativePlan?.scenes ?? [])].sort(
    (left, right) => left.order - right.order,
  );
  if (!plans.length) throw new Error("Scene 级生成需要有效的 NarrativePlan");
  const generatedAt = new Date().toISOString();
  const sceneController = new AbortController();
  const abortScenes = () => sceneController.abort();
  callbacks.signal?.addEventListener("abort", abortScenes, { once: true });
  if (callbacks.signal?.aborted) sceneController.abort();
  let results: Array<{ sceneIndex: number; scene: NovelScene }>;
  try {
    results = await Promise.all(
      plans.map((scenePlan, sceneIndex) =>
        writeNovelScene(
          { ...input, scenePlan, sceneIndex },
          { ...callbacks, signal: sceneController.signal },
        )
          .then((scene) => ({ sceneIndex, scene }))
          .catch((error) => {
            sceneController.abort();
            throw error;
          }),
      ),
    );
  } finally {
    callbacks.signal?.removeEventListener("abort", abortScenes);
  }
  results.sort((left, right) => left.sceneIndex - right.sceneIndex);
  return {
    title: streamedNovelTitle(input),
    subtitle: `${input.startYear}—${input.endYear}`,
    scenes: results.map(({ scene }) => scene),
    generatedAt,
    version,
  };
}

export async function writeNovel(input: NovelWriterInput, version = 1): Promise<Chapter["novel"]> {
  const prompt = buildNovelPrompt(input);
  const modeled = await callGameModel<ModelNovel>("chapter-novel", NOVEL_SYSTEM, prompt, {
    maxTokens: 8000,
    timeoutMs: 180_000,
  });
  return parseNovel(
    modeled,
    new Date().toISOString(),
    version,
    input.startYear,
    input.endYear,
    input.narrativePlan,
  );
}
