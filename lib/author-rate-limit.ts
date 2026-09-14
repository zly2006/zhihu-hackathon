/**
 * 进程内请求节流：同一个作者串行、全局滑动窗口限速，避免服务端凭证被风控。
 * 只保证单实例语义；多实例部署需要换成共享限流器（当前不宣称已解决）。
 */

export const DEFAULT_MAX_PER_MINUTE = 40;
export const DEFAULT_MIN_INTERVAL_MS = 350;

export type AuthorRateLimiter = {
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
  pending(key: string): number;
};

export function createAuthorRateLimiter(options: {maxPerMinute?: number; minIntervalMs?: number; now?: () => number} = {}): AuthorRateLimiter {
  const maxPerMinute = options.maxPerMinute ?? DEFAULT_MAX_PER_MINUTE;
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const now = options.now ?? (() => Date.now());
  const window: number[] = [];
  const queues = new Map<string, Promise<unknown>>();
  const pending = new Map<string, number>();
  let lastStart = 0;

  const reserve = async (): Promise<void> => {
    for (;;) {
      const stamp = now();
      while (window.length && stamp - window[0] > 60_000) window.shift();
      const waited = stamp - lastStart;
      if (window.length < maxPerMinute && waited >= minIntervalMs) {
        window.push(stamp);
        lastStart = stamp;
        return;
      }
      const waitMs = window.length >= maxPerMinute ? Math.max(50, 60_000 - (stamp - window[0])) : Math.max(25, minIntervalMs - waited);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  };

  return {
    pending: (key) => pending.get(key) ?? 0,
    run: <T>(key: string, task: () => Promise<T>): Promise<T> => {
      const previous = queues.get(key) ?? Promise.resolve();
      const chain = previous.then(async () => {
        await reserve();
        return task();
      }, async () => {
        await reserve();
        return task();
      });
      queues.set(key, chain.catch(() => undefined));
      pending.set(key, (pending.get(key) ?? 0) + 1);
      void chain.finally(() => {
        const left = (pending.get(key) ?? 1) - 1;
        if (left <= 0) {
          pending.delete(key);
          if (queues.get(key) === chain) queues.delete(key);
        } else {
          pending.set(key, left);
        }
      }).catch(() => undefined);
      return chain;
    },
  };
}

const globalLimiter = globalThis as typeof globalThis & {lamplightAuthorLimiter?: AuthorRateLimiter};

export function authorRateLimiter(): AuthorRateLimiter {
  return globalLimiter.lamplightAuthorLimiter ??= createAuthorRateLimiter();
}
