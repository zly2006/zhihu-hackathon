export type StoryArtifactCacheOptions = {
  ttlMs: number;
  maxEntries: number;
  now?: () => number;
};

type Entry<T> = { value: T; expiresAt: number };
type Loader<T> = (signal: AbortSignal) => Promise<T> | T;
type PendingEntry<T> = {
  controller: AbortController;
  promise: Promise<T>;
  subscribers: Set<symbol>;
};

function clone<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * A bounded cache for reconstructable future units. The pending map is part of
 * the cache, so foreground playback and background prepare share one promise
 * instead of opening two model calls for the same semantic key.
 */
export class StoryArtifactCache<T> {
  private readonly values = new Map<string, Entry<T>>();
  private readonly pending = new Map<string, PendingEntry<T>>();
  private readonly now: () => number;

  constructor(private readonly options: StoryArtifactCacheOptions) {
    if (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0) throw new Error("ttlMs 必须是正数");
    if (!Number.isInteger(options.maxEntries) || options.maxEntries <= 0) throw new Error("maxEntries 必须是正整数");
    this.now = options.now ?? Date.now;
  }

  get(key: string): T | undefined {
    const entry = this.values.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.values.delete(key);
      return undefined;
    }
    this.values.delete(key);
    this.values.set(key, entry);
    return clone(entry.value);
  }

  async getOrPrepare(
    key: string,
    loader: Loader<T> | (() => Promise<T> | T),
    options: { signal?: AbortSignal } = {},
  ): Promise<T> {
    if (options.signal?.aborted) throw abortError();
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    let active = this.pending.get(key);
    if (!active) {
      const controller = new AbortController();
      const request = Promise.resolve()
      .then(() => loader(controller.signal))
      .then((value) => {
        this.set(key, value);
        return clone(value);
      })
      .finally(() => {
        const current = this.pending.get(key);
        if (current?.promise === request) this.pending.delete(key);
      });
      active = { controller, promise: request, subscribers: new Set() };
      this.pending.set(key, active);
    }
    const token = Symbol(key);
    active.subscribers.add(token);
    return new Promise<T>((resolve, reject) => {
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        active?.subscribers.delete(token);
        if (active && active.subscribers.size === 0 && this.pending.get(key) === active) {
          active.controller.abort();
        }
        options.signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        release();
        reject(abortError());
      };
      options.signal?.addEventListener("abort", onAbort, { once: true });
      active?.promise.then(
        (value) => {
          release();
          resolve(clone(value));
        },
        (error) => {
          release();
          reject(error);
        },
      );
    });
  }

  set(key: string, value: T): void {
    this.values.delete(key);
    this.values.set(key, { value: clone(value), expiresAt: this.now() + this.options.ttlMs });
    while (this.values.size > this.options.maxEntries) {
      const oldest = this.values.keys().next().value;
      if (oldest === undefined) break;
      this.values.delete(oldest);
    }
  }

  invalidate(key: string): void {
    this.values.delete(key);
  }

  clear(): void {
    for (const entry of this.pending.values()) entry.controller.abort();
    this.values.clear();
  }

  get size(): number {
    return this.values.size;
  }
}

function abortError(): Error {
  const error = new Error("故事内容准备已取消");
  error.name = "AbortError";
  return error;
}
