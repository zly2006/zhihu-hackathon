import assert from "node:assert/strict";

const buildDir = process.env.ZHAO_LENG_WRITER_TEST_DIR || ".tmp/test-all";

async function load(path) {
  return import(new URL(`../${buildDir}/${path}.js`, import.meta.url));
}

function validBeat(beatId) {
  const line = (text, speakerId = "npc-zhao-leng") => ({
    type: "dialogue",
    speakerId,
    text,
    emotion: "克制",
  });
  return {
    beatId,
    opening: [{ type: "narration", text: "雨声停在窗沿。" }, line("先把事实说清楚。")],
    feedback: {
      A: [line("我听见了。")],
      B: [line("我们可以再核对一次。")],
      C: [line("那就先停在这里。")],
    },
  };
}

const [demo, writer] = await Promise.all([
  load("game/zhao-leng-demo"),
  load("game/zhao-leng-writer"),
]);

const save = demo.createZhaoLengDemoSave({
  mode: "scripted",
  currentYear: 2026,
  now: "2026-01-01T00:00:00.000Z",
});

const refs = writer.buildZhaoLengStyleReferences({ beatId: "zl-03-boundary" });
assert.ok(refs.length >= 1 && refs.length <= 2);
assert.deepEqual(
  refs.map((item) => item.sourceId),
  refs.map((item) => item.sourceId).filter((sourceId) => ["frag-153", "frag-156", "frag-1", "frag-141"].includes(sourceId)),
);
assert.ok(refs.every((item) => !Object.hasOwn(item, "excerpt") && !Object.hasOwn(item, "text")));

const prompt = writer.buildZhaoLengWriterPrompt({ save, beatId: "zl-03-boundary" });
assert.match(prompt, /zl-03-boundary/);
assert.match(prompt, /赵冷/);
assert.doesNotMatch(prompt, /privateState|hiddenGoals|hiddenConcerns|privateBeliefs/);
assert.doesNotMatch(prompt, /不希望自己的选择被亲近的人代替/);

const parsed = writer.parseZhaoLengWrittenBeat(validBeat("zl-03-boundary"), {
  save,
  beatId: "zl-03-boundary",
});
assert.equal(parsed.beatId, "zl-03-boundary");
assert.equal(parsed.feedback.A.length, 1);

assert.throws(
  () => writer.parseZhaoLengWrittenBeat({ ...validBeat("zl-03-boundary"), worldState: {} }, { save, beatId: "zl-03-boundary" }),
  /禁止|结算字段/,
);
assert.throws(
  () => writer.parseZhaoLengWrittenBeat({ ...validBeat("zl-03-boundary"), opening: [{ type: "dialogue", speakerId: "npc-secret", text: "x", emotion: "平静" }] }, { save, beatId: "zl-03-boundary" }),
  /speakerId|说话者|角色/,
);
assert.throws(
  () => writer.parseZhaoLengWrittenBeat({ ...validBeat("zl-03-boundary"), opening: [{ type: "narration", text: "不希望自己的选择被亲近的人代替" }] }, { save, beatId: "zl-03-boundary" }),
  (error) => error instanceof Error && /未公开|隐私|泄漏/.test(error.message) && !error.message.includes("不希望自己的选择被亲近的人代替"),
);

let modelCalls = 0;
const prompts = [];
const generated = await writer.generateZhaoLengBeat(
  { save, beatId: "zl-03-boundary", mode: "llm" },
  {
    maxAttempts: 3,
    model: async (_purpose, _system, nextPrompt) => {
      modelCalls += 1;
      prompts.push(nextPrompt);
      return modelCalls === 1
        ? { ...validBeat("zl-03-boundary"), feedback: { A: [], B: [], C: [] } }
        : validBeat("zl-03-boundary");
    },
  },
);
assert.equal(generated.beatId, "zl-03-boundary");
assert.equal(modelCalls, 2);
assert.match(prompts[1], /程序校验反馈|重新输出/);

let transportCalls = 0;
const transportPrompts = [];
await writer.generateZhaoLengBeat(
  { save, beatId: "zl-03-boundary", mode: "llm" },
  {
    maxAttempts: 2,
    model: async (_purpose, _system, nextPrompt) => {
      transportPrompts.push(nextPrompt);
      transportCalls += 1;
      if (transportCalls === 1) {
        const error = new Error("连接中断");
        error.category = "transport";
        error.retryable = true;
        throw error;
      }
      return validBeat("zl-03-boundary");
    },
  },
);
assert.equal(transportPrompts.length, 2);
assert.equal(transportPrompts[1], transportPrompts[0]);
assert.doesNotMatch(transportPrompts[1], /程序校验反馈/);

let fixedModelCalls = 0;
const fixed = await writer.generateZhaoLengBeat(
  { save, beatId: "zl-01-message", mode: "scripted" },
  {
    model: async () => {
      fixedModelCalls += 1;
      return validBeat("zl-01-message");
    },
  },
);
assert.equal(fixedModelCalls, 0);
assert.equal(fixed.beatId, "zl-01-message");
assert.ok(fixed.opening.length > 0);

console.log("zhao-leng-writer: PASS");
