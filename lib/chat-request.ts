import {z} from 'zod';
import type {CharacterKind} from './story';

export const chatRequestSchema = z.object({
  storyId: z.string().uuid().optional(),
  character: z.string().trim().min(1).max(80),
  authorAvatarId: z.literal('zhao-ling').optional(),
  line: z.number().int().min(0),
  exchangeId: z.string().uuid().optional(),
  messages: z.array(z.object({role: z.enum(['user', 'assistant']), text: z.string().trim().min(1).max(500)}).strict()).min(1).max(12),
}).strict().refine((value) => value.messages.at(-1)?.role === 'user');

export type ChatRequest = z.infer<typeof chatRequestSchema>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidExchangeId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim());
}

export type AuthorChatGateResult =
  | {ok: true}
  | {ok: false; status: number; code: string; error: string};

export function authorChatGate(input: {storyId?: string; kind?: CharacterKind; busy: boolean; exchangeId?: string}): AuthorChatGateResult {
  if (!input.storyId || input.kind !== 'zhihu-author') return {ok: true};
  if (!input.exchangeId) return {ok: false, status: 400, code: 'EXCHANGE_ID_REQUIRED', error: '缺少本次对话的交换标识。'};
  if (!isValidExchangeId(input.exchangeId)) return {ok: false, status: 400, code: 'INVALID_EXCHANGE_ID', error: '交换标识格式不正确。'};
  if (input.busy) return {ok: false, status: 409, code: 'STORY_GENERATION_IN_PROGRESS', error: '剧情正在生成，这条消息先留着，稍后再发。'};
  return {ok: true};
}

export function isDuplicateExchange(processed: readonly string[] | undefined, exchangeId: string | undefined): boolean {
  return Boolean(exchangeId && processed?.includes(exchangeId));
}
