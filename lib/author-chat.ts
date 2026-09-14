import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {AuthorChatError} from './author-errors';
import {readLocalCorpusAnswers} from './author-cache';
import {assertAuthorRef, type AuthorProvider, type AuthorRef} from './author-provider';
import {AUTHOR_INPUT_BYTE_LIMIT, runAuthorConversation, type AuthorHistory, type AuthorModelMessage} from './author-conversation';
import {prepareAuthorEvidence, type EvidencePacket} from './author-evidence';
import {classifyAuthorQuestion} from './author-intent';
import {isStyleCardFresh, parseStyleCard, stylePromptFragment, type AuthorStyleCard} from './author-style';
import {createLiveAuthorProvider} from './author-live-provider';
import type {AuthorSource} from './author-citations';

export {AuthorChatError, AUTHOR_INPUT_BYTE_LIMIT};
export type AuthorChatReply = {
  text: string;
  sources: AuthorSource[];
  evidenceStatus: 'matched' | 'no-match' | 'unverified' | 'persona';
  providerStatus: string;
  avatar: {id: string; displayName: string; styleStatus: AuthorStyleStatus};
  modelCalls: number;
};

/** 存档里冻结的作者绑定：服务端按它恢复 Provider，不信任客户端提交的 token。 */
export type AuthorChatTarget = {
  castId: string;
  displayName: string;
  authorRef: AuthorRef;
  authorSnapshot: {authorUrlToken: string; profileHash?: string; capturedAt?: string};
  domains?: readonly string[];
  /** 公开来源昵称：只用于回答“你是谁”时说明来源，主页链接由界面提供。 */
  sourceDisplayName?: string;
};

export type AuthorChatRuntime = AuthorChatTarget & {
  provider: AuthorProvider | null;
  localAnswers: Awaited<ReturnType<typeof readLocalCorpusAnswers>>['answers'];
  corpusStatus: 'ok' | 'missing' | 'invalid';
  styleCard?: AuthorStyleCard;
  styleStatus: AuthorStyleStatus;
  /** 风格卡缺失或过期：调用方可以在后台补一份，不影响本次回复。 */
  styleStale: boolean;
  root: string;
};

export function defaultAuthorDataRoot(cwd = process.cwd()): string {
  return path.join(cwd, '.data', 'author-avatars');
}

export type AuthorStyleStatus = 'unreviewed' | 'auto' | 'reviewed';

export function authorStyleStatus(card: AuthorStyleCard | undefined, now = Date.now()): AuthorStyleStatus {
  if (card?.status === 'reviewed') return 'reviewed';
  if (card?.status === 'auto' && isStyleCardFresh(card, now)) return 'auto';
  return 'unreviewed';
}

export async function loadAuthorChatRuntime(
  target: AuthorChatTarget,
  options: {provider?: AuthorProvider | null; root?: string; now?: () => number} = {},
): Promise<AuthorChatRuntime> {
  let authorRef: AuthorRef;
  try {
    authorRef = assertAuthorRef(target.authorRef);
  } catch {
    throw new AuthorChatError('答主绑定不合法。', 400, 'AUTHOR_BINDING_INVALID');
  }
  if (target.authorSnapshot?.authorUrlToken !== authorRef.urlToken) throw new AuthorChatError('答主快照与作者标识不一致。', 400, 'AUTHOR_BINDING_INVALID');
  const root = options.root ?? defaultAuthorDataRoot();
  const corpus = await readLocalCorpusAnswers(authorRef, root);
  const provider = options.provider !== undefined ? options.provider : createLiveAuthorProvider({root, env: process.env});
  let styleCard: AuthorStyleCard | undefined;
  try {
    const raw = JSON.parse(await readFile(path.join(root, authorRef.urlToken, 'style', 'style-card.json'), 'utf8'));
    const parsed = parseStyleCard(raw);
    if (parsed.authorUrlToken === authorRef.urlToken) styleCard = parsed;
    else console.warn('[author-chat]', {code: 'STYLE_CARD_AUTHOR_MISMATCH'});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('[author-chat]', {code: 'STYLE_CARD_UNAVAILABLE'});
  }
  return {...target, authorRef, provider, localAnswers: corpus.answers, corpusStatus: corpus.corpusStatus, styleCard, styleStatus: authorStyleStatus(styleCard), styleStale: !isStyleCardFresh(styleCard), root};
}

export async function replyAsAuthor(
  input: {runtime: AuthorChatRuntime; story: string; messages: readonly AuthorHistory[]; context?: 'story' | 'trial'},
  getCredentials: () => {key: string; endpoint: string; model: string; provider?: string; effort?: string},
): Promise<AuthorChatReply> {
  const runtime = input.runtime;
  const publicAvatar = {id: runtime.castId, displayName: runtime.displayName, styleStatus: runtime.styleStatus};
  const question = input.messages.at(-1)?.text ?? '';
  if (!question.trim()) throw new AuthorChatError('请先输入你的问题。', 400, 'INVALID_HISTORY');
  const intent = classifyAuthorQuestion(question);
  const packet: EvidencePacket = await prepareAuthorEvidence({
    answers: runtime.localAnswers,
    authorToken: runtime.authorRef.urlToken,
    question,
    intent,
    displayName: runtime.displayName,
    authorRef: runtime.authorRef,
    provider: runtime.provider,
  });
  const credentials = getCredentials();
  const session = randomUUID();
  const callModel = async (messages: readonly AuthorModelMessage[]): Promise<string> => {
    let response: Response;
    try {
      response = await fetch(credentials.endpoint, {
        method: 'POST',
        headers: {Authorization: `Bearer ${credentials.key}`, 'Content-Type': 'application/json', 'x-opencode-session': session},
        body: JSON.stringify({model: credentials.model, reasoning_effort: credentials.effort, temperature: 0.4, max_tokens: 1200, messages}),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw new AuthorChatError('模型服务响应超时，请稍后重试。', 504, 'MODEL_TIMEOUT');
      throw new AuthorChatError('回复暂时没有送达，请稍后重试。', 502, 'MODEL_UNAVAILABLE');
    }
    if (!response.ok) {
      console.error('[author-chat]', {code: 'MODEL_HTTP', status: response.status});
      throw new AuthorChatError('模型服务暂不可用，请稍后重试。', 502, 'MODEL_UNAVAILABLE');
    }
    const body = (await response.json()) as {choices?: {message?: {content?: unknown}}[]; usage?: Record<string, unknown>};
    const raw = body.choices?.[0]?.message?.content;
    if (typeof raw !== 'string') throw new AuthorChatError('模型回复内容必须是字符串。', 502, 'INVALID_MODEL_REPLY');
    const usage = Object.fromEntries(['prompt_tokens', 'completion_tokens', 'total_tokens', 'prompt_cache_hit_tokens', 'prompt_cache_miss_tokens'].filter((key) => typeof body.usage?.[key] === 'number').map((key) => [key, body.usage![key]]));
    console.info('[author-chat]', {castId: runtime.castId, budgetUnit: 'utf8-bytes', corpusStatus: runtime.corpusStatus, intent, evidenceItems: packet.items.length, providerStatus: packet.providerStatus, ...usage});
    return raw;
  };
  const result = await runAuthorConversation({
    story: input.story,
    history: input.messages,
    persona: {displayName: runtime.displayName, domains: runtime.domains, context: input.context, sourceDisplayName: runtime.sourceDisplayName},
    style: isStyleCardFresh(runtime.styleCard) ? stylePromptFragment(runtime.styleCard) : undefined,
    packet,
    authorToken: runtime.authorRef.urlToken,
  }, callModel);
  return {...result, avatar: publicAvatar};
}
