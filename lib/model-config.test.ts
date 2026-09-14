import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveModelCredentials} from './model-config-values';

test('model credentials prefer project OpenCode/CPA configuration', () => {
  assert.deepEqual(resolveModelCredentials({MODEL_PROVIDER:'opencode',OPENCODE_API_KEY:'test-opencode',OPENCODE_ENDPOINT:'https://example.test/opencode',OPENCODE_MODEL:'story-model',DEEPSEEK_API_KEY:'test-deepseek'}), {
    key: 'test-opencode', endpoint: 'https://example.test/opencode', model: 'story-model', effort: 'none', provider: 'opencode',
  });
});

test('explicit DeepSeek provider remains supported', () => {
  const config = resolveModelCredentials({MODEL_PROVIDER:'deepseek',DEEPSEEK_API_KEY:'test-deepseek',DEEPSEEK_ENDPOINT:'https://example.test/deepseek',DEEPSEEK_MODEL:'deepseek-test'});
  assert.equal(config.provider, 'deepseek');
  assert.equal(config.model, 'deepseek-test');
});

test('legacy DeepSeek credentials keep chat available when OpenCode is absent', () => {
  assert.equal(resolveModelCredentials({MODEL_PROVIDER:'opencode',DEEPSEEK_API_KEY:'legacy-key'}).provider, 'deepseek');
});

test('missing credentials and unknown providers fail without exposing secrets', () => {
  assert.throws(() => resolveModelCredentials({}), /尚未配置模型 API 密钥/);
  assert.throws(() => resolveModelCredentials({MODEL_PROVIDER:'unknown',OPENCODE_API_KEY:'secret'}), /配置无效/);
});
