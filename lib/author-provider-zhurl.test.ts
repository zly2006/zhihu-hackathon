import assert from 'node:assert/strict';
import test from 'node:test';
import {classifyZhurlFailure, createSpawnZhurlRunner, htmlToText, memberSearchUrl} from './author-provider-zhurl';

test('zhurl failures keep auth, rate limit and missing-profile classes apart', () => {
  assert.equal(classifyZhurlFailure('zhurl: 404 not found')?.code, 'AUTHOR_NOT_FOUND');
  assert.equal(classifyZhurlFailure('{"code":404,"name":"NotFound"}')?.code, 'AUTHOR_NOT_FOUND');
  assert.equal(classifyZhurlFailure('页面不存在')?.code, 'AUTHOR_NOT_FOUND');
  assert.equal(classifyZhurlFailure('未登录，请先登录知乎')?.code, 'AUTHOR_AUTH_REQUIRED');
  assert.equal(classifyZhurlFailure('HTTP 403 Forbidden')?.code, 'AUTHOR_AUTH_REQUIRED');
  assert.equal(classifyZhurlFailure('操作频繁，请稍后再试')?.code, 'AUTHOR_RATE_LIMITED');
  assert.equal(classifyZhurlFailure('429 Too Many Requests')?.code, 'AUTHOR_RATE_LIMITED');
  assert.equal(classifyZhurlFailure('unexpected failure'), null);
  assert.equal(classifyZhurlFailure(''), null);
});

test('zhurl relies on ZHURL_BIN and never hardcodes a credential path', () => {
  const runner = createSpawnZhurlRunner('synthetic-zhurl-not-installed');
  return runner('https://www.zhihu.com/api/v4/members/someone').then(
    () => assert.fail('a missing binary must fail'),
    (error: unknown) => assert.equal((error as {code?: string}).code, 'AUTHOR_PROVIDER_UNAVAILABLE'),
  );
});

test('member scoped search keeps the restricted member parameters', () => {
  const url = memberSearchUrl('合成检索', 'abc123def456', 0, 10);
  assert.ok(url.startsWith('https://www.zhihu.com/api/v4/search_v3?'));
  assert.ok(url.includes('restricted_scene=member'));
  assert.ok(url.includes('restricted_field=member_hash_id'));
  assert.ok(url.includes('restricted_value=abc123def456'));
  assert.ok(url.includes(`q=${encodeURIComponent('合成检索')}`));
});

test('html to text drops scripts, tags and entities without inventing content', () => {
  const text = htmlToText('<script>alert(1)</script><p>第一段&nbsp;内容</p><br/><p>第二段 <b>加粗</b></p>');
  assert.equal(text, '第一段 内容\n第二段 加粗');
  assert.ok(!text.includes('alert'));
});
