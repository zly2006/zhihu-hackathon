# AI人生模拟视觉小说项目 V2.1-V3.0 迭代方案

版本：V1.0

目标：

基于当前 `zhihu-hackathon`
MVP，实现从「AI人生小说生成器」向「AI人生模拟视觉小说 / Galgame」演进。

------------------------------------------------------------------------

# 一、当前项目状态评估

当前 MVP 已经具备：

-   人生世界模拟
-   人物系统
-   关系系统
-   人生事件系统
-   知乎真实经历检索
-   Novel Writer
-   Presentation Layer
-   LLM Streaming

当前核心链路：

    用户选择

    ↓

    World Simulator

    ↓

    Simulation Event

    ↓

    World State 更新

    ↓

    Novel Writer

    ↓

    人生章节

当前版本已经完成：

AI根据人生选择生成连续人生故事。

但是存在限制：

1.  用户主要是阅读者，而不是参与者。
2.  NPC缺少主动性。
3.  小说生成和游戏表现耦合。
4.  生成等待时间较长。

------------------------------------------------------------------------

# 二、总体演进方向

目标：

从：

    AI人生小说

升级为：

    AI人生模拟视觉小说 RPG

核心原则：

## 不重写世界模拟层

保留：

-   World State
-   Character
-   Relationship
-   Simulation Event
-   Experience Retriever

新增：

-   Narrative Director
-   Dialogue Engine
-   Snapshot System
-   VN Presentation Layer

------------------------------------------------------------------------

# 三、最终架构

                     Player

                        |

                  Choice System

                        |

                 World Simulator

                        |

            ---------------------

            |                   |

     Character System     Event Engine


            |                   |

            ---------------------

                        |

               Narrative Director

                        |

            ---------------------

            |                   |

        Novel Mode        Galgame Mode


            |                   |

     Novel Writer     Dialogue Writer


                        |

                  VN Renderer

------------------------------------------------------------------------

# 四、版本路线

## V2.1 Interactive Life

目标：

从小说阅读升级为互动人生。

------------------------------------------------------------------------

## V2.1.1 双模式入口

开始游戏时：

用户选择：

    人生小说模式

    或者

    Galgame互动模式

两个模式共享：

-   世界
-   人物
-   状态
-   事件

区别：

表现层不同。

------------------------------------------------------------------------

# V2.1.2 Dialogue Engine

新增：

    lib/game/dialogue-writer.ts

职责：

生成视觉小说对白。

数据结构：

``` typescript
DialogueScene {

background

characters

blocks

choices

}
```

Dialogue Block：

``` typescript
{
type:

"dialogue"
|
"narration"
|
"choice",

speaker,

text,

emotion,

avatar
}
```

示例：

旁白：

    深圳的夜晚下起了雨。

角色：

    李婷：

    你真的决定留下吗？

选择：

    A 留下来

    B 回家

    C 再考虑

------------------------------------------------------------------------

# V2.1.3 Character升级

当前人物系统升级。

增加：

``` typescript
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

NPC不再只是剧情工具。

------------------------------------------------------------------------

# 五、V2.2 Galgame UI升级

目标：

实现视觉小说体验。

界面：

    --------------------------------

                背景


            人物立绘


    --------------------------------

    角色名

    对白内容


    [选择1]

    [选择2]


    --------------------------------


    属性

    关系

    时间线

    --------------------------------

------------------------------------------------------------------------

新增组件：

    components/life-vn/

    SceneStage.tsx

    DialogueBox.tsx

    CharacterAvatar.tsx

    ChoicePanel.tsx

    Timeline.tsx

    StatusHUD.tsx

------------------------------------------------------------------------

# 六、V2.3 时间线回溯系统

目标：

用户可以点击过去人生节点。

要求：

默认：

查看历史剧情。

不是重新生成。

------------------------------------------------------------------------

新增：

Snapshot System。

文件：

    lib/game/snapshot-manager.ts

数据：

``` typescript
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

------------------------------------------------------------------------

流程：

    Timeline Node

    ↓

    Load Snapshot

    ↓

    Replay

增加按钮：

    从这里重新开始人生

逻辑：

创建新的 Branch。

类似：

游戏存档分支。

------------------------------------------------------------------------

# 七、V2.4 生成速度优化方案

目标：

降低等待。

采用组合方案：

------------------------------------------------------------------------

# 1. Streaming

利用已有 LLM Streaming。

流程：

点击选择后：

立即显示：

    正在推演你的未来...

随后：

逐步展示生成内容。

------------------------------------------------------------------------

# 2. 并行生成

拆分：

以前：

    一个大Prompt生成全部

改：

    World Simulation

    知乎经验检索

    剧情规划

    并行执行


    ↓

    文本生成

------------------------------------------------------------------------

# 3. Scene级生成

不生成整章。

改：

    Chapter

    ↓

    Scene Plan

    ↓

    Scene1

    ↓

    Scene2

用户先看到第一幕。

------------------------------------------------------------------------

# 4. Cache

缓存：

-   人生事件模板
-   知乎经验检索
-   Scene Pattern

避免重复计算。

------------------------------------------------------------------------

# 八、V2.5 Narrative KB接入

引入：

Interactive Narrative Knowledge Base。

作用：

让AI学习：

-   小说结构
-   Galgame场景
-   对话方式
-   选择设计

流程：

    Simulation Event

    ↓

    Narrative Query

    ↓

    Narrative KB

    ↓

    Scene Plan

    ↓

    Dialogue

------------------------------------------------------------------------

# 九、V3 AI人生世界

目标：

从视觉小说升级为持续运行的人生世界。

------------------------------------------------------------------------

# V3.1 NPC Agent

每个重要NPC：

拥有：

    Memory

    Personality

    Goal

    Emotion

    Belief

    Relationship

NPC可以：

-   主动联系玩家
-   改变关系
-   产生事件

------------------------------------------------------------------------

# V3.2 Narrative Director

核心模块。

职责：

决定：

下一幕发生什么。

流程：

    World State

    ↓

    Narrative Director

    ↓

    Drama Planning

    ↓

    Scene Generation

    ↓

    Dialogue

------------------------------------------------------------------------

# V3.3 多人生路线系统

支持：

    事业路线

    爱情路线

    家庭路线

    创业路线

    普通人生路线

------------------------------------------------------------------------

# 十、当前代码复用规划

## 保留

无需重写：

    World Simulator

    World Reducer

    Character

    Relationship

    Simulation Event

    Experience Retriever

    Evidence Retriever

    LLM Layer

------------------------------------------------------------------------

## 新增

    dialogue-writer.ts

    dialogue-director.ts

    snapshot-manager.ts

    chapter-cache.ts

    narrative-director.ts

------------------------------------------------------------------------

# 十一、开发顺序

推荐：

## Phase 1

V2.1

完成：

-   双模式入口
-   Dialogue Engine
-   Character增强

------------------------------------------------------------------------

## Phase 2

V2.2

完成：

-   Galgame UI
-   对话框
-   角色显示
-   选择面板

------------------------------------------------------------------------

## Phase 3

V2.3

完成：

-   时间线
-   Snapshot
-   人生重开分支

------------------------------------------------------------------------

## Phase 4

V2.4

完成：

-   Streaming优化
-   并行生成
-   Cache

------------------------------------------------------------------------

## Phase 5

V2.5

完成：

-   Narrative KB接入

------------------------------------------------------------------------

## Phase 6

V3

完成：

-   NPC Agent
-   Narrative Director
-   多结局人生世界

------------------------------------------------------------------------

# 十二、最终目标

最终产品：

不是：

AI写小说。

而是：

    一个由AI驱动的长期人生模拟视觉小说世界。

    玩家做选择。

    世界产生变化。

    NPC拥有记忆。

    关系持续发展。

    人生可以重新探索。
