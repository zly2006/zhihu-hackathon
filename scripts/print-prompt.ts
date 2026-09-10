import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { castPool, buildModelMessages, initial, totalForState, type CharacterProfile, type Gender, type StartOptions, type State } from '../lib/story';

function argument(name: string) {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function defaultProfiles() {
  return ['m1', 'm3', 'f2', 'f4'].map((id) => {
    const member = castPool.find((candidate) => candidate.id === id);
    if (!member) throw new Error(`默认角色不存在：${id}`);
    return { id: member.id, name: member.name, gender: member.gender };
  }) satisfies CharacterProfile[];
}

function parseProfiles(value?: string) {
  if (!value) return defaultProfiles();
  return value.split(',').map((id) => id.trim()).filter(Boolean).map((id) => {
    const member = castPool.find((candidate) => candidate.id === id);
    if (!member) throw new Error(`角色不存在：${id}`);
    return { id: member.id, name: member.name, gender: member.gender };
  });
}

function renderMessage(index: number, message: ReturnType<typeof buildModelMessages>[number]) {
  const role = message.role.toUpperCase();
  const label = index === 1 ? 'SYSTEM + 输出协议' : index === 2 ? 'USER + 业务上下文' : 'USER + 续写硬约束';
  return `===== MESSAGE ${index} / ${role} / ${label} =====\n${message.content}`;
}

async function readSessionState(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error(`storyId 格式不正确：${id}`);
  return JSON.parse(await readFile(path.join(process.cwd(), '.data', 'sessions', `${id}.json`), 'utf8')) as State;
}

async function main() {
  const storyId = argument('story-id');
  const profileIds = argument('profiles');
  const startOptions: StartOptions = {
    backgroundId: argument('background') || 'university',
    playerName: argument('name') || '许澄',
    playerGender: (argument('gender') as Gender) || '女',
    seed: argument('seed') || 'prompt-preview',
  };
  const outputPath = path.resolve(argument('out') || path.join('.data', 'prompts', 'current-prompt.txt'));
  const state: State = storyId ? await readSessionState(storyId) : initial(parseProfiles(profileIds), startOptions);

  if (!state) throw new Error(`没有找到故事存档：${storyId}`);

  const modelMessages = buildModelMessages(state);
  const output = [
    '当前实际发送给模型的提示词',
    `生成时间：${new Date().toISOString()}`,
    `故事来源：${storyId ? `storyId=${storyId}` : '新开局默认角色'}`,
    `剧情阶段：${state.nodes.length + 1} / ${totalForState(state)}`,
    `消息数量：${modelMessages.length}`,
    '说明：下方内容与 generate() 实际发送的 messages 一致，仅省略 HTTP 请求头和认证信息。',
    '',
    ...modelMessages.map((message, index) => renderMessage(index + 1, message)),
    '',
  ].join('\n');

  if (process.argv.includes('--stdout')) {
    process.stdout.write(output);
  } else {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, output, 'utf8');
    console.log(`提示词已生成：${outputPath}`);
    console.log(`剧情阶段：${state.nodes.length + 1} / ${totalForState(state)}`);
    console.log(`消息数量：${modelMessages.length}`);
    console.log(`提示词字符数：${output.length}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
