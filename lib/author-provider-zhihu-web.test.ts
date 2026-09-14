import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {AuthorProviderError} from './author-provider';
import {createAuthorRateLimiter} from './author-rate-limit';
import {createZhihuWebProvider, htmlToText, memberSearchUrl, PublicProfileOnlyProvider, ZhihuWebProvider, UnconfiguredSourceProvider} from './author-provider-zhihu-web';
import {accountFileFrom, resetWebCredentialCache, resolveWebCredentials} from './author-web-credentials';

const token = 'synthetic-web-author';
const ref = {provider: 'zhihu' as const, urlToken: token, profileUrl: `https://www.zhihu.com/people/${token}`};
const credentials = {cookie: 'z_c0=synthetic; _xsrf=synthetic', userAgent: 'synthetic-agent', source: 'env' as const};
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
const codeOf = (error: unknown) => (error instanceof AuthorProviderError ? error.code : String(error));

function provider(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  const calls: {url: string; cookie?: string; agent?: string}[] = [];
  const instance = new ZhihuWebProvider({
    credentials,
    limiter: createAuthorRateLimiter({maxPerMinute: 1000, minIntervalMs: 0, now: () => Date.now()}),
    fetchImpl: (async (input: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({url: String(input), cookie: headers.Cookie, agent: headers['User-Agent']});
      return handler(String(input), init);
    }) as unknown as typeof fetch,
  });
  return {instance, calls};
}

test('the web provider reads profile, answers, search and detail with server cookies', async () => {
  const {instance, calls} = provider(async (url) => {
    if (url.includes('/members/synthetic-web-author/answers')) {
      return json({data: [{id: '2002', type: 'answer', question: {title: '合成问题'}, author: {url_token: token}, voteup_count: 12, created_time: 1_700_000_000, excerpt: '<b>合成摘要</b>'}]});
    }
    if (url.includes('search_v3')) {
      return json({data: [{object: {type: 'answer', id: '3003', question: {name: '搜索到的问题'}, author: {url_token: token}, excerpt: '搜索摘要'}}]});
    }
    if (url.includes('/answers/4004')) {
      return json({id: '4004', author: {url_token: token, name: '合成作者'}, question: {title: '详情问题'}, content: '<p>第一段</p><p>第二段</p>'});
    }
    return json({id: 'hash-id-123456', url_token: token, name: '合成答主', headline: '合成签名', answer_count: 42, gender: 'female', avatar_url: 'https://pic.test/a.jpg'});
  });

  const profile = await instance.resolveProfile(ref);
  assert.equal(profile.displayName, '合成答主');
  assert.equal(profile.answerCount, 42);
  assert.equal(profile.gender, '女');
  assert.equal(profile.source, 'web');

  const list = await instance.listAnswers(ref, {sort: 'top-voteups', limit: 5});
  assert.equal(list.length, 1);
  assert.equal(list[0].answerId, '2002');
  assert.equal(list[0].excerpt, '合成摘要');

  const search = await instance.searchAnswers(ref, '转专业', 3);
  assert.equal(search.length, 1);
  assert.equal(search[0].answerId, '3003');
  assert.equal(search[0].collectionMethod, 'profile-search');

  const detail = await instance.readAnswer(ref, '4004');
  assert.equal(detail.body, '第一段\n第二段');
  assert.equal(detail.completeness, 'fetched_api_content_unverified');
  assert.ok(detail.contentHash && detail.contentHash.length === 64);

  for (const call of calls) {
    assert.equal(call.cookie, credentials.cookie, '每次请求都要带服务端 cookie');
    assert.equal(call.agent, credentials.userAgent);
  }
});

test('the web provider classifies auth, rate limit, missing author and bad payloads', async () => {
  const cases: [() => Promise<Response>, string][] = [
    [async () => json({error: {need_login: true, redirect: 'https://www.zhihu.com/account/unhuman'}}, 403), 'AUTHOR_AUTH_REQUIRED'],
    [async () => new Response('<html>安全验证</html>', {status: 403}), 'AUTHOR_RATE_LIMITED'],
    [async () => json({error: {message: '不存在'}}, 404), 'AUTHOR_NOT_FOUND'],
    [async () => new Response('not json', {status: 200}), 'AUTHOR_PROVIDER_UNAVAILABLE'],
    [async () => json({url_token: 'someone-else'}), 'AUTHOR_EVIDENCE_INVALID'],
    [async () => {throw new Error('network down');}, 'AUTHOR_PROVIDER_UNAVAILABLE'],
  ];
  for (const [handler, expected] of cases) {
    const {instance} = provider(handler);
    await assert.rejects(instance.resolveProfile(ref), (error: unknown) => codeOf(error) === expected, expected);
  }
  const limited = provider(async () => json({error: {message: '频率限制'}}, 429));
  await assert.rejects(limited.instance.searchAnswers(ref, '问题', 3), (error: unknown) => codeOf(error) === 'AUTHOR_RATE_LIMITED');
});

test('a blocked profile api falls back to the public page meta tags', async () => {
  const {instance} = provider(async (url) => {
    if (url.includes('/api/v4/members/')) return json({error: {need_login: true}}, 403);
    return new Response([
      '<html><head>',
      `<meta property="og:title" content="公开昵称" />`,
      `<meta property="og:image" content="https://pic.test/public.jpg" />`,
      `<meta property="og:description" content="公开签名" />`,
      '</head></html>',
    ].join(''), {status: 200, headers: {'Content-Type': 'text/html'}});
  });
  const profile = await instance.resolveProfile(ref);
  assert.equal(profile.displayName, '公开昵称');
  assert.equal(profile.avatarUrl, 'https://pic.test/public.jpg');
  assert.equal(profile.headline, '公开签名');
  assert.equal(profile.gender, 'unknown');
});

test('without credentials the provider falls back to the public page and refuses to answer questions', async () => {
  const hardFail = createZhihuWebProvider({credentials: null, allowPublicPageFallback: false});
  assert.ok(hardFail instanceof UnconfiguredSourceProvider);
  await assert.rejects(hardFail.resolveProfile(ref), (error: unknown) => codeOf(error) === 'AUTHOR_SOURCE_UNCONFIGURED');
  await assert.rejects(hardFail.searchAnswers(ref, '问题', 3), (error: unknown) => codeOf(error) === 'AUTHOR_SOURCE_UNCONFIGURED');

  // 公开主页能解析时，邀请仍可完成；但回答与检索必须明确报「未配置内容来源」。
  const fallback = createZhihuWebProvider({
    credentials: null,
    fetchImpl: (async () => new Response('<meta property="og:title" content="公开昵称" />', {status: 200, headers: {'Content-Type': 'text/html'}})) as unknown as typeof fetch,
  });
  assert.ok(fallback instanceof PublicProfileOnlyProvider);
  const profile = await fallback.resolveProfile(ref);
  assert.equal(profile.displayName, '公开昵称');
  assert.equal(profile.source, 'web');
  await assert.rejects(fallback.listAnswers(ref, {sort: 'latest', limit: 3}), (error: unknown) => codeOf(error) === 'AUTHOR_SOURCE_UNCONFIGURED');
  await assert.rejects(fallback.readAnswer(ref, '1001'), (error: unknown) => codeOf(error) === 'AUTHOR_SOURCE_UNCONFIGURED');

  // 公开主页也拿不到时，必须报「未配置」而不是伪造资料
  const blocked = createZhihuWebProvider({
    credentials: null,
    fetchImpl: (async () => new Response('<html>安全验证</html>', {status: 403})) as unknown as typeof fetch,
  });
  await assert.rejects(blocked.resolveProfile(ref), (error: unknown) => codeOf(error) === 'AUTHOR_SOURCE_UNCONFIGURED');
});

test('credentials come from the environment first and fall back to the zhihu++ account file', async () => {
  resetWebCredentialCache();
  const fromEnv = resolveWebCredentials({NODE_ENV: 'test', ZHIHU_WEB_COOKIE: 'z_c0=env-cookie', ZHIHU_WEB_USER_AGENT: 'env-agent'});
  assert.equal(fromEnv?.cookie, 'z_c0=env-cookie');
  assert.equal(fromEnv?.source, 'env');

  const root = await mkdtemp(path.join(tmpdir(), 'author-web-credentials-'));
  const file = path.join(root, 'account.json');
  try {
    await writeFile(file, JSON.stringify({
      activeAccountId: 'a2',
      accounts: [
        {id: 'a1', session: {login: true, userAgent: 'old-agent', cookies: {z_c0: 'old'}}},
        {id: 'a2', session: {login: true, userAgent: 'active-agent', cookies: {z_c0: 'active', _xsrf: 'active'}}},
      ],
    }));
    resetWebCredentialCache();
    const fromFile = resolveWebCredentials({NODE_ENV: 'test', ZHIHU_WEB_ACCOUNT_FILE: file});
    assert.ok(fromFile?.cookie.includes('z_c0=active'), '优先使用当前激活账号');
    assert.equal(fromFile?.userAgent, 'active-agent');
    assert.equal(fromFile?.source, 'account-file');

    // 未登录的账号文件不产生凭证
    await writeFile(file, JSON.stringify({activeAccountId: 'a1', accounts: [{id: 'a1', session: {login: false, cookies: {}}}]}));
    resetWebCredentialCache();
    assert.equal(resolveWebCredentials({NODE_ENV: 'test', ZHIHU_WEB_ACCOUNT_FILE: file}), null);
    assert.equal(accountFileFrom({NODE_ENV: 'test', ZHIHU_WEB_ACCOUNT_FILE: file}), file);
  } finally {
    resetWebCredentialCache();
    await rm(root, {recursive: true, force: true});
  }
});

test('html conversion and the member search url keep their contracts', () => {
  assert.equal(htmlToText('<script>alert(1)</script><p>第一段&nbsp;内容</p><br/><p>第二段 <b>加粗</b></p>'), '第一段 内容\n第二段 加粗');
  const url = memberSearchUrl('合成检索', 'abc123def456', 0, 10);
  assert.ok(url.startsWith('https://www.zhihu.com/api/v4/search_v3?'));
  assert.ok(url.includes('restricted_scene=member') && url.includes('restricted_value=abc123def456'));
  assert.ok(url.includes(`q=${encodeURIComponent('合成检索')}`));
});
