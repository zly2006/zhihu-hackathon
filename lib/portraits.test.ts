import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  AUTHOR_PORTRAIT_SOURCES,
  FEMALE_PORTRAIT_IDS,
  PORTRAIT_POSES,
  assertPortraitSources,
  portraitSourceId,
  resolvePortrait,
} from './portraits';

test('ling portraits reuse an existing female preset for every pose', () => {
  assert.equal(AUTHOR_PORTRAIT_SOURCES.ling.sourceId, 'f2');
  for (const pose of PORTRAIT_POSES) {
    const plan = resolvePortrait('ling', pose);
    assert.equal(plan.kind, 'image');
    if (plan.kind !== 'image') continue;
    assert.equal(plan.sourceId, 'f2');
    assert.equal(plan.src, `/art/f2_${pose}.webp`);
    assert.ok(!plan.src.includes('ling_'));
  }
});

test('author portraits never resolve to male assets and files exist on disk', () => {
  assert.ok((FEMALE_PORTRAIT_IDS as readonly string[]).includes(AUTHOR_PORTRAIT_SOURCES.ling.sourceId));
  const original = AUTHOR_PORTRAIT_SOURCES.ling;
  AUTHOR_PORTRAIT_SOURCES.ling = {sourceId: 'm1', note: 'bad'};
  try {
    assert.throws(() => assertPortraitSources([{castId: 'ling', gender: '女'}]), /性别/);
  } finally {
    AUTHOR_PORTRAIT_SOURCES.ling = original;
  }
  for (const pose of PORTRAIT_POSES) {
    const file = path.join(process.cwd(), 'public', 'art', `f2_${pose}.webp`);
    assert.ok(existsSync(file), file);
  }
});

test('author portrait sources stay gender-consistent and can be listed', () => {
  assert.doesNotThrow(() => assertPortraitSources([{castId: 'ling', gender: '女'}, {castId: 'other', gender: '男'}]));
  assertPortraitSources([]);
});

test('unknown characters fall back to placeholders while demo and preset ids stay stable', () => {
  assert.deepEqual(resolvePortrait('unknown-character'), {kind: 'placeholder', reason: 'unknown-character'});
  assert.equal(portraitSourceId('lin'), 'f1');
  assert.equal(portraitSourceId('tao'), 'f2');
  assert.equal(portraitSourceId('shen'), 'f3');
  assert.equal(portraitSourceId('player'), 'player');
  assert.equal(portraitSourceId('m3'), 'm3');
  assert.deepEqual(resolvePortrait('ling', 'thinking'), resolvePortrait('ling', 'thinking'));
});

test('the stage, chat avatar and save preview share one portrait mapping', () => {
  const page = readFileSync(path.join(process.cwd(), 'app', 'page.tsx'), 'utf8');
  assert.ok(page.includes("from '../lib/portraits'"));
  assert.ok(!page.includes('assetFor('));
  assert.ok(!page.includes('hasNativeArt'));
  assert.ok(!page.includes('demoArtIds'));
  assert.ok(!page.includes('_${pose}.webp'));
  const occurrences = page.match(/resolvePortrait\(/g) || [];
  assert.equal(occurrences.length, 1);
});
