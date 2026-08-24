# 知乎er的重启人生：off + FRP + HTTPS 部署

本文记录当前 Next.js 游戏的可复用部署路径。服务部署在 `ssh off` 对应的 `dom` 主机，FRP 使用当前 `39.96.44.20:6999`，HTTPS 在 FRPS 主机的 nginx 终止。

## 固定参数

| 项目 | 值 |
|---|---|
| 应用目录 | 仓库根目录 |
| 容器名 | `zhihu-restart-life` |
| 镜像名 | `zhihu-restart-life:<git-commit>` |
| 容器端口 | `3000` |
| off 主机端口 | `15180` |
| FRP 公网端口 | `25180` |
| HTTPS 域名 | `restart-life.ai2.fintechedu.cn` |
| 数据目录 | `/home/dom/services/restart-life-data/`（仅日志与旧库回滚材料） |
| 运行目录 | `/home/dom/services/restart-life/` |

端口和域名是本次已完成部署的参数；后续新实例必须先用 `check_ports.sh` 检查，不能直接复用已占用端口。

## 本地构建

```bash
npm ci
npm run lint
npm run build
```

Docker 使用 `node:20-bookworm` 和 Next standalone 输出；`.env`、数据库凭据、LLM 日志和构建缓存都不会进入镜像。

## 上传源码

源码按提交号上传到独立 release 目录，避免覆盖正在运行的版本：

```bash
git_commit=$(git rev-parse --short HEAD)
ssh off "mkdir -p /home/dom/services/restart-life/releases/${git_commit}"
tar -C . \
  --exclude=.env --exclude=.next --exclude=node_modules --exclude=.tmp \
  --exclude='*.tsbuildinfo' --exclude=.DS_Store -czf - . \
  | ssh off "tar -xzf - -C /home/dom/services/restart-life/releases/${git_commit}"
```

## 运行凭据

仓库根目录 `.env` 已配置 readonly `DK_DATABASE_URL`。部署时可直接作为 `--env-file`，并把 `LLM_CALL_LOG_DIR` 改为 `/var/log/restart-life/llm-calls`。本仓库经所有者明确授权提交 `.env`，但仓库必须始终保持 private；owner、app 和管理员 DSN 禁止进入本仓库。

```bash
ssh off 'chmod 600 /home/dom/services/restart-life/runtime.env'
```

远端 `runtime.env` 必须是 600 权限。当前 Chat Completions 地址为
`https://opencode.ai/zen/go/v1/chat/completions`，模型为 `deepseek-v4-flash`。
API key 缺失或调用失败时应用直接报错，不使用参考脚本回退。
`deepseek-v4-flash` 在完整证据提示词下允许最多 90 秒响应；超时后仍直接返回错误。

知乎 OAuth 使用以下四个服务端变量：

```text
ZHIHU_OAUTH_APP_ID=<公开的应用 ID>
ZHIHU_OAUTH_APP_KEY=<OAuth App Key>
ZHIHU_ACCESS_SECRET=<开放平台 Access Secret>
ZHIHU_OAUTH_REDIRECT_URI=https://restart-life.ai2.fintechedu.cn/auth/callback
```

App Key、Access Secret 和 OAuth 用户 Token 不进入浏览器或镜像。浏览器只保存
`HttpOnly; Secure; SameSite=Lax` 的随机会话 ID，Token 保留在当前 Node 进程内存中，
容器重启后需要重新登录。公网回调必须与知乎开放平台登记值完全一致。
`GET /api/auth/status` 会通过 `missingConfiguration` 返回缺失的变量名，但绝不返回凭据值；
部署验收必须确认该数组为空，不能只因登录按钮已经出现就宣称 OAuth 配置完成。

## Docker 构建和启动

off 主机直连 npm registry 可用时，不要盲目设置不可用的本机代理；构建命令使用当前提交号：

```bash
ssh off 'cd /home/dom/services/restart-life/releases/<git-commit> && \
  sudo env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  DOCKER_BUILDKIT=0 docker build --pull=false --network host \
  -t zhihu-restart-life:<git-commit> .'
```

启动或更新容器：

```bash
ssh off 'sudo docker rm -f zhihu-restart-life >/dev/null 2>&1 || true; \
  sudo docker run -d --name zhihu-restart-life \
  -p 15180:3000 --restart unless-stopped \
  --env-file /home/dom/services/restart-life/runtime.env \
  -v /home/dom/services/restart-life-data/llm-calls:/var/log/restart-life/llm-calls \
  zhihu-restart-life:<git-commit>'
```

先在 off 主机验证：

```bash
ssh off 'curl -sS -o /tmp/restart-life.out \
  -w "%{http_code}\n" http://127.0.0.1:15180/; \
  head -c 300 /tmp/restart-life.out'
```

核心 API `/api/event` 使用 SSE。应通过 `curl -N` 提交一份合法的出生档案和状态请求，确认：

- 响应 `Content-Type` 为 `text/event-stream`；
- 检索阶段的 `progress` 事件能在模型完成前到达，nginx 没有缓冲整段响应；
- 生成阶段持续报告首 token、completion token 和 token/s；
- 最终收到包含 18 条经历和 3 个选项的 `complete` 事件，而不只是 HTTP 200。

路由同时返回 `X-Accel-Buffering: no`；公网 nginx 必须透传该响应头。HTTP 200 但 SSE 中出现
`error` 仍属于业务失败，不能计入部署成功。

## FRP 配置

先检查端口和代理名：

```bash
/Users/zhaoliyan/.agents/skills/deploy-via-off-frp/scripts/check_ports.sh 15180 25180 / http
ssh off 'grep -n "name = \"restart-life\"" ~/frp/frpc.toml || true'
```

备份 `~/frp/frpc.toml` 后追加唯一代理块：

```toml
[[proxies]]
name = "restart-life"
type = "tcp"
localIP = "127.0.0.1"
localPort = 15180
remotePort = 25180
```

用 skill 提供的安全脚本重启 FRP，不要在同一条 `ssh off` 命令里重启后立刻查询状态：

```bash
/Users/zhaoliyan/.agents/skills/deploy-via-off-frp/scripts/restart_frpc_via_off.sh
```

## nginx 和证书

在 `root@39.96.44.20` 创建 `/etc/nginx/sites-available/restart-life.ai2.fintechedu.cn.conf`，HTTP 用于 ACME，HTTPS 反代到 FRP 端口 `25180`。配置启用后：

```bash
ssh root@39.96.44.20 'sudo nginx -t && sudo systemctl reload nginx'
curl -I http://restart-life.ai2.fintechedu.cn/
ssh root@39.96.44.20 'sudo certbot certonly --webroot \
  --webroot-path /var/www/letsencrypt \
  --non-interactive --agree-tos --register-unsafely-without-email \
  -d restart-life.ai2.fintechedu.cn'
```

当前 FRPS 主机未安装 certbot nginx 插件，因此使用 webroot 模式；证书签发后再把 HTTPS vhost 指向证书文件。nginx 的 HTTPS `proxy_pass` 仍指向 `http://127.0.0.1:25180`；不要把 FRP TCP 代理改成 FRP HTTPS 代理。
由于完整事件生成允许模型响应 90 秒，该站点的 `proxy_send_timeout` 和
`proxy_read_timeout` 均设为 100 秒，避免 nginx 在应用超时前返回 504。

## 验收和回滚

公网验收必须同时证明应用层：

```bash
curl -sS -o /tmp/restart-life-public.out \
  -w "%{http_code}\n" https://restart-life.ai2.fintechedu.cn/
curl -sS -o /tmp/restart-life-event.json \
  -w "%{http_code}\n" -X POST \
  -H 'Content-Type: application/json' \
  --data @event-check.json \
  https://restart-life.ai2.fintechedu.cn/api/event
```

同时检查 `sudo docker ps`、`sudo docker logs zhihu-restart-life`、FRP 状态和 nginx error log。回滚时保留旧镜像和旧 release，重新启动旧提交号；不要删除数据库快照或运行凭据。
