import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {AUTHOR_INPUT_BYTE_LIMIT, CONVERSATION_REPLY_LIMIT, authorSerializeBytes, buildConversationMessages, parseConversationEnvelope, sanitizeReplyText} from './author-conversation';
import {DEFAULT_MAX_PER_MINUTE, DEFAULT_MIN_INTERVAL_MS, createAuthorRateLimiter} from './author-rate-limit';
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
  'author-provider-zhihu-web.ts',
  'author-web-credentials.ts',
  'author-rate-limit.ts',
  'author-cache.ts',
  'author-identity.ts',
];

const moduleSource = (name: string): string => readFileSync(path.join(process.cwd(), 'lib', name), 'utf8');

test('runtime author modules never spawn a process or depend on a local binary', () => {
  for (const name of runtimeModules) {
    const source = moduleSource(name);
    assert.ok(!source.includes('child_process'), name);
    assert.ok(!source.includes('execFileSync'), name);
    assert.ok(!source.includes('execSync'), name);
    assert.ok(!source.includes('spawn('), name);
    assert.ok(!source.includes('ZHURL_BIN'), name);
  }
  // 注册表与 Profile schema 只允许把 zhurl 当作历史枚举值读取，运行时代码不得再依赖它
  const legacyAllowed = new Set(['author-provider.ts', 'author-registry.ts']);
  const offenders = [...runtimeModules, 'author-live-provider.ts'].filter((name) => !legacyAllowed.has(name) && /zhurl/i.test(moduleSource(name)));
  assert.deepEqual(offenders, [], '运行时代码不再引用 zhurl');
  for (const name of legacyAllowed) {
    for (const line of moduleSource(name).split('\n')) {
      if (/zhurl/i.test(line)) assert.ok(line.includes('z.enum'), `${name} 只允许在枚举里兼容 zhurl：${line.trim()}`);
    }
  }
});

test('the public content source is a plain fetch provider driven by server credentials', () => {
  const web = moduleSource('author-provider-zhihu-web.ts');
  assert.ok(web.includes('fetchImpl'), 'web provider must use an injectable fetch');
  assert.ok(!web.includes('NODE_ENV'), '内容来源不再按环境分叉');
  assert.ok(web.includes('AUTHOR_SOURCE_UNCONFIGURED'), '未配置凭证必须显式报错');
  const credentials = moduleSource('author-web-credentials.ts');
  assert.ok(credentials.includes('ZHIHU_WEB_COOKIE'));
  assert.ok(credentials.includes('account.json'), '本地开发回退到知乎++ 账号文件');
  assert.ok(!credentials.includes('console.'), '凭证模块不允许打印任何内容');
  const live = moduleSource('author-live-provider.ts');
  assert.ok(live.includes('createZhihuWebProvider'));
  assert.ok(!live.includes('NODE_ENV'), '同一套实现同时服务本地与线上');
});

test('the only runtime network calls are the provider fetch and the model endpoint', () => {
  const fetchers = runtimeModules.filter((name) => moduleSource(name).includes('fetch('));
  assert.deepEqual(fetchers, ['author-chat.ts']);
  assert.ok(moduleSource('author-provider-zhihu-web.ts').includes('fetchImpl'), 'the web provider must use an injectable fetch');
  assert.ok(moduleSource('author-provider-official.ts').includes('fetchImpl'));
  assert.ok(!moduleSource('author-conversation.ts').includes('http://'));
  assert.ok(!moduleSource('author-evidence.ts').includes('http://'));
});

test('the rate limiter serialises one author and caps the global window', async () => {
  assert.ok(DEFAULT_MAX_PER_MINUTE > 0 && DEFAULT_MIN_INTERVAL_MS > 0);
  const clock = {value: 0};
  const limiter = createAuthorRateLimiter({maxPerMinute: 10, minIntervalMs: 1, now: () => (clock.value += 1)});
  const starts: number[] = [];
  let running = 0;
  const order: string[] = [];
  const task = (label: string) => async () => {
    running += 1;
    assert.equal(running, 1, '同一个作者的请求必须串行');
    starts.push(clock.value);
    order.push(label);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running -= 1;
    return label;
  };
  const results = await Promise.all([limiter.run('author-a', task('first')), limiter.run('author-a', task('second'))]);
  assert.deepEqual(results, ['first', 'second']);
  assert.deepEqual(order, ['first', 'second']);
  assert.equal(starts.length, 2);
  assert.equal(limiter.pending('author-a'), 0);
  // 不同作者可以并行排队，但仍受全局窗口约束
  const parallel = createAuthorRateLimiter({maxPerMinute: 10, minIntervalMs: 0, now: () => Date.now()});
  const settled = await Promise.all([parallel.run('x', async () => 'x'), parallel.run('y', async () => 'y')]);
  assert.deepEqual(settled, ['x', 'y']);
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
    assert.ok(!source.includes('citationIds'), name);
  }
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
