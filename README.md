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

要求 Python 3.12 和 [uv](https://docs.astral.sh/uv/)。没有 PostgreSQL 时可先用 SQLite：

```powershell
uv sync --group dev
$env:DK_DATABASE_URL = "sqlite+pysqlite:///./local.db"
uv run alembic upgrade head
uv run uvicorn decision_knowledge.main:app --reload
```

打开 `http://127.0.0.1:8000/docs` 调用
`POST /v1/source-records:batch`。请求体格式见
[source_record.valid.json](./tests/fixtures/source_record.valid.json)，外层再包一层
`{"records": [...]}`。

## 真实知乎公开数据

仓库内的 [data/zhihu/public_answers.jsonl](./data/zhihu/public_answers.jsonl)
是 6 条真实知乎公开回答页面的小批量捕获，不是合成演示数据。每条都保留
知乎回答 URL、抓取响应校验值和原始 HTML 片段。采集器只允许
`https://www.zhihu.com/en/answer/<id>`，不使用 Cookie、登录态、私有 API 或签名绕过；
批量知乎采集仍必须走授权适配器。

```powershell
uv run python scripts/collect_zhihu_public.py `
  --url https://www.zhihu.com/en/answer/717484672 `
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
