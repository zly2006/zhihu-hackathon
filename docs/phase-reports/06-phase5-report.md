# Phase 5 完成报告：Novel Writer

- **日期**：2026-08-31
- **分支**：`dev/mvp-v1-interactive-life`
- **方案依据**：§21、§26.3、§35.3、§37（Phase 5）
- **阶段目标**：把 canonical events 文学化为章节小说；确保重新生成小说不改变 canonical events

## 1. 交付内容

| 文件 | 内容 |
|---|---|
| `lib/game/novel-writer.ts` | `buildNovelPrompt`（人物底色 + canonical 事件 + 关系变化 + 相关记忆 + 知乎参照摘要 + 三层约束）、`parseNovel`（模型输出 → `Chapter["novel"]`，含标题/副标题/多场景/版本号）、`writeNovel` |
| `app/api/chapter/novel/route.ts` | `POST { stateBefore, events, relevantMemories, featuredEvidence, span, version }` → `{ novel }`（§26.3） |
| `components/life/NovelReader.tsx` | 小说阅读组件：标题/副标题/时间标签/多场景正文/字数/版本，含"重写本章小说（不改变已发生的事实）"按钮 |
| `components/life/LifeApp.tsx` | 模拟完成后自动生成小说；展示小说阅读；"重写小说"用**同一批 canonical events** 重新调用（版本号 +1）；"进入下一章" |

## 2. 关键设计点

1. **canonical 与文学分离**：Novel Writer 只读 `SimulationEvent[]`，不能改事件年份/结果/关系变化，只能补充场景、对白、氛围与日常细节（§21.2、§35.3）。
2. **重新生成不改变事实**：`handleRegenerateNovel` 复用 `simResult.simulation.events`（同一批 canonical 事件）只改 `version`，文风可不同、事实必须相同（§21.1、验收 Case C）。
3. **隐藏状态不泄露**：对 `visibility === "partially_known"` 的事件，Prompt 明确要求"只写主角可观察的表象，不写他人秘密，只能行为暗示"（§21.2 第 3 条、§9.3）。
4. **知乎只作现实感参考**：`featuredEvidence` 只取 3–5 条摘要，且约束"不复制作者经历、不引用大段原文"（§21.2 第 5/6 条）。
5. **输出复用严格 JSON 流式解析**：Novel Writer 返回 `{title, subtitle, scenes:[{heading,timeLabel,text}]}`，复用 `callGameModel` 能力（§21.3）。

## 3. 验证结果

- ✅ `npm run lint`（tsc --noEmit）通过
- ✅ `npm run build`（next build）通过，新路由 `/api/chapter/novel` 正常生成
- ✅ 冒烟测试 `test/phase5-novel.smoke.mjs`（11 项全过）：prompt 含主角名/事件标题/第二人称/canonical/部分知情/NPC 名；parseNovel 的标题/场景/副标题回退/版本号/拒绝空场景
- ⚠️ `writeNovel` 的 LLM 真机调用未验证（与 Phase 1–4 一致）

## 4. 遗留说明

- 完整 Chapter 对象（stateBeforeHash/stateAfterHash/decision/resolution/summary/memoryIds）的持久化装配在 Phase 6 统一落地；当前 events 在本会话内保持 canonical，重写小说已验证不改变事实。
- 字数（1年1200–2000 / 3年2500–4000）作为叙事偏好写入 Prompt，未做硬性机械校验（§34 属叙事偏好而非结构硬约束）。
- 小说阅读 UI 为精简版，Phase 6 做完整视觉小说界面。
