# 决策抽取工作流

这个目录负责把知乎回答整理成统一的“决策经历” JSONL。

## 先说边界

Spark 只做小规模校准和难例复核，不跑全量数据库。模型消耗按 Token 计算，不按“回答条数”计算。

正确分工：

```text
本地去重/清洗
  → 便宜模型或 4090 跑全量
  → Spark 抽样校准、复核难例
  → 自动校验与去重
  → 4090 生成 embedding
```

## Spark 任务边界

- 单批输入上限：8,000 Token；
- 单个 Goal 只处理清单指定的少量批次；
- 每次只打开清单当前批次的精确文件，禁止通配符读取整个 `input/`；
- 校验也只流式处理当前批次，不把多个批次合并到一次上下文；
- 一条回答只输出一个主决策对象；
- 缺少真实决策链就 `REJECT`；
- 不读取数据库，不发送 URL、HTML、Cookie、API key 或密码；
- 超长回答不截断，转给便宜模型或单独的长文本流程。

`GOAL_PROMPT.md` 是 Spark 的完整提示词。它只允许处理 `mode=spark_calibration` 的清单；全量清单不能直接交给 Spark。

## 文件

```text
spark-workflow/
├── GOAL_PROMPT.md              Spark Goal 提示词
├── output.schema.json          输出 JSON Schema
├── prepare_token_batches.py    按 Token 自动切批
├── manifest.example.json       清单示例
├── input/                      本地输入，不提交 Git
├── output/                     Spark 输出，不提交 Git
└── state/                      断点和失败记录，不提交 Git
```

## 生成批次

从本地 SQLite 只读生成新批次：

```bash
python spark-workflow/prepare_token_batches.py \
  --db local.db \
  --output-dir spark-workflow/run-cheap \
  --max-input-tokens 8000
```

脚本按 Token 而不是回答条数切分，不会截断正文，也不会把 URL 或 HTML 放进模型输入。

如果要让 Spark 处理这个运行目录，把 `spark-workflow/run-cheap` 设为工作目录，再粘贴 `spark-workflow/GOAL_PROMPT.md`。当前根目录的全量 `manifest.json` 仅作历史断点，禁止交给 Spark。

## 断点规则

Spark 每次先写 `.part`，校验通过后再改名为 `.jsonl`，最后更新 `state/progress.json`。Goal 中断或限额耗尽后，从第一个 `PENDING`/`RETRY` 批次继续。

Spark 输出只是提案文件，正式入库仍需经过自动一致性检查和上游导入器。
