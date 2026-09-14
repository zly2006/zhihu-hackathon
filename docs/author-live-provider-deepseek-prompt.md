# 交给 DeepSeek V4.1 的开发提示词

将以下内容完整复制到新的 DeepSeek V4.1 窗口。执行前请让它阅读：

```text
F:\260824zhihuihekes\AGENTS.md
F:\260824zhihuihekes\docs\author-live-provider-development.md
F:\260824zhihuihekes\docs\author-cast-development-report.md
F:\260824zhihuihekes\知乎 Galgame设计\知乎 Galgame设计.md
F:\260824zhihuihekes\zhihu-cli-skill-0.5.3-beta.20260904115023\zhihu\references\hackathon-oauth.md
F:\260824zhihuihekes\zhihu-cli-skill-0.5.3-beta.20260904115023\zhihu\references\oauth.md
F:\260824zhihuihekes\zhihu-cli-skill-0.5.3-beta.20260904115023\zhihu\references\user-api.md
```

```text
你是当前项目的主开发工程师。请在工作区直接实现“知乎答主 Live Provider Framework”，不要把项目继续收敛成“必须提前采集才能使用的林泠专用离线系统”。

项目路径：F:\260824zhihuihekes
当前分支：codex/zhihu-author-avatar-rag

最终产品目标：

1. 统一 Live 模式，不增加用户可见的 online/offline/hybrid 三种模式；
2. 选人页有“知乎答主”和“预设 NPC”两个 tab；知乎答主 tab 默认选中且更醒目；
3. 林泠是默认推荐答主；
4. 用户可以输入知乎主页 URL 或 url_token，在线邀请任意知乎答主；
5. 预设 NPC 继续走本地角色卡；
6. 知乎答主走在线 Zhihu Provider；
7. 本地缓存/语料必须保留，作为缓存、RAG、评估和在线失败时的降级来源；
8. 所有答主最终使用统一的剧情角色、聊天、好感度、存档和来源卡链路；
9. 林泠可以进入 romance；任意新答主默认不能进入 romance，除非能力配置显式允许；
10. 不把真实作者写成真人本人，不生成其现实经历、私生活或现实关系。

==================================================
一、最重要的 OAuth 边界
==================================================

官方资料目录：

F:\260824zhihuihekes\zhihu-cli-skill-0.5.3-beta.20260904115023\zhihu

必须阅读：

- references/hackathon-oauth.md
- references/oauth.md
- references/user-api.md

OAuth 能做：

- 让玩家登录知乎；
- 后端用 App ID/App Key + authorization_code 换取 OAuth access token；
- 用 Access Secret + X-OAuth-Token 调用官方用户数据 API；
- 识别当前授权用户并绑定游戏 session。

OAuth 不能自动解决：

- 不能用玩家 OAuth token 读取任意目标答主的完整回答；
- 不能把 Access Secret 所属账号数据归给目标答主；
- 不能把用户登录等同于目标作者授权；
- 不能替代任意作者的公开内容 Provider。

因此必须把以下三个概念分开：

1. AuthSession：玩家是否登录知乎；
2. AuthorRef：玩家想邀请的目标作者；
3. AuthorProvider：获取目标作者公开资料和回答的来源。

本轮真实 OAuth 可以不验收，但 OAuth 代码不得被删除或与 AuthorProvider 混为一谈。

不要把任何 app_key、Access Secret、authorization_code、OAuth token 写入代码、日志、前端、prompt、测试夹具或提交。

==================================================
二、统一 Provider 抽象
==================================================

新增或调整 Provider 抽象。RAG、Agent、UI 不得直接依赖 zhurl、OAuth 或文件系统。

建议接口：

type AuthorRef = {
  provider: 'zhihu';
  urlToken: string;
  profileUrl: string;
};

interface AuthorProvider {
  resolveProfile(ref: AuthorRef): Promise<AuthorProfile>;
  listAnswers(ref: AuthorRef, options: ListAnswersOptions): Promise<AnswerSummary[]>;
  searchAnswers(ref: AuthorRef, query: string, limit: number): Promise<AnswerSummary[]>;
  readAnswer(ref: AuthorRef, answerId: string): Promise<AuthorAnswer>;
}

实现：

- ZhihuOfficialProvider：只用官方明确支持的用户数据 API；
- ZhurlProvider：本地开发/受控采料，用 zhurl 获取公开作者回答；
- CachedAuthorProvider：作者隔离的本地缓存；
- HybridAuthorProvider：Live 模式唯一使用的统一入口。

用户没有看到四种 Provider，它们只是内部实现。

HybridAuthorProvider 逻辑：

1. 先查作者专属本地缓存；
2. 有足够新鲜且相关的证据就直接用；
3. 缓存缺失、过期或无命中时，最多调用一次在线搜索；
4. 必要时最多读取一次回答详情；
5. 在线结果必须通过 author token、answerId、sourceUrl、正文和完整性校验；
6. 校验成功后当前请求使用，并按策略写入作者缓存；
7. 在线失败但有旧缓存时使用旧缓存并标记 stale；
8. 在线失败且无缓存时返回 AUTHOR_PROVIDER_UNAVAILABLE 或 AUTHOR_AUTH_REQUIRED；
9. 不把所有在线结果直接塞进 prompt。

==================================================
三、任意答主邀请
==================================================

实现流程：

用户输入知乎主页 URL/url_token
→ 服务端固定域名和路径校验
→ 解析 urlToken
→ resolveProfile
→ 显示资料确认卡
→ 生成内部稳定角色 ID
→ 固定本局 authorSnapshot
→ 与预设 NPC 混选四人

要求：

- 只接受 zhihu.com/www.zhihu.com；
- 拒绝任意外部 URL、危险字符、协议、端口、认证信息；
- 不凭昵称确认作者；
- 同名作者按 urlToken 区分；
- 用户输入不能直接进入 system prompt；
- authorUrlToken 由服务端绑定，模型不能切换作者；
- 资料读取失败不能创建半成品角色。

统一角色结构至少包含：

id/name/gender/kind/identity/age
authorRef/authorSnapshot
capabilities.canChat
capabilities.canEnterStory
capabilities.canEnterRomance

预设 NPC 不调用知乎 Provider。

==================================================
四、选人页
==================================================

保留两个 tab：

知乎答主（默认、更醒目） | 预设 NPC

要求：

- 林泠默认推荐；
- 默认选择林泠 + 3 个预设 NPC；
- 两个 tab 切换不丢选择；
- 总选择数仍为 4；
- 答主卡显示化名、领域、资料来源状态、虚构声明；
- 不显示真实作者的现实身份作为剧情身份；
- 新邀请答主成功读取 profile 后才进入选择列表；
- 预设 NPC 保持原角色卡和立绘逻辑；
- 林泠/任意答主不能请求不存在的 ling_*.webp；
- 正式立绘策略：女性答主可暂时复用现有女性预设立绘，集中配置映射；
- 双 tab 是用户可见结构，但 Provider 实现不能泄漏到 UI。

==================================================
五、运行时 Agent
==================================================

运行时 Agent 允许受控在线访问，但不得无上限爬取。

工具：

- resolve_author_profile
- search_local_cache
- search_author_online
- read_author_answer
- finish

流程：

search_local_cache
→ 本地不足时 search_author_online（最多一次）
→ 必要时 read_author_answer（最多一次）
→ finish

限制：

- 每轮最多 3 次工具调用；
- 在线搜索最多一次；
- 详情读取最多一次；
- 最多 6 个模型 turn；
- 应用控制循环，模型不能无限循环；
- 工具参数 Zod strict 校验；
- read_answer 只能读取本轮搜索返回过的 answerId；
- 不能读取任意路径；
- 不能跨作者；
- 工具结果 JSON.stringify 后作为字符串 content；
- 所有 Chat Completions message.content 必须是字符串；
- finish citationIds 只能来自本轮已验证证据；
- 模型不能生成可信 URL，来源 URL 由程序生成；
- 区分无命中、鉴权失败、限流、Provider 故障、引用错误和模型错误。

==================================================
六、本地缓存与语料
==================================================

保留现有 .data/author-avatars/<token>/ 结构，但支持任意 author token 隔离。

缓存记录至少包括：

answerId
authorUrlToken
questionTitle
sourceUrl
body/excerpt
collectedAt
updatedAt
collectionMethod
query
contentHash
completeness

完整性状态不要把 API content 直接称为已核验全文。优先使用：

fetched_api_content_unverified

已有 batch manifest、SHA-256、作者 token、URL 和路径安全校验必须保留。

采集器：

- scripts/collect-author-answers.mjs
- scripts/collect-author-gaps.mjs
- scripts/lib/author-collect.mjs
- scripts/lib/author-plan.mjs
- scripts/lib/zhurl-compat.mjs

ZHURL_BIN 是唯一环境变量名。
个人 account.json 只可用于本地开发或受控离线采集，不能部署到生产服务端。

==================================================
七、聊天和好感度
==================================================

只对有 storyId、已进入本局的知乎答主角色结算：

- schema/citation 校验通过：+1；
- matched 且有引用：额外 +1；
- 每个答主每局最多 +10；
- no-match、模型失败、工具失败、citation 失败不加分；
- 标题页资料试验不加；
- 体验模式不加；
- 普通 NPC 不进入作者奖励；
- 这叫“有效互动奖励”，不要叫回答质量评分。

使用 exchangeId 防重复：

- 重复 exchangeId 不重复奖励；
- 服务端计算最终 affinity；
- 客户端不能提交 delta/total；
- 剧情生成期间答主聊天返回 409，或使用完全相同的共享 state lock；
- 不得使用只在测试 store 中成立的并发结论冒充生产多实例安全。

==================================================
八、状态和并发
==================================================

检查 lib/state-lock.ts、lib/storage.ts、app/api/story/route.ts、app/api/chat/route.ts。

必须保证：

- 同一 storyId 的剧情和聊天更新不会互相覆盖；
- nodes、selections、memory、route、relationshipType、relationships、authorChatGains 都保留；
- 重复 exchangeId 只结算一次；
- 当前实现若只是进程内锁，报告必须明确“仅单实例安全”；
- 多实例锁不在本轮扩展，但不能宣称已解决。

==================================================
九、测试优先
==================================================

先检查现有测试，再补测试：

- Provider URL 解析和作者隔离；
- OAuth token 不泄漏；
- 本地缓存优先；
- 在线搜索最多一次；
- read_answer 只能读本轮 answerId；
- 任意作者不能跨 token 读取；
- 在线失败旧缓存降级；
- 无缓存时错误分类正确；
- 林泠 + 3 NPC 混合开局；
- 任意答主默认不可 romance；
- 林泠可以 romance；
- 双 tab 切换保持选择；
- 女性答主立绘映射到现有女性资源；
- 重复 exchange 不重复奖励；
- 剧情生成期间答主聊天 409；
- 多批次 loader；
- citation 白名单；
- message.content 全部为字符串。

==================================================
十、执行和验证
==================================================

开始前执行：

git status

不要回滚不是本轮改动。
不要删除未跟踪目录。
不要 push。
不要提交 credentials、cookie、真实语料、.env、临时目录或本地资料。

执行验证：

npm test
npx tsc --noEmit
npm run validate:life-events
npm run build
node --check scripts/collect-author-answers.mjs
node --check scripts/collect-author-gaps.mjs

真实在线请求只有在本机已有合法配置和用户明确准备好时才执行。
先小规模验证 profile，再验证一个 answer list，再验证一条详情。
不要大规模采集。
不要打印响应中的凭证或敏感字段。

最终报告必须区分：

- 代码测试通过；
- mock Provider 通过；
- 本地缓存 RAG 通过；
- 真实知乎内容 Provider 是否通过；
- 真实 OAuth 是否通过；
- 真实数据库是否通过；
- 多实例部署是否通过；
- 风格卡是否人工审核；
- 正式立绘是否存在；
- 是否有未提交修改；
- 是否创建 commit；
- commit hash；
- 明确没有 push。

现在开始：先检查文件和报告，建立 TODO；先实现/修复 Provider 抽象和缓存优先链路，不要直接继续堆 UI。
```
