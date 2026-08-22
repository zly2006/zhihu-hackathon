# 决策情景知识库

![决策情景知识库](./assets/decision-knowledge-overview.png)

把真实来源的知乎回答，拆成可追溯的决策事件，再合并成可比较的决策情景、行动分叉和结果观察。

这不是回答列表，也不是标签库。核心数据关系是：

```text
回答快照
  → 原文片段
  → 决策事件（决策背景 → 决策情景 → 决策结果）
  → 规范情景
  → 行动分叉
  → 结果证据
```

## 设计原则

- **原文优先**：每条正式信息都能回到知乎 URL、原始 HTML 和具体证据片段。
- **事件中心**：一篇回答可以拆成 0..N 个决策事件，也可以没有可抽取事件。
- **情景不是标签**：情景由“可比较的决策背景 + 相同决策点”组成。
- **行动形成分叉**：同一情景下的不同实际行动，才是分叉候选。
- **结果保持观察**：保留时间窗口、代价、收益和反例，不把相关性写成因果。
- **向量只做召回**：embedding 用来找相似决策情景，最终归属仍由结构化字段、证据和审核确认。

## 单条决策事件

```text
决策背景：做决定前处在什么状态？
决策情景：当时面临什么选择，实际采取了什么行动？
决策结果：之后在什么时间窗口观察到了什么？
```

情景 embedding 只使用：

```text
决策背景 + 决策点 + 已知选项 + 目标/约束
```

不把最终行动和结果放入情景向量，否则会把同一情景的不同分叉错误拆开。向量只负责 Top-K 候选召回，关系库才是事实来源。

当前已落地一条可重放的召回链路：

```text
DecisionEpisodeCandidate
  → scenario-text-v2（背景 + 决策点）
  → blocking_key（粗粒度结构阻断）
  → candidate_embedding（模型/版本/hash/float32 向量）
  → Top-K 召回
  → 确定性结构化校验
```

向量表是可删除、可重算的派生层；单独导入向量不会创建 `DecisionScenario` 或 `DecisionBranch`。本地工作库当前已导入 6,263 条 `bge-large-zh-v1.5:scenario-text-v2` 向量。

### 从候选到情景簇和分叉

批处理命令把“同领域 + 决策点词面有交集 + 向量相似度达标”的候选合并为情景簇；
再按同一情景中的实际行动拆成分叉。自动质量门通过就写入 `CONFIRMED`，不通过就写入 `REJECTED`
并记录原因；正常运行不生成待人工处理队列。

```powershell
uv run python scripts/propose_scenario_clusters.py `
  --database-url sqlite+pysqlite:///./local.db `
  --embedding-version "bge-large-zh-v1.5:scenario-text-v2" `
  --report .tmp/embedding/scenario-proposals.json
```

这一步会写入 `decision_scenario_membership` 和 `decision_branch_membership`，保留相似度、算法版本、
embedding 版本、候选 ID 和知乎快照定位；重复运行同一 embedding 版本是幂等的。先看结果而不写库时加
`--dry-run`。当前真实库已生成 18 个情景簇、21 个分叉，自动确认 15 个情景和 14 个分叉，其余自动排除。

## 数据处理驱动

语义处理由数据库任务队列驱动：

```text
processing_task
  → CodexSparkDriver
  → 结构化语义提案
  → 证据/Schema 校验
  → 自动质量门
  → 正式数据或排除记录
```

GPT-5.3-Codex-Spark 负责快速拆分和归纳，不直接写数据库；所有输出都要带模型版本、输入 hash 和原文证据。Spark 不生成向量，只生成规范化 `scenario_text`，向量由独立 embedding 模型生成。驱动层保持可替换，便于无人值守任务使用 API 结构化模型。

成本默认采用分层路由：本地规则先过滤，`GLM-4.7-Flash` 批量处理大多数简单抽取，`gpt-5.4-nano` 只处理低置信度难例，Spark 主要用于交互式调试和黄金集复核。GLM 的免费额度仍按配额和 QPS 运行，Worker 会记录限流、重试和升级原因。

## 从大量数据到决策支持

```text
10,000 条回答
  → 决策事件
  → 规范情景
  → 情景内分叉
  → 分叉结果汇总
  → 匹配用户当前决策情景
  → 返回相似情景、分叉和原文证据
```

知识库先展示检索证据；应用层可以基于这些证据生成回答，但回答不能脱离证据，也不能写回知识库：

- 当前背景与哪些情景相似、差异在哪里；
- 每条分叉的实际行动、适用条件、收益和代价；
- 短期/长期结果观察、反例和冲突；
- 独立来源数、证据覆盖和仍然未知的变量。

数据不足时明确返回“没有足够可比证据”，不使用相似但不相关的回答凑结果。

## 当前数据集

当前本地 SQLite 工作库包含真实知乎采集数据：

- 10,396 个唯一回答；
- 10,397 个内容快照；
- 10,672 个原始证据包；
- 13,823 个关键词候选；
- 7,221 个决策经历候选；
- 73 次滚雪球发现运行。

原始快照保留知乎回答 URL、原始 HTML、抓取响应和内容 hash。Cookie 只在本机请求进程中使用，不写入数据库、日志或 Git。

情景归并走自动化质量门：当前已自动确认 15 个情景、14 个行动分叉；3 个情景和 7 个分叉因相似度、决策点或候选置信度不足而自动排除。排除记录保留原因，不进入用户端，也不生成待人工处理队列。

原始快照、候选和自动归并结果仍分层保存：候选是输入，`CONFIRMED` 才是用户端可检索的正式情景；每条归属都能回链到知乎 URL、快照和原始 HTML。

### 运行候选 embedding

先导出脱敏候选（只包含候选语义字段，不包含知乎 URL、HTML 或 Cookie）：

```powershell
uv run python scripts/export_candidate_embedding_input.py `
  --database-url sqlite+pysqlite:///./local.db `
  --output .tmp/embedding/candidates_v2.json
```

在带 CUDA 的工作站上安装 `torch`、`sentence-transformers` 后运行：

```powershell
uv run python scripts/embed_candidate_scenarios.py `
  --input .tmp/embedding/candidates_v2.json `
  --output-dir .tmp/embedding/results
```

把 worker 产出的 `embeddings.npy`、`candidate_ids.json`、`scenario_texts.json` 和 `manifest.json` 一起导入：

```powershell
uv run python scripts/import_candidate_embeddings.py `
  --input .tmp/embedding/candidates_v2.json `
  --artifact-dir .tmp/embedding/results
```

内部召回接口为 `POST /api/retrieval/candidates`。它接收同一 embedding 版本的查询向量，可附带 `blocking_key`；返回候选和来源定位，不返回推荐结论。

生成情景和分叉并写回数据库（默认自动确认/自动排除）：

```powershell
uv run python scripts/propose_scenario_clusters.py `
  --database-url sqlite+pysqlite:///./local.db `
  --embedding-version "bge-large-zh-v1.5:scenario-text-v2" `
  --report .tmp/embedding/scenario-auto.json
```

自动门槛是：至少两个不同快照、决策点明确、最低相似度不低于 `0.90`、候选置信度不低于 `80`。只计算不写库时使用 `--dry-run`；`--no-auto-confirm` 仅用于诊断提案，不是生产路径。

## 本机启动

要求 Python 3.12 和 [uv](https://docs.astral.sh/uv/)。

```powershell
uv sync --group dev
$env:DK_DATABASE_URL = "sqlite+pysqlite:///./local.db"
uv run uvicorn decision_knowledge.main:app --reload
```

打开：

- 用户端：<http://127.0.0.1:8000/>
- 管理端：<http://127.0.0.1:8000/admin>
- API 文档：<http://127.0.0.1:8000/docs>

用户端提供“场景视角”和“单一决策视角”；管理端用于查看原文快照、自动归并状态、证据链和分叉。管理端保留手动修正接口，但主流程不依赖人工审核。
当前工作台没有登录和多用户权限，不要直接暴露到公网。

## 恢复数据库快照

`local.db` 不提交 Git，仓库只保留 Git LFS 管理的压缩快照 `local.db.zst`：

```powershell
git lfs pull
zstd -d local.db.zst -o local.db
```

解压前确认目标 `local.db` 不存在或已备份。

## 知乎采集边界

批量采集走授权的搜索—问题—回答链路：

```text
search_v3 → questions/{id}/feeds → answers/{id}
```

采集器会保留搜索响应、问题回答列表、回答详情和 HTML 原文，并通过质量门后才生成关键词和决策候选。未获得明确授权时，自动采集任务不会启动；不绕过验证码或风控。

示例：

```powershell
uv run python scripts/collect_zhihu_search_question.py `
  --cookie-file C:\path\to\www.zhihu.com_cookies.txt `
  --authorization-ref local-cookie-20260821 `
  --query 转行 `
  --max-questions 2 `
  --max-answers-per-question 10 `
  --output data/zhihu/search_question_answers.jsonl
```

Cookie 文件只作为本机请求输入；不要提交 Cookie、批量响应 JSONL 或未脱敏原文数据。

## 项目结构

```text
src/decision_knowledge/        API、采集、证据库和候选分析
migrations/                    Alembic 数据库迁移
scripts/                       知乎采集、扩容、embedding 导出/生成/导入脚本
docs/knowledge-base-model.md   决策事件、情景、分叉和 embedding 模型
PLAN.md                        实施主计划
CONTEXT.md                     领域术语和边界
findings.md                    调研与真实数据分析
assets/                        项目介绍图和静态资源
```

## 验证

```powershell
uv run ruff check src tests migrations
uv run mypy src/decision_knowledge
uv run pytest -q
node --check src/decision_knowledge/web/user.js
```

完整方案见 [PLAN.md](./PLAN.md)，数据模型见 [docs/knowledge-base-model.md](./docs/knowledge-base-model.md)。
