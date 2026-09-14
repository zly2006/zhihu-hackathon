# 知乎答主 Live Provider 开发文档

## 1. 目标

本阶段把项目从“林泠专用本地 RAG”扩展为统一的知乎答主 Live Agent Framework：

- 用户可以选择预设 NPC，也可以选择林泠或通过知乎主页 URL 邀请任意答主；
- 选人页继续使用两个 tab：`知乎答主` 与 `预设 NPC`；知乎答主 tab 默认选中且更醒目；
- 预设 NPC 继续使用本地角色卡；
- 知乎答主使用在线 Zhihu Provider 获取资料；
- 本地缓存/语料继续保留，承担缓存、RAG 索引、失败降级和评估用途；
- 所有答主最终进入同一套剧情角色、聊天、好感度、存档和引用链路；
- 不新增用户可见的“离线模式/混合模式/在线模式”选择。

统一用户体验称为 Live。Provider 内部可以使用缓存或在线接口，但这是实现策略，不是用户模式。

## 2. OAuth 能力边界

官方资料位置：

```text
F:\260824zhihuihekes\zhihu-cli-skill-0.5.3-beta.20260904115023\zhihu
```

重点文档：

- `references/hackathon-oauth.md`
- `references/oauth.md`
- `references/user-api.md`

### OAuth 可以做什么

OAuth Authorization Code Flow 可以：

1. 让玩家使用知乎账号授权本项目；
2. 后端用 `app_id`、`app_key` 和一次性 `authorization_code` 换取用户 OAuth access token；
3. 在后端用 Access Secret + OAuth access token 调用官方用户数据 API；
4. 获取当前授权用户在开放范围内的内容摘要、关注和收藏等数据；
5. 识别当前登录用户，绑定游戏会话和交互记录。

### OAuth 不能直接做什么

OAuth 不是“任意知乎答主内容读取授权”。官方用户数据 API 的身份模型是：

```text
Access Secret：识别开放平台调用方
X-OAuth-Token：代表当前授权用户
```

它主要访问“当前授权用户”的开放数据，不等于可以通过 `X-OAuth-Token` 读取任意第三方答主的完整回答。

因此：

- 用户登录 OAuth 不等于目标答主授权；
- 不能把玩家的 OAuth token 当成 MarryMea 的 token；
- 不能把 Access Secret 所属账号的数据归给目标答主；
- 不能用 OAuth 登录替代任意作者回答的在线 Provider；
- 任意答主公开回答仍需要公开内容 Provider、zhurl 或其他合规数据来源；
- 如果目标答主内容接口需要登录，必须如实返回 `AUTH_REQUIRED`，不能静默改读当前登录用户的数据。

## 3. OAuth 正确配置方式

### 3.1 申请和登记

根据官方文档，需要向知乎开放平台/赛事页面申请或取得：

```text
ZHIHU_OAUTH_APP_ID
ZHIHU_OAUTH_APP_KEY
ZHIHU_OAUTH_REDIRECT_URI
```

回调地址必须和平台登记值完全一致，包括：

- 协议；
- 域名；
- 端口；
- 路径；
- 尾部斜杠。

本地开发可以使用类似：

```text
http://127.0.0.1:3000/auth/callback
```

但必须先在知乎平台登记，不能只在 `.env` 中自定义。

### 3.2 凭证保存

```text
App ID：可以作为公开配置
App Key：只在服务端保存
Access Secret：只在服务端保存
authorization_code：只在回调中短暂使用
OAuth access_token：只在服务端会话中保存
```

禁止：

- 提交 `.env`；
- 放进前端 bundle；
- 放进 URL；
- 写入日志；
- 返回给浏览器；
- 放进 Agent prompt 或工具结果；
- 出现在截图、测试夹具和开发报告中。

### 3.3 授权流程

```text
浏览器访问 /api/auth/login
  ↓
后端创建 session 和随机 oauth state
  ↓
跳转 https://openapi.zhihu.com/authorize
  ↓
用户在知乎页面确认授权
  ↓
知乎回调 /auth/callback?authorization_code=...
  ↓
后端使用 code + app_id + app_key 换 access_token
  ↓
后端保存 token 到服务端 session
  ↓
浏览器只获得 httpOnly session cookie
```

Token 交换表单字段必须是：

```text
app_id
app_key
grant_type=authorization_code
redirect_uri
code
```

回调当前主参数是 `authorization_code`，实现可以兼容 `code`，但换 token 时仍使用表单字段 `code`。

### 3.4 state 注意事项

官方资料记录了回调可能不返回 state。没有可靠的 state 回传时，不能宣称完成标准 OAuth CSRF 防护。

开发阶段应：

- 生成并保存随机 state；
- 如果回调返回 state，必须比较且使用 timing-safe compare；
- 如果平台确实不返回 state，要在运行报告中明确风险；
- 不把当前 OAuth 实现描述为已经达到生产安全等级；
- 不在没有平台确认的情况下自行声称支持 PKCE、scope、refresh token 或撤销。

## 4. Provider 总体架构

OAuth、在线内容 Provider 和本地缓存必须分层：

```text
AuthSession
  └── 只负责玩家登录和授权身份

AuthorProvider
  ├── ZhihuOfficialProvider
  ├── ZhurlProvider
  ├── CachedAuthorProvider
  └── HybridAuthorProvider

Author Agent
  └── 只依赖 AuthorProvider，不直接调用 OAuth、zhurl 或文件系统
```

建议接口：

```ts
type AuthorRef = {
  provider: 'zhihu';
  urlToken: string;
  profileUrl: string;
};

type AuthorProfile = {
  urlToken: string;
  profileUrl: string;
  displayName: string;
  avatarUrl?: string;
  headline?: string;
  answerCount?: number;
  fetchedAt: string;
};

type AnswerSummary = {
  answerId: string;
  authorUrlToken: string;
  questionTitle: string;
  sourceUrl: string;
  excerpt?: string;
  voteupCount?: number;
  createdAt?: string;
  collectionMethod: 'latest' | 'top-voteups' | 'profile-search' | 'runtime-live';
  query?: string;
};

interface AuthorProvider {
  resolveProfile(ref: AuthorRef): Promise<AuthorProfile>;
  listAnswers(ref: AuthorRef, options: {
    sort: 'latest' | 'top-voteups';
    limit: number;
    cursor?: string;
  }): Promise<AnswerSummary[]>;
  searchAnswers(ref: AuthorRef, query: string, limit: number): Promise<AnswerSummary[]>;
  readAnswer(ref: AuthorRef, answerId: string): Promise<AuthorAnswer>;
}
```

### 4.1 `ZhihuOfficialProvider`

只使用官方开放平台明确支持的接口。

职责：

- 访问官方用户数据接口；
- 正确发送 `Authorization: Bearer <Access Secret>`；
- 代表授权用户时发送 `X-OAuth-Token`；
- 发送秒级 `X-Request-Timestamp`；
- 使用 `Paging.NextOffset` 分页；
- 只返回官方接口实际提供的字段；
- 不能把摘要当成完整正文；
- 不能假设官方接口能列出任意目标作者完整回答。

### 4.2 `ZhurlProvider`

用于公开作者主页回答、主页内搜索和回答详情等能力。

职责：

- 本地开发和受控采料使用 `zhurl`；
- `ZHURL_BIN` 是唯一环境变量名；
- 不把个人 `account.json` 部署到生产服务器；
- 不让运行时 Agent 直接执行 shell 或 zhurl；
- 将 zhurl 返回转换为 `AuthorProvider` 标准结构；
- 强制校验目标作者 `urlToken`；
- 强制校验 answerId、sourceUrl、正文和采集方式。

### 4.3 `CachedAuthorProvider`

本地缓存不是独立用户模式，而是 Provider 的缓存层。

建议目录：

```text
.data/author-avatars/<author-url-token>/
  profile.json
  cache/
  batch-001/
  batch-002/
  discovery/
```

所有作者必须按 `urlToken` 隔离。

### 4.4 `HybridAuthorProvider`

Live 模式只依赖它，不直接依赖具体实现：

```text
本地缓存查 profile 和相关证据
  ↓ 足够新鲜且相关
直接返回本地证据
  ↓ 无命中、过期或缓存不足
调用在线 Provider
  ↓ 成功
作者 token/answerId/sourceUrl/正文校验
  ↓
当前请求使用 + 写入作者缓存
  ↓ 失败
使用仍然可用的旧缓存
  ↓ 没有旧缓存
明确返回资料不可用
```

默认缓存建议：

```text
作者 profile：7 天
最新回答列表：6 小时
热门回答列表：24 小时
回答详情：7 天；在线更新时间变化时刷新
无命中结果：短 TTL 负缓存，例如 10 分钟
```

## 5. 任意答主邀请流程

```text
用户输入知乎主页 URL 或 url_token
  ↓
服务端解析并校验固定知乎域名
  ↓
生成内部稳定角色 ID，不能使用用户原文直接作为 ID
  ↓
调用 HybridAuthorProvider.resolveProfile
  ↓
用户确认作者资料卡
  ↓
创建本局 authorSnapshot
  ↓
与预设 NPC 混选 4 人
  ↓
进入剧情和聊天
```

URL 约束：

- 只接受 `https://www.zhihu.com/people/<token>` 或允许的官方主页格式；
- 只允许 `www.zhihu.com` / `zhihu.com`；
- 拒绝协议、端口、用户名、密码、fragment 和危险路径；
- 不接受任意知乎回答 URL 作为作者身份；
- 不凭昵称确认作者；
- 同名作者必须按 token 区分；
- 解析失败不得创建半成品角色。

本局固定快照：

```ts
type AuthorSnapshot = {
  authorUrlToken: string;
  profileHash: string;
  corpusVersion?: string;
  capturedAt: string;
};
```

同一局不因在线数据变化而更换角色身份或悄悄替换证据版本。

## 6. Runtime Agent 工具

运行时 Agent 可以联网，但不能无控制地爬取。

应用控制循环：

```text
search_local_cache
  ↓ 不足
search_author_online（最多一次）
  ↓ 必要
read_author_answer（最多一次）
  ↓
finish
```

工具：

```text
resolve_author_profile
search_local_cache
search_author_online
read_author_answer
finish
```

限制：

- 每轮最多 3 次工具调用；
- 在线搜索最多 1 次；
- 详情读取最多 1 次；
- 最多 6 个模型 turn；
- 所有工具参数必须 Zod 校验；
- 当前角色的 authorUrlToken 由服务端注入，模型不能切换作者；
- `read_author_answer` 只能读取当前搜索结果里的 answerId；
- 工具结果必须 JSON 序列化后放入字符串 `message.content`；
- `finish` 的 citationIds 必须来自本轮证据；
- 模型不能提供任意 URL、文件路径、cookie 或 token；
- 网络错误、鉴权错误、限流、无命中、引用错误必须区分。

## 7. 预设 NPC 与答主的统一选人模型

选人页仍是两个 tab：

```text
知乎答主（默认、更醒目） | 预设 NPC
```

内部统一结构：

```ts
type SelectableCharacter = {
  id: string;
  name: string;
  gender: '男' | '女';
  kind: 'preset-npc' | 'zhihu-author';
  identity: string;
  age: number;
  authorRef?: AuthorRef;
  authorSnapshot?: AuthorSnapshot;
  capabilities: {
    canChat: boolean;
    canEnterStory: boolean;
    canEnterRomance: boolean;
  };
};
```

要求：

- 林泠是默认推荐答主；
- 林泠可进入剧情和 romance；
- 任意新邀请答主默认可聊天、可入剧情，但默认不开放 romance；
- 预设 NPC 不调用知乎 Provider；
- 最终仍混选 4 人；
- 共同篇、路线、说话人白名单、结局统一消费 selected cast；
- 不把固定 8 人预设池改成动态知乎池。

## 8. 好感度

只对剧情内、已进入本局的答主角色结算：

```text
schema/citation 校验通过：+1
有相关证据且引用成功：额外 +1
每个答主每局最多 +10
```

这叫“有效互动奖励”，不是模型质量评分。

- 标题页试验不结算；
- 体验模式不结算；
- 普通 NPC 不进入答主奖励逻辑；
- no-match、模型失败、工具失败、引用失败不加分；
- 使用 `exchangeId` 防止重复奖励；
- 状态更新使用统一 per-story 机制；
- 多实例部署前必须换共享锁或数据库事务。

## 9. 验收要求

自动化：

```powershell
npm test
npx tsc --noEmit
npm run validate:life-events
npm run build
node --check scripts/collect-author-answers.mjs
node --check scripts/collect-author-gaps.mjs
```

必须补充或确认：

- 任意合法主页 URL 能创建作者预览卡；
- 非知乎域名、危险 URL、昵称冒充均拒绝；
- 林泠和任意作者按 token 隔离；
- 本地缓存优先，在线结果只在缓存不足时使用；
- 在线结果校验后才进入 RAG；
- 在线失败有旧缓存时使用旧缓存；
- 在线失败且无缓存时返回资料不可用；
- 在线搜索最多一次，详情最多一次；
- Agent 不能切换作者或读取任意路径；
- OAuth token 不出现在前端、日志和 prompt；
- OAuth 流程和目标作者内容 Provider 不混淆；
- 林泠 + 3 预设能完整跑剧情、聊天、好感度、存档和结局；
- 真实 OAuth 本阶段可以不验收，但必须保持未配置时的明确状态。

## 10. 当前不做

- 不把玩家 OAuth token 当作目标答主授权；
- 不把个人 zhurl cookie 部署到服务端；
- 不实现无上限实时全站爬取；
- 不把联网搜索结果直接全部注入 prompt；
- 不默认开放任意答主恋爱线；
- 不把搜索摘要当完整正文；
- 不提交真实语料、cookie、Access Secret、App Key、API key；
- 不增加用户可见的三种运行模式切换。
