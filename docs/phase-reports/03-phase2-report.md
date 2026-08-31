# Phase 2 完成报告：Choice Generator

- **日期**：2026-08-31
- **分支**：`dev/mvp-v1-interactive-life`
- **方案依据**：§5.4、§5.5、§5.6、§17、§26.1、§37（Phase 2）
- **阶段目标**：把旧 `/api/event` 的"情境 + 选项"能力迁移为 `WorldState → ChapterDecision`，完成 A/B/C + 自定义

## 1. 交付内容

### 1.1 类型

- `lib/domain/chapter.ts`：新增 `ChapterChoice`（`ChapterDecision` 去掉选择结果后的"待选决策"——Choice Generator 的产物，玩家选择后再组装成完整 `ChapterDecision`）。

### 1.2 服务端

| 文件 | 内容 |
|---|---|
| `lib/game/choice-generator.ts` | `generateChapterChoice(world, span)`：把 WorldState（主角状态/性格/价值观/目标/困境 + NPC 公开状态 + 关系四维 + 未解决线索 + 时代背景）描述成 Prompt，经 LLM 生成 `ChapterChoice`（promptTitle / context / 3 options）。校验：恰好 3 个选项、id 为 A/B/C、`strategyTag` 互不相同、`estimatedRisk` 0–100、`stateFit` 三值枚举 |
| `app/api/chapter/choices/route.ts` | `POST { worldState, span }` → SSE 输出（`progress` → `complete {choice}`），沿用 `/api/event` 的 SSE 模式（方案 §26.1） |

### 1.3 前端

| 文件 | 内容 |
|---|---|
| `components/life/DecisionPanel.tsx` | 困境 + 三选项卡片（label/description/机制/风险/契合度）+ 自定义行动输入框（`ChapterSelection` 类型） |
| `components/life/LifeApp.tsx` | 新增 `decision` 状态；`chapter_start` 加入 1 年/3 年跨度选择 + "开始本章"按钮；新增 SSE 流读取器 `readChoiceStream`；玩家选择后记录并显示占位（世界推演待 Phase 4） |

## 2. 关键设计点

1. **玩家选择行动，不选择结果**：选项只描述行动方向（留任争取 / 接受邀请 / 迁移换环境），`estimatedRisk` 是结构风险、`stateFit` 是相对处境的契合度，均不预判成功/失败（方案 §3.1）。
2. **NPC 隐藏状态不进入选择生成**：描述 NPC 时只取公开的 `state.currentGoals` 与关系，不读 `privateState`，保证困境从主角视角生长（方案 §9.3）。
3. **span 参数化**：选择生成已支持 1 年/3 年跨度，时间尺度体现在 prompt 中，为 Phase 4 世界推演的事件数量约束预留。

## 3. 验证结果

- ✅ `npm run lint`（tsc --noEmit）通过
- ✅ `npm run build`（next build）通过，新路由 `/api/chapter/choices` 正常生成
- ⚠️ 选择生成的 LLM 调用暂未做真机验证（与 Phase 1 的 NPC 生成一致，需 dev server + LLM 可达；复用已验证的 `callGameModel` 模式）

## 4. 遗留说明

- 自定义行动（`ChapterSelection.optionId === "CUSTOM"`）目前只做前端记录；`normalizedAction` 的清洗规范化（旧 `/api/custom-action` 思路）在 Phase 4 世界推演入口统一处理。
- 本章选择结果尚未写入 `ChapterDecision`/存档，与 World Simulator（Phase 4）一起落地。
- 本阶段未触碰数据库，只读角色边界不受影响。
