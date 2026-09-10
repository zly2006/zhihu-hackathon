import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const endpoint = 'http://127.0.0.1:3000/api/story';
const profiles = [
  { id: 'm1', name: '顾言川', gender: '男' },
  { id: 'm3', name: '沈屿', gender: '男' },
  { id: 'f2', name: '陶晚晴', gender: '女' },
  { id: 'f4', name: '苏棠', gender: '女' },
];
const opening = {
  backgroundId: 'university',
  player: { name: '许澄', gender: '女' },
};

let storyId = null;
let state = null;
const proof = [];

await fs.mkdir('test-output', { recursive: true });
try {
  const saved = JSON.parse(await fs.readFile('test-output/browser-state.json', 'utf8'));
  storyId = saved.storyId || null;
  if (storyId) {
    const response = await fetch(`${endpoint}?storyId=${encodeURIComponent(storyId)}`, { headers: { 'X-Story-Id': storyId } });
    assert.equal(response.status, 200);
    state = (await response.json()).state;
  }
} catch {}

let turn = state?.nodes.length || 0;
while (!state?.complete) {
  const begin = Date.now();
  const body = !state
    ? { action: 'start', profiles, ...opening }
    : state.pending
      ? { storyId, action: 'retry' }
      : { storyId, action: 'choose', choice: 0, expected: state.nodes.length };
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(storyId ? { 'X-Story-Id': storyId } : {}) },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/event-stream/);
  storyId = response.headers.get('X-Story-Id') || storyId;
  assert.ok(storyId, 'every generation response must identify the story');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events = [];
  while (true) {
    const part = await reader.read();
    buffer += decoder.decode(part.value, { stream: !part.done });
    const rows = buffer.split('\n');
    buffer = rows.pop() || '';
    for (const row of rows) {
      if (!row.startsWith('data:')) continue;
      const event = JSON.parse(row.slice(5));
      events.push({ ms: Date.now() - begin, ...event });
      if (event.type === 'line') console.log(`turn ${turn + 1} line ${event.index + 1} @ ${Date.now() - begin}ms`);
      if (event.type === 'done') state = event.state;
    }
    if (part.done) break;
  }

  await fs.writeFile(`test-output/live-${turn + 1}.jsonl`, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
  assert.ok(state && !state.pending, JSON.stringify(events.at(-1)));
  const first = events.find((event) => event.type === 'line');
  const last = events.find((event) => event.type === 'done');
  assert.ok(first && last && first.ms < last.ms, 'first dialogue must precede completion');
  assert.equal(state.nodes.length, turn + 1);
  assert.ok(state.nodes.at(-1).readingSeconds >= 45 && state.nodes.at(-1).readingSeconds <= 60);

  const rereadResponse = await fetch(`${endpoint}?storyId=${encodeURIComponent(storyId)}`, { headers: { 'X-Story-Id': storyId } });
  assert.equal(rereadResponse.status, 200);
  const reread = await rereadResponse.json();
  assert.deepEqual(reread.state, state);

  proof.push({ turn: turn + 1, firstDialogueMs: first.ms, completeMs: last.ms, readingSeconds: state.nodes.at(-1).readingSeconds, route: state.route });
  await fs.writeFile('test-output/live-summary.json', JSON.stringify(proof, null, 2));
  await fs.writeFile('test-output/browser-state.json', JSON.stringify({ storyId }, null, 2));
  console.log(JSON.stringify(proof.at(-1)));
  turn += 1;
}

assert.equal(state.complete, true);
console.log('Complete story route verified through the real storyId SSE path.');
