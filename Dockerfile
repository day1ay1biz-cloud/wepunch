# syntax=docker/dockerfile:1
# One image, three entry points (see fly.toml):
#   web       next start
#   worker    node dist/worker/index.mjs
#   release   node dist/db/migrate.mjs
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM base AS build
# Commit SHA, so Sentry events and source maps share one release name.
ARG SENTRY_RELEASE
ENV SENTRY_RELEASE=$SENTRY_RELEASE
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The Sentry auth token is a build secret (fly deploy --build-secret
# SENTRY_AUTH_TOKEN=...), so it never lands in an image layer. Without it the
# build still succeeds and skips the source map upload.
RUN --mount=type=secret,id=SENTRY_AUTH_TOKEN \
    SENTRY_AUTH_TOKEN="$(cat /run/secrets/SENTRY_AUTH_TOKEN 2>/dev/null || true)" \
    pnpm build && pnpm build:scripts

FROM base AS runner
ARG SENTRY_RELEASE
ENV NODE_ENV=production PORT=3000 SENTRY_RELEASE=$SENTRY_RELEASE
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY package.json next.config.ts ./
USER node
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
