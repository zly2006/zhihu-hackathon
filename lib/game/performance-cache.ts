// V2.4：进程内性能缓存。
// 只缓存可由输入重新推导的结果；不写数据库、不保存整库数据。

export type BoundedTtlCacheOptions = {
  ttlMs: number;
  maxEntries: number;
  now?: () => number;
};

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

function cloneValue<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}

export function stableCacheKey(namespace: string, value: unknown): string {
  return `${namespace}:${stableSerialize(value)}`;
}

export class BoundedTtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly pending = new Map<string, Promise<T>>();
  private readonly now: () => number;

  constructor(private readonly options: BoundedTtlCacheOptions) {
    if (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0) {
      throw new Error("缓存 ttlMs 必须是正数");
    }
    if (!Number.isInteger(options.maxEntries) || options.maxEntries <= 0) {
      throw new Error("缓存 maxEntries 必须是正整数");
    }
    this.now = options.now ?? Date.now;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Map 的尾部代表最近使用，容量淘汰时优先移除头部。
    this.entries.delete(key);
    this.entries.set(key, entry);
    return cloneValue(entry.value);
  }

  set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, {
      expiresAt: this.now() + this.options.ttlMs,
      value: cloneValue(value),
    });
    while (this.entries.size > this.options.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  async getOrSet(key: string, loader: () => Promise<T> | T): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const active = this.pending.get(key);
    if (active) return cloneValue(await active);

    const request = Promise.resolve()
      .then(loader)
      .then((value) => {
        this.set(key, value);
        return cloneValue(value);
      })
      .finally(() => {
        this.pending.delete(key);
      });
    this.pending.set(key, request);
    return cloneValue(await request);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
