FROM node:22-bookworm-slim
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/worker ./apps/worker
RUN pnpm install --frozen-lockfile --filter @frs/worker...
WORKDIR /app/apps/worker
EXPOSE 3001
CMD ["pnpm", "start"]
