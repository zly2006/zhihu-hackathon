import 'server-only';
import {resolveModelCredentials} from './model-credentials';

const resolved = resolveModelCredentials();
export const deepseekModel = resolved?.model || 'deepseek-chat';
export function deepseekCredentials() {
  const credentials = resolveModelCredentials();
  if (!credentials) throw new Error('服务端尚未配置 DEEPSEEK_API_KEY 或 OPENCODE_API_KEY');
  return {key: credentials.key, endpoint: credentials.endpoint};
}
