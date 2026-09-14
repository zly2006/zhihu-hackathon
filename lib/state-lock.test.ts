import assert from 'node:assert/strict';
import test from 'node:test';
import { StateStorageError, updateLockedState, withStoryLock, type StateStore } from './state-lock';

type FakeState = {
  version: 2;
  nodes: string[];
  selections: number[];
  relationships: Record<string, number>;
  authorChatGains: Record<string, number>;
  worldState: { processedChatExchangeIds?: string[] };
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function createStore(initial: FakeState) {
  const files = new Map<string, FakeState>([['11111111-1111-4111-8111-111111111111', initial]]);
  let saves = 0;
  const store: StateStore<FakeState> & { files: Map<string, FakeState>; saves: () => number } = {
    files,
    saves: () => saves,
    isValidId: (id) => /^[0-9a-f-]{36}$/.test(id),
    read: async (id) => {
      await delay(2);
      const state = files.get(id);
      return state ? JSON.parse(JSON.stringify(state)) as FakeState : null;
    },
    save: async (id, state) => {
      await delay(2);
      saves += 1;
      files.set(id, JSON.parse(JSON.stringify(state)) as FakeState);
    },
  };
  return store;
}

const baseState = (): FakeState => ({
  version: 2,
  nodes: [],
  selections: [],
  relationships: { ling: 0 },
  authorChatGains: {},
  worldState: {},
});
const storyId = '11111111-1111-4111-8111-111111111111';

test('concurrent story and chat updates do not overwrite each other', async () => {
  const store = createStore(baseState());
  await Promise.all([
    withStoryLock(storyId, async () => {
      const state = await store.read(storyId);
      await delay(30);
      state!.nodes.push('node-1');
      state!.selections.push(1);
      state!.relationships.ling = 3;
      await store.save(storyId, state!);
    }),
    updateLockedState(storyId, store, async (state) => {
      state.authorChatGains.ling = (state.authorChatGains.ling ?? 0) + 2;
      state.relationships.ling += 2;
    }, { exchangeId: 'exchange-a' }),
  ]);
  const final = store.files.get(storyId)!;
  assert.deepEqual(final.nodes, ['node-1']);
  assert.equal(final.relationships.ling, 5);
  assert.equal(final.authorChatGains.ling, 2);
  assert.deepEqual(final.worldState.processedChatExchangeIds, ['exchange-a']);
});

test('the same exchange id is settled only once even when retried', async () => {
  const store = createStore(baseState());
  let mutations = 0;
  const mutate = async (state: FakeState) => {
    mutations += 1;
    state.authorChatGains.ling = (state.authorChatGains.ling ?? 0) + 1;
    state.relationships.ling += 1;
  };
  const first = await updateLockedState(storyId, store, mutate, { exchangeId: 'exchange-1' });
  const savesAfterFirst = store.saves();
  const second = await updateLockedState(storyId, store, mutate, { exchangeId: 'exchange-1' });
  assert.equal(mutations, 1);
  assert.equal(store.saves(), savesAfterFirst);
  assert.equal(first.authorChatGains.ling, 1);
  assert.equal(second.authorChatGains.ling, 1);
  await updateLockedState(storyId, store, mutate, { exchangeId: 'exchange-2' });
  assert.equal(store.files.get(storyId)!.authorChatGains.ling, 2);
  assert.deepEqual(store.files.get(storyId)!.worldState.processedChatExchangeIds, ['exchange-1', 'exchange-2']);
});

test('missing, invalid and version-mismatched states fail explicitly', async () => {
  const store = createStore(baseState());
  await assert.rejects(updateLockedState('not-a-uuid', store, () => {}), (error: unknown) => {
    assert.ok(error instanceof StateStorageError);
    assert.equal(error.code, 'INVALID_STORY_ID');
    return true;
  });
  await assert.rejects(updateLockedState('22222222-2222-4222-8222-222222222222', store, () => {}), (error: unknown) => {
    assert.ok(error instanceof StateStorageError);
    assert.equal(error.code, 'STORY_NOT_FOUND');
    return true;
  });
  const broken = createStore({ ...baseState(), version: 1 as unknown as 2 });
  await assert.rejects(updateLockedState(storyId, broken, () => {}), (error: unknown) => {
    assert.ok(error instanceof StateStorageError);
    assert.equal(error.code, 'STATE_VERSION_MISMATCH');
    return true;
  });
});

test('mutator failures do not persist partial state', async () => {
  const store = createStore(baseState());
  await assert.rejects(updateLockedState(storyId, store, (state) => { state.nodes.push('partial'); throw new Error('boom'); }), /boom/);
  assert.deepEqual(store.files.get(storyId)!.nodes, []);
});
