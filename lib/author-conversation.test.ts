import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTHOR_CLAIM_PATTERN,
  AUTHOR_INPUT_BYTE_LIMIT,
  authorFactsText,
  authorSerializeBytes,
  buildConversationMessages,
  parseConversationEnvelope,
  runAuthorConversation,
  sanitizeReplyText,
  type AuthorModelMessage,
} from './author-conversation';
import type {EvidenceItem, EvidencePacket} from './author-evidence';

const token = 'MarryMea';
const items: EvidenceItem[] = [
  {id: '1001:p1', answerId: '1001', title: '远程工作如何减少孤独', text: '远程工作需要明确休息安排。', sourceUrl: 'https://www.zhihu.com/answer/1001', authorUrlToken: token, authorName: '合成作者', completeness: 'stored_api', origin: 'local'},
  {id: '1001:p2', answerId: '1001', title: '远程工作如何减少孤独', text: '孤独时可以定期交流。', sourceUrl: 'https://www.zhihu.com/answer/1001', authorUrlToken: token, authorName: '合成作者', completeness: 'stored_api', origin: 'local'},
];
const packet = (overrides: Partial<EvidencePacket> = {}): EvidencePacket => ({items: [], status: 'none', providerStatus: 'unused', onlineTried: false, readTried: false, ...overrides});
const baseInput = {story: '玩家正在体验独立对话。', history: [{role: 'user' as const, text: '远程工作怎么休息？'}], persona: {displayName: '林泠', domains: ['职业规划'], context: 'trial' as const}, authorToken: token};

function scripted(replies: string[]) {
  const calls: AuthorModelMessage[][] = [];
  let index = 0;
  const call = async (messages: readonly AuthorModelMessage[]) => {
    calls.push(messages.map((message) => ({...message})));
    return replies[Math.min(index++, replies.length - 1)];
  };
  return {call, calls};
}

test('the prompt gives the model persona, facts, evidence and output rules', () => {
  const messages = buildConversationMessages({story: '摘要', history: [{role: 'user', text: '你好'}], persona: {displayName: '林泠', domains: ['生物', '职业规划'], context: 'story'}, evidence: items});
  const system = messages[0].content;
  assert.ok(system.includes('林泠'));
  assert.ok(system.includes('生物、职业规划'));
  assert.ok(system.includes('剧情内的自由聊天'));
  assert.ok(authorFactsText().includes('有效互动奖励'));
  assert.ok(system.includes('有效互动奖励'));
  assert.ok(system.includes('这部分我没查到'));
  assert.ok(system.includes('1001:p1'));
  assert.ok(system.includes('usedEvidenceIds'));
  assert.ok(messages.every((message) => typeof message.content === 'string'));
  assert.equal(messages.at(-1)?.content, '你好');
});

test('provenance is disclosed by name only when the player asks who the avatar is', () => {
  const withSource = buildConversationMessages({story: '', history: [{role: 'user', text: '你的真身是谁？'}], persona: {displayName: '简知遥', sourceDisplayName: '墨羽眉'}});
  assert.ok(withSource[0].content.includes('来源说明'));
  assert.ok(withSource[0].content.includes('墨羽眉'));
  assert.ok(withSource[0].content.includes('虚构化身'));
  assert.ok(!/https?:\/\//.test(withSource[0].content), 'the prompt must not carry the homepage url');
  const preset = buildConversationMessages({story: '', history: [{role: 'user', text: '你是谁'}], persona: {displayName: '顾言川'}});
  assert.ok(!preset[0].content.includes('来源说明'));
});

test('trial chat and empty evidence are both stated explicitly', () => {
  const messages = buildConversationMessages({story: '', history: [{role: 'user', text: '你是谁'}], persona: {displayName: '简知遥', context: 'trial'}});
  assert.ok(messages[0].content.includes('资料试验'));
  assert.ok(messages[0].content.includes('不结算好感度'));
  assert.ok(messages[0].content.includes('本轮没有可引用的公开回答资料'));
});

test('a natural answer with citations is returned as matched with program-built sources', async () => {
  const {call} = scripted([JSON.stringify({reply: '远程工作最重要的还是把休息安排写清楚，孤独的时候要定期交流。', usedEvidenceIds: ['1001:p1', '1001:p2', '不存在']})]);
  const result = await runAuthorConversation({...baseInput, packet: packet({items, status: 'local'})}, call);
  assert.equal(result.evidenceStatus, 'matched');
  assert.equal(result.sources.length, 1, 'two paragraphs of the same answer collapse into one source');
  assert.equal(result.sources[0].url, 'https://www.zhihu.com/answer/1001');
  assert.equal(result.modelCalls, 1);
  assert.ok(!result.text.includes('http'));
});

test('an answer without citations is kept but marked unverified', async () => {
  const {call} = scripted([JSON.stringify({reply: '我以前也遇到过类似的问题，慢慢来。', usedEvidenceIds: []})]);
  const result = await runAuthorConversation({...inputWithEvidence(), packet: packet({items, status: 'local'})}, call);
  assert.equal(result.evidenceStatus, 'unverified');
  assert.deepEqual(result.sources, []);
  assert.equal(result.text, '我以前也遇到过类似的问题，慢慢来。');
});

function inputWithEvidence() {
  return {...baseInput, history: [{role: 'user' as const, text: '你觉得呢？'}]};
}

test('free chat without any evidence is a persona answer, not a refusal', async () => {
  const {call} = scripted([JSON.stringify({reply: '我在呢。想聊科研、转专业还是工作节奏都行，你先说说最近在纠结什么？'})]);
  const result = await runAuthorConversation({...baseInput, packet: packet()}, call);
  assert.equal(result.evidenceStatus, 'persona');
  assert.ok(result.text.includes('我在呢'));
  assert.equal(result.providerStatus, 'unused');
});

test('plain text output is accepted directly instead of being rejected as a protocol error', async () => {
  const {call} = scripted(['我直接说就好，不需要 JSON。']);
  const result = await runAuthorConversation({...baseInput, packet: packet()}, call);
  assert.equal(result.text, '我直接说就好，不需要 JSON。');
  assert.equal(result.evidenceStatus, 'persona');
});

test('an ungrounded author claim triggers exactly one rewrite', async () => {
  const {call, calls} = scripted([
    JSON.stringify({reply: '作者认为远程工作更适合所有人。', usedEvidenceIds: []}),
    JSON.stringify({reply: '我手上的资料里没有他关于这个说法的记录，我不敢替他下结论。', usedEvidenceIds: []}),
  ]);
  const result = await runAuthorConversation({...baseInput, packet: packet()}, call);
  assert.equal(result.modelCalls, 2);
  assert.ok(calls[1].at(-1)!.content.includes('没有对应的引用'));
  assert.equal(AUTHOR_CLAIM_PATTERN.test(result.text), false);
});

test('a model that keeps claiming author views is kept but marked unverified', async () => {
  const {call} = scripted([JSON.stringify({reply: '作者认为这样更好。'}), JSON.stringify({reply: '作者表示他一直是这么做的。'})]);
  const result = await runAuthorConversation({...baseInput, packet: packet()}, call);
  assert.equal(result.modelCalls, 2);
  assert.equal(result.evidenceStatus, 'persona');
  assert.deepEqual(result.sources, []);
  assert.ok(result.text.length > 0);
});

test('urls and evidence ids are stripped from replies and empty replies fail explicitly', async () => {
  const {call} = scripted([JSON.stringify({reply: '你可以看 https://zhihu.com/answer/1001 这里（1001:p1）。', usedEvidenceIds: ['1001:p1']})]);
  const result = await runAuthorConversation({...baseInput, packet: packet({items, status: 'local'})}, call);
  assert.equal(result.text.includes('http'), false);
  assert.equal(result.text.includes('1001:p1'), false);
  assert.equal(result.sources.length, 1);
  const empty = scripted(['   ']);
  await assert.rejects(runAuthorConversation({...baseInput, packet: packet()}, empty.call), /没有返回可显示的回复/);
});

test('oversized questions fail instead of being silently truncated', () => {
  assert.throws(() => buildConversationMessages({story: '', history: [{role: 'user', text: '超长'.repeat(4000)}], persona: {displayName: '林泠'}}), /输入过长/);
  assert.ok(AUTHOR_INPUT_BYTE_LIMIT > 0);
  const long = buildConversationMessages({story: '摘要', history: [{role: 'user', text: '合成历史'.repeat(120)}, {role: 'assistant', text: '合成回复'.repeat(60)}, {role: 'user', text: '最后一个问题'}], persona: {displayName: '林泠'}});
  assert.ok(authorSerializeBytes(long) <= AUTHOR_INPUT_BYTE_LIMIT);
  assert.equal(parseConversationEnvelope('').reply, '');
  assert.equal(sanitizeReplyText('  a   b  '), 'a b');
});
