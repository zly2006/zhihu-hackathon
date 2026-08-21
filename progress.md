# 进度日志

## 会话：2026-08-21（真实知乎公开数据）

- 已删除“用合成演示数据代表真实采集”的做法，新增 `manual_url_capture` 受限导入适配器。
- 新增公开页面采集器 `scripts/collect_zhihu_public.py`：默认接受知乎 `/en/answer/<id>` 页面；用户明确提供本机 Cookie 时可捕获对应 `/answer/<id>` 原始页面，保留真实回答 URL、响应哈希和 `content.raw_html`。
- 使用用户提供的本机 Cookie 采集并校验 6 条中文真实回答到 `data/zhihu/public_answers.jsonl`；Cookie 未上传、未入库、未提交 Git。
- 采集器、契约、导入和数据集测试通过；后续批量采集仍需知乎授权。

## 会话：2026-08-20

### 阶段 1：需求与外部调研

- **状态：** 已完成
- 已完成：
  - 检查工作区；未发现既有 Markdown、规划文件或领域词汇文件。
  - 提炼用户目标、范围边界和五个关键研究问题。
  - 初始化 `task_plan.md`、`findings.md` 和 `progress.md`。
  - 调研 `zly2006` GitHub 主页、`zhurl` 仓库及 API 索引，确定上游适配方向。
  - 核对搜索、推荐、热榜等发现接口，明确两阶段采集（候选发现 → 内容详情）。
  - 核对回答详情与问题回答列表，确认内容快照和决策经历需要一对多建模。
  - 调研知乎个人信息保护指引和个人信息保护法，提炼最小化、敏感信息隔离和删除同步要求。
  - 只读核对知乎协议、robots.txt 与 `zhurl` 许可证元数据，确认自动采集和源码复用需先解决授权。
- 已创建文件：
  - `task_plan.md`
  - `findings.md`
  - `progress.md`
  - `findings.md`（补充外部调研）
  - `CONTEXT.md`（新增领域词汇表）

### 阶段 2：领域模型与数据契约

- **状态：** 已完成
- 已完成：
  - 定义来源内容、内容快照、证据片段、决策经历、规范情景、叙事路径、路径模式、候选分叉和分叉路口。
  - 明确所有经历与结果均为叙事主张，不自动视为事实或因果结论。
  - 核对 PostgreSQL 18 与 pgvector 0.8.6 能力，确定单库 MVP 和延后图数据库的方向。
  - 完成 Source Adapter 契约、核心表分层、溯源/版本不变量和索引方案。

### 阶段 3：分析、检索与分叉识别

- **状态：** 已完成
- 已完成：
  - 设计从合法数据入口到经历抽取、情景合并、路径构造和分叉审核的完整流水线。
  - 采用 blocking + Top-K + 精确比较，避免全量路径 O(N²) 比较。
  - 设计增量更新、质量分、人审队列和离线评估指标。

### 阶段 4：编写交付文档

- **状态：** 已完成
- 已创建：
  - `知乎决策路径数据库落地方案.md`
- 文档包含：
  - 调研结论和授权门槛；
  - `SourceRecordV1` 与 `DecisionEpisodeV1` 示例；
  - 数据库表、索引、不变量和权限边界；
  - 检索、路径比较、分叉识别和增量算法；
  - 48 小时演示版与 4–6 周试点计划。

### 阶段 5：核验与交付

- **状态：** 已完成
- 已完成：
  - 检查 Markdown 结构、内部链接、术语一致性与需求覆盖。
  - 两个 JSON 示例均通过 PowerShell JSON 解析。
  - Markdown 代码围栏配对，标题无重复，`CONTEXT.md` 内部链接存在。
  - 所有实际 Markdown 外部引用均可通过 HEAD 或降级 GET 访问；示例中的虚构知乎 URL 不作为引用检查。
  - 修正“内容类型”章节标题由三类为五类。

### 阶段 6：开源知识库候选广泛调研

- **状态：** 已完成
- 已完成：
  - 将新目标定义为“选择第一版可采用的开源知识库底座”，而非简单罗列热门项目。
  - 建立领域适配、证据溯源、增量时序、数据扩展、图分析、工程成熟度、许可证和中文适配的评分框架。
  - 广泛扫描时序知识图谱、GraphRAG、企业知识库与中文知识图谱框架，形成三层候选长名单。
  - 第一梯队暂定 Graphiti、Cognee、OpenSPG/KAG；第二梯队为 LightRAG、Microsoft GraphRAG、RAGFlow。
  - 通过 GitHub API 记录 6 个候选的许可证、活跃度、release 和规模快照。
  - 完成 Graphiti episode、双时序、provenance、自定义类型、saga、删除和数据库后端的第一轮深度核验。
  - 完成 Cognee 的管道、DataPoint、多后端、权限、provenance 与 Graphiti 集成核验。
  - 完成 KAG 的 schema、chunk 互索、推理、产品部署和维护节奏核验。
  - 完成 Microsoft GraphRAG 的 TextUnit 溯源、增量更新、社区索引与时序缺口核验。
  - 完成 LightRAG 的增量/删除、多存储、来源数量边界与领域 schema 缺口核验。
  - 完成 RAGFlow 的文档产品能力、GraphRAG 更新成本和当前工程风险核验。
  - 补充扫描 FalkorDB GraphRAG-SDK、FastGraphRAG、Neo4j LLM Graph Builder、Dify、LlamaIndex、HippoRAG/nano-graphrag，形成“不进入决赛”的能力边界。
  - 反向核验 Graphiti 当前公开 issues，识别 FalkorDB 多 group 并发、长 episode 吞吐、自定义关系属性、外部 UUID、治理与 MCP 路由风险，并形成首版采用护栏。
  - 追加核验 FalkorDB GraphRAG-SDK v1.4.0 的来源链、crash-safe 增量、并发测试、全图 finalize 成本及 temporal graph 路线图；因时序尚未交付，不进入最终推荐。
  - 核验 Graphiti 官方数据库建议和 bulk ingestion 边界；确定首版采用 Neo4j 单库，bulk 仅用于空图初装，持续更新使用普通 episode 写入。
- 已产出：
  - `知识库开源底座选型调研.md`

### 阶段 7：重点候选深度核验

- **状态：** 已完成
- 完成 Graphiti、Cognee、OpenSPG/KAG、Microsoft GraphRAG、LightRAG、RAGFlow 与 FalkorDB GraphRAG-SDK 的官方文档、源码和公开 issue 级核验。
- 对 Graphiti 额外执行反方审查，确认采用时必须规避 FalkorDB 多 group 并发、长 episode、自定义 edge attribute、外部 UUID 与 MCP 路由风险。

### 阶段 8：评分与唯一推荐

- **状态：** 已完成
- 按八项权重完成加权评分；Graphiti 以 93.5/100 排名第一。
- 最终决定：Graphiti 是唯一主推荐；Cognee、KAG 等只保留为条件备选或后期组件。
- 决定第一版使用 PostgreSQL 权威层 + Graphiti/Neo4j 可重建图投影 + 自有分叉分析器。

### 阶段 9：报告、方案更新与核验

- **状态：** 已完成
- 新建 `知识库开源底座选型调研.md`，包含 13 类候选、加权评分、唯一推荐、KISS 架构、风险护栏、第一版验收和六周路线。
- 将 `知乎决策路径数据库落地方案.md` 升级至 0.2：第一版引入 Graphiti/Neo4j，但保持 PostgreSQL 为唯一权威证据库。
- 修正原方案的图投影表、数据库不变量、索引、验收线、实施路线、风险和冻结决策。

### 阶段 10：实施主计划

- **状态：** 已完成
- 用户要求继续完善 `plan.md`。工作区没有现成 `plan.md`，只有已完成的调研过程文件 `task_plan.md`。
- 决定新建 `PLAN.md` 作为后续建设的唯一执行入口；`task_plan.md` 继续记录规划工作的阶段状态，两个文件职责分开。
- 已创建 `PLAN.md`：以“原文、卡片、抽屉、路口”为 KISS 心智模型，定义 M0–M7 八个实施里程碑。
- 计划包含冻结架构、五个版本契约、详细任务、里程碑退出门、Graphiti 十项阻断门、需求—任务—测试矩阵、测试分层、下一批十项任务和变更控制。

### 阶段 11：计划一致性核验

- **状态：** 已完成
- 已核验 `PLAN.md` 与 `MISSION.md`、`CONTEXT.md`、底座选型和主方案的一致性。
- 已完成第一轮结构检查：围栏配对、标题唯一、63 个任务 ID 唯一、三个内部链接存在。
- 已补充责任角色、统一工作项状态、单任务完成定义和九项主动风险登记。
- 已更新 `RESOURCES.md`，把 `PLAN.md` 和底座选型加入团队知识入口。
- 最终机器检查：M0–M7 八个里程碑齐全；63 个任务全部有定义、无重复、无悬空引用；`PLAN.md` 与 `RESOURCES.md` 的 7 个内部链接全部存在；关键领域术语和冻结技术决策全部出现。

### 阶段 12：初始系统纵向骨架

- **状态：** 已完成
- 用户授权开始初步搭建系统。
- 采用测试先行的首个纵向切片：`SourceRecordV1 → 幂等 ContentSnapshot`。
- 已检查工作区：无应用代码、无 `AGENTS.md`、不是 Git 仓库。
- 初始范围冻结为契约、PostgreSQL/Neo4j 开发环境、幂等原文写入、健康/API 接口、Worker 和图投影 seam；暂不实现不可验证的 LLM/分叉逻辑。
- 首次规划补丁因上下文已变化而未应用；已读取当前文件并改用精确小补丁，避免重复失败。
- 环境检查：uv 和 CPython 3.12.12 可用；系统默认 Python 为 3.11.9；Docker CLI 不可用。
- 处理决定：使用 uv 管理 Python 3.12 独立环境；仍交付 Compose 文件，但不伪造容器启动验证结果。
- 首次 `uv sync` 在构建 editable package 时发现 `README.md` 缺失；已补充最小 README 和空 package 根目录后改用修正后的同步流程。
- 已创建 PostgreSQL、Neo4j 与 API 的 Compose 配置；API 只依赖权威库 PostgreSQL，图存储不可用不会阻断原文写入。当前机器缺少 Docker，故只完成配置静态核对，不记录虚假的容器实跑结果。

### 阶段 13：契约测试与实现

- **状态：** 已完成
- RED→GREEN 完成 `SourceRecordV1`：合法记录可解析、错误 schema/URL/时间/hash 被拒绝、SHA-256 统一小写。
- RED→GREEN 完成 `DecisionEpisodeV1`：合法决策经历可解析、置信度/证据列表受约束、同一 episode 内重复 `claim_id` 被拒绝。
- 当前契约测试 4/4 通过；mypy strict 通过。
- Ruff 仅报告两个测试文件的 import 顺序，已记录为纯格式修复项。

### 阶段 14：原文幂等写入纵向切片

- **状态：** 已完成
- 已实现 `POST /v1/source-records:batch` 和 `GET /health`。
- 已实现 `source_authorization/raw_envelope/content_item/content_snapshot` 及首个 Alembic 迁移。
- 自动来源必须命中来源、Adapter、状态和有效期均匹配的授权记录；仅提供任意授权字符串不能绕过门禁。
- 原始响应以 raw hash 幂等保留；正文另算稳定 hash，所以互动指标变化会保留新原始输入，但不会虚增正文版本。
- 已补充原始证据不变量：`ContentItem` 保留规范 URL，`RawEnvelope` 保留每次输入的 URL/HTML，`ContentSnapshot` 保留对应 HTML 片段；HTML 格式记录缺失 `raw_html` 会在契约层拒绝。
- 新增 `20260821_0002_raw_provenance` 迁移，并验证旧 payload 可回填 URL/HTML。
- 验证结果：Ruff、mypy strict、迁移模型一致性及 17 项测试全部通过；另以真实 Uvicorn 进程执行迁移并请求 `/health`，返回 `{"status":"ok","database":"ok"}`。

## 验证结果

| 检查 | 预期 | 实际 | 状态 |
|---|---|---|---|
| 工作区既有文件检查 | 识别并保护已有文档 | 未发现已有目标文件 | 通过 |
| Markdown 结构 | 主方案 | 围栏配对、标题唯一 | 围栏配对、无重复标题 | 通过 |
| JSON 示例 | 2 个代码块 | 均可解析 | 2/2 可解析 | 通过 |
| 内部链接 | `./CONTEXT.md` | 文件存在 | 存在 | 通过 |
| 外部引用 | 主文档 Markdown 链接 | 可访问 | 均返回 200（HEAD 或 GET） | 通过 |
| 需求覆盖 | 用户原始要求 | 采集兼容、单条数据、情景、路径、分叉、高效比较、路线图 | 全部覆盖 | 通过 |
| 选型报告 Markdown | 新报告 | 围栏配对、标题唯一、内部链接存在 | 8 个围栏配对、无重复标题 | 通过 |
| 选型报告外部引用 | 24 个唯一 URL | 官方链接可访问 | 24/24 可访问 | 通过 |
| 原方案一致性 | Graphiti 第一版架构 | 不再保留“图数据库延后”的旧结论 | 已统一为权威库 + 可重建图投影 | 通过 |
| `PLAN.md` 任务完整性 | 任务 ID 有定义、唯一、无悬空引用 | 63 个定义、63 个唯一引用 | 通过 |
| `PLAN.md` 里程碑 | M0–M7 完整且依赖闭合 | 8/8 | 通过 |
| `PLAN.md`/资源内部链接 | 所有相对链接存在 | 7/7 | 通过 |
| 关键术语与架构 | 与 Mission、Context、选型和主方案一致 | 13/13 关键项存在 | 通过 |

## 错误日志

| 时间 | 错误 | 尝试 | 解决方式 |
|---|---|---:|---|
| — | 暂无 | 1 | — |
| 2026-08-20 | Web 工具读取 robots.txt、知乎服务协议及法律 PDF 失败 | 1 | 改用只读 HTTP，并将未核实项列为上线门槛 |
| 2026-08-20 | PowerShell 并行链接检查的 `$_` 在 catch 中被异常对象覆盖 | 1 | 改为先保存 `$link` 并用明确变量发起降级 GET |
| 2026-08-20 | 规划完成检查器未识别中文状态标签，误报 0/0 | 1 | 将 `task_plan.md` 阶段状态改为 `Status: complete` 并复检 |
| 2026-08-20 | 检查器依赖英文 `### Phase`，中文标题导致 5/0 | 2 | 阅读脚本并改用兼容的阶段标题前缀 |
| 2026-08-21 | Windows 伪终端拒绝启动 Uvicorn | 1 | 改用隐藏后台进程做 HTTP 烟测，页面、静态资源和统计 API 均返回 200 |
| 2026-08-21 | PowerShell `$pid` 是只读保留变量 | 1 | 改用 `$serverPid` 停止烟测进程 |

### 阶段 17：本地双端工作台（已完成）

- **目标：** 在现有原文入库 API 之上，交付一个可直接本地打开的用户端和管理端。
- **边界：** 用户端面向检索和证据阅读；管理端面向数据库查看、幂等导入、人工情景/分叉维护；不在本阶段虚构自动 LLM 结论。
- **决定：** 采用 FastAPI 静态页面 + SQLite 默认配置，保留 PostgreSQL/Compose 兼容；原始 URL 和 raw HTML 只读保留。
- **交付：** 新增 `decision_scenario`/`decision_branch`、审核状态、用户端 `/`、管理端 `/admin`、搜索/证据/API、JSONL 导入和真实数据自动初始化。
- **验证：** 31 项测试通过；Ruff、mypy、Alembic check、两个前端 JS 语法检查通过；Uvicorn HTTP 烟测的用户端、管理端和统计 API 均返回 200。

### 阶段 18：数据库分层呈现重构（进行中）

- **触发原因：** 用户反馈当前页面像回答列表，不像数据库；实际库为 6 条原文/快照、0 条情景/分叉，空状态没有被解释。
- **重构方向：** 用户端“情景/分叉 → 证据”，管理端“总览 → 快照库 → 情景 → 分叉”；表格承载事实，抽屉承载原始证据。
- **完成：** 新增 `/api/overview`；用户端改为流水线总览、情景优先、快照回溯；管理端增加层级导航、流水线统计和“快照库”语义。
- **验证：** 32 项测试通过；页面、静态资源和总览 API 在运行中的本地服务返回 200。
