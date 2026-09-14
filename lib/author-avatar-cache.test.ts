import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {cachedOrFetchAvatar, fetchAndCacheAvatar, isAvatarCacheFile, readCachedAvatar, MAX_AVATAR_BYTES} from './author-avatar-cache';

const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const token = 'synthetic-author';

function responseFor(body: Buffer, contentType: string, status = 200): Response {
  return new Response(new Uint8Array(body), {status, headers: {'Content-Type': contentType}});
}

test('the homepage avatar is fetched once and then served from the local cache', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'author-avatar-'));
  let calls = 0;
  const fetchImpl = (async () => {calls += 1; return responseFor(png, 'image/png');}) as unknown as typeof fetch;
  try {
    const first = await fetchAndCacheAvatar({root, urlToken: token, sourceUrl: 'https://pic.example.test/a.jpg', fetchImpl});
    assert.equal(first?.contentType, 'image/png');
    assert.equal(calls, 1);
    const cached = await readCachedAvatar(root, token);
    assert.equal(cached?.bytes.byteLength, png.byteLength);
    const again = await cachedOrFetchAvatar({root, urlToken: token, sourceUrl: 'https://pic.example.test/a.jpg', fetchImpl});
    assert.equal(again?.contentType, 'image/png');
    assert.equal(calls, 1, 'a cached avatar must not trigger another fetch');
    assert.ok(await readFile(path.join(root, token, 'avatar', 'avatar.png')));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('non-images, oversized payloads, failures and unsafe urls are rejected without writing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'author-avatar-guard-'));
  try {
    const html = (async () => responseFor(Buffer.from('<html></html>'), 'text/html')) as unknown as typeof fetch;
    assert.equal(await fetchAndCacheAvatar({root, urlToken: token, sourceUrl: 'https://pic.example.test/a', fetchImpl: html}), null);
    const huge = (async () => responseFor(Buffer.alloc(MAX_AVATAR_BYTES + 1), 'image/png')) as unknown as typeof fetch;
    assert.equal(await fetchAndCacheAvatar({root, urlToken: token, sourceUrl: 'https://pic.example.test/big', fetchImpl: huge}), null);
    const failing = (async () => {throw new Error('network down');}) as unknown as typeof fetch;
    assert.equal(await fetchAndCacheAvatar({root, urlToken: token, sourceUrl: 'https://pic.example.test/err', fetchImpl: failing}), null);
    assert.equal(await fetchAndCacheAvatar({root, urlToken: token, sourceUrl: 'http://pic.example.test/insecure'}), null);
    assert.equal(await cachedOrFetchAvatar({root, urlToken: token}), null, 'a missing source url yields no cache entry');
    assert.equal(await readCachedAvatar(root, token), null);
    assert.equal(isAvatarCacheFile('avatar.png'), true);
    assert.equal(isAvatarCacheFile('../secret.png'), false);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
