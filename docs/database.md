# 假如我们的人生 demo 数据库

数据库名为 `svc_lamplight`，运行时使用 `svc_lamplight_app`，迁移使用 `svc_lamplight_owner`。旧项目 `svc_restart_life` 继续保持只读边界。

| 表 | 用途 | 关键关系 |
| --- | --- | --- |
| `zhihu_accounts` | 知乎用户最小资料 | 一个知乎用户一个账号 |
| `game_sessions` | 故事最新状态 | 关联账号，过期级联删除 |
| `story_nodes` | 每段生成对白 | 关联故事，按 node_index 唯一 |
| `story_choices` | 用户作出的选项 | 关联故事和片段 |
| `chat_messages` | 自由聊天消息 | 关联账号、故事和角色 |
| `interaction_events` | 登录、点击、生成、存档等事件 | 追加写入，支持审计和回放 |
| `save_slots` | 六个存档位的快照 | 账号与 slot_index 唯一 |

所有表都有 `expires_at` 或通过父表级联清理。默认保留 30 天；服务进程每 15 分钟尝试清理一次，也可运行 `npm run db:cleanup`。OAuth 授权码、App Key、Access Token 和 Cookie 都不进入数据库。

迁移文件为 `db/migrations/001_initial.sql`，部署脚本在启动新容器前使用 owner DSN 自动执行迁移。
