# 阶段 4 · V1.2 Character Intelligence 完成报告

- 日期：2026-09-02
- 依据：`docs/AI人生模拟视觉小说RPG_V1.1-V2.0迭代方案.md` §5
- 提交：`b277404`
- 分支：`dev/mvp-v1-interactive-life`

## 一、目标达成（§5.1）

NPC 心理状态从**静态设定**（hiddenGoals/hiddenConcerns/privateBeliefs）升级为**可演化状态**：每章 canonical 模拟完成后，为真正受影响的角色生成 `CharacterReflection`，驱动信念强化/转向、目标优先级变化、情绪趋势演化。

## 二、交付内容

### 领域层
- `lib/domain/reflection.ts`：`CharacterReflection`（id/characterId/chapterId/year/basedOnMemoryIds/insight/beliefChanges/goalPressure/emotionalTrend/private），`EmotionalTrend` 7 枚举，`ReflectionBatchContext`。
- `Character.privateState` 扩展：`currentEmotionalTrend?`、`reflectionIds?`（§5.2）。
- `WorldState.reflections?: Record<id, CharacterReflection>`（可选字段，**schemaVersion 保持 1**，旧存档兼容）。

### 引擎层（lib/game/reflection-engine.ts）
| 模块 | 规则 |
|---|---|
| `collectReflectionCandidates` | 事件参与者 / 关系变化双方 / 高重要度记忆（≥70）；**仅 privateState 角色**（主角无隐藏状态自然排除）；按影响度排序 **cap 4**（§5.4 一章至多一次 Batch） |
| `buildReflectionContext` | 可见信息 + 私有状态 + 本章 digest + id 白名单；**既往反思只取最近 2 条、单条截断 60 字**（§5.6 Prompt 不无限增长） |
| `buildReflectionPrompt` | 硬约束程序追加：候选/记忆/目标 id 白名单、只调 active 目标、trend 枚举、信念必须由本章事件支撑、不重置人格、反思私有 |
| `parseReflections` | 白名单校验（越界 goal/memory id 拒绝、非 active 目标拒绝、trend 非法拒绝、重复角色拒绝）、amount clamp 1-30、strength 0-100 |
| `applyReflections` | 优先级 ±amount clamp 0-100；信念追加 cap 8；趋势/reflectionIds（cap 12）写入 privateState；reflections 写入 WorldState；不可变更新 + 重新 validateWorldState |
| `runReflectionBatch` | 校验失败**追加错误重试（≤2）**；最终失败 **fail-open**（不阻断章节、不修改 canonical） |

### 接入与私有性
- `app/api/chapter/simulate/route.ts`：World Reducer 之后运行反思批次（进度提示"正在生成角色内心反思"），应用后写入 `worldStateAfter`（stateAfterHash 同步）。
- 私有性（§5.5）：反思不进入玩家 UI / NarrativePlan / 小说直白泄漏路径；`render_game_to_text` 只暴露 `reflectionCount`（数量），不含任何反思内容。

## 三、验证

```text
node scripts/test-all.mjs（新增 reflection-engine.test.mjs 6 项）→ ALL TEST SUITES PASS
  · 候选人筛选（参与/关系/记忆阈值/主角排除/cap4）
  · parse 校验逐项拒绝（非法 goal/trend/记忆/非 active 目标）
  · apply（优先级 clamp、信念追加、趋势/reflectionIds、旧存档无 reflections 兼容）
  · Prompt 防膨胀（最近 2 条 + 截断 + 总长上限）
  · 私有性静态检查（render_game_to_text 无泄漏）
npm run lint / build → 通过
真实 LLM 冒烟（.tmp/v12-smoke.mjs）→ 1 次尝试通过：npc1 趋势 ambivalent、
  信念"稳定比高薪重要"强化 75、目标"回老家考编"优先级 +20，全部合法
```

## 四、验收对照（§5.6）

| 项 | 状态 |
|---|---|
| 连续 8-12 章同一 NPC 不重置 | ✅ 机制上满足（reflections 随 WorldState 持久化，候选每次重算）；需真机长跑验证 |
| 过去矛盾影响未来行为 | ✅ 信念/目标优先级/情绪趋势写回 privateState，World Simulator 继续读取 |
| 已解决 Hook 不再被当未解决 | ✅ reducer 已解析；反思硬约束禁止把已解决目标当未解决 |
| 目标优先级变化有来源 | ✅ 每条 goalPressure 带 reason，追溯 reflection |
| NPC 不会永远迁就主角 | ✅ 机制上支持（压力方向双向）；需真机观察 |
| 也不会为戏剧性反复背叛 | ✅ 硬约束"不重置人格、演化不换人" |
| privateState 不泄漏 | ✅ 只暴露计数；V1.1 泄漏校验器覆盖 privateBeliefs |
| Prompt 不无限增长 | ✅ 既往反思 2 条截断 + 上下文长度上限 |

真机长跑验收（8-12 章 NPC 一致性）需多章游玩后人工观察，列为遗留。

## 五、后续

- 真机多章验收：观察 NPC 目标/信念是否随章节稳定演化（Console 里 `render_game_to_text().reflectionCount` 递增即链路生效）。
- 下一阶段：V2.0 内容扩展 / 或回补 V1.1 盲评 fixture（20 固定章节），待定方向。
