# Life Experience Database 与 Interactive Narrative Knowledge Base（补充冻结版）

# 一、数据库重新划分

系统包含两个数据库：

    Life Experience Database

    现实会怎样？

    +

    Interactive Narrative Knowledge Base

    如何呈现？

# 二、Life Experience Database

## 职责

回答：

现实中的人遇到这个选择，通常会发生什么。

来源：

知乎人生经验。

服务：

-   Decision Resolver
-   World Simulator

数据：

-   经历
-   选择
-   条件
-   结果
-   风险

# 三、Interactive Narrative Knowledge Base

## 职责

回答：

已经确定的人生事件，如何转化成视觉小说体验。

不是：

小说全文数据库。

存储：

-   Scene Pattern
-   Dialogue Pattern
-   Conflict Pattern
-   Emotion Curve
-   Choice Pattern
-   Relationship Progression

服务：

-   Narrative Director
-   Scene Generator
-   Dialogue Generator

# 四、数据库关系

    Player Choice

    ↓

    Life Experience DB

    ↓

    World Simulator

    ↓

    Canonical Event

    ↓

    Interactive Narrative DB

    ↓

    Scene

    ↓

    Dialogue

    ↓

    Visual Novel

# 五、Fragment重新定义

从：

Novel Fragment

改为：

Interactive Narrative Fragment

结构：

    Fragment

    =
    Scene Function
    +
    Conflict
    +
    Relationship
    +
    Emotion
    +
    Dialogue Pattern
    +
    Choice Pattern
    +
    Transferable Rule

# 六、检索流程

## Life Experience RAG

输入：

玩家人生选择

输出：

现实经验约束。

## Narrative RAG

输入：

Canonical Event

输出：

叙事结构参考。

# 七、数据结构方向

Narrative Fragment：

包含：

-   id
-   sceneFunction
-   conflictType
-   relationshipType
-   emotionCurve
-   dialoguePattern
-   choicePattern
-   qualityScore

# 八、与当前系统结合

流程：

    SimulationEvent

    ↓

    Narrative Director

    ↓

    Scene Plan

    ↓

    Dialogue

    ↓

    Visual Novel

# 九、后续扩展

未来：

-   生图
-   角色立绘
-   表情系统
-   朋友圈内容
-   LoRA训练

# 十、冻结结论

已确认：

-   两数据库独立
-   Life Experience负责现实
-   Narrative负责体验
-   两者不能互相替代
