# src/config — Agent Guide

Environment validation and typed configuration. This is the **only** place in the running app that reads `process.env`. The exceptions are processes outside Nest's config: `main.ts` (`PORT`), the standalone seed script (`src/database/seeds/seed.ts`: `DATABASE_URL`, `SEED_ADMIN_EMAIL`) and `drizzle.config.ts`. Root and `server/AGENTS.md` rules apply.

## Files

| File | Role |
|---|---|
| `env.validation.ts` | `validateEnv` (wired in `AppModule` via `ConfigModule.forRoot({ validate })`): the app refuses to start naming every missing required variable; `parseAllowedOrigins`; https checks |
| `auth.config.ts` | `authConfig` namespace: Cognito region, pool id, client id, client secret, Hosted UI URL, user-pool API URL (defaults to `https://cognito-idp.<region>.amazonaws.com/`), parsed `allowedOrigins` |
| `mysql.config.ts` | `mysqlConfig`: `DATABASE_URL`, `DATABASE_POOL_SIZE` (default 10) |
| `dynamodb.config.ts` | `dynamoDbConfig`: `AWS_REGION`, `DYNAMODB_TABLE_NAME`, optional `DYNAMODB_ENDPOINT` |

## Variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | `mysql://user:pass@host:3306/db` |
| `DATABASE_POOL_SIZE` | no | default 10 |
| `AWS_REGION`, `DYNAMODB_TABLE_NAME` | yes | `DYNAMODB_ENDPOINT` only for DynamoDB Local |
| `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID` | yes | the pool and QA's app client |
| `COGNITO_CLIENT_SECRET` | yes | **secret**: local `.env` or the secret store only; never a value in `.env.example` |
| `COGNITO_URL` | yes | Hosted UI domain, `https://` only |
| `COGNITO_USER_POOL_URL` | no | user-pool API endpoint override, `https://` only |
| `ALLOWED_ORIGINS` | yes | comma-separated exact origins; `https://` only, except `http://localhost:<port>`; no path or trailing slash |
| `SEED_ADMIN_EMAIL` | no | first ADMIN for `pnpm db:seed` |
| `PORT` | no | default 3000 |

## Rules

- **Adding a variable:** add it to `REQUIRED_ENV_VARS` (if required) and validate its format in `validateEnv`, expose it through a `registerAs` namespace, add it to `.env.example` (empty or a safe example — never a real secret), to `vitest.config.e2e.ts` `env` (a dummy value), and to `docs/infrastructure.md` § 6. Add a unit test that names it when missing.
- **Consumers inject the namespace** (`@Inject(authConfig.KEY) config: ConfigType<typeof authConfig>`), never `process.env`.
- **Secrets:** read only here, as `process.env.NAME!` with no fallback literal. `src/auth/no-qa-tokens.spec.ts` requires the exact line `clientSecret: process.env.COGNITO_CLIENT_SECRET!,` and flags fallbacks, literals and `process.env[...]`.
- Endpoints that receive credentials must be validated as `https://`.

## Testing

`env.validation.spec.ts`: every missing variable is named, empty values count as missing, origin rules (`http://evil.com` rejected, `http://localhost:4200` accepted), non-https Cognito URLs rejected.
