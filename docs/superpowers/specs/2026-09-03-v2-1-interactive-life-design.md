# V2.1 Interactive Life 设计规格

日期：2026-09-03
范围：V2.1 Sprint 1（双模式入口、Dialogue Engine、Character 增强）

## 1. 背景与目标

当前仓库已经完成 V1.0–V1.3 的核心链路：World State、确定性结果锚点、World Simulator、World Reducer、知乎现实参照、Narrative Plan、角色反思，以及可复用的 `life-vn` 场景与 HUD 组件。本轮不推倒重来，目标是把既有“状态驱动的人生章节”补成两种表现模式，并让 Galgame 模式消费结构化对白数据。

本轮交付后：

1. 新建或继续人生时，玩家可以选择“人生小说模式”或“Galgame 互动模式”。
2. 两种模式共用同一个 `WorldState`、选择、模拟、事件、记忆、关系和存档链路；模式只决定展示方式。
3. Galgame 模式在章节完成后拥有可持久化的 `DialogueScene[]`，其中包含场景背景、可见角色、旁白/对白/选择块。
4. 角色拥有可供对白生成使用的说话风格、表层情绪状态和关系历史；既有 `core.personalityTraits`、`memoryIds`、`privateState.hiddenGoals` 不重复复制。
5. 老存档仍能读取；没有新对白数据时，Galgame 阅读界面回退到现有 `NovelScene` 展示。

## 2. 范围边界

### 本轮包含

- `GameMode` / `presentationMode` 兼容字段与模式选择页。
- `DialogueScene`、`DialogueBlock`、`DialogueChoice` 领域类型。
- `lib/game/dialogue-writer.ts`：服务端组装上下文、调用模型、别名解析、结构校验和降级对白。
- `POST /api/chapter/dialogue`：对白生成端点；模型失败时返回确定性的降级结果，不阻断 canonical 章节。
- 将对白写入 `Chapter.dialogue`，并在现有 `ChapterSummary` 的 Galgame 阅读路径中逐块展示。
- Character 的 `speechStyle`、`emotionState`、`relationshipHistory` 可选字段与关系历史累积。
- 测试优先覆盖：模式兼容、角色增强、对白解析/降级、私有状态不进入对白 Prompt、页面接线。

### 本轮不包含

- V2.2 以后的时间线快照、分支回溯、后台 NPC Agent、Narrative Director 拆分、多路线人生。
- 三层选择系统或新的 Dialogue Choice 结算机制。Dialogue 中的 `choices` 只保留未来扩展契约；当前章节的真实行动仍由既有 `ChapterDecision` 唯一决定。
- 重写 World Simulator、World Reducer、Evidence Retriever、Narrative Engine 或数据库 schema。
- 实时生成角色立绘、生图、配音、BGM 或新增依赖。

## 3. 设计决策

### 3.1 模式与存档

在 `lib/domain/shared.ts` 增加：

```ts
export type GameMode = "novel" | "galgame";
```

在 `GameSave` 增加可选的 `presentationMode?: GameMode`，保持 `schemaVersion: 1` 不变。可选字段是为了兼容既有存档；解析旧存档时默认使用 `galgame`，因为当前 V1.3 `/life` 已经是 VN 展示，不改变老玩家的现有视觉体验。新建存档由客户端选择模式，并由 `/api/life/create` 写入该字段。

模式选择覆盖两条入口：

- “开始新人生”：选择模式后进入主角创建页。
- “继续上一次人生”：先读取存档，再选择本次表现模式；选择只更新 `presentationMode`，不改 `WorldState`、章节、事件或历史事实。

模式展示差异如下：

| 模式 | 决策页 | 章节阅读页 | 共享部分 |
| --- | --- | --- | --- |
| 人生小说模式 | 复用 `DecisionPanel` 的连续卡片布局 | 复用 `NovelReader` 连续阅读，再看结算 | 同一选择、模拟、存档和 HUD 数据 |
| Galgame 互动模式 | 复用现有 `LifeShell` + `DialogueBox` | `SceneStage` + 逐块对白/旁白 + 继续按钮 | 同一选择、模拟、存档和 HUD 数据 |

章节起点和 RPG HUD 继续复用现有 `LifeShell`、`PlayerHud`、`RelationshipHud`；模式差异集中在决策内容呈现和章节阅读内容呈现，避免重复造壳。

### 3.2 Character 增强与隐私边界

现有字段已经分别承载概念模型中的大部分内容：

| 方案概念 | 现有/本轮实现 | 处理方式 |
| --- | --- | --- |
| personality | `core.personalityTraits` + `core.values` | 不增加重复字段；对白 Prompt 读取公开人格 |
| memory | `memoryIds` + `WorldState.memories` | 不把整篇小说或全量记忆放入 Prompt |
| secretGoals | `privateState.hiddenGoals` | 只供 World Simulator/Reflection 使用；不进入 Dialogue/Presentation |
| speechStyle | `Character.speechStyle?` | 创建时初始化；NPC 生成可提供，缺失时使用稳定默认值 |
| emotionState | `Character.emotionState?` | 表层情绪基线；不复制 NPC 的私有 `currentEmotionalTrend` |
| relationshipHistory | `Character.relationshipHistory?` | 每次关系变化为双方追加一条公开历史，最多保留最近 12 条 |

新增关系历史类型：

```ts
type CharacterRelationshipHistory = {
  relationshipId: string;
  chapterId: string;
  year: number;
  relationshipType: RelationshipType;
  summary: string;
};
```

`World Reducer` 在应用 `RelationshipChange` 后，为关系双方追加同一条由 canonical 描述派生的历史；输入角色缺少旧字段时按空数组处理。`validateWorldState` 校验历史引用的关系存在，但不把历史内容暴露到 `presentation.ts` 的公开视图，除非未来另行设计 UI。

### 3.3 Dialogue 数据契约

新增 `lib/domain/dialogue.ts`，`Chapter` 增加可选 `dialogue?: DialogueScene[]`：

```ts
type DialogueChoice = {
  id: "A" | "B" | "C";
  label: string;
};

type DialogueCharacter = {
  id: CharacterId;
  name: string;
  avatarId?: string;
  avatarUrl?: string;
  position?: "left" | "center" | "right";
  emotion?: string;
};

type DialogueBlock =
  | { type: "narration"; text: string }
  | {
      type: "dialogue";
      speaker: string;
      speakerId: CharacterId;
      text: string;
      emotion: string;
      avatar?: string;
    }
  | { type: "choice"; text: string; choices: DialogueChoice[] };

type DialogueScene = {
  id: string;
  background: string; // Scene catalog id，不接受模型任意 URL
  timeLabel?: string;
  characters: DialogueCharacter[];
  blocks: DialogueBlock[];
  choices: DialogueChoice[];
};
```

`background` 保存 `scene-catalog.ts` 的 id，由服务端只允许已注册场景；模型不能注入任意资源地址。对白块的 `speaker`、`speakerId`、`avatar` 由服务端根据白名单和角色视觉身份补齐，模型只提交短别名和文本。已完成章节的 `choices` 默认为空，主决策继续由 `ChapterDecision` 保存和结算。

### 3.4 Dialogue Writer 流程

`lib/game/dialogue-writer.ts` 只接收服务端组装的公开上下文：

```text
WorldState（只取公开角色/关系/记忆摘要）
  + SimulationEvent[]（canonical）
  + NarrativePlan（可选）
        ↓
Dialogue Writer（短别名 + 结构硬约束）
        ↓
DialogueScene[]（服务端解析角色、头像、背景）
        ↓
Chapter.dialogue（可选持久化）
```

Prompt 按 Mind Flow 分层：结构字段/数量/id 是程序追加的硬约束；NPC 独立、canonical 不可改、不可将私有状态写成主角已知信息是世界规则；对白自然度、节奏和人物说话差异是叙事偏好。程序生成的当前场景数、角色别名、事件别名和背景白名单追加在 Prompt 末尾。

生成要求：

- 有 `NarrativePlan` 时场景数量和顺序与计划一致；没有计划时按事件和已生成章节场景建立有限场景数。
- `dialogue` / `narration` / `choice` 是唯一允许的块类型；文本和数组有明确上限。
- 角色只能引用本章公开角色；对白 Prompt 不包含 `privateState`、hidden goals、private beliefs 或 Reflection 内容。
- 不新增婚姻、死亡、怀孕、裁员、重大疾病等 canonical 外事实；不复制知乎来源人物经历。
- 模型输出解析或调用失败时，基于已有 `NovelScene` 生成一场景一旁白块的降级结果，背景使用确定性的 `pickSceneForNovelScene`，章节仍可完成。

## 4. 数据流与错误处理

1. 现有 `/api/chapter/simulate` 完成证据召回、确定性结果锚点、模拟校验和 reducer；此链路不修改。
2. 现有 Narrative Plan 与 Reflection 仍可并行运行；两者不依赖 Dialogue。
3. 小说生成完成后，Galgame 模式调用 `/api/chapter/dialogue`；小说模式跳过额外生成，直接保存章节小说。
4. Dialogue 端点返回结构化 JSON。模型失败时记录服务端错误并返回降级对白；网络失败时客户端不阻断章节，`Chapter.dialogue` 为空，阅读组件使用 NovelScene 回退。
5. 章节结算仍以 `worldStateAfter`、`SimulationEvent[]` 和 `stateAfterHash` 为准；Dialogue/Novel 都不能写回 canonical 状态。
6. 重写小说只更新 `Chapter.novel`，不重新模拟、不重算结果、不修改对白事实。

## 5. 文件边界

新增：

- `lib/domain/dialogue.ts`：对白领域类型。
- `lib/game/dialogue-writer.ts`：Prompt、别名映射、解析、校验、模型调用和降级生成。
- `app/api/chapter/dialogue/route.ts`：Dialogue Writer 的 Node 端点。
- `components/life/ModeSelect.tsx`：模式选择入口。
- `test/v21-interactive-life.test.mjs`：V2.1 契约与纯函数测试。

修改：

- `lib/domain/shared.ts`：增加 `GameMode`。
- `lib/domain/chapter.ts`：增加可选 `Chapter.dialogue` 与 `GameSave.presentationMode`。
- `lib/domain/character.ts`：增加可选说话风格、表层情绪、关系历史类型/字段。
- `lib/game/character-factory.ts`：初始化增强字段与模式存档。
- `lib/game/npc-generator.ts`：兼容并提示 NPC speechStyle。
- `lib/game/world-reducer.ts`、`lib/domain/validate.ts`：关系历史累积与引用校验。
- `lib/game/save.ts`：旧存档模式默认和字段校验。
- `app/api/life/create/route.ts`：接收并保存模式。
- `components/life/LifeApp.tsx`：模式选择、模式分支、对白请求与章节组装。
- `components/life/ChapterSummary.tsx`：Galgame 逐对白阅读和小说模式连续阅读。
- `components/life/NovelReader.tsx`：支持由外层控制是否显示重复的重写按钮。
- `scripts/test-all.mjs`：纳入 V2.1 测试套件。

## 6. 测试与验收

测试先行，至少覆盖以下行为：

- 新存档保存所选模式；旧存档缺失模式时默认为 `galgame`，非法值不污染模式类型。
- 主角/NPC 工厂初始化 `speechStyle`、`emotionState`、空 `relationshipHistory`；NPC 缺少模型 speechStyle 时仍能创建。
- 关系变化后双方各增加一条历史，历史最多保留 12 条，原 `WorldState` 保持不可变。
- Dialogue Prompt 含 canonical 事件和公开人物，但不含 `privateState`、hidden goal 或 private belief。
- Dialogue 解析可将短角色别名映射为真实 id，补齐 speaker/头像，拒绝幽灵角色和非法块结构。
- Dialogue 降级结果与已有 NovelScene 数量一致，背景来自场景目录，文本不为空。
- ChapterSummary 与 LifeApp 已接入 `presentationMode`、`/api/chapter/dialogue` 和 `Chapter.dialogue`；老章节无对白时仍能阅读。

验收命令：

```bash
npm run lint
node scripts/test-all.mjs
npm run build
```

涉及真实章节运行时，仍须按仓库约束验证 `/api/event` 的最终 SSE `complete`，并对本轮 `/api/chapter/dialogue` 确认 HTTP 200 返回结构化对白或明确降级结果；不能把 HTTP 200 或端口可达当作业务成功。

## 7. 后续衔接

本设计为 V2.1 Sprint 1 的最小闭环。后续 V2.2 可以在不改 `WorldState` 和 `DialogueScene` 基本契约的前提下增加多角色立绘布局、对白块动画和真实 Dialogue Choice；V2.3 再增加 Snapshot/Branch，避免本轮提前把表现层选择误写成世界状态变化。
