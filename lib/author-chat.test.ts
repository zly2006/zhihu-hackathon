import assert from 'node:assert/strict';
import test from 'node:test';
import {CHAT_MIN_INTERVAL_MS, CHAT_MIN_MESSAGE_CHARS, CHAT_REWARD_CAP, chatInteractionReward, messageHash} from './chat-reward';
import {normalizeOnlineQuery, classifyAuthorQuestion} from './author-intent';
import {parseConversationEnvelope, sanitizeReplyText} from './author-conversation';
import {canonicalProfiles, initial, publicState, selectedCast} from './story';
import {isSaveSlot, demoOpening, isChatMessage} from './ui-story';

const base = {previousGain: 0, messageText: '我想认真聊聊转专业这件事该怎么判断', replyOk: true, cited: false, now: 1_700_000_000_000};

test('avatar binding survives canonicalization and public-state projection', () => {
  const profiles = canonicalProfiles();
  profiles[0].authorAvatarId = 'zhao-ling';
  const state = initial(profiles);
  assert.equal(selectedCast(state)[0].authorAvatarId, 'zhao-ling');
  assert.equal(publicState(state).world.cast[0].authorAvatarId, 'zhao-ling');
  assert.throws(() => canonicalProfiles(profiles.map((p, i) => (i ? p : {...p, authorAvatarId: 'unknown'}))), /化身/);
});

test('known old zhihuHandle migrates to a registered binding only', () => {
  const profiles = canonicalProfiles();
  profiles[0].zhihuHandle = '赵泠';
  profiles[1].zhihuHandle = '未注册答主';
  const resolved = canonicalProfiles(profiles);
  assert.equal(resolved[0].authorAvatarId, 'zhao-ling');
  assert.equal(resolved[1].authorAvatarId, undefined);
});

test('oversized current user question fails instead of silent truncation', async () => {
  const {buildConversationMessages} = await import('./author-conversation');
  assert.throws(() => buildConversationMessages({story: '', history: [{role: 'user', text: '超长'.repeat(4000)}], persona: {displayName: '林泠'}}), /输入过长/);
});

test('version-1 saves support optional citation metadata and reject unsafe URLs', () => {
  const slot = {
    version: 1, mode: 'demo', state: demoOpening, line: 0, partner: 'lin', time: 'synthetic',
    chats: {lin: [{role: 'assistant', text: '测试', sources: [{answerId: '1001', title: '测试', author: '测试', authorUrlToken: 'MarryMea', url: 'https://www.zhihu.com/answer/1001', completeness: 'stored_body_unverified_against_live_page'}], avatar: {id: 'zhao-ling', displayName: '林泠', styleStatus: 'unreviewed'}, evidenceStatus: 'matched'}]},
  };
  assert.equal(isSaveSlot(JSON.parse(JSON.stringify(slot))), true);
  slot.chats.lin[0].sources[0].url = 'javascript:alert(1)';
  assert.equal(isSaveSlot(slot), false);
});

test('saved chats keep accepting legacy and new evidence statuses', () => {
  for (const evidenceStatus of ['matched', 'no-match', 'unverified', 'persona'] as const) {
    assert.equal(isChatMessage({role: 'assistant', text: '合成', evidenceStatus}), true, evidenceStatus);
  }
  assert.equal(isChatMessage({role: 'assistant', text: '合成', evidenceStatus: 'invented' as never}), false);
});

test('chat reward needs a real message, a real reply and a fresh turn', () => {
  assert.deepEqual(chatInteractionReward(base), {delta: 1, reason: 'rewarded'});
  assert.deepEqual(chatInteractionReward({...base, cited: true}), {delta: 2, reason: 'rewarded'});
  assert.deepEqual(chatInteractionReward({...base, replyOk: false}), {delta: 0, reason: 'reply-failed'});
  assert.deepEqual(chatInteractionReward({...base, messageText: '在吗'}), {delta: 0, reason: 'too-short'});
  assert.deepEqual(chatInteractionReward({...base, messageText: '！？……   '}), {delta: 0, reason: 'too-short'});
  assert.deepEqual(chatInteractionReward({...base, recentHashes: [messageHash(base.messageText)]}), {delta: 0, reason: 'duplicate'});
  assert.deepEqual(chatInteractionReward({...base, lastGainAt: new Date(base.now - CHAT_MIN_INTERVAL_MS + 1000).toISOString()}), {delta: 0, reason: 'cooldown'});
  assert.deepEqual(chatInteractionReward({...base, lastGainAt: new Date(base.now - CHAT_MIN_INTERVAL_MS).toISOString()}), {delta: 1, reason: 'rewarded'});
  assert.deepEqual(chatInteractionReward({...base, previousGain: CHAT_REWARD_CAP}), {delta: 0, reason: 'capped'});
  assert.deepEqual(chatInteractionReward({...base, previousGain: CHAT_REWARD_CAP - 1, cited: true}), {delta: 1, reason: 'rewarded'});
  assert.equal(CHAT_MIN_MESSAGE_CHARS, 12);
});

test('the same text with different spacing or width is still a duplicate', () => {
  assert.equal(messageHash('我想认真聊聊转专业'), messageHash('  我想认真聊聊转专业  '));
  assert.equal(messageHash('ＡＢＣ转专业怎么判断'), messageHash('ABC转专业怎么判断'));
  assert.notEqual(messageHash('我想认真聊聊转专业'), messageHash('我想认真聊聊职业规划'));
});

test('intent routing separates small talk from knowledge questions', () => {
  for (const text of ['你好', '你是谁', '介绍一下你自己', '我喜欢和你聊天', '这个游戏怎么玩', '好感度怎么增加', '晚安', '聊聊天吧']) {
    assert.equal(classifyAuthorQuestion(text), 'conversation', text);
  }
  for (const text of ['作者怎么看转专业', '他写过关于导师的回答吗', '考研值得吗', '我应该选哪个方向', '远程工作为什么容易孤独', '作者认为科研是什么']) {
    assert.equal(classifyAuthorQuestion(text), 'knowledge', text);
  }
  assert.equal(classifyAuthorQuestion('这个选择要怎么判断？'), 'knowledge');
  assert.equal(normalizeOnlineQuery('全民科研时代 普通学生 科研'), '全民科研时代');
  assert.equal(normalizeOnlineQuery('远程工作如何减少孤独'), '远程工作如何减少孤独');
});

test('the conversation envelope tolerates plain text and keeps reply strings', () => {
  assert.deepEqual(parseConversationEnvelope(JSON.stringify({reply: '我在呢', usedEvidenceIds: ['1001:p1']})), {reply: '我在呢', usedEvidenceIds: ['1001:p1']});
  assert.deepEqual(parseConversationEnvelope('直接说话'), {reply: '直接说话', usedEvidenceIds: []});
  assert.equal(sanitizeReplyText('见 https://evil.test 吧'), '见 吧');
});
