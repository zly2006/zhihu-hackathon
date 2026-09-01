# Narrative Knowledge Base 数据采集与处理 Pipeline 设计文档

## 1. 定位

Interactive Narrative Knowledge Base（Narrative KB）是 AI
人生模拟视觉小说 RPG 的第二数据库。

目标：

不是让模型学习小说全文，而是学习：

-   人物成长模式
-   人生事件结构
-   场景设计
-   对话模式
-   冲突模式
-   玩家选择设计

------------------------------------------------------------------------

# 2. 两个数据库边界

## Life Experience Database

回答：

> 现实中这个选择可能导致什么？

来源：

-   知乎人生经验
-   真实经历
-   行业经验

服务：

-   Decision Resolver
-   World Simulator

## Interactive Narrative Knowledge Base

回答：

> 已经发生的事情如何变成优秀视觉小说体验？

服务：

-   Narrative Director
-   Scene Generator
-   Dialogue Generator

------------------------------------------------------------------------

# 3. 数据来源

## A. 人生叙事素材 Novel Corpus

当前已收集：

-   都市人生类小说
-   职场小说
-   青春成长小说
-   《活着》
-   《平凡的世界》
-   《人世间》

用途：

学习：

-   人生阶段变化
-   人物弧光
-   长期关系

------------------------------------------------------------------------

## B. Visual Novel Corpus

来源：

### Ren'Py

用途：

学习视觉小说结构：

-   Scene
-   Dialogue
-   Choice
-   Branch

### Doki Doki Literature Club相关项目

用途：

学习：

-   角色关系
-   日常事件
-   情绪变化

### VNDB

用途：

学习：

-   类型标签
-   主题标签
-   人物关系元数据

------------------------------------------------------------------------

# 4. 数据比例（Demo）

推荐：

-   40% 都市/职场/人生小说
-   30% Galgame/Visual Novel素材
-   20% 文学作品
-   10% 游戏设计资料

------------------------------------------------------------------------

# 5. 数据处理流程

## Layer 0 Raw Corpus

保存：

-   原文
-   来源
-   分类
-   元数据

结构：

raw/

-   novels/
-   vn/
-   metadata/

------------------------------------------------------------------------

## Layer 1 文本切分

不要简单按字数切。

按照：

事件和场景切分。

目标：

Narrative Unit。

例如：

不是：

第100章。

而是：

-   毕业选择
-   创业失败
-   情感冲突
-   人生转折

------------------------------------------------------------------------

## Layer 2 LLM结构化抽取

输入：

文本片段。

输出：

Narrative Fragment。

字段：

``` json
{
scene_type,
life_stage,
characters,
trigger,
conflict,
emotion_curve,
choice_points
}
```

------------------------------------------------------------------------

## Layer 3 游戏化转换

将：

故事事件

转换为：

可玩的事件。

例如：

创业失败：

转换：

选择：

A 坦白压力

B 隐瞒问题

C 放弃创业

影响：

-   relationship
-   memory
-   future_flags

------------------------------------------------------------------------

# 6. Narrative Fragment结构

``` typescript
{
id,

source,

sceneFunction,

lifeStage,

conflictType,

relationshipType,

emotionCurve,

dialoguePattern,

choicePattern,

transferableRule,

qualityScore
}
```

------------------------------------------------------------------------

# 7. 三类核心知识

## Scene Pattern

描述：

场景如何展开。

例如：

日常

↓

冲突

↓

情绪升级

↓

选择

↓

结果

------------------------------------------------------------------------

## Dialogue Pattern

描述：

对白结构。

例如：

提出问题

↓

回避

↓

情绪暴露

↓

关系变化

------------------------------------------------------------------------

## Choice Pattern

描述：

玩家选择。

例如：

-   梦想 vs 稳定
-   事业 vs 感情
-   自我 vs 家庭

------------------------------------------------------------------------

# 8. 原始对白处理

采用：

短对白样例 + 结构化信息。

保存：

-   风格
-   情绪
-   场景作用

不保存大量完整文本。

------------------------------------------------------------------------

# 9. RAG流程

SimulationEvent

↓

Narrative Query

↓

检索 Narrative Fragment

↓

Narrative Director

↓

Scene Plan

↓

Dialogue Generation

------------------------------------------------------------------------

# 10. Demo规模

建议：

原始文本：

20-50本高质量作品。

处理后：

5000-10000个 Narrative Fragment。

目标：

验证：

-   检索效果
-   剧情质量
-   选择质量

------------------------------------------------------------------------

# 11. 最终架构

Novel Corpus

-   

Visual Novel Corpus

↓

Interactive Narrative Knowledge Base

↓

Narrative Director

↓

AI人生模拟视觉小说
