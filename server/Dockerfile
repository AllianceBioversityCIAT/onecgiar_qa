# syntax=docker/dockerfile:1.7
#
# OneCGIAR QA API image (docs/infrastructure.md § 3: Docker in TEST).
# Build context: server/
#
#   docker build -t qa-api .                          # API image (default target)
#   docker build --target migrate -t qa-api-migrate . # drizzle-kit migrations for the pipeline
#
# Configuration is injected at run time (DATABASE_URL, COGNITO_*, ALLOWED_ORIGINS,
# DYNAMODB_TABLE_NAME, …); no secret is ever baked into the image.

ARG NODE_VERSION=24-alpine

# ---- base: Node + pnpm pinned to package.json "packageManager" ----
FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.6.5 --activate
WORKDIR /app

# ---- deps: full install (dev deps needed to build and to migrate) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---- build: nest build → dist/ ----
FROM deps AS build
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

# ---- prod-deps: runtime dependencies only ----
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ---- migrate: applies server/drizzle/ before the new API starts (needs DATABASE_URL) ----
FROM deps AS migrate
COPY drizzle.config.ts ./
COPY drizzle ./drizzle
COPY src/database/drizzle/schema ./src/database/drizzle/schema
USER node
# Call the binary directly: corepack's pnpm was prepared for root, not for `node`.
CMD ["./node_modules/.bin/drizzle-kit", "migrate"]

# ---- runtime: the API (default target, keep it last) ----
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3000
# GET /api/v1/health is public (FR-10) and carries no token.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Exec form: node is PID 1 and receives SIGTERM (app.enableShutdownHooks()).
CMD ["node", "dist/main.js"]
