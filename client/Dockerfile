# syntax=docker/dockerfile:1.7
#
# OneCGIAR QA front: Angular 22 SSR (Express) image (docs/infrastructure.md § 1: Docker in TEST).
# Build context: client/
#
#   docker build -t qa-client .
#   docker run -d -p 4000:4000 -e NG_ALLOWED_HOSTS=qatest.ciat.cgiar.org qa-client
#
# NG_ALLOWED_HOSTS is required at run time: Angular answers 400 on every rendered
# route whose Host is not listed (angular.json security.allowedHosts is empty).

ARG NODE_VERSION=24-alpine

# ---- build: ng build → dist/onecgiar-qa/{browser,server} ----
FROM node:${NODE_VERSION} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund
COPY . .
RUN npx ng build --configuration production

# ---- runtime: Node SSR server (default target, keep it last) ----
FROM node:${NODE_VERSION} AS runtime
# server.ts registers no SIGTERM handler; tini forwards signals so `docker stop` is immediate.
RUN apk add --no-cache tini
ENV NODE_ENV=production \
    PORT=4000 \
    NG_TRUST_PROXY_HEADERS=x-forwarded-for,x-forwarded-proto,x-forwarded-port
WORKDIR /app
# The Angular builder bundles express and @angular/ssr into server.mjs: no node_modules needed.
COPY --from=build --chown=node:node /app/dist/onecgiar-qa ./dist/onecgiar-qa
USER node
EXPOSE 4000
# A static file: express.static serves it before the Angular host check, so the
# health check does not depend on NG_ALLOWED_HOSTS.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/favicon.ico').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/onecgiar-qa/server/server.mjs"]
