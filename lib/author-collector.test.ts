import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  CollectorStop,
  analyzeTopicGaps,
  answerSourceUrl,
  filterNewCandidates,
  generalSearchUrl,
  htmlToText,
  inspectAnswerDetail,
  loadProjectEnv,
  memberSearchUrl,
  planBatchSplits,
  planQueriesDeterministic,
  resolveZhurl,
  validateAnswerId,
} from '../scripts/lib/author-collect.mjs';
import {buildPlannerMessages, createDeepseekPlanner, createPlannerFromEnv, parsePlannerReply, planQueries, planQueriesWithModel, resolvePlannerCredentials} from '../scripts/lib/author-plan.mjs';
import {flattenAccount, prepareZhurlEnv} from '../scripts/lib/zhurl-compat.mjs';
import {loadAuthorCorpus} from './author-corpus';

const topics = [
  {id: 'biology', label: '生物', keywords: ['生物', '基因'], queries: ['生物学 学习', '基因 科普']},
  {id: 'career', label: '职业', keywords: ['职业', '求职'], queries: ['职业规划', '求职 建议']},
];

test('html cleaning keeps readable text and drops scripts', () => {
  const text = htmlToText('<script>bad()</script><p>第一段 &amp; 内容</p><div>第二段<br>换行</div><img alt="图示">');
  assert.ok(text.includes('第一段 & 内容'));
  assert.ok(text.includes('第二段'));
  assert.ok(text.includes('图示'));
  assert.ok(!text.includes('bad()'));
});

test('answer ids and source URLs are validated', () => {
  assert.equal(validateAnswerId('12345'), '12345');
  assert.equal(validateAnswerId('12a'), '');
  assert.equal(validateAnswerId('../etc'), '');
  assert.equal(answerSourceUrl('12345'), 'https://www.zhihu.com/answer/12345');
});

test('detail inspection rejects paid, foreign, empty and short answers', () => {
  const base = {author: {url_token: 'MarryMea', name: '合成作者'}, question: {title: '合成问题'}, content: `<p>${'合成正文。'.repeat(60)}</p>`, paid_info: {is_paid: false}};
  assert.equal(inspectAnswerDetail(base, {authorToken: 'MarryMea', answerId: '1', minBody: 200}).status, 'ok');
  assert.equal(inspectAnswerDetail({...base, paid_info: {is_paid: true}}, {authorToken: 'MarryMea', answerId: '1', minBody: 200}).reason, 'paid');
  assert.equal(inspectAnswerDetail({...base, author: {url_token: 'other', name: '他人'}}, {authorToken: 'MarryMea', answerId: '1', minBody: 200}).reason, 'author-mismatch');
  assert.equal(inspectAnswerDetail({...base, content: '<p>太短</p>'}, {authorToken: 'MarryMea', answerId: '1', minBody: 200}).reason, 'body-length-2');
  const ok = inspectAnswerDetail(base, {authorToken: 'MarryMea', answerId: '1', minBody: 200}) as {status: string; answer: {completeness: string; sourceUrl: string}};
  assert.equal(ok.status, 'ok');
  assert.equal(ok.answer.completeness, 'fetched_api_content_unverified');
  assert.equal(ok.answer.sourceUrl, 'https://www.zhihu.com/answer/1');
});

test('topic gaps count answers and sort the emptiest first', () => {
  const corpus = [
    {answerId: '1', title: '生物与基因', text: '生物 基因 内容'},
    {answerId: '2', title: '职业规划', text: '职业 求职 内容'},
    {answerId: '3', title: '求职复盘', text: '求职 经验'},
  ];
  const gaps = analyzeTopicGaps(corpus, topics, 2);
  assert.deepEqual(gaps.map((gap: {id: string}) => gap.id), ['biology', 'career']);
  assert.equal(gaps[0].count, 1);
  assert.equal(gaps[0].missing, 1);
  assert.equal(gaps[1].count, 2);
  assert.equal(gaps[1].missing, 0);
  assert.throws(() => analyzeTopicGaps(corpus, topics, 0), /正整数/);
});

test('deterministic query planning skips satisfied topics and caps the list', () => {
  const satisfied = [
    {answerId: '1', title: '职业规划', text: '职业 求职 内容'},
    {answerId: '2', title: '求职复盘', text: '求职 经验'},
  ];
  const gaps = analyzeTopicGaps(satisfied, topics, 2);
  const planned = planQueriesDeterministic(gaps, topics, 3);
  assert.equal(planned.length, 2);
  assert.deepEqual(planned.map((entry) => entry.query), ['生物学 学习', '基因 科普']);
  assert.ok(planned.every((entry) => entry.source === 'deterministic'));
  assert.equal(planQueriesDeterministic(gaps, topics, 1).length, 1);
  assert.throws(() => planQueriesDeterministic(gaps, topics, 0), /maxQueries/);
});

test('candidate filtering enforces author, dedupe and id format', () => {
  const items = [
    {id: '9001', author: {url_token: 'MarryMea'}, question: {title: '一'}, voteup_count: 3},
    {id: '9001', author: {url_token: 'MarryMea'}, question: {title: '重复'}},
    {id: '9002', author: {url_token: 'other'}, question: {title: '跨作者'}},
    {id: '../etc', author: {url_token: 'MarryMea'}, question: {title: '非法'}},
  ];
  const seen = new Set();
  const existingIds = new Set(['9003']);
  const candidates = filterNewCandidates(items, {existingIds, seen, authorToken: 'MarryMea'});
  assert.deepEqual(candidates.map((candidate) => candidate.answerId), ['9001']);
  assert.ok(seen.has('9001'));
});

test('batch splitting respects record count and byte budget', () => {
  const record = (id: string, size: number) => ({answerId: id, raw: Buffer.alloc(size)});
  const records = Array.from({length: 31}, (_, index) => record(String(index), 10));
  const byCount = planBatchSplits(records, {batchSize: 30, maxBytes: 1_000_000});
  assert.deepEqual(byCount.map((batch) => batch.length), [30, 1]);
  const byBytes = planBatchSplits([record('1', 400), record('2', 400), record('3', 400)], {batchSize: 30, maxBytes: 500});
  assert.deepEqual(byBytes.map((batch) => batch.length), [1, 1, 1]);
  assert.throws(() => planBatchSplits(records, {batchSize: 31, maxBytes: 100}), /每批记录数/);
});

test('planner reply validation enforces topics, characters and caps', () => {
  const valid = JSON.stringify({queries: [{topic: 'biology', query: '生物学 学习'}, {topic: 'career', query: '职业规划'}]});
  const parsed = parsePlannerReply(valid, {topics, maxQueries: 5});
  assert.deepEqual(parsed.map((entry) => entry.query), ['生物学 学习', '职业规划']);
  assert.ok(parsed.every((entry) => entry.source === 'model'));
  assert.throws(() => parsePlannerReply(JSON.stringify({queries: [{topic: 'unknown', query: '生物'}]}), {topics, maxQueries: 5}), /未知话题/);
  assert.throws(() => parsePlannerReply(JSON.stringify({queries: [{topic: 'biology', query: '见 https://evil.test'}]}), {topics, maxQueries: 5}), /非法字符/);
  assert.throws(() => parsePlannerReply(JSON.stringify({queries: [{topic: 'biology', query: 'C:\\secret'}]}), {topics, maxQueries: 5}), /非法字符/);
  assert.throws(() => parsePlannerReply('不是 JSON', {topics, maxQueries: 5}), /JSON/);
  const messy = `好的，这是计划：\n\`\`\`json\n${JSON.stringify({queries: [{topic: 'biology', query: '基因 科普'}]})}\n\`\`\`\n希望有帮助。`;
  assert.equal(parsePlannerReply(messy, {topics, maxQueries: 5})[0].query, '基因 科普');
  const deduped = parsePlannerReply(JSON.stringify({queries: [{topic: 'biology', query: '生物学 学习'}, {topic: 'biology', query: '生物学 学习'}]}), {topics, maxQueries: 5});
  assert.equal(deduped.length, 1);
  const capped = parsePlannerReply(JSON.stringify({queries: [{topic: 'biology', query: 'a1'}, {topic: 'biology', query: 'a2'}, {topic: 'career', query: 'a3'}]}), {topics, maxQueries: 2});
  assert.equal(capped.length, 2);
});

test('planner messages stay string-encoded and the model path falls back safely', async () => {
  const gaps = analyzeTopicGaps([], topics, 2);
  const messages = (buildPlannerMessages as (input: {gaps: unknown[]; corpusTitles: string[]; maxQueries: number}) => {role: string; content: string}[])({gaps, corpusTitles: ['合成标题'], maxQueries: 5});
  assert.ok(messages.every((message) => typeof message.content === 'string'));
  const model = await planQueriesWithModel({gaps, topics, corpusTitles: [], maxQueries: 5, callModel: async () => JSON.stringify({queries: [{topic: 'biology', query: '基因 科普'}]})});
  assert.equal(model.planner, 'model');
  assert.equal(model.queries[0].query, '基因 科普');
  const broken = await planQueriesWithModel({gaps, topics, corpusTitles: [], maxQueries: 5, callModel: async () => '不是 JSON'});
  assert.equal(broken.planner, 'deterministic-fallback');
  assert.ok(broken.plannerError && broken.queries.length > 0);
  const offline = await planQueries({gaps, topics, corpusTitles: [], maxQueries: 5, planner: 'model', callModel: undefined});
  assert.equal(offline.planner, 'deterministic');
  assert.ok(offline.plannerError);
  assert.equal(createDeepseekPlanner(), undefined);
});

test('project env loading fills missing variables and never overrides existing ones', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'zhihu-env-'));
  const key = 'ZHURL_TEST_PROJECT_ENV';
  try {
    const file = path.join(directory, 'env-test');
    delete process.env[key];
    await writeFile(file, `# comment\n${key}=from-file\n`);
    const applied = loadProjectEnv(file);
    assert.ok(applied.includes(key));
    assert.equal(process.env[key], 'from-file');
    process.env[key] = 'existing';
    const again = loadProjectEnv(file);
    assert.ok(!again.includes(key));
    assert.equal(process.env[key], 'existing');
  } finally {
    delete process.env[key];
    await rm(directory, {recursive: true, force: true});
  }
});

test('zhurl compatibility accepts the nested account format only when logged in', () => {
  assert.equal(flattenAccount(null), null);
  assert.equal(flattenAccount({login: true, cookies: {z_c0: 'x'}}), null);
  assert.equal(flattenAccount({activeAccountId: 'a', accounts: [{id: 'a', session: {login: false, cookies: {z_c0: 'x'}}}]}), null);
  assert.equal(flattenAccount({activeAccountId: 'a', accounts: [{id: 'a', session: {login: true}}]}), null);
  assert.equal(flattenAccount('not-an-object'), null);
  const flat = flattenAccount({activeAccountId: 'a', accounts: [{id: 'a', session: {login: true, userAgent: 'UA', cookies: {z_c0: 'x', d_c0: 'y'}}}]});
  assert.deepEqual(flat, {login: true, userAgent: 'UA', cookies: {z_c0: 'x', d_c0: 'y'}});
});

test('zhurl compatibility writes a temp HOME and removes it afterwards', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'zhurl-src-home-'));
  const originalHome = process.env.HOME;
  try {
    await mkdir(path.join(home, '.zhihu-plus-plus'), {recursive: true});
    await writeFile(path.join(home, '.zhihu-plus-plus', 'account.json'), JSON.stringify({
      activeAccountId: 'a',
      accounts: [{id: 'a', session: {login: true, userAgent: 'UA', cookies: {z_c0: 'x', d_c0: 'y'}}}],
    }));
    process.env.HOME = home;
    const {env, cleanup} = prepareZhurlEnv();
    const tempHome = env.HOME as string;
    assert.notEqual(tempHome, home);
    const written = JSON.parse(await readFile(path.join(tempHome, '.zhihu-plus-plus', 'account.json'), 'utf8'));
    assert.equal(written.login, true);
    assert.equal(written.cookies.z_c0, 'x');
    assert.equal(written.userAgent, 'UA');
    cleanup();
    assert.ok(!existsSync(tempHome));
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await rm(home, {recursive: true, force: true});
  }
});

test('member-scoped search URLs carry the restricted member parameters', () => {
  const url = memberSearchUrl({query: '研究生 导师', offset: 20, limit: 20, memberHashId: 'abc123def456'});
  assert.ok(url.startsWith('https://www.zhihu.com/api/v4/search_v3?'));
  assert.ok(url.includes('restricted_scene=member'));
  assert.ok(url.includes('restricted_field=member_hash_id'));
  assert.ok(url.includes('restricted_value=abc123def456'));
  assert.ok(url.includes('offset=20'));
  assert.ok(url.includes(encodeURIComponent('研究生 导师')));
  assert.ok(generalSearchUrl('远程工作', 0, 20).includes('t=general'));
});

test('planner credentials fall back from deepseek to opencode', () => {
  const envOf = (value: Record<string, string>) => value as NodeJS.ProcessEnv;
  assert.equal(resolvePlannerCredentials(envOf({})), undefined);
  const opencode = resolvePlannerCredentials(envOf({OPENCODE_API_KEY: 'k', OPENCODE_MODEL: 'deepseek-v4.1-flash'}));
  assert.equal(opencode?.model, 'deepseek-v4.1-flash');
  assert.ok(opencode?.endpoint.includes('opencode.ai'));
  const deepseek = resolvePlannerCredentials(envOf({DEEPSEEK_API_KEY: 'd', OPENCODE_API_KEY: 'k'}));
  assert.ok(deepseek?.endpoint.includes('deepseek.com'));
  assert.equal(createPlannerFromEnv(envOf({})), undefined);
  assert.equal(typeof createPlannerFromEnv(envOf({OPENCODE_API_KEY: 'k'})), 'function');
});

const mockZhurl = `import process from 'node:process';
const url = process.argv[process.argv.length - 1];
if (url.includes('fail-auth')) {
  process.stderr.write('HTTP 401 unauthorized: need login');
  process.exit(1);
}
let payload;
if (url.includes('/members/') && !url.includes('/answers') && !url.includes('/search')) {
  payload = {id: 'abcdef0123456789abcdef0123456789', name: '合成作者', url_token: 'MarryMea'};
} else if (url.includes('/members/') && url.includes('/answers')) {
  payload = {data: [{id: '9002', question: {title: '合成问题二'}, voteup_count: 3}], paging: {is_end: true}};
} else if (url.includes('/search_v3')) {
  payload = {data: [{object: {type: 'answer', id: '9001', author: {url_token: 'MarryMea'}, question: {title: '合成问题一'}, voteup_count: 5}}], paging: {is_end: true}};
} else if (url.includes('/answers/9001')) {
  payload = {id: '9001', author: {url_token: 'MarryMea', name: '合成作者'}, question: {title: '合成问题一'}, content: '<p>' + '合成正文内容。'.repeat(40) + '</p>', voteup_count: 5, created_time: 1, updated_time: 2, paid_info: {is_paid: false}};
} else if (url.includes('/answers/9002')) {
  payload = {id: '9002', author: {url_token: 'MarryMea', name: '合成作者'}, question: {title: '合成问题二'}, content: '<p>' + '合成正文内容。'.repeat(40) + '</p>', voteup_count: 3, created_time: 1, updated_time: 2, paid_info: {is_paid: false}};
} else {
  payload = {error: {message: 'unexpected url ' + url}};
}
process.stdout.write(JSON.stringify(payload));
`;

async function withTempProject(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), 'zhihu-gaps-e2e-'));
  try {
    const mockPath = path.join(directory, 'mock-zhurl.mjs');
    await writeFile(mockPath, mockZhurl);
    await run(directory);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}

function runCli(script: string, directory: string, args: string[], zhurl: string) {
  return spawnSync(process.execPath, [path.resolve(script), ...args], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 60_000,
    env: {...process.env, ZHURL_BIN: zhurl, DEEPSEEK_API_KEY: '', DEEPSEEK_ENDPOINT: '', DEEPSEEK_MODEL: ''},
  });
}

test('gap collector writes a valid batch through a mocked zhurl', async () => {
  await withTempProject(async (directory) => {
    const result = runCli('scripts/collect-author-gaps.mjs', directory, ['--author', 'MarryMea', '--topic', 'biology', '--limit', '2', '--delay-ms', '0', '--planner', 'deterministic'], path.join(directory, 'mock-zhurl.mjs'));
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('done: 1 answers written'));
    const corpus = await loadAuthorCorpus(path.join(directory, '.data', 'author-avatars', 'MarryMea'), 'MarryMea');
    assert.equal(corpus.recordCount, 1);
    assert.equal(corpus.answers[0].answerId, '9001');
    assert.equal(corpus.answers[0].completeness, 'fetched_api_content_unverified');
    const report = JSON.parse(await readFile(path.join(directory, '.data', 'author-avatars', 'MarryMea', 'discovery', 'collection-report.json'), 'utf8'));
    assert.equal(report.method, 'profile-search');
    assert.equal(report.planner, 'deterministic');
    assert.equal(report.fetched, 1);
    assert.ok(Array.isArray(report.gaps) && report.gaps.length > 0);
  });
});

test('deterministic collector still writes valid batches through the shared core', async () => {
  await withTempProject(async (directory) => {
    const result = runCli('scripts/collect-author-answers.mjs', directory, ['--author', 'MarryMea', '--mode', 'top', '--limit', '1', '--delay-ms', '0'], path.join(directory, 'mock-zhurl.mjs'));
    assert.equal(result.status, 0, result.stderr);
    const corpus = await loadAuthorCorpus(path.join(directory, '.data', 'author-avatars', 'MarryMea'), 'MarryMea');
    assert.equal(corpus.recordCount, 1);
    assert.equal(corpus.answers[0].answerId, '9002');
    const manifest = JSON.parse(await readFile(path.join(directory, '.data', 'author-avatars', 'MarryMea', 'batch-001', 'manifest.json'), 'utf8'));
    assert.equal(manifest.collection.method, 'top-voteups');
    assert.equal(manifest.collection.sort, 'voteups');
    assert.ok(manifest.collection.collectedAt);
  });
});

test('auth failures stop the collector without writing any batch', async () => {
  await withTempProject(async (directory) => {
    const failMock = path.join(directory, 'mock-zhurl-fail.mjs');
    await writeFile(failMock, `process.stderr.write('401 unauthorized');\nprocess.exit(1);\n`);
    const result = runCli('scripts/collect-author-gaps.mjs', directory, ['--author', 'MarryMea', '--topic', 'biology', '--limit', '2', '--delay-ms', '0', '--planner', 'deterministic'], failMock);
    assert.notEqual(result.status, 0);
    assert.ok(`${result.stderr}${result.stdout}`.includes('认证或限流'));
    assert.ok(!existsSync(path.join(directory, '.data', 'author-avatars', 'MarryMea', 'batch-001')));
    const entries = existsSync(path.join(directory, '.data', 'author-avatars', 'MarryMea')) ? readdirSync(path.join(directory, '.data', 'author-avatars', 'MarryMea')) : [];
    assert.ok(!entries.some((name) => /^batch-/.test(name)));
  });
});

test('gap collector dry-run performs no network and writes nothing', async () => {
  await withTempProject(async (directory) => {
    const result = runCli('scripts/collect-author-gaps.mjs', directory, ['--author', 'MarryMea', '--dry-run', '--planner', 'deterministic'], path.join(directory, 'mock-zhurl.mjs'));
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('no network and no files written'));
    assert.ok(!existsSync(path.join(directory, '.data')));
    assert.ok(!(result.stderr || '').includes('401'));
    assert.ok(CollectorStop.name === 'CollectorStop');
  });
});

test('collector environment convention is ZHURL_BIN only', () => {
  const files = ['scripts/collect-author-answers.mjs', 'scripts/collect-author-gaps.mjs', 'scripts/lib/author-collect.mjs'];
  for (const file of files) {
    const source = readFileSync(path.join(process.cwd(), file), 'utf8');
    assert.ok(!source.includes('ZHURL_PATH'), file);
    assert.ok(!source.includes('ZHURL_HOME'), file);
  }
  const original = process.env.ZHURL_BIN;
  try {
    assert.equal(resolveZhurl('C:/explicit/zhurl.exe'), 'C:/explicit/zhurl.exe');
    process.env.ZHURL_BIN = 'C:/env/zhurl.exe';
    assert.equal(resolveZhurl(), 'C:/env/zhurl.exe');
    delete process.env.ZHURL_BIN;
    const fallback = resolveZhurl();
    assert.ok(fallback === 'zhurl' || /zhurl(\.exe)?$/i.test(fallback), fallback);
  } finally {
    if (original === undefined) delete process.env.ZHURL_BIN;
    else process.env.ZHURL_BIN = original;
  }
});

test('collector sources never log credentials and the model only plans queries', () => {
  const files = [
    'scripts/collect-author-answers.mjs',
    'scripts/collect-author-gaps.mjs',
    'scripts/lib/author-collect.mjs',
    'scripts/lib/author-plan.mjs',
    'scripts/lib/zhurl-compat.mjs',
  ];
  for (const file of files) {
    const source = readFileSync(path.join(process.cwd(), file), 'utf8');
    for (const line of source.split(/\r?\n/)) {
      if (!/console\.(log|info|warn|error)/.test(line)) continue;
      assert.ok(!/cookie|secret|api[_-]?key/i.test(line), `${file}: ${line.trim()}`);
    }
  }
  const planner = readFileSync(path.join(process.cwd(), 'scripts/lib/author-plan.mjs'), 'utf8');
  assert.ok(planner.includes('query'));
  assert.ok(!planner.includes('read_answer'));
  assert.ok(!planner.includes('search_corpus'));
  assert.ok(!planner.includes('AuthorAnswer'));
  assert.ok(!planner.includes('.body'));
});
