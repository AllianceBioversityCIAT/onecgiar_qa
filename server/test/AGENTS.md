# test — Agent Guide

End-to-end suites over the **real** Nest app (`AppModule` + `configureApp`), with only the edges replaced. They need no database and no network. Root and `server/AGENTS.md` rules apply.

```bash
cd server
pnpm test:e2e --reporter=dot                                         # all suites
pnpm exec vitest run --config ./vitest.config.e2e.ts test/auth-session.e2e-spec.ts
```

`vitest.config.e2e.ts` includes `**/*.e2e-spec.ts` and sets dummy env values (DB URL, Cognito ids, a fake secret, `ALLOWED_ORIGINS`). Never point it at a real database or the real Cognito pool.

## Suites

| File | Covers |
|---|---|
| `app.e2e-spec.ts` | Health, CORS allow/deny, error envelope on unknown routes |
| `auth-guards.e2e-spec.ts` | Bearer verification, current-user cache, `@ReadAccess`/`@RequirePermission`/undecorated → 403 |
| `auth-login.e2e-spec.ts` | Login, new password, provider URL, callback: cookies, refusals, validation, JSON-only (415), throttling (429), logs without secrets |
| `auth-session.e2e-spec.ts` | Session refresh and logout: Origin check, cookie clearing rules, admission re-check from the DB, revocation |
| `auth-hardening.e2e-spec.ts` | Route inventory vs FR-10 public list, NFR-5 guard latency, NFR-6 Cognito timeout/5xx → 503 |
| `support/in-memory-stores.ts` | Fake `UsersStore` / `RoleAssignmentsStore` that emulate unique keys and `active_key`; `writes` counter |
| `support/jwt-test-keys.ts` | Local RS256 key pair, `signJwt`, `localJwksCache` — real tokens for the real verifier, no network |

## How to build a test world

Override providers with `Test.createTestingModule({ imports: [AppModule] })`:

- `CognitoAuthClient` → an object of `vi.fn()`s (so "Cognito not called" is observable);
- `USERS_STORE`, `ROLE_ASSIGNMENTS_STORE` → in-memory stores; `ADMISSION_UNIT_OF_WORK` → a unit of work over them;
- `JWKS_CACHE` → `localJwksCache(signer)`; `CURRENT_USER_CLOCK` → a fixed or controllable clock.

Then `const app = moduleRef.createNestApplication(); configureApp(app); await app.init();`.

## Rules

- **Write expected values out**, do not import them from the code under test (cookie names, Path, Max-Age, status texts) — a test that imports the constant cannot catch a wrong constant.
- **Assert the negative too:** no `Set-Cookie` on a refusal, the client spy not called before validation, no secret in `res.text`, no row created.
- **No disqualifiers:** a CORS test must send an `Origin`; a refresh test must not also send a valid Bearer token; asserting only a status cannot catch a missing side effect.
- Silence or capture logs with `vi.spyOn(Logger.prototype, …)`; restore mocks and close the app in `afterEach`.
- A new route needs: its e2e, and an update of FR-10's list in `auth-hardening.e2e-spec.ts` if it is public.
- Prove a new test bites: run it against the unfixed code (or a mutation) and record the red run.
