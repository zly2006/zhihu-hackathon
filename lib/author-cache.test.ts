import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {FileAuthorCache, authorCacheDirectory} from './author-cache';
import type {AnswerSummary, AuthorAnswer, AuthorProfile, AuthorRef} from './author-provider';

const now = Date.parse('2026-03-01T00:00:00.000Z');
const ref = (urlToken: string): AuthorRef => ({provider: 'zhihu', urlToken, profileUrl: `https://www.zhihu.com/people/${urlToken}`});
const profile = (urlToken: string): AuthorProfile => ({
  urlToken, profileUrl: `https://www.zhihu.com/people/${urlToken}`, displayName: '合成答主',
  gender: '女', fetchedAt: new Date(now).toISOString(), source: 'zhurl',
});
const summary = (urlToken: string, answerId = '1001'): AnswerSummary => ({
  answerId, authorUrlToken: urlToken, questionTitle: '合成问题',
  sourceUrl: `https://www.zhihu.com/answer/${answerId}`, collectionMethod: 'profile-search',
});
const answer = (urlToken: string, answerId = '1001'): AuthorAnswer => ({
  answerId, authorUrlToken: urlToken, questionTitle: '合成问题',
  sourceUrl: `https://www.zhihu.com/answer/${answerId}`, body: '合成正文。', completeness: 'fetched_api_content_unverified',
});

async function withCache(task: (cache: FileAuthorCache, root: string, clock: {value: number}) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), 'author-cache-synthetic-'));
  const clock = {value: now};
  try {
    await task(new FileAuthorCache(root, () => clock.value), root, clock);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
}

test('cache reads are isolated per author token', async () => {
  await withCache(async (cache) => {
    await cache.writeProfile(ref('author-a'), profile('author-a'));
    await cache.writeAnswers(ref('author-a'), 'latest', [summary('author-a')]);
    await cache.writeAnswer(ref('author-a'), answer('author-a'));
    await cache.writeSearch(ref('author-a'), '远程工作', 3, [summary('author-a')]);
    assert.ok(await cache.readProfile(ref('author-a'), 1000));
    assert.ok(await cache.readAnswers(ref('author-a'), 'latest', 1000));
    assert.ok(await cache.readAnswer(ref('author-a'), '1001', 1000));
    assert.ok(await cache.readSearch(ref('author-a'), '远程工作', 3, 1000));
    assert.equal(await cache.readProfile(ref('author-b'), 1000), null);
    assert.equal(await cache.readAnswers(ref('author-b'), 'latest', 1000), null);
    assert.equal(await cache.readAnswer(ref('author-b'), '1001', 1000), null);
    assert.equal(await cache.readSearch(ref('author-b'), '远程工作', 3, 1000), null);
  });
});

test('cache entries expire with their ttl and keep the negative result short-lived', async () => {
  await withCache(async (cache, _root, clock) => {
    await cache.writeProfile(ref('author-a'), profile('author-a'));
    await cache.writeSearch(ref('author-a'), '无命中的问题', 3, []);
    assert.ok(await cache.readProfile(ref('author-a'), 60_000));
    assert.deepEqual((await cache.readSearch(ref('author-a'), '无命中的问题', 3, 600_000))?.items, []);
    clock.value = now + 61_000;
    assert.equal(await cache.readProfile(ref('author-a'), 60_000), null);
    clock.value = now + 11 * 60_000;
    assert.equal(await cache.readSearch(ref('author-a'), '无命中的问题', 3, 10 * 60_000), null);
  });
});

test('cache never trusts a corrupt or foreign entry', async () => {
  await withCache(async (cache, root) => {
    const directory = authorCacheDirectory(root, 'author-a');
    await cache.writeProfile(ref('author-a'), profile('author-a'));
    await writeFile(path.join(directory, 'profile.json'), JSON.stringify({
      schemaVersion: 1, authorUrlToken: 'author-b', cachedAt: new Date(now).toISOString(), payload: profile('author-a'),
    }));
    assert.equal(await cache.readProfile(ref('author-a'), 60_000), null);
    await writeFile(path.join(directory, 'profile.json'), '{not json');
    assert.equal(await cache.readProfile(ref('author-a'), 60_000), null);
    await writeFile(path.join(directory, 'profile.json'), JSON.stringify({
      schemaVersion: 1, authorUrlToken: 'author-a', cachedAt: new Date(now).toISOString(),
      payload: {...profile('author-a'), profileUrl: 'https://evil.test/people/author-a'},
    }));
    assert.equal(await cache.readProfile(ref('author-a'), 60_000), null);
  });
});

test('writes reject payloads that do not match the author binding', async () => {
  await withCache(async (cache) => {
    await assert.rejects(cache.writeProfile(ref('author-a'), profile('author-b')));
    await assert.rejects(cache.writeAnswers(ref('author-a'), 'latest', [summary('author-b')]));
    await assert.rejects(cache.writeAnswer(ref('author-a'), answer('author-b')));
    await assert.rejects(cache.writeSearch(ref('author-a'), '远程工作', 3, [summary('author-b')]));
    await assert.rejects(cache.writeProfile({provider: 'zhihu', urlToken: '../escape', profileUrl: 'https://www.zhihu.com/people/../escape'}, profile('author-a')));
  });
});

test('cache files stay inside the author directory', async () => {
  await withCache(async (cache, root) => {
    await cache.writeProfile(ref('author-a'), profile('author-a'));
    const raw = await readFile(path.join(authorCacheDirectory(root, 'author-a'), 'profile.json'), 'utf8');
    assert.ok(raw.includes('"author-a"'));
    assert.equal(path.relative(root, authorCacheDirectory(root, 'author-a')), path.join('author-a', 'runtime-cache'));
  });
});
