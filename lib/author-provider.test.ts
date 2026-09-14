import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {FileAuthorCache} from './author-cache';
import {CompositeAuthorProvider, createLiveAuthorProvider, rankProviderError} from './author-live-provider';
import {HybridAuthorProvider, AuthorProviderError, validateAnswerSummary, validateAuthorAnswer, validateAuthorProfile, assertAuthorRef, type AnswerSummary, type AuthorAnswer, type AuthorProfile, type AuthorProvider, type AuthorRef} from './author-provider';
import {ZhihuOfficialProvider, officialViewerFromProfile} from './author-provider-official';

const token = 'synthetic-author';
const ref: AuthorRef = {provider: 'zhihu', urlToken: token, profileUrl: `https://www.zhihu.com/people/${token}`};
const profile: AuthorProfile = {urlToken: token, profileUrl: ref.profileUrl, displayName: '合成答主', gender: '女', fetchedAt: '2026-03-01T00:00:00.000Z', source: 'zhurl'};
const summary: AnswerSummary = {answerId: '1001', authorUrlToken: token, questionTitle: '合成问题', sourceUrl: 'https://www.zhihu.com/answer/1001', collectionMethod: 'profile-search'};
const answer: AuthorAnswer = {answerId: '1001', authorUrlToken: token, questionTitle: '合成问题', sourceUrl: 'https://www.zhihu.com/answer/1001', body: '合成正文。', completeness: 'fetched_api_content_unverified'};

function countingProvider(overrides: Partial<AuthorProvider> & {counter: {calls: number}}) {
  const {counter, ...rest} = overrides;
  const provider: AuthorProvider = {
    resolveProfile: async () => {counter.calls += 1; return profile;},
    listAnswers: async () => {counter.calls += 1; return [summary];},
    searchAnswers: async () => {counter.calls += 1; return [summary];},
    readAnswer: async () => {counter.calls += 1; return answer;},
    ...rest,
  };
  return provider;
}

async function withHybrid(online: AuthorProvider | undefined, task: (hybrid: HybridAuthorProvider, cache: FileAuthorCache, counter: {calls: number}) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), 'author-provider-synthetic-'));
  const counter = {calls: 0};
  try {
    const cache = new FileAuthorCache(root);
    const hybrid = new HybridAuthorProvider({cache, online: online ? () => online : undefined});
    await task(hybrid, cache, counter);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
}

test('hybrid uses the local cache first and never calls the online provider on a hit', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'author-provider-hit-'));
  const calls = {calls: 0};
  try {
    const cache = new FileAuthorCache(root);
    const online = countingProvider({counter: calls});
    const hybrid = new HybridAuthorProvider({cache, online: () => online});
    const first = await hybrid.resolveProfile(ref);
    assert.equal(first.source, 'zhurl');
    assert.equal(calls.calls, 1);
    const second = await hybrid.resolveProfile(ref);
    assert.equal(second.source, 'cache');
    assert.equal(second.stale, false);
    assert.equal(calls.calls, 1);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('hybrid falls back to a single online call and writes the verified result to the cache', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'author-provider-fallback-'));
  const counter = {calls: 0};
  try {
    const cache = new FileAuthorCache(root);
    const hybrid = new HybridAuthorProvider({cache, online: () => countingProvider({counter})});
    const resolved = await hybrid.resolveProfile(ref);
    assert.equal(resolved.source, 'zhurl');
    assert.equal(counter.calls, 1);
    assert.ok(await cache.readProfile(ref, 60_000));
    const again = await hybrid.resolveProfile(ref);
    assert.equal(again.source, 'cache');
    assert.equal(counter.calls, 1);
    const searched = await hybrid.searchAnswers(ref, '合成问题', 3);
    assert.equal(searched.length, 1);
    assert.equal(searched[0].collectionMethod, 'profile-search');
    const cachedSearch = await hybrid.searchAnswers(ref, '合成问题', 3);
    assert.equal(cachedSearch[0].collectionMethod, 'cache');
    assert.equal(counter.calls, 2);
    const detail = await hybrid.readAnswer(ref, '1001');
    assert.equal(detail.body, '合成正文。');
    assert.equal((await hybrid.readAnswer(ref, '1001')).body, '合成正文。');
    assert.equal(counter.calls, 3);
    const listed = await hybrid.listAnswers(ref, {sort: 'latest', limit: 5});
    assert.equal(listed.length, 1);
    assert.equal(listed[0].answerId, '1001');
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('online results that belong to another author are rejected before caching', async () => {
  const foreign = countingProvider({counter: {calls: 0}, searchAnswers: async () => [{...summary, authorUrlToken: 'someone-else'}]} as Partial<AuthorProvider> & {counter: {calls: number}});
  await withHybrid(foreign, async (hybrid) => {
    await assert.rejects(hybrid.searchAnswers(ref, '合成问题', 3), (error: unknown) => codeOf(error) === 'AUTHOR_EVIDENCE_INVALID');
    const badSource = countingProvider({counter: {calls: 0}, searchAnswers: async () => [{...summary, sourceUrl: 'https://www.zhihu.com/answer/9999'}]} as Partial<AuthorProvider> & {counter: {calls: number}});
    const hybrid2 = new HybridAuthorProvider({cache: new FileAuthorCache(await mkdtemp(path.join(tmpdir(), 'author-provider-bad-'))), online: () => badSource});
    await assert.rejects(hybrid2.searchAnswers(ref, '合成问题', 3), (error: unknown) => codeOf(error) === 'AUTHOR_EVIDENCE_INVALID');
  });
});

test('online failure uses a stale cache when one exists and reports the provider error otherwise', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'author-provider-stale-'));
  try {
    const clock = {value: Date.parse('2026-03-01T00:00:00.000Z')};
    const cache = new FileAuthorCache(root, () => clock.value);
    const failing: AuthorProvider = {
      resolveProfile: async () => {throw new AuthorProviderError('上游故障', 'AUTHOR_PROVIDER_UNAVAILABLE');},
      listAnswers: async () => {throw new AuthorProviderError('上游故障', 'AUTHOR_PROVIDER_UNAVAILABLE');},
      searchAnswers: async () => {throw new AuthorProviderError('上游故障', 'AUTHOR_PROVIDER_UNAVAILABLE');},
      readAnswer: async () => {throw new AuthorProviderError('上游故障', 'AUTHOR_PROVIDER_UNAVAILABLE');},
    };
    const cold = new HybridAuthorProvider({cache, online: () => failing});
    await assert.rejects(cold.resolveProfile(ref), (error: unknown) => {
      assert.ok(error instanceof AuthorProviderError);
      assert.equal(error.code, 'AUTHOR_PROVIDER_UNAVAILABLE');
      return true;
    });
    await cache.writeProfile(ref, profile);
    await cache.writeSearch(ref, '合成问题', 3, [summary]);
    await cache.writeAnswer(ref, answer);
    clock.value = Date.parse('2026-05-01T00:00:00.000Z');
    const stale = new HybridAuthorProvider({cache, online: () => failing});
    const staleProfile = await stale.resolveProfile(ref);
    assert.equal(staleProfile.stale, true);
    assert.equal(staleProfile.displayName, '合成答主');
    const staleSearch = await stale.searchAnswers(ref, '合成问题', 3);
    assert.equal(staleSearch[0].stale, true);
    const staleAnswer = await stale.readAnswer(ref, '1001');
    assert.equal(staleAnswer.stale, true);
    assert.equal(staleAnswer.body, '合成正文。');
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

const codeOf = (error: unknown) => (error instanceof AuthorProviderError ? error.code : String(error));

test('negative search results use the short ttl while positive results keep the long one', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'author-provider-negative-'));
  const clock = {value: Date.parse('2026-03-01T00:00:00.000Z')};
  const counter = {calls: 0};
  try {
    const cache = new FileAuthorCache(root, () => clock.value);
    const hybrid = new HybridAuthorProvider({
      cache,
      online: () => countingProvider({counter, searchAnswers: async () => {counter.calls += 1; return [];}}),
      ttl: {searchMs: 60_000, negativeMs: 1_000},
      now: () => clock.value,
    });
    assert.deepEqual(await hybrid.searchAnswers(ref, '没有命中的问题', 3), []);
    assert.deepEqual(await hybrid.searchAnswers(ref, '没有命中的问题', 3), []);
    assert.equal(counter.calls, 1, 'a short-lived negative result must not trigger a second online call');
    clock.value += 2_000;
    assert.deepEqual(await hybrid.searchAnswers(ref, '没有命中的问题', 3), []);
    assert.equal(counter.calls, 2, 'an expired negative result may be retried online');
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('validation helpers reject cross-author payloads and forged urls', () => {
  const invalid = (task: () => unknown) => assert.throws(task, (error: unknown) => codeOf(error) === 'AUTHOR_EVIDENCE_INVALID');
  invalid(() => assertAuthorRef({provider: 'zhihu', urlToken: '../escape', profileUrl: 'https://www.zhihu.com/people/../escape'}));
  invalid(() => validateAuthorProfile({...profile, displayName: ''}, ref));
  invalid(() => validateAuthorProfile(profile, {...ref, urlToken: 'other'}));
  invalid(() => validateAnswerSummary({...summary, authorUrlToken: 'other'}, ref));
  invalid(() => validateAnswerSummary({...summary, sourceUrl: 'javascript:alert(1)'}, ref));
  invalid(() => validateAuthorAnswer({...answer, body: ''}, ref));
  invalid(() => validateAuthorProfile({...profile, headline: 'x'.repeat(300)}, ref));
  assert.equal(validateAuthorAnswer(answer, ref).answerId, '1001');
});

test('the composite provider keeps the most actionable error', () => {
  assert.ok(rankProviderError(new AuthorProviderError('需要授权', 'AUTHOR_AUTH_REQUIRED')) > rankProviderError(new AuthorProviderError('不可用', 'AUTHOR_PROVIDER_UNAVAILABLE')));
  const composite = new CompositeAuthorProvider([
    {resolveProfile: async () => {throw new AuthorProviderError('需要授权', 'AUTHOR_AUTH_REQUIRED');}, listAnswers: async () => [], searchAnswers: async () => [], readAnswer: async () => {throw new Error('unused');}},
    {resolveProfile: async () => profile, listAnswers: async () => [], searchAnswers: async () => [], readAnswer: async () => {throw new Error('unused');}},
  ]);
  return composite.resolveProfile(ref).then((value) => assert.equal(value.displayName, '合成答主'));
});

test('the official provider refuses to read another author and never claims full text', async () => {
  const anonymous = new ZhihuOfficialProvider({fetchImpl: async () => new Response('{}')});
  await assert.rejects(anonymous.resolveProfile(ref), (error: unknown) => codeOf(error) === 'AUTHOR_AUTH_REQUIRED');
  const viewer = {urlToken: 'the-viewer', displayName: '登录用户'};
  const authorized = new ZhihuOfficialProvider({accessSecret: 'secret', oauthToken: 'oauth', viewer, fetchImpl: async () => new Response('{}')});
  await assert.rejects(authorized.resolveProfile(ref), (error: unknown) => codeOf(error) === 'AUTHOR_CONTENT_UNSUPPORTED');
  await assert.rejects(authorized.searchAnswers(ref), (error: unknown) => codeOf(error) === 'AUTHOR_CONTENT_UNSUPPORTED');
  await assert.rejects(authorized.readAnswer(ref), (error: unknown) => codeOf(error) === 'AUTHOR_CONTENT_UNSUPPORTED');
  const own = await authorized.resolveProfile({provider: 'zhihu', urlToken: 'the-viewer', profileUrl: 'https://www.zhihu.com/people/the-viewer'});
  assert.equal(own.displayName, '登录用户');
  assert.equal(own.source, 'official');
});

test('the official provider maps paging payloads to summaries and surfaces api error codes', async () => {
  const viewer = {urlToken: 'the-viewer', displayName: '登录用户', gender: '女' as const};
  const body = (payload: unknown) => new Response(JSON.stringify(payload), {status: 200, headers: {'Content-Type': 'application/json'}});
  const pages = [{
    Code: 0, Message: 'success', Data: {
      Items: [
        {ContentType: 'answer', Url: 'https://www.zhihu.com/answer/2002', CreatedAt: 1_700_000_000, LikeCount: 12, Title: '合成标题', Summary: '合成摘要'},
        {ContentType: 'article', Url: 'https://zhuanlan.zhihu.com/p/1', Title: '文章', Summary: '摘要'},
      ],
      Paging: {IsEnd: false, NextOffset: '2', Totals: 30},
    },
  }];
  const seen: string[] = [];
  const provider = new ZhihuOfficialProvider({
    accessSecret: 'secret', oauthToken: 'oauth', viewer,
    fetchImpl: async (input) => {seen.push(String(input)); return body(pages.shift());},
  });
  const ownRef: AuthorRef = {provider: 'zhihu', urlToken: 'the-viewer', profileUrl: 'https://www.zhihu.com/people/the-viewer'};
  const items = await provider.listAnswers(ownRef, {sort: 'top-voteups', limit: 20});
  assert.equal(items.length, 1);
  assert.equal(items[0].answerId, '2002');
  assert.equal(items[0].collectionMethod, 'runtime-live');
  assert.equal(items[0].sourceUrl, 'https://www.zhihu.com/answer/2002');
  assert.ok(seen[0].includes('SortField=like_count'));
  assert.ok(seen[0].includes('Limit=20'));
  const unauthorized = new ZhihuOfficialProvider({accessSecret: 'secret', oauthToken: 'oauth', viewer, fetchImpl: async () => body({Code: 20001, Message: '鉴权失败'})});
  await assert.rejects(unauthorized.listAnswers(ownRef, {sort: 'latest', limit: 5}), (error: unknown) => codeOf(error) === 'AUTHOR_AUTH_REQUIRED');
  const limited = new ZhihuOfficialProvider({accessSecret: 'secret', oauthToken: 'oauth', viewer, fetchImpl: async () => body({Code: 30001, Message: '频率限制'})});
  await assert.rejects(limited.listAnswers(ownRef, {sort: 'latest', limit: 5}), (error: unknown) => codeOf(error) === 'AUTHOR_RATE_LIMITED');
});

test('the live provider stays unavailable without credentials instead of inventing content', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'author-provider-empty-'));
  try {
    const provider = createLiveAuthorProvider({root, env: {NODE_ENV: 'test'}, viewer: null});
    await assert.rejects(provider.resolveProfile(ref), (error: unknown) => {
      assert.ok(error instanceof AuthorProviderError);
      assert.equal(error.code, 'AUTHOR_PROVIDER_UNAVAILABLE');
      return true;
    });
    const ownToken = {provider: 'zhihu' as const, urlToken: 'the-viewer', profileUrl: 'https://www.zhihu.com/people/the-viewer'};
    const viewerProvider = createLiveAuthorProvider({root, env: {NODE_ENV: 'test'}, viewer: {urlToken: 'the-viewer', displayName: '登录用户'}});
    await assert.rejects(viewerProvider.resolveProfile(ownToken), (error: unknown) => {
      assert.ok(error instanceof AuthorProviderError);
      assert.equal(error.code, 'AUTHOR_AUTH_REQUIRED');
      return true;
    });
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('official viewer parsing only accepts usable profile payloads', () => {
  assert.equal(officialViewerFromProfile(null), null);
  assert.equal(officialViewerFromProfile({id: null, name: '没有标识', avatarUrl: null, headline: null}), null);
  assert.equal(officialViewerFromProfile({id: 'open-token', name: null, avatarUrl: null, headline: null}), null);
  assert.equal(officialViewerFromProfile({id: 'open-token', name: '合成用户', avatarUrl: null, headline: null})?.urlToken, 'open-token');
  assert.equal(officialViewerFromProfile({id: 'open-token', name: '合成用户', avatarUrl: 'https://pic.test/a.jpg', headline: '一句话'})?.headline, '一句话');
});
