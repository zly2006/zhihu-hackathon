<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Galgame UI 控制经验

视觉小说应以对话框为主交互：点击对话区域推进，选项只在片段结束后出现，右键打开菜单；不要把“继续阅读”做成持续占位的普通按钮，也不要用快进式测试动作代替玩家点击。模型生成期间应保留对话区等待状态，给生成留出时间。

## 模板阶段边界

协议层不得复制当前模板的段落编号来判断共同篇或个人线；阶段边界必须读取 `lib/story-config.json` 的 `BEATS` 定义，避免模板调整后生成协议失配。

## 流式状态必须单一化

生成协议的流式 partial、最终 finishPartial 和持久化状态必须使用同一份规范化记录；不能只在中间事件上修正字段，却让最终校验重新读取模型原始值。任何字段修正都应在进入 partial 前完成，并由最终校验复用。
