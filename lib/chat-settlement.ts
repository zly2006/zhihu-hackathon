import type {State} from './story';
import {MAX_PROCESSED_MESSAGE_HASHES, chatInteractionReward, messageHash, type ChatRewardReason} from './chat-reward';

/**
 * 把一次剧情外聊天结算进存档：预设 NPC 与知乎答主走同一条奖励通道。
 * 判定是纯函数（applyChatReward），写入由 updateState 保证同一 exchangeId 只结算一次。
 */

export type ChatStateUpdater = (id: string, mutator: (state: State) => void, options: {exchangeId?: string}) => Promise<State>;

export type ChatRewardOutcome = {delta: number; reason: ChatRewardReason; total: number};
export type ChatSettlement = {id: string; delta: number; total: number; reason: ChatRewardReason};

export function applyChatReward(state: State, input: {
  characterId: string;
  messageText: string;
  replyOk: boolean;
  cited: boolean;
  now?: number;
}): ChatRewardOutcome {
  const world = state.worldState;
  const gains = world.authorChatGains ?? (world.authorChatGains = {});
  const hashes = world.processedChatMessageHashes ?? (world.processedChatMessageHashes = []);
  const previousGain = gains[input.characterId] ?? 0;
  const reward = chatInteractionReward({
    previousGain,
    messageText: input.messageText,
    recentHashes: hashes,
    lastGainAt: world.chatGainAt?.[input.characterId],
    replyOk: input.replyOk,
    cited: input.cited,
    now: input.now,
  });
  if (reward.reason !== 'duplicate') {
    hashes.push(messageHash(input.messageText));
    if (hashes.length > MAX_PROCESSED_MESSAGE_HASHES) hashes.splice(0, hashes.length - MAX_PROCESSED_MESSAGE_HASHES);
  }
  if (reward.delta > 0) {
    gains[input.characterId] = previousGain + reward.delta;
    world.relationships[input.characterId] = Math.max(0, (world.relationships[input.characterId] ?? 0) + reward.delta);
    world.chatGainAt = {...(world.chatGainAt ?? {}), [input.characterId]: new Date(input.now ?? Date.now()).toISOString()};
  }
  return {delta: reward.delta, reason: reward.reason, total: world.relationships[input.characterId] ?? 0};
}

export async function settleChatReward(input: {
  storyId: string;
  characterId: string;
  messageText: string;
  replyOk: boolean;
  cited: boolean;
  exchangeId?: string;
  now?: number;
}, deps: {update?: ChatStateUpdater} = {}): Promise<ChatSettlement> {
  let settlement: ChatSettlement = {id: input.characterId, delta: 0, total: 0, reason: 'capped'};
  const update = deps.update ?? (await import('./storage')).updateState;
  await update(input.storyId, (current) => {
    const outcome = applyChatReward(current, {
      characterId: input.characterId,
      messageText: input.messageText,
      replyOk: input.replyOk,
      cited: input.cited,
      now: input.now,
    });
    settlement = {id: input.characterId, delta: outcome.delta, total: outcome.total, reason: outcome.reason};
  }, {exchangeId: input.exchangeId});
  return settlement;
}
