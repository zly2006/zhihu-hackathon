import { z } from "zod";
import config from "./story-config.json";
import storyPublic from "./story-public.json";
import examples from "./story-examples.json";
import storyReference from "./story-reference.json";
import {
  LIFE_STAGE_AGES,
  LIFE_STAGE_LABELS,
  lifeEventForStoryStage,
  planLifeEvents,
  renderLifeEvent,
  type LifeEventPlan,
} from "./life-events";

export type StageKind = "common" | "route" | "ending";
export type Beat = { id: string; kind: StageKind; task: string };
export type PublicCastMember = {
  id: string;
  name: string;
  gender: "男" | "女";
  age: number;
  identity: string;
};
export type CharacterProfile = {
  id: string;
  name: string;
  gender: "男" | "女";
  background?: string;
  zhihuHandle?: string;
};
export type CastDetails = {
  voice: string;
  desire: string;
  object: string;
  route_event: string;
  payoff: string;
};
export type CastMember = PublicCastMember &
  CastDetails & { background?: string; zhihuHandle?: string };
export type Route = string;
export type StoryState = {
  relationships: Record<string, number>;
  flags: string[];
  timeline: string[];
  usedLifeEventIds?: string[];
};
export type Player = {
  id: string;
  name: string;
  age: number;
  identity: string;
};

const beats = config.BEATS as unknown as Beat[];
const privateCast = config.CAST as Record<string, CastDetails>;
export const total = beats.length;
export const castPool = storyPublic.cast as unknown as PublicCastMember[];
export const ids = castPool.map((member) => member.id);
export const requiredCastCount = storyPublic.requiredCastCount;
export const player = storyPublic.player as Player;
export const limits = config.LIMITS;

if (!beats.length || beats.some((beat) => !beat.id || !beat.kind || !beat.task))
  throw new Error("BEATS 配置不完整。");
if (castPool.length !== 8 || new Set(ids).size !== castPool.length)
  throw new Error("公开角色池必须是 8 位不重复角色。");
if (castPool.some((member) => !privateCast[member.id]))
  throw new Error("公开角色池与私密角色资料不匹配。");
if (storyPublic.totalStages !== total)
  throw new Error("story-public.totalStages 必须与 BEATS 数量一致。");

export function beatFor(stage: number): Beat {
  const beat = beats[stage];
  if (!beat) throw new Error(`无效的剧情阶段：${stage}`);
  return beat;
}

export const stageKind = (stage: number): StageKind => beatFor(stage).kind;
export const isCommonStage = (stage: number) => stageKind(stage) === "common";
export const isEndingStage = (stage: number) => stageKind(stage) === "ending";
export const count = (text: string) =>
  [...text].filter((char) => /[\p{L}\p{N}]/u.test(char)).length;

export const nodeSchema = z
  .object({
    title: z.string().min(1).max(25),
    lines: z
      .array(
        z
          .object({
            speaker: z.string(),
            text: z.string().min(1).max(limits.maxLineChars),
          })
          .strict(),
      )
      .min(4)
      .max(22),
    choices: z
      .array(
        z
          .object({
            text: z.string().min(4).max(30),
            target: z.string().nullable(),
          })
          .strict(),
      )
      .max(limits.totalChoiceMax),
    memory: z
      .object({
        summary: z.string().max(240),
        facts: z.array(z.string().max(55)).max(6),
      })
      .strict(),
  })
  .strict();

export type StoryNode = z.infer<typeof nodeSchema>;
export type Selection = {
  node: number;
  index: number;
  text: string;
  target: Route | null;
};
export type State = {
  version: 1;
  nodes: StoryNode[];
  selections: Selection[];
  route: Route | null;
  pending: boolean;
  partial?: Partial<StoryNode>;
  memory: StoryNode["memory"];
  profiles?: CharacterProfile[];
  storyTitle?: string;
  storyTone?: string;
  worldState: StoryState;
  lifeEventPlan?: LifeEventPlan;
};

function defaultProfiles(): CharacterProfile[] {
  return ["m1", "m3", "f2", "f4"].map((id) => {
    const member = castPool.find((candidate) => candidate.id === id);
    if (!member) throw new Error("默认角色池不完整。");
    return { id: member.id, name: member.name, gender: member.gender };
  });
}

export function canonicalProfiles(
  input: CharacterProfile[] = defaultProfiles(),
): CharacterProfile[] {
  if (input.length !== requiredCastCount)
    throw new Error(`必须选择${requiredCastCount}位角色。`);
  const seen = new Set<string>();
  return input.map((profile) => {
    if (seen.has(profile.id)) throw new Error("角色不能重复选择。");
    seen.add(profile.id);
    const member = castPool.find((candidate) => candidate.id === profile.id);
    if (!member || member.gender !== profile.gender)
      throw new Error("角色资料与当前角色池不一致。");
    return {
      id: member.id,
      name: member.name,
      gender: member.gender,
      background: profile.background?.trim().slice(0, 300) || undefined,
      zhihuHandle: profile.zhihuHandle?.trim().slice(0, 80) || undefined,
    };
  });
}

export function selectedCast(state: Pick<State, "profiles">): CastMember[] {
  return canonicalProfiles(state.profiles).map((profile) => {
    const member = castPool.find((candidate) => candidate.id === profile.id);
    if (!member) throw new Error("角色资料不存在。");
    return {
      ...member,
      ...privateCast[member.id],
      background: profile.background,
      zhihuHandle: profile.zhihuHandle,
    };
  });
}

export function selectedIds(state: Pick<State, "profiles">): string[] {
  return selectedCast(state).map((member) => member.id);
}

function emptyRelationships(
  profiles: CharacterProfile[],
): Record<string, number> {
  return Object.fromEntries(profiles.map((profile) => [profile.id, 0]));
}

export function initial(
  profiles: CharacterProfile[] = defaultProfiles(),
  storySeed?: string,
): State {
  const canonical = canonicalProfiles(profiles);
  const seed = storySeed || canonical.map((profile) => profile.id).join(":");
  return {
    version: 1,
    nodes: [],
    selections: [],
    route: null,
    pending: true,
    memory: { summary: "", facts: [] },
    profiles: canonical,
    worldState: {
      relationships: emptyRelationships(canonical),
      flags: [],
      timeline: [],
      usedLifeEventIds: [],
    },
    lifeEventPlan: planLifeEvents(seed),
  };
}

function ensureLifeEventState(state: State) {
  const profiles = canonicalProfiles(state.profiles);
  state.lifeEventPlan ??= planLifeEvents(
    profiles.map((profile) => profile.id).join(":"),
  );
  state.worldState ??= {
    relationships: emptyRelationships(profiles),
    flags: [],
    timeline: [],
    usedLifeEventIds: [],
  };
  state.worldState.usedLifeEventIds ??= [];
  return state.lifeEventPlan;
}

export function choose(state: State, index: number, expected: number) {
  const routeIds = selectedIds(state);
  const eventPlan = ensureLifeEventState(state);
  for (const id of routeIds) state.worldState.relationships[id] ??= 0;
  if (
    expected !== state.nodes.length ||
    state.pending ||
    state.nodes.length === total
  )
    throw new Error("剧情进度已变化，请刷新后继续。");
  const choices = state.nodes.at(-1)?.choices;
  const picked = choices?.[index];
  if (!Number.isInteger(index) || !picked) throw new Error("无效的选项。");
  state.selections.push({ node: state.nodes.length - 1, index, ...picked });
  if (picked.target) {
    if (!routeIds.includes(picked.target))
      throw new Error("选项目标不属于当前角色。");
    state.worldState.relationships[picked.target] += 1;
  }
  const { lifeStage, event } = lifeEventForStoryStage(
    eventPlan,
    state.nodes.length - 1,
  );
  if (!state.worldState.usedLifeEventIds!.includes(event.id))
    state.worldState.usedLifeEventIds!.push(event.id);
  const eventFlag = `life-event:${event.id}`;
  if (!state.worldState.flags.includes(eventFlag))
    state.worldState.flags.push(eventFlag);
  state.worldState.timeline.push(
    `第${state.nodes.length}段（${LIFE_STAGE_LABELS[lifeStage]}·${event.title}）选择：${picked.text}`,
  );
  const commonStages = beats.filter((beat) => beat.kind === "common").length;
  if (state.selections.length === commonStages) {
    const scores = Object.fromEntries(
      routeIds.map((id) => [
        id,
        state.selections.filter((selection) => selection.target === id).length,
      ]),
    );
    const max = Math.max(...Object.values(scores));
    const latest = [...state.selections]
      .reverse()
      .find(
        (selection) => selection.target && scores[selection.target] === max,
      );
    if (!latest?.target) throw new Error("共同篇没有形成可锁定的人物。");
    state.route = latest.target;
  }
  state.pending = true;
}

function commonFallback(member: CastMember, index: number) {
  const texts = [
    `先回应${member.name}`,
    `和${member.name}一起收尾`,
    `接住${member.name}的提议`,
    `请${member.name}说说想法`,
  ];
  return { text: texts[index % texts.length], target: member.id };
}

function normalizeChoices(
  state: State,
  input: StoryNode["choices"],
): StoryNode["choices"] {
  const stage = state.nodes.length;
  if (isEndingStage(stage)) return [];

  if (isCommonStage(stage)) {
    const members = selectedCast(state);
    const byTarget = new Map<string, StoryNode["choices"][number]>();
    for (const choice of input) {
      if (
        choice.target &&
        members.some((member) => member.id === choice.target) &&
        !byTarget.has(choice.target)
      ) {
        byTarget.set(choice.target, choice);
      }
    }
    return members.map(
      (member, index) =>
        byTarget.get(member.id) ?? commonFallback(member, index),
    );
  }

  const normalized = input.map((choice) => ({ ...choice, target: null }));
  const fallbacks = [
    { text: "继续当前行动", target: null },
    { text: "放慢一步再回应", target: null },
    { text: "说出自己的顾虑", target: null },
  ];
  for (const fallback of fallbacks) {
    if (normalized.length >= limits.routeChoiceMin) break;
    normalized.push(fallback);
  }
  return normalized.slice(0, limits.routeChoiceMax);
}

export function validate(raw: unknown, state: State): StoryNode {
  const parsed = nodeSchema.parse(raw);
  const choices = normalizeChoices(state, parsed.choices);
  const node: StoryNode = {
    ...parsed,
    choices,
    lines: parsed.lines.map((line) => ({
      ...line,
      speaker: line.speaker === "我" ? player.name : line.speaker,
    })),
  };

  const allowedSpeakers = [
    "旁白",
    player.name,
    ...selectedCast(state).map((member) => member.name),
  ];
  for (const line of node.lines) {
    if (!allowedSpeakers.includes(line.speaker))
      throw new Error("speaker必须使用当前所选角色姓名或旁白");
  }

  const length = node.lines.reduce((sum, line) => sum + count(line.text), 0);
  if (
    state.nodes.length &&
    node.lines.map((line) => line.text).join("\n") ===
      state.nodes
        .at(-1)!
        .lines.map((line) => line.text)
        .join("\n")
  )
    throw new Error("本段正文与上一段完全重复，必须推进上一选择及当前事件");
  if (length < limits.minEffectiveChars || length > limits.maxEffectiveChars)
    throw new Error(
      `正文${length}字，要求${limits.minEffectiveChars}至${limits.maxEffectiveChars}字，建议${limits.targetEffectiveChars}字左右`,
    );

  const stage = state.nodes.length;
  if (
    isEndingStage(stage)
      ? node.choices.length !== 0
      : node.choices.length < limits.routeChoiceMin
  )
    throw new Error("选项数量不符合当前阶段要求");
  if (
    new Set(node.choices.map((choice) => choice.text)).size !==
    node.choices.length
  )
    throw new Error("选项不能重复");
  if (isCommonStage(stage)) {
    const routeIds = selectedIds(state);
    if (
      node.choices.length !== requiredCastCount ||
      routeIds.some(
        (id) => !node.choices.some((choice) => choice.target === id),
      )
    )
      throw new Error("共同篇选项必须分别对应当前全部角色");
  }
  if (
    stageKind(stage) === "route" &&
    node.choices.some((choice) => choice.target !== null)
  )
    throw new Error("个人线target必须为null");
  if (stage === 0) {
    const names = selectedCast(state).map((member) => member.name);
    if (names.some((name) => !node.lines.some((line) => line.speaker === name)))
      throw new Error("开场四位角色必须各有台词");
  }
  return node;
}

type ExampleEntry = { example: number; text: string; effective_chars: number };
type ExampleStory = {
  id: string;
  stageKey: string;
  label: string;
  source: string;
  examples: ExampleEntry[];
};
type ReferenceSegment = {
  id: string;
  order: number;
  stageKey: string;
  heading: string;
  text: string;
  effective_chars: number;
};
type ReferenceStory = {
  version: number;
  title: string;
  source: string;
  note: string;
  segments: ReferenceSegment[];
};
const exampleStories = (examples as unknown as { stories: ExampleStory[] })
  .stories;
const referenceStory = storyReference as ReferenceStory;

if (
  referenceStory.segments.length !== beats.length ||
  referenceStory.segments.some(
    (segment, index) =>
      segment.stageKey !== beats[index]?.id || !segment.text.trim(),
  )
)
  throw new Error("完整范本故事必须按 BEATS 顺序覆盖全部剧情阶段。");

export function selectExamples(stage: number) {
  const beat = beatFor(stage);
  const stories = exampleStories.filter((story) => story.stageKey === beat.id);
  if (!stories.length) throw new Error(`阶段${beat.id}没有可用的写作范例。`);
  return stories.flatMap((story) =>
    story.examples.map((item) => ({
      stageKey: story.stageKey,
      sourceId: story.id,
      label: story.label,
      source: story.source,
      example: item.example,
      effective_chars: item.effective_chars,
      text: item.text,
    })),
  );
}

export function selectReferenceStory() {
  return structuredClone(referenceStory);
}

function listOrNone(items: string[]) {
  return items.length ? items.join("、") : "无";
}

function renderWorldState(state: State) {
  ensureLifeEventState(state);
  const relationships = selectedCast(state).map(
    (member) =>
      `${member.id}(${member.name})=${state.worldState.relationships[member.id] ?? 0}`,
  );
  const timeline = state.worldState.timeline.length
    ? state.worldState.timeline
        .map((entry, index) => `${index + 1}. ${entry}`)
        .join("\n")
    : "暂无";
  return [
    `角色关系：${listOrNone(relationships)}`,
    `已记录事实：${listOrNone(state.worldState.flags)}`,
    `已经历主题事件：${listOrNone(state.worldState.usedLifeEventIds || [])}`,
    `行动时间线：\n${timeline}`,
  ].join("\n");
}

function renderHistory(state: State) {
  if (!state.nodes.length) return "暂无。";
  return state.nodes
    .map((node, index) =>
      [
        `第${index + 1}段：${node.title}`,
        ...node.lines.map((line) => `[${line.speaker}] ${line.text}`),
        `选项：${listOrNone(node.choices.map((choice) => `${choice.text}${choice.target ? ` -> ${choice.target}` : ""}`))}`,
      ].join("\n"),
    )
    .join("\n\n");
}

function renderReference(stageId: string) {
  return [
    `标题：${referenceStory.title}`,
    `用途：${referenceStory.note}`,
    ...referenceStory.segments.map(
      (segment) =>
        `## ${segment.heading}${segment.stageKey === stageId ? "（当前阶段对应段落）" : ""}\n${segment.text}`,
    ),
  ].join("\n\n");
}

function renderExamples(stage: number) {
  const selected = selectExamples(stage);
  return selected
    .map((example, index) =>
      [
        `参考片段 ${String(index + 1).padStart(2, "0")}｜${example.label}｜${example.sourceId}｜${example.effective_chars}字`,
        `事件：${example.source}`,
        example.text,
      ].join("\n"),
    )
    .join("\n\n");
}

function renderChoiceContract(beat: Beat, routeIds: string[]) {
  if (beat.kind === "common") {
    return `输出${requiredCastCount}个选项，target 分别覆盖 ${routeIds.join("、")}，每个当前角色恰好一次；选项写具体行动，不写“进入某人路线”。`;
  }
  if (beat.kind === "route") {
    return `输出${limits.routeChoiceMin}至${limits.routeChoiceMax}个选项，所有 target 均为 null；至少一个选项允许放慢关系，不能只写询问或查看。`;
  }
  return "结局不输出选项，choices 必须为空数组。";
}

export function promptText(state: State) {
  const beat = beatFor(state.nodes.length);
  const { lifeStage, event: lifeEvent } = lifeEventForStoryStage(
    ensureLifeEventState(state),
    state.nodes.length,
  );
  const selected = selectedCast(state);
  const cards = selected.map((member) =>
    state.route && member.id !== state.route
      ? {
          id: member.id,
          name: member.name,
          gender: member.gender,
          age: member.age,
          identity: member.identity,
          background: member.background,
          zhihuHandle: member.zhihuHandle,
        }
      : member,
  );
  const latest = state.selections.at(-1);
  const routeIds = selected.map((member) => member.id);
  const lockedMember = selected.find((member) => member.id === state.route);
  const castText = cards
    .map((member) =>
      [
        `- ${member.id}｜${member.name}｜${member.gender}｜成年档案：${member.age}岁｜${member.identity}`,
        member.background ? `背景：${member.background}` : null,
        member.zhihuHandle ? `知乎账号：${member.zhihuHandle}` : null,
        "voice" in member && member.voice ? `说话方式：${member.voice}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n");
  const history = renderHistory(state);
  const previousTail =
    state.nodes
      .at(-1)
      ?.lines.map((line) => line.text)
      .join("\n")
      .slice(-240) || "暂无。";
  const nextAction = latest
    ? `先执行玩家刚选择的【${latest.text}】并给出具体结果；玩家选择必须真实发生，不能重写或跳过。`
    : "这是开场片段，必须建立第一件具体的小事，并让当前全部角色各有独特行动或台词。";

  return [
    `【本轮必须执行】\n${nextAction}`,
    `【阶段】\n第 ${state.nodes.length + 1} / ${total} 段｜${beat.id}｜${beat.kind}\n任务：${beat.task}`,
    `【人生选择事件｜必须成为本段核心】\n${renderLifeEvent(lifeEvent, lifeStage)}\n\n必须让事件中的现实冲突、可见代价和人物关系进入本段。选项由当前剧情协议决定数量，但行动机制必须取自模板 A/B/C；若共同篇需要第 4 个角色选项，应设计一个有独立代价的协作行动，不得复制前三项。不要直接照抄模板句子，不要保证成功。上一选择若属于同一事件，本段先兑现相应即时后果；进入下一人生阶段时，保留前一阶段形成的关系变化与未解决问题。`,
    `【玩家与世界】\n玩家当前档案：${player.name}，${player.age}岁，${player.identity}\n本段处于${LIFE_STAGE_LABELS[lifeStage]}，回忆中的主角约 ${LIFE_STAGE_AGES[lifeStage]}；其他角色的年龄与身份必须随该阶段合理调整，不能把成年职业直接带回高中。\n故事前提：${storyPublic.premise}\n可用地点：${listOrNone(storyPublic.locations)}\n当前角色：\n${castText}`,
    `【已选路线】\n${lockedMember ? `${lockedMember.id}(${lockedMember.name})` : "尚未锁定。"}${state.route ? "；后续只能推进该角色关系。" : ""}`,
    `【标题规则】\n${state.nodes.length === 0 ? "本段 title 同时作为整部故事标题；根据当前世界、角色和基调自行生成，不使用固定标题。" : `沿用已生成标题「${state.storyTitle || "未命名"}」与基调，不改写。`}`,
    `【选择规则】\n${renderChoiceContract(beat, routeIds)}`,
    `【当前状态】\n${renderWorldState(state)}`,
    `【完整范本故事｜全文完整注入】\n${renderReference(beat.id)}`,
    `【同阶段参考片段｜完整注入】\n以下共 ${selectExamples(state.nodes.length).length} 条，均来自当前阶段 ${beat.id}。只学习结构、节奏、动作和因果，不复制原句、人名、世界观或专有名词。\n\n${renderExamples(state.nodes.length)}`,
    `【已经发生的剧情｜不可改写】\n${history}`,
    `【上一段收尾】\n${previousTail}`,
    `【长期记忆】\n摘要：${state.memory.summary || "暂无"}\n事实：${listOrNone(state.memory.facts)}`,
  ].join("\n\n");
}

export function continuationMessage(state: State, issue: string, next: string) {
  const partial = state.partial;
  const delivered = partial?.lines?.length
    ? partial.lines.map((line) => `[${line.speaker}] ${line.text}`).join("\n")
    : "暂无。";
  return [
    `【续写要求｜最高优先级】\n${next}`,
    `【已发送且不可重写】\n标题：${partial?.title || "尚未发送"}\n${delivered}`,
    `【纠错信息】\n${issue || "无。"}`,
    "【输出硬约束】\n只从下一条缺失记录开始续写。已经发送的标题和正文禁止再次输出；如果标题已存在，本次绝不能再次输出 [SCENE]。不要重新生成整段，不要解释，不要输出 Markdown。",
  ].join("\n\n");
}

export function protocolInstruction(state: State) {
  const beat = beatFor(state.nodes.length);
  const selected = selectedCast(state);
  const targetRule =
    beat.kind === "common"
      ? `必须输出${requiredCastCount}个选项，target分别覆盖${selected.map((member) => `${member.id}(${member.name})`).join("、")}，每个角色恰好一次`
      : beat.kind === "route"
        ? `必须输出${limits.routeChoiceMin}至${limits.routeChoiceMax}个选项，所有target均为JSON null`
        : '结局必须输出空数组：[CHOICES] {"items":[]}';
  return `你必须输出固定标签文本协议，每行一条记录，禁止Markdown围栏。严格顺序：
[SCENE] 本段短标题
[NPC:旁白] 一条叙述
[NPC:角色名] 一句对白
重复NPC，整段正文${limits.minEffectiveChars}至${limits.maxEffectiveChars}有效字，目标${limits.targetEffectiveChars}字、${limits.targetLinesMin}至${limits.targetLinesMax}条。
[CHOICES] {"items":[{"text":"行动","target":null}]}
[MEMORY] {"summary":"累计事实","facts":["事实"]}
[END]
${targetRule}；只生成当前片段，不输出解释。`;
}

export function nextInstruction(state: State) {
  const written = (state.partial?.lines || []).reduce(
    (sum, line) => sum + count(line.text),
    0,
  );
  if (state.partial?.memory)
    return "本次必须只输出end；禁止输出scene、line、choices或memory。";
  if (state.partial?.choices)
    return "本次必须只输出memory，然后end；禁止输出scene、line或choices。";
  if (written >= limits.minEffectiveChars)
    return "本次直接输出choices，然后memory和end；禁止输出scene或line。";
  return `正文目前${written}字，还缺至少${Math.max(0, limits.minEffectiveChars - written)}字。本次只能继续输出新的line对白记录，不能输出scene或choices；达到${limits.minEffectiveChars}字后再进入下一轮。最多可写到${limits.maxEffectiveChars}字。`;
}

export function buildModelMessages(state: State, issue = "") {
  const messages = [
    {
      role: "system" as const,
      content: `${config.SYSTEM}\n\n${protocolInstruction(state)}`,
    },
    {
      role: "user" as const,
      content: promptText(state),
    },
    {
      role: "user" as const,
      content: continuationMessage(state, issue, nextInstruction(state)),
    },
  ];
  if (messages.some((message) => typeof message.content !== "string"))
    throw new Error("消息content必须是字符串");
  return messages;
}

export function messages(state: State) {
  return [
    {
      role: "system",
      content: config.SYSTEM,
    },
    {
      role: "user",
      content: promptText(state),
    },
  ];
}

export function publicState(state: State) {
  const stageIndex = Math.min(state.nodes.length, total - 1);
  const { lifeStage, event } = lifeEventForStoryStage(
    ensureLifeEventState(state),
    stageIndex,
  );
  return {
    storyTitle: state.storyTitle,
    storyTone: state.storyTone,
    worldState: state.worldState,
    lifeStage: {
      id: lifeStage,
      label: LIFE_STAGE_LABELS[lifeStage],
      ageRange: LIFE_STAGE_AGES[lifeStage],
    },
    lifeEvent: { id: event.id, title: event.title, domain: event.domain },
    world: {
      player,
      premise: storyPublic.premise,
      locations: storyPublic.locations,
      cast: selectedCast(state).map(
        ({ id, name, gender, age, identity, background, zhihuHandle }) => ({
          id,
          name,
          gender,
          age,
          identity,
          background,
          zhihuHandle,
        }),
      ),
    },
    partial: state.partial
      ? {
          title: state.partial.title,
          lines: state.partial.lines || [],
          choices:
            state.partial.choices?.map((choice) => ({ text: choice.text })) ||
            [],
        }
      : null,
    nodes: state.nodes.map((node) => ({
      title: node.title,
      lines: node.lines,
      choices: node.choices.map((choice) => ({ text: choice.text })),
      readingSeconds:
        node.lines.reduce((sum, line) => sum + count(line.text), 0) / 5,
    })),
    route: state.route,
    selections: state.selections.map((selection) => ({
      node: selection.node,
      index: selection.index,
    })),
    pending: state.pending,
    total,
    complete: state.nodes.length === total,
  };
}

export type PublicState = ReturnType<typeof publicState>;
export type GameEvent =
  | {
      type: "status";
      phase: "generating" | "validating" | "repairing" | "translating";
      message: string;
    }
  | { type: "scene"; segment: number; title: string; readingSeconds: number }
  | { type: "line"; index: number; speaker: string; text: string }
  | { type: "choices"; items: { text: string }[] }
  | { type: "done"; state: PublicState }
  | { type: "error"; message: string };

export function eventsFor(node: StoryNode, state: State): GameEvent[] {
  return [
    {
      type: "scene",
      segment: state.nodes.length,
      title: node.title,
      readingSeconds:
        node.lines.reduce((sum, line) => sum + count(line.text), 0) / 5,
    },
    ...node.lines.map((line, index) => ({
      type: "line" as const,
      index,
      ...line,
    })),
    {
      type: "choices",
      items: node.choices.map((choice) => ({ text: choice.text })),
    },
    { type: "done", state: publicState(state) },
  ];
}
