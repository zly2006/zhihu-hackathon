# 决策情景知识库

把合法来源内容转成可追溯的决策经历、情景、路径与分叉路口。

当前已搭好第一条真实链路：

`SourceRecordV1 → 授权门禁 → RawEnvelope → ContentItem → ContentSnapshot`

- `RawEnvelope` 保存每次输入、来源 URL 和原始 HTML 片段，保证可追溯；
- `ContentItem` 表示同一篇回答的稳定身份；
- `ContentSnapshot` 同时保存规范化正文和原始 HTML 片段，只在正文变化时新增版本；
- 标记为人工/JSONL 导入的标准记录可直接写入，自动来源必须命中有效授权记录；
- PostgreSQL 是权威库，Neo4j 已预留但当前不写入，避免过早实现错误的图谱。

## 本机启动

要求 Python 3.12 和 [uv](https://docs.astral.sh/uv/)。本地双端默认使用 SQLite；空库启动时会自动建表并幂等导入仓库里的 6 条真实知乎回答。当前工作区的 `local.db` 已扩充到下方记录的 10396 条：

```powershell
uv sync --group dev
$env:DK_DATABASE_URL = "sqlite+pysqlite:///./local.db"
uv run uvicorn decision_knowledge.main:app --reload
```

然后打开：

- 用户端：<http://127.0.0.1:8000/>
- 管理端：<http://127.0.0.1:8000/admin>
- API 文档：<http://127.0.0.1:8000/docs>

用户端按“情景/分叉 → 原文快照”浏览；管理端按“总览 → 快照库 → 情景 → 分叉”看数据库、导入 JSONL、审核快照、归档内容，以及创建情景和分叉。管理端不覆盖 `canonical_url`、raw HTML 和抓取哈希等原始证据字段。

这是本机工作台，当前没有登录和多用户权限，不要直接暴露到公网。

如果要从空库重新初始化，停止服务后删除本地生成的 `local.db`，再重新启动即可；导入是幂等的，重复启动不会复制回答。

仍可打开 `http://127.0.0.1:8000/docs` 调用
`POST /v1/source-records:batch`。请求体格式见
[source_record.valid.json](./tests/fixtures/source_record.valid.json)，外层再包一层
`{"records": [...]}`。

## 真实知乎公开数据

仓库内的 [data/zhihu/public_answers.jsonl](./data/zhihu/public_answers.jsonl)
是 6 条真实知乎回答页面的小批量捕获，不是合成演示数据。每条都保留知乎回答
URL、抓取响应校验值和原始 HTML 片段。它们属于历史“回答页直取”样本，
`adapter_code=manual_url_capture` 会继续如实保留，不作为正式候选发现流程。
采集器只在用户明确提供本机 Cookie 时访问
`https://www.zhihu.com/answer/<id>`，Cookie 不会进入仓库或远端；不调用私有 API、
不生成签名、不绕过验证码。批量知乎采集仍必须走授权适配器。

正式知乎适配器的边界是：`search_v3` 搜索发现问题，
`questions/{id}/feeds` 取得问题回答列表，再用 `answers/{id}` 获取回答详情；
三层响应均需保留来源引用，入库记录使用独立的
`adapter_code=zhihu_search_question_api`，不能沿用 `manual_url_capture`。

正式适配器默认通过 [`zhurl`](https://github.com/zly2006/zhurl) 发起请求；如果本机已有用户明确提供的 Netscape Cookie 文件，也可以显式使用
`--cookie-file` 走同一套搜索—问题—回答接口。Cookie 只在本机请求时使用，永不写入
SourceRecord、数据库、日志或 Git。两种模式都需要数据库中匹配
`zhihu_search_question_api` 的有效授权记录。

```powershell
uv run python scripts/collect_zhihu_search_question.py `
  --query 转行 `
  --query "读研还是工作" `
  --question-id 329687018 `
  --authorization-ref auth-zhihu-search `
  --max-questions 5 `
  --max-answers-per-question 10 `
  --max-candidates-per-question 30 `
  --snowball-rounds 2 `
  --max-snowball-queries 5 `
  --output data/zhihu/search_question_answers.jsonl
```

本机 Cookie 模式只需替换请求传输参数：

```powershell
uv run python scripts/collect_zhihu_search_question.py `
  --cookie-file C:\Users\13081\Downloads\www.zhihu.com_cookies.txt `
  --authorization-ref local-cookie-20260821 `
  --query 转行 `
  --max-questions 2 `
  --max-answers-per-question 2 `
  --max-candidates-per-question 5 `
  --snowball-rounds 2 `
  --max-snowball-queries 2 `
  --output data/zhihu/search_question_answers.jsonl
```

Cookie 模式先完成了小批量链路验证，随后按搜索发现问题、问题回答流抓取扩充数据集。
当前本地 SQLite 已有 **10396 条唯一回答**、10397 个快照、10672 个原始证据包、73 个
`discovery_run`；所有批次 JSONL 仅保留在本机，未提交到 Git。

问题流中的完整 HTML 直接保存在 `raw_html`，新增记录的 `raw.payload.answer_capture`
标记为 `question_feed_target`；采集器写 JSONL 时会转义 U+2028/U+2029，保证一条回答对应一行。
达到 10000 条唯一回答后已停止继续采集。

同步数据库：仓库中的 `local.db.zst` 是当前 SQLite 数据库的 Zstandard 压缩副本，
通过 Git LFS 管理。恢复到本地数据库：

```powershell
zstd -d local.db.zst -o local.db
```

解压前请确认目标 `local.db` 不存在或已备份；压缩包本身不包含 Cookie 文件。

如果知乎 API 临时返回 40352（要求网页验证），不要绕过验证。验证完成后可使用
`--signed-cookie-file` 让 `zhurl` 从一次性临时账号目录读取本机 Netscape Cookie，
生成 web 请求签名；临时目录在单次请求后删除，不写入项目或数据库：

```powershell
uv run python scripts/collect_zhihu_search_question.py `
  --signed-cookie-file C:\Users\13081\Downloads\www.zhihu.com_cookies.txt `
  --authorization-ref local-cookie-20260821 `
  --zhurl zhurl `
  --query 转行 `
  --output data/zhihu/search_question_answers_signed.jsonl
```

为达到初始数据集并继续扩容，数据库中有 619 条明确标记为
`capture_method=zhihu_search_result_promotion` 的搜索结果恢复记录：它们已经包含真实知乎回答
HTML 和 URL，但尚未拿到 `answers/{id}` 详情；API 恢复后优先补抓，不将其误报为完整详情。

每条输出都在 `raw.payload` 中保留命中的搜索项、问题回答列表项、回答详情和
三个请求端点；回答 HTML 同时进入 `content.raw_html`，可直接导入权威证据库。
采集器只从通过质量门的回答生成下一轮关键词：正文至少 80 个非空白字符，且必须
包含决策信息；正文结构、背景、结果、互动量和营销信号共同形成可解释分数。
轮次、问题数、候选回答数和下一轮关键词数均有上限。

导入这批 JSONL 后，系统会继续做两件可回放的派生工作：

- 通过质量门的 `keyword_candidates` 写入关键词候选表，按出现次数、最佳质量分和轮次生成管理端的下一轮查询建议；
- 从同一回答生成 `DecisionEpisodeCandidate` 草稿，拆出“处境 / 决策 / 行动 / 结果”及句子证据。它仍是 `UNREVIEWED` 候选，不会自动变成正式情景或分叉。

每次命令运行都有 `discovery_run_id`。管理端的“滚雪球与候选”面板，或以下接口，可以查看这条血缘：

- `GET /api/admin/discovery/queries`：下一轮查询建议；
- `GET /api/admin/decision-candidates`：可审核的决策经历草稿；
- `PATCH /api/admin/decision-candidates/{id}`：确认或驳回草稿。

```powershell
uv run python scripts/collect_zhihu_public.py `
  --cookie-file C:\path\to\www.zhihu.com_cookies.txt `
  --url https://www.zhihu.com/answer/717484672 `
  --output data/zhihu/public_answers.jsonl
```

健康检查：`GET http://127.0.0.1:8000/health`。

## Docker Compose

```powershell
Copy-Item .env.example .env
docker compose up --build
```

它会启动 PostgreSQL、Neo4j 和 API，并先自动执行数据库迁移。Neo4j 当前只作为下一阶段的派生图存储，不影响原始数据入库。

## 验证

```powershell
uv run ruff check src tests migrations
uv run mypy src
uv run pytest
```

完整实施顺序见 [PLAN.md](./PLAN.md)。
