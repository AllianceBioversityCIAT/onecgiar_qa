# Angular SSR (Express) packaged as an AWS Lambda container image.
# The AWS Lambda Web Adapter extension forwards Lambda invocations to the
# Express server started by `dist/onecgiar-qa/server/server.mjs`.

FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npx ng build --configuration production

FROM public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1 AS adapter

FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV AWS_LWA_PORT=8080
# Static file served by express.static: it does not depend on NG_ALLOWED_HOSTS.
ENV AWS_LWA_READINESS_CHECK_PATH=/favicon.ico
ENV AWS_LWA_READINESS_CHECK_TIMEOUT=30000
ENV NODE_OPTIONS=--max-old-space-size=768

COPY --from=adapter /lambda-adapter /opt/extensions/lambda-adapter

# The Angular application builder bundles express and @angular/ssr into
# server.mjs, so the runtime image needs no node_modules.
COPY --from=build /app/dist/onecgiar-qa ./dist/onecgiar-qa

EXPOSE 8080

CMD ["node", "./dist/onecgiar-qa/server/server.mjs"]
