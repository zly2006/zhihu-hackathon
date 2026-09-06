import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const base = process.env.V33_TEST_DIR || ".tmp/test-all";
async function load(rel) {
  return import(new URL(`../${base}/${rel}`, import.meta.url).href);
}

const now = "2026-09-06T00:00:00.000Z";

function character({
  id,
  name,
  role,
  emotionState = "平静",
  trend,
  goals = [],
  values = ["诚实"],
  traits = ["克制"],
}) {
  return {
    id,
    role,
    identity: {
      name,
      birthYear: role === "npc" ? 2000 : 2001,
      gender: role === "npc" ? "女" : "男",
      hometown: "武汉",
      familyBackground: "普通家庭",
    },
    core: {
      personalityTraits: traits,
      values,
      talents: { insight: 50, charm: 50, grit: 50, learning: 50, luck: 50 },
      hooks: [],
    },
    state: {
      age: role === "npc" ? 26 : 25,
      year: 2026,
      city: "深圳",
      occupation: role === "npc" ? "档案编辑" : "设计师",
      socialIdentity: role === "npc" ? "编辑" : "设计师",
      stats: {
        cash: 50,
        health: 80,
        happiness: 60,
        knowledge: 50,
        connections: 30,
        career: 40,
        assets: 10,
      },
      currentGoals: goals,
      currentDilemmas: [],
      attitudes: {},
    },
    ...(role === "npc"
      ? {
          privateState: {
            hiddenGoals: ["不想被父亲安排"],
            hiddenConcerns: ["担心项目失败"],
            privateBeliefs: ["离开也不等于背叛"],
            currentEmotionalTrend: trend,
          },
        }
      : {}),
    speechStyle: role === "npc" ? "语气平静，先说明观察到的事实" : "先确认事实，再表达感受",
    emotionState,
    memoryIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

function world(options = {}) {
  const hero = character({ id: "hero", name: "陈舟", role: "protagonist" });
  const zhao = character({
    id: "npc-zhao-leng",
    name: "赵冷",
    role: "npc",
    emotionState: options.emotionState ?? "低落",
    trend: options.trend ?? "低落",
    goals: options.goals ?? [
      {
        id: "zhao-goal",
        label: "完成档案项目",
        horizon: "medium",
        priority: 100,
        status: "active",
      },
    ],
    values: ["自主", "诚实"],
    traits: ["克制", "坚定"],
  });
  const relation = {
    id: "hero-zhao",
    characterAId: hero.id,
    characterBId: zhao.id,
    type: "partner",
    scores: {
      closeness: options.closeness ?? 58,
      trust: options.trust ?? 67,
      conflict: options.conflict ?? 24,
      commitment: 50,
    },
    publicSummary: "正在学习坦诚沟通的恋人",
    unresolvedIssues: [],
    milestoneEventIds: [],
    status: "active",
    updatedAt: now,
  };
  return {
    schemaVersion: 1,
    gameId: "v33-demo",
    currentYear: 2026,
    protagonistId: hero.id,
    characters: { [hero.id]: hero, [zhao.id]: zhao },
    relationships: { [relation.id]: relation },
    memories: {},
    chapterIds: options.chapterIds ?? [],
    eraContext: null,
    openThreads: options.openThreads ?? [],
    canonicalEventIds: [],
    updatedAt: now,
  };
}

function decision() {
  return {
    id: "decision-v33",
    promptTitle: "如何回应赵冷的联系",
    context: "赵冷希望谈谈近况。",
    options: [
      {
        id: "A",
        label: "先听她说",
        description: "确认她需要什么",
        strategyTag: "倾听",
        estimatedRisk: 15,
        stateFit: "顺势",
      },
      {
        id: "B",
        label: "替她安排",
        description: "迅速提出方案",
        strategyTag: "主导",
        estimatedRisk: 50,
        stateFit: "可行",
      },
      {
        id: "C",
        label: "另约时间",
        description: "说明当前限制",
        strategyTag: "边界",
        estimatedRisk: 30,
        stateFit: "可行",
      },
    ],
    selectedOptionId: "A",
    normalizedAction: "先听赵冷说她需要什么",
  };
}

test("V3.3: 低落 NPC 会以求助行为发起一次可见主动事件，且不泄漏私密状态", async () => {
  const { planNpcAgentDirectives } = await load("game/npc-agent.js");
  const { planNpcProactiveEvents } = await load("game/npc-proactive-event-policy.js");
  const state = world();
  const directives = planNpcAgentDirectives({
    chapterId: "chapter-1",
    world: state,
    decision: decision(),
    startYear: 2026,
    endYear: 2027,
  });
  const zhaoDirective = directives.find((item) => item.characterId === "npc-zhao-leng");
  assert.equal(zhaoDirective?.action, "seek_support");
  const events = planNpcProactiveEvents({ world: state, directives });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "support_request");
  assert.match(events[0].preview, /不需要你替我决定/);
  assert.ok(!JSON.stringify(events).includes("不想被父亲安排"));
  assert.equal(
    planNpcProactiveEvents({
      world: state,
      directives,
      deliveredDirectiveIds: [events[0].directiveId],
    }).length,
    0,
  );
});

test("V3.3: 主动事件有压力阈值，避免中性 NPC 刷屏", async () => {
  const { planNpcProactiveEvents } = await load("game/npc-proactive-event-policy.js");
  const state = world({ trend: "平静", goals: [] });
  const events = planNpcProactiveEvents({
    world: state,
    directives: [
      {
        id: "quiet",
        chapterId: "c",
        characterId: "npc-zhao-leng",
        action: "contact_player",
        targetCharacterIds: ["hero"],
        relationshipIds: ["hero-zhao"],
        sourceGoalIds: [],
        urgency: 47,
        privateIntent: "不想被父亲安排",
      },
    ],
  });
  assert.deepEqual(events, []);
});

test("V3.3: Narrative Director 的节奏按六拍推进，不会无铺垫直接高潮", async () => {
  const { deriveNarrativePacing } = await load("game/narrative-pacing.js");
  const lowEvent = { id: "e", importance: 35 };
  const phase = (chapterCount, events = [lowEvent]) =>
    deriveNarrativePacing({
      world: world({ chapterIds: Array.from({ length: chapterCount }, (_, index) => `c${index}`) }),
      events,
      tensionLevel: "rising",
    }).phase;
  assert.equal(phase(0), "setup");
  assert.equal(phase(1), "bonding");
  assert.equal(phase(2), "conflict");
  assert.equal(phase(3), "turning_point");
  assert.equal(phase(4), "turning_point");
  assert.equal(phase(4, [{ id: "high", importance: 82 }]), "climax");
  assert.equal(phase(5), "aftermath");
});

test("V3.3: 赵冷 Demo 为原创成年恋爱线，隐藏事件有一次性公开条件门", async () => {
  const { ZHAO_LENG_DEMO, evaluateZhaoLengHiddenEvent, validateZhaoLengDemo } = await load(
    "narrative/zhao-leng-demo.js",
  );
  assert.deepEqual(validateZhaoLengDemo(), []);
  assert.equal(ZHAO_LENG_DEMO.phases.length, 4);
  assert.ok(ZHAO_LENG_DEMO.cast.every((character) => character.age >= 18));
  assert.equal(
    evaluateZhaoLengHiddenEvent({
      relationship: { closeness: 54, trust: 70, conflict: 20 },
      completedBeatIds: ["zl-03-boundary", "zl-09-consequence"],
      observedClueIds: ["library-card"],
      consumedEventIds: [],
    }).status,
    "locked",
  );
  const eligible = evaluateZhaoLengHiddenEvent({
    relationship: { closeness: 58, trust: 67, conflict: 24 },
    completedBeatIds: ["zl-03-boundary", "zl-09-consequence"],
    observedClueIds: ["library-card"],
    consumedEventIds: [],
  });
  assert.equal(eligible.status, "eligible");
  assert.equal(
    evaluateZhaoLengHiddenEvent({
      relationship: { closeness: 58, trust: 67, conflict: 24 },
      completedBeatIds: ["zl-03-boundary", "zl-09-consequence"],
      observedClueIds: ["library-card"],
      consumedEventIds: [eligible.eventId],
    }).status,
    "consumed",
  );
});

test("V3.3: Voice Card 与 Dialogue parser 不暴露私密状态，也不允许场外发言", async () => {
  const { buildDialogueVoiceCards } = await load("game/dialogue-voice-card.js");
  const { buildDialoguePrompt, parseDialogue } = await load("game/dialogue-writer.js");
  const state = world();
  const input = {
    world: state,
    events: [],
    novelScenes: [{ id: "s1", heading: "图书馆", timeLabel: "2026.09", text: "雨声落在窗边。" }],
  };
  const cards = buildDialogueVoiceCards(state);
  assert.match(cards.find((card) => card.characterId === "npc-zhao-leng").voiceSummary, /语气平静/);
  assert.ok(!JSON.stringify(cards).includes("不想被父亲安排"));
  assert.ok(!buildDialoguePrompt(input).includes("不想被父亲安排"));
  assert.throws(
    () =>
      parseDialogue(
        {
          scenes: [
            {
              id: "s1",
              background: "urban-public-cafe-rain-v1",
              characters: [{ characterId: "C1" }],
              blocks: [
                { type: "dialogue", speakerId: "C2", text: "我在场外说话。", emotion: "平静" },
              ],
              choices: [],
            },
          ],
        },
        input,
      ),
    /未出现在 characters/,
  );
  assert.throws(
    () =>
      parseDialogue(
        {
          scenes: [
            {
              id: "s1",
              background: "urban-public-cafe-rain-v1",
              characters: [{ characterId: "C1" }, { characterId: "C2" }],
              blocks: [{ type: "narration", text: "不想被父亲安排" }],
              choices: [],
            },
          ],
        },
        input,
      ),
    /泄漏 NPC 私密状态/,
  );
});

test("V3.3: 叙事预览 API 只输出公开指令和邀请卡，不写入世界状态", () => {
  const route = readFileSync(
    join(process.cwd(), "app", "api", "narrative", "experience", "route.ts"),
    "utf8",
  );
  assert.match(route, /planNpcProactiveEvents/);
  assert.match(route, /toPublicNpcAgentTrace/);
  assert.doesNotMatch(route, /privateIntent/);
  assert.doesNotMatch(route, /reduceWorldState|runWorldSimulator/);
});
