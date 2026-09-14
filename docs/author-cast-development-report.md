# 知乎答主化身开发总报告

- 分支：`codex/zhihu-author-avatar-rag`
- 起始基线：`4c6468a feat: 接入知乎答主化身泠泠与证据检索`
- 本轮提交：`bc1bfc4` → `95d3ccc` → `c42f3ce` → `c405886` → `c89bc6c` → `7484d12` → `42dadba`（共 7 个，未 push）
- 变更规模：相对基线 42 个文件（28 新增 / 14 修改），+2894 / -142
- 测试：`npm test` 108 通过 / 0 失败；`npx tsc --noEmit`、`npm run build`、`npm run validate:life-events`、`node --check` 全部通过
- 语料：`.data/author-avatars/MarryMea` 7 个批次、40 条回答、266 KB（gitignore，未提交）
- 试玩：本地 `LAMPLIGHT_PLAYTEST=1` 免登录模式已可完整游玩

---

## 1. 总体目标与结果

把「预设 NPC 的答主绑定属性」升级为「知乎答主独立可选角色」，并接入本地 RAG 聊天、有效互动好感度、离线采集与补料 Agent。

| 目标 | 结果 |
| --- | --- |
| 知乎答主作为独立可选角色 | 完成，注册表 `lib/author-cast.ts`，角色 ID `ling` |
| 允许可见剧情使用虚构角色「林泠」 | 完成，用户可见处只用林泠 + 虚构声明；`zhao-ling` 仅内部兼容 ID |
| 与预设 NPC 混合选择，总数 4 | 完成，默认「林泠 + 顾言川 / 沈屿 / 陶晚晴」 |
| 进入共同篇 / 个人线 / romance / friendship / 结局 | 完成，统一 `CastMember` 链路 |
| 选人页双 Tab，答主默认且更醒目 | 完成，含领域、虚构声明、资料与风格状态 |
| 剧情外聊天使用本地 RAG Agent | 完成，有界工具循环 + 引用白名单 + 来源由程序生成 |
| 聊天成功增加有限好感度 | 完成，每局每角色上限 +10，exchangeId 防重复 |
| 运行时禁止访问知乎内容接口 | 完成，答主 RAG 运行时只读 `.data`；OAuth 登录流程如启用仍会访问知乎 OAuth/API 端点 |
| 离线采集与补料 Agent | 完成，含新账号格式兼容与会员主页内搜索 |

---

## 2. 分阶段交付

### 阶段 0：架构地基

- **统一角色模型**：新增 `SelectableCharacter`（`kind: preset-npc | zhihu-author`）与 `resolveSelectableCharacter` / `selectableCharacters` / `authorSelectableCharacters`；预设池仍为 8 人，不扩池；`canonicalProfiles`、`selectedCast`、`promptText`、`publicState` 全部输出统一结构。
- **林泠契约**：`lib/author-cast.ts` 内含 `castId=ling`、显示名林泠、性别女、领域（生物 / 科研方法论 / 职业规划）、`personaStatus=fictional`、`corpusStatus=evidence-only`、`styleStatus=unreviewed`、`authorAvatarId=zhao-ling`、四套人生背景的 `age/identity` 以及完整 `voice/desire/object/route_event/payoff`。
- **兼容策略**：旧存档里的预设 NPC + `authorAvatarId:'zhao-ling'` 仍可读取；`State v2` 新增可选字段 `worldState.authorChatGains`、`worldState.processedChatExchangeIds`，缺失按空处理；`lib/ui-story.ts` 的存档校验同步兼容。
- **m4 陆沉改线**：`story-public.json` 公开身份改「科技媒体编辑」，四套背景改为校刊编辑 / 校园媒体编辑 / 科普期刊编辑助理 / 科技媒体编辑，`story-config.json` 的 `object`、`route_event` 从“回答”改为“报道/稿件”。
- **统一状态更新**：新增 `lib/state-lock.ts`（per-story 互斥队列 + `updateState` + exchangeId 去重，`processedChatExchangeIds` 上限 500）；`lib/storage.ts` 暴露 `updateState` 与 `acquireStoryLock`；剧情生成与聊天好感度共用同一把锁。
- **测试**：混合选人可建 State、ID 去重、未知角色 / 性别不匹配拒绝、林泠可作共同篇 target、可锁定路线、同性 friendship / 异性 romance、`publicState` 不泄露真实作者信息、旧存档可读、并发不覆盖、相同 exchangeId 不重复结算、结局判定一致、聊天增益进入下一次剧情 prompt。

### 阶段 1：选人页双 Tab

- `GET /api/story` 新增 `authors`：`id/name/kind/gender/age/identity/domains/personaStatus/corpusStatus/corpusCount/styleStatus/disclosure/selectable`，不含本地路径、Cookie、Token、真实作者私密信息。
- 选人页新增「知乎答主 | 预设 NPC」Tab，答主 Tab 默认选中、卡片更大且高亮，显示林泠 / 知乎答主角标 / 虚构声明 / 领域 / `资料 N 条` / `风格校准中`；已选数量实时显示；切 Tab 不清空已选；答主与预设可任意混选。
- 下线新游戏的 `zhihuHandle` 输入与答主化身下拉；`CharacterProfile` 旧字段保留供旧存档读取。
- 新增统一占位立绘 `CharacterPortrait`：舞台、聊天头像、存档预览共用；无 webp 时不再请求错误路径，保留占位尺寸、pose、speaking、移动端布局；`app/globals.css` 新增对应样式。
- 标题页入口更名「与林泠聊聊 · 资料试验」；聊天文案统一「基于知乎公开内容改编的虚构 AI 角色」。

### 阶段 2：本地 RAG Agent

- `lib/author-tools.ts`：严格工具契约 `search_corpus` / `read_answer` / `finish`，参数 Zod 校验、结果 JSON 字符串、`read_answer` 仅能读取本轮检索到的 answerId、`finish` 引用白名单、正文禁止 URL、跨作者不可读取；工具调用总数上限 2，`finish` 不受限额影响。
- `lib/author-agent.ts`：应用控制的有界循环（最多 6 轮）；全链路 `message.content` 为字符串；输入 UTF-8 字节上限 6000；空命中允许一次改写，两次无命中直接返回 `no-match` 文案且不再调用模型；区分 `INVALID_MODEL_REPLY`、`TOOL_BUDGET_EXCEEDED`、`CITATION_OUT_OF_RANGE`、`MODEL_TIMEOUT`、`EVIDENCE_TOO_LARGE` 等状态。
- `lib/author-corpus.ts`：扫描作者目录全部 `batch-XXX`，逐 manifest 校验、逐回答校验 SHA-256；区分数码缺失 / 清单损坏 / 哈希不匹配 / 超限；兼容 Windows CRLF 与 LF 的同内容哈希。
- 多批次测试：合并顺序、跨批去重、损坏清单、篡改哈希、缺失目录、记录上限。

### 阶段 3：聊天好感度

- `/api/chat` 新增 `exchangeId`（UUID）；剧情内答主聊天通过 `updateState` 结算：`matched` 且有引用 +2、`matched` 无引用 +1、`no-match` 0；每位答主每局封顶 +10；返回 `affinity {id, delta, total}`。
- 客户端弹 `♥ +N`；服务端为准；标题页资料试验、体验模式、普通 NPC 聊天不结算。
- 并发测试：剧情生成读写与聊天读写交错时 `nodes / selections / memory / relationshipType / relationships / authorChatGains` 均不丢失；重复 exchangeId 不重复加分。
- 阈值联动：`relationships` 值进入下一次剧情 prompt（`ling(林泠)=N`），并驱动 disclosure 文案。

### 阶段 4：离线采集与补料 Agent

- `scripts/collect-author-answers.mjs`：`--mode latest|top|search`、`--limit`、`--batch-size≤30`、`--delay-ms` 限速、`--dry-run`；统一 `ZHURL_BIN`；401/403/风控立即停止且不写盘；staging 目录原子写批；增量跳过已有 answerId；SHA-256 + manifest + `collection{method,query,sort,collectedAt,completeness}`；完整性标记 `fetched_api_content_unverified` 并注明未与在线网页比对。
- `scripts/collect-author-gaps.mjs`：主题缺口分析（14 个主题）→ 查询规划 → 会员主页内搜索 → 详情校验 → 原子写批 → `gap-report.json`（仅 metadata）；单次上限 30 条 / 5 查询。
- `scripts/lib/author-plan.mjs`：模型辅助查询改写（严格 JSON 契约、话题白名单、URL/路径字符拦截、代码围栏与夹带文本兼容），失败自动回退确定性查询。
- `scripts/lib/zhurl-compat.mjs`：兼容知乎++新版 `{activeAccountId, accounts[]}` 账号格式，生成临时 HOME 供 zhurl 读取并即时清理，不改动用户凭证文件；同时解决 zhurl 在 Windows 需要 `HOME` 的问题。
- 会员主页内搜索：使用 `restricted_scene=member` + `member_hash_id`，替代全站搜索过滤（后者命中率为 0）。
- mock 端到端测试：伪造 zhurl 跑两个 CLI，断言批次与哈希可被运行时 loader 读取、认证失败不写盘、dry-run 零网络。

### 阶段 5：风格卡契约

- `lib/author-style.ts`：风格卡版本化 schema；`draft` 强制中性语气；`reviewed` 必须有 `reviewedAt`，且每条观察至少由 2 篇不同回答支持；只有 `reviewed` 才把风格片段注入系统提示。
- 说明：语料已满足起草条件（40 条），但风格卡需要人工审核后才能启用，本轮未生成正式风格卡与评估集。

---

## 3. 语料与数据

| 项 | 值 |
| --- | --- |
| 目录 | `.data/author-avatars/MarryMea`（已 gitignore） |
| 批次 | batch-001 ~ batch-007 |
| 记录 | 40 条 |
| 体积 | 266,172 字节 |
| 来源 | 1 条历史数据库快照 + 30 条接口采集（top-voteups / 会员主页内搜索）+ 8 条模型规划补料 |
| 跳过 | 2 条（正文过短、付费/过滤） |
| 校验 | 通过结构校验、作者 token 校验、SHA-256 哈希校验与来源 URL 校验（`loadAuthorCorpus`）；与“在线网页逐项比对”“人工审核”是不同层级，不能合并成“全部验证通过” |
| 主题覆盖 | 14 / 14 达到 ≥2 篇，缺口清零 |
| 完整性 | `fetched_api_content_unverified`：仅表示拿到了接口 content，未与在线网页逐项比对，也未经人工审核 |

---

## 4. 验证证据

- `npm test`：108 通过 / 0 失败（含 12 个测试文件，覆盖角色、协议、状态锁、RAG 工具与 Agent、检索、风格卡、采集与兼容）
- `npx tsc --noEmit`：通过
- `npm run build`：通过（Next.js 16.3.4 + TypeScript）
- `npm run validate:life-events`：10 个知乎依据事件 / 30 个选项
- `node --check`：两个采集脚本与共享核心通过
- mock 端到端：写批/哈希/认证失败/gap dry-run 四项
- 真实模型端到端（`deepseek-v4.1-flash` via OpenCode）：
  - 「研究生和导师的关系怎么处理？」→ `matched`，引用 2 条原回答，主动说明资料局限
  - 「高中分科应该怎么选？」→ 两次检索后 `no-match`，不编造
- 真实生成链路：以「林泠 + 3 预设」开局，8 秒生成 12 句、4 个选项，林泠与四位角色均有台词
- 浏览器验收（无头 Edge）：本地试玩模式标题、双 Tab、默认 4/4、林泠卡状态、存档预览占位立绘均正常

---

## 5. 运行手册

```powershell
# 启动开发服务（自动加载 .env）
npm run dev            # http://127.0.0.1:3000

# 测试与构建
npm test
npm run validate:life-events
npm run build

# 确定性采集（需 zhurl 与知乎++ 登录）
$env:ZHURL_BIN="$env:USERPROFILE\.cargo\bin\zhurl.exe"
node scripts/collect-author-answers.mjs --mode top --limit 10
node scripts/collect-author-answers.mjs --mode latest --limit 10
node scripts/collect-author-answers.mjs --mode search --query "转专业" --limit 10

# 缺口补料（模型规划，失败自动回退确定性查询）
node scripts/collect-author-gaps.mjs --dry-run
node scripts/collect-author-gaps.mjs --limit 30 --max-queries 5
```

`.env` 关键项：

```text
MODEL_PROVIDER=opencode
OPENCODE_API_KEY=<key>
OPENCODE_ENDPOINT=https://opencode.ai/zen/go/v1/chat/completions
OPENCODE_MODEL=deepseek-v4.1-flash
LAMPLIGHT_PLAYTEST=1          # 仅本地开发免登录；生产构建自动失效
ZHIHU_OAUTH_APP_ID=460
ZHIHU_OAUTH_APP_KEY=
ZHIHU_OAUTH_REDIRECT_URI=http://127.0.0.1:3000/auth/callback
```

---

## 6. 偏差与设计取舍

1. **好感度计分口径**：`no-match` 计 0；`matched` 无引用 +1、有引用 +2。避免奖励“资料不足”回复。
2. **检索策略**：中文二元组为 baseline；新增段落级最小命中数（1 词 → 1，2–8 词 → 2，9+ 词 → 3），修复「量子引力」误引「10 块钱」一类假阳性；`no-match` 优于错误引用。语义漏召回稳定出现后再评估向量方案。
3. **模型辅助规划**：按需求启用模型改写查询，但仍由程序控制上限、白名单与回退，模型不能生成 URL 或文件路径。
4. **锁模型**：进程内 per-story 队列，符合当前单实例部署；多实例部署需改为文件/数据库锁。
5. **CRLF 兼容**：旧语料文件为 CRLF 而 manifest 按 LF 哈希，加载器按同内容归一化，避免历史资产被误判损坏。
6. **本地试玩开关**：`LAMPLIGHT_PLAYTEST=1` 仅在非 production 生效，属于阶段外补充，用于本机验收，不影响线上认证。

---

## 7. 遗留问题与风险

- **真实知乎 OAuth 未接通**：仓库历史中的 OAuth 配置为测试占位（`app_id=1`、`sk-` 开头的模型密钥）；官方黑客松文档说明 App ID / App Key 由赛事页面分配且禁止写入 `.env`/源码。需要赛事页面登记 `http://127.0.0.1:3000/auth/callback` 并填入真实 App Key。
- **数据库可选未配置**：`LAMPLIGHT_DATABASE_URL` 缺失时事件记录自动跳过，不影响游玩；需要复盘统计时再配置。
- **风格卡与评估未完成**：需人工审核；建议先按开发集 / 保留集划分，每项观察 ≥2 篇佐证再启用风格化 prompt。
- **语料边界**：40 条覆盖 14 个主题，但个别主题（高中、情感）素材较少，补料查询词可继续迭代。
- **git 远端不可达**：本机 git 配置了未运行的 `127.0.0.1:443` 代理，无法 fetch/push；如需同步远端需先修复代理。
- **Git 工作区**：仍保留原有未跟踪目录（`localdata/`、`narrative-kb/`、`.superpowers/`、`.workbuddy/`、`docs/superpowers/`、`zhihu-cli-skill-*`、`知乎 Galgame设计/`），未纳入提交。

---

## 8. 验收清单对照

- [x] 新开局可选「林泠 + 3 预设」并完整跑到结局（共同篇 4 target、结局判定已测）
- [x] `SelectableCharacter → canonicalProfiles → selectedCast → generator → publicState → chat` 全链路统一对象
- [x] 选人页双 Tab、答主默认高亮、状态信息正确；旧存档读出后不报错
- [x] 剧情内与林泠聊天走 RAG，返回来源卡；普通角色聊天不变
- [x] 好感度 +0~2、每局封顶 +10、存档读档一致、`♥ +N` 提示
- [x] 重复 chat exchange 不重复加分；聊天与剧情生成并发不丢数据
- [x] m4 在四套背景与公开投影中不再出现「知乎答主」身份
- [x] 采集器支持最新 / 最热 / 主页搜索三种方式与增量同步、限速、失败即停不写盘
- [x] Chat Completions 每层 `message.content` 均为字符串
- [x] 引用仅来自本轮检索证据；伪造引用、伪造 URL、跨作者证据均被拦截
- [x] 答主 RAG 运行时不访问知乎内容接口（代码检查：运行时模块无 child_process/zhurl，唯一网络调用是模型端点；OAuth 登录流程如启用仍会访问知乎 OAuth/API 端点）
- [x] `npm test`、`npm run validate:life-events`、`npm run build` 通过
- [ ] 正式立绘（当前为统一占位）
- [ ] 真实知乎 OAuth 登录（本地试玩替代）

---

## 9. 安全与合规

- 未提交任何 Cookie、Access Secret、API Key 或真实语料；`.env`、`.data`、本地资料目录均在 gitignore 内
- 采集脚本不打印凭证；zhurl 兼容层使用临时 HOME 并在每次调用后清理，不修改用户凭证文件
- 答主 RAG 运行时不访问知乎内容接口；OAuth 登录流程如果启用，仍然会访问知乎 OAuth/API 端点；联网采集仅存在于离线脚本
- 林泠为虚构角色，用户可见处标注「基于知乎公开内容改编的虚构 AI 角色」；回复只引用可追溯公开回答，不编造作者经历或私人关系

---

## 10. 提交记录

| 提交 | 说明 |
| --- | --- |
| `bc1bfc4` | 知乎答主独立成角色并接入本地 RAG 有界工具循环 |
| `95d3ccc` | 新增离线补料 agent 与共享采集核心 |
| `c42f3ce` | 补料 agent 支持读取 `.env` 的模型凭证 |
| `c405886` | zhurl 新版账号格式兼容与会员主页内搜索补料 |
| `c89bc6c` | 检索精度阈值避免弱词汇重叠误引用 |
| `7484d12` | 作者聊天与补料规划支持 OpenCode 凭证回退 |
| `42dadba` | 本地开发免登录试玩开关 |

## 11. 修复轮记录（2026-09-14）

本轮范围是修复与验收，不重新开发功能。修复项：

1. **剧情生成与聊天的真实并发边界（方案 A）**：`/api/chat` 在 `busy.has(storyId)` 时对剧情内答主聊天返回 `409 STORY_GENERATION_IN_PROGRESS`，不调用模型、不结算好感度、不写 state；普通 NPC 聊天的只读路径不被阻断；标题页资料试验不受影响。判定逻辑集中在 `lib/chat-request.ts`，路由只做接线。
2. **exchangeId 预检**：模型调用之前先检查 `worldState.processedChatExchangeIds`；命中重复时直接返回 `{duplicate:true, affinity:{delta:0,total}}`，不再调用模型。第二次结算仍由 `updateLockedState` 兜底。
3. **真实文件存储并发测试**：新增 `lib/state-store.ts`（参数化真实 fs 存储），`lib/state-lock.ts` 的互斥逻辑在真实文件上验证，覆盖 `nodes / selections / memory / route / relationshipType / relationships / authorChatGains` 不丢失、两种串行顺序、500 条 exchangeId 上限、重复 exchangeId 只结算一次。
4. **林泠立绘复用**：新增 `lib/portraits.ts` 集中映射 `ling → f2`（女性预设立绘），五种 pose 全部映射；舞台、聊天头像、存档预览共用 `resolvePortrait`；不再存在 `assetFor` 或第二套映射；未来替换正式立绘只改该文件。
5. **有效互动奖励语义**：好感度机制统一表述为“有效互动奖励”，聊天面板标注“每局每位答主上限 +10”；客户端不能提交 delta/total（请求 schema 为 strict）。
6. **边界测试**：运行时作者模块无 `child_process`/`zhurl`，唯一网络调用是作者聊天的模型端点；工具预算固定为 2 次工具调用 / 6 个模型 turn，`finish` 不占预算。
7. **措辞修正**：报告中“运行时无任何知乎网络请求”改为“答主 RAG 运行时不访问知乎内容接口；OAuth 登录流程如果启用仍可能访问知乎 OAuth/API 端点”；语料校验明确拆分为结构 / 作者 token / 哈希 / 来源 URL 校验，与在线比对、人工审核分层；采集器的模型只规划 query，不生成语料正文。

## 12. 同步 main 与开发模式完善（2026-09-14）

1. **合并最新 main**（`18a6fb9`）：解决 5 处冲突，保留林泠答主 / 双 Tab / 立绘复用 / RAG / 好感度 / 开发模式，同时吸收 main 的表情标记（`（happy）` 等）、选人重置与显式确认、模型配置统一（`lib/model-config.ts`）、OAuth canonical origin 与新脚本；`lib/model-credentials.ts` 由 main 的 `model-config` 取代并删除。
2. **恢复默认选人**：合并后 main 的显式选人会把选择清空，已在 `openSetup` 中改为“保留仍有效的 4 人，否则回退默认林泠 + 3 预设”，保证产品要求的默认值。
3. **开发模式完善**：主开关改为 `LAMPLIGHT_DEV_MODE`（兼容 `LAMPLIGHT_PLAYTEST`），生产环境强制失效；首次启用写服务端告警；`/api/auth/me` 同时返回 `developmentMode` 与 `playtest`；标题页显示“开发模式：本地免登录，仅用于开发验收”。
4. **验证**：`npm test` 132 通过 / 0 失败；`npx tsc --noEmit`、`npm run build`、`npm run validate:life-events`、两个采集脚本 `node --check` 通过；真实生成冒烟（林泠 + 3 预设）5 秒 11 句 4 选项；无头浏览器检查默认 4/4、Tab 默认答主、序号标记与开发模式文案。
5. **远程**：`origin/codex/zhihu-author-avatar-rag` 为 `e46b1ed`；`origin/main` 已按用户要求回退到合并前的 `18a6fb9`（撤回本次 main 合并，功能全部保留在功能分支上）。
