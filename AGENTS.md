# Restart Life 工程约束

## 数据库

- `DK_DATABASE_URL` 必须使用 `svc_restart_life_ro` 只读角色；禁止改成 owner、app、管理员或超级用户。
- 本仓库是游戏应用，不负责 schema 迁移、数据同步、角色创建或 DBA 操作。相关变更必须回到受 Alembic 和 `governance.audit_event` 管理的上游数据仓库执行。
- 游戏热路径只读取 `content_snapshot.source_url`、`author_name`、`author_avatar_url`、`author_url_token` 和 `author_profile_url`，禁止重新从 `raw_envelope.payload` 解析作者信息。
- 不将 PostgreSQL 端口开放或单次 `SELECT 1` 描述为业务完成；必须验证真实召回和 SSE 完成事件。

## 验证

代码修改至少运行：

```bash
npm run lint
npm run build
```

涉及数据库或事件生成时，还要从真实运行实例调用 `/api/event`，确认最终事件是 `complete`、经历数为 18、选项数为 3。HTTP 200 SSE 中出现 `error` 属于失败。

## 密钥

- 本仓库经所有者明确授权提交 `.env`，并要求仓库始终保持 private。
- 禁止在日志、Issue、PR 描述或终端输出中打印 `.env` 内容。
- 若仓库可见性变为 public，必须先停止发布并轮换数据库、CPA 和 OAuth 凭据。
