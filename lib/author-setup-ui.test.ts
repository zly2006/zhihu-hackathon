import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {buildAuthorCatalog, invitedAuthorCatalogEntry, registeredAuthorCatalogEntry} from './author-catalogue';
import {AUTHOR_CAST_REGISTRATIONS} from './author-cast';
import {invitedAuthorCapabilitiesFor, fictionalAuthorName} from './author-identity';
import {inviteAuthor} from './author-invite';
import {validateAuthorProfile, type AuthorProfile} from './author-provider';

const page = () => readFileSync(path.join(process.cwd(), 'app', 'page.tsx'), 'utf8');

test('the setup screen starts from a two panel board with the author panel as the primary one', () => {
  const source = page();
  assert.ok(source.includes("useState<'board'|'author'>('board')"), 'the board must be the default view');
  assert.ok(source.includes('className="cast-board"'), 'the board grid must exist');
  assert.ok(source.includes('cast-panel cast-panel-primary'), 'the author panel must be the primary panel');
  assert.ok(source.includes('你可以邀请 AI 答主参与'), 'left panel title');
  assert.ok(source.includes('选择默认 NPC 参与'), 'right panel title');
  assert.ok(source.includes('＋ 邀请其他答主'), 'the invite entry must stay at the bottom of the left panel');
  assert.ok(source.includes("setupFocus==='author'"), 'the author focus view must exist');
  assert.ok(source.includes('className="cast-focus"'), 'the invite view keeps its own container');
  assert.ok(source.includes('← 返回选择'), 'the invite view must be able to return to the board');
});

test('preset npcs are selectable on the board itself and scroll inside their own panel', () => {
  const source = page();
  assert.ok(!source.includes('进入选择'), 'the old two-step npc picker entry must be gone');
  assert.ok(!source.includes('cast-panel-preview'), 'the read-only preview list must be gone');
  assert.ok(source.includes('cast-panel-scroll cast-panel-scroll-presets'), 'the preset panel needs its own scroll container');
  assert.ok(source.includes('{liveCatalog.pool.map((member)=>'), 'all eight presets render on the board');
  assert.ok(source.includes('cast-panel-scroll'), 'panels scroll internally so the footer never moves');
  assert.ok(source.includes('setup-cast-compact'), 'preset rows use the compact card style');
  assert.ok(source.includes('slice(0,3)'), 'the author panel lists three cards and moves the rest into the invite view');
  assert.ok(source.includes('位可邀请与选择'), 'the invite entry hints how many authors are left');
});

test('both panels share one four slot selection and switching focus never clears it', () => {
  const source = page();
  assert.ok(source.includes('function toggleMember(id:string)'), 'one toggle handler for both panels');
  assert.ok(source.includes('const setupMembers:SetupMember[]=[...liveCatalog.authors'), 'one shared member list');
  const focusSwitches = source.match(/setSetupFocus\('(?:board|author)'\)/g) || [];
  assert.ok(focusSwitches.length >= 3);
  for (const handler of focusSwitches) assert.ok(!handler.includes('setSelectedIds'), 'focus changes must not reset selections');
  assert.ok(!source.includes('setSelectedIds([])'), 'selection is only cleared by explicit restart');
});

test('the author cards show the real homepage name, the fictional name and the homepage avatar', () => {
  const source = page();
  assert.ok(source.includes('const label=author.sourceDisplayName?`${author.sourceDisplayName}（${author.name}）`:author.name;'));
  assert.ok(source.includes('AuthorAvatarImage'), 'the homepage avatar component must exist');
  assert.ok(source.includes("src={chatSource.avatarUrl}"), 'the chat header must use the homepage avatar when available');
  assert.ok(source.includes("author.avatarUrl?<AuthorAvatarImage"), 'author cards must use the homepage avatar when available');
});

test('the author panel offers a dashed placeholder instead of inventing extra authors', () => {
  const source = page();
  assert.ok(source.includes('待邀请答主'));
  assert.ok(source.includes('cast-card-placeholder'));
});

test('confirming the cast kicks off background style learning and labels auto styles', () => {
  const source = page();
  assert.ok(source.includes("fetch('/api/authors/style'"), 'the client must queue style learning after confirming the cast');
  assert.ok(source.includes('castIds:authorIds'), 'only author cast members are queued');
  assert.ok(source.includes('语气由公开回答自动归纳（未人工审核）'), 'auto styles must be disclosed in the chat panel');
  assert.ok(source.includes("message.avatar?.styleStatus==='auto'"), 'the disclosure only appears once an auto style is in use');
});

test('the catalogue exposes fictional names, domains, source status and disclosure', () => {
  const registrations = AUTHOR_CAST_REGISTRATIONS.map((registration) => registeredAuthorCatalogEntry(registration, 12));
  const ling = registrations.find((entry) => entry.id === 'ling');
  assert.ok(ling);
  assert.equal(ling.name, '林泠');
  assert.equal(ling.personaStatus, 'fictional');
  assert.equal(ling.corpusStatus, 'evidence-only');
  assert.equal(ling.capabilities.canEnterRomance, true);
  assert.ok(ling.disclosure.includes('虚构'));
  assert.ok(ling.domains.length > 0);
  assert.equal(ling.sourceDisplayName, '赵泠', 'the public source nickname is intentionally visible for attribution');
  assert.equal(ling.profileUrl, 'https://www.zhihu.com/people/MarryMea');
  assert.equal(ling.avatarUrl, '/api/authors/avatar/ling', 'registered avatars go through the server-side cache route');
  assert.ok(!ling.name.includes('赵泠') && !ling.disclosure.includes('赵泠'), 'the fictional persona name must stay fictional');
  for (const entry of registrations) {
    assert.equal(entry.avatarUrl, `/api/authors/avatar/${entry.id}`, entry.id);
  }
});

test('an invited author appears in the catalogue with derived fiction and no romance', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'author-catalogue-synthetic-'));
  try {
    const token = 'synthetic-catalogue-author';
    const profile: AuthorProfile = {
      urlToken: token, profileUrl: `https://www.zhihu.com/people/${token}`, displayName: '公开昵称',
      avatarUrl: 'https://pic1.zhimg.com/synthetic_avatar.jpg',
      headline: '聊聊考研与学习方法', gender: '女', fetchedAt: '2026-03-01T00:00:00.000Z', source: 'web',
    };
    const invited = await inviteAuthor({
      input: token,
      provider: {resolveProfile: async (ref) => validateAuthorProfile(profile, ref), listAnswers: async () => [], searchAnswers: async () => [], readAnswer: async () => {throw new Error('unused');}},
      registryRoot: root,
    });
    const entry = invitedAuthorCatalogEntry(invited.entry, 2);
    assert.equal(entry.name, fictionalAuthorName(token));
    assert.equal(entry.source, 'invited');
    assert.equal(entry.capabilities.canEnterRomance, false);
    assert.equal(invitedAuthorCapabilitiesFor(token).canEnterRomance, false);
    assert.deepEqual(entry.domains, invited.entry.domains);
    assert.equal(entry.corpusStatus, 'evidence-only');
    assert.equal(entry.sourceDisplayName, '公开昵称');
    assert.equal(entry.avatarUrl, `/api/authors/avatar/${entry.id}`, 'invited avatars are proxied from the frozen registry source');
    const catalog = await buildAuthorCatalog(path.join(root, 'avatars'), root);
    assert.ok(catalog.some((item) => item.id === entry.id));
    assert.ok(catalog.some((item) => item.id === 'ling'));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
