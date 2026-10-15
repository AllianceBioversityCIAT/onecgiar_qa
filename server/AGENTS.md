# server — Agent Guide

NestJS 12 API of OneCGIAR QA. This guide adds to the root `AGENTS.md`; root rules always apply. A guide closer to the file you edit (e.g. `src/auth/AGENTS.md`) adds to this one, and an explicit instruction from the user wins over all of them.

## Overview

- **Stack:** NestJS 12 (Express), TypeScript as ES modules (`"type": "module"`, imports end in `.js`), Drizzle ORM + MySQL 8 (workflow state), ElectroDB + DynamoDB (snapshots, not used yet), Vitest, oxlint, Prettier.
- **Package manager:** `pnpm` only. Never `npm install` here (the client uses npm; the server does not).
- **API surface:** everything under the global prefix `/api/v1`. Every route is authenticated by default; `GET /api/v1/health` and the auth entry points are the only public ones (see `src/auth/AGENTS.md`).
- **Architecture:** modular monolith (TRD ADR-001). Feature modules live under `src/<module>/`; they talk through exported providers, never through each other's internals.

## Layout

| Path | What lives there | Guide |
|---|---|---|
| `src/main.ts` | Bootstrap: `configureApp(app)` + listen on `PORT` (default 3000) | — |
| `src/app.module.ts` | Root module: global config validation, DB modules, `UsersModule`, `AuthModule`, the two global guards | — |
| `src/app.controller.ts` | `GET /api/v1/health` (public) | — |
| `src/common/` | HTTP wiring shared by app and e2e: prefix, helmet, CORS, cookies, body parsing, validation pipe, error envelope, request id | `src/common/AGENTS.md` |
| `src/config/` | Env validation and typed config namespaces | `src/config/AGENTS.md` |
| `src/database/` | Drizzle (MySQL) and DynamoDB modules, schema, seeds | `src/database/AGENTS.md` |
| `src/users/` | Users, roles, role assignments, permission catalog, `can()`, current-user cache | `src/users/AGENTS.md` |
| `src/auth/` | Cognito client, token verification, admission, login/session controllers, global guards, decorators | `src/auth/AGENTS.md` |
| `drizzle/` | Generated SQL migrations (drizzle-kit). Never hand-edit an applied migration | `src/database/AGENTS.md` |
| `test/` | e2e suites over the real app (`*.e2e-spec.ts`) and their fakes | `test/AGENTS.md` |

## Setup and run

Follow `docs/infrastructure.md` § 6 (Local Environment); do not guess.

```bash
cd server
pnpm install
cp .env.example .env      # then fill the values; never commit .env
pnpm start:dev            # http://localhost:3000/api/v1/health → {"status":"ok"}
```

The API refuses to start when a required variable is missing and names it (see `src/config/AGENTS.md`). The shared dev MySQL (`qadb`) is **never reset by agents**; migrations and seeds against it are a human step.

## Verification (failure-only output)

```bash
cd server
pnpm lint                                  # oxlint --type-aware src/ test/ — must print 0 warnings
pnpm build                                 # nest build (tsc)
pnpm test --reporter=dot                   # unit: src/**/*.spec.ts
pnpm test:e2e --reporter=dot               # e2e: test/**/*.e2e-spec.ts (no DB, no network)
```

- Run a single file: `pnpm exec vitest run src/users/authorization.service.spec.ts` or `pnpm exec vitest run --config ./vitest.config.e2e.ts test/auth-session.e2e-spec.ts`.
- On a low-memory machine add `--maxWorkers=2`. If a local `resource-guard` hook blocks `pnpm build`, `pnpm exec tsc --noEmit -p tsconfig.build.json` is the stand-in; record that the real build is still owed.
- Every task leaves lint, build, unit and e2e green. A test you add must fail first on the code it guards (record the red run).

## Code conventions

- **Formatting:** Prettier (`singleQuote`, `trailingComma: all`). Run `pnpm format` or `npx prettier --write <files>` on what you touched.
- **Imports:** relative, with the `.js` extension (`import { X } from './x.js'`). `import type` for type-only imports.
- **Dependency injection:** inject with `@Inject(Token)` explicitly (constructor parameters), including classes. Use `Symbol` tokens for ports (`USERS_STORE`, `DRIZZLE`, `JWKS_CACHE`, …) so tests can override them.
- **Ports and adapters:** persistence goes through a store interface (port) with a Drizzle adapter; repositories hold the rules. Tests swap the port for an in-memory fake (`test/support/in-memory-stores.ts`).
- **Errors:** throw typed errors that extend Nest HTTP exceptions (`src/auth/auth.errors.ts`, `src/users/users.errors.ts`). The global filter turns them into the envelope `{ statusCode, error, message, details?, requestId }`. Never send raw driver or upstream errors to a client.
- **DTOs:** `class-validator` decorators; the global `ValidationPipe` runs with `whitelist`, `forbidNonWhitelisted` and `transform`, so unknown fields are a 400.
- **Comments:** explain *why* and cite the spec (`FR-x`, `DD-x`, `design 7.2`) where a rule comes from. Keep the existing density; do not narrate code.
- **Language:** code, comments, logs and docs in English.

## Security rules (non-negotiable)

- No route without a decision: a non-public route must declare `@ReadAccess()` or `@RequirePermission(...)`, or it answers 403 (fail closed).
- Never log tokens, cookies, passwords, codes, the Cognito username or request bodies. Auth decisions log only fixed fields (`src/auth/auth-decision.ts`).
- The Cognito client secret comes only from `COGNITO_CLIENT_SECRET`, read only in `src/config/auth.config.ts`; never a literal, never logged, never in a response. `src/auth/no-qa-tokens.spec.ts` enforces this statically, and that QA signs no token.
- No `process.env[...]` dynamic access in `src/`. Inside the app, read env only through `src/config/` (the exceptions are listed in `src/config/AGENTS.md`).

## Specs, commits and PRs

- Work comes from an approved spec under `docs/specs/<domain>/<slug>/` (`requirements.md`, `design.md`, `tasks.md`, `execution.md`). Cite the FR/DD you implement; when code and spec disagree, raise it.
- Branch `type/module-topic` from `staging`; never commit on `main`, `staging`, `staging-center` or `dev`.
- Commit: `<emoji> <type>(<module>) <TICKET>: <present-tense change>`; spec work prefixes `[SPEC:<domain>/<slug>]`. Stage explicit paths — never `git commit -a`.
