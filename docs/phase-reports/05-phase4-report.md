# Phase 4 完成报告：World Simulator（MVP 最关键阶段）

- **日期**：2026-08-31
- **分支**：`dev/mvp-v1-interactive-life`
- **方案依据**：§15、§17、§18、§19、§20、§24、§26.2、§34、§35、§37（Phase 4）
- **阶段目标**：DecisionResolution 确定性随机锚点 + SimulationEvent + NPC 自主行为 + Relationship delta + Memory + world reducer 全链路打通，并实现 `/api/chapter/simulate`

## 1. 交付内容

| 文件 | 内容 |
|---|---|
| `lib/game/decision-resolver.ts` | `deterministicRoll`（SHA-256 → 前 13 hex → [0,1)）、`computeEffectiveRisk`（结构风险 + 资源稀缺惩罚 + stateFit 修正 + 时代修正 − 天赋保护）、`outcomeAnchorFromRoll`（三级分布，mixed 恒为主区间，§17.2.2）、`resolveDecision`（同输入同结果，种子持久化进 `uncertaintySeed`） |
| `lib/game/simulation-validator.ts` | 服务端结构硬约束校验（§20.1）：事件数按跨度（1年2–4 / 3年4–8）、重大事件≤2、participantId/relationshipId/evidenceId 合法性、stat delta 有限、relationship delta ≤20、类型变化需重要性≥60 的明显事件、记忆 3–6 条、未来年份不得伪造现实政策/公司/名人的轻量启发式 |
| `lib/game/memory-selector.ts` | `selectRelevantMemories`：永久事实 + 重要性×recency 排序，最多 8 条（§11.3） |
| `lib/game/world-simulator.ts` | `buildSimulatorPrompt`（人物含 NPC 隐藏状态、关系、线索、记忆、决策、结果锚点、知乎证据、时代、合法 id 清单）+ 三层 Prompt（结构硬约束/世界规则/输出格式）+ `buildSimulationOutput`（模型输出 → 补齐 id 与引用）+ `runWorldSimulator`（支持校验失败追加修正重试） |
| `app/api/chapter/simulate/route.ts` | SSE 编排：组装 ChapterDecision → resolveDecision → retrieveEvidence → selectRelevantMemories → runWorldSimulator（校验失败重试≤3）→ reduceWorldState → 返回 `{evidenceBundle, resolution, simulation, worldStateAfter}` |
| `components/life/LifeApp.tsx` | 选择后触发 simulate、SSE 进度、展示本章结果（事件时间轴 + 结果锚点 + 引用经历数）、持久化新 WorldState、进入下一章 |

## 2. 关键设计点

1. **程序定锚点，模型解锚点**（§17.2.3）：程序只算 `effectiveRisk`/`outcomeAnchor`/`uncertaintySeed`，World Simulator 负责把锚点解释成具体事件；`setback ≠ 人生毁灭`、`favorable ≠ 无代价成功`、`mixed 有得有失` 均写入 Prompt。
2. **确定性可复现**：`uncertaintySeed = SHA-256(saveId:chapterIndex:decisionId:normalizedAction)`，同一存档/章节/选择必得同一结果（§17.2.1），禁止刷结果（§17.3）。
3. **NPC 自主**：模拟器输入包含 NPC 的 `privateState`（系统内部用于决定 NPC 行为），但事件 `visibility` 区分 `known_to_protagonist`/`partially_known`，隐藏状态不直接泄露（§18、§9.3）。
4. **校验失败追加修正重试**：沿用旧 game.ts 的"追加具体失败项重试"思想（§20.1、AGENTS.md Mind Flow 第 5 条），最多 3 次，不覆盖原对话。
5. **失败恢复语义**：World Simulator 失败不写 canonical、不改 WorldState；只有校验通过并 reducer 应用后才持久化（§35）。

## 3. 验证结果

- ✅ `npm run lint`（tsc --noEmit）通过
- ✅ `npm run build`（next build）通过，新路由 `/api/chapter/simulate` 正常生成
- ✅ 冒烟测试 `test/phase4-simulator.smoke.mjs`（19 项全过）：确定性随机同种子同值、三级结果分布、resolveDecision 确定性、validator 接受合法输出并拒绝 5 类违规（事件数不足/幽灵 id/年份越界/关系增量超限/记忆不足）、buildSimulationOutput 的 id 补齐与线程创建、映射输出通过 validator
- ⚠️ `runWorldSimulator` 的 LLM 调用与 `/api/chapter/simulate` 的真机端到端尚未验证（需 dev server + LLM 可达 + 真实数据库召回），与 Phase 1–3 一致

## 4. 遗留说明

- 自定义行动的规范化（旧 `/api/custom-action` 思路）当前为直通 `normalizedAction`，正式清洗留待 Phase 4 之后或按 §26.4 合并。
- 跨章节的知乎经历去重（`usedExperienceIds`）接口已预留，前端暂传空数组。
- 本章结果目前是精简展示（事件时间轴 + 锚点），完整小说阅读在 Phase 5（Novel Writer）、完整 UI 在 Phase 6。
