import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createStateStore} from './state-store';
import {updateLockedState} from './state-lock';
import {applyChatReward} from './chat-settlement';
import {CHAT_REWARD_CAP, MAX_PROCESSED_MESSAGE_HASHES} from './chat-reward';
import {initial, type State} from './story';

const storyId = '22222222-2222-4222-8222-222222222222';
let tempRoot = '';
const baseNow = Date.parse('2026-03-01T00:00:00.000Z');

test.before(async () => {tempRoot = await mkdtemp(path.join(tmpdir(), 'lamplight-chat-reward-'));});
test.after(async () => {if (tempRoot) await rm(tempRoot, {recursive: true, force: true});});

test('preset npc and author chats settle through the same channel with a +4 cap', () => {
  const state: State = initial();
  const steps = [
    {characterId: 'm1', messageText: '第一个认真写的问题，想聊聊转专业', cited: false, now: baseNow},
    {characterId: 'ling', messageText: '第二个认真写的问题，想聊聊科研方法', cited: true, now: baseNow},
    {characterId: 'm1', messageText: '第三个认真写的问题，想聊聊工作节奏', cited: false, now: baseNow},
    {characterId: 'ling', messageText: '第四个认真写的问题，想聊聊城市选择', cited: true, now: baseNow},
    {characterId: 'm1', messageText: '第五个认真写的问题，想聊聊家庭期待', cited: false, now: baseNow},
    {characterId: 'm1', messageText: '第六个认真写的问题，想聊聊朋友关系', cited: false, now: baseNow},
    {characterId: 'm1', messageText: '第七个认真写的问题，想聊聊未来打算', cited: false, now: baseNow},
  ];
  const deltas = steps.map((step, index) => applyChatReward(state, {replyOk: true, ...step, now: baseNow + index * 120_000}).delta);
  assert.deepEqual(deltas, [1, 2, 1, 2, 1, 1, 0], '答主引用可加 2，但每人每局聊天通道封顶 +4');
  assert.equal(state.worldState.authorChatGains?.m1, CHAT_REWARD_CAP);
  assert.equal(state.worldState.authorChatGains?.ling, CHAT_REWARD_CAP);
  assert.equal(state.worldState.relationships.m1, CHAT_REWARD_CAP);
  assert.equal(state.worldState.relationships.ling, CHAT_REWARD_CAP);
  assert.ok(state.worldState.chatGainAt?.m1);
});

test('duplicate text, short messages, failed replies and cooldown never reward twice', () => {
  const state: State = initial();
  const message = '这句话会被重复发送看看是否重复计分';
  assert.equal(applyChatReward(state, {characterId: 'ling', messageText: message, replyOk: true, cited: false, now: baseNow}).delta, 1);
  assert.equal(applyChatReward(state, {characterId: 'ling', messageText: message, replyOk: true, cited: false, now: baseNow + 600_000}).reason, 'duplicate');
  assert.equal(applyChatReward(state, {characterId: 'ling', messageText: '在吗', replyOk: true, cited: false, now: baseNow + 600_000}).reason, 'too-short');
  assert.equal(applyChatReward(state, {characterId: 'ling', messageText: '模型失败时不应该加分的很长的问题', replyOk: false, cited: false, now: baseNow + 600_000}).reason, 'reply-failed');
  assert.equal(applyChatReward(state, {characterId: 'ling', messageText: '紧接着又问了一个不算短的完整问题', replyOk: true, cited: false, now: baseNow + 1_000}).reason, 'cooldown');
  assert.equal(applyChatReward(state, {characterId: 'ling', messageText: '冷却结束后再问一个完整的问题吧', replyOk: true, cited: false, now: baseNow + 600_000}).delta, 1);
  assert.equal(state.worldState.relationships.ling, 2);
});

test('message hashes stay bounded so a long game cannot grow the save', () => {
  const state: State = initial();
  for (let index = 0; index < MAX_PROCESSED_MESSAGE_HASHES + 25; index += 1) {
    applyChatReward(state, {characterId: 'm1', messageText: `第 ${index} 个足够长的合成问题内容用于测试`, replyOk: true, cited: false, now: baseNow});
  }
  assert.equal(state.worldState.processedChatMessageHashes?.length, MAX_PROCESSED_MESSAGE_HASHES);
  assert.ok((state.worldState.authorChatGains?.m1 ?? 0) <= CHAT_REWARD_CAP);
});

test('the same exchange id is settled only once even when the request is retried', async () => {
  const root = await mkdtemp(path.join(tempRoot, 'case-'));
  const store = createStateStore(root);
  await store.save(storyId, initial());
  const exchangeId = randomUUID();
  const reward = {characterId: 'lin', messageText: '读档之后再说一遍这句足够长的话', replyOk: true, cited: false, now: baseNow};
  const settle = () => updateLockedState(storyId, store, (state) => {applyChatReward(state, reward);}, {exchangeId});
  const first = await settle();
  const second = await settle();
  assert.equal(first.worldState.relationships.lin, 1);
  assert.equal(second.worldState.relationships.lin, 1);
  assert.deepEqual(second.worldState.processedChatExchangeIds, [exchangeId]);
  const persisted = await store.read(storyId);
  assert.equal(persisted?.worldState.relationships.lin, 1);
  assert.equal(persisted?.worldState.authorChatGains?.lin, 1);
});
