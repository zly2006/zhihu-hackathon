# 阶段 3 · V1.1 Narrative Engine 完成报告

- 日期：2026-09-02
- 依据：`docs/AI人生模拟视觉小说RPG_V1.1-V2.0迭代方案.md` §4（V1.1 Narrative Engine）
- 前置：Narrative KB v0（684 fragments，`2ef68a8`）
- 分支：`dev/mvp-v1-interactive-life`

## 一、交付内容（§4.2 新链路全通）

```text
SimulationEvent[] → buildNarrativeNeed → retrieveNarrativeEvidence（KB 检索）
→ generateNarrativePlan（Director LLM）→ validateNarrativePlan（硬校验 + 追加重试）
→ Novel Writer V2（按 plan 逐场景写作）→ Chapter.narrative
```

### 契约层（lib/domain/narrative.ts，§4.3 逐字对齐）
`NarrativeNeed / NarrativeReference / NarrativeEvidenceBundle / ScenePlan / CharacterArcPlan / NarrativePlan`（version:1，含 endingHook、referenceFragmentIds、canonicalEventIds）。

### 引擎层（lib/narrative/）
| 模块 | 职责 |
|---|---|
| `need-builder.ts` | canonical 事件 + 决策 → NarrativeNeed（领域/关系类型/中心事件/冲突类型/叙事功能曲线） |
| `query-adapter.ts` | 游戏侧 SQLite 只读检索（与 KB 管线同款 8192 维字符二元组哈希袋 + 余弦）；**DB 缺失/损坏 → 空结果降级，绝不抛出** |
| `retriever.ts` | Need → Bundle：按叙事功能分桶（arc/scene/dialogue/pacing/ending）+ 去重 + 溯源 |
| `planner.ts` | Director Prompt（§4.4 硬边界 + Mind Flow：结构硬约束/世界规则/叙事偏好分层；硬约束由程序按 world/events/bundle 计算追加；referenceFragmentIds 白名单、角色 id 白名单、场景数区间、canonicalEventIds 白名单、privateState 禁令） |
| `validator.ts` | §4.6 硬校验 1-10：canonicalEventIds 越界、sourceEventIds 为空、时间逻辑、角色存在性、**privateState 泄漏检测**、场景数区间（1年 3-5 / 3年 5-8）、冲突场景、endingHook、referenceFragmentIds ⊆ bundle、order 连续性 |
| `engine.ts` | 四步编排 + 校验失败**追加具体错误重试（≤3 次）**；KB 不可用 → 空 bundle 无参考模式；Director 失败不修改 canonical |

### API 与 Writer（§4.7/§4.8）
- 新增 `POST /api/chapter/narrative-plan`（SSE progress/complete，输出 `{narrativePlan, narrativeEvidence, metrics}`）。
- `POST /api/chapter/novel` 扩展接收 `narrativePlan / narrativeReferences`；Writer V2 严格按 plan 写（场景数 1:1、timeLabel 沿用规划、mustNotInvent 禁令、endingHook 落实），无 plan 时保持 V1.0 行为。
- `Chapter.narrative` 可选字段（plan + referenceFragmentIds + directorVersion，§4.9）；**GameSave schemaVersion 保持 1**，旧存档兼容。

### 前端接线（§4.8 流程 + §4.10 结算）
- LifeApp：simulate 后先调 narrative-plan（进度提示“正在规划本章叙事…”），成功再携 plan 写小说；**规划失败自动降级为无规划写作，不阻断、不改 canonical**；重写小说沿用已保存 plan 且不重新规划。
- 章节结算页新增“本章主题（叙事导演）”：theme + 主冲突。
- `window.render_game_to_text` 增补 `activePlan`（theme/mainConflict/sceneCount/referenceFragmentIds，不含 privateState）。

## 二、验证

```text
node --test test/narrative-engine.test.mjs   → 6/6（need 推导/真实 KB 检索/合法计划/违规逐条命中/privateState 泄漏/页面契约）
node scripts/test-all.mjs                    → ALL TEST SUITES PASS（6 冒烟套件）
node --test narrative-kb/tests/smoke.test.mjs → 6/6
npm run lint                                 → 通过
NODE_OPTIONS= npm run build                  → 通过
```

## 三、验收对照（§4.11）

| 项 | 状态 |
|---|---|
| Narrative DB 可独立查询 | ✅（retriever 实测 26+ 参考召回） |
| NarrativeEvidenceBundle 生成 | ✅ |
| Director 生成 NarrativePlan | ✅（含追加错误重试 ≤3） |
| plan 通过结构校验 | ✅（11 项硬校验） |
| Writer 严格按 plan 写 | ✅（场景数 1:1 + 时间标签沿用 + mustNotInvent） |
| 重写小说不触发 World Simulator | ✅（沿用已保存 plan，不重新规划） |
| Director 失败不修改 canonical | ✅（前端降级 + 服务端不写回） |
| Narrative DB 故障有 fallback | ✅（空 bundle 无参考模式） |
| 旧存档可继续 | ✅（schemaVersion 保持 1，narrative 可选） |

盲评质量门槛（20 个固定 fixture 章节、继续阅读意愿 +0.8/5 等）需真机运行 + 人工盲评，**列为待办**（见下）。

## 四、遗留与后续

1. **真机端到端**：需要本机运行 /life 完整流程验证 Director→Writer 链路实际输出质量（LLM 已切 opencode-go + deepseek-v4-flash）。
2. **盲评门槛**（§4.11 质量项）：20 个固定 canonical chapter fixture + 盲评表尚未建立。
3. **阶段 4 · V1.2 Character Intelligence**（角色反思/信念演化，§5）待审批开工。
