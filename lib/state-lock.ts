export type UpdatableState = {
  version: number;
  worldState?: { processedChatExchangeIds?: string[] };
};

export type StateStore<T> = {
  read: (storyId: string) => Promise<T | null>;
  save: (storyId: string, state: T) => Promise<void>;
  isValidId?: (storyId: string) => boolean;
};

export class StateStorageError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = 'StateStorageError';
  }
}

const globalStore = globalThis as typeof globalThis & { storyStateLocks?: Map<string, Promise<void>> };
const locks = globalStore.storyStateLocks ??= new Map<string, Promise<void>>();

export const MAX_PROCESSED_EXCHANGE_IDS = 500;

export async function acquireStoryLock(storyId: string): Promise<() => void> {
  const previous = locks.get(storyId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => gate, () => gate);
  locks.set(storyId, tail);
  await previous.catch(() => {});
  let released = false;
  return () => {
    if (released) return;
    released = true;
    release();
    if (locks.get(storyId) === tail) locks.delete(storyId);
  };
}

export async function withStoryLock<T>(storyId: string, task: () => Promise<T>): Promise<T> {
  const release = await acquireStoryLock(storyId);
  try {
    return await task();
  } finally {
    release();
  }
}

export async function updateLockedState<T extends UpdatableState>(
  storyId: string,
  store: StateStore<T>,
  mutator: (state: T) => T | void | Promise<T | void>,
  options: { exchangeId?: string } = {},
): Promise<T> {
  if (store.isValidId && !store.isValidId(storyId)) throw new StateStorageError('存档标识无效。', 400, 'INVALID_STORY_ID');
  return withStoryLock(storyId, async () => {
    const current = await store.read(storyId);
    if (!current) throw new StateStorageError('剧情存档不可用。', 404, 'STORY_NOT_FOUND');
    if (current.version !== 2) throw new StateStorageError('存档版本不兼容。', 409, 'STATE_VERSION_MISMATCH');
    const exchangeId = options.exchangeId?.trim();
    if (exchangeId && current.worldState?.processedChatExchangeIds?.includes(exchangeId)) return current;
    const mutated = await mutator(current);
    const next = (mutated ?? current) as T;
    if (next.version !== 2) throw new StateStorageError('存档版本不兼容。', 409, 'STATE_VERSION_MISMATCH');
    if (exchangeId) {
      next.worldState = {
        ...next.worldState,
        processedChatExchangeIds: [...(next.worldState?.processedChatExchangeIds ?? []), exchangeId].slice(-MAX_PROCESSED_EXCHANGE_IDS),
      };
    }
    await store.save(storyId, next);
    return next;
  });
}
