import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const sourcePath = path.join(root, 'drafts', '苏晚线_十到十五分钟完整剧本.txt');
const configPath = path.join(root, 'lib', 'story-config.json');
const outputPath = path.join(root, 'lib', 'story-reference.json');
const checkOnly = process.argv.includes('--check');

const count = (text) => [...text].filter((char) => /[\p{L}\p{N}]/u.test(char)).length;
const countRecords = (records) => count(records.map((record) => {
  const narration = record.match(/^\[旁白\]（(happy|normal|playful|surprised|thinking)）\s+(.+)$/u);
  if (narration) return narration[2];
  return record.match(/^\[[^\]]+\]（(happy|normal|playful|surprised|thinking)）\s+「(.+)」$/u)?.[2] || '';
}).join(''));
const source = await fs.readFile(sourcePath, 'utf8');
const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
const beats = config.BEATS.map((beat) => beat.id);
const lines = source.split(/\r?\n/);
const segments = [];

for (let index = 0; index < lines.length; index += 1) {
  const heading = lines[index].match(/^(0[1-9])\s+(.+)$/);
  if (!heading) continue;

  let bodyStart = index + 1;
  while (bodyStart < lines.length && lines[bodyStart] !== '========== 正文 ==========') bodyStart += 1;
  if (bodyStart === lines.length) throw new Error(`${heading[0]} 缺少正文开始标记。`);

  const body = [];
  for (let cursor = bodyStart + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor].trim();
    if (/^0[1-9]\s+/.test(line) || line === '全剧终') break;
    if (!line.startsWith('[')) continue;
    if (!/^\[旁白\]（(happy|normal|playful|surprised|thinking)）\s+.+$/u.test(line) && !/^\[[^\]]+\]（(happy|normal|playful|surprised|thinking)）\s+「.+」$/u.test(line)) {
      throw new Error(`${heading[0]} 存在不符合范本格式的正文行：${line}`);
    }
    body.push(line);
  }

  const stageKey = beats[segments.length];
  if (!stageKey) throw new Error(`范本段落数量超过 BEATS 数量：${heading[0]}`);
  segments.push({
    id: `reference-${heading[1]}`,
    order: Number(heading[1]),
    stageKey,
    heading: `${heading[1]} ${heading[2]}`,
    text: body.join('\n'),
    effective_chars: countRecords(body),
  });
}

if (segments.length !== beats.length) throw new Error(`范本需要 ${beats.length} 段，实际为 ${segments.length} 段。`);
const allowedExpressions = ['happy', 'normal', 'playful', 'surprised', 'thinking'];
const expressions = [...source.matchAll(/\[[^\]]+\]（(happy|normal|playful|surprised|thinking)）/gu)].map((match) => match[1]);
if (new Set(expressions).size !== allowedExpressions.length || allowedExpressions.some((expression) => !expressions.includes(expression))) {
  throw new Error(`范本必须覆盖全部表情：${allowedExpressions.join(', ')}`);
}

const output = {
  version: 1,
  title: lines.find((line) => line.trim())?.trim() || '未命名范本',
  source: 'drafts/苏晚线_十到十五分钟完整剧本.txt',
  note: '完整中文校园恋爱范本。用于学习事件因果、人物关系连续性和对白节奏，不得复制人物姓名、场景或原句。',
  segments,
};
const rendered = `${JSON.stringify(output, null, 2)}\n`;

if (checkOnly) {
  const current = await fs.readFile(outputPath, 'utf8').catch(() => '');
  if (current !== rendered) {
    console.error('lib/story-reference.json 与范本 TXT 不同步，请运行 node scripts/build-story-reference.mjs。');
    process.exitCode = 1;
  } else {
    console.log('lib/story-reference.json 已与范本 TXT 同步。');
  }
} else {
  await fs.writeFile(outputPath, rendered, 'utf8');
  console.log(`已写入 ${path.relative(root, outputPath)}，共 ${segments.length} 段。`);
}
