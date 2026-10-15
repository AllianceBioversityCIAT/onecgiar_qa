# OneCGIAR QA — Infrastructure

| | |
|---|---|
| Status | Draft v0.1 |
| Last updated | 2026-10-15 |
| Derives from | `docs/trd/trd.md` — **LITE tier** (ADR-001) with polyglot persistence (ADR-002) |
| Source | Infrastructure team answer (2026-10-13), `feature/qa-ssr-lambda` branch |

> **In one line:** keep today's hosts and domains — Docker in TEST, S3 + CloudFront (front) and PM2 (API) in PROD — with front and API on the same site so the refresh cookie and CORS work; data in MySQL 8 and DynamoDB (us-east-1); where SSR runs in PROD is still open.

---

## 1. Target Environment

| Env | Front | API | Notes |
|---|---|---|---|
| Local | `ng serve` (4200) | `pnpm start:dev` (3000) | See § 6 |
| TEST | Docker → `https://qatest.ciat.cgiar.org` | Docker → `https://qatest-serv.ciat.cgiar.org` | Same site (`ciat.cgiar.org`) |
| PROD | S3 + CloudFront → `https://qa.cgiar.org` (static today) | PM2 → `https://api.qa.cgiar.org/api` | Same site (`qa.cgiar.org`); **SSR host open (ADR-008)** |

Cloud region: AWS **us-east-1**. The API stays on its own subdomain; no extra proxy.

## 2. Core Cloud Components

| Component | Use | Status |
|---|---|---|
| MySQL 8.0 | Workflow DB (Drizzle). Dev: shared `qadb` on the internal network (VPN needed) | Dev available; TEST/PROD instances to confirm |
| DynamoDB | Single table `cgiar-qa-{env}`, on-demand capacity | To create per env |
| Cognito | User pool + app client, called directly by the API (ADR-003). Callbacks: `http://localhost:4200/auth/callback` registered (2026-10-14); https callbacks for TEST/PROD pending with the pool owner | Pool available; TEST/PROD callbacks pending |
| Secrets store | Server secrets in TEST/PROD (DB URL, `COGNITO_CLIENT_SECRET`, Reporting/AI keys) | To choose (AWS Secrets Manager or SSM Parameter Store proposed) |
| ECR + Lambda + CloudFront | Option for SSR (tested on `feature/qa-ssr-lambda`, SAM templates in `client/infrastructure/`) | Candidate for ADR-008 |

## 3. Deployment Strategy

- **CI/CD:** GitHub → Jenkins (a GitHub workflow triggers the Jenkins job, as on `feature/qa-ssr-lambda`). Jenkinsfiles are kept local to the deploy host today.
- **Front SSR (Lambda option):** Docker image → ECR → SAM stack (Lambda Web Adapter + Function URL + CloudFront), `client/scripts/deploy-ecr.sh`.
- **API:** Docker image in TEST; PM2 process in PROD. Build with `pnpm build`, run `node dist/main`.
- **DB schema:** drizzle-kit migrations committed in `server/drizzle/`, applied by the pipeline before the new API version starts. Never hand-run SQL against shared DBs.
- **DynamoDB:** table defined as IaC (CloudFormation/SAM) with the same template per env.
- Branches (team rules): `main` = production, `staging` = approved work, `dev` = testing. Which branch deploys to the TEST environment is not defined yet (open question).

## 4. Network & Security Architecture

- HTTPS everywhere; front and API on the same site per env → refresh cookie `httpOnly; Secure; SameSite=Lax` on the API domain.
- CORS allow-list per env (`ALLOWED_ORIGINS`: exact origins, comma-separated; https only, except `http://localhost:<port>`): TEST `https://qatest.ciat.cgiar.org`, PROD `https://qa.cgiar.org`, with credentials. The same list backs the Origin check on session refresh/logout.
- Angular SSR: `NG_ALLOWED_HOSTS` must list the real hosts (else every SSR route returns 400); `NG_TRUST_PROXY_HEADERS=x-forwarded-for,x-forwarded-proto,x-forwarded-port` behind CloudFront/proxies.
- MySQL reachable only from the API hosts and the internal network.
- IAM for the API: DynamoDB access limited to `cgiar-qa-{env}` and its indexes.

## 5. Infrastructure Rules & Constraints

- Agents never deploy, create cloud resources, or change TEST/PROD settings. Deployments follow §§ 1–4 and are run by the repo owners.
- No secrets in the repo; `.env` files are git-ignored.
- One DynamoDB table per env; never share tables between envs.
- Every AWS resource carries the project tags used on `feature/qa-ssr-lambda`.

## 6. Local Environment

The local stack is **disposable**: agents may start, seed, and reset it to verify work. Cloud/PROD is **governed** (§§ 1–5) and never improvised by agents.

| Element | Contract |
|---|---|
| Primary route | Native (no Docker — chosen by the team, 2026-10-06): `cd server && pnpm install && pnpm start:dev` · `cd client && npm ci && npm start` |
| Fallback route | Docker Compose is not set up; propose it in a spec if needed (MySQL + DynamoDB Local) |
| Pre-check | `node -v` (22.x) · `pnpm -v` · `server/.env` exists (copy from `server/.env.example`) · VPN/internal network for the shared MySQL. On failure, report which check failed and stop — never guess credentials |
| Databases | MySQL: shared dev `qadb` via `DATABASE_URL`. DynamoDB: AWS dev table, or DynamoDB Local with `DYNAMODB_ENDPOINT=http://localhost:8000` |
| Seed / reset data | Schema: `cd server && pnpm db:migrate`. Seed scripts: none yet (to add with the first schema spec). **Never reset the shared `qadb`** — it is shared by the team |
| Health check | API: `curl -s localhost:3000/api/v1/health` returns 200 `{ "status": "ok" }`. Front: open `http://localhost:4200` |
| API docs | Swagger UI at `http://localhost:3000/api/v1/docs` (OpenAPI JSON at `/api/v1/docs/openapi.json`); on by default outside production, `OPENAPI_ENABLED=true\|false` overrides. To call the cookie-based session routes from Swagger UI, add its origin to `ALLOWED_ORIGINS` locally (e.g. `http://localhost:4200,http://localhost:3000`) |
| URLs / ports | Front 4200 · API 3000 · MySQL `192.168.20.210:3306` (shared dev) · DynamoDB Local 8000 (optional) |
| API env vars (auth) | Defined in `server/.env.example`: `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_CLIENT_SECRET` (**secret**: local `.env` or the secrets store only, never the repo), `COGNITO_URL` (Hosted UI domain, `https://<domain>.auth.<region>.amazoncognito.com`), optional `COGNITO_USER_POOL_URL` (defaults to `https://cognito-idp.<region>.amazonaws.com/`), `ALLOWED_ORIGINS` (default `http://localhost:4200`). The app client must list the callback `http://localhost:4200/auth/callback` (registered 2026-10-14); https callbacks for TEST/PROD are pending with the pool owner |
