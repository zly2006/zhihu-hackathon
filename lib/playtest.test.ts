import assert from 'node:assert/strict';
import test from 'node:test';
import {DEVELOPMENT_PROFILE,DEVELOPMENT_SESSION_ID,PLAYTEST_PROFILE,PLAYTEST_SESSION_ID,developmentModeEnabled,playtestEnabled} from './playtest';

test('development mode requires an explicit flag and never applies in production', () => {
  assert.equal(developmentModeEnabled({NODE_ENV: 'development', LAMPLIGHT_DEV_MODE: '1'}), true);
  assert.equal(developmentModeEnabled({NODE_ENV: 'development', LAMPLIGHT_DEV_MODE: 'true'}), true);
  assert.equal(developmentModeEnabled({NODE_ENV: 'development', LAMPLIGHT_DEV_MODE: ' TRUE '}), true);
  assert.equal(developmentModeEnabled({NODE_ENV: 'test', LAMPLIGHT_DEV_MODE: '1'}), true);
  assert.equal(developmentModeEnabled({NODE_ENV: 'production', LAMPLIGHT_DEV_MODE: '1'}), false);
  assert.equal(developmentModeEnabled({NODE_ENV: 'development'}), false);
  assert.equal(developmentModeEnabled({LAMPLIGHT_DEV_MODE: '1'}), true);
  assert.equal(developmentModeEnabled({NODE_ENV: 'development', LAMPLIGHT_DEV_MODE: '0'}), false);
  assert.equal(developmentModeEnabled({NODE_ENV: 'development', LAMPLIGHT_DEV_MODE: 'yes'}), false);
});

test('the legacy playtest flag stays a compatible alias', () => {
  assert.equal(developmentModeEnabled({NODE_ENV: 'development', LAMPLIGHT_PLAYTEST: '1'}), true);
  assert.equal(developmentModeEnabled({NODE_ENV: 'production', LAMPLIGHT_PLAYTEST: '1'}), false);
  assert.equal(playtestEnabled({NODE_ENV: 'development', LAMPLIGHT_DEV_MODE: '1'}), true);
  assert.equal(PLAYTEST_SESSION_ID, DEVELOPMENT_SESSION_ID);
  assert.equal(PLAYTEST_PROFILE, DEVELOPMENT_PROFILE);
});

test('the development profile is clearly local and uses a stable session id', () => {
  assert.equal(DEVELOPMENT_PROFILE.id, DEVELOPMENT_SESSION_ID);
  assert.ok(DEVELOPMENT_PROFILE.name.includes('本地'));
  assert.ok(DEVELOPMENT_PROFILE.headline?.includes('开发模式'));
});
