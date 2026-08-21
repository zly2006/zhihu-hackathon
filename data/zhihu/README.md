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

## 本地真实数据集（2026-08-21）

按搜索发现问题、问题回答流抓取的方式扩容后，本地 SQLite 已有 **10396 条唯一回答**、
10397 个快照、10672 个原始证据包、13823 个关键词候选和 7221 个决策经历候选。
各批 JSONL 只作为本机回放材料，不提交到 Git；权威副本是本地数据库中的
`RawEnvelope`/`ContentSnapshot`。

新增问题流记录使用 `answer_capture=question_feed_target`，保留问题接口返回的完整 HTML、
回答 URL、搜索响应、问题回答流和质量评分；采集器写 JSONL 时会转义 U+2028/U+2029，
避免 HTML 中的 Unicode 行分隔符破坏导入。搜索接口偶发 403 的关键词会跳过，不绕过验证。

其中 619 条记录来自已保存搜索响应中的质量通过回答，原始字段明确标记
`capture_method=zhihu_search_result_promotion`、`promotion_stage=search_result_only`。
它们均保留知乎回答 URL、非空回答 HTML 和完整搜索响应，但尚未拿到
`questions/{id}/feeds`/`answers/{id}` 详情；API 恢复后应优先补抓详情。
