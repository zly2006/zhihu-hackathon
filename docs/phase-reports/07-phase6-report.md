# Phase 6 完成报告：完整 UI + Chapter 持久化

- **日期**：2026-08-31
- **分支**：`dev/mvp-v1-interactive-life`
- **方案依据**：§5.10、§16、§25、§26、§27、§36、§37（Phase 6）
- **阶段目标**：完整章节 UI（小说阅读、人物状态、关系面板、时间线、知乎现实参照、章节推进），并把完整 Chapter 对象持久化进存档

## 1. 交付内容

| 文件 | 内容 |
|---|---|
| `lib/game/hash.ts` | `hashState`：SHA-256 状态哈希，供 Chapter 记录 `stateBeforeHash`/`stateAfterHash`（验证"小说重写不改变 WorldState"） |
| `app/api/chapter/simulate/route.ts`（改） | `complete` 事件追加返回 `stateBeforeHash`/`stateAfterHash` |
| `components/life/ChapterSummary.tsx` | 章末结算（§5.10 四块）：结果锚点 + 小说阅读 + 关键事件时间轴 + 人物/关系变化 + 知乎现实参照 + "进入下一章" |
| `components/life/TimelinePanel.tsx` | 人生时间轴：历史章节的年份区间 + 标题 + 关键事件 |
| `components/life/EvidencePanel.tsx` | 知乎现实参照卡：标题/答主/摘要 + 原回答链接（§36.1） |
| `components/life/LifeApp.tsx`（重写） | 新增 `chapter_summary` 屏；`assembleChapter`（装配完整 Chapter）；模拟后分两节点自动存档（节点4 canonical 完成 / 节点5 小说完成，§25.3）；重写小说只更新 `novel`、保持 `stateAfterHash` 不变；`chapter_start` 展示人物/关系/时间轴 |

## 2. 关键设计点

1. **完整 Chapter 落档**：`GameSave.chapters`（Chapter 含 decision/resolution/evidence/simulationEventIds/stateBeforeHash/stateAfterHash/novel/summary/memoryIds）、`GameSave.events`（canonical SimulationEvent）、`GameSave.experienceCache`（本局引用过的知乎经历）——刷新后可接续（§25、§16）。
2. **重写不改变事实**：`handleRegenerateNovel` 只替换 `chapter.novel`（版本 +1），`stateAfterHash`、`events`、`resolution` 均不变，对应验收 Case C（§21.1）。
3. **章节推进闭环**：`chapter_start`（人物/关系/时间轴 + 1/3 年跨度）→ `decision`（困境 + 三选一 + 自定义）→ 模拟 → 小说 → `chapter_summary` → 下一章。
4. **知乎来源展示**：证据卡含标题/答主/摘要/原链接，正文不泄露作者隐私（§36.1）。

## 3. 验证结果

- ✅ `npm run lint`（tsc --noEmit）通过
- ✅ `npm run build`（next build）通过，全部路由正常生成
- ✅ 全链路（Phase 0–5）已有 90 项冒烟测试（21+18+21+19+11）持续通过；Phase 6 主要是前端装配与持久化，无新增独立纯逻辑单元
- ⚠️ 完整 UI 的端到端交互（含真机 LLM 调用）未做真机验证（与 Phase 1–5 一致）

## 4. 遗留说明

- 视觉小说感（头像/立绘占位、关系变化动画、场景切换动效）留待后续细化（§27.3），当前为功能性 UI。
- 自定义行动的规范化（旧 `/api/custom-action` 思路）仍为直通，未接入清洗。
- 跨章节 `usedExperienceIds` 去重前端仍传空数组。
- 稳定化与测试（极端状态、10+ 章连续、NPC 一致性、RAG 不相关案例、超时、刷新恢复、小说重生成、存档恢复）在 Phase 7 统一做。
