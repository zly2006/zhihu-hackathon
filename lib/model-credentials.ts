export type ModelCredentials = {
  provider: 'deepseek' | 'opencode';
  key: string;
  endpoint: string;
  model: string;
};

export function resolveModelCredentials(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): ModelCredentials | undefined {
  const deepseekKey = (env.DEEPSEEK_API_KEY || '').trim();
  if (deepseekKey) {
    return {
      provider: 'deepseek',
      key: deepseekKey,
      endpoint: (env.DEEPSEEK_ENDPOINT || '').trim() || 'https://api.deepseek.com/v1/chat/completions',
      model: (env.DEEPSEEK_MODEL || '').trim() || 'deepseek-chat',
    };
  }
  const opencodeKey = ((env.OPENCODE_API_KEY || env.CPA_API_KEY) || '').trim();
  if (opencodeKey) {
    return {
      provider: 'opencode',
      key: opencodeKey,
      endpoint: (env.OPENCODE_ENDPOINT || '').trim() || 'https://opencode.ai/zen/go/v1/chat/completions',
      model: (env.OPENCODE_MODEL || '').trim() || 'deepseek-flash',
    };
  }
  return undefined;
}
