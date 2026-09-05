# Galgame 玩法系统 B 范围设计

日期：2026-09-05  
负责人：B（Galgame 玩法）  
状态：已获本轮实施批准；正式赵冷内容和 A 的正式视觉资源不在本设计的交付范围内。

## 1. 目标与边界

在现有 `/life` 章级人生模拟之上补齐可玩的场景层：旧章节对白作为只读历史回放，章末增加当前年份的 live 互动场景。玩家只能提交场景行动；规则、关系门槛、世界变化和分支路由由程序解释并保存。

本轮交付 B 负责的 Scene Runtime、场景契约与校验、选择结算、关系展示、可靠恢复、分歧检查点/分支、双表现模式语义一致性、A/C 接口，以及一套三章中性测试夹具。夹具使用“测试主角”“测试角色甲”等中性 ID，覆盖多角色、关系门槛、分歧、汇合和两个终点；它证明玩法系统，不代表正式赵冷 Demo 完成。

不修改 C 的 NPC Agent、Narrative Director、Prompt、对白内容或正式结局；不生成或改写 A 的图片资产。保留现有章级 `World Simulator`、结果锚点、宏观结算和关系四轴，不引入数据库写权限、云存档、账号级防作弊或每场景实时模型结算。

## 2. 方案选择

### 方案 A：直接扩展旧 DialogueScene

只在现有对白块上启用选项，改动少，但无法稳定区分回顾和当下、冻结包版本，也无法可靠支持场景检查点与异步幂等。放弃。

### 方案 B：分层 Scene Runtime（采用）

用版本化 `ScenePackage` 表达可执行内容图，用 adapter 兼容旧对白，用纯状态机负责播放，用注册规则和统一 reducer 负责结算，用保存投影负责恢复和分支隔离。新增模块承担核心复杂度，`LifeApp`、`Chapter` 和现有 VN 组件只做最小接线。

### 方案 C：每场景实时调用世界模型

表现自由度高，但会把规则结算和 Prompt 职责扩到 C，增加延迟和失败面，也会破坏本轮“即时选择零 LLM、章级模拟保留”的边界。本轮不采用。

## 3. 模块与数据流

### 3.1 内容层

`lib/domain/scene.ts` 定义 `ScenePackage`、`RuntimeScene`、`RuntimeBlock`、`RuntimeChoice`、`SceneRequirement`、`SceneTarget`、`SceneRuntimeState`、`SceneActionRecord` 和场景选择请求/响应。包包含 `schemaVersion=1`、稳定 `id/version/chapterId/entrySceneId`、场景、结局和公开演出 cue；不包含 NPC 私密目标。

`scene-adapter.ts` 将旧 `DialogueScene` 转成同一运行时可播放但不可结算的 `retrospective` 包。旧顶层 choices 与块内 choices 发生冲突时返回带路径的内容错误；缺乏 `ruleId`、目标和跳转的旧选项保持只读，不能因缺字段获得默认奖励。

`scene-package-validator.ts` 检查 schema/version、稳定 ID、角色/背景/事件引用、choice 唯一来源、每个 live 场景至多一个 choice block、选项数量、规则 ID、门槛、目标、结局、当前年份和图可达性。首版包图为 DAG；所有可执行选择必须能到达 scene、chapter end 或 ending。

### 3.2 播放层

`lib/game/scene-runtime.ts` 是无 React/网络依赖的状态机。合法状态为 `reading`、`awaiting_choice`、`submitting`、`feedback`、`completed`、`error`。`NEXT`、`AUTO_TICK` 和 `SKIP` 都只推进到下一个未完成选择；不能替玩家选择。选择成功后的目标以服务端返回的 `record.next` 为准。

`use-scene-runtime.ts` 仅管理计时、页面可见性、reduced-motion、卸载/切场景清理和请求转发。`SceneRuntimePlayer` 通过现有 `SceneStage`、`DialogueBox`、`ChoicePanel` 展示多角色、逐块 emotion/pose/animation cue、锁定理由、反馈和 aria-live 状态。历史回放使用只读状态，不能调用选择结算接口。

### 3.3 结算层

`scene-choice-rules.ts` 注册具体 `ruleId`、公开门槛、目标关系、四轴基准变化、flags 和下一目标；未知规则拒绝。`scene-choice-resolver.ts` 只从服务端 registry 读取规则，忽略客户端 delta。`scene-event-validator.ts` 使用即时场景专用约束，验证参与者、关系、当前年份、来源和有限变化，不套用宏观章节事件数/记忆数约束。

`scene-choice-service.ts` 按 branch/chapter/package/version/scene/block/choice 定位逻辑槽，先检查同槽 action 和 canonical event，再调用 `reduceWorldState`；同槽同选返回原记录，同槽异选返回冲突，无法关联 action/event 的残缺存档进入只读/修复错误。场景事件带 `source.kind=scene_choice`、`actionId`、`ruleId`、包版本和位置元数据，使用当前年份作为 `endYear`，不推进时间、年龄、章节数或人生七维。

### 3.4 保存与分支层

`GameSave.schemaVersion` 继续为 1，增量加入带自身版本的 runtime、actions、flags、packages、pendingChapter 和 `saveRevision`。选择成功先构造完整 immutable `nextSave`，序列化并写入同一 localStorage key，写入成功后才发布 React 状态；写失败保持旧状态，显示未保存并提供重试/导出。

模拟成功后立即保存完整 `pendingChapter`（world、events、经历引用、选择、结果锚点和已完成表现阶段），后续 plan/reflection/novel/dialogue 只更新同一 pending 执行 ID。刷新优先恢复 pending，再恢复未完成场景；不重复模拟，迟到响应不能覆盖新 revision。

每个有后果的 choice block 前创建不可变 `scene-choice` 检查点，ID 使用分支、章节、包版本、scene、block 和 sequence，不能仅按 chapterIndex。新分支复制检查点以前的完整状态和祖先动作，赋新 branchId 并恢复到未选择 block；源分支、源检查点和只读历史不变。小说重写只更新文学内容，不替换已执行 ScenePackage 或动作记录。

## 4. 关系与模式一致性

继续使用 `closeness/trust/conflict/commitment` 四轴。五级仅是展示派生：

`affinity = closeness × 0.6 + trust × 0.4 − conflict × 0.3`

阈值为 `<20` 陌生、`[20,40)` 熟悉、`[40,60)` 朋友、`[60,80)` 信任、`≥80` 重要的人。`commitment` 单独展示并参与承诺门槛；高亲密与高冲突可以并存，重要的人不自动改关系类型或解释为恋爱。

门槛 predicate 同时服务 validator、resolver 和 HUD：支持关系等级、trust/conflict/commitment 与公开 flags；缺失关系拒绝，不隐式创建。HUD 只展示涉及主角的关系，反馈使用 clamp 后的 `after-before` 实际变化。novel 与 galgame 共享同一个 runtime、结算和保存投影，只改变表现布局，不能通过切换模式绕过或重复选择。

## 5. A/C 接口

A 消费 `resolveCharacterVisual({ characterId, emotion, pose, animation })`，返回精确资源或 null。B 传 cue 和 speaking/focus 状态，不感知资产目录；回退顺序为 exact → neutral/default → avatar → 名字占位，资源缺失不阻断播放。

C 消费经过 validator 的 `ScenePackage` 和 `compileSceneActionContext(save)`。公开 action context 只携带稳定 action ID、发生章节、玩家可见标签和“已应用效果”，当前分支上一已完成章最多 3 条；未提交动作不进入下章上下文。主动场景以稳定 `triggerId` 在分支内去重并在安全边界插入。C 负责 Prompt、角色语言、正式剧情和私密信息边界，B 不直接修改这些生成系统。

## 6. 验证策略

新增行为套件并注册到 `scripts/test-all.mjs`，测试最新 `.tmp/test-all` 编译产物。契约套件覆盖合法/非法包、旧只读 adapter、图引用和可达性；runtime 套件覆盖手动/自动/跳过停在选择、错误重试和终态；choice 套件覆盖未知规则、门槛、实际 clamp、幂等、revision、迟到响应和 reducer 前去重；save 套件覆盖 pending 恢复、写失败、重写冻结和分支隔离；relationship 套件覆盖 20/40/60/80 边界、四轴并存与 HUD 筛选；fixture 套件遍历三章中性图的两条终点路线。

本轮离线验收与真实运行验收分开报告。必须串行执行 `npm run lint`、`node scripts/test-all.mjs`、`npm run build`；涉及场景事件后还要从真实运行实例验证 `/api/event` SSE 最终 `complete`、经历数 18、选项数 3，并验证 `/life` 章级模拟与即时场景选择。真实模型/数据库/浏览器不可用时记录具体未验证项，不用 fixture 代替宣布正式 Demo 完成。

## 7. 回滚与未完成依赖

旧存档缺 runtime 字段时沿原章级路径读取；含未知 runtime 版本或残缺 action/event 的存档只读并可导出，不能静默改写。关闭场景入口不会自动跳过未完成关键选择。回滚到不认识 runtime 的版本前，含未完成互动的新档暂停写入。

正式赵冷内容、正式角色资源、C 的 action-context 消费和 A 的视觉 adapter 实际交付，均作为后续联调依赖单独记录。中性夹具通过只表示 B 的系统可运行，不替代这些依赖。
