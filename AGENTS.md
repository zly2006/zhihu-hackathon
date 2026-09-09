<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Galgame UI 控制经验

视觉小说应以对话框为主交互：点击对话区域推进，选项只在片段结束后出现，右键打开菜单；不要把“继续阅读”做成持续占位的普通按钮，也不要用快进式测试动作代替玩家点击。模型生成期间应保留对话区等待状态，给生成留出时间。
