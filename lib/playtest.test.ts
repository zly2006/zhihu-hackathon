import assert from 'node:assert/strict';
import test from 'node:test';
import {PLAYTEST_PROFILE, PLAYTEST_SESSION_ID, playtestEnabled} from './playtest';

test('playtest mode requires the explicit flag and never applies in production', () => {
  assert.equal(playtestEnabled({NODE_ENV: 'development', LAMPLIGHT_PLAYTEST: '1'}), true);
  assert.equal(playtestEnabled({NODE_ENV: 'test', LAMPLIGHT_PLAYTEST: '1'}), true);
  assert.equal(playtestEnabled({NODE_ENV: 'development', LAMPLIGHT_PLAYTEST: ' 1 '}), true);
  assert.equal(playtestEnabled({NODE_ENV: 'production', LAMPLIGHT_PLAYTEST: '1'}), false);
  assert.equal(playtestEnabled({NODE_ENV: 'development'}), false);
  assert.equal(playtestEnabled({LAMPLIGHT_PLAYTEST: '1'}), true);
  assert.equal(playtestEnabled({NODE_ENV: 'development', LAMPLIGHT_PLAYTEST: 'true'}), false);
  assert.equal(playtestEnabled({NODE_ENV: 'development', LAMPLIGHT_PLAYTEST: '0'}), false);
});

test('playtest profile is clearly local and uses a stable session id', () => {
  assert.equal(PLAYTEST_PROFILE.id, PLAYTEST_SESSION_ID);
  assert.ok(PLAYTEST_PROFILE.name.includes('试玩'));
  assert.ok(PLAYTEST_PROFILE.headline?.includes('本地'));
});
