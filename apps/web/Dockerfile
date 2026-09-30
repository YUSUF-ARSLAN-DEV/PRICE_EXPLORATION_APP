# syntax=docker/dockerfile:1.7
# Build context: the repository root.   docker build -f apps/web/Dockerfile -t qarib-web .
# Use --build-arg APP=admin (and port 3001) for the admin console.
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /repo

FROM base AS build
ARG APP=web
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @qarib/${APP}...
COPY packages/shared packages/shared
COPY apps/${APP} apps/${APP}
# Public build-time settings (never secrets): site URL and optional self-hosted analytics script.
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ARG NEXT_PUBLIC_ANALYTICS_SRC=
ARG NEXT_PUBLIC_ANALYTICS_DOMAIN=
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL NEXT_PUBLIC_ANALYTICS_SRC=$NEXT_PUBLIC_ANALYTICS_SRC \
    NEXT_PUBLIC_ANALYTICS_DOMAIN=$NEXT_PUBLIC_ANALYTICS_DOMAIN NEXT_STANDALONE=1
# the admin console does not use the shared package; only build it when the app depends on it
RUN if [ "$APP" = "web" ]; then pnpm --filter @qarib/shared build; fi && pnpm --filter @qarib/${APP} build

FROM node:22-alpine AS runtime
ARG APP=web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 APP=${APP}
WORKDIR /repo
COPY --from=build /repo/apps/${APP}/.next/standalone ./
COPY --from=build /repo/apps/${APP}/.next/static ./apps/${APP}/.next/static
COPY --from=build /repo/apps/${APP}/public ./apps/${APP}/public
RUN addgroup -S qarib && adduser -S qarib -G qarib && chown -R qarib:qarib /repo
USER qarib
EXPOSE 3000
# API_URL (runtime) points the same-origin /api proxy at the API, e.g. http://api:4000/v1
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3000}/ >/dev/null 2>&1 || exit 1
CMD ["sh", "-c", "exec node apps/${APP}/server.js"]
