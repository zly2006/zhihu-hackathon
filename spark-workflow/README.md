# Spark 批处理工作流

这个目录是给 GPT-5.3-Codex-Spark Goal 模式使用的本地工作区。

它只做一件事：把知乎回答提炼成统一的“决策经历” JSONL。它不直接写数据库，不修改原始回答，也不发送 Cookie、数据库密码或原始 HTML。

## 目录

```text
spark-workflow/
├── GOAL_PROMPT.md          可直接粘贴到 Spark Goal 的提示词
├── output.schema.json      每条结果必须满足的 JSON Schema
├── manifest.example.json   批次清单示例
├── input/                  本地输入批次，不提交 Git
├── output/                 Spark 输出，不提交 Git
└── state/                  断点和失败记录，不提交 Git
```

## 工作流

```text
准备批次
  → Spark Goal 读取一个 PENDING 批次
  → 输出一个同名 JSONL
  → JSON Schema 和证据校验
  → 写入断点
  → 继续下一个批次
  → 上游导入器写入数据库
  → 4090 生成情景 embedding
```

每个输入批次建议 20～50 条。输入只保留模型需要的字段：

```json
{"id":"snapshot-001","question_title":"要不要换工作？","answer_text":"回答正文"}
```

`id` 是本地数据的稳定主键。知乎 URL、HTML 和作者信息留在本地证据库，通过 `id` 回链，不需要重复发给模型。

## Spark 的处理边界

一条回答只输出一个主决策对象；不能确定它在讲真实决策，就输出 `REJECT`，不补写、不猜测。`ACCEPT` 结果至少要能从原文找到：决策对象、面临的选择、实际行动，以及可观察的结果或明确的结果缺失。

成功标准：

- 输入和输出的 `id` 一一对应，不漏、不重、不改；
- 每行都是合法 JSON，且通过 [output.schema.json](./output.schema.json)；
- `evidence_quote` 必须是输入正文的连续原文；
- `decision_object` 只描述“正在决定什么”，不把背景和结果塞进对象名；
- `REJECT` 不进入正式知识库，但保留原因；
- 只有校验通过的批次才能写入 `state/progress.json`。

## 断点规则

Spark 每次只处理一个批次：

1. 读取 `manifest.json`，找第一个 `PENDING` 或 `RETRY` 批次；
2. 先写 `output/<batch-id>.jsonl.part`；
3. 校验通过后原子改名为 `.jsonl`；
4. 再更新 `state/progress.json`；
5. 失败只写 `state/retries/<batch-id>.json`，不把批次标记为完成。

因此 Goal 中断、额度用完或本机重启后，可以从上一个未完成批次继续，不重复导入。

## 后续交接

Spark 的 JSONL 是“提案文件”，不是数据库事实。校验通过后，由上游数据仓库的导入器完成：

```text
JSONL → 决策对象/回答关联 → 去重 → 质量门 → 数据库
```

网页端只读取上游发布后的只读数据，不在这个目录里执行 PostgreSQL 写入或 schema 迁移。

## 注意

- 不把 `input/`、`output/`、`state/` 中的真实数据提交 Git；
- 不在 Goal 对话中粘贴 Cookie、API key、数据库 DSN 或完整原始 HTML；
- Spark 是长任务代理，额度或会话中断是正常情况，必须依赖断点文件恢复；
- GPT-5.3-Codex-Spark 当前通过 ChatGPT Pro/Codex 使用，不作为普通 API worker 调用；具体额度以账号页面为准。

