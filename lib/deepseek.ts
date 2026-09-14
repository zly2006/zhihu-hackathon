/** @deprecated Use modelCredentials from ./model-config. Kept for legacy callers. */
import { modelCredentials } from './model-config';

export const deepseekModel = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
export function deepseekCredentials() {
  const config = modelCredentials();
  return { key: config.key, endpoint: config.endpoint, model: config.model, provider: config.provider };
}
