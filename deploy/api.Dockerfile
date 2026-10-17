# syntax=docker/dockerfile:1
FROM node:22.22.0-alpine3.22 AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @tqm/shared && npm run build -w @tqm/api

FROM node:22.22.0-alpine3.22 AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --no-audit --no-fund -w @tqm/api -w @tqm/shared --include-workspace-root=false \
  && npm cache clean --force
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY db/migrations db/migrations
RUN mkdir -p /data/uploads /data/archive && chown -R node:node /data
USER node
EXPOSE 4000
# Migrations run on every start; the runner takes an advisory lock, so parallel starts are safe.
CMD ["sh", "-c", "node apps/api/dist/cli/migrate.js && exec node apps/api/dist/server.js"]
