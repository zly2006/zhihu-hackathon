import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTHOR_CAST_REGISTRATIONS,
  resolveAuthorCastRegistration,
  authorCastBackgroundRole,
} from './author-cast';
import {
  authorSelectableCharacters,
  canonicalProfiles,
  castPool,
  choose,
  initial,
  limits,
  promptText,
  publicState,
  resolveEnding,
  resolveSelectableCharacter,
  selectableCharacters,
  selectedCast,
  selectedIds,
  validate,
  type CharacterProfile,
  type State,
  type StoryNode,
} from './story';

const mixedIds = ['ling', 'm1', 'f3', 'f4'];
const presetIds = ['m1', 'm3', 'f2', 'f4'];
const startOptions = { backgroundId: 'university', playerName: '许澄', playerGender: '女' as const, seed: 'author-cast-test' };

function profilesFor(ids: string[]): CharacterProfile[] {
  return ids.map((id) => {
    const member = resolveSelectableCharacter(id);
    if (!member) throw new Error(`unknown ${id}`);
    return { id: member.id, name: member.name, gender: member.gender };
  });
}

function openingNode(state: State): StoryNode {
  const members = selectedCast(state);
  const text = '段'.repeat(state.nodes.length + 1) + '字'.repeat(57);
  return {
    title: '林泠与大家',
    lines: members.map((member) => ({ speaker: member.name, text })),
    choices: members.map((member) => ({ text: `和${member.name}一起处理`, target: member.id })),
    memory: { summary: '', facts: [] },
  };
}

function append(state: State, node: StoryNode) {
  state.nodes.push(validate(node, state));
  state.pending = false;
}

function chooseTarget(state: State, target: string) {
  append(state, openingNode(state));
  const index = state.nodes.at(-1)!.choices.findIndex((choice) => choice.target === target);
  choose(state, index, state.nodes.length);
}

test('ling is registered as a fictional zhihu author with stable contract', () => {
  const registration = resolveAuthorCastRegistration('ling');
  assert.equal(registration?.displayName, '林泠');
  assert.equal(registration?.kind, 'zhihu-author');
  assert.equal(registration?.gender, '女');
  assert.equal(registration?.personaStatus, 'fictional');
  assert.equal(registration?.corpusStatus, 'evidence-only');
  assert.equal(registration?.authorAvatarId, 'zhao-ling');
  assert.ok(registration?.disclosure.includes('虚构'));
  assert.deepEqual(AUTHOR_CAST_REGISTRATIONS.map((entry) => entry.castId), ['ling']);
  for (const backgroundId of ['high-school', 'university', 'graduate', 'early-career']) {
    assert.ok(authorCastBackgroundRole(registration!, backgroundId)?.identity);
  }
  const userVisible = JSON.stringify(selectableCharacters().filter((entry) => entry.kind === 'zhihu-author'));
  assert.ok(!userVisible.includes('赵泠'));
  assert.ok(!userVisible.includes('MarryMea'));
  assert.ok(!userVisible.includes('知乎答主'));
});

test('preset pool stays eight characters and author ids never enter it', () => {
  assert.equal(castPool.length, 8);
  assert.ok(!castPool.some((member) => member.id === 'ling'));
  assert.equal(selectableCharacters().length, 9);
  assert.equal(authorSelectableCharacters()[0].name, '林泠');
});

test('mixed cast creates state with four unique members and unified kinds', () => {
  const profiles = canonicalProfiles(profilesFor(mixedIds));
  assert.equal(profiles.length, 4);
  assert.equal(profiles[0].authorAvatarId, 'zhao-ling');
  const state = initial(profiles, startOptions);
  const cast = selectedCast(state);
  assert.deepEqual(cast.map((member) => member.id), mixedIds);
  assert.equal(cast[0].kind, 'zhihu-author');
  assert.equal(cast[0].name, '林泠');
  assert.equal(cast[0].age, 20);
  assert.equal(cast[1].kind, 'preset-npc');
  assert.ok(cast[0].voice && cast[0].desire && cast[0].route_event && cast[0].payoff);
  assert.deepEqual(selectedIds(state), mixedIds);
});

test('duplicate, unknown and gender-mismatched selections are rejected', () => {
  const profiles = profilesFor(mixedIds);
  assert.throws(() => canonicalProfiles([...profiles.slice(0, 3), profiles[0]]), /不能重复选择/);
  assert.throws(() => canonicalProfiles([...profiles.slice(0, 3), { ...profiles[0], id: 'unknown' }]), /角色资料/);
  assert.throws(() => canonicalProfiles([...profiles.slice(0, 3), { ...profiles[3], gender: '男' }]), /角色资料/);
  assert.throws(() => canonicalProfiles([...profiles.slice(0, 3), { ...profiles[3], authorAvatarId: 'unknown' }]), /化身/);
});

test('ling can be a common-round target and be locked into a route', () => {
  const state = initial(profilesFor(mixedIds), { ...startOptions, playerGender: '男' });
  chooseTarget(state, 'ling');
  chooseTarget(state, 'ling');
  assert.equal(state.route, 'ling');
  assert.equal(state.relationshipType, 'romance');
  const progress = publicState(state).relationshipProgress.find((entry) => entry.id === 'ling');
  assert.ok(progress && progress.affinity >= 2);
});

test('same-gender player locks ling into friendship while opposite gender locks romance', () => {
  const friendship = initial(profilesFor(mixedIds), { ...startOptions, playerGender: '女' });
  chooseTarget(friendship, 'ling');
  chooseTarget(friendship, 'ling');
  assert.equal(friendship.route, 'ling');
  assert.equal(friendship.relationshipType, 'friendship');

  const romance = initial(profilesFor(mixedIds), { ...startOptions, playerGender: '男' });
  chooseTarget(romance, 'ling');
  chooseTarget(romance, 'ling');
  assert.equal(romance.route, 'ling');
  assert.equal(romance.relationshipType, 'romance');
});

test('public projection carries kind but never the real author identity', () => {
  const state = initial(profilesFor(mixedIds), startOptions);
  const publicCast = publicState(state).world.cast;
  const ling = publicCast.find((member) => member.id === 'ling');
  assert.equal(ling?.kind, 'zhihu-author');
  assert.equal(ling?.name, '林泠');
  const serialized = JSON.stringify(ling);
  for (const forbidden of ['赵泠', 'MarryMea', 'zhiHu', '知乎答主']) assert.ok(!serialized.includes(forbidden), forbidden);
});

test('legacy preset saves with authorAvatarId and missing new fields still load', () => {
  const legacy = initial(profilesFor(presetIds), startOptions);
  legacy.profiles![0].authorAvatarId = 'zhao-ling';
  delete legacy.worldState.authorChatGains;
  delete legacy.worldState.processedChatExchangeIds;
  const roundTripped = JSON.parse(JSON.stringify(legacy)) as State;
  const cast = selectedCast(roundTripped);
  assert.equal(cast[0].authorAvatarId, 'zhao-ling');
  assert.equal(cast[0].kind, 'preset-npc');
  const projected = publicState(roundTripped);
  assert.equal(projected.world.cast[0].authorAvatarId, 'zhao-ling');
  assert.equal(projected.world.cast[0].kind, 'preset-npc');
});

test('common round normalizes its four targets to include the author character', () => {
  const state = initial(profilesFor(mixedIds), startOptions);
  const node = openingNode(state);
  node.choices = [{ text: '只看预设角色', target: 'm1' }];
  const validated = validate(node, state);
  assert.deepEqual(validated.choices.map((choice) => choice.target), mixedIds);
});

test('beats and cast limits remain unchanged for the mixed pool', () => {
  assert.equal(limits.totalChoiceMax, 4);
  assert.equal(initial(profilesFor(mixedIds), startOptions).profiles?.length, 4);
});

test('chat gains feed the next story prompt relationship view', () => {
  const state = initial(profilesFor(mixedIds), startOptions);
  state.worldState.relationships.ling = 2;
  state.worldState.authorChatGains = { ling: 2 };
  const prompt = promptText(state);
  assert.ok(prompt.includes('ling(林泠)=2'));
});

test('a ling romance route resolves the same ending table as preset characters', () => {
  const state = initial(profilesFor(mixedIds), { ...startOptions, playerGender: '男' });
  chooseTarget(state, 'ling');
  chooseTarget(state, 'ling');
  state.worldState.relationships.ling = 6;
  assert.equal(resolveEnding(state).id, 'mutual-commitment');
  assert.equal(publicState(state).ending?.id, 'mutual-commitment');
});
