# 数据库契约

应用通过 `.env` 中的 `DK_DATABASE_URL` 使用远程 PostgreSQL readonly 角色。该角色只能连接指定数据库并读取业务表，不能写数据、执行 DDL 或读取治理审计表。

## 游戏热路径字段

`content_snapshot` 直接保存游戏所需的来源与作者信息：

| 字段 | 用途 |
|---|---|
| `source_url` | 原始知乎回答链接 |
| `author_name` | 作者展示名 |
| `author_avatar_url` | 作者头像地址 |
| `author_url_token` | 知乎作者 token |
| `author_profile_url` | 可直接打开的作者主页 |

这些字段由受治理的迁移和采集链路写入。`raw_envelope.payload` 是冷证据，不用于在线作者信息解析。

## 数据治理边界

- schema 版本由上游 Alembic 历史管理；
- owner 角色仅用于受审计迁移和同步；
- DDL、DROP、迁移、同步和备份写入 `governance.audit_event`；
- 本仓库不包含 migration DSN、管理员 DSN 或数据库写入能力；
- 需要字段变更时，先在上游新增迁移、回填和验证，再更新这里的只读查询。
