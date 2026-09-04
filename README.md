# 知乎互动人生小说（Restart Life · MVP v1）

以知乎真实人生经历为现实底座、由大模型负责长期世界推演和小说叙事的多角色互动人生小说。

玩家只控制一名主角；系统维护主角与 3 名核心 NPC 的长期状态、目标、记忆和关系。每一章玩家为
主角选择一次重要人生方向（A/B/C/自定义），系统检索知乎真实经历作为现实参照，推演未来
1 年或 3 年，再将已确定的结构化人生事件文学化为一章互动小说。

> 旧版"从 0 岁开始的重启人生"玩法保留在首页 `/`；新版互动人生在 `/life`，使用独立存档。

## 核心玩法

```
当前世界状态（主角 + 3 NPC + 关系 + 记忆 + 线索）
    ↓
玩家选择人生方向（1 年 / 3 年）
    ↓
知乎真实经历 RAG（EvidenceBundle，≈18 条）
    ↓
程序确定性结果锚点（favorable / mixed / setback）
    ↓
World Simulator → SimulationEvent[]（canonical 事实）
    ↓
更新 WorldState（人物、关系、记忆、线索）
    ↓
Novel Writer 文学化 → 章节小说（可重写，不改事实）
    ↓
进入下一章
```

三种数据永久分离：**知乎 LifeExperience**（现实经验，个案非因果）≠ **SimulationEvent**
（本局 canonical 事实）≠ **Chapter Novel**（文学表达，可重写文风但不能改变事实）。

## 快速开始

仓库自带 `.env`（连接远程只读数据库与 LLM 服务），克隆后即可安装和启动：

```bash
npm ci
npm run dev -- --port 3111
```

本项目测试入口为 <http://127.0.0.1:3111/life>，打开后开始新的人生。
如果直接运行 `npm run dev`，Next.js 默认使用 3000 端口，对应地址为 <http://127.0.0.1:3000/life>。
生产构建：

```bash
npm run lint
npm run build
npm start
```

全量测试（编译 + 6 个冒烟测试套件，104 项）：

```bash
node scripts/test-all.mjs
```

## 架构与目录

```text
lib/domain/    shared / character / relationship / memory / world /
               experience / simulation / chapter / validate   ← 7 个核心领域对象
lib/game/      character-factory / npc-generator / choice-generator /
               evidence-retriever / experience-adapter / memory-selector /
               decision-resolver / world-simulator / simulation-validator /
               novel-writer / world-reducer / save / hash
app/api/       life/npc/generate · life/create（人生创建）
               chapter/choices · chapter/simulate · chapter/novel（章节三阶段）
components/life/  LifeApp / ProtagonistSetup / NpcSetup / DecisionPanel /
               CharacterPanel / RelationshipPanel / NovelReader /
               ChapterSummary / TimelinePanel / EvidencePanel
```

关键机制：

- **确定性结果锚点**：`DecisionResolution` 由程序计算（SHA-256 种子 → 三级分布），
  同一存档/章节/选择必得同一结果，禁止"刷结果"；World Simulator 只负责把锚点解释成具体事件。
- **NPC 自主**：NPC 有独立目标、隐藏状态与关系，不自动服从主角。
- **短别名引用**：LLM 只引用 `C1/R1/E1/T1/G1/H1/I1` 等短别名，服务端映射回真实 id，
  避免模型截断 UUID 导致引用失效。
- **失败恢复**：模拟失败不写 canonical；小说失败单独重试，绝不重新模拟人生。

## 模型配置

- `MODEL_PROVIDER` 可选 `opencodego`（默认）或 `deepseek`。
- OpenCodeGo 使用 `CPA_REASONING_EFFORT`（`low`/`medium`/`high`）；DeepSeek 使用
  `thinking.type=disabled` 低延迟生成。
- 长输出场景（世界推演、小说生成）使用 `max_tokens=8000`、超时 180s；其余默认 3200/90s。

## 数据边界

- 浏览器不直连数据库，所有查询只发生在 Next.js 服务端。
- 默认数据库角色强制只读（`svc_restart_life_ro`），不能建表、删表或修改数据。
- 游戏热路径只读取 `content_snapshot` 上的来源和作者字段，不解析原始大 JSON。
- 数据库 schema、迁移和 DBA 操作由上游数据仓库治理，本仓库不携带 owner 或管理员凭据。

## 业务成功标准

AI 接口返回 SSE。HTTP 200 只代表流建立成功；必须最终收到 `complete` 才算成功。
世界推演必须通过程序严格校验（事件数按跨度、id 合法、增量有限、记忆 3-6 条），
收到 `error` 或校验失败仍是业务失败。

## 文档

- 玩法与技术方案（V1.0 Final）：[docs/知乎互动人生小说_MVP_v1 .md](./docs/知乎互动人生小说_MVP_v1%20.md)
- 工程约束：[AGENTS.md](./AGENTS.md)
- 数据库字段说明：[docs/database.md](./docs/database.md)
- 部署方式：[docs/deployment.md](./docs/deployment.md)
- 分阶段完成报告与真机验证反馈：[docs/phase-reports/](./docs/phase-reports/)
