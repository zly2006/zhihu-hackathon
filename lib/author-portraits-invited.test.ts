import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  AUTHOR_PORTRAIT_NOTES,
  AUTHOR_PORTRAIT_POOLS,
  AUTHOR_PORTRAIT_SOURCES,
  FEMALE_PORTRAIT_IDS,
  MALE_PORTRAIT_IDS,
  PORTRAIT_POSES,
  assertPortraitSources,
  invitedPortraitSourceId,
  portraitSourceId,
  resolvePortrait,
} from './portraits';
import {deriveAuthorCastId} from './author-identity';

const femaleAuthorId = deriveAuthorCastId('synthetic-female-author', '女');
const maleAuthorId = deriveAuthorCastId('synthetic-male-author', '男');
const unknownAuthorId = deriveAuthorCastId('synthetic-unknown-author', 'unknown');

function assertAssetExists(sourceId: string): void {
  for (const pose of PORTRAIT_POSES) {
    assert.ok(existsSync(path.join(process.cwd(), 'public', 'art', `${sourceId}_${pose}.webp`)), `${sourceId}_${pose}.webp`);
  }
}

test('invited female authors reuse one of the four existing female presets', () => {
  const sourceId = invitedPortraitSourceId(femaleAuthorId);
  assert.ok(sourceId && (FEMALE_PORTRAIT_IDS as readonly string[]).includes(sourceId), String(sourceId));
  assert.equal(portraitSourceId(femaleAuthorId), sourceId);
  for (const pose of PORTRAIT_POSES) {
    const plan = resolvePortrait(femaleAuthorId, pose);
    assert.equal(plan.kind, 'image');
    if (plan.kind !== 'image') continue;
    assert.equal(plan.src, `/art/${sourceId}_${pose}.webp`);
    assert.ok(!plan.src.includes('ling_'));
    assertAssetExists(sourceId);
  }
});

test('invited male authors reuse one of the four existing male presets', () => {
  const sourceId = invitedPortraitSourceId(maleAuthorId);
  assert.ok(sourceId && (MALE_PORTRAIT_IDS as readonly string[]).includes(sourceId), String(sourceId));
  assertAssetExists(sourceId);
});

test('authors without a public gender still reuse a preset instead of a placeholder', () => {
  const sourceId = invitedPortraitSourceId(unknownAuthorId);
  assert.ok(sourceId && (FEMALE_PORTRAIT_IDS as readonly string[]).includes(sourceId), String(sourceId));
  assert.equal(AUTHOR_PORTRAIT_NOTES.u.includes('性别未公开'), true);
  const plan = resolvePortrait(unknownAuthorId, 'happy');
  assert.equal(plan.kind, 'image');
  assert.equal(portraitSourceId(unknownAuthorId), sourceId);
});

test('the portrait choice is stable per author and spreads across the pool', () => {
  assert.equal(invitedPortraitSourceId(femaleAuthorId), invitedPortraitSourceId(femaleAuthorId));
  const seen = new Set<string>();
  for (let index = 0; index < 40; index += 1) {
    const id = deriveAuthorCastId(`spread-author-${index}`, '女');
    const sourceId = invitedPortraitSourceId(id);
    assert.ok(sourceId);
    seen.add(String(sourceId));
  }
  assert.equal(seen.size, FEMALE_PORTRAIT_IDS.length);
});

test('portrait pools stay gender-consistent and only reference existing assets', () => {
  assert.deepEqual([...AUTHOR_PORTRAIT_POOLS.f], [...FEMALE_PORTRAIT_IDS]);
  assert.deepEqual([...AUTHOR_PORTRAIT_POOLS.m], [...MALE_PORTRAIT_IDS]);
  assertPortraitSources([{castId: 'ling', gender: '女'}, {castId: femaleAuthorId, gender: '女'}, {castId: maleAuthorId, gender: '男'}, {castId: unknownAuthorId, gender: 'unknown'}]);
  for (const pool of Object.values(AUTHOR_PORTRAIT_POOLS)) {
    for (const sourceId of pool) assertAssetExists(sourceId);
  }
});

test('registered author portraits keep their explicit mapping', () => {
  assert.equal(AUTHOR_PORTRAIT_SOURCES.ling.sourceId, 'f2');
  assert.equal(portraitSourceId('ling'), 'f2');
  assert.deepEqual(resolvePortrait('unknown-character'), {kind: 'placeholder', reason: 'unknown-character'});
});
