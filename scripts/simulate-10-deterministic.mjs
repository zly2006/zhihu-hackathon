import { randomUUID } from 'node:crypto';
import { initial, validate, choose, beatForState, selectedCast, totalForState, resolveEnding } from '../lib/story.ts';

const profiles = ['m1', 'm3', 'f2', 'f4'].map((id) => ({ id, name: id, gender: id.startsWith('f') ? '女' : '男' }));
const backgrounds = ['high-school', 'university', 'graduate', 'early-career'];

function text(seed, speaker) {
  const body = `在第${seed}次回放里，${speaker}把眼前的困难说得具体而诚实，也给身边的人留下了回应的空间。我们没有急着替任何人下结论，而是先确认时间、资源和彼此真正愿意承担的部分。`;
  return body.slice(0, 33);
}

function makeNode(state, beat, run) {
  const cast = selectedCast(state);
  const speakers = state.nodes.length === 0 ? cast.map((c) => c.name) : ['旁白', cast[run % cast.length].name];
  const lines = speakers.map((speaker, i) => ({ speaker, text: text(`${run}-${state.nodes.length}-${i}`, speaker) }));
  while (lines.length < 8) lines.push({ speaker: '旁白', text: text(`${run}-${state.nodes.length}-${lines.length}`, '旁白') });
  const choices = beat.kind === 'ending'
    ? []
    : beat.kind === 'common'
      ? cast.map((member) => ({ text: `和${member.name}一起把这件事说清楚`, target: member.id }))
      : [
          { text: '先把边界和时间说清楚', target: null },
          { text: '邀请对方一起承担下一步', target: null },
          { text: '给彼此留一晚再决定', target: null },
        ];
  const evidenceIds = beat.kind === 'ending' ? [] : undefined;
  return validate({ title: `第${state.nodes.length + 1}段回放`, lines, choices, ...(evidenceIds ? { evidenceIds } : {}), memory: { summary: '保留事实与关系变化。', facts: ['已完成一次具体沟通'] } }, state);
}

const runs = [];
for (let run = 0; run < 10; run += 1) {
  const state = initial(profiles, { backgroundId: backgrounds[run % backgrounds.length], playerName: `回放${run + 1}`, playerGender: run % 2 ? '男' : '女', seed: `qa-${run}-${randomUUID()}` });
  const started = Date.now();
  const choices = [];
  while (state.nodes.length < totalForState(state)) {
    const beat = beatForState(state);
    const node = makeNode(state, beat, run);
    state.nodes.push(node); state.pending = false; state.memory = node.memory;
    if (beat.kind === 'ending') break;
    const index = beat.kind === 'common' ? run % 4 : run % 3;
    choices.push({ stage: state.nodes.length, index });
    choose(state, index, state.nodes.length);
  }
  runs.push({ run: run + 1, background: state.backgroundId, stages: state.nodes.length, expectedStages: totalForState(state), route: state.route, relationshipType: state.relationshipType, ending: resolveEnding(state), choices, durationMs: Date.now() - started });
}
console.log(JSON.stringify({ runs, pass: runs.every((r) => r.stages === r.expectedStages) }, null, 2));
