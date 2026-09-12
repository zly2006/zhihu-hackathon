Original prompt: 能不能写一个简单的前端？把前后端统一成nextjs

- 保留逐轮45—60秒、3位初始可攻略角色、选择锁定route；原Python产物保留为历史参考。
- Next.js App Router + TypeScript，服务端直接调用CPA，不调用Python子进程。
- 本地文件存档，浏览器HttpOnly cookie定位会话；前端不接触密钥或隐藏人物愿望。

- 已改为真正逐条JSONL：每条对白校验、持久化后立即SSE发送，后续句子仍在生成。
- 首轮真实测试检出223字不足，补充精确剩余预算/下一记录类型后可从已发送部分续写。
- 已跑完7轮真实CPA route；每条第一句均早于done。None元数据异常仅后台warning。
- 构建通过；本地同源校验改为请求Host，修复127.0.0.1被Next内部localhost重写造成的403。
- 浏览器验收完成：桌面开场、只收到两句时busy=true的实时阅读截图、手机选项布局、真实点击选择生成第二轮、刷新恢复、历史回看、结局与取消重新开始。
- 测试浏览器均已关闭；控制台未记录错误。单元测试5项通过（含27条共同篇组合），生产构建通过，无构建警告。
- 当前服务器为127.0.0.1:3000的Next dev，供用户立即体验。
- 剩余边界：本地单实例文件存档；语义/文学质量不是逐条schema校验能保证的；语言翻译暂按协议转换理解，正文直接生成中文。

## 2026-09-12 formal Galgame flow restoration
- Replaced the visual shell's default path with a three-step formal story setup: life stage, four-person cast, and player identity.
- Kept the fixed preview as an explicit secondary action; formal setup submits selected profiles/background/player data to `/api/story`.
- Added optional per-character background and Zhihu handle fields so the existing prompt wiring remains reachable from the UI.
- Updated chat routing to resolve dynamic live cast IDs from the current story state instead of only the legacy demo IDs.
- Verification: `npm test` 21/21, `npm run validate:life-events`, `npx tsc --noEmit`, `npm run build`, and `node scripts/ui-smoke.mjs` passed. Visual smoke screenshots: `galgame-ui-preview.png`, `galgame-setup-preview.png`.
- Live model generation still requires a valid upstream credential; the earlier replay attempt returned HTTP 401.
