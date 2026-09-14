import {z} from 'zod';
import type {CharacterKind} from './story';

export const AUTHOR_ACTOR_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

export const chatRequestSchema = z.object({
  storyId: z.string().uuid().optional(),
  character: z.string().trim().min(1).max(80),
  authorAvatarId: z.string().trim().regex(AUTHOR_ACTOR_ID_PATTERN).optional(),
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

/**
 * 剧情内聊天现在都会写入好感度（预设 NPC 与答主共用奖励通道），
 * 因此两种角色在剧情生成期间都要等待，且都必须带 exchangeId 防重复结算。
 */
export function authorChatGate(input: {storyId?: string; kind?: CharacterKind; busy: boolean; exchangeId?: string}): AuthorChatGateResult {
  if (!input.storyId) return {ok: true};
  if (!input.exchangeId) return {ok: false, status: 400, code: 'EXCHANGE_ID_REQUIRED', error: '缺少本次对话的交换标识。'};
  if (!isValidExchangeId(input.exchangeId)) return {ok: false, status: 400, code: 'INVALID_EXCHANGE_ID', error: '交换标识格式不正确。'};
  if (input.busy) return {ok: false, status: 409, code: 'STORY_GENERATION_IN_PROGRESS', error: '剧情正在生成，这条消息先留着，稍后再发。'};
  return {ok: true};
}

export function isDuplicateExchange(processed: readonly string[] | undefined, exchangeId: string | undefined): boolean {
  return Boolean(exchangeId && processed?.includes(exchangeId));
}
