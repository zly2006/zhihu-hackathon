# 答主化身对话框架：预检索 + 单次自由回答

- 日期：2026-09-14
- 状态：已实施（2026-09-14；聊天暂不做流式）
- 关联报告：`docs/author-live-provider-report.md`

## 1. 问题

现行框架把模型降级成“引用抽取器”：

- 模型每轮只能输出一个工具 JSON，人话只能塞进 `finish.args.text`；
- 协议要求“作者观点必须检索”，寒暄与玩法提问也被迫先检索；
- `citationIds` 为空时程序丢弃模型文本，替换成写死的「资料不足」；
- persona 通道限制 300 字、禁止作者主张、要求反复声明“我是虚构化身”；
- 模型不知道游戏机制、玩家与当前剧情，于是回答“我没有好感度系统”。

## 2. 目标

让 LLM 成为对话大脑：一次调用直接产出自然回复；同时保持“作者观点必须有出处、不编造作者经历”的产品红线与受限在线访问。

## 3. 设计

### 3.1 流程

```text
玩家消息
 1. 解析角色绑定（不变）
 2. 意图路由（lib/author-intent.ts）
      conversation：寒暄 / 自我介绍 / 玩法 / 情绪 / 剧情闲聊
      knowledge：作者经验、观点、事实依据类问题
 3. 证据准备（lib/author-evidence.ts）
      a. 永远先做零成本本地检索（≤5 段、3000 字节）
      b. knowledge 且本地无命中 → 在线检索 1 次（关键词归一化）
      c. 在线命中且需要正文 → 读 1 条详情
      d. 产出 EvidencePacket（id/标题/文本/来源/completeness/origin）
 4. 一次模型调用（lib/author-conversation.ts）
      system = 角色卡 + 游戏与玩法事实 + 回答规则 + 证据包（序列化文本）+ 对话历史 + 问题
      输出信封：{"reply":"...","usedEvidenceIds":["..."]}
 5. 程序校验
      · reply ≤600 字，剔除 URL
      · usedEvidenceIds ∩ 证据包白名单 → sources（URL 由程序生成）
      · 正文出现“作者认为/作者表示…”但无来源 → 一次纠错重写
 6. 返回 {text, sources, evidenceStatus, providerStatus}
```

### 3.2 关键规则

- 模型自由写文本，工具协议删除；证据包只是参考资料。
- 无证据时化身可以自然回应（感受、边界、换问法建议），涉及作者观点必须引用，查不到就明说“这部分我没查到”，不编造。
- `evidenceStatus`：
  - `matched`：有来源（+2 有效互动奖励）
  - `unverified`：有证据包但未引用（+1）
  - `persona`：无证据包的自由对话（0）
  - 模型失败/超时 → 抛错，客户端保留消息可重试（不再用兜底句冒充回答）
- 硬上限：模型调用 ≤2（首次 + 至多一次纠错）、在线检索 ≤1、详情读取 ≤1、输入 6000 字节。
- 保留：AuthorProvider/缓存/在线校验、跨作者隔离、真实作者资料不进提示词、来源 URL 由程序生成、message.content 全字符串、好感度由服务端按 exchangeId 结算。

### 3.3 模块划分

| 模块 | 职责 |
| --- | --- |
| `lib/author-intent.ts` | 纯函数意图路由与非检索指令识别 |
| `lib/author-evidence.ts` | 程序化证据准备（本地 → 在线 → 详情） |
| `lib/author-conversation.ts` | 提示词组装、单次调用、信封解析与校验、纠错 |
| `lib/author-chat.ts` | 运行时装配（runtime + credentials + 调用 conversation） |
| 复用 | `author-retrieval`、`author-citations`、`author-provider*`、`author-cache`、`author-identity`、`author-style`、`author-errors` |
| 删除 | `AuthorToolSession`、JSON 工具协议、persona/evidence 双通道、强制检索与兜底句覆盖 |

### 3.4 风险与对策

| 风险 | 对策 |
| --- | --- |
| 模型仍爱说“没有资料” | 提示词明确：除“证据包为空且问作者观点”外不得拒绝回答 |
| 幻觉上升 | 证据包 + usedEvidenceIds 白名单 + 作者主张检查 + `unverified` 标注 |
| 单次调用失败即整轮失败 | 同轮最多一次纠错/重试；超时 45s |
| 意图误判 | 本地检索零成本，误判只影响是否发起在线检索 |
