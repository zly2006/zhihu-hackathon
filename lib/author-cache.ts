import {createHash} from 'node:crypto';
import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {CorpusError, loadAuthorCorpus, type AuthorAnswer as CorpusAnswer} from './author-corpus';
import {isAuthorUrlToken} from './author-identity';
import {
  AUTHOR_PROVIDER_MESSAGES,
  AuthorProviderError,
  assertAuthorRef,
  validateAnswerSummary,
  validateAuthorAnswer,
  validateAuthorProfile,
  type AnswerSummary,
  type AuthorAnswer,
  type AuthorCacheLike,
  type AuthorProfile,
  type AuthorRef,
  type CachedSearchResult,
} from './author-provider';

export const AUTHOR_CACHE_DIRNAME = 'runtime-cache';
const RUNTIME_CACHE_SCHEMA = 1;

const entrySchema = z.object({
  schemaVersion: z.literal(RUNTIME_CACHE_SCHEMA),
  authorUrlToken: z.string().min(1).max(100),
  cachedAt: z.string().min(1).max(40),
  payload: z.unknown(),
}).strict();

type CacheEntry = z.infer<typeof entrySchema>;

function assertToken(urlToken: string): string {
  if (!isAuthorUrlToken(urlToken)) throw new AuthorProviderError('知乎主页标识不合法。', 'AUTHOR_EVIDENCE_INVALID', 400);
  return urlToken;
}

export function authorDirectory(root: string, urlToken: string): string {
  return path.join(root, assertToken(urlToken));
}

export function authorCacheDirectory(root: string, urlToken: string): string {
  return path.join(authorDirectory(root, urlToken), AUTHOR_CACHE_DIRNAME);
}

function searchKey(query: string, limit: number): string {
  return createHash('sha256').update(`${limit}:${query.normalize('NFKC')}`).digest('hex').slice(0, 32);
}

/**
 * 作者隔离的本地缓存：所有读写都以 urlToken 为目录边界，
 * 缓存内容在读取时重新过一遍作者绑定校验，损坏或串作者的条目一律当未命中。
 */
export class FileAuthorCache implements AuthorCacheLike {
  constructor(private readonly root: string, private readonly now: () => number = () => Date.now()) {}

  private get cacheRoot(): string {
    return this.root;
  }

  private async readEntry(file: string): Promise<CacheEntry | null> {
    try {
      const parsed = entrySchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private async writeEntry(urlToken: string, name: string, payload: unknown): Promise<void> {
    const directory = authorCacheDirectory(this.cacheRoot, urlToken);
    await mkdir(directory, {recursive: true});
    const file = path.join(directory, name);
    const body: CacheEntry = {schemaVersion: RUNTIME_CACHE_SCHEMA, authorUrlToken: urlToken, cachedAt: new Date(this.now()).toISOString(), payload};
    await writeFile(`${file}.tmp`, `${JSON.stringify(body)}\n`);
    await rename(`${file}.tmp`, file);
  }

  private fresh(entry: CacheEntry | null, urlToken: string, ttlMs: number): CacheEntry | null {
    if (!entry || entry.authorUrlToken !== urlToken) return null;
    const cachedAt = Date.parse(entry.cachedAt);
    if (!Number.isFinite(cachedAt)) return null;
    return this.now() - cachedAt <= ttlMs ? entry : null;
  }

  async readProfile(ref: AuthorRef, ttlMs: number): Promise<AuthorProfile | null> {
    const bound = assertAuthorRef(ref);
    const entry = this.fresh(await this.readEntry(path.join(authorCacheDirectory(this.root, bound.urlToken), 'profile.json')), bound.urlToken, ttlMs);
    if (!entry) return null;
    try {
      return validateAuthorProfile(entry.payload, bound);
    } catch {
      return null;
    }
  }

  async writeProfile(ref: AuthorRef, profile: AuthorProfile): Promise<void> {
    const bound = assertAuthorRef(ref);
    await this.writeEntry(bound.urlToken, 'profile.json', validateAuthorProfile(profile, bound));
  }

  async readAnswers(ref: AuthorRef, sort: 'latest' | 'top-voteups', ttlMs: number): Promise<AnswerSummary[] | null> {
    const bound = assertAuthorRef(ref);
    const entry = this.fresh(await this.readEntry(path.join(authorCacheDirectory(this.root, bound.urlToken), `list-${sort}.json`)), bound.urlToken, ttlMs);
    if (!entry || !Array.isArray(entry.payload)) return null;
    try {
      const items = entry.payload.map((item) => validateAnswerSummary(item, bound));
      return items.length ? items : null;
    } catch {
      return null;
    }
  }

  async writeAnswers(ref: AuthorRef, sort: 'latest' | 'top-voteups', items: AnswerSummary[]): Promise<void> {
    const bound = assertAuthorRef(ref);
    const validated = items.slice(0, 10).map((item) => validateAnswerSummary(item, bound));
    await this.writeEntry(bound.urlToken, `list-${sort}.json`, validated);
  }

  async readSearch(ref: AuthorRef, query: string, limit: number, ttlMs: number): Promise<CachedSearchResult | null> {
    const bound = assertAuthorRef(ref);
    const file = path.join(authorCacheDirectory(this.root, bound.urlToken), `search-${searchKey(query, limit)}.json`);
    const entry = this.fresh(await this.readEntry(file), bound.urlToken, ttlMs);
    if (!entry || !Array.isArray(entry.payload)) return null;
    try {
      const items = entry.payload.map((item) => validateAnswerSummary(item, bound));
      return {items, cachedAt: entry.cachedAt};
    } catch {
      return null;
    }
  }

  async writeSearch(ref: AuthorRef, query: string, limit: number, items: AnswerSummary[]): Promise<void> {
    const bound = assertAuthorRef(ref);
    const validated = items.slice(0, Math.max(1, Math.min(5, limit))).map((item) => validateAnswerSummary(item, bound));
    await this.writeEntry(bound.urlToken, `search-${searchKey(query, limit)}.json`, validated);
  }

  async readAnswer(ref: AuthorRef, answerId: string, ttlMs: number): Promise<AuthorAnswer | null> {
    const bound = assertAuthorRef(ref);
    if (!/^\d+$/.test(answerId)) return null;
    const entry = this.fresh(await this.readEntry(path.join(authorCacheDirectory(this.root, bound.urlToken), `answer-${answerId}.json`)), bound.urlToken, ttlMs);
    if (!entry) return null;
    try {
      return validateAuthorAnswer(entry.payload, bound);
    } catch {
      return null;
    }
  }

  async writeAnswer(ref: AuthorRef, answer: AuthorAnswer): Promise<void> {
    const bound = assertAuthorRef(ref);
    await this.writeEntry(bound.urlToken, `answer-${answer.answerId}.json`, validateAuthorAnswer(answer, bound));
  }

  async clear(): Promise<void> {
    await rm(this.root, {recursive: true, force: true});
  }
}

export type LocalCorpusLoad = {answers: AuthorAnswer[]; corpusStatus: 'ok' | 'missing' | 'invalid'};

function fromCorpusAnswer(answer: CorpusAnswer): AuthorAnswer {
  return {
    answerId: answer.answerId,
    authorUrlToken: answer.authorUrlToken,
    authorName: answer.authorName,
    questionTitle: answer.questionTitle,
    sourceUrl: answer.sourceUrl,
    body: answer.body,
    completeness: answer.completeness,
  };
}

/** 已采集语料继续作为 RAG、缓存和在线失败时的降级来源。 */
export async function readLocalCorpusAnswers(ref: AuthorRef, root: string): Promise<LocalCorpusLoad> {
  const bound = assertAuthorRef(ref);
  try {
    const corpus = await loadAuthorCorpus(authorDirectory(root, bound.urlToken), bound.urlToken);
    return {answers: corpus.answers.map(fromCorpusAnswer), corpusStatus: 'ok'};
  } catch (error) {
    if (error instanceof CorpusError) {
      return {answers: [], corpusStatus: error.code === 'CORPUS_MISSING' ? 'missing' : 'invalid'};
    }
    return {answers: [], corpusStatus: 'missing'};
  }
}

export function unsupportedOnlineMessage(): string {
  return AUTHOR_PROVIDER_MESSAGES.AUTHOR_CONTENT_UNSUPPORTED;
}
