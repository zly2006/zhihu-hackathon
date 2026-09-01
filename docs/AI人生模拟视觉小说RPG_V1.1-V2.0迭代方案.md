# 知乎互动人生小说：V1.0 → V2.0 后续迭代方案

> 文档状态：**V1.x 后续演进开发基线 / 已确认版**  
> 日期：2026-09-01  
> 基线仓库：`zly2006/zhihu-hackathon`  
> 基线分支：`dev/mvp-v1-interactive-life`  
> 基线关系：该分支相对 `main` **ahead 13 / behind 0**，因此后续直接在 V1.0 分支架构上迭代，不从 `main` 重做。  
> 目标：在不破坏 V1.0 已验证的世界模拟闭环前提下，依次提升 **叙事吸引力 → 人物智能 → 游戏/视觉小说体验 → 知识与模型上限**。

---

# 0. 已冻结决策

本文件不再保留产品层面的 TBD。以下内容视为本轮迭代的既定边界。

1. V1.0 已跑通，继续作为后续所有版本的 canonical 基线。
2. 玩家继续只控制主角；3 个核心 NPC 自主行动。
3. NPC 自主行动在**每章世界模拟时**产生，不做后台持续运行 Agent。
4. `World Simulator` 只负责决定发生什么；后续叙事层只能决定怎么讲，**不得修改 canonical facts**。
5. V1.1 增加独立 `Narrative Director`；`Scene Planner` 与 Director 合并成同一次 LLM 调用。
6. 每章增加显式的 `Chapter Theme / Main Conflict / Emotional Arc / Ending Hook`。
7. 新增第二知识库：`Narrative Knowledge Database`，与知乎 `Life Experience Database` 职责分离。
8. Narrative DB 的最小知识单位是 `NarrativeFragment`，不是整本书、整章或任意固定 token chunk。
9. Narrative DB 采用三层：`Raw Source → Structured Fragment → Embedding / Retrieval Index`。
10. V1.x 通过 RAG 让 LLM 学习叙事模式；V2 再评估基于有权使用数据的 LoRA / 微调。
11. 原始语料优先使用公版、CC、明确授权、自有/自建文本；实验数据必须记录权利状态。
12. V1.2 只增强 3 个核心 NPC，不扩大成几十个社会 Agent。
13. NPC Hidden State 保留并增强，不直接展示给玩家。
14. UI 采用**视觉小说层 + RPG HUD 层并存**，不是二选一。
15. V1.3 不做 AI 实时生图；角色立绘、表情、场景背景、CG 作为后续 Visual Generation System。
16. 后续方案以长期产品演进为主，同时要求每个版本都能提升比赛 Demo 的可感知体验。
17. GitHub 开源参考只把高星项目作为主要依据；低星项目即便思想有趣，也不作为架构依赖或核心背书。
18. 截图中的 Skill 要合理使用，但 Skill 的“安装量”与 GitHub Stars 不是同一指标；核心开发优先采用高星、可信仓库中的对应 Skill。

---

# 1. V1.0 当前状态

## 1.1 真机验证结论

当前分支已经验证：

- 18 岁创建主角；
- 真实 LLM 生成 3 个核心 NPC；
- NPC 可编辑名字/关系/公开设定；
- `GameSave v1` 本地存档；
- 每章选择 1 年 / 3 年；
- 生成困境和 A/B/C；
- 知乎真实经历 RAG；
- 程序确定性 `favorable / mixed / setback` 结果锚点；
- World Simulator 输出 canonical `SimulationEvent[]`；
- World Reducer 更新人物、关系、记忆、线索；
- Novel Writer 将 canonical facts 文学化；
- 章末时间线、结果和知乎来源展示；
- 全量冒烟测试、lint、build 已通过。

当前用户反馈的两个主要问题不是“功能不通”，而是：

1. **小说不够好看**：文风偏平、场景张力弱、容易像事件流水账。
2. **UI 不够像游戏**：已有数据和流程，但表现形式仍像功能型网页。

因此后续不应优先增加更多人生功能，而应先提高已有闭环的内容质量和表现质量。

---

# 2. `main` 与 V1.0 分支复用评估

## 2.1 分支策略

`dev/mvp-v1-interactive-life` 相对 `main`：

- `ahead_by = 13`
- `behind_by = 0`
- merge base 即当前 `main` 基线

结论：

```text
main
  │
  └── dev/mvp-v1-interactive-life   ← V1.0 当前真实开发基线
          │
          ├── V1.1 Narrative Upgrade
          ├── V1.2 Character Intelligence
          ├── V1.3 Hybrid Visual Novel UI
          └── V2.0 Knowledge / Model Upgrade
```

不建议从 `main` 重新搭一套后再搬 V1.0。

## 2.2 `main` 中继续直接复用的基础设施

| 模块 | 复用等级 | 后续用途 |
|---|---:|---|
| Next.js 16 + React 19 + TypeScript | ★★★★★ | 保持技术栈 |
| `lib/llm.ts` | ★★★★★ | Director / Writer / NPC LLM 调用统一入口 |
| `lib/database.ts` PostgreSQL 连接 | ★★★★★ | 知乎 Life Experience 继续使用 |
| SSE 流式 API 模式 | ★★★★★ | simulate / narrative plan / novel 长请求 |
| 知乎 auth / avatar / 来源展示 | ★★★★☆ | 用户身份和来源卡继续使用 |
| `app/globals.css` | ★★★☆☆ | 保留基础 reset，V1.3 重建视觉 token |
| `components/restart-life.tsx` | ★★☆☆☆ | 旧模式 `/` 保留，不作为新 UI 基础 |
| `lib/era.ts` | ★★☆☆☆ | 旧模式保留；未来可抽取历史环境数据能力 |
| `lib/mechanics.ts` | ★★☆☆☆ | 理念已被新 `decision-resolver` 吸收 |

## 2.3 V1.0 新增模块：后续处理矩阵

### A. 必须原样或近乎原样保留

| 文件/模块 | 等级 | 原因 |
|---|---:|---|
| `lib/domain/shared.ts` | ★★★★★ | ID、LifeStats、基础枚举 |
| `lib/domain/character.ts` | ★★★★★ | Character / Goal / Hook / privateState 已具备 |
| `lib/domain/relationship.ts` | ★★★★★ | RPG 关系 HUD 与世界模拟共用 |
| `lib/domain/memory.ts` | ★★★★★ | 长期记忆基础已经正确 |
| `lib/domain/world.ts` | ★★★★★ | canonical 世界状态 |
| `lib/domain/simulation.ts` | ★★★★★ | 世界事实层，不让叙事层改写 |
| `lib/domain/experience.ts` | ★★★★★ | 知乎 LifeExperience 与 EvidenceBundle |
| `lib/game/decision-resolver.ts` | ★★★★★ | 确定性 outcome anchor |
| `lib/game/world-simulator.ts` | ★★★★★ | “世界发生什么”的唯一核心 |
| `lib/game/world-reducer.ts` | ★★★★★ | 世界状态结算 |
| `lib/game/simulation-validator.ts` | ★★★★★ | canonical output 防线 |
| `lib/game/evidence-retriever.ts` | ★★★★★ | 第一知识库检索 |
| `lib/game/experience-adapter.ts` | ★★★★★ | 适配现有只读知乎库 |
| `lib/game/hash.ts` | ★★★★★ | 稳定 hash/状态校验 |
| `lib/game/save.ts` | ★★★★☆ | versioned localStorage，新增字段优先向后兼容 |
| `/api/chapter/simulate` | ★★★★★ | 不与 Narrative Engine 合并 |

### B. V1.1 的主要改造点

| 文件/模块 | 改造 |
|---|---|
| `lib/game/novel-writer.ts` | 从“直接 Event→Novel”改为“Plan + Event→Novel” |
| `lib/domain/chapter.ts` | 增加可选 `narrativePlan` 与叙事元数据 |
| `/api/chapter/novel` | 接收 `NarrativePlan` |
| `components/life/ChapterSummary.tsx` | 升级为真正章节结算/阅读入口 |
| `components/life/NovelReader.tsx` | V1.3 再升级为视觉小说 Scene Reader |

### C. V1.2 的主要改造点

| 模块 | 现状 | 改造 |
|---|---|---|
| `Character.privateState` | 已有 hiddenGoals / hiddenConcerns / privateBeliefs | 增加 reflection / emotionalTrend |
| `npc-generator.ts` | 开局一次性生成 hidden state | 章间持续演化 |
| `CharacterMemory` | 已有 `reflection` type | 真正生成/选择 reflection |
| `world-simulator.ts` | 已读取 NPC 隐藏状态 | 增加“记忆→反思→目标变化”约束 |
| `memory-selector.ts` | 基础选择 | 增加冲突、关系、NPC 匹配 |

### D. V1.3 UI 当前最明显问题

当前 `LifeApp.tsx / CharacterPanel.tsx / NovelReader.tsx / ChapterSummary.tsx` 大量使用 inline style。这适合 MVP，但不适合后续视觉规范化。

V1.3 应迁移到：

```text
CSS Variables / Theme Tokens
+
页面级布局
+
可复用 HUD / Scene / Portrait / Dialogue 组件
```

而不是只“换颜色”。

---

# 3. 总体目标架构

```text
                    ┌──────────────────────┐
                    │ Life Experience DB   │
                    │ 知乎：现实会怎样       │
                    └─────────┬────────────┘
                              │
                              ▼
玩家选择 ──→ Decision Resolver ──→ World Simulator
                                  │
                                  ▼
                         Canonical SimulationEvent[]
                                  │
                         WorldState / Memories
                                  │
                                  ▼
                    Narrative Knowledge DB
                    “怎么讲才好看”
                                  │
                                  ▼
                       Narrative Director
                   ChapterOutline + ScenePlan[]
                                  │
                                  ▼
                           Novel Writer
                                  │
                                  ▼
                           Chapter Novel
                                  │
                     ┌────────────┴────────────┐
                     ▼                         ▼
               Visual Novel Layer          RPG HUD
               场景/对白/头像/章节          属性/关系/目标
```

---

# 4. V1.1 — Narrative Upgrade

## 4.1 唯一核心目标

> **让已经合理的人生事实，变成真正有阅读吸引力的章节。**

V1.1 不扩大人生模拟能力，不增加 NPC 数量，不重写 World Simulator。

## 4.2 V1.1 新链路

```text
SimulationEvent[]
    ↓
Narrative Need Builder
    ↓
Narrative Knowledge DB Retrieval
    ↓
NarrativeEvidenceBundle
    ↓
Narrative Director
    ↓
NarrativePlan
  ├── Chapter Theme
  ├── Main Conflict
  ├── Emotional Arc
  ├── Character Arcs
  ├── ScenePlan[]
  └── Ending Hook
    ↓
Novel Writer
    ↓
Chapter
```

## 4.3 新增领域类型

建议新增 `lib/domain/narrative.ts`：

```ts
export type NarrativeNeed = {
  chapterId: string;
  lifeDomains: string[];
  relationshipTypes: string[];
  centralEvents: string[];
  conflictTypes: string[];
  desiredTone: string;
  narrativeFunctions: Array<
    | "setup" | "bonding" | "conflict" | "decision"
    | "reversal" | "loss" | "reconciliation"
    | "climax" | "aftermath" | "hook"
  >;
};

export type NarrativeReference = {
  fragmentId: string;
  sourceId: string;
  functionTags: string[];
  conflictTags: string[];
  relationshipTags: string[];
  techniqueSummary: string;
  structureSummary: string;
  emotionalCurve: string[];
  safeExcerpt?: string;
  similarity: number;
  qualityScore: number;
};

export type NarrativeEvidenceBundle = {
  querySummary: string;
  arcPatterns: NarrativeReference[];
  scenePatterns: NarrativeReference[];
  dialoguePatterns: NarrativeReference[];
  pacingPatterns: NarrativeReference[];
  endingPatterns: NarrativeReference[];
  total: number;
};

export type ScenePlan = {
  id: string;
  order: number;
  timeLabel: string;
  location: string;
  participantIds: string[];
  povCharacterId: string;
  sourceEventIds: string[];
  purpose: "setup" | "development" | "conflict" | "turning_point" | "climax" | "aftermath" | "hook";
  visibleGoal: string;
  conflict: string;
  startEmotion: string;
  endEmotion: string;
  mustShow: string[];
  mustNotInvent: string[];
  dialogueIntent?: string;
  narrativeTechniques: string[];
  endingBeat: string;
};

export type CharacterArcPlan = {
  characterId: string;
  startState: string;
  pressure: string;
  change: string;
  endState: string;
};

export type NarrativePlan = {
  version: 1;
  titleDirection: string;
  theme: string;
  emotionalCore: string;
  mainConflict: string;
  characterArcs: CharacterArcPlan[];
  scenes: ScenePlan[];
  endingHook: {
    textGoal: string;
    type: "open_question" | "relationship_tension" | "new_opportunity" | "unresolved_cost" | "quiet_aftershock";
  };
  referenceFragmentIds: string[];
  canonicalEventIds: string[];
};
```

## 4.4 Narrative Director 的硬边界

Director 可以：

- 选择从哪个事件切入；
- 决定场景顺序；
- 将一个事件拆成多个可见场景；
- 使用时间跳切；
- 选择在哪个 NPC 身上制造叙事压力；
- 设计对白目的；
- 设置章节主题和结尾余味；
- 用生活细节承载情绪；
- 选择哪些 canonical events 只在背景交代。

Director 不能：

- 新增重大人生事实；
- 改变 SimulationEvent 年份；
- 改变人物状态增量；
- 改变关系变化；
- 添加未存在的婚姻、死亡、怀孕、裁员、重大疾病等事件；
- 为“更戏剧化”而让 NPC 突然反常；
- 把 Narrative DB 中角色/情节复制到当前游戏人物；
- 将某篇小说原文改名后搬入游戏。

原则：

```text
SimulationEvent = What happened
NarrativePlan   = How to reveal it
Novel           = How to write it
```

## 4.5 Director 与 Scene Planner 合并

V1.1 采用：

```text
Director + Scene Planner
一次 LLM
  ↓
NarrativePlan
```

V2 如果数据证明必要，再拆两个模型角色。

## 4.6 NarrativePlan 校验器

新增 `lib/game/narrative-validator.ts`。

硬校验：

1. `canonicalEventIds` 只能引用本章事件。
2. 每个 `ScenePlan.sourceEventIds` 至少 1 个。
3. 场景必须遵守时间逻辑；回忆必须显式标记。
4. `participantIds / povCharacterId` 必须存在。
5. 不得把 privateState 当作主角已知事实。
6. 1 年章目标 3–5 个 scene。
7. 3 年章目标 5–8 个 scene。
8. 至少 1 个 conflict / turning_point / climax。
9. 必须有 `endingHook`。
10. `referenceFragmentIds` 必须来自当前 NarrativeEvidenceBundle。
11. `mustNotInvent` 自动带入重大硬约束。

软规则：

- 不要求每个场景都高冲突；
- 至少一个生活/呼吸场景；
- 不强塞所有 NPC；
- scene purpose 不能全是 development。

## 4.7 Novel Writer V2 输入

```ts
type NovelWriterInputV2 = {
  protagonist: Character;
  npcs: Character[];
  relationships: Relationship[];
  startYear: number;
  endYear: number;
  span: 1 | 3;
  events: SimulationEvent[];
  narrativePlan: NarrativePlan;
  relevantMemories: CharacterMemory[];
  narrativeReferences: NarrativeReference[];
  featuredLifeEvidence: LifeExperience[];
};
```

Writer 只负责：

- 场景正文；
- 对白；
- 动作；
- 感官细节；
- 节奏；
- 过渡；
- 第二人称体验。

Writer 不再自己承担：主题发现、场景数量规划、高潮选择、结尾 hook 选择。

## 4.8 API

新增 `POST /api/chapter/narrative-plan`：

```text
buildNarrativeNeed
↓
retrieveNarrativeEvidence
↓
generateNarrativePlan
↓
validateNarrativePlan
↓
complete
```

输出：

```ts
{
  narrativePlan: NarrativePlan;
  narrativeEvidence: NarrativeEvidenceBundle;
  metrics: ...;
}
```

修改 `POST /api/chapter/novel`，增加 `narrativePlan / narrativeReferences`。

## 4.9 Chapter 数据兼容

V1.1 先不强制 bump `GameSave.schemaVersion`。

在 Chapter 增加可选字段：

```ts
narrative?: {
  plan: NarrativePlan;
  referenceFragmentIds: string[];
  directorVersion: number;
};
```

老 V1.0 存档：历史章节照常展示；新章节使用 V1.1；不重新模拟历史章节。

## 4.10 Chapter Summary

增加：

```text
这一章真正改变了什么
├─ 本章主题
├─ 主角变化
├─ 关键 NPC 变化
├─ 关系变化
├─ 已解决线索
└─ 留到下一章的问题
```

Narrative DB 来源默认不在玩家正文中展示，只在 debug/audit 中保留。

## 4.11 V1.1 验收

功能：

- [ ] Narrative DB 可独立查询；
- [ ] `NarrativeEvidenceBundle` 生成；
- [ ] Director 生成 `NarrativePlan`；
- [ ] plan 通过结构校验；
- [ ] Writer 严格按 plan 写；
- [ ] 重写小说不触发 World Simulator；
- [ ] Director 失败不会修改 canonical；
- [ ] Narrative DB 故障有 fallback；
- [ ] 旧存档可继续。

质量：建立至少 20 个固定 canonical chapter fixture，盲评：场景感、人物一致性、冲突自然度、对白可信度、章节结构、继续阅读意愿、canonical 一致性。

验收门槛：

- canonical drift = 0；
- 平均“继续阅读意愿”较 V1.0 baseline 提升 ≥ 0.8/5；
- ≥80% 测试章节能明确指出主题和主冲突；
- 不以增加极端事件换取刺激。

---

# 5. V1.2 — Character Intelligence

## 5.1 目标

> 让 NPC 不只是“有隐藏设定”，而是能因为过去发生的事情逐渐形成新的判断和目标。

V1.0 已经有 `privateState.hiddenGoals / hiddenConcerns / privateBeliefs`，且 World Simulator 已读取隐藏状态。

V1.2 是把它从**静态设定**升级为**可演化心理状态**。

## 5.2 新增结构

```ts
export type CharacterReflection = {
  id: string;
  characterId: string;
  chapterId: string;
  year: number;
  basedOnMemoryIds: string[];
  insight: string;
  beliefChanges: Array<{
    topic: string;
    from?: string;
    to: string;
    strength: number;
  }>;
  goalPressure: Array<{
    goalId: string;
    direction: "increase" | "decrease";
    amount: number;
    reason: string;
  }>;
  emotionalTrend: "hopeful" | "stable" | "anxious" | "resentful" | "withdrawn" | "attached" | "ambivalent";
  private: boolean;
};
```

Character 扩展：

```ts
privateState?: {
  hiddenGoals: string[];
  hiddenConcerns: string[];
  privateBeliefs: string[];
  currentEmotionalTrend?: string;
  reflectionIds?: string[];
};
```

## 5.3 Reflection 运行时机

只在每章 canonical simulation 完成后运行，不做后台定时 Agent。

```text
World Simulator
↓
SimulationEvent[]
↓
World Reducer
↓
为真正受到影响的角色生成 Reflection
↓
更新 privateState / goal priority
↓
保存 CharacterReflection
```

仅对有 participant event、relationship delta 或高重要度 memory 的角色反思。

## 5.4 调用策略

一章最多一次 Reflection Batch：一次输入需要反思的 1–4 个角色，不按 NPC 逐个调用。

## 5.5 Hidden State 泄漏规则

玩家可见：身份、公开目标、关系值、可观察近况、模糊情绪表现。

玩家不可见：hiddenGoal 原文、hiddenConcern 原文、privateBelief、reflection 内部判断。

小说可通过行为暗示，但不能直接泄漏尚未成为 canonical/公开行为的秘密决定。

## 5.6 V1.2 验收

- [ ] 连续 8–12 章同一 NPC 不重置；
- [ ] 过去矛盾影响未来行为；
- [ ] 已解决 Hook 不再被当未解决；
- [ ] 目标优先级变化有来源；
- [ ] NPC 不会永远迁就主角；
- [ ] 也不会为了戏剧性反复背叛；
- [ ] privateState 不泄漏；
- [ ] Prompt 不无限增长。

---

# 6. V1.3 — Hybrid Visual Novel + RPG UI

## 6.1 目标

同屏存在两个体验层。

视觉小说层：Chapter、Scene、人物头像、对白框、场景切换、章节标题、正文阅读。

RPG 层：主角属性、等级/年龄、事业/身份、关系值、当前目标、当前困境、本章状态增减。

## 6.2 桌面布局

```text
┌─────────────────────────────────────────────────────────┐
│ Chapter 04 · 选择的代价                   2029 → 2032   │
├────────────────────────────────────┬────────────────────┤
│         Scene / Portrait           │ 主角 HUD           │
│                                    │ Lv / Age / Job     │
│ [NPC头像]                          │ 健康 █████ 72      │
│                                    │ 幸福 ███   48      │
│ 林雨                               │ 事业 █████ 78      │
│ “你真的想清楚了吗？”               │ 现金 ████  63      │
│                                    │ Relationships      │
│ [正文 / 继续]                      │ 林雨 ♥ 66 ↓        │
│                                    │ 王浩 ◆ 74 ↑        │
├────────────────────────────────────┴────────────────────┤
│ 本场景：2029.08 · 深圳 · 出租屋        [自动] [下一段]   │
└─────────────────────────────────────────────────────────┘
```

## 6.3 移动端

不要缩小桌面 HUD。采用：

```text
Scene
↓
Dialogue/Text
↓
Bottom HUD Tabs
  人物 | 属性 | 关系 | 时间线
```

## 6.4 UI ViewModel

新增 `lib/game/presentation.ts`，UI 不到处直接读 `WorldState`。

```ts
export type LifePresentationState = {
  chapter: {
    index: number;
    title: string;
    yearRange: string;
    sceneIndex: number;
    sceneTotal: number;
  };
  protagonist: {
    name: string;
    age: number;
    levelLabel: string;
    occupation: string;
    portraitKey: string;
    stats: Array<{
      key: string;
      label: string;
      value: number;
      delta?: number;
      warning: boolean;
    }>;
  };
  relationships: Array<{
    characterId: string;
    name: string;
    type: string;
    score: number;
    trend?: number;
    portraitKey: string;
  }>;
  scene: {
    heading?: string;
    timeLabel?: string;
    speakerId?: string;
    speakerName?: string;
    blocks: unknown[];
  };
};
```

## 6.5 组件建议

```text
components/life-vn/
  LifeShell.tsx
  chapter/
    ChapterHeader.tsx
    ChapterCover.tsx
    SceneStage.tsx
    SceneTransition.tsx
  dialogue/
    DialogueBox.tsx
    NarrationBlock.tsx
    SpeakerName.tsx
  portrait/
    CharacterPortrait.tsx
    PortraitPlaceholder.tsx
  hud/
    PlayerHud.tsx
    StatBar.tsx
    RelationshipHud.tsx
    GoalHud.tsx
  summary/
    ChapterResult.tsx
    ChangeAnimation.tsx
    EventTimeline.tsx
    RealityEvidenceDrawer.tsx
  responsive/
    MobileHudDrawer.tsx
```

## 6.6 动效

只做低成本、高反馈：数值 tween、关系变化 pulse、scene 淡入淡出、对话框进入、章节封面、timeline reveal、loading 状态。

必须支持 `prefers-reduced-motion`。

## 6.7 视觉资产

V1.3：placeholder portrait、CSS/SVG/icon、统一人物颜色，不做实时 AI 立绘。

Future Visual Generation：Character Portrait、Expression Variants、Scene Background、Key Event CG。未来基于 `CharacterVisualProfile + SceneVisualPrompt`，而不是临时把小说全文丢给生图模型。

---

# 7. V2.0 — Knowledge & Model Upgrade

## 7.1 Narrative DB 扩大

覆盖更多关系、职业、家庭、成长场景和叙事功能，建立离线检索评测。

## 7.2 Fine-tuning Gate

只有同时满足：合法训练语料、足够规模、RAG+Director 已达瓶颈、有明确 baseline、可衡量微调增益，才进入 LoRA。

禁止“小说不好看→随便找大量小说→直接 LoRA”。

## 7.3 Director 可拆分

如果 V1.1 证明一次 Director 不够，再拆：

```text
Narrative Director
↓
Scene Planner
↓
Writer
```

## 7.4 Visual Generation System

研究人物一致性、年龄变化、表情、背景、CG、缓存、成本、失败 fallback。AI 生图只改 Presentation，不改 WorldState。

## 7.5 NPC 后台持续模拟

明确不进入 V1.x。未来只有 3 NPC 每章模拟仍显僵硬、产品需要开放社会世界时才考虑。

---

# 8. 两个知识库边界

| 问题 | Life Experience DB | Narrative Knowledge DB |
|---|---|---|
| 核心问题 | 现实中类似选择会怎样？ | 这种事实怎样讲得更有吸引力？ |
| 来源 | 知乎人生经历 | 有授权/公版/自建优秀叙事 |
| 使用者 | World Simulator | Narrative Director / Writer |
| 能否影响 canonical | 作为现实参考 | **不能** |
| 是否直接复制原文 | 否 | 否 |
| 检索维度 | 背景、选择、结果、关系 | 场景功能、冲突、情绪、技巧、节奏 |
| 玩家可见 | 章末现实参照卡 | 默认不展示原始来源 |

---

# 9. Codex / Agent Skill 开发工作流

## 9.1 核心 Skill 只采用高星可信来源

### `develop-web-game`

- Repo：`openai/skills`
- Stars 快照：约 **24.3k**
- Path：`skills/.curated/develop-web-game/SKILL.md`

吸收：implement → act → pause → observe → adjust；每次 meaningful change 实际跑浏览器；Playwright；screenshot；`render_game_to_text`；console error；progress.md。

### `game-engine`

- Repo：`github/awesome-copilot`
- Stars 快照：约 **38.5k**
- Path：`skills/game-engine/SKILL.md`

本项目不照搬 Canvas/WebGL，只吸收 state ownership、update/render 分离、state machine、UI 不持有游戏规则。

### `game-ui-frontend` + `game-playtest`

- Repo：`openai/plugins`
- Stars 快照：约 **5k**
- Path：`plugins/game-studio/skills/game-ui-frontend/SKILL.md`、`game-playtest/SKILL.md`

吸收：不要做 SaaS dashboard、视觉方向、HUD 层级、responsive、真实 playtest、screenshot review。

### `frontend-skill`

- Repo：`openai/skills`
- Stars 快照：约 **24.3k**

用于 V1.3 的 hierarchy、typography、motion restraint 和统一视觉。

### 截图里的其他 Skill

`game-ui-ux / game-feel / higgsfield-game-generation` 可参考，但其独立来源仓库 Stars 低于上述核心来源，不作为 V1.x 必选依赖。`higgsfield-game-generation` 仅作为未来 Visual Generation 候选。

## 9.2 V1.1 Skill 绑定

设计前用 `game-engine` 检查 Narrative 层是否越权、canonical ownership、失败是否污染存档。

每个实现单元用 `develop-web-game`：

1. NarrativeNeed
2. DB retrieval
3. Director
4. validator
5. Writer V2
6. Chapter Summary

每单元执行：

```text
lint/build
↓
浏览器真实流程
↓
render_game_to_text
↓
screenshot
↓
console
↓
fixture
```

## 9.3 V1.2 Skill 绑定

`game-engine + develop-web-game`，重点检查 private state ownership、reflection update、UI 不读取私密字段、存档 deterministic、8–12 章 replay。

## 9.4 V1.3 Skill 绑定

先用 `game-ui-frontend + frontend-skill` 产出信息层级、screen map、theme token、desktop/mobile layout、component contract。

再用 `develop-web-game + game-playtest` 对 landing、setup、npc setup、chapter start、decision、sim loading、novel scene、chapter summary、mobile 全部截图验证。

## 9.5 Future Visual Skill

如果以后采用 `higgsfield-game-generation` 或其他 asset skill，只允许作用于：

```text
assets/
presentation/
character_visual/
scene_visual/
```

禁止参与 simulation/world_state/decision。

---

# 10. 自动化测试接口改进

V1 新 `LifeApp` 应补回测试可观测接口：

```ts
window.render_game_to_text = () => JSON.stringify({
  screen,
  year: world?.currentYear,
  chapterIndex: world?.chapterIds.length,
  protagonist: /* visible only */,
  visibleNpcs: /* no privateState */,
  visibleRelationships: /* public */,
  activeDecision: /* visible */,
  activeScene: /* visible */,
  loading,
  error
});
```

绝不输出 NPC privateState。

V1.3 若使用 CSS 动效，可提供测试级 `window.__lifeTest?.finishTransitions()`，或使用 reduced-motion 模式，不需要模拟实时游戏帧。

---

# 11. 分支建议

```text
dev/mvp-v1-interactive-life
        ↓
dev/v1.1-narrative-engine
        ↓
dev/v1.2-character-intelligence
        ↓
dev/v1.3-hybrid-vn-ui
```

Narrative 数据管线建议独立目录或上游数据仓库分支，应用仓库只保留 schema contract、DTO、query adapter、fixtures、docs。

---

# 12. 版本顺序

推荐：

```text
V1.1 Narrative
↓
V1.2 Character
↓
V1.3 UI
```

原因：V1.3 最终 Scene / speaker / emotional state 数据结构依赖 NarrativePlan。

可以并行：V1.1 后端 Narrative Engine + V1.3 视觉调研/style contract。

不要并行大改 `LifeApp`。

---

# 13. 参考来源

## 13.1 高星开源项目

### Generative Agents

- Repo：`joonspk-research/generative_agents`
- Stars 快照：约 **21.5k**
- 借鉴：memory stream、reflection、planning、believable agent behavior。
- 不照搬：25 Agent 小镇和后台实时社会模拟。

### SillyTavern

- Repo：`SillyTavern/SillyTavern`
- Stars 快照：约 **32k**
- 借鉴：Character/Lore/WorldInfo、Visual Novel Mode、context composition。
- 不照搬：完全聊天式、无 canonical reducer 的自由生成。

### AI Dungeon

- Repo：`latitudegames/AIDungeon`
- Stars 快照：约 **3.2k**
- 借鉴：长期互动小说、上下文/记忆产品问题。
- 不照搬：LLM 完全自由决定世界事实。

## 13.2 设计参考游戏

- **Wildermyth**：人物 Hook / 性格 / 关系影响事件资格，程序化角色故事。
- **I Was a Teenage Exocolonist**：Narrative Octopus、角色线/世界线并存。
- **Our Life: Beginnings & Always**：多年关系记忆、核心人格稳定 + 态度成长。
- **The Life and Suffering of Sir Brante**：人生章节、过去条件持续约束未来。
- **Choice of Robots**：长时间跨度互动小说与关系并行。
- **Chinese Parents**：RPG 属性作为人生阶段反馈。

---

# 14. 最终版本验收定义

## V1.1 Done

用户反馈从“发生的事情合理，但不好看”变成“我想继续读下一章”。

## V1.2 Done

用户能描述“这个 NPC 有自己的想法，而且记得之前发生的事”，而不是“这是触发剧情的 NPC”。

## V1.3 Done

首次看到页面的用户不用解释，也能判断“这是一个互动人生视觉小说/RPG”，而不是“AI 文本 Demo”。

## V2 Done

只有知识库增长和模型升级能通过 A/B 证明稳定增益，并且数据权利可审计，才算完成。

---

# 15. 直接开发顺序

### Step 1

先完成 Narrative DB v0 的独立建设和检索 fixture。

### Step 2

新增：

```text
lib/domain/narrative.ts
lib/game/narrative-need.ts
lib/game/narrative-retriever.ts
lib/game/narrative-director.ts
lib/game/narrative-validator.ts
app/api/chapter/narrative-plan/route.ts
```

### Step 3

修改：

```text
lib/game/novel-writer.ts
lib/domain/chapter.ts
app/api/chapter/novel/route.ts
components/life/LifeApp.tsx
components/life/ChapterSummary.tsx
```

### Step 4

建立 Narrative baseline fixtures 和盲评表。

### Step 5

V1.1 真机验证完成后再开 V1.2。

---

# 16. 非目标

V1.x 明确不做：多主角控制、多人联机、20+ NPC 社会模拟、后台实时 NPC Agent、AI 生图、语音、BGM、训练基础模型、让小说知识库影响人生事实、删除知乎现实经验层、重写已验证 World Simulator、为了刺激增加极端事件频率。

---

**一句话基线：**

> V1.0 已经解决“这个人生世界会不会合理地继续发生”；V1.1–V1.3 要依次解决“这些事实能不能成为好故事”“这些人物像不像活人”“这个产品看起来和玩起来像不像游戏”。
