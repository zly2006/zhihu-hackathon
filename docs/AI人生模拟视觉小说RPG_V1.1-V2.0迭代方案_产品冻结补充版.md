# AI人生模拟视觉小说RPG V1.1-V2.0迭代方案（产品冻结补充版）

## 一、当前确认状态

经过产品层讨论，目前没有未确认的核心产品问题。

已冻结：

-   产品定位：AI人生模拟视觉小说 RPG
-   玩家身份：V1 玩家=主角，未来扩展导演模式
-   生图系统：V1不进入核心循环，作为未来扩展
-   时间结构：
    -   Life Stage：5-10年人生阶段
    -   Chapter：一年章节
    -   Scene：几天到几个月场景
    -   Dialogue Choice：关键瞬间选择

# 二、核心玩法循环

    创建主角
    ↓
    生成：
    人生主题
    人格
    家庭
    能力
    初始关系

    ↓
    进入人生阶段

    ↓
    生成Stage Goal

    ↓
    玩家选择人生方向

    ↓
    进入一年Chapter

    ↓
    Life Experience DB提供现实经验

    ↓
    World Simulator生成Canonical Event

    ↓
    Interactive Narrative Engine生成Scene

    ↓
    Galgame Dialogue Choice

    ↓
    更新：
    属性
    关系
    记忆
    目标进度

    ↓
    章节总结
    ↓
    下一阶段

# 三、Stage Goal系统

Stage Goal不是任务，而是人生阶段驱动力。

结构：

    Life Theme
        ↓
    Stage Goal
        ↓
    Event Generation
        ↓
    Choice
        ↓
    State Change

生成规则：

读取：

-   Character Profile
-   Personality
-   Family
-   Ability
-   Value
-   Memory
-   Relationship
-   World State

AI生成3-5个候选人生方向，玩家选择。

目标允许动态变化：

默认由人生经历推动改变。

特殊人格允许坚持原目标。

# 四、三层选择系统

## 1. Life Decision

人生方向选择。

影响：

-   职业
-   财富
-   地理位置
-   社交圈

## 2. Goal Choice

阶段目标选择。

影响：

-   后续事件概率
-   风险
-   成长方向

## 3. Dialogue Choice

Galgame核心。

影响：

-   Relationship
-   Emotion
-   Memory
-   Future Flag

不直接决定成功失败。

# 五、Interactive Narrative Engine

替代旧Novel Writer。

旧：

    SimulationEvent
    ↓
    Novel Writer
    ↓
    Novel

新：

    SimulationEvent
    ↓
    Narrative Director
    ↓
    Scene Plan
    ↓
    Dialogue Generation
    ↓
    Visual Novel Chapter

# 六、Scene系统

章节由Scene组成。

Scene包含：

-   时间
-   地点
-   人物
-   背景
-   表情状态
-   对话
-   选择

提前预留：

-   角色立绘
-   背景图
-   ComfyUI生图

# 七、数据库重新定位

## Life Experience Database

回答：

现实中这个选择可能导致什么。

来源：

知乎人生经验。

服务：

-   Decision Resolver
-   World Simulator

## Interactive Narrative Knowledge Base

回答：

已经发生的事情如何呈现成视觉小说。

不是小说全文库。

存储：

-   Scene Pattern
-   Dialogue Pattern
-   Conflict Pattern
-   Emotion Transition
-   Choice Pattern

服务：

-   Narrative Director
-   Scene Generator
-   Dialogue Generator

# 八、仓库复用方向

保留：

-   World Simulator
-   World Reducer
-   Character
-   Relationship
-   Memory
-   SimulationEvent

新增：

    life-theme.ts
    stage-goal.ts
    decision.ts
    scene.ts
    dialogue.ts

新增：

    decision/
     life-decision.ts
     goal-choice.ts
     dialogue-choice.ts

    narrative/
     narrative-director.ts
     scene-generator.ts
     dialogue-generator.ts

UI：

    visual-novel/
     SceneView
     DialogueBox
     ChoicePanel
     CharacterPortrait

    hud/
     GoalPanel
     RelationshipPanel
     StatsPanel
     TimelinePanel

# 九、数据库文档补充

Interactive Narrative Fragment重新定义：

不是小说片段。

而是：

互动叙事模式。

字段方向：

-   scene function
-   conflict type
-   relationship type
-   emotion curve
-   dialogue pattern
-   choice pattern
-   transferable rule

# 十、最终冻结结论

已确认：

-   玩家视角
-   时间结构
-   Stage Goal规则
-   三层选择
-   Scene结构
-   两数据库职责
-   仓库复用方向

下一阶段：

进入：

1.  TypeScript Schema设计
2.  API设计
3.  数据迁移方案
4.  文件级开发任务拆解
