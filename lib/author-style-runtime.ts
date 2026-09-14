import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {readLocalCorpusAnswers} from './author-cache';
import {createLiveAuthorProvider} from './author-live-provider';
import type {AuthorProvider, AuthorRef} from './author-provider';
import {parseStyleCard, type AuthorStyleCard} from './author-style';
import {startAuthorStyleJob, styleCardPath, type LearnStyleResult, type StyleModelCaller} from './author-style-agent';

/**
 * 风格学习的运行时接线：把「本地语料 + 在线来源 + 模型凭证」拼成一个后台任务。
 * 供 /api/authors/style（选人确认后触发）和聊天路径（缺卡时兜底）共用。
 */

export type StyleCredentials = {key: string; endpoint: string; model: string; provider?: string; effort?: string};

export type StyleTarget = {
  authorRef: AuthorRef;
  displayName?: string;
  provider?: AuthorProvider | null;
};

export async function readStyleCard(root: string, authorUrlToken: string): Promise<AuthorStyleCard | undefined> {
  try {
    const card = parseStyleCard(JSON.parse(await readFile(styleCardPath(root, authorUrlToken), 'utf8')));
    return card.authorUrlToken === authorUrlToken ? card : undefined;
  } catch {
    return undefined;
  }
}

export function createStyleModelCaller(credentials: StyleCredentials, session = randomUUID()): StyleModelCaller {
  return async (messages) => {
    const response = await fetch(credentials.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.key}`,
        'Content-Type': 'application/json',
        ...(credentials.provider === 'opencode' ? {'x-opencode-session': session} : {}),
      },
      body: JSON.stringify({
        model: credentials.model,
        reasoning_effort: credentials.effort,
        temperature: 0.2,
        max_tokens: 900,
        messages: messages.map((message) => ({role: message.role, content: message.content})),
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`style model http ${response.status}`);
    const body = (await response.json()) as {choices?: {message?: {content?: unknown}}[]};
    const raw = body.choices?.[0]?.message?.content;
    if (typeof raw !== 'string' || !raw.trim()) throw new Error('style model empty reply');
    return raw;
  };
}

export async function prepareAuthorStyle(
  target: StyleTarget,
  options: {root: string; credentials: StyleCredentials; provider?: AuthorProvider | null; force?: boolean; now?: number},
): Promise<LearnStyleResult> {
  const corpus = await readLocalCorpusAnswers(target.authorRef, options.root);
  const provider = options.provider !== undefined ? options.provider : createLiveAuthorProvider({root: options.root, env: process.env});
  return startAuthorStyleJob({
    authorToken: target.authorRef.urlToken,
    displayName: target.displayName,
    root: options.root,
    answers: corpus.answers,
    provider,
    authorRef: target.authorRef,
    now: options.now,
    force: options.force,
    model: options.credentials.model,
    callModel: createStyleModelCaller(options.credentials),
    readExistingCard: () => readStyleCard(options.root, target.authorRef.urlToken),
  });
}
