# Narrative KB（叙事知识库）v0 建设完成报告

- 日期：2026-09-01
- 依据：`docs/Narrative_KB_开发执行说明书.md` + `docs/Narrative_Knowledge_Base_数据采集与处理_Pipeline设计文档.md`
- 用户确认的决策：**SQLite v0 落地 / 网文 internal_eval_only（内部演示）/ DeepSeek API 抽取 + 本地词法向量 / 范围=建库到检索验证**
- 分支：`dev/mvp-v1-interactive-life`（narrative-kb/ 独立目录，不改游戏热路径）

## 一、数据库结构（SQLite：narrative-kb/data/narrative-kb.sqlite）

| 表 | 说明 | 条目数 |
|---|---|---|
| `source_document` | 来源文档（含权利状态、可溯源 URI/hash） | 26 |
| `narrative_fragment` | 核心叙事片段（事件/场景功能/冲突/情绪曲线/选择点/可迁移规则） | **153** |
| `choice_pattern` | 玩家选择模式 | 202 |
| `character_arc` | 人物弧光（state_before/state_after） | 390 |
| `embeddings` | 词法向量（8192 维哈希袋，embedding_type='lexical' v0.2） | 153 |

- 每表均含 `rights_status / rag_allowed / training_allowed` 溯源链路（fragment → source_document → 权利记录）。
- 后续迁移 PostgreSQL + pgvector：表结构同构，`embeddings.vector` 改 pgvector 列即可。

## 二、语料处理结果（24 个文件）

| 类别 | 数量 | 处理 |
|---|---|---|
| 中文网文 txt（都市/职场/校园青春） | 19 | 解码清洗（UTF-8）+ 章节索引 + 事件抽样切分 + LLM 抽取 → **internal_eval_only**（ragAllowed=false，内部演示用） |
| 赵树理小说集（公版） | 1 | 同上 → **public_domain**（ragAllowed=true） |
| 维基文库鲁迅《狂人日记》《故乡》（公版） | 2 | 抓取 + 抽取 → **public_domain** |
| 活着/平凡的世界/人世间/CLANNAD（PDF） | 4 | 版权保护期 + 非授权渠道 → **仅登记元数据（discovered），不抽取** |
| 四月是你的谎言（MOBI 漫画） | 1 | 图片型无文本层 → **跳过（记录原因）** |
| VNDB 开放 API | — | 当前 Clash 代理下 API 路由不可达（"Not found"），已记录为待补数据源 |

编码异常：19 个 txt 全部判定 UTF-8 且解码 0 替换符；无编码异常需跳过（MOBI 为格式跳过）。

## 三、抽取与质量

- 抽取模型：DeepSeek（.env 配置），`response_format=json_object`，max_tokens 3000，温度 0.4。
- 抽样：每文本 开头3+结尾2 章（约 87 章，每章 ≤2000 字），断点续跑（checkpoint），失败章节记录跳过。
- Validator 四维评分（人生相关性/游戏性/情绪完整度/可迁移性，各 0-5）：**总分 ≥ 15 才入库**。实际 min 17 / max 20 / avg 19.54，全部通过。
- 已入库 fragment：**153** 条（74/74 抽样章节全部完成、0 失败；断点续跑可继续扩量）。
- 按 `life_stage` 分布：career 38、romance 25、education 24、social 24、family 12、friendship 7、relocation 7、entrepreneurship 4、marriage 4、finance 3、health 2、aging 1、housing 1、identity 1。
- 按 `scene_type` Top8：setup 29、conflict 27、decision 15、reversal 15、bonding 14、transition 13、reveal 12、aftermath 9。

## 四、检索验证

```text
$ node narrative-kb/pipeline/search.mjs "创业失败"
[10.6%] 偷偷等风来｜公司确定处理方案：客户换房并要求销售当场道歉
    场景=decision 冲突=价值观冲突 阶段=career 评分=19
[9.6%]  逐梦职场｜系统主动汇报并回避高争议选项，洛青潼发现其行为异常
    场景=reveal 冲突=价值观冲突 阶段=career 评分=20

$ node narrative-kb/pipeline/search.mjs "关系冲突 家庭"
[31.7%] 都市情缘之狼性人生｜重组家庭八年，天赐从不叫继母"妈"而叫"婶子"，家庭关系和睦但存有疏离
    场景=setup 冲突=身份冲突 阶段=family 评分=18
[27.4%] 十七岁的未命名夏天｜父母在饭桌上突然宣布离婚，女儿情绪爆发反对
```

## 五、使用方式

```bash
# 补抽/续跑（断点自动跳过已完成章节）
node narrative-kb/pipeline/extract.mjs
node narrative-kb/pipeline/embed.mjs
node narrative-kb/pipeline/ingest.mjs
node narrative-kb/pipeline/search.mjs "毕业选择" --lifeStage career
```

## 六、边界与合规

- `localdata/` 与 `narrative-kb/data/raw/`（版权原文）已加入 .gitignore，不入库。
- 网文为 internal_eval_only：正式上线前需取得授权或清理；保护期作品仅登记元数据。
- LLM 调用为顺序执行 + 断点；单批 ≤2K 字，符合 AGENTS.md token 安全（不整库入上下文）。
- 本仓库只做叙事知识库 v0（数据工程侧产物），游戏接入（`/api/narrative/*`）留待阶段 3 V1.1 联调。
