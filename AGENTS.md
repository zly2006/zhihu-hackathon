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

## 消息 content 必须保持字符串

对外发送 Chat Completions 消息时，业务上下文的 `message.content` 必须是字符串；需要传结构化数据时先序列化成 JSON 文本，再放入 `content`。禁止把对象直接作为 `content`，也不得在文档或提示词示意中把已经序列化的文本画成对象，否则会让人误判真实协议。排查请求时应直接校验每层 `typeof content === 'string'`。

## 图片资源统一使用 WebP

仓库中的产品图片资源必须使用 `.webp`，不得提交或引用 `.png`。新增或替换图片时应使用 `cwebp` 或等价工具压缩到合理体积，并在提交前确认 `rg --files -g '*.png'` 不包含产品资源。

## 失败经验

当用户说“更新项目”且上下文涉及仓库时，先确认 Git 分支、远端和冲突状态；不能擅自把更新解释成产品功能或素材改动。若工作树有未提交修改，必须先区分当前轮新增内容与既有改动，再执行同步、合并和验证。

对历史视觉资产的补齐必须先查看历史源图和原始提示词，确认画布比例、同一角色的多姿态布局、头身比例及透明背景约束，再按原模板生成。比如原资产是横向三姿态角色表时，生成单人全身立绘即使画风接近，也不满足交付要求。

当图像生成工具支持原生透明背景时，透明素材必须在生成或编辑提示中直接要求透明底并检查输出 alpha；不能先生成有底色图片，再用通用抠图后处理冒充透明输出，因为会损伤角色细节并改变历史资产。
