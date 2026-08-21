# 调研发现与决策

## 用户需求

- 收集知乎回答，并将其转化为统一的单条数据。
- 对单条数据进行归类，合并为可复用的决策情景。
- 从多条人生路径中识别关键分叉路口。
- 建立可检索、可比较、高效增量分析的数据库。
- 数据库上游兼容知乎爬虫，重点参考 `https://github.com/zly2006`。
- 当前范围止于“构建和分析路径/分叉”，不设计后续面向用户的决策应用。
- 先调研，再形成可落地的 Markdown 规划。
- 新增要求：第一版就采用较完善的开源知识库底座；广泛调研 GitHub 同类库，最终只推荐一个最合适的项目，并说明备选与不选原因。

## 开源底座选型标准（2026-08-20）

候选项目按以下优先级评估：

1. **领域适配（25%）**：能否表达情景、行动、结果、时间与路径，而不只是文档问答。
2. **证据与溯源（15%）**：图节点/关系能否回到原文片段、来源与版本。
3. **增量与时序（15%）**：内容编辑、删除、事实变化和模型重跑是否可版本化。
4. **可扩展数据层（10%）**：是否允许自定义 schema/ontology，并接 PostgreSQL、图数据库或向量库。
5. **检索与图分析（10%）**：混合检索、多跳、社区/路径等能力。
6. **工程成熟度（10%）**：测试、文档、API、部署、可观察性和维护活跃度。
7. **许可证与可商用性（10%）**：许可证清晰、依赖风险可控。
8. **中文与模型中立（5%）**：不锁死单一云模型，中文抽取可替换。

硬性淘汰项：没有清晰开源许可证；只能做向量问答而不能保留结构关系；无法把派生知识回溯到来源；项目明显停止维护或生产边界不清。

## 开源知识库候选长名单

### 第一梯队：需要深度核验

- **Graphiti (`getzep/graphiti`)**：以 episode 为原始输入，支持文本/消息/JSON；采用双时序模型，关系带 `valid_at/invalid_at`；可通过 episode 查其生成的实体与事实，也支持删除 episode；支持自定义 Pydantic 实体/关系类型和类型约束；具有语义、关键词和图混合搜索。与本项目的“决策经历 + 时间 + 来源 + 路径”高度接近。
- **Cognee (`topoteretes/cognee`)**：完整的 `add → cognify → search/memify` 知识管道，支持自定义 DataPoint、图/向量/关系多后端、权限和可观察性；Apache-2.0。时序能力提供 Graphiti mode，说明它更像上层知识平台，需判断是否值得接受额外抽象。
- **OpenSPG/KAG (`OpenSPG/KAG`)**：面向专业领域知识库，支持 schema-free 与 schema-constrained 构建、概念语义对齐、知识与原文 chunk 双向索引、逻辑形式多跳推理。中文和领域本体能力突出，但依赖 OpenSPG Server，知识工程与部署更重。

### 第二梯队：偏检索问答，需要验证能否承担领域权威模型

- **LightRAG (`HKUDS/LightRAG`)**：轻量双层知识图谱 + 向量检索，强调增量更新和选择性删除，MIT；优势是检索效率，缺点候选是通用实体关系抽取、时间和强 schema/证据模型不足。
- **Microsoft GraphRAG (`microsoft/graphrag`)**：从文本构建实体关系和社区层次，source text units 为派生知识提供 provenance；适合全局主题问答和社区摘要，但典型工作流偏批量索引，不以事件时序和持续修改为核心。
- **RAGFlow (`infiniflow/ragflow`)**：完整文档解析、知识库、引用、检索与 Agent 产品，内含 GraphRAG；Apache-2.0。工程表面完整，但体量大，图层更多服务问答，不一定适合承载自定义决策路径模型。

### 第三梯队：暂不作为主底座

- LlamaIndex PropertyGraph：适合作为开发库与连接层，不是带版本/权限/评审的完整知识库系统。
- FastGraphRAG、nano-graphrag、HippoRAG：适合算法研究或轻量实验，生产治理和领域 schema 能力需额外建设。
- 纯向量知识库/聊天文档项目：无法原生表达情景—行动—后续路径，淘汰。

## 第一轮关键判断

- 本项目的核心不是“回答问题”，而是“把有来源的决策事件持续写入一个可演化的时序关系图”。因此时序、来源 episode、自定义关系和删除更新的权重必须高于现成聊天 UI。
- Graphiti 的 episode 与本项目 `DecisionEpisode` 只是名称相近还不够；深度核验必须确认：一个事实是否保留 episode UUID、删除是否级联安全、自定义类型是否足以表达 Situation/Action/Outcome、ordered saga 是否能承载 Narrative Path。
- Cognee 虽然平台能力更全，但若其关键时序能力委托给 Graphiti，直接使用 Graphiti + 自有 PostgreSQL 可能更清晰；需比较权限、数据管道和运维成本。
- KAG 的 schema 和原文互索非常匹配专业领域知识库，但它更像重型知识工程/推理平台；若第一版主要目标是积累和分析路径而不是复杂问答，可能过度。

## 仓库活跃度快照（GitHub API，2026-08-20）

> stars 只用于判断生态，不进入核心适配评分；数据会随时间变化。

| 项目 | Stars | License | 最近 push | 最新 release | 仓库规模（约） |
|---|---:|---|---|---|---:|
| Graphiti | 30.1k | Apache-2.0 | 2026-08-20 | v0.29.3 / 2026-07-27 | 15 MB |
| Cognee | 30.1k | Apache-2.0 | 2026-08-20 | v1.5.0 / 2026-08-15 | 234 MB |
| OpenSPG/KAG | 9.0k | Apache-2.0 | 2026-01-28 | v0.8.0 / 2025-06-28 | 191 MB |
| LightRAG | 39.0k | MIT | 2026-08-20 | v1.5.7rc2 / 2026-08-19 | 109 MB |
| Microsoft GraphRAG | 35.6k | MIT | 2026-08-19 | v3.1.1 / 2026-07-18 | 207 MB |
| RAGFlow | 88.9k | Apache-2.0 | 2026-08-20 | v0.27.0 / 2026-08-19 | 156 MB |

除 KAG 外，其余重点项目近期均有活跃更新。KAG 仍不能仅凭最近 push 淘汰，但需要把维护节奏和版本陈旧度计入工程风险。

## Graphiti 深度核验（第一轮）

- **输入模型匹配**：episode 是图中的一类节点，每次数据摄入就是一个 episode；支持 `text/message/json`，与 `SourceRecord` / `DecisionEpisode` 的结构化输入兼容。
- **证据来源**：从 episode 识别的实体通过 `MENTIONS` 关联；官方文档明确 episode 用于 provenance，MCP 还提供按 episode UUID 取其实体与事实的能力。
- **时序模型**：episode 同时具有录入时间和事件参考时间；事实关系具有 `valid_at/invalid_at`，新信息可使旧关系失效但保留历史。这正好对应回答编辑、后续经历和事实版本变化。
- **领域 schema**：实体和关系均可用 Pydantic 自定义属性，`edge_type_map` 可限制哪些关系连接哪些实体类型；关系属性受模型校验。可映射 `SituationState`、`DecisionPoint`、`ActionArchetype`、`OutcomeObservation` 及 `CHOOSES/LEADS_TO/NEXT`。
- **路径能力**：MCP 已有 saga 与 `saga_previous_episode_uuid`，可把相关 episode 组织为有序叙事；另有 community 构建和摘要。Saga 很接近 `NarrativePath`，但需验证它是组织结构还是完整路径查询 API。
- **增量与删除**：官方说明实时增量更新无需批量重建；`delete_episode` 会清理仅由该 episode 生成的实体/事实。对于多来源共同支持的事实需验证支持集删除后的行为。
- **检索**：语义、关键词和图混合搜索；可按实体/关系类型和有效时间范围过滤，适合“情景过滤 + 相似经历 + 路径邻域”。
- **工程边界**：Python 3.10+；生产建议 Neo4j，默认 MCP 可用 FalkorDB；Neptune 也受支持，Kuzu 已弃用。依赖结构化输出质量，小模型可能产生 schema 失败。
- **风险**：默认无类型输入会退化为通用 Entity/RELATES_TO；必须显式提供领域类型。Graphiti 是图构建/检索核心，不含我们需要的原始 HTML 快照、字符级证据片段、人审队列和合规门禁，这些仍需自建。

初判：Graphiti 不是一套完整业务应用，但它目前是最贴合“决策经历 → 时序事实图 → 路径”的语义图底座。

## Graphiti 深度核验（反方证据与采用护栏）

公开 issue 表明 Graphiti 虽然领域匹配度最高，但不能“裸用即生产”；第一版必须把以下限制写进架构，而不是在推荐里隐藏：

- **不要以 FalkorDB 多租户模式起步**：2026-07 仍有 FalkorDB 在不同 `group_id` 并发写入时共享 driver 被重绑定、导致跨图静默写错的公开问题；同一时期还出现单 group 读写路由不一致及 MCP 删除定位错误。首版应固定 **Neo4j 单库 + `group_id` 属性隔离**，并把租户并发正确性列为集成测试。
- **不要把长回答整篇送入 `add_episode`**：公开性能报告显示较长输入会触发大量串行 LLM 调用。我们的设计本来就应先在外部切成 0..N 个 `DecisionEpisode`，每个只包含一个决策经历和必要上下文；按 group 顺序入图并限制并发。
- **不要依赖 Graphiti 替我们发明 ontology**：不提供 `entity_types` 时，实体会退化为通用 `Entity`；必须固定 `SituationState/DecisionPoint/ActionArchetype/OutcomeObservation` 和允许的关系矩阵。
- **不要把自定义 edge attributes 当权威证据库**：当前仍有首次创建关系时自定义属性未抽取的公开 bug，也有灵活 metadata 的长期需求。`evidence_span_id`、审核状态、模型版本和完整支持集必须保存在 PostgreSQL；Graphiti 只保留用于图检索的冗余属性。
- **外部 ID 映射要显式保存**：当前有公开问题指出，新建 episode 时预分配 UUID 可能失败，MCP 创建接口也曾不返回 UUID/自定义 metadata。首版要通过 Python core API读取 `AddEpisodeResults` 并持久化 `decision_episode_id ↔ graphiti_episode_uuid`；不能假设两者共用主键。
- **治理层必须自建**：Graphiti 有事实到 episode 的 provenance，但 PII 扫描、字段级访问、检索审计仍是公开 feature request。敏感信息清洗必须在入图前完成，检索结果还要经过权限/脱敏层。
- **优先 Python core API，不把 MCP 当主写入链**：MCP 的 episode 浏览排序、FalkorDB 路由等问题仍在演进；核心入库和删除同步应直接封装 Graphiti core，MCP 只作为调试/Agent 接口。
- **更新链不能滥用 bulk API**：官方文档明确 `add_episode_bulk` 适合空图初次装载，且不会执行 edge invalidation。持续增量阶段必须使用普通 `add_episode`，否则旧事实不会按预期失效。

这些风险不会改变“Graphiti 最匹配”的结论，因为它们都可以通过“PostgreSQL 权威证据账本 + Neo4j 图投影 + 有界输入 + 映射表”隔离；但它们否定了“只部署 Graphiti 就等于完整系统”的说法。

数据库选择补充：Graphiti 官方 MCP 文档也明确在生产或需要完整图数据库时推荐 Neo4j；Neo4j Community Edition 当前为 GPLv3。首版可把它作为独立服务部署，但项目发布前仍应由团队按实际分发/托管方式完成许可证确认，不能把 Graphiti 的 Apache-2.0 自动等同为整套部署没有依赖许可证义务。

## Cognee 深度核验

- **平台覆盖面**：原生提供数据接入、知识抽取、图/向量搜索、自定义管道、数据集、用户权限、可观察性和 UI/可视化，完整度明显高于 Graphiti。
- **自定义能力**：DataPoint 是原子知识单位，支持自定义数据模型、图模型、提示词和任务管道；`run_custom_pipeline` 支持增量加载、缓存、批处理和后台执行。
- **存储组合**：生产文档建议 PostgreSQL/pgvector，可另接 Neo4j；支持多种图、向量和对象存储后端。代价是配置矩阵和测试面更大。
- **时序能力**：既有原生 temporal search，也提供 Graphiti mode。当前 `pyproject.toml` 实际依赖 `graphiti-core>=0.28.0`，没有旧文档中 `<0.8` 的落后限制；但 Cognee 的 Graphiti mode 绑定 Neo4j/AuraDB，不能直接享受 Graphiti 的全部后端选择。
- **来源与审计**：已有 source references、provenance graph、pipeline/task stamp 和按 pipeline run 回滚的接口；但 2026-06 的官方 issue 仍描述“stamping partial/uneven and not guaranteed end-to-end”，说明该能力正在快速完善，不能默认所有节点/边已有稳定字符级证据。
- **权限**：数据集 ACL 和多用户模式是明显优势，但近期仍有特定后端组合的权限/检索 bug，第一版需限定受支持组合并做集成测试。
- **适配判断**：若目标是快速得到一个通用“企业知识/Agent memory 平台”，Cognee 比 Graphiti 完整；若目标是严格控制决策领域 schema、证据与路径语义，Cognee 会增加一层管道和存储抽象，而关键时序图仍来自 Graphiti。

初判：Cognee 是最强的“完整平台型备选”，但不是最干净的决策时序图核心。

## OpenSPG/KAG 深度核验

- **领域知识工程**：支持声明式 schema、schema-constrained 抽取、schema-free 抽取、概念对齐和领域词表，适合专业领域的严格本体。
- **原文互索**：知识与 chunk mutual indexing 是核心设计，对“图关系回到原文上下文”有直接价值。
- **推理能力**：KAG-Solver 结合图检索、文本检索、语义推理和数值计算，强项是事实问答与多跳逻辑推理，不只是相似度检索。
- **产品完整性**：v0.6 已提供登录权限、构建任务持久调度、断点恢复、知识探索和 HTTP API；v0.8 增加多类索引、MCP 与可扩展 extractor/retriever。
- **部署与开发成本**：必须运行 OpenSPG Server 和依赖镜像；项目生成 builder/schema/reasoner/solver 等多层结构，embedding 模型变化甚至建议新建项目。对黑客松第一版属于重型平台。
- **维护风险**：最新正式 release v0.8.0 发布于 2025-06，GitHub API 显示最近 push 为 2026-01；相比其他候选的 2026-07/08 活跃发布，节奏偏慢。
- **时序缺口**：调研到的核心文档侧重知识构建与问答，没有发现像 Graphiti 一样原生区分事件时间/录入时间、关系有效期和 episode 失效传播的模型。

初判：如果未来优先级转为“中文垂域本体 + 复杂逻辑问答”，KAG 会成为强候选；当前“持续积累人生决策事件并找路径分叉”并非它最直接的甜点区。

## Microsoft GraphRAG 深度核验

- **核心模型**：默认索引流把语料切为 TextUnit，再抽取实体、关系和可选 claim/covariate，随后做 Leiden 社区划分与社区摘要；Global、Local、DRIFT 等查询方式的核心目标是增强语料问答，而不是维护业务领域的权威状态机。
- **来源追踪**：Document、TextUnit、Entity、Relationship 和 Covariate 等 Parquet 输出互有关联；实体与关系带 `text_unit_ids`，TextUnit 是官方数据流中的 source reference。它的 provenance 明显强于只保存向量的知识库。
- **增量能力**：当前 CLI 已有 `update`，changelog 也记录 incremental indexing；不能沿用旧版本“只支持全量重建”的判断。不过增量更新的产物仍是索引表和社区结构，不是逐 episode 的双时序事实账本。
- **适配缺口**：Covariate 可以保存 `source_text`、`start_date/end_date`，但默认 schema 仍围绕通用实体/关系/claim；没有 Graphiti 那种事件时间与录入时间、事实失效和 episode 删除传播的一等语义。
- **工程定位**：适合“围绕一批回答做全局主题总结、社区发现和问答”；若拿它作为情景、选择、结果与路径的权威模型，需要在 Parquet 输出之外再建一套领域数据库。

初判：可作为后期的全局主题分析/检索组件，不适合作为第一版决策路径的主数据底座。

## LightRAG 深度核验

- **检索与部署**：MIT；以 KV、vector、graph、document-status 四类存储抽象组织图+向量检索，可使用 PostgreSQL、MongoDB/OpenSearch，或组合专用后端；支持多种查询模式。
- **增量与维护**：官方仓库支持增量插入、选择性删除、实体/关系编辑和文档状态管理；对持续摄入回答比纯批处理 GraphRAG 更友好。
- **中文与模型适配**：可配置输出语言、LLM 与 embedding，中文接入门槛低；JSON extraction 等能力有利于工程化。
- **来源边界**：实体/关系会保存 source chunk/file 信息，但实现中存在每条关系来源数量和文件路径数量上限，且达到上限后可停止追加以控制性能。若把它当成权威证据库，这类截断策略必须禁用或在外部另存完整支持集。
- **领域缺口**：默认是通用实体关系图，没有双时序、episode/saga、关系有效期或严格的情景—行动—结果 schema；历史 issue 也出现过 custom KG 重复实体的 source chunk 关联被覆盖问题，说明自定义知识写入路径要单独回归测试。

初判：它是优秀的轻量 GraphRAG 检索引擎，但“检索得快”不等于“能准确维护有版本、有证据的人生路径”。

## RAGFlow 深度核验

- **产品完整度**：提供多格式文档解析、可编辑 chunk、全文/向量检索、引用、知识库管理、Agent 与自定义 ingestion pipeline；若目标只是搭建可用的文档问答产品，它的现成度最高。
- **GraphRAG 定位**：GraphRAG 是完整 RAG 产品中的一个增强功能，而不是整个系统的权威领域模型。其数据抽取仍主要服务于检索和回答引用。
- **动态更新风险**：2026 年当前公开 issue 仍提出增量/流式 GraphRAG 需求：添加文档时可能重新执行抽取、社区与 PageRank 等全局阶段，复杂度和资源开销不适合持续更新的路径事实库。
- **工程风险信号**：近期公开 issue 还涉及 graph ranking 字段缺失、graph set 性能/数据可靠性，以及部分图阶段缺乏 checkpoint/resume。它们不证明整个产品不可用，但说明 GraphRAG 子系统暂不宜做本项目唯一事实源。
- **适配判断**：UI、文档摄入和引用能力很强，但自定义情景、行动、结果、时序失效和分叉审核仍需另建领域层；为这些能力承担整套重型产品并不划算。

初判：适合作为面向用户的文档问答层候选，不适合作为决策路径核心库。

## 补充扫描：为什么热门项目没有进入决赛

- **FalkorDB GraphRAG-SDK**：值得进入扩展长名单。它具备本体发现/演化、Document→Chunk→Entity 来源链、关系的 `source_chunk_ids`、稳定 `document_id`、单文档更新/删除和局部 orphan cleanup；更新流程还强调 crash-safe。它比一般 GraphRAG 更接近可维护知识库，但核心仍是“文档及其派生图”，没有发现双时序事实、episode 叙事顺序或事实有效期，所以排在 Graphiti 之后。
- **FastGraphRAG**：MIT、异步 typed API、实时增量更新、可提示的 domain/entity types、PageRank 检索与可选 references；很适合低成本实验。仓库定位明确是 retrieval framework，schema、证据账本、权限和时序事实治理都需要我们补齐，工程覆盖不如前三名。
- **Neo4j LLM Graph Builder**：Apache-2.0，拥有多数据源上传、可选自定义 schema、Neo4j 图可视化、图/向量/混合聊天和答案来源元数据；更像一套“把文档做成图并聊天”的参考应用。它依赖 Neo4j 5.23+ 与 APOC，默认不提供 episode 双时序和决策分叉领域语义，因此不作为主库。
- **Dify**：知识管道、数据集、文档/segment、元数据过滤、混合检索和工作流编排非常成熟，但公开知识库模型仍以 text/hierarchical/QA 文档索引为中心；所谓 queue-based graph engine 是工作流执行引擎，不是知识关系图。它适合以后做工作流/应用层，不适合代替路径图。
- **LlamaIndex PropertyGraph**：可定制 extractor、schema 和存储适配器，作为代码连接层很好；但它不是包含时序、删除传播、权限、人审和来源版本的完整知识库系统。
- **HippoRAG / nano-graphrag**：前者重点是受人类长期记忆启发的多跳检索算法，后者重点是简化 GraphRAG；两者更适合评测/算法组件，不适合作为第一版权威业务底座。

补充扫描后的结论没有变化：热门“知识库”多数优化的是文档摄入、聊天和召回；本项目真正稀缺的能力是带来源和有效期的决策事件图。

### FalkorDB GraphRAG-SDK 追加核验

- 当前仓库 v1.4.0、Apache-2.0、Python 3.10+，2026-08-19 仍有更新；约 989 stars，生态明显小于 Graphiti/Cognee，但不是停更项目。
- README 明确说明 Document→Chunk→Entity/Relationship 的 provenance，答案可返回 retrieval trail；关系保存 source chunk，修改/删除文档时保留仍被其他文档引用的实体。
- 增量更新工程质量较好：内容 hash 跳过无变化、pending document + 原子切换实现 crash-safe、默认串行更新避免共享实体的 orphan cleanup 竞态，并有相应集成测试。
- 代价是 `finalize()` 的跨文档实体消歧仍为 O(graph size)，需要按批次调用；这不等于完全局部增量。
- 最关键的淘汰证据来自项目自己的 roadmap：**temporal graph 计划在 2026-Q4，当前尚不是现成能力**。本项目一开始就要表达事件时间、录入时间和事实失效，不能押注未来路线图。

因此它是“最佳传统文档 GraphRAG 备选”，但不是当前唯一推荐。

## 初步语义判断

- 用户口中的“单条数据”不宜等同于一篇完整回答；一篇回答可能包含多个时期、多个决定和多个结果。更合适的候选定义是“一个有证据支持的决策经历单元”。
- 用户口中的“路”至少包含有序阶段和因果/时间关系；不能只做主题标签或回答聚类。
- “分叉路口”必须表达相似前置情景下的不同可选行动及其后续路径，不能仅表达两篇回答主题不同。

## 调研发现

- `zly2006` 账号下与本项目最直接相关的是 [`zhurl`](https://github.com/zly2006/zhurl)，而不是把 Android 客户端 `zhihu-plus-plus` 本身当作爬虫。`zhurl` 是类似 curl 的非官方知乎 CLI，支持 JSON 机器输出和内嵌 jq/jaq 过滤，适合被采集任务调用。
- `zhurl` 的 API 文档来源于 `zhihu-plus-plus` 当前源码调用点；文档明确声明它不是稳定 SDK 契约。因此上游 JSON 必须先进入原始采集层，再由版本化适配器转换，不能让核心业务表直接依赖知乎字段。
- `zhurl` 从知乎++本地账号文件读取 Cookie。接口区分 `web`、`android` 和 `public` 模式；部分 Web 请求需要由 `d_c0` 生成 `x-zse-96` 签名，登录和签名要求随接口变化。
- `zhurl` 支持标准输出管道和 `-o` 文件输出，但没有完整 curl 的重试、Cookie jar、代理和 HTTP/2 控制。生产采集器仍需在外层提供任务队列、限速、重试、断点、失败归档和幂等写入。
- `zly2006` 的 GitHub 主页显示 `zhihu-plus-plus` 是主项目；`zhurl` 的文档索引截至 2026-06-19，适合作为当前接口发现依据，但不能视为知乎官方支持。
- `zhurl` 文档给出的搜索入口为 `GET /api/v4/search_v3`：可按关键词、内容类型（含 `answer`）、排序（创建时间/赞同数）、时间区间分页检索；搜索结果至少暴露内容类型、回答 ID、URL、高亮片段和 `paging.next`。这足以承担“候选回答发现”，但完整正文需第二次按回答 ID 拉取。
- 推荐流、关注流、热榜和搜索的返回外壳并不一致（例如 `target`、`object`、`data`），进一步证明需要 Adapter 将不同来源统一成候选内容引用。
- 采集发现策略应以“主题查询词集合 + 分页游标 + 时间窗口”为主，推荐流/热榜只作为补充召回来源；否则数据会被个人账号推荐算法和热度强烈偏置。
- 回答详情入口为 `GET /api/v4/answers/{answer_id}`，可请求 HTML 正文、摘要、问题及话题、作者、赞同、感谢、评论、访问、IP 信息等。对本项目真正必要的是：回答/问题稳定 ID、正文、作者的不可逆内部键、创建/更新时间（若实际响应提供）、问题话题、互动计数和原 URL；不应因为 API 可取就默认保存 IP 信息、头像或无关个人字段。
- 问题回答列表入口为 `GET /api/v4/questions/{question_id}/feeds`，支持分页和 `default` / `updated` 顺序。它适合在某个问题被判定为高价值决策情景后，补采同题不同回答，用于寻找可比较路径。
- 一篇回答应保存为一个可版本化的 `ContentSnapshot`，而分析层从中抽取 0..N 个 `DecisionEpisode`。互动计数属于观测快照，不是经历真实性或结果好坏的证明。
- 知乎《个人信息保护指引》（第 5.2 版，2025-10-15 生效）说明用户公开分享的信息可被第三方阅读、收集和使用，同时也明确用户拥有删除、限制处理等权利。这里不能推导出“任意再发布授权”；本项目仍应实行目的限定、数据最小化、访问控制和删除同步。
- 《个人信息保护法》要求目的明确、范围合理并对个人自行公开/合法公开的信息仅在合理范围内处理。回答正文中可能包含健康、金融、身份、未成年人等敏感信息，不能因为正文公开就默认进入可检索作者画像。
- 建议产品默认只展示决策结构、聚合统计和短证据定位；原文全文放在受限证据层。作者使用不可逆内部主体键，公开昵称、头像、IP 信息不进入决策核心表。
- 2026-08-20 只读检查知乎当前《知乎协议》：其中明确限制未经知乎授权或许可，使用自动化程序、软件或类似工具接入知乎并收集/处理信息、内容。这使“先获授权”成为采集器上线的硬门槛，而不是普通风险提示。
- 同日读取 `https://www.zhihu.com/robots.txt`：通用 `User-agent: *` 为 `Disallow: /`，仅允许 `/tardis/jm`；特定搜索引擎规则另列。robots.txt 不是全部法律结论，但与协议一起表明不能把大规模自动抓取当作默认可用入口。
- GitHub API 显示 `zly2006/zhurl` 的 `license` 为 `null`，仓库树也未见 LICENSE。可以参考其接口文档并把 CLI 作为外部可替换工具评估，但在未获得作者许可前不应复制、改编或内嵌其源码。
- 因此 MVP 的来源接口必须同时支持：`authorized_zhihu_adapter`（仅在授权后启用）、用户合法导出文件、人工粘贴/提交 URL 与正文、以及未来正式数据源。语义处理主链不依赖某一种采集方式。
- PostgreSQL 18 原生提供关系约束、JSONB/GIN、全文检索、行级安全和递归 CTE；pgvector 0.8.6 可在同一库中提供精确及 HNSW/IVFFlat 近邻检索。因此 MVP 不需要同时运维关系库、向量库和图数据库三套系统。
- pgvector 默认精确近邻具有完整召回；HNSW/IVFFlat 会以召回换速度。过滤是在近似索引扫描后发生，可能导致返回条目不足，0.8+ 的 iterative scan 可缓解。上线 HNSW 之前必须以精确查询为基线量化 Recall@K，而不是只看延迟。
- pgvector 官方文档建议混合 PostgreSQL 全文检索与向量检索，并可用 Reciprocal Rank Fusion（RRF）或重排器合并结果。对本项目可采用“结构化硬过滤 + 关键词/短语召回 + 向量召回 + 规则/模型重排”。
- PostgreSQL GIN 适合 JSONB、数组和 `tsvector` 倒排索引；递归 CTE 足以遍历 MVP 的路径邻接表。只有当跨多跳路径分析成为主要负载并经基准证明关系库不足时，再增加图数据库投影。

## 技术决策

| 决定 | 理由 |
|---|---|
| 原始层、标准层、语义层、图投影分层 | 分离采集事实、清洗结果、模型推断和图查询需求 |
| 关系型数据库作为权威存储候选 | 强约束、版本化、溯源和事务更适合早期迭代；图结构可后续投影 |
| 将 `zhurl` 包装为可替换的 Source Adapter | 非官方 API 会变化，核心模型不应与当前响应 JSON 耦合 |
| 采集运行元数据与内容数据一并保存 | 需要重试、去重、追踪适配器版本和复现失败 |
| 建立删除/变更同步与敏感信息隔离 | 内容可被作者删除，正文也可能包含个人或敏感个人信息 |
| 将自动知乎采集设为 feature flag + 合规门禁 | 当前知乎协议和 robots 规则不支持把未经授权自动抓取作为默认能力 |
| `zhurl` 仅作为外部 Adapter 参考，不复制源码 | 当前仓库未声明许可证；还需独立解决知乎授权问题 |
| 第一版使用 PostgreSQL + pgvector 作为权威证据与业务状态库 | 强约束、版本、证据和审核不能委托给 LLM 图抽取 |
| 小数据先用精确向量检索，达性能阈值后再启用 HNSW | 精确检索可作为召回基线；近似索引不是无损加速 |
| 唯一推荐 Graphiti 作为知识图谱底座，第一版即使用 Neo4j 图投影 | episode、双时序、来源关联、自定义类型与路径检索最贴合决策经历模型 |
| Graphiti/Neo4j 始终是可重建投影，不是权威源 | 隔离开源库 bug、LLM 抽取漂移和未来替换成本 |

## 最终开源底座决策

- **唯一推荐：`getzep/graphiti`。** 加权领域适配得分 93.5/100，高于 Cognee 87.0、OpenSPG/KAG 84.5、Microsoft GraphRAG 78.5、LightRAG 76.5、FalkorDB GraphRAG-SDK 75.0 和 RAGFlow 72.0。
- 评分不是通用产品排行榜；它按本项目的领域适配、证据、时序、扩展、检索、工程、许可证和中文能力加权。
- 完整第一版组合为 PostgreSQL 权威证据库 + Graphiti Python core + Neo4j 单库 + 自有 Branch Analyzer；不把 Graphiti MCP、FalkorDB 多 group 模式或自定义 edge attributes 作为权威链路。
- `DecisionEpisodeV1` 以紧凑 JSON episode 输入，固定 `SituationState/DecisionPoint/ActionArchetype/OutcomeObservation` 与 `FACES/CHOOSES/LEADS_TO/NEXT`；保存本地 episode ID 与 Graphiti UUID 映射。
- 持续更新用普通 `add_episode`，因为官方文档说明 bulk ingestion 不执行 edge invalidation；bulk 仅限空图初装。
- 选择 Graphiti 不代表其他平台无价值：Cognee 是平台型备选，KAG 是中文本体/复杂推理备选，Microsoft GraphRAG 可做后期全局主题分析，RAGFlow/Dify 可做应用层。

## `PLAN.md` 执行化要求（2026-08-20）

- 现有 `task_plan.md` 是调研过程账本，全部阶段已经完成；它不适合直接充当研发 backlog。新建 `PLAN.md` 作为后续建设的唯一执行入口，避免历史研究任务与产品建设任务混在一起。
- `MISSION.md` 要求用“原文、卡片、抽屉、路口”四个词解释系统，并坚持 KISS。执行计划应以这四个对象组织里程碑，再映射到 SourceSnapshot、DecisionEpisode、CanonicalScenario、BranchPoint。
- 第一版不是 48 小时演示：48 小时闭环只作为 Milestone 0 技术验证，正式第一版必须覆盖授权门禁、幂等/版本/删除、证据化抽取、固定领域图、路径/分叉、人审、检索和运维评测。
- `SourceRecordV1` 和 `DecisionEpisodeV1` 已在主方案定义；计划应把它们作为前两个冻结契约，并给出契约测试、幂等测试和证据偏移测试。
- 路径与分叉的核心算法边界已明确：情景聚类只使用前置状态+决策点；路径不得跨作者拼接；同一行动的不同结果是结果分化而不是分叉；正式分叉需要至少两种行动、独立来源、后续覆盖和人审。
- 图投影必须具备重放、编辑、删除、共享事实保留和全量重建测试；Graphiti 的已知风险应转化为 release blocker，而不只是风险说明。
- 计划应给出需求—里程碑—测试的可追踪关系，并区分“必须完成”“达到指标后才启用”和“明确不做”，防止第一版范围继续膨胀。

## `PLAN.md` 一致性检查发现

- 新计划共定义 M0–M7 八个里程碑、63 个唯一任务、10 个 Graphiti 阻断式质量门；依赖顺序为契约 → 原文 → 卡片 → 图/情景 → 分叉 → 检索审核 → 发布硬化。
- Markdown 围栏配对、标题无重复，三个内部文档链接均存在。
- 与 `MISSION.md` 的“原文、卡片、抽屉、路口”完全对应；与 `CONTEXT.md` 的 SourceSnapshot、DecisionEpisode、CanonicalScenario、BranchPoint 术语对应。
- 与主方案和选型报告的当前架构一致：PostgreSQL 为权威层，Graphiti/Neo4j 从第一版进入但只作可重建投影，不做跨作者路径和人生推荐。
- `progress.md` 中“单库 MVP、延后图数据库”只记录第二阶段当时的历史结论，后续第 8–9 阶段已明确推翻；它不属于当前执行规范，无需篡改历史记录。
- `RESOURCES.md` 尚未列出新的执行计划和底座选型，需补充为团队入口。

## 初始系统实现发现（2026-08-20）

- 工作区当前只有规划、教学素材和图文件，没有应用代码、`AGENTS.md` 或现成工程约定，可按 `PLAN.md` 的 Python 模块化单体基线初始化。
- 工作区不是 Git 仓库，因此 `implement` 流程要求的“提交当前分支”暂时没有可用目标；不擅自创建远程或假定分支。
- 首个 tracer bullet 选择 `POST /v1/source-records:batch → PostgreSQL content_snapshot`，验证三项行为：合法记录写入成功、相同 raw hash 重放不重复、自动 Adapter 缺少有效授权时被拒绝。
- 写入 module 的 interface 应尽量小：接收一批已验证 `SourceRecordV1`，返回每条记录的 `CREATED/UNCHANGED/REJECTED` 和本地 ID；HTTP、命令行导入和未来 Adapter 共用同一 interface。
- 第一轮不实现 LLM 抽取、情景聚类或分叉算法，只创建对应 package 与图投影 seam；否则会在黄金集和基础数据正确性尚未建立时产生无法验证的代码。
- 成功标准：开发环境可启动；契约错误可解释；幂等、授权和版本行为通过公开 interface 测试；数据库迁移可从空库执行；所有代码通过格式、类型和测试检查。
- 当前默认 `python` 是 3.11.9，但 uv 已安装 CPython 3.12.12；工程按冻结基线用 `uv run --python 3.12` 创建和验证，不依赖系统默认解释器。
- 当前机器未安装 Docker CLI，因而可以创建 Compose 配置和做静态检查，但不能在本机启动 PostgreSQL/Neo4j 容器；数据库端到端验证需改用可用的本地测试适配器，Compose 运行验证保留为明确门槛。
- uv 0.9.18 和 Git CLI 可用；全局 Python 已有 Pydantic/FastAPI/SQLAlchemy，但工程必须使用独立锁定环境，不能依赖全局包。
- 实现中发现“只要求 `authorization_ref` 非空”可被任意字符串绕过；门禁已改为查询本地授权记录，并校验来源、Adapter、ACTIVE 状态和当前有效期。
- raw hash 与正文版本 hash 必须分开：同一正文的点赞/评论变化应新增原始输入记录，但不能新增 `ContentSnapshot`。当前实现分别使用 `raw.sha256` 和规范化正文 hash。
- 按 KISS 与深模块原则，暂不创建只有一个空实现的 GraphProjection interface；等接入首个真实 Graphiti Adapter 时，与测试替身一起形成真实 seam。
- 原文证据不能只依赖 JSON `payload`：规范 URL 和 raw HTML 已升级为 `RawEnvelope` 的显式列，HTML 片段也进入 `ContentSnapshot`，这样证据定位不必解析不稳定的上游 JSON。

## 已验证与剩余门槛

- 已验证：`zhurl` 输出机器可读 JSON，可写标准输出或文件；搜索、回答详情和问题回答列表覆盖候选发现与正文获取所需的主要字段。
- 已验证：回答详情文档包含问题、正文、作者、赞同、感谢、评论和话题等可请求字段；采集时仍应执行最小化字段白名单。
- 实际回答响应是否稳定包含 `created_time` / `updated_time`（当前文档示例未展示，应通过样本验证，不可先设为强制字段）。
- 已验证：当前知乎协议和 robots.txt 对未经授权自动收集构成明确门槛；上线采集前仍需项目方取得授权并完成合规确认。
- 若计划实际启用 `zhurl`，需取得作者对代码/二进制使用方式的明确许可，并取得知乎对采集场景的授权。

## 问题与处理

| 问题 | 处理 |
|---|---|
| Web 读取 `robots.txt` 超时、`/terms` 被安全检查拒绝、法律 PDF 网关失败 | 改用只读 HTTP 请求检查；方案中保留上线前人工/法律确认门槛，不把无法核实的条款写成事实 |
| 只读 HTTP 成功取得 robots 和协议正文 | 已确认自动化收集限制；将其升级为架构门禁，并保留页面链接与核对日期 |

## 已明确的领域词汇

- “单条数据”的规范名为 `Decision Episode`（决策经历），不是整篇回答。
- 区分单一叙事内部的 `Narrative Path`（叙事路径）与跨样本聚合的 `Path Pattern`（路径模式），避免把不同人的片段拼成一个虚构人生。
- 未满足证据/可比性门槛的只能叫 `Branch Candidate`（候选分叉）；审核后才是 `Branch Point`（分叉路口）。
- `Outcome Observation`（结果观察）只表示来源的后续陈述，不承诺行动导致结果。

## 本地双端工作台设计发现（2026-08-21）

- 用户端与管理端先做成同一个 FastAPI 进程下的两个静态入口：`/` 是用户端，`/admin` 是管理端；不引入 React/Vite/Node 构建链，降低本地启动成本。
- 用户端第一版只承诺三件事：按关键词检索真实回答、查看原文/HTML 证据、浏览已经审核的情景与分叉。未审核数据不伪装成结论。
- 管理端第一版承诺四件事：总览统计、原始回答与快照查看、JSONL 幂等导入、情景/分叉的人工创建与审核；原始 URL 与 raw HTML 只读展示，避免误改证据。
- PostgreSQL 继续是 Compose 的权威库；本地无 Docker 时默认 SQLite，启动时只做建表和真实 JSONL 幂等种子导入。两者共用 SQLAlchemy 模型和 API。
- 情景/分叉先用关系表承载，不提前接 Graphiti：`decision_scenario` 表示可审核的情景抽屉，`decision_branch` 表示情景内的行动分叉，并用 `source_snapshot_id` 回指证据。
- 管理端的“删除”先落为 `DELETED`/归档状态，不做不可恢复的硬删除；这符合原始证据可追溯不变量。

## 数据库呈现复盘（2026-08-21）

- 当前本地库实际是 `6 ContentItem / 6 ContentSnapshot / 6 RawEnvelope / 0 Scenario / 0 Branch`。用户端把“回答证据”放在主位、把“已审核情景”放在侧栏，导致它看起来像内容列表，而不是数据库流水线；情景为空是数据状态，界面没有把这个状态解释清楚。
- 数据库展示必须分层，而不是把所有字段塞进回答卡：原文层（RawEnvelope）、身份层（ContentItem）、版本层（ContentSnapshot）、语义层（DecisionEpisode/Claim）、聚合层（CanonicalScenario）、比较层（BranchPoint/Branch）。
- 管理端的默认主表应是“快照表”而不是“回答卡”：一行代表一个可审核版本，列出标题、来源、外部 ID、采集时间、版本、可用性、证据完整性和审核状态；点击后在抽屉中按“身份—正文—原始证据—语义关联”展开。
- 用户端的默认主表应是“情景/分叉”，不是原始回答流：先呈现前置状态与决策点，再列行动分支，最后回链到证据回答。没有审核情景时，应明确显示“语义层尚未构建”，并提供进入证据库的入口。
- 展示状态必须拆开：`availability` 表示来源是否可用，`review_status` 表示人工是否确认，未来还要有 `extraction_status`/`scenario_status` 表示语义处理进度；不能用一个状态代替三条流水线。
- KISS 版本只需要一个数据库工作台导航：`总览 → 原文/快照 → 决策经历 → 情景 → 分叉`。表格承载事实，抽屉承载详情，小型分支树承载关系，不先做全图谱画布。

## 低噪声界面复盘（2026-08-21）

- 桌面截图显示：用户端和管理端都把大标题、大面积留白和流程卡片放在真实数据之前，首屏更像介绍页而不是数据库工作台。
- 六条原文、六条快照、零情景、零分叉在管理端被统计卡、流程条和事实卡重复表达；同一事实只保留一次紧凑摘要即可。
- “原文/快照”应直接使用可扫描的行式数据视图；标题是主信息，来源、审核、采集时间和证据状态是列，正文预览只在详情检查器中出现。
- “语义层尚为空”是一个数据状态，不应占据一整屏；使用短状态行说明原因并指向证据层即可。
- 视觉基线选择 Linear 风格作为参考：近黑画布、分层表面、1px 细边框、单一紫色强调、无渐变和无投影。只借用低噪声信息层级，不复制品牌、字体或产品结构。
- 界面必须保持数据语义优先：中文标签、可追溯 URL/HTML、审核状态和分层模型不因视觉简化而丢失。
- `source_code` 与 `adapter_code` 是两个事实：前者表示知乎，后者表示数据如何进入系统。页面必须分别展示，不能把 `manual_url_capture` 当成来源名。
- 当前六条真实记录确实来自回答页直取，因此继续如实保留 `manual_url_capture`，界面标记为“回答页直取（旧）”；不能为了看起来正确而重写历史来源。
- 新的候选发现链路冻结为 `search_v3 搜索 → questions/{id}/feeds 问题回答列表 → answers/{id} 回答详情`，使用独立 `zhihu_search_question_api` 适配器标识，并保存每级端点与原始响应引用。
- 三段式适配器已实现为有界命令：调用者显式给出搜索词、最多问题数和每题最多回答数；相同回答跨问题/关键词去重，不跟随无限分页。
- 每条新记录同时保存完整搜索响应、完整问题回答列表响应、回答详情响应、实际命中的两个子项、三个端点、canonical URL 与正文 HTML；因此候选发现和正文证据都能回放。
- 新适配器的 raw hash 覆盖整个三段式证据包，而不是只哈希回答详情；同一回答由不同关键词发现时会保留不同 RawEnvelope，但相同正文仍由 content hash 合并为同一快照。
- 正式适配器要求显式 `authorization_ref`，且不在人工导入白名单中；入库仍必须命中数据库内有效授权。脚本把签名与账号管理交给 `zhurl`，本身不接触 Cookie。
- 质量门采用确定性规则而不是黑箱模型：正文非空白字符数、句段结构、决策词、背景词、结果词、互动量和营销词共同计算 0–100 分；正文少于 80 字、没有决策信息、疑似营销或低于 45 分直接拒收。
- 滚雪球只消费通过质量门的 `keyword_candidates`；候选来自知乎问题话题、回答关键词和去标点的问题标题。种子查询、轮次、问题数、候选回答数和扩展关键词数均可配置且有上限。
- 采集入口支持两种：`--query` 从搜索接口发现问题，`--question-id` 直接从问题回答列表开始；两者最终都经过同一质量门和回答详情抓取。

## 本机 Cookie 传输验证（2026-08-21）

- 用户提供的 `C:\Users\13081\Downloads\www.zhihu.com_cookies.txt` 文件仍存在；未读取、打印或提交其内容。
- 直接用该 Cookie 请求 `search_v3` 返回 HTTP 200，说明当前 Cookie 可以承担搜索接口认证；不能因此推断长期有效，仍需小批次、限速和失败处理。
- 正式采集器新增显式 `--cookie-file` 模式，但链路没有改变，仍是 `search_v3 → questions/{id}/feeds → answers/{id}`；默认 `zhurl` 传输仍保留。
- Cookie 文件只传给本机 curl 子进程；临时响应文件在单次请求后删除。原始记录只保存 API 响应、HTML、授权引用和发现运行 ID，不保存 Cookie 路径或内容。
- 受限真实采集已完成：11 条正式 `zhihu_search_question_api` 记录、2 个发现轮次、45 个关键词候选和 7 个决策经历候选已进入本地 SQLite；生成的 JSONL 未提交 Git。
- 合规边界未改变：用户提供 Cookie 解决的是本机请求凭据，不等同于知乎或上游工具的授权许可；正式大规模运行仍需确认授权、限速和删除要求。

## 滚雪球派生层（2026-08-21）

- 滚雪球不能只存在 CLI 内存里；采集命令为每次运行写入 `discovery_run_id`，导入时落成 `discovery_run`，关键词候选保留回答快照、原始 envelope、来源查询和轮次。
- `keyword_candidate` 是下一轮搜索的事实候选，不是关键词真理；管理端按出现次数、最高质量分和轮次排序，并排除已经用过的查询词。
- 通过质量门的回答同步生成 `decision_episode_candidate`：用可解释启发式从句子中提取处境、决策、行动、结果，并保存句子索引和算法版本 `heuristic-v1`。
- 决策候选与正式 `DecisionEpisode/Scenario/Branch` 分开。候选必须人工审核、补齐字段并绑定证据后，才允许进入情景和分叉层；系统不把启发式输出伪装成结论。
- 这形成最小闭环：`答案 → 质量门 → 关键词候选 → 下一轮查询`，同时并行产生 `答案 → 决策经历候选 → 人工审核 → 情景/分叉`。

## 资源

- 用户提供的 GitHub 账号：<https://github.com/zly2006>
- `zhurl` 仓库：<https://github.com/zly2006/zhurl>
- `zhurl` API 索引：<https://github.com/zly2006/zhurl/blob/main/docs/apis.md>
- `zhihu-plus-plus` 仓库：<https://github.com/zly2006/zhihu-plus-plus>
- 知乎《个人信息保护指引》：<https://www.zhihu.com/term/privacy?external=true>
- 《中华人民共和国个人信息保护法》：<https://www.ssf.gov.cn/portal/rootimages/uploadimg/1641708111970375/1641708111970375.pdf>
- 知乎协议：<https://www.zhihu.com/term/zhihu-terms>
- 知乎 robots.txt：<https://www.zhihu.com/robots.txt>
- GitHub 仓库元数据 API：<https://api.github.com/repos/zly2006/zhurl>
- PostgreSQL 18 GIN 文档：<https://www.postgresql.org/docs/current/gin.html>
- PostgreSQL 18 全文检索：<https://www.postgresql.org/docs/current/textsearch.html>
- PostgreSQL 18 递归查询：<https://www.postgresql.org/docs/current/queries-with.html>
- pgvector：<https://github.com/pgvector/pgvector>
