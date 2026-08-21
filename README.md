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

## 从大量数据到决策支持

```text
10,000 条回答
  → 决策事件
  → 规范情景
  → 情景内分叉
  → 分叉结果汇总
  → 匹配用户当前背景
  → 条件化比较报告
```

系统不会直接输出无条件的“你应该选 A”。它展示：

- 当前背景与哪些情景相似、差异在哪里；
- 每条分叉的实际行动、适用条件、收益和代价；
- 短期/长期结果观察、反例和冲突；
- 独立来源数、证据覆盖和仍然未知的变量。

数据不足时明确返回“没有足够可比证据”，不使用相似但不相关的回答凑结论。

## 当前数据集

当前本地 SQLite 工作库包含真实知乎采集数据：

- 10,396 个唯一回答；
- 10,397 个内容快照；
- 10,672 个原始证据包；
- 13,823 个关键词候选；
- 7,221 个决策经历候选；
- 73 次滚雪球发现运行。

原始快照保留知乎回答 URL、原始 HTML、抓取响应和内容 hash。Cookie 只在本机请求进程中使用，不写入数据库、日志或 Git。

当前候选仍需人工审核，不能把 `DecisionEpisodeCandidate` 直接当成正式情景或分叉。

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

用户端提供“场景视角”和“单一决策视角”；管理端用于查看原文快照、审核候选、创建情景和维护分叉。当前工作台没有登录和多用户权限，不要直接暴露到公网。

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
scripts/                       知乎采集、扩容和导入脚本
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
