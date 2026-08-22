# 任务计划：知乎人生决策路径数据库调研与落地方案

## 目标

产出并维护一套可执行的 Markdown 规划：说明如何把知乎回答标准化为单条数据，聚合成决策情景与人生路径，识别可检索、可比较的分叉路口；完成开源底座选型，并将研究结论转化为带依赖、质量门和完成定义的 `PLAN.md`。

## 当前阶段

Phase 31：全自动情景归并与分叉确认已完成

## 阶段

### Phase 1：需求与外部调研

- [x] 提炼用户目标与范围边界
- [x] 调研 `zly2006` 账号下相关知乎采集仓库
- [x] 调研可复用的知乎数据字段与采集边界
- [x] 记录发现到 `findings.md`
- **Status:** complete

### Phase 2：领域模型与数据契约

- [x] 定义“回答、单条数据、情景、路径、分叉路口”等规范术语
- [x] 设计爬虫输入契约和标准化事实模型
- [x] 设计实体关系、溯源和版本机制
- **Status:** complete

### Phase 3：分析、检索与分叉识别方案

- [x] 设计从检索回答到构建路径的处理流水线
- [x] 设计情景合并、路径比较和分叉识别算法
- [x] 设计人机协作、质量分和高效增量计算机制
- **Status:** complete

### Phase 4：编写交付文档

- [x] 编写主方案 Markdown
- [x] 写清数据库表、索引、API 契约和示例数据
- [x] 写清 MVP 阶段、验收标准、风险与非目标
- **Status:** complete

### Phase 5：核验与交付

- [x] 核对文档是否覆盖用户全部要求
- [x] 检查模型闭环、可实施性与引用来源
- [x] 完成交付说明
- **Status:** complete

### Phase 6：开源知识库候选广泛调研

- [x] 建立与决策情景知识库匹配的选型标准
- [x] 广泛搜索知识图谱、GraphRAG、RAG/知识库与时序图候选
- [x] 形成候选长名单并排除明显不匹配者
- **Status:** complete

### Phase 7：重点候选深度核验

- [x] 核验核心架构、数据模型、增量更新和证据溯源能力
- [x] 核验许可证、维护活跃度、部署复杂度与中文适配
- [x] 对关键候选进行源码/文档级对比
- **Status:** complete

### Phase 8：评分与唯一推荐

- [x] 建立加权评分矩阵
- [x] 确定唯一主推荐和条件备选
- [x] 写清采用边界、缺口和改造量
- **Status:** complete

### Phase 9：形成选型报告并核验

- [x] 编写开源知识库底座选型报告
- [x] 更新原方案中的底座建议
- [x] 核验引用、结论和用户需求覆盖
- **Status:** complete

### Phase 10：建立实施主计划

- [x] 创建面向项目执行的唯一入口 `PLAN.md`
- [x] 明确里程碑、任务依赖、交付物、验收测试和完成定义
- [x] 将 Graphiti 风险护栏转化为阻断式质量门
- [x] 建立需求—任务—测试可追踪矩阵
- **Status:** complete

### Phase 11：计划一致性核验

- [x] 对齐 `MISSION.md`、`CONTEXT.md`、选型报告和主方案
- [x] 检查 Markdown、内部链接、任务依赖和术语一致性
- [x] 记录验证结果并完成交付
- **Status:** complete

### Phase 12：确定首个纵向切片并初始化工程

- [x] 冻结首个公开 interface 与可验证行为
- [x] 创建最小 Python 项目、模块目录和运行配置
- [x] 创建 PostgreSQL/Neo4j Docker Compose 与健康检查
- **Status:** complete

### Phase 13：契约测试与实现

- [x] 测试先行实现 `SourceRecordV1`
- [x] 测试先行实现 `DecisionEpisodeV1`
- [x] 准备有效、无效和边界 fixtures
- **Status:** complete

### Phase 14：原文幂等写入纵向切片

- [x] 测试批量写入成功、重复写入不重复、授权门禁
- [x] 实现最小数据库模型、迁移和写入 module
- [x] 实现 `POST /v1/source-records:batch` 与健康接口
- **Status:** complete

### Phase 15：图投影 seam 与后台 Worker 骨架

- [ ] 定义 GraphProjection interface，不提前实现抽取算法
- [ ] 创建 Worker 入口和可观察的待处理状态
- [ ] 验证 API/Worker/数据库在 Compose 中的配置闭环
- **Status:** pending

本阶段留到出现第一个真实 Graphiti Adapter 时再做；当前没有第二个实现方，提前创建空 interface 和假 Worker 会增加无可验证代码。Neo4j 配置与容器已预留，但不阻塞权威数据入库。

### Phase 16：全量验证、自审与交付

- [x] 运行格式、静态检查、单测和全量测试
- [x] 审查变更是否越过初始切片范围
- [x] 更新 `PLAN.md`、`progress.md` 和运行说明
- [x] 在存在 Git 仓库时提交；否则记录无法提交的原因
- **Status:** complete

### Phase 17：本地双端工作台

- [x] 固定 KISS 的本地双端边界：用户端检索/阅读/路径浏览，管理端数据查看/导入/审核/编辑
- [x] 增加情景与分叉的最小可审核数据模型和迁移
- [x] 增加用户端与管理端 API，并保持原有批量导入接口兼容
- [x] 增加无前端构建依赖的本地双端页面，直接由 FastAPI 提供
- [x] 用真实知乎 JSONL 初始化本地 SQLite，并提供幂等导入
- [x] 增加 API、权限边界和页面可用性测试，完成本地启动说明
- **Status:** complete

### Phase 18：数据库分层呈现重构

- [x] 增加公开数据库流水线总览接口，明确原文/快照/情景/分叉数量
- [x] 将用户端改为情景与分叉优先，证据回答作为回溯层
- [x] 将管理端改为总览、快照库、情景、分叉的分层工作台
- [x] 明确空状态、审核状态和数据层级，不把回答列表伪装成知识库
- [x] 增加页面/API 回归测试并完成本地烟测
- **Status:** complete

### Phase 19：低噪声数据库工作台

- [x] 移除营销式首屏、重复统计和装饰性卡片
- [x] 将用户端收敛为“情景/分叉优先，原文快照可回溯”的紧凑数据视图
- [x] 将管理端收敛为“快照表格 + 详情检查器”的数据库工作台
- [x] 建立单一强调色、细边框、高密度的界面规范并完成响应式适配
- [x] 完成页面契约、自动化测试和桌面/移动端视觉核验
- **Status:** complete

### Phase 20：知乎搜索—问题采集适配器

- [x] 测试先行定义搜索结果、问题回答列表和回答详情的转换契约
- [x] 实现有界的 `zhurl` 三段式采集命令，不复用 `manual_url_capture`
- [x] 在每条 SourceRecord 中保留搜索、问题列表和回答详情的原始证据
- [x] 补充运行说明、授权边界和回归验证
- **Status:** complete

### Phase 21：质量门与关键词滚雪球

- [x] 测试先行定义回答质量评分、拒收规则和关键词扩展规则
- [x] 将质量评分接入搜索—问题—回答采集流程，低质量回答不进入 SourceRecord
- [x] 只从通过质量门的回答提取下一轮关键词，并设置轮次、问题、候选和关键词上限
- [x] 将质量判定、关键词候选和发现轮次写入原始证据
- [x] 完成全量验证并更新运行说明
- **Status:** complete

### Phase 22：滚雪球血缘与决策候选

- [x] 为每次滚雪球采集保存 `discovery_run_id`，让关键词、问题、回答和轮次可回放
- [x] 将通过质量门的关键词候选持久化，支持按频次/质量分生成下一轮查询
- [x] 从通过质量门的回答生成可审核的“决策经历候选”，保留上下文/决策/行动/结果证据片段
- [x] 增加管理端 API 与低噪声候选面板，不把候选直接伪装成正式情景或分叉
- [x] 更新迁移、文档和回归测试
- **Status:** complete

### Phase 23：本机 Cookie 搜索采集通道

- [x] 在不改变搜索 → 问题 → 回答链路的前提下增加 `--cookie-file` 请求传输
- [x] Cookie 只由 curl 进程读取，不写入记录、数据库、日志或仓库
- [x] 为 Cookie 请求、HTTP 错误和 JSON 解析补充可测试的边界行为
- [x] 使用用户提供的本机 Cookie 做小规模真实采集验证，不注入演示数据
- [x] 更新运行说明并保留 `zhurl` 作为默认可替换传输方式
- **Status:** complete

### Phase 24：真实回答初始数据集（目标约 1000 条）

- [x] 使用用户 Cookie 按主题词分批运行搜索 → 问题 → 回答采集
- [x] 每批导入本地 SQLite，检查授权、质量门、原文 HTML 和幂等去重
- [x] 以唯一回答/快照数量为准，补采到本地数据库 1000 条唯一回答快照
- [x] 保留批次 JSONL 作为本机可回放材料，不提交包含原文/API 响应的文件
- [x] 汇报最终数量、重复量、质量候选和未完成原因（知乎 API 风控期间，补充 34 条明确标记的搜索结果恢复记录）
- **Status:** complete

**交付记录（2026-08-21）：** 18 个 Cookie 分批运行成功导入 994 条正式/旧来源记录，
幂等后形成 966 条唯一回答快照；知乎随后返回业务错误码 40352（网络环境异常，需要网页验证）。
未绕过验证，改从本机已保存的搜索响应中筛选 34 条质量通过且包含原始回答 HTML 的回答，
以 `capture_method=zhihu_search_result_promotion`、`promotion_stage=search_result_only` 明确标记后导入，
因此最终为 1000 条唯一回答快照。数据库同时保留 1034 个原始证据包（含重复发现来源）；
1000/1000 快照均有知乎回答 URL 和非空 `raw_html`。后续 API 恢复后，应优先用回答详情端点
补齐这 34 条的详情响应，而不是把它们误当成完整三段式详情采集。

### Phase 25：数据集扩容（当前 1585 条）

- [x] 在 40352 风控未解除期间，只从本机已有真实搜索响应筛选新增回答，不发起绕过验证的请求
- [x] 继续使用同一质量门、URL/HTML 原文契约和 ContentSnapshot 幂等导入
- [x] 将数据库从 1000 条扩充到 1585 条唯一回答快照
- [x] 为新增恢复记录保留 `capture_method=zhihu_search_result_promotion`，与完整三段式详情区分
- **Status:** complete

**扩容结果（2026-08-21）：** 在 500 条扩容后又导入本机缓存中剩余的 85 条质量通过记录；数据库当前为
1585 个唯一回答、1585 个快照、1619 个原始证据包、1070 个决策候选。全部快照均有
知乎回答 URL 和非空 `raw_html`，其中 619 条为搜索结果恢复记录；知乎 API 恢复后应批量补齐其回答详情。

### Phase 26：扩充到 10000 条

- [x] 将本机已有真实搜索响应全部安全扩充到 1585 条唯一回答
- [x] 使用用户完成网页验证后的 Cookie，使搜索/问题/回答 API 恢复可用
- [x] 按限速、失败跳过、导入即去重的方式继续采集至 10000 条
- [x] 对新增数据执行 URL、HTML、质量门、原始响应和候选派生检查
- **Status:** complete

**扩容结果（2026-08-21）：** 通过真实 `search_v3` 发现问题，再以问题回答接口批量抓取；问题流中的完整
回答 HTML 直接作为原始内容保留，并记录 `answer_capture=question_feed_target`，避免无必要的逐回答重复请求。
数据库当前为 **10396 个唯一回答、10397 个快照、10672 个原始证据包**，另有 13823 个关键词候选、7221 个
决策经历候选和 73 次发现运行。全部原始信封均有知乎回答规范 URL 和非空 `raw_html`；质量门通过的 API
记录为 10666/10666。搜索/问题接口偶发 403 的关键词被跳过，没有绕过验证或写入演示数据。

为防止问题流 HTML 中的 Unicode 行分隔符破坏 JSONL，采集器已在写出时转义 `U+2028/U+2029`；批处理器
`scripts/expand_zhihu_question_batches.py` 会记录已尝试的问题 ID，避免空结果死循环。达到 10000 条后已停止继续采集。

### Phase 27：真实对话形态调查与知识模型简化

- [x] 抽样检查真实知乎回答，按叙述形态判断哪些能形成决策经历、哪些只能保留观点或来源文本。
- [x] 统计当前启发式候选的重复、缺字段、建议/亲历混淆和结果缺失情况。
- [x] 用样本反推第一版最小数据模型，明确必填字段、可选字段和不可推断字段。
- [x] 将“问题标题聚合”降级为探索投影，避免把来源元数据当成正式情景。
- [x] 更新 `findings.md`、`progress.md` 和知识库模型文档。
- **Status:** complete

本阶段退出门：完成分层抽样和人工复核样本；能解释无法总结的回答如何入库；
能给出不强迫所有回答进入 `DecisionEpisode` 的数据库关系；未通过退出门前不新增正式情景/分叉数据。

## 关键问题

1. `zly2006` 的哪个仓库与知乎采集直接相关，其输出数据结构是什么？
2. “单条数据”的最小语义单元应该是完整回答，还是从回答中抽取的一个决策经历？
3. 如何区分“相似情景”“同一条路的不同阶段”和“真正的分叉路口”？
4. 如何保留原文证据，使 LLM 抽取、合并和推断都可追溯、可修订？
5. 如何避免一开始就构建过重的知识图谱，同时为后续图分析留出兼容性？

## 已做决定

| 决定 | 理由 |
|---|---|
| 先调研再定表结构 | 需要确认上游采集器的真实字段与数据形态 |
| 把原始采集层与决策语义层分开 | 爬虫结构会变，决策模型也会迭代；分层可避免相互污染 |
| 所有推断必须指向原文证据 | 人生决策属于高解释性场景，不能只保留模型结论 |
| 未获授权时不启用知乎自动化采集 | 当前知乎协议明确限制未经授权的自动化接入和内容收集 |
| 不按 GitHub stars 直接选型 | 热度不能代替领域模型、证据溯源和路径分析适配度 |
| `PLAN.md` 作为后续建设的唯一执行入口 | `task_plan.md` 保留调研过程，主方案保留架构细节；避免把历史研究清单误当当前 backlog |
| 首个实现切片为 `SourceRecordV1 → 幂等 ContentSnapshot` | 它是抽取、图投影和分叉分析都依赖的最小可运行纵向闭环 |
| 先使用一个深写入 module，HTTP 只做薄适配 | 测试和调用者只需理解一个 interface，幂等、授权、版本和事务细节集中在内部 |
| 初始搭建不实现 LLM 抽取与分叉算法 | 尚无黄金集和真实授权样本，先把可靠证据入口与扩展 seam 建稳 |

## 错误记录

| 错误 | 尝试 | 解决方式 |
|---|---:|---|
| 暂无 | 1 | — |
| Web 工具读取知乎 robots、服务协议与法律 PDF 失败 | 1 | 改用只读 HTTP；未核实内容不写成确定事实 |
| 并行链接检查在 catch 中把 `$_` 变成 ErrorRecord | 1 | 固定保存 `$link` 后用顺序检查，避免自动变量被异常覆盖 |
| 完成检查器未识别中文状态标签并误报 0/0 | 1 | 将阶段状态改为技能约定的 `Status: complete` 后复检 |
| 完成检查器仍未识别中文阶段标题并误报 5/0 | 2 | 阅读检查脚本后改用其要求的英文 Phase 标题前缀 |
| 初次添加 Phase 12–16 的补丁上下文已过期 | 1 | 未产生文件修改；读取当前文件尾部后拆成小补丁应用 |
| 工作区不是 Git 仓库 | 1 | 继续本地实现与验证；不擅自假定远程或当前分支，交付时明确说明提交未执行 |
| 当前机器没有 Docker CLI | 1 | 创建 Compose 配置并完成静态核对；本地测试使用可替换存储 Adapter，容器端到端验证标为未执行门槛 |
| `uv sync` 因缺少 `README.md` 无法构建 editable package | 1 | 补充最小 README 和 package 根目录，再重新同步 |
| Ruff 检出两个测试文件的 import 顺序 | 1 | mypy 已通过；使用 Ruff 自动修复纯格式问题后复检 |
| Windows `pwsh` App Execution Alias 拒绝创建 Uvicorn 伪终端 | 1 | 改用普通管道进程启动；迁移、服务启动和真实 HTTP 健康检查均成功 |
| 清理烟测用 `smoke.db` 的 `Remove-Item` 被执行策略拒绝 | 2 | 不绕过安全策略；文件已由 `.gitignore` 排除，不影响工程和测试 |
| Windows 伪终端拒绝启动 Uvicorn | 1 | 改用隐藏后台进程做 HTTP 烟测，页面和 API 均返回 200；随后按 PID 停止进程 |
| PowerShell 的 `$pid` 是只读保留变量 | 1 | 改用 `$serverPid`，未影响服务和数据 |
| 应用内浏览器缺少 `sandboxPolicy` 元数据，无法连接本地页面 | 1 | 不重复失败调用；使用本机 Edge 只读截图完成桌面和响应式视觉核验 |
| 将多次 Edge 截图拼在一个 PowerShell 调用中触发 headless 多目标限制 | 1 | 改用独立用户数据目录和单目标进程，截图成功生成 |
| 本地服务重启的复合 `Start-Process` 命令被执行策略拒绝 | 1 | 分离 PID 核验/停止步骤，改用可持续的前台执行会话启动 Uvicorn |
| 新采集脚本直接执行时无法导入另一个 `scripts` 模块 | 1 | 将 HTML 清洗下沉为 `decision_knowledge.ingest.html_text`，两个采集器共用同一实现 |
| 质量采集回归命令引用不存在的测试文件名 | 1 | 读取 `tests/collectors` 后改用实际的 `test_collect_zhihu_public.py` 文件名 |
| 未设置 SQLite URL 时直接运行 `alembic check` 等待本机 PostgreSQL | 1 | 改用显式临时 SQLite URL 完成 `upgrade head` 与 `alembic check`，并删除临时库 |
| 用单行 Python 语句注册本地授权时 `with` 语句语法无效 | 1 | 改用显式 session 生命周期写入授权引用，未写入 Cookie 内容 |
| 首次给任务计划补丁使用了不存在的历史阶段标题 | 1 | 读取当前文件结构，改为在文件末尾新增 Phase 30 |
| Windows 默认 GBK 输出无法打印中文提案报告 | 1 | 脚本显式将 stdout 切换为 UTF-8，并先写入 UTF-8 报告文件 |

### Phase 30: Candidate scenario clustering and branch proposals

- [x] Add reversible candidate-to-scenario membership with score, algorithm version, and review status.
- [x] Generate repeatable scenario-cluster proposals from embedding recall plus structured decision-point checks.
- [x] Generate branch proposals inside each cluster from observed actions, retaining candidate and Zhihu source evidence.
- [x] Add a batch command, admin query endpoint, and a small real-database verification.
- [x] Update docs, tests, the database snapshot, and GitHub.
- **Status:** complete

### Phase 31: Fully automated scenario confirmation

- [x] Add deterministic auto-confirmation gates for scenario clusters and branches.
- [x] Auto-reject insufficient clusters without creating a human review queue.
- [x] Make the batch command automatic by default and keep an explicit dry-run mode.
- [x] Update public/admin visibility, docs, tests, and the real database snapshot.
- **Status:** complete
