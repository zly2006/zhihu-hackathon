import test from "node:test";
import assert from "node:assert/strict";
import {
  buildModelMessages,
  castPool,
  choose,
  continuationMessage,
  initial,
  isCommonStage,
  isEndingStage,
  limits,
  messages,
  nodeSchema,
  requiredCastCount,
  selectExamples,
  selectReferenceStory,
  selectedCast,
  selectedIds,
  total,
  validate,
  type CharacterProfile,
  type State,
  type StoryNode,
} from "./story";
import { JsonlDecoder, acceptRecord } from "./protocol";
import { TaggedDecoder, parseTagged } from "./tagged-protocol";

const selectedIdsForTest = ["m1", "m3", "f2", "f4"];
const profiles: CharacterProfile[] = selectedIdsForTest.map((id) => {
  const member = castPool.find((candidate) => candidate.id === id)!;
  return { id: member.id, name: member.name, gender: member.gender };
});
const record = (value: unknown) => JSON.stringify(value);

function linesFor(state: State) {
  const names = selectedCast(state).map((member) => member.name);
  return names.map((speaker) => ({ speaker, text: "字".repeat(60) }));
}

function commonChoices(state: State) {
  return selectedCast(state).map((member) => ({
    text: `请${member.name}一起收尾`,
    target: member.id,
  }));
}

function routeChoices() {
  return [
    { text: "继续当前行动", target: null },
    { text: "放慢一步再回应", target: null },
  ];
}

function makeNode(
  state: State,
  choices: StoryNode["choices"],
  textPrefix = "",
): StoryNode {
  return {
    title: "雨停之前",
    lines: linesFor(state).map((line) => ({
      ...line,
      text: `${textPrefix}${line.text}`.slice(0, limits.maxLineChars),
    })),
    choices,
    memory: { summary: "", facts: [] },
  };
}

function stateAtStage(stage: number) {
  const state = initial(profiles);
  state.nodes = Array.from({ length: stage }, (_, index) =>
    makeNode(state, [], `第${index + 1}段`),
  );
  return state;
}

test("profile selection requires exactly four unique characters from the eight-person pool", () => {
  assert.equal(castPool.length, 8);
  assert.equal(requiredCastCount, 4);
  assert.equal(initial(profiles).profiles?.length, 4);
  assert.throws(() => initial(profiles.slice(0, 3)), /必须选择4位角色/);
  assert.throws(
    () => initial([...profiles.slice(0, 3), profiles[0]]),
    /角色不能重复选择/,
  );
  assert.throws(
    () => initial([...profiles.slice(0, 3), { ...profiles[0], id: "unknown" }]),
    /角色资料与当前角色池不一致/,
  );
});

test("three common choices lock the latest tied route and later route choices cannot change it", () => {
  const state = initial(profiles);
  const votes = ["m1", "m3", "f2"];
  for (const [round, target] of votes.entries()) {
    const node = validate(
      makeNode(state, commonChoices(state), `第${round + 1}轮`),
      state,
    );
    state.nodes.push(node);
    state.pending = false;
    const index = node.choices.findIndex((choice) => choice.target === target);
    choose(state, index, state.nodes.length);
  }
  assert.equal(state.route, "f2");

  const routeNode = validate(makeNode(state, routeChoices()), state);
  state.nodes.push(routeNode);
  state.pending = false;
  choose(state, 0, state.nodes.length);
  assert.equal(state.route, "f2");
});

test("common choices cover all current characters while personal and ending choices use the locked protocol", () => {
  const commonState = initial(profiles);
  const common = validate(
    makeNode(commonState, commonChoices(commonState)),
    commonState,
  );
  assert.equal(common.choices.length, requiredCastCount);
  assert.deepEqual(
    new Set(common.choices.map((choice) => choice.target)),
    new Set(selectedIdsForTest),
  );

  const routeState = stateAtStage(3);
  const route = validate(
    makeNode(routeState, [
      { text: "先和顾言川确认安排", target: "m1" },
      { text: "暂时继续行动", target: null },
    ]),
    routeState,
  );
  assert.ok(route.choices.every((choice) => choice.target === null));

  const endingState = stateAtStage(total - 1);
  assert.equal(isEndingStage(total - 1), true);
  const ending = validate(makeNode(endingState, routeChoices()), endingState);
  assert.deepEqual(ending.choices, []);
});

test("speakers are limited to narration, the player, and the four selected characters", () => {
  const state = initial(profiles);
  const outsider = castPool.find(
    (member) => !selectedIdsForTest.includes(member.id),
  )!;
  const node = makeNode(state, commonChoices(state));
  node.lines[0].speaker = outsider.name;
  assert.throws(
    () => validate(node, state),
    /speaker必须使用当前所选角色姓名或旁白/,
  );
});

test("every structured beat has reachable examples and the ending includes closing material", () => {
  assert.equal(total, 7);
  for (let stage = 0; stage < total; stage += 1) {
    const examples = selectExamples(stage);
    assert.ok(
      examples.length >= 15,
      `stage ${stage} should expose its complete example group`,
    );
    if (isEndingStage(stage)) {
      assert.ok(
        examples.some((example) =>
          ["约会与告别·宁宁", "重逢与长久相伴·宁宁"].includes(example.label),
        ),
      );
    }
  }
});

test("prompt messages are plain text and inject the complete reference story plus every current-stage example", () => {
  const state = initial(profiles);
  const [system, user] = messages(state);
  assert.equal(typeof system.content, "string");
  assert.equal(typeof user.content, "string");
  assert.doesNotMatch(system.content, /reference_examples/);
  assert.match(system.content, /完整范本故事/);
  assert.equal(user.content.trim().startsWith("{"), false);
  assert.doesNotMatch(user.content, /"reference_examples"\s*:/);

  const reference = selectReferenceStory();
  assert.equal(reference.segments.length, total);
  assert.ok(
    reference.segments.reduce(
      (sum, segment) => sum + segment.effective_chars,
      0,
    ) >= 1800,
  );
  for (const segment of reference.segments) {
    assert.match(
      user.content,
      new RegExp(segment.heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    assert.ok(user.content.includes(segment.text));
  }

  const currentExamples = selectExamples(0);
  assert.ok(currentExamples.length >= 15);
  for (const example of currentExamples)
    assert.ok(user.content.includes(example.text));

  const continuation = continuationMessage(
    { ...state, partial: { title: "已发送标题" } },
    "",
    "继续补足正文。",
  );
  assert.equal(typeof continuation, "string");
  assert.equal(continuation.trim().startsWith("{"), false);
  assert.doesNotMatch(continuation, /"already_sent"\s*:/);
  assert.match(continuation, /绝不能再次输出 \[SCENE\]/);

  const actual = buildModelMessages(state);
  assert.equal(actual.length, 3);
  assert.deepEqual(
    actual.map((message) => typeof message.content),
    ["string", "string", "string"],
  );
  assert.match(actual[0].content, /\[SCENE\] 本段短标题/);
  assert.match(actual[1].content, /【完整范本故事｜全文完整注入】/);
  assert.match(actual[2].content, /【续写要求｜最高优先级】/);
});

test("prompt injects the planned campus event with relationship and delayed consequences", () => {
  const state = initial(profiles, "prompt-life-event");
  const eventId = state.lifeEventPlan?.["high-school"];
  assert.ok(eventId);
  const prompt = buildModelMessages(state)[1].content;
  assert.match(prompt, /【人生选择事件｜必须成为本段核心】/);
  assert.match(prompt, new RegExp(eventId));
  assert.match(prompt, /关系变化/);
  assert.match(prompt, /延迟收益/);
  assert.match(prompt, /延迟风险/);
});

test("choosing records the event and advancing the story switches life stages", () => {
  const state = initial(profiles, "timeline-life-event");
  const highSchoolEvent = state.lifeEventPlan!["high-school"];
  state.nodes.push(makeNode(state, commonChoices(state)));
  state.pending = false;
  choose(state, 0, 1);
  assert.deepEqual(state.worldState.usedLifeEventIds, [highSchoolEvent]);
  assert.ok(state.worldState.flags.includes(`life-event:${highSchoolEvent}`));
  assert.match(state.worldState.timeline[0], /高中/);

  state.nodes.push(makeNode(state, commonChoices(state), "第二段"));
  state.pending = false;
  choose(state, 1, 2);
  state.nodes.push(makeNode(state, commonChoices(state), "第三段"));
  assert.match(buildModelMessages(state)[1].content, /人生阶段：本科/);
  assert.match(
    buildModelMessages(state)[1].content,
    new RegExp(state.lifeEventPlan!.university),
  );
});

test("a complete tagged-style record stream emits before later bytes and can be validated after end", () => {
  const decoder = new JsonlDecoder();
  const state = initial(profiles);
  acceptRecord(record({ type: "scene", title: "灯下" }), state);
  assert.deepEqual(
    decoder.push('{"type":"line","speaker":"旁白","text":"第一'),
    [],
  );
  const rows = decoder.push('句已经到了。"}\n{"type":"line"');
  assert.equal(rows.length, 1);
  const result = acceptRecord(rows[0], state);
  assert.equal(result.event?.type, "line");
  assert.equal(state.partial?.lines?.length, 1);
  assert.equal(state.nodes.length, 0);
});

test("invalid speaker or oversized text cannot mutate state, while the player alias is normalized", () => {
  const state = initial(profiles);
  acceptRecord(record({ type: "scene", title: "灯下" }), state);
  const before = structuredClone(state);
  assert.throws(() =>
    acceptRecord(
      record({ type: "line", speaker: "陌生人", text: "不能进入对白。" }),
      state,
    ),
  );
  assert.deepEqual(state, before);
  const playerLine = acceptRecord(
    record({ type: "line", speaker: "我", text: "我是玩家。" }),
    state,
  );
  assert.equal(
    playerLine.event?.type === "line" && playerLine.event.speaker,
    "许澄",
  );
  assert.throws(() =>
    acceptRecord(
      record({
        type: "line",
        speaker: "旁白",
        text: "字".repeat(limits.maxLineChars + 1),
      }),
      state,
    ),
  );
});

test("common choices require a complete body, expose four dynamic targets, and memory stays private", () => {
  const state = initial(profiles);
  acceptRecord(record({ type: "scene", title: "灯下" }), state);
  assert.throws(() =>
    acceptRecord(
      record({ type: "choices", items: commonChoices(state) }),
      state,
    ),
  );
  for (const line of linesFor(state))
    acceptRecord(record({ type: "line", ...line }), state);
  const choiceRecord = acceptRecord(
    record({ type: "choices", items: commonChoices(state) }),
    state,
  );
  assert.equal(choiceRecord.event?.type, "choices");
  assert.equal(state.partial?.choices?.length, requiredCastCount);
  assert.equal(
    acceptRecord(
      record({ type: "memory", summary: "灯还亮着", facts: ["四人在场"] }),
      state,
    ).event,
    undefined,
  );
  assert.equal(acceptRecord(record({ type: "end" }), state).ended, true);
  assert.equal(isCommonStage(0), true);
  assert.doesNotThrow(() => nodeSchema.parse(state.partial));
});

test("duplicate or stale choices do not add selections", () => {
  const state = initial(profiles);
  state.nodes.push(makeNode(state, commonChoices(state)));
  state.pending = false;
  choose(state, 0, 1);
  assert.throws(() => choose(state, 1, 1), /剧情进度已变化/);
  assert.equal(state.selections.length, 1);
});

test("tagged protocol parses player, scene, dialogue, and structured blocks without fixed cast ids", () => {
  const decoder = new TaggedDecoder();
  assert.deepEqual(
    decoder.push("[SCENE] 雨夜\n[NPC:顾言川] 先把展示桌收好\n"),
    ["[SCENE] 雨夜", "[NPC:顾言川] 先把展示桌收好"],
  );
  assert.deepEqual(
    parseTagged(
      '[CHOICES] {"items":[{"text":"继续整理速写","target":"m1"},{"text":"先停下来等等","target":null}]}',
    ),
    {
      type: "choices",
      items: [
        { text: "继续整理速写", target: "m1" },
        { text: "先停下来等等", target: null },
      ],
    },
  );
  assert.deepEqual(parseTagged("[PLAYER] 好，我来帮你"), {
    type: "line",
    speaker: "我",
    text: "好，我来帮你",
  });
});

test("tagged protocol rejects unknown or malformed records", () => {
  assert.throws(() => parseTagged("[NPC1] 错误标签"));
  assert.throws(() =>
    parseTagged('[CHOICES] {"items":[{"text":"x","target":null}]}'),
  );
});
