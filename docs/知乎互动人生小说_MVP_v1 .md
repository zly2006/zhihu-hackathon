# 知乎真实人生经验驱动的 AI 互动人生小说

## 第一版 MVP 产品与技术方案（V1.0）

- **项目仓库**：`zly2006/zhihu-hackathon`
- **方案状态**：**V1.0 Final — 第一版 MVP 产品规则已全部冻结，无待确认产品项，可直接进入开发**
- **版本日期**：2026-08-31
- **文档目标**：作为第一版 MVP 的产品、游戏规则、数据结构、RAG、AI 编排、前端、API、存档、迁移、测试与验收基线
- **重要说明**：本文中的所有范围均指 **第一版 MVP**，不代表最终产品上限

---

# 1. 产品定义

## 1.1 一句话定义

> 一个以知乎真实人生经历作为现实经验底座、由大模型负责长期世界推演和小说叙事的多角色互动人生小说。

玩家只直接控制一名主角。系统维护主角与 3 名核心 NPC 的长期状态、目标、记忆和关系。每一章玩家为主角选择一次重要人生方向，系统检索相关知乎真实经历作为现实参照，随后推演未来 1 年或 3 年，并将已经确定的结构化人生事件文学化为一章可阅读的互动小说。

## 1.2 产品核心不是“AI 写小说”

第一版 MVP 的核心不是简单地：

```text
玩家选择 → LLM → 一段小说
```

而是：

```text
当前世界状态
    ↓
主角面临的人生困境
    ↓
玩家选择行动方向
    ↓
知乎真实人生经验 RAG
    ↓
程序规则 + World Simulator
    ↓
结构化、不可随意改写的 SimulationEvent[]
    ↓
更新人物、关系与记忆
    ↓
Novel Writer 文学化
    ↓
章节阅读与状态总结
    ↓
进入下一章
```

因此系统中的三种数据必须永久分离：

1. **知乎 LifeExperience**：现实世界中别人经历过什么，只作为经验和证据。
2. **SimulationEvent**：本局游戏世界里已经发生什么，是本局的 canonical facts（规范事实）。
3. **Chapter Novel**：对 canonical facts 的文学表达，可重写文风，但不能改变事实。

---

# 2. 第一版 MVP 的明确范围

## 2.1 已确认的 MVP 规则

| 项目 | 第一版 MVP 决策 |
|---|---|
| 玩家控制对象 | 只控制 1 名主角 |
| 开局年龄 | 固定 18 岁 |
| NPC | 系统生成 3 名核心 NPC；玩家可改名字、关系和基础设定 |
| NPC 控制 | NPC 自主行动，玩家不能替 NPC 做决定 |
| 临时角色 | 允许老板、老师、同事等临时角色出现在小说中，但不进入持久 WorldState |
| 时间跨度 | 每章开始可重新选择 **1 年**或**3 年** |
| 玩家每章决策 | 只做 1 次主决策：A / B / C / 自定义 |
| 结果控制 | 玩家决定“行动”，不直接决定“成功或失败” |
| 1 年关键事件 | 2–4 个 |
| 3 年关键事件 | 4–8 个 |
| 重大转折 | 每章最多 1–2 个 |
| 主角数值 | cash / health / happiness / knowledge / connections / career / assets，均 0–100 |
| 关系数值 | closeness / trust / conflict / commitment，均 0–100 |
| 小说视角 | 主角第二人称“你” |
| 1 年小说长度 | 约 1200–2000 中文字 |
| 3 年小说长度 | 约 2500–4000 中文字 |
| 小说形态 | 多场景章节，不写成三年流水账 |
| 长期记忆 | 结构化记忆，不依赖整篇小说作为上下文 |
| 知乎作用 | 为候选方向和世界推演提供现实经验，不直接决定剧情 |
| 每章证据量 | 目标约 18 条，保持当前项目量级 |
| 小说重生成 | 可以重写小说文风，但不得改变已确定的 SimulationEvent |
| 存档 | 第一版客户端本地自动存档，不新增可写业务数据库 |
| 固定结局 | 第一版无固定结局，可持续推进 |
| 未来年份 | 可以原创人物未来，但不得虚构真实历史、政策或现实事件为事实 |
| 极端随机事件 | MVP 不主动随机制造死亡、绝症、犯罪等极端剧情 |
| AI 生图 / 配音 / BGM | 第一版不做 |

## 2.2 第一版明确不做

第一版 MVP **不是**完整社会模拟器，以下内容不进入当前范围：

- 不允许玩家直接控制 NPC。
- 不做数十、数百个持久 NPC。
- 不做多人联机。
- 不做第二代、家族继承、遗产系统。
- 不做完整死亡、绝症、犯罪随机事件系统。
- 不做完整经济系统和精确人民币资产模拟。
- 不做每个场景实时生成插画。
- 不做语音合成、BGM、动态演出。
- 不让 LLM 自由修改已经发生的历史事实。
- 不要求第一版先扩充到几十万或几百万条知乎语料。
- 不在当前应用仓库直接修改上游知乎数据库 schema。

---

# 3. 核心设计原则

## 3.1 玩家控制行动，不控制结果

玩家选择：

```text
A. 留在现在的公司争取晋升
B. 加入一家创业公司
C. 离开深圳回武汉发展
D. 自定义行动
```

玩家并不是选择：

```text
A. 成功晋升
B. 创业暴富
C. 回武汉幸福生活
```

后果由以下因素共同决定：

```text
人物底色
+ 当前资源状态
+ 当前目标与困境
+ 人物关系
+ NPC 自主选择
+ 时代背景
+ 知乎相似真实经历
+ 规则化风险与一定不确定性
```

这样玩家负责“人生选择”，系统负责“人生后果”。

## 3.2 现实锚定，但不做知乎内容拼贴

知乎不负责替模型写小说。

知乎的作用是回答：

> “现实中，和这个人背景相似、做出相似选择的人，可能经历过什么？”

模型可以原创人物互动、日常场景和对白，例如：

> 林雨凌晨一点打电话过来，两个人都没有先说话。

但不能凭空改写硬事实，例如：

- 已经分手的人突然又是同居状态；
- 已经离开深圳的人下一页又每天从深圳通勤；
- 2029 年突然出现一个被写成真实历史事实的虚构国家政策。

## 3.3 世界模拟与文学创作分离

禁止一步直接生成完整三年小说并把文本当世界状态。

必须先生成：

```text
SimulationEvent[]
CharacterChange[]
RelationshipChange[]
Memory[]
```

再生成小说。

## 3.4 人物必须“有底色，但会成长”

人物属性分成两部分：

### 相对稳定

- 核心人格 traits
- values
- talents
- 原生背景

### 可以演化

- 当前目标
- 当前困境
- 职业 / 城市 / 社会身份
- 对婚姻、事业、风险等态度
- 人际关系
- Hooks 的解决与新增
- 记忆与长期反思

角色应该经历十几年以后仍然“像同一个人”，但又不是 18 岁人格永远冻结。

---

# 4. 参考作品与设计借鉴

这一项目并不是照搬某一个已有游戏，而是组合多个成熟作品中已经验证过的机制。

## 4.1 Wildermyth —— 人物 Hook、关系条件与程序化事件

**参考内容**：

- 角色有 history、personality、relationship。
- Hook 是由角色历史产生的性格缺陷、执念或人物问题，可触发专属人物任务。
- 关系可以成为事件触发条件。

**本项目借鉴**：

```text
Character.hooks
Relationship
事件条件
```

例如：

```text
张明 Hook：极度害怕阶层下滑
林雨 Hook：需要稳定家庭生活
两人关系：恋人，冲突 61
当前事件：张明获得外地高薪 offer
```

这些共同决定某些人生矛盾是否应该出现。

参考：
- https://wildermyth.com/wiki/Hook
- https://wildermyth.com/wiki/Event_Types

## 4.2 I Was a Teenage Exocolonist —— Narrative Octopus

该游戏并非简单的一棵巨大分支树，而是由主线、多条人物线、世界事件和条件事件同时推进的“叙事章鱼”。NPC 和世界事件可以在玩家没有亲眼目睹时继续发生。

**本项目借鉴**：

> 玩家不控制 NPC，不意味着 NPC 在等待玩家。

例如一章中玩家主要选择职业方向，但与此同时：

- 林雨可能考上公务员；
- 王浩可能准备结婚；
- 陈楠可能创业失败；
- 某段友情可能因为长期不联系而自然减弱。

参考：
- https://northwaygames.com/the-narrative-octopus-of-i-was-a-teenage-exocolonist/

## 4.3 Our Life: Beginnings & Always —— 多年关系记忆

该作品跨多个年龄阶段，并让角色记住玩家过去形成的性格、感情和关系，重要 NPC 自身也会因多年共同经历而改变。

**本项目借鉴**：

- 人物不是“静态 NPC 卡片”。
- Relationship 必须有历史。
- NPC 的态度、目标和关系类型允许长期变化。
- 角色记忆要影响未来剧情，而不是每章从零开始。

参考：
- https://store.steampowered.com/app/1129190/Our_Life_Beginnings__Always/

## 4.4 The Life and Suffering of Sir Brante —— 章节式整个人生

该游戏按章节推进整个人生，持续记录 deeds、skills 和其他条件，早期选择会改变后续能进入的剧情。

**本项目借鉴**：

- Chapter 是一等数据结构，而不是单纯文本。
- 每一章结束都有可持久化的世界快照。
- 过去发生过的事情持续成为后续条件。

参考：
- https://store.steampowered.com/app/1272160/

## 4.5 Choice of Robots —— 数十年互动小说

这是约 30 万词的互动小说，故事覆盖主角约 30 年人生，长期选择影响事业、关系、婚姻、家庭和整个世界。

**本项目借鉴**：

- “数十年人生 + 文学化章节”本身是可成立的游戏体验。
- 一次选择的影响可以几年后才显现。

本项目与之不同的是，分支不是全部由作者预写，而是由结构化世界模型 + RAG + LLM 动态生成。

参考：
- https://www.choiceofgames.com/robots/index.html

## 4.6 Chinese Parents / 中国式家长 —— 中国语境的人生数值化

其价值不主要在叙事引擎，而在“中国现实语境 + 人生阶段 + 数值反馈”的可视化表达。

**本项目借鉴**：

- 人生数值的可读性。
- 中国人生阶段与社会现实的 UI 表达。
- 状态反馈需要游戏化，而不是做成严肃社会学模拟器。

参考：
- https://store.steampowered.com/app/736190/Chinese_Parents/

## 4.7 Generative Agents —— NPC 记忆、反思、计划

Stanford / Google 的 Generative Agents 研究展示了 25 个 Agent 通过：

```text
Observation
→ Memory
→ Retrieval
→ Reflection
→ Planning
→ Interaction
```

产生长期、可传播的社会行为。

**本项目借鉴但简化**：

第一版只有 3 个核心 NPC，不做实时 Agent 小镇，但采用：

```text
CharacterMemory
+ CurrentGoal
+ HiddenIntent
+ Relationship
→ NPC chapter action
```

参考：
- https://dl.acm.org/doi/10.1145/3586183.3606763
- https://arxiv.org/abs/2304.03442

## 4.8 本项目真正的差异化

已有作品分别解决了某一部分问题，但第一版的组合重点是：

```text
Wildermyth 的人物 Hook / 关系条件
+
Exocolonist 的多线世界持续演化
+
Our Life 的长期人物记忆
+
Sir Brante / Choice of Robots 的长期人生章节
+
Generative Agents 的记忆与 NPC 自主行为思想
+
知乎真实人生 Experience RAG
```

产品差异点不是“用了 LLM”，而是：

> **真实人生经验锚定的长期人物关系与人生世界模拟。**

---

# 5. 用户完整流程

## 5.1 Landing

展示：

- 产品定位；
- 知乎真实经验数量；
- 登录知乎（如果 OAuth 配置可用）；
- 新人生；
- 继续上一次人生。

## 5.2 创建主角

第一版采用半结构化创建。

玩家填写：

- 姓名；
- 出生年份；
- 性别；
- 家乡；
- 家庭背景；
- 初始城市；
- 当前身份 / 起点方向；
- 3–5 个性格标签；
- 2–4 个价值观；
- 1 个长期目标；
- 1 个初始困境；
- 5 项 talents 点数。

固定：

```text
currentAge = 18
currentYear = birthYear + 18
```

知乎账号授权存在时，只用昵称和头像作为默认值，不自动读取用户真实知乎内容推断人生。

## 5.3 生成 3 个核心 NPC

AI 根据主角背景生成 3 个与主角人生有实际连接的人。

NPC 类型不要求固定，但通常覆盖不同社会关系，例如：

- 家人；
- 好友；
- 同学 / 同事；
- 潜在伴侣。

玩家可以修改：

- 名字；
- 初始关系类型；
- 一句基础设定。

玩家不能修改：

- AI 生成后的所有隐藏心理状态；
- 后续自主行为结果。

## 5.4 第一章开始

玩家选择：

```text
1 年 / 章
3 年 / 章
```

系统展示：

- 当前年份；
- 主角状态；
- 3 名 NPC 的公开状态；
- 重要关系；
- 上一章留下的目标 / 困境。

## 5.5 生成本章核心困境和 3 个行动方向

示例：

> 你在深圳的软件公司工作两年，团队刚刚经历一轮调整。一家创业公司向你发出邀请，而林雨最近越来越认真地讨论未来定居城市。

```text
A. 留在现公司争取下一次晋升
B. 接受创业公司的邀请
C. 回武汉寻找新的工作机会
D. 自定义行动
```

## 5.6 玩家选择

玩家只选择主角做什么。

如果选择“自定义”，系统先把自由文本规范化为可模拟的行动：

```text
原输入：
“我想先不辞职，但是利用半年看看武汉有没有更好的机会，然后再决定。”

标准行动：
保留现职，同时用半年时间探索武汉工作机会，再根据 offer 决定是否迁移。
```

## 5.7 知乎证据检索

系统根据：

```text
主角背景
+ 当前状态
+ 玩家行动
+ 当前关系冲突
+ 当前时代环境
```

构造多角度检索，形成约 18 条 EvidenceBundle。

## 5.8 世界模拟

World Simulator 不写小说，只决定这一章发生什么。

输出：

- 2–4 / 4–8 个关键事件；
- 主角状态变化；
- NPC 变化；
- 关系变化；
- 新目标；
- 新矛盾；
- 已解决问题；
- 新记忆。

## 5.9 小说生成

Novel Writer 只能根据已经确定的 SimulationEvent 写小说。

它可以创造：

- 场景；
- 对白；
- 过渡；
- 氛围；
- 日常细节。

它不能创造与 SimulationEvent 冲突的重大事实。

## 5.10 章末结算

展示四块：

### 本章小说

阅读完整章节。

### 关键事件时间轴

```text
2028.04  接受新项目
2028.12  林雨离开深圳
2029.08  晋升失败
2030.01  双方第一次认真讨论定居问题
```

### 人物状态

```text
事业      61 → 68
健康      72 → 64
幸福感    58 → 53
```

### 人物关系

```text
你 ↔ 林雨
亲密：72 → 58
信任：68 → 63
冲突：31 → 61
承诺：54 → 49
```

同时展示：

> 本章推演参考了 18 条知乎真实经历

展开最相关的 3–5 条来源卡。

## 5.11 下一章

新的 WorldState 成为下一章唯一权威起点。

---

# 6. 系统总架构

```text
                    ┌──────────────────┐
                    │ 知乎原始数据仓库 │
                    │   READ ONLY      │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │ ExperienceAdapter│
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │ LifeExperience   │
                    │ EvidenceBundle   │
                    └────────┬─────────┘
                             │
            ┌────────────────┴────────────────┐
            │                                 │
            ▼                                 ▼
  ┌───────────────────┐             ┌───────────────────┐
  │ Current WorldState│             │   EraContext      │
  └─────────┬─────────┘             └─────────┬─────────┘
            │                                 │
            └──────────────┬──────────────────┘
                           ▼
                 ┌──────────────────┐
                 │ Choice Generator │
                 └────────┬─────────┘
                          │ A/B/C/Custom
                          ▼
                 ┌──────────────────┐
                 │ Decision Resolve │
                 │ 程序规则/风险锚点│
                 └────────┬─────────┘
                          ▼
                 ┌──────────────────┐
                 │ World Simulator  │
                 └────────┬─────────┘
                          │
                          ▼
                    SimulationEvent[]
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
       Update WorldState        Novel Writer
              │                       │
              ▼                       ▼
       CharacterMemory              Chapter
              │                       │
              └───────────┬───────────┘
                          ▼
                     Local Save
```

---

# 7. 核心数据结构

第一版以 **7 个核心对象**为主：

1. `Character`
2. `Relationship`
3. `CharacterMemory`
4. `WorldState`
5. `LifeExperience`
6. `SimulationEvent`
7. `Chapter`

`EvidenceBundle`、`ChapterDecision`、`DecisionResolution`、`GameSave` 等属于辅助契约，不算核心世界对象。

---

# 8. Supporting Types

```ts
type CharacterId = string;
type RelationshipId = string;
type MemoryId = string;
type ExperienceId = string;
type SimulationEventId = string;
type ChapterId = string;

type ChapterSpan = 1 | 3;

type LifeDomain =
  | "education"
  | "career"
  | "finance"
  | "housing"
  | "relocation"
  | "entrepreneurship"
  | "romance"
  | "marriage"
  | "family"
  | "parenting"
  | "friendship"
  | "health"
  | "social"
  | "loss"
  | "aging";

type LifeStats = {
  cash: number;
  health: number;
  happiness: number;
  knowledge: number;
  connections: number;
  career: number;
  assets: number;
};

type Talents = {
  insight: number;
  charm: number;
  grit: number;
  learning: number;
  luck: number;
};
```

所有 `LifeStats` 必须约束为 `0..100`。

注意：

- `cash` 是现金安全度指数，不是人民币余额。
- `assets` 是资产积累指数，不代表真实房产价值。
- 小说不得把 `cash = 20` 写成“只剩 20 元”。

---

# 9. Character

## 9.1 设计目的

Character 同时用于主角和核心 NPC。

NPC 与主角使用同一个基础结构，区别只在：

```ts
role: "protagonist" | "npc"
```

这样 NPC 才是真正拥有状态的人，而不是主角旁边的一段描述文字。

## 9.2 TypeScript 结构

```ts
type Character = {
  id: CharacterId;
  role: "protagonist" | "npc";

  identity: {
    name: string;
    birthYear: number;
    gender: string;
    hometown: string;
    familyBackground: string;
  };

  core: {
    personalityTraits: string[]; // 3-5
    values: string[];            // 2-4
    talents: Talents;
    hooks: CharacterHook[];      // 最多 3 个活跃 Hook
  };

  state: {
    age: number;
    year: number;
    city: string;
    occupation: string;
    socialIdentity: string;
    stats: LifeStats;

    currentGoals: CharacterGoal[];
    currentDilemmas: string[];
    attitudes: Record<string, number>;
  };

  privateState?: {
    hiddenGoals: string[];
    hiddenConcerns: string[];
    privateBeliefs: string[];
  };

  memoryIds: MemoryId[];

  createdAt: string;
  updatedAt: string;
};

type CharacterHook = {
  id: string;
  label: string;
  description: string;
  status: "active" | "resolved" | "transformed";
  originMemoryId?: MemoryId;
  resolvedAtChapterId?: ChapterId;
};

type CharacterGoal = {
  id: string;
  label: string;
  horizon: "short" | "medium" | "long";
  priority: number; // 0-100
  status: "active" | "achieved" | "abandoned" | "blocked";
};
```

## 9.3 Character 的硬规则

- MVP 主角始终从 18 岁开始。
- 核心人格不能每章随意重写。
- `hooks` 最多 3 个 active，避免 Prompt 膨胀。
- `currentGoals` 允许变化。
- NPC 的 `privateState` 默认不直接展示给玩家。
- 小说只能通过 NPC 的行为、对白、可观察迹象表现隐藏状态。

---

# 10. Relationship

## 10.1 TypeScript 结构

```ts
type Relationship = {
  id: RelationshipId;

  characterAId: CharacterId;
  characterBId: CharacterId;

  type:
    | "family"
    | "friend"
    | "close_friend"
    | "classmate"
    | "coworker"
    | "partner"
    | "spouse"
    | "ex_partner"
    | "rival"
    | "estranged"
    | "other";

  scores: {
    closeness: number;
    trust: number;
    conflict: number;
    commitment: number;
  };

  publicSummary: string;

  unresolvedIssues: Array<{
    id: string;
    description: string;
    severity: number;
    introducedAtChapterId: ChapterId;
  }>;

  milestoneEventIds: SimulationEventId[];

  status: "active" | "distant" | "ended";

  updatedAt: string;
};
```

## 10.2 关系不是“好感度”

四个数值必须可以并存：

例如一对结婚多年的夫妻可能：

```text
closeness = 76
trust = 81
conflict = 68
commitment = 92
```

即：

> 很亲密、很信任、冲突很多，但仍高度承诺。

因此不把 Relationship 简化成单一 `love = 80`。

## 10.3 关系变化规则

每章单个关系维度通常变化：

```text
轻微：1–5
明显：6–12
重大：13–20
```

超过 12 必须有明确关键事件支持。

关系类型变化必须有事件，例如：

```text
friend → partner
partner → spouse
partner → ex_partner
friend → distant
```

不能只因为模型想制造戏剧冲突直接改变关系类型。

---

# 11. CharacterMemory

## 11.1 为什么不能直接把所有小说塞进 Prompt

长期玩 20 章以后可能产生数万甚至十几万字小说。

如果每章全部回传：

- Token 成本不断增长；
- 模型注意力被无关细节稀释；
- 缓存前缀容易失效；
- 更容易产生事实冲突。

因此小说是“阅读档案”，而 CharacterMemory 是“游戏长期记忆”。

## 11.2 TypeScript 结构

```ts
type CharacterMemory = {
  id: MemoryId;
  characterId: CharacterId;

  year: number;
  chapterId: ChapterId;
  eventId?: SimulationEventId;

  type:
    | "event"
    | "relationship"
    | "achievement"
    | "setback"
    | "promise"
    | "conflict"
    | "reflection";

  summary: string;

  relatedCharacterIds: CharacterId[];
  domains: LifeDomain[];

  importance: number; // 0-100
  emotionalValence: -2 | -1 | 0 | 1 | 2;

  permanentFact: boolean;
  active: boolean;
};
```

## 11.3 每章记忆策略

每章产生 **3–6 条**长期记忆。

下一章使用：

```text
永久事实
+
最近 2 章摘要
+
与当前选择最相关的最多 8 条长期记忆
+
当前活跃 Hooks
```

而不是最近 N 条简单截断。

检索 Memory 时评分建议：

```text
score =
  relevance * 0.45
+ importance * 0.30
+ recency * 0.15
+ relationship_match * 0.10
```

第一版可先由规则和关键词实现，不强制再增加一套 memory embedding。

---

# 12. WorldState

## 12.1 WorldState 是本局游戏唯一权威状态

```ts
type WorldState = {
  schemaVersion: 1;
  gameId: string;

  currentYear: number;
  protagonistId: CharacterId;

  characters: Record<CharacterId, Character>;
  relationships: Record<RelationshipId, Relationship>;
  memories: Record<MemoryId, CharacterMemory>;

  chapterIds: ChapterId[];

  eraContext?: EraContextSnapshot | null;

  openThreads: StoryThread[];

  canonicalEventIds: SimulationEventId[];

  updatedAt: string;
};

type StoryThread = {
  id: string;
  label: string;
  description: string;
  domain: LifeDomain;
  relatedCharacterIds: CharacterId[];
  urgency: number;
  status: "open" | "resolved" | "dormant";
};
```

## 12.2 为什么需要 openThreads

它相当于“叙事章鱼”的轻量实现。

例如：

```text
Thread 1：张明的晋升瓶颈
Thread 2：林雨希望回武汉
Thread 3：张明和父亲多年沟通困难
```

不是每一章都必须解决所有 Thread。

模型应优先：

- 推进 1–2 条；
- 保留一部分；
- 允许部分变成 dormant；
- 由新事件产生新 Thread。

避免“每章所有矛盾同时爆炸”。

---

# 13. LifeExperience

这是知乎与游戏融合最重要的数据结构。

## 13.1 第一版目标

不是把整篇知乎回答直接送给 LLM，而是把已有数据库中的决策经历映射成结构化现实案例。

现有数据库已经有：

```text
context
decision
action
outcome
confidence
domain / blocking_key
source_url
author
embedding
```

因此第一版可以构建 Adapter，而不是先重做上游数据工程。

## 13.2 TypeScript 结构

```ts
type LifeExperience = {
  id: ExperienceId;

  source: {
    platform: "zhihu";
    url: string;
    title: string;
    author: string | null;
    authorUrl: string | null;
    avatarUrl: string | null;
    evidenceExcerpt?: string;
  };

  context: {
    ageRange?: [number, number] | null;
    lifeStage?: string | null;
    education?: string | null;
    occupation?: string | null;
    industry?: string | null;
    city?: string | null;
    cityTier?: string | null;
    incomeBand?: string | null;
    assetBand?: string | null;
    relationshipStatus?: string | null;
    children?: number | null;
    familyBackground?: string | null;
    relevantTraits: string[];
  };

  situation: {
    domains: LifeDomain[];
    eventType: string;
    trigger: string;
    dilemma: string;
    constraints: string[];
    goals: string[];
  };

  decision: {
    action: string;
    alternatives: string[];
    motivations: string[];
    voluntariness: "主动" | "被迫" | "混合" | "未知";
    riskLevel: "低" | "中" | "高" | "未知";
  };

  outcomes: {
    shortTerm: LifeOutcome[];
    mediumTerm: LifeOutcome[];
    longTerm: LifeOutcome[];
  };

  relationshipEffects: RelationshipExperienceEffect[];

  causalNotes: {
    claimedReasons: string[];
    possibleMediators: string[];
    uncertainties: string[];
  };

  retrieval: {
    tags: string[];
    keywords: string[];
    qualityScore: number;
    similarity: number;
  };
};

type LifeOutcome = {
  dimension:
    | "career"
    | "cash"
    | "health"
    | "happiness"
    | "knowledge"
    | "social"
    | "relationship"
    | "family";

  direction: "positive" | "negative" | "mixed" | "neutral";
  magnitude: "small" | "medium" | "large" | "unknown";
  description: string;

  horizon: "months" | "1_year" | "3_years" | "long_term" | "unknown";
  explicitInSource: boolean;
};

type RelationshipExperienceEffect = {
  actorRole:
    | "partner"
    | "parent"
    | "child"
    | "friend"
    | "coworker"
    | "boss"
    | "other";

  dimension: "closeness" | "trust" | "conflict" | "dependency" | "commitment";
  direction: "increase" | "decrease" | "mixed";
  cause: string;
  description: string;
};
```

## 13.3 第一版 Adapter 的允许缺失原则

当前上游数据库并没有所有这些结构化字段。

MVP **禁止让模型为了填满字段而硬猜**。

例如不知道年龄：

```ts
ageRange: null
```

不知道婚姻状态：

```ts
relationshipStatus: null
```

第一版 `ExperienceAdapter` 可以把现有字段映射成：

```ts
{
  source,
  situation: {
    domains: [blockingKey],
    trigger: context,
    dilemma: decision
  },
  decision: {
    action
  },
  outcomes: {
    shortTerm: [{ description: outcome }]
  }
}
```

其余字段为空。

等 MVP 验证有效，再回上游数据仓库做批量 LifeExperience V2 抽取。

---

# 14. EvidenceBundle

## 14.1 为什么不能只做 Top-18 相似度

如果用户选择“辞职创业”，纯相似度可能召回大量“创业成功”内容，造成幸存者偏差。

EvidenceBundle 要主动保持视角多样性。

## 14.2 结构

```ts
type EvidenceBundle = {
  querySummary: string;
  total: number; // MVP 目标 18

  backgroundSimilar: LifeExperience[];
  decisionSimilar: LifeExperience[];
  relationshipRelevant: LifeExperience[];
  outcomeContrasts: LifeExperience[];

  balance: {
    positive: number;
    negative: number;
    mixed: number;
    unknown: number;
  };
};
```

## 14.3 MVP 分配目标

不是严格硬配额，但推荐：

```text
背景/阶段相似        4–6
行动选择相似        5–7
关系影响相关        3–5
结果反例/补充        3–5
总去重后            ≈18
```

同一个知乎 URL 最多出现一次。

如果数据不足，不为了满足配额引入明显不相关案例。

## 14.4 第一版如何利用现有单向量

当前仓库已经使用 `bge-large-zh-v1.5:scenario-text-v2` 向量。

MVP 不强制马上重算四套 embedding。

第一版做法：

1. 保留现有 domain / keyword 预过滤；
2. 使用现有向量做语义候选召回；
3. 对候选的 `context / decision / action / outcome` 分别做轻量规则打分；
4. 根据当前 Relationship 问题增加关系关键词权重；
5. 来源 URL 去重；
6. 组装 EvidenceBundle。

后续 V2 再考虑：

```text
context embedding
decision embedding
outcome embedding
relationship embedding
```

---

# 15. SimulationEvent

## 15.1 世界模拟结果必须结构化

```ts
type SimulationEvent = {
  id: SimulationEventId;
  chapterId: ChapterId;

  year: number;
  month?: number | null;
  order: number;

  title: string;
  summary: string;

  domain: LifeDomain;

  participantIds: CharacterId[];

  causes: Array<{
    type: "player_choice" | "prior_event" | "relationship" | "npc_goal" | "era" | "other";
    refId?: string;
    description: string;
  }>;

  characterChanges: CharacterChange[];
  relationshipChanges: RelationshipChange[];

  evidenceIds: ExperienceId[];

  importance: number;
  visibility: "known_to_protagonist" | "partially_known";

  createsThreadIds: string[];
  resolvesThreadIds: string[];
};

type CharacterChange = {
  characterId: CharacterId;

  statDelta?: Partial<LifeStats>;

  cityChange?: { from: string; to: string };
  occupationChange?: { from: string; to: string };
  socialIdentityChange?: { from: string; to: string };

  addGoalIds?: string[];
  resolveGoalIds?: string[];

  description: string;
};

type RelationshipChange = {
  relationshipId: RelationshipId;

  scoreDelta: Partial<{
    closeness: number;
    trust: number;
    conflict: number;
    commitment: number;
  }>;

  typeChange?: {
    from: Relationship["type"];
    to: Relationship["type"];
  };

  addIssue?: string;
  resolveIssueId?: string;

  description: string;
};
```

## 15.2 SimulationEvent 是不可随意重写的事实

一旦 World Simulator 成功完成并通过校验：

```text
SimulationEvent[] = canonical
```

之后：

- Novel Writer 不能改；
- 用户重新生成小说不能改；
- 下一章直接读取；
- 本地存档保存。

---

# 16. Chapter

```ts
type Chapter = {
  id: ChapterId;
  index: number;

  startYear: number;
  endYear: number;
  span: ChapterSpan;

  stateBeforeHash: string;

  decision: ChapterDecision;
  resolution: DecisionResolution;

  evidence: {
    experienceIds: ExperienceId[];
    featuredExperienceIds: ExperienceId[];
  };

  simulationEventIds: SimulationEventId[];

  stateAfterHash: string;

  novel: {
    title: string;
    subtitle?: string;
    scenes: NovelScene[];
    generatedAt: string;
    version: number;
  };

  summary: {
    keyEvents: string[];
    characterChanges: string[];
    relationshipChanges: string[];
    openThreads: string[];
  };

  memoryIds: MemoryId[];

  createdAt: string;
};

type NovelScene = {
  id: string;
  heading?: string;
  timeLabel?: string;
  text: string;
};
```

Chapter 保存的是：

```text
选择
+ 证据引用
+ 真实模拟结果引用
+ 小说
+ 摘要
```

但真正的世界状态仍由 WorldState 决定。

---

# 17. ChapterDecision 与 DecisionResolution

```ts
type ChapterDecision = {
  id: string;
  promptTitle: string;
  context: string;

  options: Array<{
    id: "A" | "B" | "C";
    label: string;
    description: string;
    strategyTag: string;
    estimatedRisk: number;
    stateFit: "顺势" | "可行" | "吃力";
  }>;

  selectedOptionId: "A" | "B" | "C" | "CUSTOM";
  customAction?: string;
  normalizedAction: string;
};

type DecisionResolution = {
  effectiveRisk: number;
  outcomeAnchor: "favorable" | "mixed" | "setback";
  uncertaintySeed: string;
  reasonSummary: string;
};
```

## 17.1 为什么保留程序规则的 outcomeAnchor

当前仓库已经有成熟的：

```text
baseRisk
stateFit
talents
resource scarcity
era adjustment
settleChoice
```

第一版不全部丢弃，而是将其从“直接决定整章所有数值变化”改为：

> **程序先给 World Simulator 一个可复现的结果倾向锚点；World Simulator 再解释这个结果具体怎样发生。**

例如：

```text
选择：加入创业公司
有效风险：48
本章主决策结果锚点：mixed
```

World Simulator 可以生成：

- 收入短期改善；
- 工作强度上升；
- 项目发展低于最初预期；
- 获得新的行业人脉。

而不是非黑即白地“成功 / 失败”。

## 17.2 outcomeAnchor 的确定性随机算法（已冻结）

第一版 MVP 不允许 LLM 自己决定“运气”。结果倾向由程序计算，而且同一存档、同一章节、同一选择必须得到同一个随机结果。

### 17.2.1 可复现随机种子

```text
saveId
+ chapterIndex
+ decisionId
+ normalizedAction
        ↓
SHA-256
        ↓
uncertaintySeed
        ↓
映射为 [0, 1) 的 deterministicRoll
```

推荐实现：

```ts
function deterministicRoll(seed: string): number {
  const hex = sha256(seed).slice(0, 13);
  const value = Number.parseInt(hex, 16);
  return value / 0x1fffffffffffff;
}
```

`uncertaintySeed` 必须持久化进 `DecisionResolution`，用于调试、回放和一致性测试。

### 17.2.2 三级结果分布

`effectiveRisk` 仍使用现有 `mechanics.ts` 的思路综合：

```text
baseRisk
+ 资源稀缺惩罚
+ stateFit 修正
+ EraContext 修正
- talents 保护
```

然后将 `effectiveRisk` 映射为三个概率区间。MVP 固定采用：

```ts
const setbackProbability = clamp(0.08 + effectiveRisk * 0.0035, 0.08, 0.40);
const favorableProbability = clamp(0.40 - effectiveRisk * 0.0035, 0.10, 0.40);
const mixedProbability = 1 - setbackProbability - favorableProbability;
```

其中 `effectiveRisk` 为 0–100。这样 **mixed 永远是主要结果区间**，高风险主要增加 setback、减少 favorable，而不是把人生压成二元成功/失败。

示例：

| effectiveRisk | favorable | mixed | setback |
|---:|---:|---:|---:|
| 20 | 33% | 52% | 15% |
| 40 | 26% | 52% | 22% |
| 70 | 15.5% | 52% | 32.5% |
| 90 | 10% | 50.5% | 39.5% |

判定顺序固定为：

```ts
if (roll < favorableProbability) outcomeAnchor = "favorable";
else if (roll < favorableProbability + mixedProbability) outcomeAnchor = "mixed";
else outcomeAnchor = "setback";
```

### 17.2.3 程序与 World Simulator 的职责边界

程序只确定：

```text
effectiveRisk
outcomeAnchor
uncertaintySeed
```

程序**不预先写死**诸如 `cash +5 / health -4` 的整章结果。World Simulator 必须结合人物状态、NPC、关系、知乎 EvidenceBundle 和时代背景，把该结果锚点解释成一组合理的 `SimulationEvent[]` 与状态变化。

约束：

- `favorable` 不等于“毫无代价的成功”，仍允许出现成本和副作用；
- `mixed` 应是最常见情况，通常同时包含收益、代价和未解决问题；
- `setback` 不等于“人生毁灭”，必须保留现实可恢复性，除非已有硬事实支持更严重后果；
- World Simulator 不得把 `setback` 偷改成全面成功，也不得把 `favorable` 偷改成彻底失败；
- 同一 `uncertaintySeed` 必须可重复回放出同一 `outcomeAnchor`。

## 17.3 禁止刷结果

同一章 canonical simulation 一旦生成：

- 不允许点击“再来一次”刷新人生结果；
- 可以重写小说；
- 可以回到更早存档节点重新选择另一条路。

---

# 18. NPC 自主行为规则

## 18.1 NPC 每章至少经过一次内部决策

World Simulator 对每个核心 NPC 考虑：

```text
Character.core
+ Character.state.currentGoals
+ privateState
+ 最近相关 Memory
+ Relationship
+ 主角本章行动
```

但并不是每个 NPC 每章都必须发生重大事件。

## 18.2 NPC 行为优先级

```text
1. 生存 / 健康等必要约束
2. 高优先级 currentGoals
3. 与主角关系中的 unresolvedIssues
4. 活跃 Hook
5. 日常发展
```

## 18.3 NPC 不为服务玩家而存在

例如：

玩家回武汉，并不代表伴侣自动跟随。

NPC 可以根据自己的：

- 工作；
- 家庭；
- 城市；
- 价值观；
- 对关系的承诺程度；

选择留下、等待、妥协、争执或离开。

这正是人物关系合理化的核心。

---

# 19. World Simulator 输入契约

建议服务端组装，不允许前端直接自由拼 Prompt。

```ts
type WorldSimulationInput = {
  chapter: {
    id: ChapterId;
    startYear: number;
    endYear: number;
    span: ChapterSpan;
  };

  protagonistId: CharacterId;

  characters: Character[];
  relationships: Relationship[];

  relevantMemories: CharacterMemory[];
  openThreads: StoryThread[];

  decision: ChapterDecision;
  resolution: DecisionResolution;

  evidenceBundle: EvidenceBundle;

  eraContext?: EraContextSnapshot | null;
};
```

---

# 20. World Simulator 输出契约

```ts
type WorldSimulationOutput = {
  events: SimulationEvent[];

  newMemories: CharacterMemory[];

  goalUpdates: Array<{
    characterId: CharacterId;
    add: CharacterGoal[];
    update: CharacterGoal[];
  }>;

  hookUpdates: Array<{
    characterId: CharacterId;
    add?: CharacterHook[];
    resolveIds?: string[];
  }>;

  threadUpdates: {
    create: StoryThread[];
    resolveIds: string[];
    dormantIds: string[];
  };

  chapterSummary: {
    keyEvents: string[];
    characterChanges: string[];
    relationshipChanges: string[];
    unresolvedQuestions: string[];
  };
};
```

## 20.1 服务端必须校验

- 1 年：2–4 events。
- 3 年：4–8 events。
- 最多 1–2 个重大事件。
- 所有 participantId 必须存在。
- 所有 relationshipId 必须存在。
- 所有 evidenceId 必须来自本次 EvidenceBundle。
- stat delta 必须有限数字。
- Relationship delta 必须在允许范围内。
- 关系类型变化必须对应明显事件。
- 不允许年份超出章节区间。
- 不允许已有死亡角色等不存在状态（MVP 暂无死亡系统）。
- 不允许凭空编造真实未来政策、公司价格、真实名人行为。

校验失败时使用当前项目已有的“追加具体错误项后重试”思想，而不是静默修补叙事。

---

# 21. Novel Writer

## 21.1 Novel Writer 输入

```text
人物底色（必要部分）
+ 本章开始状态
+ 本章 SimulationEvent[]
+ 关系变化
+ 相关记忆
+ 少量知乎现实参照摘要
```

但知乎原文不是主要写作材料。

## 21.2 Novel Writer 硬约束

1. 第二人称“你”。
2. 不得改变 SimulationEvent 的年份、结果、关系变化。
3. 不直接展示主角不可能知道的 NPC 秘密心理。
4. 可以通过行为暗示 NPC 隐藏想法。
5. 不把知乎作者原经历复制给游戏角色。
6. 不引用大段知乎原文。
7. 1 年 1200–2000 中文字。
8. 3 年 2500–4000 中文字。
9. 使用多个场景推进。
10. 避免流水账“第一年……第二年……第三年……”。

## 21.3 Novel Writer 输出也用 JSON

为了最大程度复用当前 `callGameModel<T>()` 的严格 JSON 流式解析能力，第一版建议 Novel Writer 返回：

```json
{
  "title": "深圳没有春天",
  "subtitle": "2027—2030",
  "scenes": [
    {
      "heading": "三月",
      "timeLabel": "2027.03",
      "text": "……"
    }
  ]
}
```

前端再把 `scenes[].text` 渲染成视觉小说章节。

这比新增一条完全自由文本模型链路更稳。

---

# 22. 知乎 RAG 详细方案

## 22.1 当前数据库边界

当前项目明确要求：

```text
DK_DATABASE_URL
→ readonly PostgreSQL role
```

当前应用：

- 可以读取业务表；
- 不能创建表；
- 不能修改 schema；
- 不负责 Alembic migration；
- 不负责上游数据同步。

**MVP 必须保持这一边界。**

## 22.2 第一版不需要“大量新增知乎原文”

第一阶段最重要的是验证：

> 当前已有的 decision episode 候选，能否通过更好的结构化和检索方式让故事明显更真实。

先提高：

```text
覆盖质量
> 单纯语料数量
```

如果 MVP 好玩，再扩展上游 LifeExperience V2。

## 22.3 RAG Pipeline

```text
WorldState
   │
   ├─ protagonist context
   ├─ decision
   ├─ relationship conflict
   └─ era context
        ↓
Query Builder
        ↓
Domain Filter
        ↓
Existing BGE Vector Recall
        ↓
Candidate Pool
        ↓
Context / Decision / Outcome / Relationship Re-rank
        ↓
Source URL Dedup
        ↓
Evidence Balance
        ↓
18 LifeExperience
```

## 22.4 检索不是因果推断

Prompt 必须告诉 World Simulator：

> 每条知乎内容只是个案。某作者做某件事以后成功，不代表同样行动必然成功。

LifeExperience 中明确保留：

```text
claimedReasons
possibleMediators
uncertainties
```

如果当前 Adapter 没有这些字段，则默认为：

```text
uncertainties = ["单一个案，不能视为确定因果规律"]
```

---

# 23. 时代背景 EraContext

现有项目已经有：

- 非典；
- 金融危机；
- 移动互联网扩张；
- 新冠；
- 教育培训转型；
- 就业承压等时代节点。

第一版继续复用。

## 23.1 历史年份

如果章节落在已有 EraDefinition：

```text
EraContext
→ 检索关键词
→ 风险修正
→ World Simulator 环境约束
```

## 23.2 未来年份（已冻结）

超过可靠历史事实范围后，第一版 MVP **默认生成“弱假设的通用社会背景”**，用于给人物选择提供必要环境约束；`eraContext = null` 仅作为生成或校验失败时的技术 fallback，不作为正常产品路径。

未来 EraContext 只能描述宽泛、低承诺的世界条件，例如：

> “行业竞争仍然存在，不同公司的招聘强度出现分化。”

> “自动化工具继续改变部分岗位的工作方式与技能要求。”

> “不同城市之间的生活成本、家庭支持和职业机会仍存在取舍。”

禁止生成或暗示未经证实的具体未来现实事实，例如：

> “2032 年国家正式出台 XX 法案……”

> “2033 年某真实公司发生万人裁员……”

> “2035 年爆发某次确定命名的金融危机……”

只有当某事件在**实际生成时点**已经成为可验证的公开事实，才能作为历史/现实 EraContext 使用。

未来背景属于**本局虚构世界的弱约束**，不是对现实未来的事实预测。Novel Writer 在表达时也不得把这些弱假设写成现实世界必然会发生的历史。

### 23.2.1 fallback 规则

如果未来 EraContext 生成失败、结构校验失败或包含具体未经证实的未来事实：

1. 首先尝试删除具体事实并降级成通用背景；
2. 仍不合格时设为 `null`；
3. World Simulator 继续仅依据人物状态、关系、记忆和知乎经验工作；
4. 不允许为了“必须有 EraContext”而编造政策、公司、灾害或宏观事件。

---

# 24. 状态结算

## 24.1 保留当前 0–100 游戏指数体系

```text
cash
health
happiness
knowledge
connections
career
assets
```

第一版继续使用当前仓库已有机制，这是非常值得复用的部分。

## 24.2 数值变化来源

```text
DecisionResolution
+ SimulationEvent.characterChanges
+ Era effects
+ Resource constraints
```

最终由程序应用并 clamp 到 0–100。

LLM 不能直接改整个 WorldState JSON。

它只能提交 delta：

```ts
{ health: -5, career: +4 }
```

服务端负责：

- 类型检查；
- 边界检查；
- 实际结算；
- 生成 stateAfter。

## 24.3 归零不代表强制 Game Over

沿用当前仓库思想：

- cash 归零 → 财务危机；
- health 归零 → 长期恢复；
- happiness 归零 → 身心低谷；
- career 归零 → 职业中断。

后续章节应优先出现现实的修复路径，而不是直接结束游戏。

---

# 25. 存档结构

## 25.1 MVP 使用客户端存档

建议继续使用 `localStorage`，采用 versioned JSON。

```ts
type GameSave = {
  schemaVersion: 1;

  savedAt: string;

  worldState: WorldState;

  chapters: Record<ChapterId, Chapter>;
  events: Record<SimulationEventId, SimulationEvent>;

  experienceCache: Record<ExperienceId, LifeExperience>;
};
```

`experienceCache` 只保存本局实际引用过的必要展示信息，不保存整库。

## 25.2 为什么 MVP 先用 localStorage

当前游戏无实时图片和音频资源，主要存 JSON 与小说文本。

第一版数据量可控，使用 localStorage：

- 实现简单；
- 与现有项目兼容；
- 无需增加可写服务端数据库；
- 不影响只读知乎数据库治理边界。

如果后续章节数很多或增加图片，再迁移 IndexedDB / 服务端账户存档。

## 25.3 自动保存节点

必须在以下节点自动保存：

1. 人物创建完成；
2. NPC 创建完成；
3. 玩家选择确认；
4. canonical simulation 完成；
5. 小说生成完成；
6. 进入下一章。

尤其要在第 4 步保存，避免小说生成失败导致已经模拟成功的人生结果丢失。

---

# 26. API 设计

第一版建议拆成三个主要 AI API，而不是把所有逻辑继续挤在 `/api/event`。

## 26.1 `POST /api/chapter/choices`

输入：

```ts
{
  worldState,
  span: 1 | 3
}
```

执行：

```text
memory retrieval
+ era context
+ zhihu evidence preliminary retrieval
+ choice generation
```

输出 SSE：

```ts
ChapterDecision
```

## 26.2 `POST /api/chapter/simulate`

输入：

```ts
{
  worldState,
  decision,
  span
}
```

执行：

```text
normalize custom action if needed
→ retrieve EvidenceBundle
→ DecisionResolution
→ World Simulator
→ validate
→ apply deltas
```

输出：

```ts
{
  evidenceBundle,
  resolution,
  simulation,
  worldStateAfter
}
```

SSE 展示检索、模型生成和校验进度。

## 26.3 `POST /api/chapter/novel`

输入：

```ts
{
  stateBefore,
  stateAfter,
  events,
  relevantMemories,
  featuredEvidence
}
```

输出：

```ts
Chapter["novel"]
```

## 26.4 `/api/custom-action`

现有接口可继续保留，也可以最终并入 `/api/chapter/simulate` 的 action normalization。

MVP 开发初期建议先保留，减少迁移范围。

---

# 27. 前端页面与组件

## 27.1 页面状态

```ts
type Screen =
  | "landing"
  | "setup"
  | "npc_setup"
  | "chapter_start"
  | "decision"
  | "simulating"
  | "reading"
  | "chapter_summary";
```

不再以旧版 `ending` 为核心，因为 MVP 没有固定结局。

## 27.2 推荐组件拆分

```text
components/
  life/
    LandingPage.tsx
    ProtagonistSetup.tsx
    NpcSetup.tsx

    ChapterHeader.tsx
    DecisionPanel.tsx
    CustomActionInput.tsx
    SimulationProgress.tsx

    NovelReader.tsx
    NovelScene.tsx

    CharacterPanel.tsx
    CharacterCard.tsx
    CharacterStats.tsx

    RelationshipPanel.tsx
    RelationshipCard.tsx

    TimelinePanel.tsx
    ChapterSummary.tsx
    EvidencePanel.tsx
    ZhihuEvidenceCard.tsx
```

## 27.3 视觉小说 MVP

第一版视觉小说感来自：

- 人物头像 / 立绘占位区；
- 小说 / 对白主阅读区域；
- 年月标签；
- 场景切换；
- 角色卡；
- 状态栏；
- 关系变化动画 / 数值；
- 关键事件时间轴。

不是依赖实时 AI 生图。

---

# 28. 当前仓库评估

仓库当前本质上已经是：

> Next.js + React 的知乎人生模拟应用，拥有真实数据库检索、向量召回、LLM 严格 JSON 生成、SSE 流、状态结算、时代背景、知乎 OAuth 和完整单页游戏 UI。

因此 **不建议重写项目**。

正确策略是：

> 保留基础设施，替换和扩展玩法域模型。

---

# 29. 当前仓库：可直接复用 / 改造 / 重构矩阵

| 当前内容 | 复用等级 | MVP 处理 |
|---|---:|---|
| Next.js 16 / React 19 / TypeScript | ★★★★★ | **直接保留** |
| `pg` PostgreSQL 连接 | ★★★★★ | **直接保留** |
| 只读数据库治理边界 | ★★★★★ | **必须保留** |
| `lib/llm.ts` Provider / SSE 解析 / 重试 / 日志 | ★★★★★ | **高复用**，扩展 purpose，不重写底层 |
| `app/api/event` SSE 模式 | ★★★★★ | **复用模式**，拆成 choices / simulate / novel |
| `lib/database.ts` 真实经历查询 | ★★★★☆ | **保留查询基础，重构为 EvidenceRetriever** |
| BGE `scenario-text-v2` 向量 | ★★★★☆ | **MVP 继续用**，未来再升级多 embedding |
| `Experience` 来源 / 作者卡 | ★★★★☆ | **前端 DTO 保留**，底层升级 LifeExperience |
| `Profile` | ★★★☆☆ | **演进为 Character.identity/core** |
| `LifeState` | ★★★★☆ | **核心数值保留**，变成 `Character.state.stats` |
| `GameOption` | ★★★☆☆ | **改造为 ChapterDecision option** |
| `TimelineEntry` | ★★☆☆☆ | 被 `Chapter + SimulationEvent + Memory` 取代 |
| `lib/mechanics.ts` | ★★★★☆ | 风险、资源、归零机制保留；结算职责调整 |
| `lib/era.ts` | ★★★★☆ | 历史 EraContext 直接复用并扩展 |
| `event-style-reference.ts` | ★★☆☆☆ | 可借鉴写作规则，但不再作为核心事件结构 |
| `/api/custom-action` | ★★★★☆ | MVP 可继续复用，后续合并 |
| 知乎 OAuth / avatar proxy | ★★★★★ | **直接保留** |
| 当前 Landing / setup 视觉语言 | ★★★★☆ | **保留设计语言并调整文案** |
| 当前状态栏 | ★★★★★ | **直接演进** |
| 当前知乎 Evidence 卡 | ★★★★★ | **直接演进** |
| 当前人生时间线 | ★★★★☆ | **演进为章节 + 事件双层时间线** |
| `components/restart-life.tsx` | ★★☆☆☆ | 约 60KB 的集中式组件，应拆分，而非继续膨胀 |
| `app/globals.css` | ★★★☆☆ | 可复用现有视觉样式，但逐步按组件整理 |
| 旧“从 0 岁出生”流程 | ★☆☆☆☆ | MVP 改为 18 岁开局 |
| 旧固定 precision | ★★☆☆☆ | 改为每章选择 1 / 3 年 |
| 旧单角色模型 | ★☆☆☆☆ | 升级为 WorldState 多角色模型 |
| 旧随机结局 / ending 概念 | ★☆☆☆☆ | MVP 无固定结局 |

---

# 30. 仓库具体文件评估

## 30.1 `package.json` —— 基本不需要改技术栈

当前主要依赖：

```text
next 16.3.2
react 19.2.8
react-dom 19.2.8
pg
lucide-react
typescript
```

完全足够第一版 MVP。

**不建议为了重构游戏而顺便换框架。**

可能新增的依赖应非常克制。第一版甚至可以不增加新的状态管理库。

## 30.2 `lib/types.ts` —— 重点重构

当前已经有：

```text
Profile
LifeState
Experience
GameOption
GameEvent
TimelineEntry
EraContext
```

其中：

### 保留思想

```text
LifeState 的 7 个指数
Experience 的来源展示
EraContext
model conversation / generation metrics
```

### 重构

```text
Profile → Character
TimelineEntry → Chapter + SimulationEvent + CharacterMemory
GameEvent → ChapterDecision / SimulationOutput
```

建议不要把所有新类型继续放在一个 `types.ts`。

改成：

```text
lib/domain/
  character.ts
  relationship.ts
  memory.ts
  world.ts
  experience.ts
  simulation.ts
  chapter.ts
  shared.ts
```

## 30.3 `lib/database.ts` —— 高价值复用

当前已经完成：

- PostgreSQL pool；
- domain 阶段过滤；
- keyword 过滤；
- BGE 向量读取；
- cosine；
- URL 去重；
- history exclusion；
- 18 条真实案例组装；
- 来源作者信息映射。

这是非常有价值的现成能力。

### 改造目标

从：

```ts
retrieveExperiences(profile, age, historyKey, state)
```

逐步演进成：

```ts
retrieveEvidence({
  protagonist,
  relationships,
  decision,
  eraContext,
  usedExperienceIds
}): Promise<EvidenceBundle>
```

第一版底层 SQL 可以大量保留。

## 30.4 `lib/llm.ts` —— 高价值直接复用

当前已经处理：

- provider：OpenCodeGo / DeepSeek；
- reasoning effort；
- 流式生成；
- JSON object；
- token 粗估；
- first-token metrics；
- cache metrics；
- 超时；
- slow stream retry；
- LLM call audit log。

新版本只需要给它增加不同 purpose：

```text
chapter-choice
world-simulation
chapter-novel
npc-generation
custom-action
```

而不需要重写模型调用层。

## 30.5 `lib/game.ts` —— 最大的重构点

当前 `game.ts` 同时承担：

- Prompt；
- 事件结构；
- validation；
- retrieval orchestration；
- narrative hygiene；
- model calls；
- 风险校准。

新版本继续向里面塞 NPC、关系、小说会使其不可维护。

建议拆成：

```text
lib/game/
  choice-generator.ts
  evidence-retriever.ts
  decision-resolver.ts
  world-simulator.ts
  simulation-validator.ts
  world-reducer.ts
  memory-selector.ts
  novel-writer.ts
  chapter-orchestrator.ts
```

`game.ts` 最终只做兼容出口或删除。

## 30.6 `lib/mechanics.ts` —— 保留但改变职责

当前：

```text
resourceContext
effectiveRiskForOption
calibrateOptionRisks
settleChoice
newlyZeroedCrises
advanceAge
```

其中：

### 直接保留

```text
resource bands
0-100 clamp
risk calibration 思路
归零危机
Era risk adjustment
```

### 改造

`advanceAge(age, profile.precision)` 不再依赖 Profile 固定 precision：

```ts
advanceAge(age, chapterSpan)
```

`settleChoice` 不再独自生成整章最终后果，而用于产生 `DecisionResolution.outcomeAnchor`。

## 30.7 `lib/era.ts` —— 高价值复用

当前已经把真实年代事件做成：

```text
EraDefinition
→ age frame
→ domain
→ keywords
→ mechanisms
→ settlement
```

这非常适合继续作为：

- RAG query 扩展；
- World Simulator 背景；
- 风险修正。

只需要注意未来年份不要硬生成虚构真实事件。

## 30.8 `components/restart-life.tsx` —— 保留 UI 思想，拆组件

现有组件已经有：

- Landing；
- Setup；
- ZhihuAccount；
- StatRail；
- TimelineRail；
- Evidence UI；
- SSE progress；
- 自定义行动；
- 调试工具；
- 危机 Dialog；
- 恢复存档。

这些 UI 功能不应该浪费。

但文件本身约 60KB，已经是明显的集中式组件。

新版本增加：

- NPC；
- Relationship；
- NovelReader；
- ChapterSummary；
- WorldState；

以后必须拆分。

## 30.9 `/api/event` —— 保留 SSE 模式，不保留单事件职责

当前优点：

```text
HTTP 建立 SSE
progress
complete
error
```

业务上明确 `complete` 才算成功。

这一模式应该成为三个新 AI API 的统一模式。

## 30.10 `/api/custom-action` —— 可直接复用思路

当前已经：

- 限制用户文本长度；
- 规范自定义行动；
- 返回结构化后果。

MVP 先改为规范化 `ChapterDecision.normalizedAction` 即可。

---

# 31. 推荐的新目录结构

```text
app/
  api/
    chapter/
      choices/route.ts
      simulate/route.ts
      novel/route.ts
    custom-action/route.ts
    auth/...
    avatar/...

components/
  life/
    LandingPage.tsx
    ProtagonistSetup.tsx
    NpcSetup.tsx
    DecisionPanel.tsx
    SimulationProgress.tsx
    NovelReader.tsx
    ChapterSummary.tsx
    CharacterPanel.tsx
    RelationshipPanel.tsx
    TimelinePanel.tsx
    EvidencePanel.tsx

lib/
  domain/
    shared.ts
    character.ts
    relationship.ts
    memory.ts
    world.ts
    experience.ts
    simulation.ts
    chapter.ts

  game/
    npc-generator.ts
    choice-generator.ts
    decision-resolver.ts
    evidence-retriever.ts
    experience-adapter.ts
    memory-selector.ts
    world-simulator.ts
    simulation-validator.ts
    world-reducer.ts
    novel-writer.ts
    chapter-orchestrator.ts

  database.ts
  llm.ts
  mechanics.ts
  era.ts
  zhihu-auth.ts
```

---

# 32. 从现有类型到新类型的迁移

```text
Profile
├─ identity fields ─────────────→ Character.identity
├─ talents ─────────────────────→ Character.core.talents
└─ precision ───────────────────→ 删除，移到 Chapter.span

LifeState
├─ age ─────────────────────────→ Character.state.age
└─ 7 stats ─────────────────────→ Character.state.stats

Experience
└─ 前端展示 DTO ────────────────→ LifeExperience source + summary

GameOption
└─ ─────────────────────────────→ ChapterDecision.options

GameEvent
├─ dilemma ─────────────────────→ ChapterDecision
├─ options ─────────────────────→ ChapterDecision
└─ experiences ─────────────────→ EvidenceBundle

TimelineEntry
├─ choice ──────────────────────→ Chapter.decision
├─ effects ─────────────────────→ SimulationEvent.characterChanges
├─ result ──────────────────────→ SimulationEvent
└─ historical context ──────────→ Chapter + CharacterMemory
```

---

# 33. 兼容迁移策略

第一版开发期间不要求已有旧存档自动升级成新多角色世界。

建议：

```text
旧存档 schemaVersion = legacy
新存档 schemaVersion = 1
```

如果发现旧存档：

> “当前存档来自旧版人生重启模式，可继续使用旧模式；新互动人生需要创建新存档。”

不要在 MVP 花大量时间猜测如何从旧单角色历史自动生成 3 个长期 NPC。

---

# 34. LLM Prompt 分层

每个 AI 任务的 Prompt 都分成三类规则。

## 34.1 结构硬约束

程序可以机械验证：

- JSON schema；
- events 数量；
- id 合法；
- year 范围；
- delta 数字范围；
- evidence 引用合法。

## 34.2 世界规则

例如：

- 已发生事实不可修改；
- NPC 是独立人物；
- 知乎是个案不是因果；
- 重大转折必须有前因；
- 未来不得伪造现实历史。

## 34.3 叙事偏好

例如：

- 克制；
- 避免鸡汤；
- 第二人称；
- 多场景；
- 关系通过细节表现。

这三层不能混成一个巨大 Prompt。

---

# 35. 失败恢复与事务语义

AI 链路有 3 个阶段，必须允许局部重试。

## 35.1 Choice Generator 失败

- 不改变 WorldState；
- 直接重试。

## 35.2 World Simulator 失败

- 不改变 WorldState；
- 不写 canonical events；
- 修正 JSON / validation 后重试。

## 35.3 World Simulator 成功、Novel Writer 失败

此时：

```text
SimulationEvent 已 canonical
WorldStateAfter 已保存
```

只重试 Novel Writer。

**绝不能为了小说失败重新模拟人生结果。**

---

# 36. 隐私与来源展示

## 36.1 知乎证据卡

用户看到：

- 标题；
- 作者；
- 头像；
- 极短经历摘要；
- 原回答链接。

小说正文不显示真实知乎作者名字。

## 36.2 不把真实知乎用户直接变成 NPC

NPC 是虚构人物。

知乎 Experience 只提供现实经验规律和参考，不把某位真实回答者的人生完整复制给 NPC。

---

# 37. MVP 开发阶段

## Phase 0：冻结设计与建立新类型

目标：不改玩法，只建立新 domain model。

完成：

- 7 个核心类型；
- GameSave v1；
- WorldState reducer；
- 基础 validation。

## Phase 1：主角 + NPC + WorldState

完成：

- 18 岁主角创建；
- 3 NPC 生成；
- Relationship 初始化；
- 本地新存档；
- Character / Relationship UI。

暂时不生成小说。

## Phase 2：Choice Generator

把当前 `/api/event` 的“情境 + 选项”能力迁移成：

```text
WorldState → ChapterDecision
```

完成 A/B/C + Custom。

## Phase 3：知乎 EvidenceBundle

重构 `retrieveExperiences`：

```text
retrieveEvidence(world + decision)
```

保留现有 18 条实际数据库召回。

## Phase 4：World Simulator

完成：

- DecisionResolution；
- SimulationEvent；
- NPC 行动；
- Relationship delta；
- memory；
- world reducer。

这是 MVP 最关键阶段。

## Phase 5：Novel Writer

完成：

```text
canonical events → chapter scenes
```

确保重新生成小说不改变 canonical events。

## Phase 6：完整 UI

完成：

- 小说阅读；
- 人物状态；
- 关系面板；
- 时间线；
- 知乎现实参照；
- 章节推进。

## Phase 7：稳定性 / 测试

- 极端状态；
- 长期 10+ 章；
- NPC 一致性；
- RAG 不相关案例；
- 模型超时；
- 页面刷新；
- 小说重生成；
- 存档恢复。

---

# 38. 第一版核心测试场景

## Case A：职业选择影响恋爱关系

```text
主角：29 岁程序员
城市：深圳
伴侣：希望回武汉
选择：接受深圳创业公司 offer
```

验收：

- 检索到职业 + 城市 + 关系相关案例；
- NPC 不自动服从；
- 结果具有现实代价；
- 关系变化有明确事件原因。

## Case B：低现金状态

```text
cash = 8
选择：裸辞休息一年
```

验收：

- 不能因为游戏“怕失败”禁止选择；
- 风险显著提高；
- 如果出现 setback，允许 cash 归零；
- 后续世界出现求助、兼职、降低支出等现实路径。

## Case C：小说重生成

同一 SimulationEvent：

```text
2029.08 晋升失败
```

连续重写两次小说。

验收：

- 文风和对白可不同；
- 晋升失败事实必须相同；
- Relationship delta 必须相同；
- WorldState hash 不变化。

## Case D：NPC 独立性

主角希望伴侣跟自己迁移。

NPC：

```text
career 高
家庭目标高
当前城市工作稳定
```

验收：

NPC 可以合理拒绝，不能总是为玩家服务。

## Case E：未来年份

游戏推进到 2035。

验收：

- 可以有虚构行业环境；
- 不得将虚构政策写成现实历史事实；
- 知乎证据仅用于人类经验，不伪造未来知乎答案。

---

# 39. MVP 验收标准

第一版完成并不是“页面能打开”，至少满足：

## 39.1 功能

- [ ] 能创建 18 岁主角。
- [ ] 自动生成 3 个核心 NPC。
- [ ] 每名角色拥有独立 Character state。
- [ ] 建立主角与核心 NPC Relationship。
- [ ] 每章可选 1 年 / 3 年。
- [ ] 生成 A/B/C + 自定义行动。
- [ ] 每章实际从知乎数据库召回约 18 条经历。
- [ ] World Simulator 产生符合数量限制的 SimulationEvent。
- [ ] NPC 可以自主行动。
- [ ] Relationship 可以有合理变化。
- [ ] 结构化事件更新 WorldState。
- [ ] 生成 3–6 条长期记忆。
- [ ] Novel Writer 生成符合长度的小说章节。
- [ ] 小说重生成不改变 canonical events。
- [ ] 章末显示人物状态和关系变化。
- [ ] 展示知乎现实参照卡。
- [ ] 页面刷新后可恢复存档。
- [ ] 可连续完成至少 10 章。

## 39.2 技术

- [ ] `npm run lint` 通过。
- [ ] `npm run build` 通过。
- [ ] AI SSE 必须最终返回 `complete`。
- [ ] World Simulation JSON 经程序严格校验。
- [ ] 任何 invalid id / NaN / 越界 delta 被拒绝。
- [ ] 数据库仍使用只读账户。
- [ ] 不读取全量知乎数据进入模型上下文。
- [ ] LLM 超时不会破坏当前 WorldState。
- [ ] canonical simulation 成功后小说失败可以单独恢复。

## 39.3 体验

随机挑选 5 个不同起点连续玩至少 5 章：

- [ ] 人物没有明显人格漂移。
- [ ] NPC 不像主角的附属工具。
- [ ] 同一个矛盾不会每章重复从零发生。
- [ ] 重大事件有前因。
- [ ] 不频繁出现狗血极端事件。
- [ ] 知乎案例与当前选择具有明显相关性。
- [ ] 小说不是知乎内容拼贴。
- [ ] 1 / 3 年章节都能保持时间线清晰。

---

# 40. 成功指标

第一版不先追求 DAU 等商业指标，优先验证三个产品假设。

## 假设 1：真实经验 RAG 是否明显提高“现实感”

对照：

```text
With Zhihu Evidence
vs
Without Evidence
```

让测试者盲评：

- 哪个更像真实人生；
- 哪个后果更合理；
- 哪个更少“AI 味”。

## 假设 2：长期 NPC 是否提高故事投入感

测试：

> 玩家到第 5 章是否能主动说出 2–3 个 NPC 的目标、矛盾或关系历史？

如果不能，NPC 系统只是装饰。

## 假设 3：结构化模拟是否比直接写小说更连续

连续 10 章检查：

- 城市；
- 职业；
- 关系；
- 年龄；
- 历史事件；

是否出现明显吃书。

---

# 41. MVP 之后再考虑的 V2

如果第一版验证成功，再进入：

- LifeExperience 上游批量重新抽取；
- 多 embedding 检索；
- 更多核心 NPC；
- 临时角色晋升为核心 NPC；
- Relationship 网络从“主角中心”变为完整 NPC↔NPC；
- 更完整 Character Reflection；
- 服务端账户存档；
- 章节插画；
- 语音；
- 人物立绘持续一致性；
- 死亡 / 生育 / 下一代；
- 退休与人生总结；
- 自定义世界模式；
- 多玩家共享世界。

这些全部不应该阻塞第一版 MVP。

---

# 42. 最终 MVP 核心公式

整个第一版可以压缩成这一条：

```text
主角是谁
+
NPC 各自是谁
+
他们过去发生过什么
+
他们现在是什么关系
+
玩家这次决定做什么
+
现实中类似的人经历过什么
+
当前时代和资源允许什么
↓
World Simulator：未来 1 / 3 年发生什么
↓
SimulationEvent：把事实固定下来
↓
WorldState：人物和关系真正改变
↓
Novel Writer：把这段人生写成一章小说
↓
玩家阅读、观察结果、再做下一次人生选择
```

这就是第一版 MVP 的完整核心。

---

# 43. 开发优先级结论

现在不应该做的第一件事是继续加功能，也不应该先扩充海量知乎语料。

实际开发顺序应当是：

```text
① 新 Domain Types
   ↓
② WorldState + 3 NPC + Relationship
   ↓
③ 把旧 GameEvent 改成 ChapterDecision
   ↓
④ 把旧 retrieveExperiences 改成 EvidenceBundle
   ↓
⑤ World Simulator + World Reducer
   ↓
⑥ Memory
   ↓
⑦ Novel Writer
   ↓
⑧ 完整章节 UI
   ↓
⑨ 连续 10 章稳定性测试
```

最关键的工程节点不是“小说能写出来”，而是：

> **在没有小说文本参与状态计算的情况下，WorldState 能连续正确地推进十章。**

只要这一点成立，小说层、模型层、知乎数据层和 UI 层以后都可以独立升级。

---

# 44. 当前仓库改造总判断

## 可以直接保住的资产

- Next.js / React / TypeScript 技术栈；
- 知乎 OAuth；
- PostgreSQL readonly 接入；
- 真实知乎经历数据库；
- BGE 向量召回；
- 来源 URL / 作者 / 头像卡；
- LLM Provider 与 SSE；
- JSON validation 思路；
- 生成 metrics；
- EraContext；
- 0–100 人生状态；
- 风险 / 资源 / 危机结算思想；
- 当前 Landing、状态栏、时间线和知乎证据的视觉语言。

## 必须重构的部分

- 单主角 `Profile + LifeState` 世界模型；
- `GameEvent` 一次事件即一轮的结构；
- `TimelineEntry` 承担过多历史职责；
- `game.ts` 的职责集中；
- `restart-life.tsx` 的职责集中；
- 固定 `profile.precision`；
- 从 0 岁开始的旧人生流程；
- “事件生成即剧情事实”的单阶段 LLM 流程。

## 必须新增的部分

- Character；
- Relationship；
- CharacterMemory；
- WorldState；
- LifeExperience Adapter；
- EvidenceBundle；
- SimulationEvent；
- World Simulator；
- World Reducer；
- Chapter；
- Novel Writer；
- NPC 自主行为；
- 新版 GameSave。

最终结论：

> **这是一次“保留基础设施、重建玩法内核”的升级，不是重新做一个项目。**

