import assert from 'node:assert/strict';
import test from 'node:test';
import {DEVELOPMENT_PROFILE} from './playtest';

test('the development profile is clearly local and uses a stable profile id', () => {
  assert.equal(DEVELOPMENT_PROFILE.id, 'playtest-local');
  assert.ok(DEVELOPMENT_PROFILE.name.includes('本地'));
  assert.ok(DEVELOPMENT_PROFILE.headline?.includes('开发模式'));
});
