import 'server-only';
import {resolveModelCredentials,type ModelCredentials} from './model-config-values';

export type {ModelCredentials} from './model-config-values';

/**
 * Resolve the single model configuration used by both story generation and
 * free chat. OpenCode/CPA is the project default; the old DeepSeek variables
 * remain a backwards-compatible fallback for existing deployments.
 */
export function modelCredentials(): ModelCredentials {
  return resolveModelCredentials(process.env);
}
