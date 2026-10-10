FROM node:22-bookworm-slim
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts ./packages/contracts
COPY packages/domain ./packages/domain
COPY apps/web ./apps/web
ARG VITE_KEYCLOAK_URL=http://localhost:8088
ARG VITE_KEYCLOAK_REALM=expense
ARG VITE_KEYCLOAK_CLIENT=web
ARG VITE_API_URL=http://localhost:3000
ENV VITE_KEYCLOAK_URL=$VITE_KEYCLOAK_URL
ENV VITE_KEYCLOAK_REALM=$VITE_KEYCLOAK_REALM
ENV VITE_KEYCLOAK_CLIENT=$VITE_KEYCLOAK_CLIENT
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm install --frozen-lockfile --filter @frs/web...
RUN pnpm --filter @frs/web build
EXPOSE 5173
CMD ["pnpm", "--filter", "@frs/web", "preview", "--host", "0.0.0.0", "--port", "5173"]
