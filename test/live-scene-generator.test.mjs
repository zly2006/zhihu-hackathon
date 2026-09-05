import assert from "node:assert/strict";
import test from "node:test";

const buildDir = process.env.V3_TEST_DIR || ".tmp/test-all";
async function load(file) {
  return import(new URL(`../${buildDir}/game/${file}.js`, import.meta.url).href);
}

async function loadFixture() {
  return import(new URL("./fixtures/scene-runtime-fixture.mjs", import.meta.url).href);
}

function chapterContext() {
  return {
    id: "test-chapter-live",
    index: 0,
    startYear: 2026,
    endYear: 2026,
    span: 1,
    decision: {
      id: "decision-test",
      promptTitle: "测试困境",
      context: "测试主角需要回应一段尚未说清楚的关系分歧。",
      options: [
        { id: "A", label: "先听完", description: "先听完再回应", strategyTag: "沟通", estimatedRisk: 20, stateFit: "顺势" },
        { id: "B", label: "暂时回避", description: "暂时不回应", strategyTag: "回避", estimatedRisk: 40, stateFit: "可行" },
        { id: "C", label: "说明边界", description: "说清楚边界", strategyTag: "边界", estimatedRisk: 30, stateFit: "可行" },
      ],
      selectedOptionId: "A",
      normalizedAction: "先听完",
    },
    summary: {
      keyEvents: ["测试事件已经发生"],
      characterChanges: [],
      relationshipChanges: ["测试关系等待回应"],
      openThreads: [],
    },
  };
}

function validDraft(ids, overrides = {}) {
  return {
    scenes: [
      {
        id: "scene-1",
        background: "urban-public-cafe-rain-v1",
        timeLabel: "此刻 · 临窗咖啡馆",
        characters: [
          { id: ids.protagonist, position: "center", emotion: "犹豫" },
          { id: ids.first, position: "left", emotion: "克制" },
        ],
        blocks: [
          { type: "narration", text: "雨声把两个人之间的停顿拉得更长。" },
          { type: "dialogue", speakerId: ids.first, text: "我想先听听你的想法。", emotion: "克制" },
          {
            type: "choice",
            text: "你准备怎样回应？",
            choices: [
              { id: "A", label: "先听完，再说自己能做到什么", ruleId: "listen_without_promise", targetCharacterId: ids.first, requirements: [], next: "scene-2" },
              { id: "B", label: "暂时回避这次谈话", ruleId: "avoid_conversation", targetCharacterId: ids.first, requirements: [], next: "scene-2" },
              { id: "C", label: "说明自己的边界", ruleId: "clarify_boundary", targetCharacterId: ids.first, requirements: [], next: "scene-2" },
            ],
          },
        ],
        defaultNext: "scene-2",
      },
      {
        id: "scene-2",
        background: "urban-home-apartment-night-v1",
        timeLabel: "此刻 · 回到住处",
        characters: [
          { id: ids.protagonist, position: "center", emotion: "平静" },
          { id: ids.first, position: "left", emotion: "认真" },
        ],
        blocks: [
          { type: "dialogue", speakerId: ids.protagonist, text: "那就把下一步说具体。", emotion: "平静" },
          {
            type: "choice",
            text: "你要把这次谈话带向哪里？",
            choices: [
              { id: "A", label: "坦诚说明目前能承担的部分", ruleId: "honest_talk", targetCharacterId: ids.first, requirements: [], next: "ending-together" },
              { id: "B", label: "尊重彼此的距离", ruleId: "respect_distance", targetCharacterId: ids.first, requirements: [], next: "ending-apart" },
              { id: "C", label: "把谈话留到以后", ruleId: "avoid_conversation", targetCharacterId: ids.first, requirements: [], next: "ending-apart" },
            ],
          },
        ],
        defaultNext: "chapter_end",
      },
    ],
    endings: [
      { id: "ending-together", title: "把话说具体", summary: "双方把下一步变成了可检查的安排。" },
      { id: "ending-apart", title: "保留彼此空间", summary: "双方承认差异，暂时保留各自的空间。" },
    ],
    ...overrides,
  };
}

test("live scene prompt exposes current public state but omits NPC private state", async () => {
  const { buildLiveScenePrompt } = await load("live-scene-generator");
  const fixture = await loadFixture();
  const world = fixture.makeWorld();
  world.characters[fixture.IDS.first].privateState = {
    hiddenGoals: ["不得把这句秘密送进模型输出"],
    hiddenConcerns: ["不得泄露的担忧"],
    privateBeliefs: ["不得泄露的信念"],
  };
  const prompt = buildLiveScenePrompt({
    world,
    events: [],
    chapter: chapterContext(),
  });
  assert.match(prompt, /2026/);
  assert.match(prompt, /test-character-a/);
  assert.match(prompt, /listen_without_promise/);
  assert.doesNotMatch(prompt, /不得把这句秘密送进模型输出/);
  assert.doesNotMatch(prompt, /不得泄露的担忧/);
  assert.doesNotMatch(prompt, /不得泄露的信念/);
});

test("live scene generator returns a current-year executable package with canonical ids", async () => {
  const [{ generateLiveScenePackage }, fixture] = await Promise.all([
    load("live-scene-generator"),
    loadFixture(),
  ]);
  const world = fixture.makeWorld();
  const pkg = await generateLiveScenePackage({
    world,
    events: [],
    chapter: chapterContext(),
    version: 1,
  }, {
    model: async () => validDraft(fixture.IDS),
  });
  assert.equal(pkg.id, "live-test-chapter-live-v1");
  assert.equal(pkg.chapterId, "test-chapter-live");
  assert.equal(pkg.scenes.every((scene) => scene.mode === "live" && scene.year === 2026), true);
  assert.equal(pkg.scenes[0].id, "live-test-chapter-live-v1:scene:1");
  const firstChoice = pkg.scenes[0].blocks.at(-1).content.choices;
  assert.equal(firstChoice.length, 3);
  assert.equal(firstChoice[0].ruleId, "listen_without_promise");
  assert.equal(firstChoice[0].next.sceneId, "live-test-chapter-live-v1:scene:2");
  assert.equal(pkg.scenes[1].blocks[1].content.choices[0].next.endingId, "live-test-chapter-live-v1:ending:1");
});

test("live scene generation retries with the concrete validator failure", async () => {
  const [{ generateLiveScenePackage }, fixture] = await Promise.all([
    load("live-scene-generator"),
    loadFixture(),
  ]);
  const prompts = [];
  let attempts = 0;
  const result = await generateLiveScenePackage({
    world: fixture.makeWorld(),
    events: [],
    chapter: chapterContext(),
  }, {
    maxAttempts: 2,
    model: async (_purpose, _system, prompt) => {
      prompts.push(prompt);
      attempts += 1;
      if (attempts === 1) return validDraft(fixture.IDS, {
        scenes: [{
          ...validDraft(fixture.IDS).scenes[0],
          blocks: validDraft(fixture.IDS).scenes[0].blocks.map((block) =>
            block.type === "choice"
              ? { ...block, choices: block.choices.map((choice) => ({ ...choice, ruleId: choice.id === "A" ? "unregistered-rule" : choice.ruleId })) }
              : block,
          ),
        }, validDraft(fixture.IDS).scenes[1]],
      });
      return validDraft(fixture.IDS);
    },
  });
  assert.equal(attempts, 2);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /unknown_rule|未注册|ruleId/);
  assert.equal(result.scenes.length, 2);
});
