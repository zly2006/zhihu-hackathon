import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {MAX_AGENT_TURNS, MAX_TOOL_CALLS, AuthorToolSession, parseAuthorToolDecision} from './author-tools';
import type {AuthorAnswer} from './author-corpus';

const runtimeModules = [
  'author-chat.ts',
  'author-tools.ts',
  'author-agent.ts',
  'author-retrieval.ts',
  'author-corpus.ts',
  'author-citations.ts',
  'author-style.ts',
  'author-avatars.ts',
  'author-errors.ts',
];

function moduleSource(name: string): string {
  return readFileSync(path.join(process.cwd(), 'lib', name), 'utf8');
}

test('runtime author modules never spawn zhurl or the shell', () => {
  for (const name of runtimeModules) {
    const source = moduleSource(name);
    assert.ok(!source.includes('child_process'), name);
    assert.ok(!source.includes('execFileSync'), name);
    assert.ok(!source.includes('execSync'), name);
    assert.ok(!source.includes('zhurl'), name);
  }
});

test('the only runtime network call is the model endpoint in author chat', () => {
  const fetchers = runtimeModules.filter((name) => moduleSource(name).includes('fetch('));
  assert.deepEqual(fetchers, ['author-chat.ts']);
  const tools = moduleSource('author-tools.ts');
  assert.ok(!tools.includes('http://'));
  assert.ok(!tools.includes('https://www.zhihu.com/api'));
  const agent = moduleSource('author-agent.ts');
  assert.ok(!agent.includes('http://'));
  assert.ok(!agent.includes('https://'));
});

test('the bounded loop keeps its documented budgets', () => {
  assert.equal(MAX_TOOL_CALLS, 2);
  assert.equal(MAX_AGENT_TURNS, 6);
});

test('read_answer still rejects paths and never leaves the searched answer set', () => {
  const answer: AuthorAnswer = {
    answerId: '1001', authorName: '合成作者', authorUrlToken: 'MarryMea',
    questionTitle: '合成问题', sourceUrl: 'https://www.zhihu.com/answer/1001',
    body: '合成正文。', completeness: 'fetched_api_content_unverified',
  };
  for (const bad of ['../secret', '/etc/passwd', 'answer-1001.json']) {
    assert.throws(() => parseAuthorToolDecision(JSON.stringify({tool: 'read_answer', args: {answerId: bad}})), /工具调用/);
  }
  const session = new AuthorToolSession([answer], 'MarryMea');
  const blocked = session.execute(parseAuthorToolDecision(JSON.stringify({tool: 'read_answer', args: {answerId: '1001'}})));
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.error.code, 'ANSWER_NOT_SEARCHED');
});
