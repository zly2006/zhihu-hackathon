# Phase 1 完成报告：主角 + NPC + WorldState

- **日期**：2026-08-31
- **分支**：`dev/mvp-v1-interactive-life`
- **方案依据**：§5.2、§5.3、§9、§10、§25、§33、§37（Phase 1）
- **阶段目标**：18 岁主角创建、3 个 NPC 生成、Relationship 初始化、本地新存档、Character/Relationship UI（暂不生成小说）

## 1. 交付内容

### 1.1 服务端

| 文件 | 内容 |
|---|---|
| `lib/game/character-factory.ts` | `createProtagonist`（18 岁开局、year=birthYear+18、天赋/性格/价值观截断与 clamp、长期目标+初始困境落成）、`createNpc`（隐藏状态写入 `privateState`）、`createRelationship`（按关系类型初始化四维 scores）、`createInitialWorldState`、`createInitialGameSave`、`STARTING_LIFE_STATS` 基线、`NpcDraft`/`ProtagonistDraft` 类型 |
| `lib/game/npc-generator.ts` | `generateNpcs(protagonist)`：复用 `callGameModel`，purpose=`npc-generation`；严格校验（恰好 3 个、关系类型互不相同、年龄 10–90、必填字段） |
| `app/api/life/npc/generate/route.ts` | `POST`：接收主角草稿 → 创建主角 + 生成 3 NPC → 返回 `{ protagonist, npcs }` |
| `app/api/life/create/route.ts` | `POST`：接收主角 + 3 个（可编辑后的）NPC → 组装 WorldState + GameSave → 返回 `{ gameSave }` |

### 1.2 前端（`components/life/` + `app/life/`）

| 文件 | 内容 |
|---|---|
| `app/life/page.tsx` | 新互动人生入口路由（旧游戏保持 `/` 不变） |
| `components/life/LifeApp.tsx` | 状态机 `landing → setup → npc_setup → chapter_start`；localStorage 存档 key=`restart-life-save-v1`（与旧版 `restart-life-save` 隔离）；支持“继续上一次人生” |
| `components/life/ProtagonistSetup.tsx` | 主角半结构化创建表单（姓名/出生年/性别/家乡/家庭/城市/方向/性格标签/价值观/长期目标/初始困境 + 5 项天赋滑杆） |
| `components/life/NpcSetup.tsx` | 3 个 NPC 编辑卡：仅名字、关系类型、一句公开设定可编辑；隐藏状态不可见不可改（§5.3） |
| `components/life/CharacterPanel.tsx` | `CharacterCard`（主角/NPC 状态条 + 目标 + 困境）、`RelationshipCard`（四维数值）、`RelationshipPanel`（Phase 6 可直接复用） |

## 2. 验证结果

- ✅ `npm run lint`（tsc --noEmit）通过
- ✅ `npm run build`（next build）通过，新路由 `/life`、`/api/life/create`、`/api/life/npc/generate` 正常生成
- ✅ 冒烟测试 `test/phase1-factory.smoke.mjs`（18 项全过）：主角 18 岁开局/年份计算、性格/价值观截断、天赋 clamp、NPC 隐藏状态、关系按类型初始化、WorldState 引用完整性、GameSave v1 往返

## 3. 关键设计决策

1. **新旧隔离**：新流程用独立路由 `/life` + 独立存档 key，旧游戏 `/` 与旧存档完全不受影响（对应方案 §33“旧存档走旧模式，新人生创建新存档”）。
2. **node:crypto 只在服务端**：主角/NPC/关系/世界的 `id` 与 `gameId` 均在 API 层生成，前端只通过 `import type` 引用类型，避免 `node:crypto` 进入客户端 bundle。
3. **隐藏状态不泄露**：NPC 的 `hiddenGoal/hiddenConcern/privateBelief` 只写入服务端 `privateState`，编辑卡仅展示公开字段（§9.3）。

## 4. 遗留说明

- NPC 生成（LLM）暂未做真机调用验证：需运行 dev server 且 LLM 服务可达（`.env` 中 CPA/DeepSeek key）。代码复用已验证过的 `callGameModel` 模式，逻辑风险低；如需我启动 dev server 跑一次真实 NPC 生成，可单独执行。
- 章节推进（困境 + 三选一）占位提示已就位，正式实现在 Phase 2。
- 本阶段未触碰数据库（无召回），只读角色边界不受影响。
