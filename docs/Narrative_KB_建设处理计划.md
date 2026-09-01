# Narrative KB（叙事知识库）建设处理计划

- 日期：2026-09-01
- 依据：`docs/Narrative_KB_开发执行说明书.md`（工程规格）+ `docs/Narrative_Knowledge_Base_数据采集与处理_Pipeline设计文档.md`（数据设计）+ 既有《Narrative Knowledge Database 设记》权利规则
- 状态：**待用户确认后执行**（本计划不执行任何写操作）

## 一、两份新文档的角色定位

| 文档 | 作用 | 关键结论 |
|---|---|---|
| `Narrative_KB_开发执行说明书.md` | **工程规格**：独立服务 `narrative-kb/`（Python + FastAPI + PostgreSQL + pgvector）的目录结构、开发顺序（库→模型→Parser→Chunker→Extractor→Validator→Embedding→API→测试）、四张表、Demo 验收（20 原始文本 / 500 fragments） | 技术栈固定 PG+pgvector；Parser 一阶段支持 TXT + Ren'Py(.rpy)；Chunker 用 **Event Based Chunking**（章节→人生事件）；Extractor 输出 JSON；Validator 四维评分 ≥15 入库 |
| `Narrative_KB_数据采集与处理_Pipeline设计文档.md` | **数据设计**：两类语料（Novel Corpus + Visual Novel Corpus）、Demo 配比（40% 都市/职场小说 + 30% Galgame/VN + 20% 文学 + 10% 游戏设计资料）、三层处理（Raw→事件切分→LLM 结构化）、Narrative Fragment 结构、三类核心知识（Scene/Dialogue/Choice Pattern） | 数据来源含开源网站（Ren'Py 项目、DDLC 相关、VNDB）；要求可溯源 |

两份文档与既有《设记》的衔接：执行说明书=“怎么做”，Pipeline=“喂什么/产出什么”，《设记》=“权利与边界”（本计划优先遵守《设记》§3 权利门）。

## 二、本地语料盘点（F:\260824zhihuihekes\localdata，24 个文件）

### 1. TXT × 19（中文网文，共约 31 MB）

| 类别 | 文件 | 编码初判 | 权利初判 |
|---|---|---|---|
| 都市/职场 | 职场权杖、职场无底线、都市情缘之狼性人生、都市日常：富二代在京城、都市老登的幸福生活、都市：神级逆袭人生、我的极品女友、我的红颜祸水、我和上司未婚妻、欲望都市、逐梦职场 | UTF-8 与 GBK 混杂，部分文件头部含坏字节 | 作者权利不明（渠道 z-library）→ unknown |
| 校园青春 | 十七岁的未命名夏天、青春无悔之校园风云、青春校园：听见你的轮廓、青春高中校园文、校园青春之混的那些年、逐光【校园】、偷偷等风来 | 同上 | unknown |
| 公版 | 赵树理小说集（赵树理 1970 卒） | UTF-8 | **公版 → Tier A，可入库** |

### 2. PDF × 4（现代文学/游戏脚本，均 z-library 渠道）

| 文件 | 页数 | 可提取文本量 | 权利判断 |
|---|---|---|---|
| 活着（余华，2021 版） | 138 | 极少（~7.8K 字符，疑扫描/图文混排） | **版权保护期**，非授权渠道 → 不满足 Tier A |
| 平凡的世界（路遥） | 1677 | 有文本层（~83K） | 同上（路遥 1992 卒，保护期至 2042） |
| 人世间（梁晓声） | 1450 | 有文本层（~84K） | 同上（梁晓声在世） |
| CLANNAD（Key） | 2901 | 部分可提取（~245K） | 商业游戏脚本，版权保护 → 不满足 |

### 3. MOBI × 1（四月是你的谎言 漫画）→ **图片型，无文本层** → 记录后跳过

### 4. 编码结论
19 个 txt 全部为中文编码，但 **UTF-8 / GBK 混杂且个别文件头部含坏字节**（如“职场权杖”头 8KB 内同时含可读 UTF-8 与坏区）。处理时按“BOM 探测 → 严格 UTF-8 → gb18030 → GBK → UTF-16LE”逐文件判定，坏字节用清洗规则修复；仍无法解码的文件**记录并跳过**，不影响整体流程。

## 三、整体处理计划（确认后执行，顺序按执行说明书 §4）

### 阶段 0：扫描与清洗（幂等，产出 `localdata/inventory.json`）
- 对 24 文件逐个：格式 / 编码判定 / 字符量 / 章节标记数 / 权利初判，写入清单（含异常标记）。
- 输出清洗后的标准文本到 `narrative-kb/data/raw/`（**原始文件不动**）。

### 阶段 1：解析（Parser）
- TXT：按编码解码 + 章节边界归一（“第一章/第 X 章/楔子/尾声”等标记 + 空行段）。
- PDF：用 `pdftotext`（本机已具备，无需安装依赖）提取；文本量过低的（如《活着》疑扫描）→ 记录后跳过，不强制 OCR。
- Ren'Py（.rpy）：待抓取的开源 VN 脚本，解析 scene/label/dialogue/menu/branch。
- MOBI 漫画：跳过（无文本层）。

### 阶段 2：事件切分（Event Based Chunking，不用固定字数）
- 启发式：章节标题 + 场景切换词（时间/地点/人物登场）+ 叙事功能变化 → 切出 **Narrative Unit**（如“毕业选择 / 创业失败 / 关系冲突”）。
- 每本书**抽样**代表性章节（开头/中段/高潮/结尾各若干），控制 LLM 成本，目标产出 **≥500 个 Narrative Unit**（执行说明书 Demo 标准）。

### 阶段 3：LLM 结构化抽取（Extractor）
- 按执行说明书 §8 Prompt 模板（`prompts/narrative_extract.md` 等），系统角色“视觉小说编剧与人生模拟游戏设计师”，输出 JSON：`scene_type / life_stage / characters / trigger / conflict / emotion_curve / choice_points / relationship_effect`。
- 模型：本机 `.env` 的 DeepSeek API；**分批 + 断点续跑**（AGENTS.md 要求），单批 ≤8K token。
- 允许规则版先跑通再补 LLM（见决策点 3）。

### 阶段 4：Validator 评分
- 四维 0-5：人生相关性 / 游戏性 / 情绪完整度 / 可迁移性；`score ≥ 15` 才进 Knowledge Base；同时按《设记》记录 `quality` 与 `rightsSnapshot`。

### 阶段 5：Embedding 与入库（见决策点 1/4）
- schema 对齐执行说明书四表：`narrative_fragment / choice_pattern / character_arc / embeddings`（embeddings 按 `embedding_type`：scene/conflict/emotion/choice，为 pgvector 迁移预留）。
- 检索：`fragment_id` 可溯源到 `source`（来源文档/章节/字符区间）。

### 阶段 6：开源网站数据抓取（走 Clash 代理 127.0.0.1:7897）
| 数据源 | 抓取内容 | 权利处理 |
|---|---|---|
| VNDB（api.vndb.org，已验证 200） | 高人气视觉小说/人生主题作品的类型、主题、人物关系元数据标签 | 开放 API 元数据 → 可入库 |
| GitHub 开源 Ren'Py 项目 | `script.rpy` 文本（scene/dialogue/menu），仅选**明确开源许可**项目 | 按各项目 LICENSE 甄别 |
| 维基文库/公版语料仓库 | 公版中文文学（补“文学 20%”配比） | 公版 → Tier A |

抓取规模控制在本批 pilot 需要（少量代表作即可），并记录来源 URL。

### 阶段 7：交付报告
- 数据库文件、schema 结构、条目总数（fragment / choice_pattern / character_arc / embeddings）、按 `scene_type`/`conflict_type` 的类别分布、来源清单（含权利状态）、被跳过文件清单及原因。

## 四、权利门（优先于“好不好看”，按《设记》§3）

- **Tier A（ragAllowed=true）**：赵树理小说集（公版）；维基文库/开源许可文本。
- **unknown / 待确认**：其余 18 个 txt 网文——默认不置 `ragAllowed`；除非你确认有授权，或确认“仅内部演示”则标 `internal_eval_only`（ragAllowed=false、trainingAllowed=false）。
- **保护期 + 非授权渠道**：活着/平凡的世界/人世间/CLANNAD/四月是你的谎言——**只登记元数据（discovered），不进入 ready 数据**；你有授权证明时可升 Tier。
- 数据库 schema 中 `rights_status / rag_allowed / training_allowed` 为必填，审计链 `fragment → source_document → rights record → proofReference` 完整。

## 五、环境约束与落地方案（需你拍板）

- 本机**无 PostgreSQL、无 Docker**；磁盘充足；网络走 Clash 代理可用。
- 文档技术栈是 PostgreSQL + pgvector，但本机无法直接起实例。备选：

| 方案 | 说明 | 代价 |
|---|---|---|
| **A. SQLite v0（推荐）** | 四表 schema 与文档对齐，向量用本地词法/余弦（零依赖），项目内 `narrative-kb/` 落地；后续可平滑迁 PG+pgvector | 偏离文档技术栈一步（v0 过渡） |
| B. 安装本地 PostgreSQL | 系统级安装 + pgvector 扩展 | 需要装系统软件（超出“仅项目文件夹”边界，需你授权且耗时） |
| C. 纯 JSON + 检索脚本 | 最轻，但“数据库”能力弱 | 不满足“入库”要求 |

## 六、需你确认的决策点

1. **数据库选型**：A（SQLite v0，推荐）/ B（本机装 PostgreSQL）/ C（纯 JSON）。
2. **版权策略**：严格门（仅公版入 ready，网文标 unknown、保护期作品仅登记）（推荐）/ 网文降级为 internal_eval_only 用于内部演示。
3. **抽取与向量**：DeepSeek API 抽取 + 本地词法向量 v0（推荐，成本可控、可断点）/ 纯规则先跑通 pipeline / 全 API（含语义向量，成本高）。
4. **本轮范围**：只建库到“入库 + 检索验证”（推荐先做）/ 含 FastAPI 服务 `/api/narrative/search`、`/api/narrative/scene` / 含与 zhihu-hackathon 的联调桩。

---

# 附：待决事项决策结论（2026-09-01）

## 决策 1 · 语料扩量目标：扩至 500 条（Demo 验收标准）

- **依据（文档既有结论）**：
  - `docs/Narrative_KB_开发执行说明书.md` §13 Demo 验收标准：**“至少 20 个原始文本、500 个 Narrative Fragment”** —— 工程规格中的硬性验收线。
  - `docs/Narrative_Knowledge_Base_数据采集与处理_Pipeline设计文档.md` §10：Demo 规模建议 20-50 本 → **5000-10000** fragments —— 这是 20-50 本语料的规模化目标，**不属于当前 Demo 验收门槛**。
  - `docs/LifeExperience与InteractiveNarrativeKnowledgeBase数据库设记.md` §30：V0＝300-500（设计验证）、V1＝3000-10000（V1.1 可用）。
- **结论**：以执行说明书 **500 条**为当前目标（V0 上限内，也是 Demo 验收线）；**不追求 5000-10000**（需新增大量语料与抽取成本，留待 V1 扩量）。
- **影响**：当前 153 条 → 500 条需续跑抽取约 230 条。现有 19 文本抽样（开头3+结尾2）约 74 章/153 条，扩量方式＝提高 `SAMPLE_CHAPTERS`（如 8-10）再跑 `extract → embed → ingest`（幂等，断点复用）；成本约 +150-200 次 DeepSeek 调用（可控、可断点续跑）。

## 决策 2 · 游戏侧 /api/narrative/* 接入范围

- **依据（文档既有结论）**：
  - `docs/Narrative_KB_开发执行说明书.md` §11 定义两个端点契约：
    - `POST /api/narrative/search`：输入 `{event, stage}` → 返回 `{scene_pattern, choice_pattern, emotion_curve}`（查询叙事素材）；
    - `POST /api/narrative/scene`：输入 `{event, characters, relationship}` → 返回 `{scene_structure, dialogue_style, choices}`（生成 Scene 参考）。
  - §14 与主项目连接：**zhihu-hackathon 只调用 Narrative API，不直接访问数据库**；调用链＝World Simulator → SimulationEvent → Narrative KB API → Scene 参考 → Narrative Director → Visual Novel。
  - `docs/AI人生模拟视觉小说RPG_V1.1-V2.0迭代方案.md` §4.8：游戏仓库侧编排端点为 `POST /api/chapter/narrative-plan`（buildNarrativeNeed → retrieveNarrativeEvidence → generateNarrativePlan → validateNarrativePlan），属阶段 3 V1.1 本体。
  - 迭代方案 §11：应用仓库只保留 **schema contract / DTO / query adapter / fixtures / docs**。
- **结论**：
  - **端点契约**：沿用执行说明书 §11 的 `search` / `scene` 两个接口定义（输入输出字段已冻结）。
  - **调用场景**：只在 World Simulator 产出 canonical SimulationEvent 之后、Narrative Director 规划 Scene 之前调用（§14 流程）；不进入游戏热路径结算。
  - **实现方式**：阶段 3 按迭代方案 §11 采用「游戏仓库 `query adapter`（封装 SQLite 检索，等价 search 逻辑）+ `/api/chapter/narrative-plan` 编排」接入；独立 FastAPI 服务化（narrative-kb 侧）列为后续演进，不阻塞阶段 3。
- **影响**：游戏侧新增 `lib/narrative-db/`（query adapter 映射执行说明书 search/scene 输入输出）与 narrative-plan 编排端点；不改 World Simulator 语义；Narrative KB 故障时降级空 bundle 仍可出文（设记 §34 fallback）。

## 决策 3 · VNDB / GitHub 开源 VN 语料：**本期不做，列为后续可扩展项**

- **结论**：不纳入当前实施范围（v0 已含本地小说 + 公版文学；VN 语料缺失可接受，choice/dialogue 模式由本地语料兜底）。
- **后续可扩展项（潜在来源与预期价值）**：
  - **VNDB 开放 API**（api.vndb.org）：类型/主题/人物关系元数据标签，价值＝低成本补齐“VN 元数据语料”，支撑 type/theme 维度的 Scene/Choice 检索；当前环境代理下路由不可达，需先解决网络可达性。
  - **GitHub 开源 Ren'Py 项目**（script.rpy）：真实视觉小说场景/对白/选项结构，价值＝直接学习 dialogue/menu/branch 模式，提升 `choice_pattern`、`dialogue_pattern` 覆盖；需**逐项目甄别 LICENSE**（仅取明确开源许可者）。
  - **DDLC 相关社区素材**：角色关系/日常事件/情绪变化样例；需确认授权状态，默认不可直接入库。
  - 扩量到 5000-10000 条（Pipeline §10）依赖上述 VN 语料补充，属 V1 阶段。

> 说明：本附章为已确认决策记录；如后续文档版本与上述出处冲突，以冻结版执行说明书与迭代方案为准。
