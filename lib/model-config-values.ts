export type ModelCredentials = {
  key: string;
  endpoint: string;
  model: string;
  effort: string;
  provider: 'opencode' | 'deepseek';
};

type ModelEnvironment = Record<string, string | undefined>;

const DEFAULT_ENDPOINT = 'https://opencode.ai/zen/go/v1/chat/completions';
const DEFAULT_MODEL = 'deepseek-flash';
const DEFAULT_REASONING_EFFORT = 'none';

export function resolveModelCredentials(env: ModelEnvironment): ModelCredentials {
  const provider = env.MODEL_PROVIDER?.trim().toLowerCase() || 'opencode';
  const opencodeKey = (env.OPENCODE_API_KEY || env.CPA_API_KEY)?.trim();
  const deepseekKey = env.DEEPSEEK_API_KEY?.trim();

  if (provider !== 'opencode' && provider !== 'deepseek') throw new Error('MODEL_PROVIDER 配置无效');
  if (provider === 'deepseek' && deepseekKey) {
    return {
      key: deepseekKey,
      endpoint: env.DEEPSEEK_ENDPOINT || 'https://api.deepseek.com/v1/chat/completions',
      model: env.DEEPSEEK_MODEL || 'deepseek-chat',
      effort: env.DEEPSEEK_REASONING_EFFORT || DEFAULT_REASONING_EFFORT,
      provider: 'deepseek',
    };
  }

  if (opencodeKey) {
    return {
      key: opencodeKey,
      endpoint: env.OPENCODE_ENDPOINT || DEFAULT_ENDPOINT,
      model: env.OPENCODE_MODEL || DEFAULT_MODEL,
      effort: env.OPENCODE_REASONING_EFFORT || DEFAULT_REASONING_EFFORT,
      provider: 'opencode',
    };
  }

  if (deepseekKey) {
    return {
      key: deepseekKey,
      endpoint: env.DEEPSEEK_ENDPOINT || 'https://api.deepseek.com/v1/chat/completions',
      model: env.DEEPSEEK_MODEL || 'deepseek-chat',
      effort: env.DEEPSEEK_REASONING_EFFORT || DEFAULT_REASONING_EFFORT,
      provider: 'deepseek',
    };
  }

  throw new Error('服务端尚未配置模型 API 密钥');
}
