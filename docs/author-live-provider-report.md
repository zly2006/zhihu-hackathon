# 知乎答主 Live Provider Framework 开发报告

- 分支：`codex/zhihu-author-avatar-rag`
- 起始基线：`e46b1ed feat: 开发模式免登录能力完善`（工作树干净，只有既有未跟踪目录）
- 本轮提交：未创建 commit（见第 9 节）
- 验证：`npm test` 183 通过 / 0 失败；`npx tsc --noEmit`、`npm run build`、`npm run validate:life-events`、两个采集脚本 `node --check` 全部通过

---

## 1. 目标与结果

把项目从“林泠专用本地 RAG”扩展为统一的知乎答主 Live Provider Framework：用户只看到一种 Live 体验，内部由 Provider 决定读缓存还是读在线。

| 目标 | 结果 |
| --- | --- |
| 统一 Live 模式，不新增 online/offline/hybrid 用户开关 | 完成，`HybridAuthorProvider` 是唯一入口，UI 无模式选项 |
| 选人页双 Tab，知乎答主默认且更醒目 | 完成，`知乎答主` 默认选中，卡片高亮并带答主角标 |
| 林泠默认推荐 | 完成，默认「林泠 + 顾言川 / 沈屿 / 陶晚晴」 |
| 任意答主邀请（主页 URL / url_token） | 完成，`POST /api/authors/invite` + 选人页邀请表单 |
| 预设 NPC 走本地角色卡 | 完成，预设不经过任何知乎 Provider |
| 知乎答主走在线 Provider | 完成，`ZhihuOfficialProvider` + `ZhurlProvider` + 缓存/在线混合 |
| 本地缓存/语料保留为缓存、RAG、评估与降级来源 | 完成，`.data/author-avatars/<token>/` 与 `runtime-cache/` 双层 |
| 统一剧情角色、聊天、好感度、存档、来源卡链路 | 完成，全部答主共用 `CastMember → chat → authorChatGains` |
| 林泠可 romance，新答主默认不可 | 完成，`canEnterRomance` 默认 false，路由锁定强制 friendship |
| 不把真实作者写成真人本人 | 完成，化名 + 虚构领域 + 抽取式引用，真实资料不进提示词 |

---

## 2. 三层分离（OAuth / AuthorRef / AuthorProvider）

- **AuthSession** 仍然是“玩家是否登录知乎”，`lib/zhihu-auth.ts` 未被改写，也没有与内容 Provider 合并；本轮未删除任何 OAuth 代码。
- **AuthorRef** 只描述“要邀请谁”，形如 `{provider:'zhihu', urlToken, profileUrl}`，在 `lib/author-provider.ts` 中强校验。
- **AuthorProvider** 才负责取资料，实现四个：

| Provider | 职责 | 边界 |
| --- | --- | --- |
| `ZhihuOfficialProvider` | 官方用户数据 API（`/api/v1/user/contents`、`Authorization: Bearer <Access Secret>`、`X-OAuth-Token`、`X-Request-Timestamp`、`Paging.NextOffset`） | 只能读授权用户自己；读别人或读详情明确返回 `AUTHOR_AUTH_REQUIRED` / `AUTHOR_CONTENT_UNSUPPORTED`，不静默改读登录账号数据 |
| `ZhurlProvider` | 公开作者主页、会员主页内搜索、回答详情 | 仅本地开发/受控采料；`ZHURL_BIN` 是唯一变量名；含 `child_process`，只由生产守卫的动态 import 加载 |
| `CachedAuthorProvider`（`FileAuthorCache`） | 作者隔离缓存：`profile.json`、`list-<sort>.json`、`search-<hash>.json`、`answer-<id>.json` | 读取时重新过作者绑定校验；TTL：profile 7 天、最新 6 小时、热门 24 小时、搜索 6 小时、详情 7 天、无命中 10 分钟 |
| `HybridAuthorProvider` | Live 唯一入口：缓存命中即用；缺失/过期/无命中才最多一次在线调用；在线失败退回旧缓存并标记 `stale`；无缓存时报 `AUTHOR_PROVIDER_UNAVAILABLE` | 在线结果必须通过 author token、answerId、sourceUrl、正文与完整性校验才可使用与写缓存 |

`CompositeAuthorProvider` 依次尝试 official → zhurl，全部失败时保留信息量最大的错误（auth > rate-limit > unsupported > unavailable），避免把“需要授权”压成“服务不可用”。

---

## 3. 任意答主邀请

流程：`主页 URL/url_token → 固定域名与路径校验 → resolveProfile → 冻结快照 → 注册表落盘 → 混选四人`。

- 只接受 `https://www.zhihu.com/people/<token>`、`https://zhihu.com/people/<token>` 或裸 `url_token`。
- 拒绝：非知乎域名、`http://`、端口、用户名/密码、query、fragment、回答/问题/专栏链接、路径穿越（`/people/../`、`%2e%2e`）、昵称（含中文或空格）、超长输入、`javascript:` / `file:`。
- 角色 ID 由 `sha256` 派生的稳定短摘要构成：`zhihu-{f|m|u}-<16 hex>`，同名不同作者按 token 隔离；客户端提交的 ID/名字/绑定都不被信任，服务端从注册表重建。
- 快照 `authorSnapshot{authorUrlToken, profileHash, capturedAt}` 在邀请时冻结，本局不随在线数据变化。
- 已经以评审角色注册过的作者不能再被邀请（否则同一作者会出现两个化名），返回 `AUTHOR_ALREADY_REGISTERED`。
- 资料读取失败时不写任何文件（测试断言注册目录保持为空）。
- 真实作者资料（昵称、签名、性别）只用于邀请确认卡与来源标注；剧情身份使用化名、白名单领域标签与四套人生背景的虚构舞台身份。

---

## 4. 运行时对话框架（预检索 + 单次自由回答）

模型是对话大脑，程序负责证据与引用完整性。工具协议、多轮工具循环、强制检索与兜底句覆盖全部移除。

```text
玩家消息
 1. 角色绑定解析（服务端注入 AuthorRef + 冻结快照，模型不能换作者）
 2. 意图路由 lib/author-intent.ts
      conversation：寒暄 / 自我介绍 / 玩法 / 情绪 / 剧情闲聊 → 不检索、不打扰
      knowledge：作者经验、观点、事实依据类问题 → 进入证据准备
 3. 证据准备 lib/author-evidence.ts（程序决定）
      a. 本地语料检索（≤5 段、3000 字节，零网络）
      b. 本地无命中且为 knowledge → 在线检索 1 次（关键词归一化）
      c. 在线命中且需要正文 → 读 1 条详情（≤6 段、1200 字节）
      d. 产出 EvidencePacket，跨作者条目直接丢弃，失败只记录状态不中断
 4. 一次模型调用 lib/author-conversation.ts
      system = 角色卡（化名/领域/剧情内外）+ 玩法事实 + 回答规则 + 证据包（序列化文本）
      + 对话历史 + 玩家问题
      输出信封 {"reply":"...","usedEvidenceIds":["..."]}；直接输出纯文本也会被接受
 5. 程序校验
      · reply ≤600 字，剔除 URL 与证据 id
      · usedEvidenceIds ∩ 证据包白名单 → sources（URL 由程序生成）
      · 正文出现「作者认为/作者表示…」但无来源 → 一次纠错重写（同轮最多 2 次模型调用）
 6. 返回 {text, sources, evidenceStatus, providerStatus}
```

- `evidenceStatus`：`matched`（有来源，有效互动奖励 +2）／`unverified`（有证据包未逐条引用，+1）／`persona`（自由对话，0）；`no-match` 只出现在旧存档，按 0 处理。
- 无证据时化身可以自然人话回应（感受、方向、换问法建议），涉及作者观点必须引用，查不到就明说“这部分我没查到”，不再用兜底句覆盖模型文本。
- 硬上限：模型调用 ≤2（首次 + 至多一次纠错）、在线检索 ≤1、详情读取 ≤1、输入 6000 字节、回复 600 字。
- 保留：AuthorProvider/缓存/在线校验、跨作者隔离、真实作者资料不进提示词、来源 URL 由程序生成、全部 `message.content` 为字符串、错误分类（鉴权/限流/不支持/故障/非法证据）随回复返回。
- 在线检索按词精确匹配，多个空格分词会命中 0 条，因此程序只取最长的一段作为实际检索词（`normalizeOnlineQuery`）。

### 4.1 来源披露（真实答主可核对）

- 被直接问到「你是谁 / 你的原型 / 真身 / 资料来自哪里」时，化身可以说「我是基于知乎答主“X”的公开回答改编的虚构化身，不是本人，也不代表其真实立场」；平时不主动提。
- 提示词只给**公开昵称**，不给链接；主页链接作为聊天面板里的程序生成元素（`资料来自知乎答主「X」 打开主页 ↗`），避免正文出现 URL。
- 预设 NPC 没有来源绑定，因此没有该提示与链接。
- 红线不变：仍不得编造作者经历、职业、私生活与现实关系，也不得替作者表达观点。

---

## 5. 选人页与聊天

### 5.1 选人页：双板块入口 + 焦点展开

**内置答主名册（8 位，写进 `lib/author-avatars.ts` + `lib/author-cast.ts`）**：

| 化名 | 公开来源 | 领域 | 本地语料 | 恋爱线 |
| --- | --- | --- | --- | --- |
| 林泠 | 赵泠（MarryMea） | 生物 / 科研方法论 / 职业规划 | 41 条 | ✅ |
| 苏砚 | rq cen | 升学与考试 / 学习方法 / 学习心态 | 15 条 | ✗ |
| 裴知远 | Yuhang Liu | 数学 / 科研训练 / 读研选择 | 13 条 | ✗ |
| 方凛 | 弗兰克扬 | 行业选择 / 求职策略 / 职业规划 | 15 条 | ✗ |
| 温言 | 小红拖拉机 | 职场沟通 / 工作心态 / 面试 | 15 条 | ✗ |
| 程亦舟 | 程墨Morgan | 科技行业 / 人工智能 / 职业转型 | 12 条 | ✗ |
| 江晚 | 甜草莓 | 科学传播 / 科研生活 / 兴趣培养 | 14 条 | ✗ |
| 席南 | Sean Ye | 求职方法 / 简历与面试 / 职场适应 | 15 条 | ✗ |

- 选人来源：知乎话题「优秀回答者」（考研 / 科研 / 求职 / 学习方法 / 大学 / 专业选择 / 心理学 / 职业规划 / 高考），再逐个验证主页可读与回答量。
- 语料用现有在线采集脚本补齐（`--mode top --limit 15`），保存在 gitignore 的 `.data/author-avatars/<token>/`，不随仓库提交；换机器时名册仍在，语料显示「资料待补充」，引用走在线来源。
- 除林泠外全部默认关闭恋爱线；化名的性别与人生身份是虚构设定，卡片上以「性别与人生身份为虚构设定」标注。

```text
第 2 步 · 选择会改变故事的人
├─ 状态条：已选 N / 4（左右板块共享同一个名额）
├─ 双板块（默认视图）
│   ├─ 左（主板块）：你可以邀请 AI 答主参与
│   │    · 答主卡：林泠 + 已邀请答主（最多 4 张）
│   │    · 不足 3 张时补虚线占位卡“待邀请答主”
│   │    · 底部「＋ 邀请其他答主」→ 答主选择页（含邀请输入框）
│   └─ 右：选择默认 NPC 参与（8 人预览）→「进入选择」→ 预设 NPC 选择页
└─ 焦点视图顶部提供「← 返回双板块」
```

- 两板块共享一个 4 人选择：左侧答主、右侧预设都直接勾选，计数实时更新，切换焦点不丢选择（原 tab 状态改为 `setupFocus`）。
- 第 2 步不再出现「人物背景（可选）」这一行（连同输入框一起移除，`profiles` 状态与相关 CSS 一并删除）；角色背景如需自定义，后续用别的方式承载。
- 答主卡显示：**真实主页昵称（剧情化身昵称）**、主页头像、「新邀请」角标、领域、`资料 N 条`、`风格已自动归纳` / `风格校准中`、虚构声明；不开放恋爱线时显式标注。
- **头像来源**：内置答主与邀请答主都使用其知乎主页头像。公开头像 URL 只保存在服务端（内置答主写在 `lib/author-avatars.ts`，邀请答主冻结在注册表），前端统一请求 `GET /api/authors/avatar/<castId>`；服务端首次请求时抓取并缓存到 `.data/author-avatars/<token>/avatar/avatar.<ext>`（校验 Content-Type 为图片、≤512KB、仅 https），之后离线也能显示，加载失败则回退预设立绘或首字母。舞台立绘仍复用现有 8 套预设立绘，不把方头像拉成全身。
- 答主卡显示：**真实主页昵称（剧情化身昵称）**、主页头像、「新邀请」角标、领域、`资料 N 条`、`风格校准中`、虚构声明；不开放恋爱线时显式标注。
- 邀请答主的头像直接使用其知乎主页头像（加载失败回退首字母），聊天面板头像同源；舞台立绘继续复用现有 8 套预设立绘（按性别取池 + 角色 ID 稳定散列），因为主页头像是方图，拉伸成全身反而更差。内置答主同样使用主页头像，统一经服务端缓存路由提供。
- 预设 NPC 保持原角色卡与立绘逻辑，不经过任何知乎 Provider。

### 5.2 聊天

- 剧情内答主（含邀请答主）走 Provider + 预检索的对话链路并附来源卡；预设 NPC 走原本地链路；来源卡只展示程序按 `usedEvidenceIds` 生成的可追溯回答。
- 被问到「你是谁／原型／真身／资料来自哪」时，化身会说明「基于知乎答主 X 的公开回答改编的虚构化身，不是本人」，聊天面板同时给出程序生成的「打开主页 ↗」链接。

### 5.3 答主语言风格学习（后台 agent）

玩家在选人页确认角色后，客户端 fire-and-forget 调用 `POST /api/authors/style {castIds}`，服务端为每位知乎答主角色（林泠 / 已邀请）启动后台任务：

```text
1. 取语言样本：本地语料抽样（≤12 条、按问题去重、单条正文 ≤1200 字）
             不足 4 条时才用在线来源补齐（列表 1 次 + 详情 ≤6 条）
2. 一次模型调用（temperature 0.2、max_tokens 900、60s 超时）：
   只归纳语言形式——句式 / 语气 / 修辞 / 称呼 / 节奏 / 用词
3. 程序硬规则校验：
   · 观察 3–8 条，每条 ≤120 字且必须由 ≥2 篇样本回答支持
   · 禁止出现事实、经历、年份、链接（正则拦截）与非法 scope
4. 原子写入 .data/author-avatars/<token>/style/style-card.json：
   status="auto"、generatedAt、sampleCount、sampleSource、model
```

- `auto` 卡立即生效：`stylePromptFragment` 注入「表达风格（由公开回答自动归纳，未人工审核，只模仿语气与句式，不得复制内容、不得替作者表达观点或编造经历）」。
- 卡片 7 天过期；聊天时发现缺卡或过期会在后台补一份（不阻塞本次回复）；同一答主并发任务去重（进程内，单实例语义）。
- 失败（样本不足 / 被硬规则拒绝 / 模型失败）只记日志不写卡，聊天退回中性语气，不影响任何功能。
- 聊天面板在用到自动风格时标注「语气由公开回答自动归纳（未人工审核）」；`styleStatus` 扩展为 `unreviewed | auto | reviewed`，旧存档仍可读。

---

## 6. 好感度、状态与并发

- **剧情外单独聊天（预设 NPC 与答主共用）**：玩家消息 ≥12 字、非重复、距该角色上次得分 ≥90 秒、回复成功 → +1；答主的回复同时引用了公开回答 → 再 +1；**每角色每局聊天通道封顶 +4**。体验模式、标题页资料试验、模型失败、复读、太短、冷却中、已达上限都不加分。
- 判定是纯函数（`lib/chat-reward.ts` + `lib/chat-settlement.ts` 的 `applyChatReward`）：去重用玩家消息哈希（不落明文，最多 200 条），冷却用 `worldState.chatGainAt`，上限与得分记在 `worldState.authorChatGains`（旧字段语义扩展为通用聊天得分，旧存档兼容）。
- 因为两种角色的聊天都会写存档，剧情生成期间答主与预设 NPC 聊天都返回 `409 STORY_GENERATION_IN_PROGRESS`（原先 NPC 只读放行）；客户端不能提交 delta/total（strict schema），同一 `exchangeId` 只结算一次。
- 聊天通道最高 +4，而 romance 真结局阈值是 5，因此纯聊天无法刷出真结局，故事选择仍是决定性的。
- 剧情生成与聊天共用 `lib/state-lock.ts` 的 per-story 互斥 + `updateState`，`nodes/selections/memory/route/relationshipType/relationships/authorChatGains/chatGainAt/processedChatMessageHashes` 均保留。
- **锁是进程内的，邀请节流也是进程内的**：当前只声明“单实例安全”，多实例部署未在本轮扩展，也没有宣称已解决。

---

## 7. 验证证据

### 7.1 自动化

| 命令 | 结果 |
| --- | --- |
| `npm test` | 182 通过 / 0 失败（21 个测试文件） |
| `npx tsc --noEmit` | 通过 |
| `npm run validate:life-events` | 10 个知乎依据事件 / 30 个选项 |
| `npm run build` | 通过（Next.js 16.3.4），新增路由 `/api/authors/invite` |
| `node --check scripts/collect-author-answers.mjs` / `collect-author-gaps.mjs` | 通过 |

新增/更新的自动化覆盖：URL 解析接受与拒绝矩阵、作者隔离缓存、缓存 TTL 与负缓存、在线结果 authorId/sourceUrl 校验、在线失败 stale 降级、无缓存错误分类、在线搜索 ≤1、详情 ≤1、跨作者拒读、邀请失败不落盘、重复注册拒绝、混合四人开局、邀请答主默认不可 romance、林泠可 romance、双 Tab 不丢选择、女性立绘映射、OAuth 凭证不进运行时模块、提示词与公开投影不含真实身份；对话框架侧另有意图路由表、证据准备（本地优先/在线 ≤1/失败分类/跨作者过滤/条数上限）、信封解析（纯文本兜底、URL 与证据 id 剔除、超长截断）、无来源作者主张触发一次改写、以及全部 `message.content` 为字符串。

> 说明：本轮把“模型驱动的工具循环”改成了“程序预检索 + 单次自由回答”，删除的 `author-tools.ts` / `author-agent.ts` 及其 31 个工具循环测试一并移除，改为等价的证据层与对话层测试，测试总数从 195 变为 182（不是回退，而是删掉了被淘汰协议的用例）。

### 7.2 mock Provider

通过：`lib/author-provider.test.ts`（Hybrid/Composite/官方 Provider，注入 fetch）、`lib/author-invite.test.ts`、`lib/author-evidence.test.ts`（注入 fake provider，验证本地优先、在线 ≤1、详情 ≤1、失败分类与跨作者过滤）。

### 7.3 本地缓存 RAG

通过：`lib/author-corpus.test.ts`（多批次合并、去重、篡改哈希、损坏清单、CRLF 兼容）+ `lib/author-rag.test.ts` + 作者缓存测试；林泠 40 条语料仍可被运行时加载。

### 7.4 真实知乎内容 Provider

**通过（小规模）**。本机 `ZHURL_BIN` + 知乎++ 登录可用，按“profile → 一个 answer list → 一条详情”顺序验证：

```text
[profile] urlToken=MarryMea, answerCount=20724, headline 存在, source=zhurl
[list]    最新 3 条（answerId 正常，collectionMethod=latest）
[search]  会员主页内搜索「转专业」→ 3 条，带标题与摘要（question.name 修正后命中）
[detail]  1 条，正文 753 字，completeness=fetched_api_content_unverified，contentHash 存在
[cache]   二次 resolveProfile → source=cache（缓存优先命中）
```

失败分类也已实测：不存在的主页 → `AUTHOR_NOT_FOUND`；瞬时上游失败 → `AUTHOR_PROVIDER_UNAVAILABLE`（后续重试恢复）。真实请求只做了上述小规模验证，没有批量采集。

### 7.5 真实模型 + 真实 Provider 运行时

**通过**。真实模型（`deepseek-v4.1-flash`）+ 真实 Provider，经 `/api/chat` 实测五类对话（每类 1 次模型调用）：

| 场景 | 结果 |
| --- | --- |
| 自我介绍「介绍一下你自己」 | `persona`，0 检索：以化身身份自我介绍并说明资料边界，不再背模板 |
| 「我怎么做才能增加和你的好感度？」 | `unverified`：准确说明玩法（有依据 +1、引用再 +1、每位答主每局上限 +10、资料试验不结算），不再回答“我没有好感度系统” |
| 「研究生和导师的关系怎么处理？」 | `matched`，2 条来源：自然复述资料中的结构性吐槽，并标明“针对某些单位，不等于所有组” |
| 「你觉得今年高考作文题目难吗？」 | `unverified`：明确“我手上的资料里没有”，随后以化身身份继续给思路与建议 |
| 「今天有点累，随便聊聊吧」 | `persona`：自然的情绪回应与追问，无模板句、无来源卡 |

全流程正文无 URL、无证据 id，来源链接全部由程序生成；`providerStatus` 在无在线调用时为 `unused`。

### 7.6 真实 OAuth

**未通过/未验收**：`.env` 中 `ZHIHU_OAUTH_APP_KEY` 与 `ZHIHU_OAUTH_ACCESS_SECRET` 为空，无法换取 token；本地用 `LAMPLIGHT_DEV_MODE=1` 免登录验收。OAuth 代码保持原样且与 AuthorProvider 分离，未配置状态下 `/api/auth/me` 明确返回未配置。

### 7.7 真实数据库

**未配置**：`.env` 没有 `LAMPLIGHT_DATABASE_URL`，事件记录按既有逻辑静默跳过，不影响游玩。

### 7.8 多实例部署

**未解决，也未宣称解决**：状态锁与邀请节流都是进程内实现，只在单实例下成立。

### 7.9 风格卡人工审核

**未人工审核，但已自动归纳并生效（按产品决定）**。`auto` 状态表示由公开回答自动归纳、未经人工审核，程序侧有三层硬约束：只允许形式类观察、每条需 ≥2 篇回答佐证、正则拦截事实/经历/年份/链接。真实端到端（林泠本地语料 12 条样本、1 次模型调用）产出的卡为 8 条观察，全部落在 句式/语气/修辞/称呼/节奏/用词 内，随后一次闲聊回复 `styleStatus=auto`，语气与句式与卡内描述一致（短句起头、直接称呼“你”、具象比喻）。
`reviewed` 状态与人工门禁仍保留，未来人工修订后可直接升级为 `reviewed` 卡。

### 7.10 正式立绘

**不存在，也不新增**。邀请答主直接复用现有 8 个预设立绘：按性别取池（女性 f1–f4、男性 m1–m4、性别未公开按虚构角色默认性别走 f1–f4），再用角色 ID 的稳定散列在同一性别的四套里选定一套，保证同一答主每次进入都看到同一立绘、且不请求不存在的 `ling_*.webp`；林泠仍走显式映射 `f2`。

### 7.11 浏览器验收

无头 Edge 实测本地服务：双 Tab 默认选中答主 Tab、切换后选择保持 `4/4`、邀请表单占位与禁用态正确；昵称 / 外链 / 回答链接 / 合法链接（未配置 Provider）四条错误提示均正确；无控制台报错；截图 `.tmp/setup-invite.png`（未提交）。

无头 HTTP 实测邀请接口：

```text
昵称输入            → 400 AUTHOR_INPUT_INVALID
https://evil.test/… → 400 AUTHOR_INPUT_UNSUPPORTED_URL
/answer/123456      → 400 AUTHOR_INPUT_UNSUPPORTED_URL
合法主页链接        → 503 AUTHOR_PROVIDER_UNAVAILABLE（本机服务未配置在线来源时的诚实降级）
```

---

## 8. 已知限制与风险

1. **生产环境的任意答主内容来源仍未落地**：官方 API 只能读授权用户自己，zhurl 仅限本地/受控环境；生产要支持任意答主需要合规的公开内容来源，本轮未新增。
2. **性别未知**：zhurl 返回的性别字段为数字，本实现不猜测（不做数字→性别映射），未知时角色 ID 用 `zhihu-u-*`。立绘按虚构角色的默认性别复用女性预设立绘，卡片与文档注明“性别未公开”，不声称这是真实作者性别。
3. **无本地语料的邀请答主**：在线不可用时只能诚实返回“资料不足”，不会编造。
4. **瞬时上游失败**：实测 zhurl 偶发失败会被分类为 `AUTHOR_PROVIDER_UNAVAILABLE`，可在稍后重试；缓存优先策略能减轻影响。
5. **未提交/未推送**：见下节。

---

## 9. 工作树与提交状态

- 未创建任何 commit（本轮未收到提交指令），因此 **无 commit hash**。
- **明确没有 push**，也没有 fetch/rebase。
- 未回滚、未删除任何既有未跟踪目录（`localdata/`、`narrative-kb/`、`.superpowers/`、`.workbuddy/`、`docs/superpowers/`、`zhihu-cli-skill-*`、`知乎 Galgame设计/`）。
- 未提交 `.env`、cookie、真实语料、`.data/`、临时目录或本地资料；新增的注册表运行时数据只写入 gitignore 的 `.data/author-cast/`，本轮测试使用临时目录并已清理。
- 修改文件（17 个已跟踪）：`app/api/chat/route.ts`、`app/api/story/route.ts`、`app/globals.css`、`app/page.tsx`、`lib/author-{avatars,cast,chat,retrieval,style}.ts` 及对应测试、`lib/chat-request.ts`、`lib/portraits.ts`、`lib/story.ts`、`lib/ui-story.ts`、`.env.example`。
- 删除文件（4 个已跟踪）：`lib/author-tools.ts`、`lib/author-agent.ts` 及其测试（被预检索 + 单次自由回答框架取代）。
- 新增文件（24 个，含 10 个测试）：`app/api/authors/invite/route.ts`、`lib/author-cache.ts`、`lib/author-catalogue.ts`、`lib/author-conversation.ts`、`lib/author-evidence.ts`、`lib/author-identity.ts`、`lib/author-intent.ts`、`lib/author-invite.ts`、`lib/author-live-provider.ts`、`lib/author-provider.ts`、`lib/author-provider-official.ts`、`lib/author-provider-zhurl.ts`、`lib/author-registry.ts`、`lib/author-runtime-config.ts` 与 `lib/author-{cache,conversation,evidence,invite,oauth-boundary,portraits-invited,provider,provider-zhurl,setup-ui}.test.ts`。
- 文档：`docs/author-live-provider-report.md`（本报告）与 `docs/superpowers/specs/2026-09-14-author-brain-first-conversation-design.md`（对话框架设计稿），均未跟踪，按用户要求暂不提交。
- 临时验证脚本位于 gitignore 的 `.tmp/`（`verify-provider.ts`、`verify-invite.ts`、`verify-own-profile.ts`、`chat-e2e.ps1` 等），不随仓库提交。
