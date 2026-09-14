import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {buildConversationMessages} from './author-conversation';
import {authorBindingHash, deriveAuthorCastId} from './author-identity';
import {invitedAuthorProfileBinding, type InvitedAuthor} from './author-registry';
import {canonicalProfiles, initial, promptText, publicState, selectedCast} from './story';

const token = 'synthetic-invited-author';
const castId = deriveAuthorCastId(token, '女');
const inviteBinding = invitedAuthorProfileBinding({
  schemaVersion: 1,
  castId,
  urlToken: token,
  profileUrl: `https://www.zhihu.com/people/${token}`,
  gender: '女',
  domains: ['职业规划'],
  personaStatus: 'fictional',
  disclosure: '基于知乎公开内容改编的虚构 AI 角色',
  authorSnapshot: {authorUrlToken: token, profileHash: authorBindingHash(token), capturedAt: '2026-03-01T00:00:00.000Z'},
  source: {displayName: '公开昵称', headline: '聊聊职业规划', profileUrl: `https://www.zhihu.com/people/${token}`, fetchedAt: '2026-03-01T00:00:00.000Z', kind: 'web'},
  invitedAt: '2026-03-01T00:00:00.000Z',
} satisfies InvitedAuthor);

const source = (file: string) => readFileSync(path.join(process.cwd(), 'lib', file), 'utf8');
const appSource = (file: string) => readFileSync(path.join(process.cwd(), 'app', ...file.split('/')), 'utf8');

test('oauth credentials never enter author runtime modules', () => {
  const modules = ['author-conversation.ts', 'author-evidence.ts', 'author-intent.ts', 'author-chat.ts', 'author-provider.ts', 'author-provider-official.ts', 'author-provider-zhihu-web.ts', 'author-web-credentials.ts', 'author-rate-limit.ts', 'author-live-provider.ts', 'author-invite.ts', 'author-registry.ts', 'author-catalogue.ts', 'author-runtime-config.ts'];
  for (const file of modules) {
    const text = source(file);
    for (const forbidden of ['authorization_code', 'access_token', 'app_key', 'app_secret', 'refresh_token']) {
      assert.ok(!text.includes(forbidden), `${file} must not reference ${forbidden}`);
    }
    if (file !== 'author-provider-official.ts' && file !== 'author-runtime-config.ts') {
      assert.ok(!text.includes('X-OAuth-Token'), `${file} must not build oauth headers`);
    }
    assert.ok(!/console\.[a-z]+\([^)]*secret/i.test(text), `${file} must not log secrets`);
  }
});

test('oauth token header construction stays in the official provider only', () => {
  const official = source('author-provider-official.ts');
  assert.ok(official.includes("headers['X-OAuth-Token']"));
  const auth = source('zhihu-auth.ts');
  assert.ok(auth.includes('accessToken'), 'auth session keeps the token server-side');
  const payloadKeys = auth.slice(auth.indexOf('payload:{'), auth.indexOf('payload:{') + 400);
  assert.ok(!/accessToken\s*[:,]/.test(payloadKeys), 'the auth status payload must not return the token');
});

test('author prompts only carry the fictional identity', () => {
  const messages = buildConversationMessages({story: '公开剧情摘要', history: [{role: 'user', text: '你好'}], persona: {displayName: '苏听澜'}});
  const serialized = JSON.stringify(messages);
  assert.ok(serialized.includes('苏听澜'));
  assert.ok(!serialized.includes(token));
  assert.ok(!serialized.includes('公开昵称'));
  assert.ok(!serialized.includes('MarryMea'));
  assert.ok(messages.every((message) => typeof message.content === 'string'));
});

test('story prompts and public state keep only the fictional projection', () => {
  const profiles = [
    {id: 'ling', name: '林泠', gender: '女' as const},
    {id: castId, name: 'x', gender: '女' as const, author: inviteBinding},
    {id: 'm1', name: '顾言川', gender: '男' as const},
    {id: 'f2', name: '陶晚晴', gender: '女' as const},
  ];
  const state = initial(canonicalProfiles(profiles), {backgroundId: 'university', playerName: '许澄', playerGender: '女', seed: 'oauth-boundary'});
  const prompt = promptText(state);
  assert.ok(!prompt.includes(token));
  assert.ok(!prompt.includes('公开昵称'));
  assert.ok(!prompt.includes('MarryMea'));
  assert.ok(!prompt.includes('赵泠'));
  const projected = JSON.stringify(publicState(state));
  assert.ok(!projected.includes(token));
  assert.ok(!projected.includes('公开昵称'));
  assert.ok(!projected.includes('MarryMea'));
  assert.ok(!projected.includes('赵泠'));
  const invited = selectedCast(state)[1];
  assert.equal(invited.kind, 'zhihu-author');
  assert.ok(invited.capabilities && invited.capabilities.canEnterRomance === false);
});

test('the invite endpoint never returns credentials or the raw input', () => {
  const route = appSource('api/authors/invite/route.ts');
  assert.ok(route.includes('invitedAuthorCatalogEntry'));
  for (const forbidden of ['accessToken', 'oauthToken', 'accessSecret:']) {
    assert.ok(!route.includes(forbidden), `invite response must not include ${forbidden}`);
  }
  const storyRoute = appSource('api/story/route.ts');
  assert.ok(storyRoute.includes('buildAuthorCatalog'));
  assert.ok(!storyRoute.includes('oauth'), 'story catalogue must not depend on oauth');
});

test('the author chat logs only non-sensitive bookkeeping', () => {
  const chat = source('author-chat.ts');
  const logs = chat.match(/console\.(?:info|warn|error)\([^;]+;/g) || [];
  assert.ok(logs.length > 0);
  for (const entry of logs) {
    assert.ok(!entry.includes('accessToken'));
    assert.ok(!entry.includes('profileUrl'));
    assert.ok(!entry.includes('displayName'));
  }
});
