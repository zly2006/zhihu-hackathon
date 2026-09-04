# V3 Scene Runtime 设计规格（Galgame 玩法系统 · 核心玩法轮）

## 1. 目标

在已结算的 `DialogueScene` 之上建立真正的场景运行系统（Scene Runtime），把"看剧情"升级为"玩剧情"：

- 场景内可推进、可自动播放、可跳过，支持场景级微选择。
- 微选择走确定性规则结算（零 LLM），即时反馈到关系四轴、角色情绪与 HUD。
- 引入关系五级（陌生/熟悉/朋友/信任/重要的人），由四轴分数确定性推导，支撑关系门槛选项。
- 微选择累积为 `SceneDecisionRecord`，经 `ChapterChoice.context` 流入下一章 World Simulator 上下文，实现"微观选择 → 宏观后果"。

对应分工文档 02（Galgame 玩法系统）交付标准中的 Scene Runtime / Choice 系统 / Relationship 反馈三项；分支保存升级与赵冷 Demo 剧情在下一轮。

## 2. 范围边界

本阶段包含：

- `lib/domain/scene.ts`：`SceneRuntimePosition`、`SceneDecisionRecord`、`SceneChoiceOutcome` 等运行时契约。
- `lib/domain/chapter.ts`：`Chapter` 增加可选 `sceneDecisions?`（additive，GameSave schemaVersion 保持 1）。
- `lib/domain/dialogue.ts`：`DialogueChoice` 扩展 `intentTag`、`requirement?`。
- `lib/game/dialogue-writer.ts`：场景 choices 从硬禁用改为受控放行（仅模型请求且校验通过时产出）。
- `lib/game/scene-choice-resolver.ts`：确定性微选择结算（纯函数）。
- `lib/game/world-reducer.ts`：新增 `applySceneChoice`（纯函数，复用 clamp/历史/校验纪律）。
- `lib/game/relationship-levels.ts`：关系等级推导与门槛判定（纯函数）。
- `POST /api/chapter/scene-choice`：服务端结算端点（零 LLM）。
- `components/life/use-scene-runtime.ts`：场景播放状态机 hook（推进/自动/跳过/选择）。
- `ChapterSummary`、`ChoicePanel`、`RelationshipHud`、`presentation.ts` 接线；`LifeApp` 存档与上下文编译。
- `scripts/test-all.mjs` 注册 `test/v3-scene-runtime.test.mjs`。

本阶段不包含：

- 场景级分支保存（delta 快照）、时间线节点按微选择回溯（下一轮）。
- 赵冷 Demo 剧情数据（下一轮 fixture）。
- 立绘精灵/表情资产接入（等视觉资产负责人 VisualProfile；本阶段仅保留回退约定，见 §6）。
- NPC 主动事件、隐藏事件（等叙事负责人）。
- 任何新的 LLM 结算入口：World Simulator 仍是"发生了什么"的唯一 canonical 入口；微选择只做程序化关系/情绪微调，不产生 `SimulationEvent`。

## 3. 两层选择制（核心架构）

```text
关键抉择（章级，已有）：ChapterChoice → /api/chapter/simulate → World Simulator → reducer → WorldState
微选择（场景级，本阶段新增）：DialogueScene.choices
        → 玩家点选（UI 只发意图）
        → POST /api/chapter/scene-choice（服务端确定性 resolver + reducer，零 LLM）
        → SceneChoiceOutcome + worldStateAfter（回写存档）
        → SceneDecisionRecord 累积在 chapter.sceneDecisions
        → 下一章 /api/chapter/choices 携带 recentSceneActions → choice-generator 织入 context
        → ChapterDecision.context → World Simulator 输入（不改动 world-simulator 提示词）
```

规则：

- UI 永远不直接修改世界：场景页只发出 `(sceneId, choiceId)`，结算一律在服务端 resolver+reducer 完成。
- 微选择不产生 canonical 事件、不推进时间、不改人生七维属性；只允许小幅调整关系四轴与 `emotionState`。
- 结算不对称（遵循 Prompt Mind Flow 风险回报检查）：亲近/对抗/疏远/务实各 intent 有不同 delta 剖面，对抗提高冲突但也可能以诚实换信任，冷落有真实代价；禁止为整齐而平均化。
- 一个场景最多 1 个 choice block、最多 3 个选项；整章带选择的场景数由 dialogue prompt 上限约束（≤3），避免打断节奏。

## 4. 数据契约

### 4.1 `lib/domain/scene.ts`（新增）

```ts
export type SceneChoiceIntent = "warm" | "cold" | "pragmatic" | "confront";

export type SceneDecisionRecord = {
  sceneId: string;
  choiceId: DialogueChoiceId;
  label: string;              // 玩家看到的选项文案
  intentTag: SceneChoiceIntent;
  targetCharacterId?: CharacterId; // 说话人/关系对象（主角自言场景可缺省）
  relationshipDelta?: Partial<RelationshipScores>; // 结算后的实际 delta
  chapterId: ChapterId;       // 发生章节，用于下一章上下文标注
};

export type SceneChoiceOutcome = {
  record: SceneDecisionRecord;
  relationshipId?: RelationshipId;
  emotionShift?: { characterId: CharacterId; emotion: string }; // 结算后的说话人情绪
  levelBefore?: RelationshipLevel;
  levelAfter?: RelationshipLevel;
  feedback: string;           // HUD 展示文案，如 "赵冷 · 冲突 +3"
};
```

### 4.2 `Chapter`（additive）

```ts
sceneDecisions?: SceneDecisionRecord[]; // 本章场景微选择记录（按发生顺序）
```

### 4.3 `DialogueChoice`（扩展，向后兼容）

```ts
export type DialogueChoice = {
  id: DialogueChoiceId;
  label: string;
  intentTag?: SceneChoiceIntent;       // 模型标注，缺失时 resolver 按 "pragmatic" 兜底
  requirement?: { minLevel: RelationshipLevel }; // 关系门槛（M3）
};
```

### 4.4 关系等级（`lib/game/relationship-levels.ts`）

五级映射是**四轴分数的确定性推导函数**，不新增平行好感度数值（尊重"关系不是好感度"的既有设计）：

```ts
affinity = closeness * 0.6 + trust * 0.4 - conflict * 0.3
// 阈值：<20 陌生 | <40 熟悉 | <60 朋友 | <80 信任 | >=80 重要的人
deriveRelationshipLevel(scores): RelationshipLevel
levelLabel(level): "陌生" | "熟悉" | "朋友" | "信任" | "重要的人"
```

`RelationshipPresentation` 增加 `level`、`levelLabel`、`nextThreshold`（距下一级进度用）；等级跃迁在 `applySceneChoice` 返回值中体现，HUD 显示徽标与跃迁提示。

### 4.5 运行时位置持久化（additive）

`GameSave` 增加可选 `sceneRuntime?: SceneRuntimePosition { sceneIndex, blockIndex }`；章节结束/切换时清除。schemaVersion 保持 1，旧存档读取自动视为无位置。

## 5. 结算规则（scene-choice-resolver）

intent 基准剖面（可被 reducer clamp，允许触 0/100 真实边界）：

| intent | closeness | trust | conflict | 情绪倾向 |
|---|---|---|---|---|
| warm（亲近） | +3 | 0 | -1 | 开心/释然 |
| cold（疏远） | -3 | -1 | +1 | 失落/疏离 |
| pragmatic（务实） | +1 | +2 | 0 | 平静/认真 |
| confront（对抗） | -2 | +1 | +3 | 愤怒/紧张 |

修正式（确定性，无随机）：目标关系 `trust < 30` 时 warm 的 trust 改为 -1（仓促亲近不被领情）；`conflict >= 70` 时 confront 的 trust +1 改为 0（反复对抗耗尽善意）。除此之外不做统一衰减或保底——真实后果由数值边界承担。

## 6. 跨模块接口约定（供协同评审）

- 给视觉负责人（01）：场景运行时通过 `DialogueCharacter.emotion` 驱动表现，后续接入精灵时只需实现 `resolveCharacterSprite(characterId, emotion, pose?) => string | null`，返回 null 回退现有 `avatarUrl`；运行时不感知资产目录。
- 给叙事负责人（03）：主动事件入口约定为 `SceneTrigger`（下一轮实现）：{ characterId, kind: "主动联系"|"情绪事件"|"隐藏事件", sceneSeed }，由叙事层在章首注入，Scene Runtime 负责播放与选择。`SceneDecisionRecord` 的格式见 §4.1，叙事对白生成可直接引用。
- 重点文件 `LifeApp.tsx` / `chapter.ts` / `dialogue.ts` 的修改以本文档为接口讨论底稿；`world-simulator.ts`、视觉资产、NPC Agent 提示词零改动。

## 7. 数据流与错误处理

- `/api/chapter/scene-choice` 入参校验失败（choiceId 不在场景选项中、requirement 未满足、角色/关系不存在）返回 400，前端维持当前块状态可重选；网络失败同 treatment。结算端点零 LLM、不写库。
- `worldStateAfter` 回写存档后立即 autosave（新增存档节点 6：场景微选择后）。
- 模型未返回 choices（或校验拒绝）时场景自动降级为无选择播放，流程不阻断。
- `render_game_to_text` 增加 `sceneRuntime` 字段（sceneIndex/blockIndex/awaitingChoice/近期微选择）；`window.__lifeTest` 增加 `skipSceneRuntime()` 直达章末，保持幂等。

## 8. 验收

- `npm run lint`、`node scripts/test-all.mjs`、`npm run build` 全部通过；V2.2 既有测试中断言"仅展示"的用例随本规格同步升级（选择已可结算，仍禁止对白页请求 simulate/choices）。
- `test/v3-scene-runtime.test.mjs` 覆盖：状态机推进与跳过、intent 剖面不对称、等级阈值边界（20/40/60/80）、锁定选项在 resolver 层被拒、records 编译进下一章 context。
- 真实运行：`/life` galgame 模式跑通一章——章级 A/B/C 仍走完整模拟；场景内点选微选择后关系分数/等级/HUD 立即变化且存档可续。
