import { randomInt } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { initial, choose } from '../lib/story';
import { generate } from '../lib/generator';
import type { CharacterProfile, GameEvent, State } from '../lib/story';

const profiles: CharacterProfile[] = [
  { id: 'lin', name: '林见夏', gender: '女' },
  { id: 'tao', name: '陶晚晴', gender: '女' },
  { id: 'shen', name: '沈知遥', gender: '女' },
  { id: 'player', name: '许澄', gender: '男' },
];

const outputDir = path.join(process.cwd(), '.data', 'reviews');
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const transcript: { stage: number; events: GameEvent[]; choice?: { index: number; text: string; target: string | null } }[] = [];

function pickChoice(state: State) {
  const choices = state.nodes.at(-1)?.choices ?? [];
  if (!choices.length) return undefined;
  return choices[randomInt(choices.length)];
}

async function main() {
  const state = initial(profiles);
  while (state.nodes.length < 7) {
    const events: GameEvent[] = [];
    const node = await generate(state, (event) => events.push(event), async () => undefined);
    state.nodes.push(node);
    delete state.partial;
    state.memory = node.memory;
    if (!state.storyTitle) state.storyTitle = node.title;
    state.pending = false;
    transcript.push({ stage: state.nodes.length, events });
    if (state.nodes.length === 7) break;
    const selected = pickChoice(state);
    if (!selected) throw new Error(`第 ${state.nodes.length} 段没有可选项，无法继续`);
    const choices = state.nodes.at(-1)?.choices ?? [];
    const index = choices.indexOf(selected);
    choose(state, index, state.nodes.length);
    transcript.at(-1)!.choice = { index, text: selected.text, target: selected.target };
  }
  await mkdir(outputDir, { recursive: true });
  const jsonl = transcript.flatMap((part) => part.events.map((event) => JSON.stringify({ stage: part.stage, event }))).join('\n') + '\n';
  await writeFile(path.join(outputDir, `${stamp}.jsonl`), jsonl);
  await writeFile(path.join(outputDir, `${stamp}.json`), JSON.stringify({ generatedAt: new Date().toISOString(), state, transcript }, null, 2));
  const readable = state.nodes.map((node, i) => {
    const picked = transcript[i]?.choice;
    return [`## 第 ${i + 1} 段：${node.title}`, ...node.lines.map((line) => `[${line.speaker}] ${line.text}`), '', picked ? `【自动选择】${picked.text} -> ${picked.target ?? '个人线'}` : '【结局】'].join('\n');
  }).join('\n\n');
  const txtPath = path.join(outputDir, `${stamp}.txt`);
  await writeFile(txtPath, `自动回放剧本\n标题：${state.storyTitle ?? '未生成'}\n路线：${state.route ?? '未锁定'}\n\n${readable}\n`);
  const mdPath = path.join(outputDir, `${stamp}.md`);
  await writeFile(mdPath, `# 自动回放剧本\n\n标题：${state.storyTitle ?? '未生成'}\n\n${readable}\n`);
  console.log(JSON.stringify({ txt: txtPath, markdown: mdPath, jsonl: path.join(outputDir, `${stamp}.jsonl`), json: path.join(outputDir, `${stamp}.json`), stages: state.nodes.length, route: state.route, title: state.storyTitle }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
