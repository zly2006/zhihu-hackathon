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

要求 Python 3.12 和 [uv](https://docs.astral.sh/uv/)。本地双端默认使用 SQLite，启动时会自动建表，并幂等导入仓库里的 6 条真实知乎回答：

```powershell
uv sync --group dev
$env:DK_DATABASE_URL = "sqlite+pysqlite:///./local.db"
uv run uvicorn decision_knowledge.main:app --reload
```

然后打开：

- 用户端：<http://127.0.0.1:8000/>
- 管理端：<http://127.0.0.1:8000/admin>
- API 文档：<http://127.0.0.1:8000/docs>

用户端负责检索回答、阅读原文和查看已确认情景；管理端负责看数据库、导入 JSONL、审核快照、归档内容，以及创建情景和分叉。管理端不覆盖 `canonical_url`、raw HTML 和抓取哈希等原始证据字段。

这是本机工作台，当前没有登录和多用户权限，不要直接暴露到公网。

如果要从空库重新初始化，停止服务后删除本地生成的 `local.db`，再重新启动即可；导入是幂等的，重复启动不会复制回答。

仍可打开 `http://127.0.0.1:8000/docs` 调用
`POST /v1/source-records:batch`。请求体格式见
[source_record.valid.json](./tests/fixtures/source_record.valid.json)，外层再包一层
`{"records": [...]}`。

## 真实知乎公开数据

仓库内的 [data/zhihu/public_answers.jsonl](./data/zhihu/public_answers.jsonl)
是 6 条真实知乎回答页面的小批量捕获，不是合成演示数据。每条都保留知乎回答
URL、抓取响应校验值和原始 HTML 片段。采集器只在用户明确提供本机 Cookie 时访问
`https://www.zhihu.com/answer/<id>`，Cookie 不会进入仓库或远端；不调用私有 API、
不生成签名、不绕过验证码。批量知乎采集仍必须走授权适配器。

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
