# AI人生模拟视觉小说 V2.1-V3.0 开发执行方案

项目： zly2006/zhihu-hackathon

目标： 基于当前 dev/mvp-v1-interactive-life
分支，在保留现有人生模拟核心的基础上，实现从 AI 人生小说 MVP 到 AI
人生模拟视觉小说 RPG 的升级。

------------------------------------------------------------------------

# 1. 当前代码基础评估

当前分支已经包含：

-   App 前端结构
-   components UI 层
-   lib 游戏逻辑层
-   文档系统

目录：

    app/
    components/
    docs/
    lib/

后续开发不进行推倒重构。

保留：

-   World Simulation
-   Character
-   Relationship
-   Simulation Event
-   Experience Retrieval
-   Evidence Retrieval
-   Novel Writer
-   Presentation Layer
-   LLM Layer

------------------------------------------------------------------------

# 2. 总体架构改造

当前：

    用户选择

    ↓

    World Simulator

    ↓

    Simulation Event

    ↓

    Novel Writer

    ↓

    小说展示

升级：

    用户选择

    ↓

    Choice Engine

    ↓

    World Simulator

    ↓

    Narrative Director

    ↓

    ---------------------

    Novel Mode

    Galgame Mode

    ---------------------

    ↓

    Presentation Layer

    ↓

    VN UI

------------------------------------------------------------------------

# 3. 开发阶段规划

# Phase 1：V2.1 Interactive Life

目标：

将当前小说模式升级为互动人生系统。

------------------------------------------------------------------------

## 3.1 增加 Dialogue Engine

新增：

    lib/game/dialogue-writer.ts

作用：

将 Simulation Event 转换为视觉小说对白。

新增类型：

    DialogueScene

    DialogueBlock

    ChoiceNode

数据：

``` ts
DialogueScene {

background

characters

blocks

choices

}
```

DialogueBlock:

``` ts
{
type:
dialogue | narration | choice,

speaker,

text,

emotion,

avatar
}
```

------------------------------------------------------------------------

## 3.2 Character系统增强

当前角色增加：

``` ts
Character {

personality

speechStyle

emotionState

memory

relationshipHistory

secretGoals

}
```

目标：

NPC拥有独立行为逻辑。

------------------------------------------------------------------------

# Phase 2：V2.2 Galgame UI

目标：

实现视觉小说交互体验。

新增：

    components/life-vn/

    SceneStage

    DialogueBox

    CharacterAvatar

    ChoicePanel

    Timeline

    StatusHUD

UI：

    背景

    角色

    透明对白框

    选择按钮

    属性面板

    关系面板

------------------------------------------------------------------------

# Phase 3：V2.3 Timeline + Snapshot

目标：

实现人生回溯。

新增：

    lib/game/snapshot-manager.ts

保存：

``` ts
WorldSnapshot {

year

worldState

characters

relationships

memories

events

chapterContent

}
```

功能：

点击时间线：

    Timeline Node

    ↓

    Snapshot

    ↓

    Replay

增加：

    从这里重新开始人生

创建新的 Branch。

------------------------------------------------------------------------

# Phase 4：V2.4 性能优化

目标：

降低生成等待。

## 4.1 Streaming

利用已有 LLM Streaming。

用户点击后立即进入：

    正在推演人生...

然后逐步显示内容。

------------------------------------------------------------------------

## 4.2 并行生成

拆分：

    World Simulation

    知乎经验检索

    剧情规划

    文本生成

减少串行等待。

------------------------------------------------------------------------

## 4.3 Scene级生成

由：

    整章生成

改为：

    Chapter

    ↓

    Scene Plan

    ↓

    Scene1

    ↓

    Scene2

------------------------------------------------------------------------

## 4.4 Cache

缓存：

-   人生事件模板
-   知乎经验检索结果
-   Scene模板

------------------------------------------------------------------------

# Phase 5：V2.5 Narrative KB

接入第二数据库。

作用：

学习：

-   小说结构
-   Galgame文本
-   对话方式
-   剧情设计

流程：

    Simulation Event

    ↓

    Narrative KB

    ↓

    Scene Plan

    ↓

    Dialogue

------------------------------------------------------------------------

# Phase 6：V3 AI人生世界

目标：

形成长期运行的人生世界。

------------------------------------------------------------------------

## 6.1 NPC Agent

NPC拥有：

    Memory

    Personality

    Goal

    Emotion

    Belief

    Relationship

支持：

-   主动事件
-   主动交流
-   关系变化

------------------------------------------------------------------------

## 6.2 Narrative Director

新增：

    lib/game/narrative-director.ts

负责：

决定下一阶段剧情。

流程：

    World State

    ↓

    Narrative Director

    ↓

    Drama Planning

    ↓

    Scene

    ↓

    Dialogue

------------------------------------------------------------------------

## 6.3 多人生路线

支持：

-   创业路线
-   学术路线
-   感情路线
-   家庭路线
-   普通人生路线

------------------------------------------------------------------------

# 4. 文件级开发任务

## 新增文件

    lib/game/dialogue-writer.ts

    lib/game/dialogue-director.ts

    lib/game/snapshot-manager.ts

    lib/game/chapter-cache.ts

    lib/game/narrative-director.ts

------------------------------------------------------------------------

## 修改文件

优先：

    lib/game/novel-writer.ts

    lib/game/presentation.ts

    lib/domain/character.ts

    lib/domain/world.ts

    components/life-vn/*

------------------------------------------------------------------------

# 5. Agent开发顺序

## Sprint 1

完成：

-   Dialogue 数据结构
-   Dialogue Writer
-   双模式入口

验收：

可以选择：

小说模式 / Galgame模式

------------------------------------------------------------------------

## Sprint 2

完成：

-   Dialogue UI
-   角色头像
-   透明对白框
-   Choice Panel

验收：

完整跑通一次 Galgame 剧情。

------------------------------------------------------------------------

## Sprint 3

完成：

-   Snapshot
-   Timeline Replay

验收：

点击过去节点可以查看历史。

------------------------------------------------------------------------

## Sprint 4

完成：

-   Streaming优化
-   并行生成
-   Cache

验收：

生成等待明显降低。

------------------------------------------------------------------------

## Sprint 5

完成：

-   Narrative KB接入

------------------------------------------------------------------------

## Sprint 6

完成：

-   NPC Agent
-   Narrative Director

------------------------------------------------------------------------

# 6. 开发原则

1.  不修改 World Simulation 核心。
2.  Novel Mode 与 Galgame Mode 共用世界。
3.  表现层和模拟层分离。
4.  所有剧情必须由状态驱动。
5.  所有重要节点必须可保存和回溯。

------------------------------------------------------------------------

# 最终目标

构建：

一个由 AI 驱动的长期人生模拟视觉小说世界。

玩家：

做选择。

世界：

发生变化。

NPC：

拥有记忆。

人生：

可以重新探索。
