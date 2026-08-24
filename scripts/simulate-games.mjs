import fs from "node:fs";
import path from "node:path";

const endpoint = new URL("/api/event", process.env.SIMULATION_BASE_URL || "http://127.0.0.1:15181");
const totalGames = Number(process.env.SIMULATION_GAMES || 100);
const concurrency = Number(process.env.SIMULATION_CONCURRENCY || 4);
const maxEvents = Number(process.env.SIMULATION_MAX_EVENTS || Number.POSITIVE_INFINITY);
const outputDirectory = process.env.SIMULATION_OUTPUT_DIR || path.join(process.cwd(), ".tmp");
const effectKeys = ["cash", "health", "happiness", "knowledge", "connections", "career", "assets"];
let totalRequests = 0;
let totalFailures = 0;

if (!Number.isInteger(totalGames) || totalGames < 2 || totalGames % 2 !== 0) {
  throw new Error("SIMULATION_GAMES 必须是大于零的偶数，以便均分 1 年和 3 年精度");
}

fs.mkdirSync(outputDirectory, { recursive: true });
const startedAt = new Date();
const outputFile = path.join(
  outputDirectory,
  `restart-life-simulation-${startedAt.toISOString().replace(/[:.]/g, "-")}.jsonl`,
);
const output = fs.createWriteStream(outputFile, { flags: "wx", mode: 0o600 });

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 2 ** 32;
  };
}

function profileFor(gameIndex, precision) {
  const families = ["拮据家庭", "普通工薪", "小康家庭", "富裕家庭"];
  const hometowns = ["武汉", "西安", "成都", "哈尔滨", "泉州", "贵阳"];
  const random = seededRandom(gameIndex + precision * 10_000);
  const talents = {};
  for (const key of ["insight", "charm", "grit", "learning", "luck"]) {
    talents[key] = 1 + Math.floor(random() * 5);
  }
  return {
    name: `自动玩家${gameIndex + 1}`,
    birthYear: 1975 + Math.floor(random() * 30),
    gender: gameIndex % 2 ? "男" : "女",
    hometown: hometowns[gameIndex % hometowns.length],
    family: families[gameIndex % families.length],
    precision,
    talents,
  };
}

function initialState(profile) {
  const familyBonus = { 拮据家庭: 8, 普通工薪: 18, 小康家庭: 32, 富裕家庭: 48 };
  const cash = familyBonus[profile.family] || 18;
  return {
    age: 0,
    cash,
    health: 68 + profile.talents.grit * 2,
    happiness: 52 + profile.talents.charm,
    knowledge: 8 + profile.talents.learning * 2,
    connections: 8 + profile.talents.charm * 2,
    career: 2,
    assets: Math.max(0, cash - 12),
  };
}

function projectedLifeEndAge(state, profile) {
  const health = (state.health - 50) * 0.22;
  const happiness = (state.happiness - 50) * 0.07;
  const security = (state.cash - 30) * 0.035 + (state.assets - 30) * 0.025;
  const talents = profile.talents.grit * 0.8 + profile.talents.luck * 0.4;
  return Math.max(62, Math.min(100, Math.round(77 + health + happiness + security + talents)));
}

function resourceContext(state) {
  return {
    developmentConversion: Math.max(
      0.35,
      (state.cash < 10 ? 0.6 : state.cash < 25 ? 0.8 : 1) *
        (state.health < 15 ? 0.55 : state.health < 35 ? 0.78 : 1),
    ),
  };
}

function effectiveRisk(state, profile, option) {
  const penalty = (cost, available, critical, strained) => {
    if (cost <= 0) return 0;
    return Math.min(
      18,
      Math.round(
        (cost / Math.max(available, 1)) * 10 +
          cost * 0.6 +
          (available < critical ? 4 : available < strained ? 2 : 0),
      ),
    );
  };
  const cashPenalty = penalty(Math.max(0, -Number(option.effects.cash || 0)), state.cash, 10, 25);
  const healthPenalty = penalty(
    Math.max(0, -Number(option.effects.health || 0)),
    state.health,
    15,
    35,
  );
  const fit = option.stateFit === "顺势" ? -6 : option.stateFit === "吃力" ? 8 : 0;
  const protection =
    profile.talents.insight * 0.8 + profile.talents.luck * 0.7 + profile.talents.grit * 0.35;
  return Math.round(
    Math.max(3, Math.min(95, option.baseRisk + cashPenalty + healthPenalty + fit - protection)),
  );
}

function settle(state, profile, option, random) {
  const effects = Object.fromEntries(
    effectKeys.map((key) => [key, Number(option.effects[key] || 0)]),
  );
  const context = resourceContext(state);
  if (effects.knowledge > 0) effects.knowledge *= context.developmentConversion;
  if (effects.career > 0) effects.career *= context.developmentConversion;
  if (effects.cash > 0 && state.health < 35) effects.cash *= state.health < 15 ? 0.55 : 0.8;
  if (state.cash < 10) effects.happiness -= 3;
  else if (state.cash < 25) effects.happiness -= 1;
  if (state.health < 15) effects.happiness -= 3;
  else if (state.health < 35) effects.happiness -= 1;
  const risk = effectiveRisk(state, profile, option);
  const riskOccurred = random() * 100 < risk;
  if (riskOccurred) {
    effects.cash -= state.cash < 15 ? 1 : 3;
    effects.health -= state.health < 18 ? 1 : 2;
    effects.happiness -= 2;
    effects.career -= option.strategyTag === "增加收入" ? 1 : 0;
  }
  if (state.cash + effects.cash <= 0) {
    effects.happiness -= 5;
    effects.connections -= 2;
    effects.career -= 3;
  }
  if (state.health + effects.health <= 0) {
    effects.happiness -= 6;
    effects.career -= 4;
  }
  for (const key of effectKeys)
    effects[key] = Math.max(-12, Math.min(12, Math.round(effects[key])));
  return { effects, risk, riskOccurred };
}

function chooseOption(event, state, profile, gameIndex, seenStrategies, random) {
  const policy = gameIndex % 4;
  const scored = event.options.map((option) => {
    const risk = effectiveRisk(state, profile, option);
    const novelty = seenStrategies.has(option.strategyTag) ? 0 : 8;
    const survival =
      Number(option.effects.cash || 0) * (state.cash < 25 ? 2 : 0.5) +
      Number(option.effects.health || 0) * (state.health < 35 ? 2 : 0.6);
    const growth =
      Number(option.effects.knowledge || 0) +
      Number(option.effects.connections || 0) +
      Number(option.effects.career || 0) +
      Number(option.effects.assets || 0);
    return { option, risk, score: novelty + survival + growth - risk * 0.12 + random() };
  });
  if (policy === 0) return scored.sort((left, right) => left.risk - right.risk)[0].option;
  if (policy === 1) return scored.sort((left, right) => right.score - left.score)[0].option;
  if (policy === 2) return scored.sort((left, right) => right.risk - left.risk)[0].option;
  return scored[Math.floor(random() * scored.length)].option;
}

async function requestEvent(profile, state, history) {
  totalRequests += 1;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ profile, state, history }),
  });
  const body = await response.text();
  const events = body
    .split("\n\n")
    .filter(Boolean)
    .map((block) => ({
      event: block.match(/^event: (.+)$/m)?.[1],
      data: JSON.parse(block.match(/^data: (.+)$/m)?.[1] || "{}"),
    }));
  const complete = events.find((item) => item.event === "complete")?.data;
  if (!complete) {
    const message = events.find((item) => item.event === "error")?.data?.message;
    throw new Error(message || `事件接口没有 complete，HTTP ${response.status}`);
  }
  return complete;
}

function settlementMessage(option, result, nextState) {
  const changes = Object.entries(result.effects)
    .map(([key, value]) => `${key}${Number(value) >= 0 ? "+" : ""}${value}`)
    .join("，");
  return [
    `玩家选择：${option.label}`,
    `程序结算结果：${option.result}${result.riskOccurred ? ` 风险兑现：${option.setback}` : ""}`,
    `状态变化：${changes}`,
    `结算后状态：年龄${nextState.age}，现金${nextState.cash}，健康${nextState.health}，幸福${nextState.happiness}，知识${nextState.knowledge}，人脉${nextState.connections}，事业${nextState.career}，资产${nextState.assets}`,
  ].join("\n");
}

async function playGame(gameIndex) {
  const precision = gameIndex < totalGames / 2 ? 1 : 3;
  const profile = profileFor(gameIndex, precision);
  const random = seededRandom(80_000 + gameIndex);
  let state = initialState(profile);
  let history = [];
  let requests = 0;
  let failures = 0;
  const events = [];
  const seenStrategies = new Set();
  while (
    state.age < projectedLifeEndAge(state, profile) &&
    state.age < 100 &&
    events.length < maxEvents
  ) {
    let event;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      requests += 1;
      try {
        event = await requestEvent(profile, state, history);
        break;
      } catch (error) {
        failures += 1;
        totalFailures += 1;
        if (attempt === 2) throw error;
      }
    }
    const option = chooseOption(event, state, profile, gameIndex, seenStrategies, random);
    seenStrategies.add(option.strategyTag);
    const settled = settle(state, profile, option, random);
    const before = { ...state };
    for (const key of effectKeys) {
      state[key] = Math.max(0, Math.min(100, state[key] + Number(settled.effects[key] || 0)));
    }
    events.push({
      age: state.age,
      title: event.title,
      background: event.background,
      dilemma: event.dilemma,
      choice: option.label,
      strategyTag: option.strategyTag,
      risk: settled.risk,
      riskOccurred: settled.riskOccurred,
      effects: settled.effects,
      options: event.options.map(({ label, description, strategyTag, baseRisk, effects }) => ({
        label,
        description,
        strategyTag,
        baseRisk,
        effects,
      })),
      before,
      after: { ...state },
      cacheHitTokens: event.generationMetrics?.promptCacheHitTokens || 0,
      cacheMissTokens: event.generationMetrics?.promptCacheMissTokens || 0,
    });
    let nextHistory = [
      ...history,
      {
        age: state.age,
        year: profile.birthYear + state.age,
        title: event.title,
        choice: option.label,
        result: option.result,
        effects: settled.effects,
        eventId: event.id,
        experienceIds: option.experienceIds,
        eventExperienceIds: event.experiences.map((experience) => experience.id),
        selectedOptionId: option.id,
        modelConversation: [
          ...event.modelConversation,
          { role: "user", content: settlementMessage(option, settled, state) },
        ],
        eventSnapshot: {
          background: event.background,
          dilemma: event.dilemma,
          detail: event.detail,
          options: event.options.map(
            ({ id, label, description, experienceIds, strategyTag, stateFit, stateReason }) => ({
              id,
              label,
              description,
              experienceIds,
              strategyTag,
              stateFit,
              stateReason,
            }),
          ),
        },
      },
    ];
    if (nextHistory.length % 8 === 0) {
      nextHistory = nextHistory.map(({ modelConversation: _compacted, ...entry }) => entry);
    }
    history = nextHistory;
    state = { ...state, age: Math.min(100, state.age + precision) };
  }
  return {
    type: "game",
    gameIndex,
    precision,
    profile: { ...profile, name: undefined },
    requests,
    failures,
    eventCount: events.length,
    finalState: state,
    distinctStrategies: seenStrategies.size,
    averageRisk: events.reduce((sum, event) => sum + event.risk, 0) / events.length,
    floorCounts: Object.fromEntries(
      effectKeys.map((key) => [key, events.filter((event) => event.after[key] === 0).length]),
    ),
    ceilingCounts: Object.fromEntries(
      effectKeys.map((key) => [key, events.filter((event) => event.after[key] === 100).length]),
    ),
    events,
  };
}

const results = [];
let nextGame = 0;
async function worker() {
  while (nextGame < totalGames) {
    const gameIndex = nextGame;
    nextGame += 1;
    try {
      const result = await playGame(gameIndex);
      results.push(result);
      output.write(`${JSON.stringify(result)}\n`);
      process.stdout.write(
        `${results.length}/${totalGames} precision=${result.precision} events=${result.eventCount} failures=${result.failures}\n`,
      );
    } catch (error) {
      const result = {
        type: "game_error",
        gameIndex,
        precision: gameIndex < totalGames / 2 ? 1 : 3,
        message: error instanceof Error ? error.message : String(error),
      };
      results.push(result);
      output.write(`${JSON.stringify(result)}\n`);
      process.stdout.write(`${results.length}/${totalGames} game_error=${result.gameIndex}\n`);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
const games = results.filter((result) => result.type === "game");
const summary = {
  type: "summary",
  startedAt: startedAt.toISOString(),
  endedAt: new Date().toISOString(),
  endpoint: endpoint.origin,
  requestedGames: totalGames,
  completedGames: games.length,
  precisionCounts: Object.fromEntries(
    [1, 3].map((precision) => [
      precision,
      games.filter((game) => game.precision === precision).length,
    ]),
  ),
  requests: totalRequests,
  failures: totalFailures,
};
summary.failureRate = summary.requests ? summary.failures / summary.requests : 1;
output.write(`${JSON.stringify(summary)}\n`);
await new Promise((resolve) => output.end(resolve));
console.log(JSON.stringify({ outputFile, ...summary }, null, 2));
if (games.length !== totalGames || summary.failureRate >= 0.01) process.exitCode = 1;
