# src/config — Agent Guide

Environment validation and typed configuration. This is the **only** place in the running app that reads `process.env`. The exceptions are processes outside Nest's config: `main.ts` (`PORT`), the standalone seed script (`src/database/seeds/seed.ts`: `DATABASE_URL`, `SEED_ADMIN_EMAIL`) and `drizzle.config.ts`. Root and `server/AGENTS.md` rules apply.

## Files

| File | Role |
|---|---|
| `env.validation.ts` | `validateEnv` (wired in `AppModule` via `ConfigModule.forRoot({ validate })`): the app refuses to start naming every missing required variable; `parseAllowedOrigins`; https checks |
| `auth.config.ts` | `authConfig` namespace: Cognito region, pool id, client id, client secret, Hosted UI URL, user-pool API URL (defaults to `https://cognito-idp.<region>.amazonaws.com/`), parsed `allowedOrigins` |
| `mysql.config.ts` | `mysqlConfig`: `DATABASE_URL`, `DATABASE_POOL_SIZE` (default 10) |
| `openapi.config.ts` | `openApiConfig`: `enabled` — `OPENAPI_ENABLED` if set, else on unless `NODE_ENV=production` |
| `dynamodb.config.ts` | `dynamoDbConfig`: `AWS_REGION`, `DYNAMODB_TABLE_NAME`, optional `DYNAMODB_ENDPOINT`, and `credentials` only when both `DYNAMODB_*` keys are set (else the SDK default chain) |

## Variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | `mysql://user:pass@host:3306/db` |
| `DATABASE_POOL_SIZE` | no | default 10 |
| `AWS_REGION`, `DYNAMODB_TABLE_NAME` | yes | e.g. `us-east-1`, `cgiar-qa-test` (TRD § 5.2: one table `cgiar-qa-{env}`, keys `pk`/`sk`) |
| `DYNAMODB_ENDPOINT` | no | only for DynamoDB Local (`http://localhost:8000`) |
| `DYNAMODB_ACCESS_KEY_ID`, `DYNAMODB_SECRET_ACCESS_KEY` | no — both or neither | **secret**: local development only (IAM user scoped to the QA table). Absent in TEST/PROD, where the host's IAM role is used. With DynamoDB Local, any value |
| `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID` | yes | the pool and QA's app client |
| `COGNITO_CLIENT_SECRET` | yes | **secret**: local `.env` or the secret store only; never a value in `.env.example` |
| `COGNITO_URL` | yes | Hosted UI domain, `https://` only |
| `COGNITO_USER_POOL_URL` | no | user-pool API endpoint override, `https://` only |
| `ALLOWED_ORIGINS` | yes | comma-separated exact origins; `https://` only, except `http://localhost:<port>`; no path or trailing slash |
| `OPENAPI_ENABLED` | no | `true` / `false`; default on unless `NODE_ENV=production` (Swagger UI at `/api/v1/docs`) |
| `SEED_ADMIN_EMAIL` | no | first ADMIN for `pnpm db:seed` |
| `PORT` | no | default 3000 |

## Rules

- **Adding a variable:** add it to `REQUIRED_ENV_VARS` (if required) and validate its format in `validateEnv`, expose it through a `registerAs` namespace, add it to `.env.example` (empty or a safe example — never a real secret), to `vitest.config.e2e.ts` `env` (a dummy value), and to `docs/infrastructure.md` § 6. Add a unit test that names it when missing.
- **Consumers inject the namespace** (`@Inject(authConfig.KEY) config: ConfigType<typeof authConfig>`), never `process.env`.
- **Secrets:** read only here, with no fallback literal: `COGNITO_CLIENT_SECRET` in `auth.config.ts`, `DYNAMODB_SECRET_ACCESS_KEY` in `dynamodb.config.ts`. `src/auth/no-qa-tokens.spec.ts` pins both reading lines and flags fallbacks, literals, logs and `process.env[...]`.
- Endpoints that receive credentials must be validated as `https://`.

## Testing

`env.validation.spec.ts`: every missing variable is named, empty values count as missing, origin rules (`http://evil.com` rejected, `http://localhost:4200` accepted), non-https Cognito URLs rejected.
