# test — Agent Guide

End-to-end suites over the **real** Nest app (`AppModule` + `configureApp`), with only the edges replaced. They need no database and no network. Root and `server/AGENTS.md` rules apply.

```bash
cd server
pnpm test:e2e --reporter=dot                                         # all suites
pnpm exec vitest run --config ./vitest.config.e2e.ts test/auth-session.e2e-spec.ts
```

`vitest.config.e2e.ts` includes `**/*.e2e-spec.ts` and sets dummy env values (DB URL, Cognito ids, a fake secret, `ALLOWED_ORIGINS`, the catalog URLs and key, dummy `COGNITO_ADMIN_*` keys so the OpenAPI test can prove no key value leaks). Never point it at a real database or the real Cognito pool.

## Suites

| File | Covers |
|---|---|
| `app.e2e-spec.ts` | Health, CORS allow/deny, the response standard on unknown routes (no Nest text leaks) |
| `auth-guards.e2e-spec.ts` | Bearer verification, current-user cache, `@ReadAccess`/`@RequirePermission`/undecorated → 403 |
| `auth-login.e2e-spec.ts` | Login, new password, provider URL, callback: cookies, refusals, validation, JSON-only (415), throttling (429), logs without secrets |
| `auth-session.e2e-spec.ts` | Session refresh and logout: Origin check, cookie clearing rules, admission re-check from the DB, revocation |
| `auth-hardening.e2e-spec.ts` | Route inventory vs FR-10 public list, NFR-5 guard latency, NFR-6 Cognito timeout/5xx → 503 |
| `openapi.e2e-spec.ts` | The OpenAPI document matches the router route for route; security scheme per route (public / bearer / session cookie); summaries, 2xx/4xx and 401 documented; request and response schemas; Swagger UI served only when set up |
| `users-admin.e2e-spec.ts` | The `/users` and `/catalogs` routes: access (ADMIN only, every grantable role refused), shapes, filters, paging, the error codes of each route, OpenAPI |
| `users-admin-privacy.e2e-spec.ts` | NFR-2 log spy over every mutation route (all `Logger` instances, the static logger, `console`; forced 5xx; one decision line per request), FR-13 audit row counts over HTTP and none on a refusal, nested unknown keys with bracket paths |
| `catalogs.e2e-spec.ts` | `/catalogs/*`: ADMIN-only shapes (roles never include PROGRAM), cached copy served when the source fails |
| `support/in-memory-stores.ts` | Fake stores that emulate unique keys and `active_key`; `writes` counter; the lock-emulating transactional world (`InMemoryDatabase`, `InMemoryUsersAdminUnitOfWork`: row locks `S`/`X`, uncommitted writes, snapshot vs committed reads) used for the unit-of-work and concurrency specs |
| `support/in-memory-query-store.ts` | Fake `USERS_QUERY_STORE` (list filters, cursor, detail) over the in-memory database |
| `support/users-admin-world.ts` | `adminWorld()`: service, repositories, fake `CognitoAdminClient` and catalogs, recording unit of work (`calls` order), `seedUser`, `snapshot` |
| `support/users-admin-app.ts` | `buildUsersAdminApp()`: the real app over that world (guards, pipe, filter real; `USERS_STORE`, `ROLE_ASSIGNMENTS_STORE`, `USER_PROGRAMS_STORE`, `USERS_ADMIN_UNIT_OF_WORK`, `USERS_QUERY_STORE`, `CognitoAdminClient` and the catalog sources overridden) plus `bearer(sub)` |
| `support/jwt-test-keys.ts` | Local RS256 key pair, `signJwt`, `localJwksCache` — real tokens for the real verifier, no network |

## How to build a test world

Override providers with `Test.createTestingModule({ imports: [AppModule] })`:

- `CognitoAuthClient` → an object of `vi.fn()`s (so "Cognito not called" is observable);
- `USERS_STORE`, `ROLE_ASSIGNMENTS_STORE`, `USER_PROGRAMS_STORE` → in-memory stores (for the users admin routes also `USERS_ADMIN_UNIT_OF_WORK`, `USERS_QUERY_STORE`, `CognitoAdminClient` → fakes; see `support/users-admin-app.ts`); `ADMISSION_UNIT_OF_WORK` → a unit of work over them;
- `JWKS_CACHE` → `localJwksCache(signer)`; `CURRENT_USER_CLOCK` → a fixed or controllable clock.

Then `const app = moduleRef.createNestApplication(); configureApp(app); await app.init();`.

## Rules

- **Write expected values out**, do not import them from the code under test (cookie names, Path, Max-Age, status texts) — a test that imports the constant cannot catch a wrong constant.
- **Response standard:** read success data from `res.body.data`; assert errors with `expectEnvelope(res, status, code)` (shape, `meta.requestId` = header, and the catalog `code`).
- **Assert the negative too:** no `Set-Cookie` on a refusal, the client spy not called before validation, no secret in `res.text`, no row created.
- **No disqualifiers:** a CORS test must send an `Origin`; a refresh test must not also send a valid Bearer token; asserting only a status cannot catch a missing side effect.
- Silence or capture logs with `vi.spyOn(Logger.prototype, …)`. To **prove** something is not logged, capture every sink — `Logger.prototype`, `Logger.overrideLogger(sink)` (after `compile()`, which installs its own logger) and `console` — as `users-admin-privacy.e2e-spec.ts` does; a spy on one logger is not evidence; restore mocks and close the app in `afterEach`.
- A new route needs: its e2e, and an update of FR-10's list in `auth-hardening.e2e-spec.ts` if it is public.
- Prove a new test bites: run it against the unfixed code (or a mutation) and record the red run.
