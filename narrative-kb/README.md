# narrative-kb · Interactive Narrative Knowledge Base（v0）

基于《Narrative KB 开发执行说明书》与《数据采集与处理 Pipeline 设计文档》构建的叙事知识库 v0。

- **数据库**：SQLite（`data/narrative-kb.sqlite`，node:sqlite 零依赖；schema 对齐执行说明书四表 + `source_document` 溯源表，后续可迁移 PostgreSQL + pgvector）
- **抽取**：DeepSeek API（分批 + 断点续跑）
- **向量**：本地字符二元组哈希袋（8192 维 + L2 归一化，`embedding_type='lexical'`，v0.2）

## Pipeline

```text
inventory.mjs  → 扫描 localdata（格式/编码/规模/权利初判）        → data/tmp/inventory.json
parse.mjs      → 解码清洗 + 章节索引（txt；PDF/MOBI 仅登记元数据） → data/raw/*.txt
chunk.mjs      → 事件抽样切分（开头/中段/结尾/随机，按章抽取）      → data/tmp/sample.jsonl
web-to-sample.mjs → 开源数据（维基文库公版）并入抽样集
extract.mjs    → LLM 结构化抽取（DeepSeek，断点续跑）             → data/tmp/fragments.jsonl
embed.mjs      → 本地词法向量                                    → data/tmp/embeddings.jsonl
ingest.mjs     → 四维评分（≥15 入库）+ SQLite 入库                → data/narrative-kb.sqlite
search.mjs     → 检索验证（词法余弦 Top-K，可按 scene/conflict/life_stage 过滤）
```

## 使用

```bash
# 全链路（已入库数据直接跳过已完成步骤）
node narrative-kb/pipeline/extract.mjs     # 续跑/补抽（断点在 data/tmp/extract-checkpoint.json）
node narrative-kb/pipeline/embed.mjs
node narrative-kb/pipeline/ingest.mjs
node narrative-kb/pipeline/search.mjs "创业失败"
node narrative-kb/pipeline/search.mjs "毕业选择" --conflictType 价值观冲突   # 见 search.mjs 参数

# 服务契约（对齐《执行说明书》§11 两个端点；阶段 3 游戏侧 query adapter 按此接入）
node narrative-kb/pipeline/contract.mjs search "创业失败"     # → {scene_pattern, choice_pattern, emotion_curve}
node narrative-kb/pipeline/contract.mjs scene "城市选择"       # → {scene_structure, dialogue_style, choices}
```

## 服务契约（执行说明书 §11）

| 端点契约 | 输入 | 输出 | 本仓库实现 |
|---|---|---|---|
| `POST /api/narrative/search` | `{event, stage}` | `{scene_pattern, choice_pattern, emotion_curve}` | `pipeline/contract.mjs#narrativeSearch`（词法向量召回 + 结构化聚合） |
| `POST /api/narrative/scene` | `{event, characters, relationship}` | `{scene_structure, dialogue_style, choices}` | `pipeline/contract.mjs#narrativeScene` |

> v0 为数据侧契约封装；游戏侧接入（阶段 3）以 query adapter 复用，narrative-kb 独立 FastAPI 服务化为后续演进。

## 数据源与权利（v0）

| 来源 | 类型 | 权利 | 状态 |
|---|---|---|---|
| 本地 19 个中文网文 txt（都市/职场/校园） | novel | `internal_eval_only`（ragAllowed=false） | ready（内部演示，正式上线前需清理或取得授权） |
| 赵树理小说集 | novel | `public_domain`（作者 1970 卒） | ready |
| 维基文库鲁迅《狂人日记》《故乡》 | literary | `public_domain` | ready |
| 活着/平凡的世界/人世间/CLANNAD/四月是你的谎言 | novel/vn | `discovered`（保护期+非授权渠道） | 仅登记元数据，不抽取 |
| VNDB API | vn_metadata | 当前代理下 API 路由不可达，待补 | — |

## 边界

- `localdata/` 与 `narrative-kb/data/raw/`（版权原文）已 gitignore，不入库。
- 每条 fragment 通过 `source_document_id` + `source_span`（章节）可溯源；`rights_status / rag_allowed / training_allowed` 必填。
- LLM 抽取为顺序执行 + 断点；失败章节记录后可续跑。
