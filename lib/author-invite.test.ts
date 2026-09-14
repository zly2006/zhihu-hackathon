import assert from 'node:assert/strict';
import {mkdtemp, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {AuthorInviteError, inviteAuthor, parseAuthorProfileInput} from './author-invite';
import {invitedAuthorProfileBinding, listInvitedAuthors, readInvitedAuthor} from './author-registry';
import {deriveAuthorCastId, fictionalAuthorName, invitedAuthorCapabilitiesFor} from './author-identity';
import {validateAuthorProfile, type AuthorProfile, type AuthorProvider, type AuthorRef} from './author-provider';
import {canonicalProfiles, initial, publicState, selectedCast} from './story';

const token = 'synthetic-invited-author';
const ref: AuthorRef = {provider: 'zhihu', urlToken: token, profileUrl: `https://www.zhihu.com/people/${token}`};
const profile: AuthorProfile = {
  urlToken: token, profileUrl: ref.profileUrl, displayName: '公开昵称', headline: '专注转专业与职业规划的回答者',
  gender: '女', fetchedAt: '2026-03-01T00:00:00.000Z', source: 'zhurl',
};
const provider = (overrides: Partial<AuthorProvider> = {}): AuthorProvider => ({
  resolveProfile: async (target) => validateAuthorProfile(profile, target),
  listAnswers: async () => [],
  searchAnswers: async () => [],
  readAnswer: async () => {throw new Error('unused');},
  ...overrides,
});

test('profile input accepts only canonical zhihu people links or a bare url token', () => {
  const accepted = [
    `https://www.zhihu.com/people/${token}`,
    `https://www.zhihu.com/people/${token}/`,
    `https://zhihu.com/people/${token}`,
    token,
    `  https://www.zhihu.com/people/${token}  `,
  ];
  for (const input of accepted) {
    const parsed = parseAuthorProfileInput(input);
    assert.equal(parsed.urlToken, token, input);
    assert.equal(parsed.profileUrl, ref.profileUrl, input);
  }
});

test('profile input rejects nicknames, foreign urls, ports, credentials and other zhihu paths', () => {
  const rejected = [
    '公开昵称',
    '赵泠',
    'https://evil.test/people/' + token,
    'http://www.zhihu.com/people/' + token,
    'https://www.zhihu.com:8443/people/' + token,
    'https://user:pass@www.zhihu.com/people/' + token,
    'https://www.zhihu.com/people/' + token + '?from=timeline',
    'https://www.zhihu.com/people/' + token + '#about',
    'https://www.zhihu.com/answer/123456',
    'https://www.zhihu.com/question/123456',
    'https://zhuanlan.zhihu.com/p/123456',
    'https://www.zhihu.com/people/../settings',
    'https://www.zhihu.com/people/%2e%2e%2fsettings',
    'javascript:alert(1)',
    'file:///etc/passwd',
    '',
    'a'.repeat(400),
  ];
  for (const input of rejected) {
    assert.throws(() => parseAuthorProfileInput(input), (error: unknown) => {
      assert.ok(error instanceof AuthorInviteError, input);
      return true;
    }, input);
  }
});

test('inviting an author freezes one snapshot and never stores the raw input', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'author-invite-synthetic-'));
  try {
    const result = await inviteAuthor({input: `https://www.zhihu.com/people/${token}`, provider: provider(), registryRoot: root, now: () => Date.parse('2026-03-02T00:00:00.000Z')});
    assert.equal(result.created, true);
    assert.equal(result.entry.urlToken, token);
    assert.equal(result.entry.castId, deriveAuthorCastId(token, '女'));
    assert.equal(result.fictionalName, fictionalAuthorName(token));
    assert.notEqual(result.fictionalName, '公开昵称');
    assert.deepEqual(result.entry.domains, ['职业规划', '升学与考试']);
    assert.equal(result.entry.authorSnapshot.authorUrlToken, token);
    assert.equal(result.entry.authorSnapshot.capturedAt, '2026-03-02T00:00:00.000Z');
    assert.match(result.entry.authorSnapshot.profileHash, /^[0-9a-f]{64}$/);
    assert.deepEqual(result.entry.source.displayName, '公开昵称');
    const stored = await readInvitedAuthor(root, result.entry.castId);
    assert.ok(stored);
    assert.equal(invitedAuthorCapabilitiesFor(token).canEnterRomance, false);
    assert.equal(Object.keys(stored).includes('input'), false);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('a second invite of the same token reuses the stored entry without calling the provider', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'author-invite-reuse-'));
  let calls = 0;
  try {
    const counting = provider({resolveProfile: async (target) => {calls += 1; return validateAuthorProfile(profile, target);}});
    const first = await inviteAuthor({input: token, provider: counting, registryRoot: root});
    const second = await inviteAuthor({input: `https://www.zhihu.com/people/${token}`, provider: counting, registryRoot: root});
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(calls, 1);
    assert.equal(second.entry.castId, first.entry.castId);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('a failed profile read never leaves a half-built character behind', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'author-invite-failure-'));
  try {
    const failing = provider({resolveProfile: async () => {throw new Error('upstream down');}});
    await assert.rejects(inviteAuthor({input: token, provider: failing, registryRoot: root}), (error: unknown) => {
      assert.ok(error instanceof AuthorInviteError);
      assert.equal(error.code, 'AUTHOR_PROVIDER_UNAVAILABLE');
      return true;
    });
    assert.deepEqual(await readdir(root), []);
    assert.deepEqual(await listInvitedAuthors(root), []);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('a profile that is already registered cannot be invited twice', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'author-invite-registered-'));
  let calls = 0;
  try {
    const counting = provider({resolveProfile: async (target) => {calls += 1; return validateAuthorProfile(profile, target);}});
    await assert.rejects(inviteAuthor({input: 'https://www.zhihu.com/people/MarryMea', provider: counting, registryRoot: root}), (error: unknown) => {
      assert.ok(error instanceof AuthorInviteError);
      assert.equal(error.code, 'AUTHOR_ALREADY_REGISTERED');
      assert.equal(error.status, 409);
      return true;
    });
    assert.equal(calls, 0);
    assert.deepEqual(await listInvitedAuthors(root), []);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('invited authors join the mixed cast, cannot romance by default, and never leak the real profile', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'author-invite-cast-'));
  try {
    const invited = await inviteAuthor({input: token, provider: provider(), registryRoot: root});
    const binding = invitedAuthorProfileBinding(invited.entry);
    const profiles = [
      {id: 'ling', name: '林泠', gender: '女' as const},
      {id: invited.entry.castId, name: '随便填', gender: '女' as const, author: binding},
      {id: 'm1', name: '顾言川', gender: '男' as const},
      {id: 'f2', name: '陶晚晴', gender: '女' as const},
    ];
    const state = initial(canonicalProfiles(profiles), {backgroundId: 'university', playerName: '许澄', playerGender: '男', seed: 'invited-cast-test'});
    const cast = selectedCast(state);
    assert.equal(cast.length, 4);
    assert.equal(cast[1].kind, 'zhihu-author');
    assert.equal(cast[1].name, fictionalAuthorName(token));
    assert.deepEqual(cast[1].domains, ['职业规划', '升学与考试']);
    assert.equal(cast[1].capabilities?.canEnterRomance, false);
    assert.equal(cast[1].authorSnapshot?.authorUrlToken, token);
    assert.ok(!cast[1].identity.includes('公开昵称'));
    assert.ok(!cast[1].identity.includes('职业规划的回答者'));

    state.worldState.relationships[invited.entry.castId] = 3;
    state.route = invited.entry.castId;
    state.relationshipType = 'friendship';
    const projected = publicState(state);
    const projectedInvited = projected.world.cast.find((member) => member.id === invited.entry.castId);
    assert.equal(projectedInvited?.kind, 'zhihu-author');
    const serialized = JSON.stringify(projectedInvited);
    for (const forbidden of ['公开昵称', '职业规划的回答者', token]) assert.ok(!serialized.includes(forbidden), forbidden);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('forged invited bindings are rejected before they can change story identity', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'author-invite-forged-'));
  try {
    const invited = await inviteAuthor({input: token, provider: provider(), registryRoot: root});
    const binding = invitedAuthorProfileBinding(invited.entry);
    const base = [
      {id: 'ling', name: '林泠', gender: '女' as const},
      {id: invited.entry.castId, name: 'x', gender: '女' as const, author: binding},
      {id: 'm1', name: '顾言川', gender: '男' as const},
      {id: 'f2', name: '陶晚晴', gender: '女' as const},
    ];
    const withBinding = (author: unknown, overrides: Record<string, unknown> = {}) => canonicalProfiles([base[0], {...base[1], author, ...overrides} as (typeof base)[number], base[2], base[3]]);
    assert.throws(() => withBinding({...binding, capabilities: {...binding.capabilities, canEnterRomance: true}}), /能力配置/);
    assert.throws(() => withBinding({...binding, authorSnapshot: {...binding.authorSnapshot, profileHash: 'f'.repeat(64)}}), /快照校验/);
    assert.throws(() => withBinding({...binding, authorRef: {...binding.authorRef, urlToken: 'another-token', profileUrl: 'https://www.zhihu.com/people/another-token'}}), /不一致/);
    assert.throws(() => withBinding(undefined), /缺少作者绑定/);
    assert.throws(() => withBinding(binding, {gender: '男' as const}), /性别与标识/);
    assert.equal(await readInvitedAuthor(root, 'zhihu-f-0123456789abcdef'), null);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
