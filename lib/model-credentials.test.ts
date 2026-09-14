import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveModelCredentials} from './model-credentials';

test('deepseek credentials win when both providers are configured', () => {
  const resolved = resolveModelCredentials({DEEPSEEK_API_KEY: 'd-key', OPENCODE_API_KEY: 'o-key'});
  assert.equal(resolved?.provider, 'deepseek');
  assert.equal(resolved?.key, 'd-key');
  assert.equal(resolved?.endpoint, 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(resolved?.model, 'deepseek-chat');
});

test('opencode credentials are used as the fallback provider', () => {
  const resolved = resolveModelCredentials({OPENCODE_API_KEY: 'o-key', OPENCODE_MODEL: 'deepseek-v4.1-flash'});
  assert.equal(resolved?.provider, 'opencode');
  assert.equal(resolved?.endpoint, 'https://opencode.ai/zen/go/v1/chat/completions');
  assert.equal(resolved?.model, 'deepseek-v4.1-flash');
  assert.equal(resolveModelCredentials({CPA_API_KEY: 'cpa'})?.provider, 'opencode');
  assert.equal(resolveModelCredentials({DEEPSEEK_API_KEY: '   '}), undefined);
  assert.equal(resolveModelCredentials({}), undefined);
});

test('explicit deepseek endpoint overrides only affect their own provider', () => {
  const deepseek = resolveModelCredentials({DEEPSEEK_API_KEY: 'd', DEEPSEEK_ENDPOINT: 'https://example.test/v1', DEEPSEEK_MODEL: 'custom'});
  assert.equal(deepseek?.endpoint, 'https://example.test/v1');
  assert.equal(deepseek?.model, 'custom');
  const opencode = resolveModelCredentials({OPENCODE_API_KEY: 'o', DEEPSEEK_ENDPOINT: 'https://ignored.test'});
  assert.equal(opencode?.endpoint, 'https://opencode.ai/zen/go/v1/chat/completions');
});
