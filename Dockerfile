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

EXPOSE 3000
CMD ["node", "server.js"]
