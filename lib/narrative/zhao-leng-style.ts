import type { ZhaoLengBeatId } from "../domain/zhao-leng-runtime";

export type ZhaoLengStyleReference = {
  sourceId: "frag-153" | "frag-156" | "frag-1" | "frag-141";
  title: string;
  technique: string;
  usage: string;
};

const REFERENCES: readonly ZhaoLengStyleReference[] = Object.freeze([
  {
    sourceId: "frag-153",
    title: "动作先于判断",
    technique: "用一个可观察的小动作承载关系张力，再让人物说出当下事实。",
    usage: "适合开场与边界场景，避免替角色解释内心。",
  },
  {
    sourceId: "frag-156",
    title: "留白中的具体回应",
    technique: "让停顿、改口或重新安排时间成为回应的一部分。",
    usage: "适合冲突后的反馈，保留代价与未完成事项。",
  },
  {
    sourceId: "frag-1",
    title: "事实与感受分层",
    technique: "先交代能核对的事实，再让人物承担自己的感受和选择。",
    usage: "适合档案、争执和共同计划场景。",
  },
  {
    sourceId: "frag-141",
    title: "具体承诺的边界",
    technique: "把承诺写成时间、范围和可撤回条件，不用漂亮话覆盖不确定性。",
    usage: "适合异地、去留和结局前的谈话。",
  },
]);

function beatIndex(beatId?: ZhaoLengBeatId): number {
  const match = beatId?.match(/^zl-(\d\d)-/);
  return match ? Number(match[1]) : 1;
}
/** Return abstract craft cards only; never return source excerpts. */
export function buildZhaoLengStyleReferences(input: { beatId?: ZhaoLengBeatId } = {}): ZhaoLengStyleReference[] {
  const index = beatIndex(input.beatId);
  const first = REFERENCES[(index - 1) % REFERENCES.length];
  const second = REFERENCES[index % REFERENCES.length];
  return [first, second].filter((item, position, list) => list.findIndex((candidate) => candidate.sourceId === item.sourceId) === position);
}
