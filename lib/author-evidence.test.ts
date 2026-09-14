import assert from 'node:assert/strict';
import test from 'node:test';
import {EVIDENCE_ITEM_LIMIT, prepareAuthorEvidence, providerErrorStatus} from './author-evidence';
import {AuthorProviderError, type AnswerSummary, type AuthorAnswer as ProviderAnswer, type AuthorProvider, type AuthorRef} from './author-provider';

const token = 'MarryMea';
const ref: AuthorRef = {provider: 'zhihu', urlToken: token, profileUrl: `https://www.zhihu.com/people/${token}`};
const localAnswer: ProviderAnswer = {
  answerId: '1001', authorName: '合成作者', authorUrlToken: token, questionTitle: '远程工作如何减少孤独',
  sourceUrl: 'https://www.zhihu.com/answer/1001', body: '合成正文：远程工作需要明确休息安排。\n合成正文：孤独时可以定期交流。',
  completeness: 'stored_body_unverified_against_live_page',
};
const summary = (answerId = '9009'): AnswerSummary => ({
  answerId, authorUrlToken: token, questionTitle: '在线检索到的回答',
  sourceUrl: `https://www.zhihu.com/answer/${answerId}`, excerpt: '在线摘要内容。', collectionMethod: 'runtime-live',
});
const detail = (answerId = '9009'): ProviderAnswer => ({
  answerId, authorUrlToken: token, questionTitle: '在线检索到的回答',
  sourceUrl: `https://www.zhihu.com/answer/${answerId}`, body: '在线第一段。\n在线第二段。', completeness: 'fetched_api_content_unverified',
});

function provider(overrides: Partial<AuthorProvider> & {counter?: {search: number; read: number}} = {}): AuthorProvider {
  const counter = overrides.counter ?? {search: 0, read: 0};
  return {
    resolveProfile: async () => {throw new Error('unused');},
    listAnswers: async () => [],
    searchAnswers: async () => {counter.search += 1; return [summary()];},
    readAnswer: async () => {counter.read += 1; return detail();},
    ...overrides,
  };
}

test('local corpus is always searched first and satisfies the packet without online access', async () => {
  const counter = {search: 0, read: 0};
  const packet = await prepareAuthorEvidence({answers: [localAnswer], authorToken: token, question: '远程工作如何休息？', intent: 'knowledge', authorRef: ref, provider: provider({counter})});
  assert.equal(packet.status, 'local');
  assert.ok(packet.items.length > 0);
  assert.ok(packet.items.every((item) => item.origin === 'local' && item.answerId === '1001'));
  assert.equal(counter.search, 0);
  assert.equal(packet.providerStatus, 'unused');
  assert.equal(packet.onlineTried, false);
});

test('conversation intent skips retrieval entirely so small talk stays natural', async () => {
  const counter = {search: 0, read: 0};
  const conversation = await prepareAuthorEvidence({answers: [localAnswer], authorToken: token, question: '你好呀', intent: 'conversation', authorRef: ref, provider: provider({counter})});
  assert.equal(conversation.status, 'none');
  assert.deepEqual(conversation.items, []);
  assert.equal(conversation.providerStatus, 'unused');
  assert.equal(counter.search, 0);
  assert.equal(counter.read, 0);
});

test('online search only happens for knowledge questions with an empty local cache', async () => {
  const knowledge = await prepareAuthorEvidence({answers: [], authorToken: token, question: '作者怎么看远程工作？', intent: 'knowledge', authorRef: ref, provider: provider()});
  assert.equal(knowledge.status, 'online');
  assert.equal(knowledge.onlineTried, true);
  assert.equal(knowledge.readTried, true);
  assert.ok(knowledge.items.some((item) => item.origin === 'online-detail' && item.id === '9009:p1'));
  assert.equal(knowledge.providerStatus, 'used');
});

test('a knowledge question without any provider stays empty instead of failing', async () => {
  const packet = await prepareAuthorEvidence({answers: [], authorToken: token, question: '作者怎么看远程工作？', intent: 'knowledge', provider: null, authorRef: ref});
  assert.equal(packet.status, 'none');
  assert.deepEqual(packet.items, []);
  assert.equal(packet.providerStatus, 'unused');
});

test('provider failures are classified and never abort the packet', async () => {
  const failing = provider({searchAnswers: async () => {throw new AuthorProviderError('需要授权', 'AUTHOR_AUTH_REQUIRED');}});
  const packet = await prepareAuthorEvidence({answers: [], authorToken: token, question: '作者怎么看？', intent: 'knowledge', authorRef: ref, provider: failing});
  assert.equal(packet.providerStatus, 'auth-required');
  assert.deepEqual(packet.items, []);
  const detailFailure = provider({readAnswer: async () => {throw new AuthorProviderError('限流', 'AUTHOR_RATE_LIMITED');}});
  const partial = await prepareAuthorEvidence({answers: [], authorToken: token, question: '作者怎么看？', intent: 'knowledge', authorRef: ref, provider: detailFailure});
  assert.equal(partial.providerStatus, 'rate-limited');
  assert.equal(partial.items[0]?.origin, 'online-search');
  assert.equal(providerErrorStatus(new AuthorProviderError('x', 'AUTHOR_CONTENT_UNSUPPORTED')).status, 'unsupported');
  assert.equal(providerErrorStatus(new Error('boom')).status, 'unavailable');
});

test('evidence never leaves the bound author and honours the item cap', async () => {
  const foreign = provider({searchAnswers: async () => [{...summary(), authorUrlToken: 'someone-else'}]});
  const packet = await prepareAuthorEvidence({answers: [], authorToken: token, question: '作者怎么看？', intent: 'knowledge', authorRef: ref, provider: foreign});
  assert.deepEqual(packet.items, []);
  assert.equal(packet.providerStatus, 'invalid');
  const many = provider({searchAnswers: async () => Array.from({length: 9}, (_, index) => summary(String(9000 + index))), readAnswer: async () => {throw new AuthorProviderError('x', 'AUTHOR_PROVIDER_UNAVAILABLE');}});
  const capped = await prepareAuthorEvidence({answers: [], authorToken: token, question: '作者怎么看？', intent: 'knowledge', authorRef: ref, provider: many});
  assert.ok(capped.items.length <= EVIDENCE_ITEM_LIMIT);
  assert.ok(capped.items.every((item) => item.authorUrlToken === token));
});
