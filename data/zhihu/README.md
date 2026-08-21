# 真实知乎公开回答采集

`public_answers.jsonl` 是 2026-08-21 使用用户提供的本机 Cookie，从知乎原始
`https://www.zhihu.com/answer/<id>` 页面小批量采集的真实回答，不是演示数据。

每条记录都保留：

- `canonical_url`：知乎回答原始 URL；
- `raw.payload.fetch_url`：实际抓取的知乎原始回答 URL；
- `content.raw_html`：页面 `js-initialData.globalStation.contentData.content` 返回的原始 HTML 片段；
- `raw.sha256`：实际页面响应的 SHA-256；
- `raw.payload.response_sha256`、`fragment_sha256`：响应和片段的校验值。

本批次是用户指定的、边界明确的公开回答捕获，Cookie 只在本机读取，不进入仓库、镜像或远端工作站；不调用私有 API、不生成签名、不绕过验证码。知乎协议和 robots.txt 的授权限制仍然有效；后续批量采集必须接入有授权的适配器。当前正文语言标记为 `zh-CN`。

采集命令：

```text
uv run python scripts/collect_zhihu_public.py \
  --cookie-file C:\\path\\to\\www.zhihu.com_cookies.txt \
  --url https://www.zhihu.com/answer/717484672 \
  --output data/zhihu/public_answers.jsonl
```

正式的搜索—问题—回答采集使用：

```text
uv run python scripts/collect_zhihu_search_question.py \
  --cookie-file C:\\path\\to\\www.zhihu.com_cookies.txt \
  --authorization-ref local-cookie-20260821 \
  --query 转行 \
  --snowball-rounds 2 \
  --output data/zhihu/search_question_answers.jsonl
```

该 JSONL 会保留搜索、问题回答列表和回答详情的完整原始响应，文件可能较大且含来源内容，
默认只作为本机导入材料，不自动提交 Git；真正的权威副本是本地数据库中的
`RawEnvelope`/`ContentSnapshot`。
