import test from 'node:test';
import assert from 'node:assert/strict';
import {
  backgroundFor,
  beatForState,
  buildModelMessages,
  castPool,
  choose,
  continuationMessage,
  initial,
  isCommonStage,
  isEndingStage,
  limits,
  maxStages,
  messages,
  nextInstruction,
  nodeSchema,
  publicBackgrounds,
  publicState,
  resolveEnding,
  requiredCastCount,
  selectExamples,
  selectReferenceStory,
  selectedCast,
  selectedIds,
  selectedLifeEvent,
  selectedModule,
  totalForState,
  validate,
  type CharacterProfile,
  type StartOptions,
  type State,
  type StoryNode,
} from './story';
import { JsonlDecoder, acceptRecord } from './protocol';
import { TaggedDecoder, parseTagged } from './tagged-protocol';

const selectedIdsForTest = ['m1', 'm3', 'f2', 'f4'];
const profiles: CharacterProfile[] = selectedIdsForTest.map((id) => {
  const member = castPool.find((candidate) => candidate.id === id)!;
  return { id: member.id, name: member.name, gender: member.gender };
});
const startOptions: StartOptions = { backgroundId: 'university', playerName: '许澄', playerGender: '女', seed: 'test-seed' };
const record = (value: unknown) => JSON.stringify(value);

function linesFor(state: State) {
  const names = selectedCast(state).map((member) => member.name);
  return names.map((speaker) => ({ speaker, text: '字'.repeat(60) }));
}

function commonChoices(state: State) {
  return selectedCast(state).map((member) => ({ text: `请${member.name}一起处理`, target: member.id }));
}

function routeChoices() {
  return [
    { text: '继续当前行动', target: null },
    { text: '放慢一步再回应', target: null },
  ];
}

function makeNode(state: State, choices: StoryNode['choices'], textPrefix = ''): StoryNode {
  return {
    title: '最后一项安排',
    lines: linesFor(state).map((line) => ({ ...line, text: `${textPrefix}${line.text}`.slice(0, limits.maxLineChars) })),
    choices,
    memory: { summary: '', facts: [] },
  };
}

function appendNode(state: State, node: StoryNode) {
  state.nodes.push(node);
  state.pending = false;
}

function chooseTarget(state: State, target: string) {
  const node = validate(makeNode(state, commonChoices(state), `第${state.nodes.length}段`), state);
  appendNode(state, node);
  const index = node.choices.findIndex((choice) => choice.target === target);
  choose(state, index, state.nodes.length);
}

function lockedState(target = 'm1', options: StartOptions = startOptions) {
  const state = initial(profiles, options);
  chooseTarget(state, target);
  chooseTarget(state, target);
  return state;
}

function advanceRoute(state: State, index = 0) {
  const node = validate(makeNode(state, routeChoices(), `路线${state.nodes.length}`), state);
  appendNode(state, node);
  choose(state, index, state.nodes.length);
}

test('opening selection requires four unique characters, a life background, and player data', () => {
  assert.equal(castPool.length, 8);
  assert.equal(requiredCastCount, 4);
  assert.equal(publicBackgrounds.length, 4);
  assert.equal(initial(profiles, startOptions).profiles?.length, 4);
  assert.equal(initial(profiles, startOptions).backgroundId, 'university');
  assert.throws(() => initial(profiles.slice(0, 3), startOptions), /必须选择4位角色/);
  assert.throws(() => initial([...profiles.slice(0, 3), profiles[0]], startOptions), /角色不能重复选择/);
  assert.throws(() => initial([...profiles.slice(0, 3), { ...profiles[0], id: 'unknown' }], startOptions), /角色资料与当前角色池不一致/);
  assert.throws(() => initial(profiles, { ...startOptions, backgroundId: 'unknown' }), /人生背景包不存在/);
});

test('two common choices lock the unique leader and produce a six-stage romance route', () => {
  const state = initial(profiles, startOptions);
  chooseTarget(state, 'm1');
  chooseTarget(state, 'm1');
  assert.equal(state.route, 'm1');
  assert.equal(state.relationshipType, 'romance');
  assert.equal(state.needsTiebreak, false);
  assert.equal(totalForState(state), 6);
  assert.equal(isCommonStage(state), false);
  assert.equal(beatForState(state).id, 'route-1');
});

test('a two-round tie adds a third common choice and same-gender lock enters the friendship route', () => {
  const state = initial(profiles, startOptions);
  chooseTarget(state, 'm1');
  chooseTarget(state, 'f2');
  assert.equal(state.route, null);
  assert.equal(state.needsTiebreak, true);
  assert.equal(totalForState(state), 7);
  chooseTarget(state, 'f2');
  assert.equal(state.route, 'f2');
  assert.equal(state.relationshipType, 'friendship');
  assert.equal(state.commonRounds, 3);
  assert.equal(totalForState(state), 7);
});

test('the final common node remains renderable before its tie-break choice', () => {
  const state = initial(profiles, startOptions);
  chooseTarget(state, 'm1');
  chooseTarget(state, 'f2');
  const finalCommon = validate(makeNode(state, commonChoices(state), '第三段'), state);
  appendNode(state, finalCommon);
  assert.equal(state.route, null);
  assert.doesNotThrow(() => publicState(state));
  assert.equal(publicState(state).stageKind, 'common');
  assert.equal(publicState(state).stageId, 'common-3');
  assert.doesNotThrow(() => buildModelMessages(state));
});

test('later route choices cannot change the locked character or relationship type', () => {
  const state = lockedState('m1');
  advanceRoute(state, 0);
  advanceRoute(state, 1);
  assert.equal(publicState(state).complete, false);
  advanceRoute(state, 0);
  assert.equal(state.route, 'm1');
  assert.equal(state.relationshipType, 'romance');
  assert.equal(isEndingStage(state), true);
  assert.equal(publicState(state).complete, false);

  const ending = validate(makeNode(state, routeChoices(), '结局'), state);
  appendNode(state, ending);
  assert.equal(publicState(state).complete, true);
});

test('common choices cover all selected characters while route and ending choices use their contracts', () => {
  const commonState = initial(profiles, startOptions);
  const common = validate(makeNode(commonState, commonChoices(commonState)), commonState);
  assert.equal(common.choices.length, requiredCastCount);
  assert.deepEqual(new Set(common.choices.map((choice) => choice.target)), new Set(selectedIdsForTest));

  const routeState = lockedState('m1');
  const route = validate(makeNode(routeState, [{ text: '先和顾言川确认安排', target: 'm1' }, { text: '暂时继续行动', target: null }]), routeState);
  assert.ok(route.choices.every((choice) => choice.target === null));

  advanceRoute(routeState);
  advanceRoute(routeState);
  advanceRoute(routeState);
  assert.equal(isEndingStage(routeState), true);
  const ending = validate(makeNode(routeState, routeChoices()), routeState);
  assert.deepEqual(ending.choices, []);
});

test('common choices select a route without consuming a life-choice option', () => {
  const state = initial(profiles, startOptions);
  const common = validate(makeNode(state, commonChoices(state)), state);
  assert.deepEqual(common.choices.map((choice) => choice.text), commonChoices(state).map((choice) => choice.text));
  appendNode(state, common);
  choose(state, 0, state.nodes.length);
  const selection = state.selections.at(-1);
  assert.equal(selection?.target, 'm1');
  assert.equal(selection?.optionId, undefined);
  assert.equal(selection?.outcome, undefined);
  assert.equal(selection?.evidence, undefined);
  assert.equal(state.worldState.relationships.m1, 1);
});

test('speakers are limited to narration, the named player, and the four selected characters', () => {
  const state = initial(profiles, startOptions);
  const outsider = castPool.find((member) => !selectedIdsForTest.includes(member.id))!;
  const node = makeNode(state, commonChoices(state));
  node.lines[0].speaker = outsider.name;
  assert.throws(() => validate(node, state), /speaker必须使用当前所选角色姓名或旁白/);
});

test('every base beat has complete examples and the reference story still covers the maximum seven-stage shape', () => {
  assert.equal(maxStages, 7);
  for (let stage = 0; stage < maxStages; stage += 1) {
    const examples = selectExamples(stage);
    assert.ok(examples.length >= 15, `stage ${stage} should expose its complete example group`);
  }
  const reference = selectReferenceStory();
  assert.equal(reference.segments.length, maxStages);
  assert.ok(reference.segments.reduce((sum, segment) => sum + segment.effective_chars, 0) >= 1800);
});

test('prompt messages are plain strings and inject background, life choice, module, route, and complete references', () => {
  const state = initial(profiles, startOptions);
  const [system, user] = messages(state);
  assert.equal(typeof system.content, 'string');
  assert.equal(typeof user.content, 'string');
  assert.match(system.content, /人生选择必须贯穿全文/);
  assert.match(system.content, /完整范本故事/);
  assert.equal(user.content.trim().startsWith('{'), false);
  assert.match(user.content, /人生背景与核心冲突/);
  assert.match(user.content, /专业与毕业去向/);
  assert.match(user.content, /本段剧情模块/);
  assert.match(user.content, /本段人生事件库/);
  assert.match(user.content, /具体处境/);
  assert.match(user.content, /恋爱线规则/);
  assert.match(user.content, /友情线规则/);

  const reference = selectReferenceStory();
  for (const segment of reference.segments) {
    assert.ok(user.content.includes(segment.text));
  }

  const continuation = continuationMessage({ ...state, partial: { title: '已发送标题' } }, '', '继续补足正文。');
  assert.equal(typeof continuation, 'string');
  assert.equal(continuation.trim().startsWith('{'), false);
  assert.match(continuation, /绝不能再次输出 \[SCENE\]/);

  const actual = buildModelMessages(state);
  assert.equal(actual.length, 3);
  assert.deepEqual(actual.map((message) => typeof message.content), ['string', 'string', 'string']);
  assert.match(actual[0].content, /\[SCENE\] 本段短标题/);
  assert.match(actual[1].content, /完整范本故事/);
  assert.match(actual[2].content, /续写要求/);
});

test('module selection is deterministic for the same story seed and reflects the selected background', () => {
  const university = initial(profiles, startOptions);
  const graduate = initial(profiles, { ...startOptions, backgroundId: 'graduate' });
  const beat = beatForState(university);
  const first = selectedModule(university, beat);
  const second = selectedModule(structuredClone(university), beat);
  const other = selectedModule(graduate, beatForState(graduate));
  assert.ok(first && second && other);
  assert.equal(first.id, second.id);
  assert.equal(backgroundFor(university.backgroundId).label, '大学');
  assert.equal(backgroundFor(graduate.backgroundId).label, '研究生');
  assert.notEqual(first.id, other.id);
});

test('the reviewed life-event library enriches supported backgrounds and records used events', () => {
  const highSchool = initial(profiles, { ...startOptions, backgroundId: 'high-school' });
  const university = initial(profiles, startOptions);
  const graduate = initial(profiles, { ...startOptions, backgroundId: 'graduate' });
  const earlyCareer = initial(profiles, { ...startOptions, backgroundId: 'early-career' });
  for (const state of [highSchool, university, graduate]) {
    const event = selectedLifeEvent(state, beatForState(state));
    assert.ok(event);
    assert.ok(event.lifeStages.includes(backgroundFor(state.backgroundId).lifeEventStage!));
    assert.equal(selectedLifeEvent(structuredClone(state), beatForState(state))?.id, event.id);
  }
  assert.equal(selectedLifeEvent(earlyCareer, beatForState(earlyCareer)), null);

  chooseTarget(highSchool, 'm1');
  chooseTarget(highSchool, 'm1');
  assert.equal(highSchool.worldState.usedLifeEventIds?.length, 2);
  assert.equal(new Set(highSchool.worldState.usedLifeEventIds).size, 2);
});

test('a complete tagged-style record stream emits before later bytes and can be validated after end', () => {
  const decoder = new JsonlDecoder();
  const state = initial(profiles, startOptions);
  acceptRecord(record({ type: 'scene', title: '最后一项安排' }), state);
  assert.deepEqual(decoder.push('{"type":"line","speaker":"旁白","text":"第一'), []);
  const rows = decoder.push('句已经到了。"}\n{"type":"line"');
  assert.equal(rows.length, 1);
  const result = acceptRecord(rows[0], state);
  assert.equal(result.event?.type, 'line');
  assert.equal(state.partial?.lines?.length, 1);
  assert.equal(state.nodes.length, 0);
});

test('invalid speaker or oversized text cannot mutate state, while the player alias is normalized', () => {
  const state = initial(profiles, startOptions);
  acceptRecord(record({ type: 'scene', title: '最后一项安排' }), state);
  const before = structuredClone(state);
  assert.throws(() => acceptRecord(record({ type: 'line', speaker: '陌生人', text: '不能进入对白。' }), state));
  assert.deepEqual(state, before);
  const playerLine = acceptRecord(record({ type: 'line', speaker: '我', text: '我是玩家。' }), state);
  assert.equal(playerLine.event?.type === 'line' && playerLine.event.speaker, '许澄');
  assert.throws(() => acceptRecord(record({ type: 'line', speaker: '旁白', text: '字'.repeat(limits.maxLineChars + 1) }), state));
});

test('common choices require a complete body, expose four dynamic targets, and memory stays private', () => {
  const state = initial(profiles, startOptions);
  acceptRecord(record({ type: 'scene', title: '最后一项安排' }), state);
  assert.throws(() => acceptRecord(record({ type: 'choices', items: commonChoices(state) }), state));
  for (const line of linesFor(state)) acceptRecord(record({ type: 'line', ...line }), state);
  const choiceRecord = acceptRecord(record({ type: 'choices', items: commonChoices(state) }), state);
  assert.equal(choiceRecord.event?.type, 'choices');
  assert.equal(state.partial?.choices?.length, requiredCastCount);
  assert.equal(acceptRecord(record({ type: 'memory', summary: '项目继续推进', facts: ['四人在场'] }), state).event, undefined);
  assert.equal(acceptRecord(record({ type: 'end' }), state).ended, true);
  assert.equal(isCommonStage(state), true);
  assert.doesNotThrow(() => nodeSchema.parse(state.partial));
});

test('duplicate or stale choices do not add selections', () => {
  const state = initial(profiles, startOptions);
  appendNode(state, makeNode(state, commonChoices(state)));
  choose(state, 0, 1);
  assert.throws(() => choose(state, 1, 1), /剧情进度已变化/);
  assert.equal(state.selections.length, 1);
});

test('tagged protocol parses player, scene, dialogue, and structured blocks without fixed cast ids', () => {
  const decoder = new TaggedDecoder();
  assert.deepEqual(decoder.push('[SCENE] 最后一项安排\n[NPC:顾言川] 先把展示桌收好\n'), ['[SCENE] 最后一项安排', '[NPC:顾言川] 先把展示桌收好']);
  assert.deepEqual(parseTagged('[CHOICES] {"items":[{"text":"继续整理速写","target":"m1"},{"text":"先停下来等等","target":null}]}'), { type: 'choices', items: [{ text: '继续整理速写', target: 'm1' }, { text: '先停下来等等', target: null }] });
  assert.deepEqual(parseTagged('[PLAYER] 好，我来帮你'), { type: 'line', speaker: '我', text: '好，我来帮你' });
  assert.deepEqual(parseTagged('[顾言川] 先把展示桌收好'), { type: 'line', speaker: '顾言川', text: '先把展示桌收好' });
});

test('tagged protocol rejects unknown or malformed records', () => {
  assert.throws(() => parseTagged('[NPC1] 错误标签'));
  assert.throws(() => parseTagged('[CHOICES] {"items":[{"text":"x","target":null}]}'));
});

test('a repair after an empty partial explicitly requires the missing scene before dialogue', () => {
  const state = initial(profiles, startOptions);
  assert.match(nextInstruction(state), /必须先输出scene标题/);
  assert.doesNotMatch(nextInstruction(state), /不能输出scene/);
});

test('life choices deterministically record a result for the next model turn and ending', () => {
  const state = lockedState('m1');
  const firstEvent = selectedLifeEvent(state, beatForState(state));
  assert.ok(firstEvent);
  advanceRoute(state, 0);
  assert.match(state.selections.at(-1)?.outcome || '', /已执行/);
  assert.match(state.selections.at(-1)?.outcome || '', /收益：/);
  assert.match(state.selections.at(-1)?.outcome || '', /后续影响：/);
  assert.ok(state.worldState.timeline.some((entry) => entry.includes('收益：')));
  assert.match(messages(state)[1].content, /收益：/);
  advanceRoute(state, 0);
  advanceRoute(state, 0);
  const ending = resolveEnding(state);
  assert.equal(state.worldState.endingId, ending.id);
  assert.ok(['bright', 'warm', 'bittersweet', 'quiet'].includes(ending.tone));
  assert.equal(publicState(state).ending?.id, ending.id);
});

test('route life choices expose three linked Zhihu answers for each option', () => {
  const state = lockedState('m1');
  const view = publicState(state);
  assert.equal(view.stageKind, 'route');
  assert.equal(view.lifeEvent?.options.length, 3);
  for (const option of view.lifeEvent?.options || []) {
    assert.equal(option.evidence.length, 3);
    assert.ok(option.evidence.every((item) => /^https:\/\//.test(item.url)));
    assert.ok(option.evidence.every((item) => item.author.trim().length > 0));
  }
});

test('event planning is persisted per beat and does not drift after used-event changes', () => {
  const state = initial(profiles, startOptions);
  const firstBeat = beatForState(state);
  const first = selectedLifeEvent(state, firstBeat);
  assert.ok(first);
  const planned = state.plannedLifeEventIds?.[firstBeat.id];
  assert.equal(planned, first.id);
  state.worldState.usedLifeEventIds?.push(first.id);
  assert.equal(selectedLifeEvent(state, firstBeat)?.id, first.id);
});
