# V1.3 视觉小说 UI 生产接入 阶段 2 完成报告

- **日期**：2026-09-01
- **分支**：`dev/mvp-v1-interactive-life`
- **提交**：`b36ae8a`（前置：`9fe9249` codex 基线、`28a5e12` 场景批次）
- **方案**：`docs/AI人生模拟视觉小说RPG_V1.1-V2.0迭代方案.md` §6（V1.3 Hybrid Visual Novel + RPG UI）
- **范围**：仅阶段 2 契约层 + UI 生产接入；不涉及 V1.1 Narrative / V1.2 角色智能

## 一、交付内容

### 1. 契约层（lib）

| 模块 | 说明 |
|---|---|
| `lib/domain/visual.ts` | `VisualIdentity` / `CharacterVisual` 类型；`Character.visual` 可选字段，GameSave schemaVersion 保持 1，旧存档向后兼容 |
| `lib/game/presentation.ts` | `buildLifePresentation()`：WorldState/Chapter → 纯展示视图模型；属性增量按事件 `characterChanges` 累计；**只输出玩家可见信息，不携带 privateState** |
| `lib/game/scene-catalog.ts` | 生产场景目录 `SCENES`（3 族 4 张，与实验台 `scene-catalog.json` 同源，测试断言一致）；`pickSceneForNovelScene()` 按文本关键字匹配背景，确定性回退夜景 |
| `lib/game/avatar-registry.ts` | 6 个预设头像（复用 4 张人物资源），`resolveAvatarUrl()` |
| `lib/game/character-factory.ts` | `ProtagonistDraft.visualIdentity` → `Character.visual` 映射 |
| `lib/game/decision-resolver.ts` | **天赋 0-100 尺度归一化**：保护强度 `(0.8·洞察+0.7·运气+0.35·韧性)/100 × 8`，等价旧 1-7 量表（平均 50→≈7.4，满 100→≈14.8），不再把有效风险压到下限 |

### 2. UI 层（components/life-vn + 页面升级）

- `globals.css` 新增 `.life-vn` 命名空间：暖米白/香槟金/深棕视觉 token、四边面板、对白框、HUD、移动端、`prefers-reduced-motion`；不触碰旧游戏 `/` 类。
- `components/life-vn/` 组件族：`LifeShell`（四边面板 + 沉浸/收起 + 移动底栏抽屉）、`SceneStage`（目录背景 + 立绘 + 移动端定位变量）、`DialogueBox`（说话人/正文/选项/继续）、`PlayerHud`+`StatBar`、`RelationshipHud`、`ChapterResult`、`RealityEvidenceDrawer`。
- `ProtagonistSetup` React 化：五分区（基本身份/出身起点/人格内核/初始天赋/最终确认）、六头像选择、天赋预算 250（单项 20-80、步长 5）、右侧实时预览、本地草稿自动保存/清空、字段级校验 + 顶部错误摘要；提交携带 `visualIdentity`。
- `LifeApp` 全部屏幕接入新外壳：landing 浅色卡片、chapter_start 场景舞台 + 跨度选择、decision 对白框内 A/B/C + 自定义行动、chapter_summary 走 `ChapterSummary` v2。
- `ChapterSummary` v2 双模式：**视觉小说逐场景阅读**（按场景文本匹配背景 + 继续剧情 + 场景计数）→ **结算页**（结果锚点/关键事件时间轴/本章变化/现实参照抽屉/重写/下一章）。
- 资源复制到 `public/life/`：4 张背景 + 4 张头像（生产可访问）。
- `window.render_game_to_text()` 测试可观测接口（screen/year/chapterIndex/protagonist/visibleNpcs/visibleRelationships/activeDecision/activeScene/loading/error，**不含 privateState**）。

## 二、验证

```text
node scripts/test-all.mjs                     → 6 个冒烟套件 ALL PASS（含 10 章稳定性）
node --test test/v13-ui-contract.test.mjs + 既有 5 套 → 19/19 通过
npm run lint（tsc --noEmit）                 → 通过
NODE_OPTIONS= npm run build                   → 通过
npm run dev + curl /life                       → 200，landing 正常渲染
```

`v13-ui-contract.test.mjs` 覆盖：presentation 不泄漏 privateState、章末增量累计、生产目录与实验台 JSON 同源、天赋归一化数值、visualIdentity 映射、render_game_to_text 静态契约。

## 三、边界与注意

- 本轮未触碰数据库 schema、未改 `DK_DATABASE_URL` 角色、未改 `.env`。
- `next-env.d.ts` 是 dev/prod 自动翻转文件，未纳入提交。
- 天赋归一化会轻微改变后续章节 `effectiveRisk` 数值（属预期平衡修正）；历史章节 canonical 不受影响。
- 真机端到端（创建→NPC→抉择→推演→阅读→结算）需用户运行实例验收；本环境无法目检图像，头像/背景视觉由用户确认。

## 四、后续（待审批）

- 阶段 3 · V1.1 Narrative Engine：`NARRATIVE_DATABASE_URL` 未配置，先以合规 fixtures 起步；动工前需敲定叙事语料来源清单。
- 阶段 4 · V1.2 Character Intelligence。
