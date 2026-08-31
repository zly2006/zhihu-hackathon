# Phase 0 完成报告：冻结设计与建立新 domain 类型

- **日期**：2026-08-31
- **分支**：`dev/mvp-v1-interactive-life`
- **方案依据**：§8–§17、§19–§20、§25、§33、§37（Phase 0）
- **阶段目标**：不改玩法，只建立新 domain model 与状态推进骨架

## 1. 交付内容

### 1.1 新 Domain 类型（`lib/domain/`，8 个文件）

| 文件 | 内容 |
|---|---|
| `shared.ts` | 基础 id 类型、`ChapterSpan`、`LifeDomain`、`LifeStats`、`Talents`、0–100 clamp 工具（方案 §8） |
| `character.ts` | `Character`（role: protagonist/npc）、`CharacterHook`（最多 3 active）、`CharacterGoal`（方案 §9） |
| `relationship.ts` | `Relationship`（closeness/trust/conflict/commitment 四维并存、unresolvedIssues、milestoneEventIds、status）（方案 §10） |
| `memory.ts` | `CharacterMemory`（importance、emotionalValence、permanentFact、active）+ 每章 3–6 条常量与检索评分权重（方案 §11） |
| `world.ts` | `WorldState`（唯一权威状态）、`StoryThread`（叙事章鱼轻量实现）、`EraContextSnapshot`（含 `isFutureFallback` 标记未来弱假设背景）（方案 §12、§23） |
| `experience.ts` | `LifeExperience`（允许缺失字段，禁止硬猜）、`LifeOutcome`、`RelationshipExperienceEffect`、`EvidenceBundle`（方案 §13、§14） |
| `simulation.ts` | `SimulationEvent`、`CharacterChange`、`RelationshipChange`、`WorldSimulationInput`、`WorldSimulationOutput` + 数量/增量上限常量（方案 §15、§19、§20） |
| `chapter.ts` | `Chapter`、`NovelScene`、`ChapterDecision`、`DecisionResolution`（确定性随机锚点）、`GameSave` v1（方案 §16、§17、§25） |

### 1.2 基础校验（`lib/domain/validate.ts`）

- `assertLifeStats` / `assertStatDelta` / `assertRelationshipScoreDelta`（≤ ±20，方案 §10.3）
- `validateWorldState`：protagonistId 存在性、角色/关系/记忆引用完整性、数值边界
- 只做机械可判定的结构硬约束检查，不掺入世界规则与叙事偏好（AGENTS.md Mind Flow 第 1 条）

### 1.3 WorldState Reducer（`lib/game/world-reducer.ts`）

纯函数、不可变更新，是"没有小说文本参与状态计算、WorldState 也能连续推进"的关键节点：

- 逐事件应用 `CharacterChange`（statDelta 结算并 clamp 0–100、城市/职业/身份变更、目标解决）
- 逐事件应用 `RelationshipChange`（四维数值 clamp、关系类型变更、新增/解决未解决问题）
- 应用目标新增/覆盖、Hook 新增/解决、记忆写入并挂角色、线程 create/resolve/dormant
- 维护 canonicalEventIds、chapterIds、currentYear，并统一推进所有角色 year/age
- 结束前调用 `validateWorldState` 做引用完整性兜底

### 1.4 GameSave v1 辅助（`lib/game/save.ts`）

- `serializeGameSave` / `parseGameSave`
- 旧版存档（schemaVersion ≠ 1）明确拒绝并提示：`"当前存档来自旧版人生重启模式，可继续使用旧模式；新互动人生需要创建新存档。"`（方案 §33）

## 2. 验证结果

### 2.1 静态检查
- ✅ `npm run lint`（tsc --noEmit）通过
- ✅ `npm run build`（next build）通过（注：本机需 `NODE_OPTIONS=` 清空 `--use-system-ca`，否则 Turbopack worker 报 `ERR_WORKER_INVALID_EXEC_ARGV`，属环境问题与代码无关）

### 2.2 冒烟测试（`test/phase0-reducer.smoke.mjs`，21 项全过）

覆盖：stats 结算与 clamp（含负值归零、超界封顶）、关系数值应用、未解决问题新增、记忆写入与挂载、目标/Hook/线程新增、canonical 事件记录、章节记录、世界年份与角色年龄推进、不可变性（原 world 未被修改）、幽灵 id 引用被拒、GameSave 往返、旧版存档拒绝提示。

## 3. 与本阶段边界一致性

- ✅ 未改动任何旧玩法代码（game.ts / mechanics.ts / database.ts / 前端均未动）
- ✅ 未新增任何 npm 依赖（方案 §30.1 要求克制）
- ✅ 新类型全部按方案 §31 目录结构落位
- ✅ 未涉及数据库写入，只读角色边界不受影响

## 4. 遗留说明

- `DecisionResolution` 的确定性随机算法（§17.2）留待 Phase 4 实现，本阶段只定义类型与常量。
- `lib/game/simulation-validator.ts`（服务端校验输出）归入 Phase 4 交付。
- 新分支首次提交将同时纳入：方案文档（`docs/知乎互动人生小说_MVP_v1 .md`）、00 同步报告、本报告。
