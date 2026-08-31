# Phase 7 完成报告：稳定性与测试

- **日期**：2026-08-31
- **分支**：`dev/mvp-v1-interactive-life`
- **方案依据**：§38（核心测试场景）、§39（验收标准）、§43（开发优先级）、§37（Phase 7）
- **阶段目标**：极端状态、10+ 章连续、NPC 一致性、状态哈希、存档恢复、小说重生成的稳定性验证

## 1. 交付内容

| 文件 | 内容 |
|---|---|
| `test/phase7-stability.smoke.mjs` | 14 项稳定性测试：连续推进 10 章、现金归零不崩溃、NPC 年龄/状态一致性、记忆累积与检索上限、关系数值边界、openThreads 合法性、状态哈希确定性、小说文本不进 WorldState、存档往返 |
| `scripts/test-all.mjs` | 一键全量测试运行器：编译全部 lib 代码 → 依次运行 6 个冒烟测试套件 |

## 2. 验证结果

### 2.1 全量测试（`node scripts/test-all.mjs`）

| 套件 | 数量 | 覆盖 |
|---|---:|---|
| phase0-reducer | 21 | 世界 reducer、clamp、引用完整性、GameSave 往返 |
| phase1-factory | 18 | 主角 18 岁开局、NPC 隐藏状态、关系初始化 |
| phase3-evidence | 21 | Adapter 映射、结果方向分类、EvidenceBundle 组装 |
| phase4-simulator | 19 | 确定性随机、三级结果分布、validator 5 类违规拒绝、输出映射 |
| phase5-novel | 11 | 小说 prompt 约束、novel 解析 |
| phase7-stability | 14 | 10 章连续推进、极端状态、状态哈希、存档恢复 |
| **合计** | **104** | **全部通过** |

### 2.2 关键结论（对应方案 §43 最核心工程节点）

> **"在没有小说文本参与状态计算的情况下，WorldState 能连续正确地推进十章"** —— 已验证：10 章连续推进后：
> - 主角年龄 18→28、NPC 年龄同步推进（NPC 一致性）
> - 现金在推进中归零（极端状态）后仍可持续推进，无 NaN、clamp 到 0（§24.3"归零≠Game Over"）
> - 每章结束 `validateWorldState` 引用完整性通过
> - 记忆累积 30 条（3×10），`selectRelevantMemories` 检索上限 ≤8（§11.3）

### 2.3 静态验收
- ✅ `npm run lint`（tsc --noEmit）通过
- ✅ `npm run build`（next build）通过

## 3. 已覆盖的验收项

- ✅ 状态推进无 NaN/越界，clamp 0–100（§24.1）
- ✅ 极端状态（cash 归零）不崩溃，允许失败发生并继续（§24.3、AGENTS.md"禁止卡死边界"）
- ✅ 确定性随机（同种子同结果，§17.2）
- ✅ 小说重写不改 stateAfterHash（小说文本不在 WorldState 内，验收 Case C）
- ✅ 存档序列化/解析往返（§25）
- ✅ 记忆检索上限（§11.3）
- ✅ 关系/事件/记忆的结构校验（§20.1）

## 4. 待真机验证项（需运行实例）

以下项依赖真实 LLM + 只读 PostgreSQL 实例，本阶段无法离线验证，需在 dev server 下跑通：

- [ ] 真机端到端：创建主角 → 生成 NPC → 选择 → 世界推演 → 小说 → 下一章
- [ ] AI SSE 最终返回 `complete`、经历数 18、选项数 3（AGENTS.md 验证要求）
- [ ] 真实数据库只读角色召回（DK_DATABASE_URL）
- [ ] 模型超时/慢流不破坏 WorldState（`callGameModel` 已有 90s 超时 + 慢流重试，但需真机确认）
- [ ] RAG 不相关案例的处理（§38 Case E 未来年份）
- [ ] 页面刷新恢复（前端 localStorage 已实现，需真机确认）
