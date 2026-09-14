import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {AUTHOR_INPUT_BYTE_LIMIT, CONVERSATION_REPLY_LIMIT, authorSerializeBytes, buildConversationMessages, parseConversationEnvelope, sanitizeReplyText} from './author-conversation';
import {EVIDENCE_BYTE_BUDGET, EVIDENCE_ITEM_LIMIT} from './author-evidence';

const runtimeModules = [
  'author-chat.ts',
  'author-conversation.ts',
  'author-evidence.ts',
  'author-intent.ts',
  'author-retrieval.ts',
  'author-corpus.ts',
  'author-citations.ts',
  'author-style.ts',
  'author-avatars.ts',
  'author-errors.ts',
  'author-provider.ts',
  'author-provider-official.ts',
  'author-cache.ts',
  'author-identity.ts',
];

const devOnlyModules = ['author-provider-zhurl.ts'];

const moduleSource = (name: string): string => readFileSync(path.join(process.cwd(), 'lib', name), 'utf8');

test('runtime author modules never spawn zhurl or the shell', () => {
  for (const name of runtimeModules) {
    const source = moduleSource(name);
    assert.ok(!source.includes('execFileSync'), name);
    assert.ok(!source.includes('execSync'), name);
    assert.ok(!source.includes('node:child_process'), name);
    assert.ok(!source.includes('spawn('), name);
    assert.ok(!source.includes('ZHURL_BIN'), name);
  }
  const zhurl = moduleSource('author-provider-zhurl.ts');
  assert.ok(zhurl.includes("from 'node:child_process'"));
  assert.ok(zhurl.includes('ZHURL_BIN'));
});

test('the zhurl provider is only reachable through a production-guarded dynamic import', () => {
  const live = moduleSource('author-live-provider.ts');
  assert.ok(live.includes("import('./author-provider-zhurl')"));
  assert.ok(live.includes('NODE_ENV'));
  assert.ok(live.includes("'production'"));
  for (const name of runtimeModules) assert.ok(!moduleSource(name).includes('author-provider-zhurl'), `${name} must not import zhurl`);
});

test('the only runtime network calls are the provider fetch and the model endpoint', () => {
  const fetchers = runtimeModules.filter((name) => moduleSource(name).includes('fetch('));
  assert.deepEqual(fetchers, ['author-chat.ts']);
  const official = moduleSource('author-provider-official.ts');
  assert.ok(official.includes('fetchImpl'));
  assert.ok(!official.includes('console.log'));
  assert.ok(!moduleSource('author-conversation.ts').includes('http://'));
  assert.ok(!moduleSource('author-evidence.ts').includes('http://'));
});

test('the conversation framework keeps its documented budgets', () => {
  assert.equal(AUTHOR_INPUT_BYTE_LIMIT, 6000);
  assert.equal(CONVERSATION_REPLY_LIMIT, 600);
  assert.equal(EVIDENCE_ITEM_LIMIT, 5);
  assert.equal(EVIDENCE_BYTE_BUDGET, 3000);
});

test('the model is no longer forced through a json tool protocol', () => {
  for (const name of ['author-conversation.ts', 'author-evidence.ts', 'author-chat.ts']) {
    const source = moduleSource(name);
    assert.ok(!source.includes('search_local_cache'), name);
    assert.ok(!source.includes('search_author_online'), name);
    assert.ok(!source.includes('read_author_answer'), name);
    assert.ok(!source.includes('finish'), name);
  }
  assert.ok(!moduleSource('author-conversation.ts').includes('citationIds'));
});

test('prompt messages stay string-encoded and inside the byte budget', () => {
  const history = Array.from({length: 20}, (_, index) => ({role: index % 2 ? 'user' as const : 'assistant' as const, text: '合成历史'.repeat(120)}));
  const messages = buildConversationMessages({story: '摘要'.repeat(200), history: [...history, {role: 'user', text: '远程工作怎么休息？'}], persona: {displayName: '林泠', domains: ['职业规划']}});
  assert.ok(messages.every((message) => typeof message.content === 'string'));
  assert.ok(authorSerializeBytes(messages) >= 0);
  assert.equal(messages.at(-1)?.role, 'user');
  assert.ok(messages[0].content.includes('职业规划'));
});

test('free-form replies are accepted and unsafe urls are stripped', () => {
  assert.deepEqual(parseConversationEnvelope('{"reply":"我在呢。","usedEvidenceIds":["1001:p1"]}'), {reply: '我在呢。', usedEvidenceIds: ['1001:p1']});
  assert.deepEqual(parseConversationEnvelope('```json\n{"reply":"好呀"}\n```'), {reply: '好呀', usedEvidenceIds: []});
  assert.deepEqual(parseConversationEnvelope('我直接说话也可以。'), {reply: '我直接说话也可以。', usedEvidenceIds: []});
  assert.equal(sanitizeReplyText('看这里 https://evil.test/x 就好').includes('evil.test'), false);
  assert.equal([...sanitizeReplyText('超长'.repeat(400))].length, CONVERSATION_REPLY_LIMIT);
});
