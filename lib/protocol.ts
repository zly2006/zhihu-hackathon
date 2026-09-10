import { z } from 'zod';
import { count, isEndingStage, limits, player, selectedCast, validate, type GameEvent, type State, type StoryNode } from './story';

const line = z.object({ type: z.literal('line'), speaker: z.string(), text: z.string().min(1).max(limits.maxLineChars) }).strict();
const choice = z.object({ text: z.string().min(4).max(30), target: z.string().nullable().optional() }).strict();
const schema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('scene'), title: z.string().min(1).max(25) }).strict(),
  line,
  z.object({ type: z.literal('choices'), items: z.array(choice).max(limits.totalChoiceMax) }).strict(),
  z.object({ type: z.literal('memory'), summary: z.string().max(240), facts: z.array(z.string().max(55)).max(6) }).strict(),
  z.object({ type: z.literal('end') }).strict(),
]);

export class JsonlDecoder {
  private buffer = '';

  push(chunk: string, final = false): string[] {
    this.buffer += chunk;
    if (this.buffer.length > 20000) throw new Error('JSONL记录过长');
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';
    if (final && this.buffer.trim()) {
      lines.push(this.buffer);
      this.buffer = '';
    }
    return lines.map((entry) => entry.trim()).filter(Boolean);
  }
}

export function acceptRecord(raw: string, state: State): { event?: GameEvent; ended?: boolean } {
  const parsed = JSON.parse(raw);
  if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string' && typeof parsed.speaker !== 'string' && typeof parsed.type === 'string' && !['scene', 'line', 'choices', 'memory', 'end'].includes(parsed.type)) {
    parsed.speaker = parsed.type;
    parsed.type = 'line';
  }
  const record = schema.parse(parsed);
  const partial = structuredClone(state.partial || { lines: [] });
  const length = (partial.lines || []).reduce((sum, entry) => sum + count(entry.text), 0);
  let event: GameEvent | undefined;

  if (record.type === 'scene') {
    if (partial.title) throw new Error('已经发送标题，禁止重写已显示内容');
    partial.title = record.title;
    event = { type: 'scene', segment: state.nodes.length + 1, title: record.title, readingSeconds: 0 };
  } else if (record.type === 'line') {
    if (!partial.title || partial.choices) throw new Error('对白顺序错误：标题之后、选项之前才能发送对白');
    const speaker = record.speaker === '我' ? player.name : record.speaker;
    const allowedSpeakers = ['旁白', player.name, ...selectedCast(state).map((member) => member.name)];
    if (!allowedSpeakers.includes(speaker)) throw new Error('说话者必须为旁白或当前所选角色姓名');
    if (length + count(record.text) > limits.maxEffectiveChars) throw new Error(`剩余正文最多${limits.maxEffectiveChars - length}字，不可修改已显示对白`);
    if ((partial.lines || []).length >= 22) throw new Error('对白条数过多');
    event = { type: 'line', index: (partial.lines || []).length, speaker, text: record.text };
    partial.lines = [...(partial.lines || []), { speaker, text: record.text }];
  } else if (record.type === 'choices') {
    if (partial.choices) throw new Error('选项已发送，不得重复');
    const items = record.items.map((item) => ({ ...item, target: item.target ?? null }));
    const draft = { title: partial.title, lines: partial.lines, choices: items, memory: { summary: '', facts: [] } };
    const normalized = validate(draft, state);
    partial.choices = normalized.choices;
    event = { type: 'choices', items: normalized.choices.map((item) => ({ text: item.text })) };
  } else if (record.type === 'memory') {
    if (!partial.choices && !isEndingStage(state.nodes.length)) throw new Error('memory必须在choices之后');
    partial.memory = { summary: record.summary, facts: record.facts };
  } else {
    state.partial = validate(partial, state);
    return { ended: true };
  }

  state.partial = partial;
  return { event };
}

export function finishPartial(state: State): StoryNode {
  const partial = structuredClone(state.partial);
  const normalized = validate(partial, state);
  state.partial = normalized;
  return normalized;
}
