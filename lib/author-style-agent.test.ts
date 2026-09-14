import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {AuthorAnswer as ProviderAnswer, AuthorProvider, AuthorRef} from './author-provider';
import {isStyleCardFresh, parseStyleCard, stylePromptFragment} from './author-style';
import {
  buildAutoStyleCard,
  learnAuthorStyle,
  observationRejections,
  parseStyleObservationReply,
  pickStyleSamples,
  startAuthorStyleJob,
  styleCardPath,
  styleObservationSystemText,
  type StyleSample,
} from './author-style-agent';

const token = 'MarryMea';
const ref: AuthorRef = {provider: 'zhihu', urlToken: token, profileUrl: `https://www.zhihu.com/people/${token}`};

function answer(answerId: string, title: string, body = '合成正文内容。'): ProviderAnswer {
  return {answerId, authorUrlToken: token, authorName: '合成作者', questionTitle: title, sourceUrl: `https://www.zhihu.com/answer/${answerId}`, body, completeness: 'fetched_api_content_unverified'};
}

const samples: StyleSample[] = [
  {answerId: '1001', questionTitle: '问题一', body: '正文一'},
  {answerId: '1002', questionTitle: '问题二', body: '正文二'},
  {answerId: '1003', questionTitle: '问题三', body: '正文三'},
];

const goodReply = JSON.stringify({
  observations: [
    {id: 'style-1', scope: '句式', note: '句子偏短，常先给结论再补一句限定条件。', evidenceAnswerIds: ['1001', '1002']},
    {id: 'style-2', scope: '语气', note: '语气克制，很少用感叹号，倾向于用「可能」「大概」留余地。', evidenceAnswerIds: ['1002', '1003']},
    {id: 'style-3', scope: '节奏', note: '喜欢先铺一个具体场景，再给出判断。', evidenceAnswerIds: ['1001', '1003']},
  ],
});

test('style samples cover different questions and are trimmed', () => {
  const answers = [answer('1', '同一个问题'), answer('2', '同一个问题'), answer('3', '另一个问题'), answer('4', '第三个问题'), answer('5', '第三个问题')];
  const picked = pickStyleSamples(answers, 3);
  assert.deepEqual(picked.map((sample) => sample.answerId), ['1', '3', '4']);
  const long = pickStyleSamples([answer('9', '问题', '很长的正文'.repeat(500))], 1);
  assert.ok([...long[0].body].length <= 1200);
});

test('the style prompt forbids facts, quotes and unverifiable observations', () => {
  const system = styleObservationSystemText();
  assert.ok(system.includes('语言形式'));
  assert.ok(system.includes('严禁写入'));
  assert.ok(system.includes('至少 2 篇'));
  assert.ok(system.includes('scope'));
});

test('the observation reply parser accepts plain json and rejects noise', () => {
  assert.equal(parseStyleObservationReply(goodReply).length, 3);
  assert.equal(parseStyleObservationReply('```json\n' + goodReply + '\n```').length, 3);
  assert.deepEqual(parseStyleObservationReply('不是 JSON'), []);
  assert.deepEqual(parseStyleObservationReply('{"observations":{}}'), []);
});

test('program guards reject facts, links, malformed and unsupported observations', () => {
  const base = {id: 'style-1', note: '句子偏短。', evidenceAnswerIds: ['1001', '1002'], scope: '句式'};
  assert.deepEqual(observationRejections([base, {...base, id: 'style-2'}, {...base, id: 'style-3'}], samples), []);
  const reject = (override: Record<string, unknown>) => observationRejections([{...base, ...override}, {...base, id: 'style-2'}, {...base, id: 'style-3'}], samples).length > 0;
  assert.equal(reject({note: '我在研究生阶段做实验的经历。'}), true, '作者经历必须拒绝');
  assert.equal(reject({note: '2020 年之后一直这样写。'}), true, '年份事实必须拒绝');
  assert.equal(reject({note: '详见 https://zhihu.com/answer/1001'}), true, '链接必须拒绝');
  assert.equal(reject({note: '很长的描述。'.repeat(30)}), true, '超长观察必须拒绝');
  assert.equal(reject({scope: '性格'}), true, 'scope 必须白名单');
  assert.equal(reject({evidenceAnswerIds: ['1001']}), true, '单篇证据必须拒绝');
  assert.equal(reject({evidenceAnswerIds: ['1001', '999999']}), true, '样本外的 answerId 不算证据');
  assert.equal(observationRejections([base], samples).length > 0, true, '观察条数不足必须拒绝');
});

test('an auto style card is built from validated observations only', () => {
  const card = buildAutoStyleCard({
    authorUrlToken: token,
    observations: parseStyleObservationReply(goodReply),
    samples,
    sampleSource: 'local',
    model: 'synthetic-model',
    now: Date.parse('2026-03-01T00:00:00.000Z'),
  });
  assert.equal(card.status, 'auto');
  assert.equal(card.generatedAt, '2026-03-01T00:00:00.000Z');
  assert.equal(card.sampleCount, 3);
  assert.equal(card.observations.length, 3);
  assert.equal(isStyleCardFresh(card, Date.parse('2026-03-05T00:00:00.000Z')), true);
  assert.equal(isStyleCardFresh(card, Date.parse('2026-03-20T00:00:00.000Z')), false);
  const fragment = stylePromptFragment(card);
  assert.ok(fragment.includes('自动归纳'));
  assert.ok(fragment.includes('未人工审核'));
  assert.ok(fragment.includes('不得替作者表达观点'));
});

test('learning writes an auto card when samples and the model behave', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'author-style-'));
  try {
    const result = await learnAuthorStyle({
      authorToken: token,
      displayName: '林泠',
      root,
      answers: [answer('1001', '问题一'), answer('1002', '问题二'), answer('1003', '问题三'), answer('1004', '问题四')],
      callModel: async () => goodReply,
    });
    assert.equal(result.status, 'written');
    const raw = JSON.parse(await readFile(styleCardPath(root, token), 'utf8'));
    const card = parseStyleCard(raw);
    assert.equal(card.status, 'auto');
    assert.equal(card.sampleSource, 'local');
    assert.deepEqual(card.observations.map((observation) => observation.scope), ['句式', '语气', '节奏']);
    assert.ok(!JSON.stringify(card).includes('https://'));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('learning refuses unsupported samples, rejected observations and model failures', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'author-style-guard-'));
  try {
    const insufficient = await learnAuthorStyle({authorToken: token, root, answers: [answer('1001', '问题一')], callModel: async () => goodReply});
    assert.equal(insufficient.status, 'insufficient-samples');
    const rejected = await learnAuthorStyle({
      authorToken: token,
      root,
      answers: [answer('1001', '问题一'), answer('1002', '问题二'), answer('1003', '问题三'), answer('1004', '问题四')],
      callModel: async () => JSON.stringify({observations: [{id: 'style-1', scope: '句式', note: '作者在 2019 年开始写这类回答。', evidenceAnswerIds: ['1001', '1002']}]}),
    });
    assert.equal(rejected.status, 'rejected');
    const failed = await learnAuthorStyle({
      authorToken: token,
      root,
      answers: [answer('1001', '问题一'), answer('1002', '问题二'), answer('1003', '问题三'), answer('1004', '问题四')],
      callModel: async () => {throw new Error('模型超时');},
    });
    assert.equal(failed.status, 'failed');
    assert.ok(!isStyleCardFresh(undefined));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('a fresh card is left untouched and online answers fill missing samples', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'author-style-online-'));
  let modelCalls = 0;
  const provider: AuthorProvider = {
    resolveProfile: async () => {throw new Error('unused');},
    listAnswers: async () => [answer('2001', '在线问题一'), answer('2002', '在线问题二'), answer('2003', '在线问题三')].map((item) => ({answerId: item.answerId, authorUrlToken: token, questionTitle: item.questionTitle, sourceUrl: item.sourceUrl, collectionMethod: 'runtime-live' as const})),
    searchAnswers: async () => [],
    readAnswer: async (_ref, answerId) => answer(answerId, `在线问题${answerId}`, '在线正文内容。'),
  };
  const onlineReply = JSON.stringify({
    observations: [
      {id: 'style-1', scope: '句式', note: '句子偏短，常先给结论再补一句限定条件。', evidenceAnswerIds: ['1001', '2001']},
      {id: 'style-2', scope: '语气', note: '语气克制，很少用感叹号。', evidenceAnswerIds: ['2001', '2002']},
      {id: 'style-3', scope: '节奏', note: '喜欢先铺一个具体场景，再给出判断。', evidenceAnswerIds: ['2002', '2003']},
    ],
  });
  try {
    const online = await learnAuthorStyle({
      authorToken: token,
      root,
      answers: [answer('1001', '问题一')],
      provider,
      authorRef: ref,
      callModel: async () => {modelCalls += 1; return onlineReply;},
    });
    assert.equal(online.status, 'written');
    assert.equal(online.card?.sampleSource, 'mixed');
    assert.equal(modelCalls, 1);
    const again = await learnAuthorStyle({
      authorToken: token,
      root,
      answers: [answer('1001', '问题一')],
      provider,
      authorRef: ref,
      callModel: async () => {modelCalls += 1; return onlineReply;},
      readExistingCard: async () => parseStyleCard(JSON.parse(await readFile(styleCardPath(root, token), 'utf8'))),
    });
    assert.equal(again.status, 'unchanged');
    assert.equal(modelCalls, 1, 'fresh cards must not trigger another model call');
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('a rejected observation set gets exactly one rewrite attempt', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'author-style-retry-'));
  const bad = JSON.stringify({observations: [
    {id: 'style-1', scope: '性格', note: '句子偏短。', evidenceAnswerIds: ['1001', '1002']},
    {id: 'style-2', scope: '句式', note: '先给结论。', evidenceAnswerIds: ['1001', '1002']},
    {id: 'style-3', scope: '语气', note: '语气克制。', evidenceAnswerIds: ['1001', '1002']},
  ]});
  let calls = 0;
  try {
    const result = await learnAuthorStyle({
      authorToken: token,
      root,
      answers: [answer('1001', '问题一'), answer('1002', '问题二'), answer('1003', '问题三'), answer('1004', '问题四')],
      callModel: async (messages) => {
        calls += 1;
        if (calls === 1) return bad;
        assert.ok(messages.at(-1)!.content.includes('scope 白名单'));
        return goodReply;
      },
    });
    assert.equal(result.status, 'written');
    assert.equal(calls, 2);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('concurrent style jobs for the same author are deduplicated', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'author-style-dedupe-'));
  let calls = 0;
  const input = {
    authorToken: 'dedupe-author',
    root,
    answers: [answer('1001', '问题一'), answer('1002', '问题二'), answer('1003', '问题三'), answer('1004', '问题四')],
    callModel: async () => {calls += 1; await new Promise((resolve) => setTimeout(resolve, 20)); return goodReply;},
  };
  try {
    const [first, second] = await Promise.all([startAuthorStyleJob(input), startAuthorStyleJob(input)]);
    assert.equal(first.status, 'written');
    assert.equal(second.status, 'written');
    assert.equal(calls, 1);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
