# V2.1 Interactive Life Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改动现有 World Simulator/Reducer canonical 链路的前提下，落地 V2.1 Sprint 1 的双模式入口、结构化 Dialogue Engine 和 Character 增强。

**Architecture:** `WorldState`、`ChapterDecision`、`SimulationEvent[]`、Novel Writer、Narrative Engine 和 Reflection Engine 继续作为共享核心。模式只存储在 `GameSave.presentationMode`，由客户端决定表现；Galgame 章节额外调用服务端 Dialogue Writer，将公开角色与 canonical 事件转成可持久化的 `Chapter.dialogue`，失败时回退为 NovelScene 旁白，不阻断章节结算。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript 5.9、Node.js runtime、现有 SSE/LLM 封装、Node `node:test` 冒烟测试、Prettier。

---

## 文件地图

新增：

- `lib/domain/dialogue.ts`：DialogueScene、DialogueBlock、DialogueChoice 领域契约。
- `lib/game/dialogue-writer.ts`：公开上下文、短别名、Prompt、解析、校验、模型调用和降级生成。
- `app/api/chapter/dialogue/route.ts`：Dialogue Writer 的服务端端点。
- `components/life/ModeSelect.tsx`：新建/继续人生的表现模式选择页。
- `test/v21-interactive-life.test.mjs`：模式、角色、对白和页面接线验收。

修改：

- `lib/domain/shared.ts`：增加 `GameMode`。
- `lib/domain/chapter.ts`：增加可选 `Chapter.dialogue` 与 `GameSave.presentationMode`。
- `lib/domain/character.ts`：增加 `CharacterRelationshipHistory`、`speechStyle`、`emotionState`、`relationshipHistory`。
- `lib/game/character-factory.ts`：初始化 Character 增强字段，创建存档时保存模式。
- `lib/game/npc-generator.ts`：兼容并提示 NPC speechStyle。
- `lib/game/world-reducer.ts`：关系变化后为双方累积关系历史。
- `lib/domain/validate.ts`：校验关系历史引用。
- `lib/game/save.ts`：读取旧存档时补默认模式，非法模式回退到 `galgame`。
- `app/api/life/create/route.ts`：接收并保存模式。
- `components/life/LifeApp.tsx`：模式入口、模式分支、Dialogue 请求和 Chapter 组装。
- `components/life/ChapterSummary.tsx`：连续小说模式与逐块 Galgame 模式。
- `components/life/NovelReader.tsx`：增加可选的重写按钮显示开关。
- `scripts/test-all.mjs`：纳入 V2.1 测试套件。

执行约束：继续当前 `dev/mvp-v1-interactive-life` 分支；不触碰 `.env`；不把 `localdata/`、全量语料或数据库内容读入上下文；不新增 npm 依赖。

### Task 1: 先建立 V2.1 红灯测试

**Files:**

- Create: `test/v21-interactive-life.test.mjs`
- Modify: `scripts/test-all.mjs`

- [ ] **Step 1: 写模式、Character 和 Reducer 的失败测试**

在测试文件中先加入下列可执行测试骨架。测试通过 `V21_TEST_DIR` 加载 `test-all.mjs` 已编译的 `game/*.js`，不模拟 LLM。

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const base = process.env.V21_TEST_DIR || ".tmp/v21-test";
async function load(rel) {
  return import(new URL(`../${base}/${rel}`, import.meta.url).href);
}

const now = "2026-09-03T00:00:00.000Z";

function protagonist() {
  return {
    id: "p1",
    role: "protagonist",
    identity: { name: "张明", birthYear: 2008, gender: "男", hometown: "武汉", familyBackground: "工薪" },
    core: {
      personalityTraits: ["谨慎", "务实", "念旧"],
      values: ["稳定", "家庭"],
      talents: { insight: 50, charm: 50, grit: 50, learning: 50, luck: 50 },
      hooks: [],
    },
    state: {
      age: 18,
      year: 2026,
      city: "深圳",
      occupation: "程序员",
      socialIdentity: "程序员",
      stats: { cash: 35, health: 80, happiness: 60, knowledge: 50, connections: 25, career: 15, assets: 5 },
      currentGoals: [{ id: "g1", label: "立足", horizon: "long", priority: 80, status: "active" }],
      currentDilemmas: ["就业压力"],
      attitudes: {},
    },
    memoryIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

function npc() {
  return {
    id: "n1",
    role: "npc",
    identity: { name: "林雨", birthYear: 2006, gender: "女", hometown: "武汉", familyBackground: "普通家庭" },
    core: {
      personalityTraits: ["坚定"],
      values: ["自由"],
      talents: { insight: 50, charm: 50, grit: 50, learning: 50, luck: 50 },
      hooks: [],
    },
    state: {
      age: 20,
      year: 2026,
      city: "深圳",
      occupation: "产品经理",
      socialIdentity: "产品经理",
      stats: { cash: 35, health: 80, happiness: 60, knowledge: 50, connections: 25, career: 40, assets: 5 },
      currentGoals: [],
      currentDilemmas: [],
      attitudes: {},
    },
    privateState: { hiddenGoals: ["不想异地"], hiddenConcerns: ["职业停滞"], privateBeliefs: ["稳定很重要"] },
    memoryIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

function world() {
  const p = protagonist();
  const n = npc();
  const relationship = {
    id: "r1",
    characterAId: p.id,
    characterBId: n.id,
    type: "partner",
    scores: { closeness: 55, trust: 55, conflict: 20, commitment: 45 },
    publicSummary: "正在磨合的恋人",
    unresolvedIssues: [],
    milestoneEventIds: [],
    status: "active",
    updatedAt: now,
  };
  return {
    schemaVersion: 1,
    gameId: "game-1",
    currentYear: 2026,
    protagonistId: p.id,
    characters: { [p.id]: p, [n.id]: n },
    relationships: { [relationship.id]: relationship },
    memories: {},
    chapterIds: [],
    eraContext: null,
    openThreads: [],
    canonicalEventIds: [],
    updatedAt: now,
  };
}

test("V2.1: 新存档保存选择的模式，旧存档缺失或非法模式默认 galgame", async () => {
  const factory = await load("game/character-factory.js");
  const saveModule = await load("game/save.js");
  const save = factory.createInitialGameSave(world(), now, "novel");
  assert.equal(save.presentationMode, "novel");
  assert.equal(saveModule.parseGameSave({ ...save, presentationMode: undefined }).presentationMode, "galgame");
  assert.equal(saveModule.parseGameSave({ ...save, presentationMode: "other" }).presentationMode, "galgame");
});

test("V2.1: 工厂初始化说话风格、表层情绪和空关系历史", async () => {
  const factory = await load("game/character-factory.js");
  const p = factory.createProtagonist({
    name: "张明", birthYear: 2008, gender: "男", hometown: "武汉", familyBackground: "工薪",
    initialCity: "深圳", initialDirection: "程序员", personalityTraits: ["谨慎", "务实", "念旧"],
    values: ["稳定", "家庭"], longTermGoal: "立足", initialDilemma: "就业压力",
    talents: { insight: 50, charm: 50, grit: 50, learning: 50, luck: 50 },
  });
  const n = factory.createNpc({
    name: "林雨", gender: "女", age: 20, relationshipType: "partner", basicSetting: "恋人",
    personalityTraits: ["坚定"], values: ["自由"], hiddenGoal: "不想异地", hiddenConcern: "职业停滞", privateBelief: "稳定很重要",
  }, p.state.year);
  assert.ok(p.speechStyle);
  assert.equal(p.emotionState, "平静");
  assert.deepEqual(p.relationshipHistory, []);
  assert.ok(n.speechStyle);
  assert.equal(n.emotionState, "平静");
  assert.deepEqual(n.relationshipHistory, []);
});

test("V2.1: 关系变化为双方累积最近 12 条历史且不修改原世界", async () => {
  const { reduceWorldState } = await load("game/world-reducer.js");
  const before = world();
  const relationshipChange = {
    relationshipId: "r1",
    scoreDelta: { trust: -3 },
    description: "一次关于去留的争执让双方暂时失去耐心",
  };
  const outputs = Array.from({ length: 13 }, (_, index) => ({
    events: [{
      id: `event-${index}`,
      chapterId: `chapter-${index}`,
      year: 2026 + index,
      order: 1,
      title: `关系事件 ${index}`,
      summary: "关系发生变化",
      domain: "relationship",
      participantIds: ["p1", "n1"],
      causes: [],
      characterChanges: [],
      relationshipChanges: [relationshipChange],
      evidenceIds: [],
      importance: 50,
      visibility: "known_to_protagonist",
      createsThreadIds: [],
      resolvesThreadIds: [],
    }],
    newMemories: [], goalUpdates: [], hookUpdates: [],
    threadUpdates: { create: [], resolveIds: [], dormantIds: [] },
    chapterSummary: { keyEvents: [], characterChanges: [], relationshipChanges: [], unresolvedQuestions: [] },
  }));
  let current = before;
  for (let index = 0; index < outputs.length; index += 1) {
    current = reduceWorldState(current, outputs[index], { chapterId: `chapter-${index}`, endYear: 2026 + index, now, newId: () => `issue-${index}` });
  }
  assert.equal(current.characters.p1.relationshipHistory.length, 12);
  assert.equal(current.characters.n1.relationshipHistory.length, 12);
  assert.equal(before.characters.p1.relationshipHistory, undefined);
  assert.equal(before.characters.n1.relationshipHistory, undefined);
});

test("V2.1: Dialogue Prompt 只包含公开角色和 canonical 事件", async () => {
  const { buildDialoguePrompt } = await load("game/dialogue-writer.js");
  const prompt = buildDialoguePrompt({
    world: world(),
    events: [{ id: "event-1", year: 2027, title: "去留谈话", summary: "双方讨论是否异地", participantIds: ["p1", "n1"], characterChanges: [], relationshipChanges: [] }],
    novelScenes: [{ id: "scene-1", heading: "夜谈", timeLabel: "2027.03", text: "两个人在雨夜谈到未来。" }],
  });
  assert.match(prompt, /去留谈话/);
  assert.match(prompt, /张明/);
  assert.ok(!prompt.includes("privateState"));
  assert.ok(!prompt.includes("不想异地"));
  assert.ok(!prompt.includes("职业停滞"));
  assert.match(prompt, /结构硬约束/);
});

test("V2.1: Dialogue 解析将短别名映射为真实角色并补齐头像", async () => {
  const { parseDialogue } = await load("game/dialogue-writer.js");
  const parsed = parseDialogue({ scenes: [{
    id: "scene-1", background: "urban-home-apartment-night-v1", timeLabel: "2027.03",
    characters: [{ characterId: "C1", position: "left" }, { characterId: "C2", position: "right" }],
    blocks: [
      { type: "narration", text: "雨落在窗上。" },
      { type: "dialogue", speakerId: "C2", text: "你真的决定留下吗？", emotion: "克制" },
    ], choices: [],
  }] }, {
    world: world(),
    events: [{ id: "event-1", year: 2027, title: "去留谈话", summary: "双方讨论是否异地", participantIds: ["p1", "n1"], characterChanges: [], relationshipChanges: [] }],
    novelScenes: [{ id: "scene-1", heading: "夜谈", timeLabel: "2027.03", text: "两个人在雨夜谈到未来。" }],
  });
  assert.equal(parsed[0].characters[0].id, "p1");
  assert.equal(parsed[0].blocks[1].speakerId, "n1");
  assert.equal(parsed[0].blocks[1].speaker, "林雨");
  assert.equal(parsed[0].blocks[1].avatar, undefined);
  assert.equal(parsed[0].choices.length, 0);
});

test("V2.1: Dialogue 解析拒绝幽灵角色和非法块类型", async () => {
  const { parseDialogue } = await load("game/dialogue-writer.js");
  const input = {
    world: world(),
    events: [{ id: "event-1", year: 2027, title: "去留谈话", summary: "双方讨论是否异地", participantIds: ["p1", "n1"], characterChanges: [], relationshipChanges: [] }],
    novelScenes: [{ id: "scene-1", timeLabel: "2027.03", text: "两个人在雨夜谈到未来。" }],
  };
  assert.throws(() => parseDialogue({ scenes: [{ id: "scene-1", background: "urban-home-apartment-night-v1", characters: [], blocks: [{ type: "dialogue", speakerId: "C9", text: "不存在的人", emotion: "冷淡" }], choices: [] }] }, input), /未知角色别名/);
  assert.throws(() => parseDialogue({ scenes: [{ id: "scene-1", background: "urban-home-apartment-night-v1", characters: [], blocks: [{ type: "monologue", text: "非法" }], choices: [] }] }, input), /非法 block type/);
});

test("V2.1: Dialogue 降级结果按 NovelScene 生成注册场景和旁白块", async () => {
  const { buildFallbackDialogueScenes } = await load("game/dialogue-writer.js");
  const result = buildFallbackDialogueScenes({
    world: world(),
    events: [],
    novelScenes: [
      { id: "scene-1", heading: "办公室", timeLabel: "2027.03", text: "你走进办公室。" },
      { id: "scene-2", heading: "雨夜", timeLabel: "2027.08", text: "雨落下来。" },
    ],
  });
  assert.equal(result.length, 2);
  assert.equal(result[0].background, "urban-work-office-day-v1");
  assert.equal(result[1].background, "urban-public-cafe-rain-v1");
  assert.equal(result[0].blocks[0].type, "narration");
  assert.equal(result[0].blocks[0].text, "你走进办公室。");
});

test("V2.1: 页面已接入模式入口、Dialogue API 和 Chapter.dialogue", () => {
  const lifeApp = readFileSync(join(process.cwd(), "components", "life", "LifeApp.tsx"), "utf8");
  const summary = readFileSync(join(process.cwd(), "components", "life", "ChapterSummary.tsx"), "utf8");
  assert.match(lifeApp, /ModeSelect/);
  assert.match(lifeApp, /presentationMode/);
  assert.match(lifeApp, /\/api\/chapter\/dialogue/);
  assert.match(summary, /chapter\.dialogue/);
  assert.match(summary, /presentationMode/);
});
```

- [ ] **Step 2: 将测试接入统一测试入口**

在 `scripts/test-all.mjs` 中沿用现有 `runSuite`/临时编译目录约定，追加
`test/v21-interactive-life.test.mjs`，并设置 `V21_TEST_DIR` 为当前编译目录下的
测试输出目录。保持测试按现有顺序在 phase7 后运行，避免新测试改变既有测试的
输入或全局状态。

- [ ] **Step 3: 运行红灯并确认失败原因**

执行 `node scripts/test-all.mjs`。在生产代码尚未修改时，V2.1 套件应因为缺少
新领域类型、工厂字段、Dialogue Writer 和 UI 接线而失败；既有 phase0、phase1、
phase3、phase4、phase5、phase7 与 reflection-engine 套件必须仍然通过。记录红灯
输出后再进入实现，不通过放宽断言来消除红灯。

### Task 2: 建立兼容旧存档的领域契约

**Files:**

- Modify: `lib/domain/shared.ts`
- Create: `lib/domain/dialogue.ts`
- Modify: `lib/domain/chapter.ts`
- Modify: `lib/domain/character.ts`

- [ ] **Step 1: 增加模式和 Dialogue 领域类型**

在 `lib/domain/shared.ts` 导出 `GameMode = "novel" | "galgame"`。新建
`lib/domain/dialogue.ts`，只放可持久化、无 React/Node 依赖的类型：

```ts
export type DialogueChoiceId = "A" | "B" | "C";
export type DialogueChoice = { id: DialogueChoiceId; label: string };
export type DialogueCharacter = {
  id: CharacterId;
  name: string;
  avatarId?: string;
  avatarUrl?: string;
  position?: "left" | "center" | "right";
  emotion?: string;
};
export type DialogueBlock =
  | { type: "narration"; text: string }
  | { type: "dialogue"; speaker: string; speakerId: CharacterId; text: string; emotion: string; avatar?: string }
  | { type: "choice"; text: string; choices: DialogueChoice[] };
export type DialogueScene = {
  id: string;
  background: string;
  timeLabel?: string;
  characters: DialogueCharacter[];
  blocks: DialogueBlock[];
  choices: DialogueChoice[];
};
```

`DialogueBlock` 的 `speakerId` 必须是现有 Character ID；`background` 保存现有
`scene-catalog` 的场景 ID，不保存不可验证的外部 URL。`choice` 先作为展示保留，
本 Sprint 不把它连接为新的结算入口。

- [ ] **Step 2: 扩展 Chapter 和 Character，不复制现有语义**

在 `Chapter` 增加可选 `dialogue?: DialogueScene[]`，在 `GameSave` 增加可选
`presentationMode?: GameMode`。在 `Character` 增加：

```ts
export type CharacterRelationshipHistory = {
  relationshipId: RelationshipId;
  chapterId: ChapterId;
  year: number;
  relationshipType: RelationshipType;
  summary: string;
};
```

同时增加可选 `speechStyle?: string`、`emotionState?: string`、
`relationshipHistory?: CharacterRelationshipHistory[]`。不增加 `personality`、
`memory`、`secretGoals` 的第二套字段：Dialogue Writer 分别复用
`core.personalityTraits`、`memoryIds`/公开记忆和 `privateState.hiddenGoals` 的
公开边界，提示词中永远不带 privateState。

### Task 3: 初始化、存档兼容和关系历史

**Files:**

- Modify: `lib/game/character-factory.ts`
- Modify: `lib/game/save.ts`
- Modify: `lib/game/world-reducer.ts`
- Modify: `lib/domain/validate.ts`
- Modify: `lib/game/npc-generator.ts`
- Modify: `app/api/life/create/route.ts`

- [ ] **Step 1: 让工厂产生稳定的公开对话字段**

给 `ProtagonistDraft`、`NpcDraft` 增加可选 `speechStyle?: string`。在
`createProtagonist` 和 `createNpc` 中初始化非空 `speechStyle`、`emotionState: "平静"`
和 `relationshipHistory: []`。旧调用不传 speechStyle 时使用基于现有 traits 的
确定性默认文案，不调用模型、不生成随机值。`createInitialGameSave` 增加第三个
参数 `presentationMode: GameMode = "galgame"`，并写入保存对象。

- [ ] **Step 2: 读取旧存档时规范化模式**

在 `parseGameSave` 内把只有精确字符串 `"novel"` 的值保留为 novel，其余缺失或
非法值统一归一为 `"galgame"`。不改变 schemaVersion=1 的兼容规则，不把新字段
作为旧存档拒绝条件；序列化沿用现有 JSON 入口。

- [ ] **Step 3: 在 reducer 中以不可变方式维护双方最近 12 条关系历史**

在 `reduceWorldState` 应用 `relationshipChanges` 并得到最新关系后，为关系两端
角色各追加一条包含 `relationshipId`、当前事件的 `chapterId`、`event.year`、
最新 `relationshipType` 和最多 200 字的 `description` 摘要。使用原数组的副本，
按时间顺序保留末尾 12 条；不存在的角色不写入，最终由现有世界校验发现异常。
确保输入 WorldState、角色对象和历史数组都不被原地修改。

- [ ] **Step 4: 校验历史引用并兼容 NPC 生成结果**

在世界校验中检查每条关系历史的 `relationshipId` 存在于当前关系表，且数组长度
不超过 12、summary 非空、year 为有限整数。NPC 模型和提示词接受可选
`speechStyle`，但旧模型输出缺失时沿用工厂默认值。`/api/life/create` 接收
可选 `presentationMode`，只允许 novel/galgame，缺失时传给工厂的默认值生效。

- [ ] **Step 5: 运行状态层测试并回归旧套件**

执行 `node scripts/test-all.mjs`。先确认 V2.1 的前 3 个测试变绿，再确认所有旧
套件仍通过；如果失败，优先检查类型兼容、历史 cap 和旧存档归一化，不改动
World Simulator 的 canonical 输出。

### Task 4: 实现 Dialogue Writer 和确定性降级

**Files:**

- Create: `lib/game/dialogue-writer.ts`
- Modify: `lib/game/scene-catalog.ts`（仅在现有公开场景辅助函数不足时补最小类型导出）
- Modify: `lib/game/avatar-registry.ts`（仅复用现有头像解析，不新增第二套注册表）

- [ ] **Step 1: 定义公开输入、短别名和输出形状**

定义 `DialogueWriterInput` 为 `world`、`events`、`novelScenes` 和可选
`narrativePlan`。角色按 `Object.values(world.characters)` 生成稳定的 `C1`、`C2`…
别名；模型只能输出别名，解析阶段再映射为真实 ID、姓名和头像。公开上下文只
包含姓名、年龄、职业、公开性格 traits、values、speechStyle、emotionState、
关系公开摘要和已公开记忆，不序列化 `privateState` 或 hidden 字段。

- [ ] **Step 2: 构造带末尾硬约束的 Dialogue Prompt**

导出 `buildDialoguePrompt`。Prompt 要包含 canonical 事件标题/摘要、参与者公开
姓名、NovelScene 和 NarrativePlan；末尾追加明确的“结构硬约束”：场景数必须
等于预期值、背景只能取 scene-catalog ID、角色只能取 C 别名、block 只能是
`dialogue`/`narration`/`choice`、文本不能为空且不能改变结算事实或泄露隐私。
结构规则放末尾，叙事偏好不替代这些校验。

- [ ] **Step 3: 解析并严格校验模型 JSON**

导出 `parseDialogue`，校验场景数量、背景 ID、角色别名、block type、文本长度、
speaker 映射、choice ID 唯一性和选择数量。未知角色抛出包含“未知角色别名”的
错误，未知块抛出包含“非法 block type”的错误。speaker 映射后补真实姓名和
`avatar-registry` 可解析的头像；缺失头像保持 undefined。解析只生成展示数据，
不修改 WorldState、事件或 Chapter 结算字段。

- [ ] **Step 4: 实现 NovelScene 到 DialogueScene 的降级和模型调用**

导出 `buildFallbackDialogueScenes`：每个 NovelScene 对应一个注册场景，使用
`pickSceneForNovelScene` 选择 background，生成单个 narration block，choices 为空。
导出 `writeDialogue`，沿用 `callGameModel` 的 timeout/maxTokens 约定，解析失败
由 API 层捕获；Writer 自身不吞掉解析错误，便于测试和重试定位具体失败项。

- [ ] **Step 5: 运行 Dialogue Writer 测试**

执行 `node scripts/test-all.mjs`，确认 prompt 隐私边界、别名解析、非法输入拒绝、
场景降级四组断言变绿。特别检查测试 prompt 中没有 `privateState`、`不想异地` 或
`职业停滞`，并检查降级场景只来自现有 scene-catalog。

### Task 5: 接入服务端端点和 LifeApp 结算链路

**Files:**

- Create: `app/api/chapter/dialogue/route.ts`
- Modify: `app/api/life/create/route.ts`
- Modify: `components/life/LifeApp.tsx`

- [ ] **Step 1: 增加 Dialogue API，失败时可展示降级结果**

新增 Node runtime 的 `POST /api/chapter/dialogue`，接收 `stateBefore`、
`events`、`novelScenes` 和可选 `narrativePlan`，做最小 schema/数组校验后调用
`writeDialogue`。成功返回 `{ dialogue, degraded: false }`；模型、网络或解析
失败时记录不含密钥/提示词全文的错误，并用 `buildFallbackDialogueScenes` 返回
HTTP 200 的 `{ dialogue, degraded: true }`，绝不阻断章节结算。

- [ ] **Step 2: 增加模式入口状态和新建/继续分流**

在 LifeApp 增加 `mode_select` screen、`mode: GameMode` 和
`entryIntent: "new" | "continue"`。点击新人生或继续人生先进入 ModeSelect；新
人生确认后进入 setup，继续人生确认后只更新当前 save 的 presentationMode 并
持久化，再进入 chapter_start。解析旧存档后的缺失/非法模式默认 galgame。

- [ ] **Step 3: 将模式写入创建请求和章节保存**

新建请求把 mode 传给 `/api/life/create`；创建返回的 save 保留服务端确定的
`presentationMode`。章节模拟、Narrative Plan、Reflection 和 Novel Writer 的
共享顺序不变；Novel Writer 成功后仅在 galgame 模式调用 Dialogue API，并用
`stateBefore`、canonical events、novel scenes 和 plan 组装 `Chapter.dialogue`。
Dialogue 请求失败由客户端捕获并使用本地 NovelScene 旁白回退，不能重复模拟或
覆盖已保存的 stateAfter。

- [ ] **Step 4: 按模式渲染决策页并保存不中断**

Novel 模式的决策页复用现有 `DecisionPanel`，Galgame 模式沿用现有
`LifeShell`/`SceneStage`/`DialogueBox`。两种模式都调用同一个
`handleSelect` 和同一条 canonical 结算链，禁止在表现层复制 stats、关系或事件
结算逻辑。

### Task 6: 完成模式选择和章节表现层

**Files:**

- Create: `components/life/ModeSelect.tsx`
- Modify: `components/life/ChapterSummary.tsx`
- Modify: `components/life/NovelReader.tsx`

- [ ] **Step 1: 实现 ModeSelect 可访问选择页**

提供两个明确选项“人生小说模式”和“Galgame 互动模式”，展示差异并保留当前选择；
确认按钮调用 `onSelect`，返回按钮调用 `onCancel`。组件只负责选择，不读写
localStorage，不持有游戏状态。

- [ ] **Step 2: 让小说模式连续阅读且不显示重写按钮**

给 `NovelReader` 增加默认值为 true 的 `showRegenerate?: boolean`。ChapterSummary
在 novel 模式一次展示所有 NovelScene，并紧接现有结算结果；重写按钮仍由原回调
负责，但在本次连续阅读视图隐藏，避免用户误以为重写会重新结算。

- [ ] **Step 3: 让 Galgame 模式逐块播放 DialogueScene**

ChapterSummary 增加 `presentationMode?: GameMode`，默认 galgame。galgame 有
dialogue 时按 scene/block 索引逐块展示 scene-catalog 背景、公开角色、对白/旁白、
情绪和头像；读完最后一块再显示现有 ChapterResult。choice block 在本 Sprint
只展示其选项，不触发新的 reducer 结算。无 dialogue 或旧 Chapter 时按
NovelScene 生成 narration-only 回退，保证旧存档可读。

- [ ] **Step 4: 运行 UI 接线测试并检查隐私**

执行 `node scripts/test-all.mjs`，确认静态接线断言通过；检查
`render_game_to_text` 和 `buildLifePresentation` 只输出公开字段，不因 Dialogue
渲染把 privateState、hiddenGoals、hiddenConcerns 或 privateBeliefs 带入 UI。

### Task 7: 全量验证和交付前检查

**Files:**

- Modify: only files required by failing verification or the V2.1 implementation.

- [ ] **Step 1: 运行格式、类型、测试和构建验证**

依次执行：

```bash
npm run lint
node scripts/test-all.mjs
npm run build
git diff --check
```

构建允许记录现有 `lib/narrative/query-adapter.ts` 的 dynamic fs tracing warning，
但不能引入新的 TypeScript、ESLint 或 Next 编译错误。若涉及真实事件生成接口，
再按仓库约束调用真实 `/api/event` 并验证 SSE 最终 `complete`、18 个经历和 3 个
选项；本 Sprint 不改该接口时，不以端口开放或 `SELECT 1` 代替业务验证。

- [ ] **Step 2: 检查变更边界**

执行 `git status --short`、`git diff --stat` 和 `git diff --check`，确认 `.env`、
`localdata/`、全量语料和两份用户新增的 V2.1-V3.0 方案文档没有被加入实现变更。
确认所有新增测试通过且没有依赖新 npm 包。

- [ ] **Step 3: 形成实现提交和交付说明**

只暂存 V2.1 实现相关文件，提交信息使用 `feat: add V2.1 interactive life mode`。
提交前再次运行 `npm run lint`、`node scripts/test-all.mjs` 和 `npm run build`，以
最新工作树证据报告完成项、降级行为和任何未解决的外部模型 smoke 限制。
