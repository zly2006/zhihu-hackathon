# 知乎er的重启人生

独立可运行的 Next.js 人生模拟游戏。服务端通过 PostgreSQL readonly 账号读取真实知乎经历，按人生阶段筛选候选，再用 `bge-large-zh-v1.5` 向量召回 18 条不同经历，交给模型生成三个可玩的行动分支。

## 直接运行

仓库自带 `.env`，默认连接远程只读数据库；克隆后即可安装和启动：

```bash
npm ci
npm run dev
```

打开 <http://127.0.0.1:3000>。生产构建：

```bash
npm run lint
npm run build
npm start
```

## 数据边界

- 浏览器不直连数据库，所有查询只发生在 Next.js 服务端。
- 默认数据库角色强制只读，不能建表、删表或修改数据。
- 游戏热路径只读取 `content_snapshot` 上的来源和作者字段，不解析原始大 JSON。
- `raw_envelope` 是冷证据层，不应出现在游戏查询中。
- 数据库 schema、迁移和 DBA 操作由上游数据仓库治理，本仓库不携带 owner 或管理员凭据。

## 业务成功标准

`POST /api/event` 返回 SSE。HTTP 200 只代表流建立成功；必须最终收到 `complete`，且包含 18 条真实经历和 3 个选项。收到 `error` 仍是业务失败。

详细约束见 [AGENTS.md](./AGENTS.md)，数据库字段说明见 [docs/database.md](./docs/database.md)，部署方式见 [docs/deployment.md](./docs/deployment.md)。
