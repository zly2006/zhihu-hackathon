import type {AnswerSummary, AuthorAnswer, AuthorProvider, AuthorRef} from './author-provider';
import {AuthorProviderError} from './author-provider';
import {retrieveAuthorEvidence} from './author-retrieval';
import type {AuthorQuestionIntent} from './author-intent';
import {normalizeOnlineQuery} from './author-intent';

/**
 * 程序化证据准备：本地缓存优先，必要时最多一次在线检索、最多一次详情读取。
 * 模型不再决定是否检索，也不需要调用工具；它只拿到这里整理好的证据包。
 */

export const EVIDENCE_ITEM_LIMIT = 5;
export const EVIDENCE_BYTE_BUDGET = 3000;
export const EVIDENCE_EXCERPT_CHARS = 160;
export const EVIDENCE_DETAIL_PARAGRAPHS = 6;
export const EVIDENCE_DETAIL_BYTES = 1200;

export type AuthorProviderStatus = 'unused' | 'used' | 'no-match' | 'auth-required' | 'rate-limited' | 'unsupported' | 'unavailable' | 'invalid';

export type EvidenceOrigin = 'local' | 'online-search' | 'online-detail';

export type EvidenceItem = {
  id: string;
  answerId: string;
  title: string;
  text: string;
  sourceUrl: string;
  authorUrlToken: string;
  authorName: string;
  completeness: string;
  origin: EvidenceOrigin;
};

export type EvidencePacket = {
  items: EvidenceItem[];
  status: 'local' | 'online' | 'none';
  providerStatus: AuthorProviderStatus;
  onlineTried: boolean;
  readTried: boolean;
};

export function providerErrorStatus(error: unknown): {status: AuthorProviderStatus; code: string} {
  if (error instanceof AuthorProviderError) {
    if (error.code === 'AUTHOR_AUTH_REQUIRED') return {status: 'auth-required', code: error.code};
    if (error.code === 'AUTHOR_RATE_LIMITED') return {status: 'rate-limited', code: error.code};
    if (error.code === 'AUTHOR_CONTENT_UNSUPPORTED') return {status: 'unsupported', code: error.code};
    if (error.code === 'AUTHOR_EVIDENCE_INVALID') return {status: 'invalid', code: error.code};
    return {status: 'unavailable', code: error.code};
  }
  return {status: 'unavailable', code: 'AUTHOR_PROVIDER_UNAVAILABLE'};
}

function truncate(text: string, limit: number): string {
  const chars = [...text];
  return chars.length > limit ? `${chars.slice(0, limit).join('')}…` : text;
}

function totalBytes(items: readonly EvidenceItem[]): number {
  return Buffer.byteLength(JSON.stringify(items), 'utf8');
}

function toParagraphItems(answer: {answerId: string; questionTitle: string; sourceUrl: string; body: string; completeness: string}, authorToken: string, authorName: string): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  let bytes = 0;
  const paragraphs = answer.body.split(/\r?\n+/).map((part) => part.trim()).filter(Boolean);
  for (let index = 0; index < paragraphs.length && items.length < EVIDENCE_DETAIL_PARAGRAPHS; index += 1) {
    const text = paragraphs[index];
    const size = Buffer.byteLength(text, 'utf8');
    if (bytes + size > EVIDENCE_DETAIL_BYTES) break;
    bytes += size;
    items.push({
      id: `${answer.answerId}:p${index + 1}`,
      answerId: answer.answerId,
      title: answer.questionTitle,
      text,
      sourceUrl: answer.sourceUrl,
      authorUrlToken: authorToken,
      authorName,
      completeness: answer.completeness,
      origin: 'online-detail',
    });
  }
  return items;
}

function fromSummary(summary: AnswerSummary, authorName: string): EvidenceItem {
  return {
    id: `${summary.answerId}:search`,
    answerId: summary.answerId,
    title: summary.questionTitle,
    text: truncate(summary.excerpt || summary.questionTitle, EVIDENCE_EXCERPT_CHARS),
    sourceUrl: summary.sourceUrl,
    authorUrlToken: summary.authorUrlToken,
    authorName,
    completeness: 'fetched_api_content_unverified',
    origin: 'online-search',
  };
}

export type PrepareEvidenceInput = {
  answers: readonly AuthorAnswer[];
  authorToken: string;
  question: string;
  intent: AuthorQuestionIntent;
  displayName?: string;
  authorRef?: AuthorRef;
  provider?: AuthorProvider | null;
};

export async function prepareAuthorEvidence(input: PrepareEvidenceInput): Promise<EvidencePacket> {
  const authorName = input.displayName?.trim() || '答主';
  const packet: EvidencePacket = {items: [], status: 'none', providerStatus: 'unused', onlineTried: false, readTried: false};
  // 闲聊不需要依据：不检索、不给证据包，模型自然回话即可。
  if (input.intent !== 'knowledge') return packet;
  const retrieval = retrieveAuthorEvidence(input.answers, {
    authorUrlToken: input.authorToken,
    query: input.question,
    sizeBudget: EVIDENCE_BYTE_BUDGET,
    budgetUnit: 'utf8-bytes',
    measureInput: (text) => Buffer.byteLength(text, 'utf8'),
    maxItems: EVIDENCE_ITEM_LIMIT,
  });
  if (retrieval.status === 'matched') {
    packet.items = retrieval.items.slice(0, EVIDENCE_ITEM_LIMIT).map((item) => ({...item, id: item.id, origin: 'local' as const}));
    packet.status = 'local';
  }
  if (packet.items.length || !input.provider || !input.authorRef) return packet;

  packet.onlineTried = true;
  const query = normalizeOnlineQuery(input.question);
  let summaries: AnswerSummary[];
  try {
    summaries = await input.provider.searchAnswers(input.authorRef, query, EVIDENCE_ITEM_LIMIT);
  } catch (error) {
    packet.providerStatus = providerErrorStatus(error).status;
    return packet;
  }
  if (!summaries.length) {
    packet.providerStatus = 'no-match';
    return packet;
  }
  packet.providerStatus = 'used';
  packet.items = summaries
    .filter((summary) => summary.authorUrlToken === input.authorToken)
    .map((summary) => fromSummary(summary, authorName))
    .slice(0, EVIDENCE_ITEM_LIMIT);
  if (!packet.items.length) {
    packet.providerStatus = 'invalid';
    return packet;
  }
  packet.status = 'online';

  const first = packet.items.find((item) => item.origin === 'online-search');
  packet.readTried = true;
  if (!first) return packet;
  try {
    const detail = await input.provider.readAnswer(input.authorRef, first.answerId);
    if (detail.authorUrlToken !== input.authorToken || detail.answerId !== first.answerId) {
      packet.providerStatus = 'invalid';
      return packet;
    }
    const paragraphs = toParagraphItems(detail, input.authorToken, authorName);
    if (!paragraphs.length) return packet;
    const kept = packet.items.filter((item) => item.answerId !== first.answerId);
    packet.items = [...paragraphs, ...kept].slice(0, EVIDENCE_ITEM_LIMIT);
    while (totalBytes(packet.items) > EVIDENCE_BYTE_BUDGET && packet.items.length > 1) packet.items.pop();
  } catch (error) {
    packet.providerStatus = providerErrorStatus(error).status;
  }
  return packet;
}
