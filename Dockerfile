FROM node:22-bookworm AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund --ignore-scripts --prefer-offline --no-package-lock

FROM dependencies AS builder

WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/scripts/db-migrate.mjs ./scripts/db-migrate.mjs
COPY --from=builder /app/db ./db
# 答主语料/风格卡/头像不进镜像：部署脚本会把 .data/author-avatars 同步到宿主机数据卷，
# 再以 /app/.data 挂载进来（见 scripts/deploy-off.sh 的 [seed] 步骤）。

EXPOSE 3000
CMD ["node", "server.js"]
