import {createHash} from 'node:crypto';

/**
 * 剧情外单独聊天（预设 NPC 与知乎答主共用）的有效互动奖励。
 * 规则：有效往返 +1，答主引用了公开回答再 +1；每角色每局聊天通道封顶 +4。
 * 触发条件都写在这里，路由只负责读写存档。
 */

export const CHAT_REWARD_CAP = 4;
export const CHAT_MIN_MESSAGE_CHARS = 12;
export const CHAT_MIN_INTERVAL_MS = 90_000;
export const MAX_PROCESSED_MESSAGE_HASHES = 200;

export type ChatRewardReason = 'rewarded' | 'reply-failed' | 'too-short' | 'duplicate' | 'cooldown' | 'capped';

export type ChatRewardInput = {
  previousGain: number;
  messageText: string;
  recentHashes?: readonly string[];
  lastGainAt?: string | number | null;
  replyOk: boolean;
  cited?: boolean;
  now?: number;
  cap?: number;
};

/** 归一化后取哈希：相同内容（含大小写/空格差异）不会重复计分，也不落明文。 */
export function messageHash(text: string): string {
  const normalized = text.normalize('NFKC').replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 32);
}

export function chatInteractionReward(input: ChatRewardInput): {delta: number; reason: ChatRewardReason} {
  const cap = input.cap ?? CHAT_REWARD_CAP;
  const now = input.now ?? Date.now();
  if (!input.replyOk) return {delta: 0, reason: 'reply-failed'};
  const length = [...input.messageText.trim()].filter((char) => /[\p{L}\p{N}\p{Script=Han}]/u.test(char)).length;
  if (length < CHAT_MIN_MESSAGE_CHARS) return {delta: 0, reason: 'too-short'};
  const hash = messageHash(input.messageText);
  if (input.recentHashes?.includes(hash)) return {delta: 0, reason: 'duplicate'};
  if (input.previousGain >= cap) return {delta: 0, reason: 'capped'};
  const lastGainAt = typeof input.lastGainAt === 'string' ? Date.parse(input.lastGainAt) : Number(input.lastGainAt ?? NaN);
  if (Number.isFinite(lastGainAt) && now - lastGainAt < CHAT_MIN_INTERVAL_MS) return {delta: 0, reason: 'cooldown'};
  const delta = Math.max(0, Math.min(input.cited ? 2 : 1, cap - input.previousGain));
  return delta > 0 ? {delta, reason: 'rewarded'} : {delta: 0, reason: 'capped'};
}
