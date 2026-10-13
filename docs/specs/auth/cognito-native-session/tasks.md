# Cognito-native authentication and session — Tasks

| | |
|---|---|
| Spec path | `docs/specs/auth/cognito-native-session` |
| Branch | `feat/auth-cognito-session` |
| Jira | P2-3954 (epic P2-3902) — commits use `<emoji> <type>(auth) P2-3954: …` |
| Budget (design § 2) | 11 tasks · ~1,600 LOC · ~17 Reviewer passes |
| Verification (server) | `cd server && pnpm lint && pnpm build && pnpm test --reporter=dot` (+ `pnpm test:e2e --reporter=dot` where stated) |

Status: `[ ]` pending · `[~]` in progress · `[x]` done (only after a Reviewer PASS in `execution.md`) · `[!]` blocked.

## Dependency graph

```
T-1 ──┬─▶ T-2 ─▶ T-3 ──┬─▶ T-5 ──┬─▶ T-8 ─▶ T-9 [!] ─▶ T-10 ─▶ T-11 (HITL, TEST)
      ├─▶ T-4 ─────────┘         │
      └─▶ T-6 ─▶ T-7 ────────────┘
T-3 ─▶ T-7
```

Serial boundaries: T-1 (config, `main.ts`), T-2 (schema). T-4 and T-6 are parallel-safe with T-2/T-3 (separate files). T-9 is **blocked** until the auth microservice accepts `username` on refresh (design DD-2).

---

## T-1: Bootstrap the API surface and auth configuration
- **Status:** [x]
- **Size:** M
- **Depends on:** none
- **Requirements:** FR-16 (both scenarios; BUT no `*`), FR-18 (missing vars; AND IT MUST reject non-https origins except localhost), FR-10 (AND IT MUST public list — health part)
- **Design refs:** § 4, § 6 (`/health`), § 7.2 (error filter, ValidationPipe), § 9 (deps, env), DD-9
- **Scope:** add deps (`aws-jwt-verify`, `cookie-parser`, `@types/cookie-parser`, `@nestjs/throttler`, `helmet`, `class-validator`, `class-transformer`); `config/auth.config.ts`; extend `env.validation.ts` and `.env.example`; `main.ts`: global prefix `api/v1`, helmet, cookie-parser, `ValidationPipe`, CORS (exact-origin echo, credentials), `trust proxy`; `common/http-exception.filter.ts`; replace `GET /` with public-ready `GET /api/v1/health`; update `app.controller.spec.ts` and `test/app.e2e-spec.ts`; vitest e2e env gets the new dummy vars. Not touched: schema, auth module.
- **Tests:** unit — env validation (each missing var named; `http://evil.com` rejected; `http://localhost:4200` accepted). e2e — `/api/v1/health` 200; CORS allowed origin echoed with credentials, disallowed origin gets no allow headers; unknown route returns the error envelope.
- **Verification:** server command + `pnpm test:e2e --reporter=dot`
- **Falsifier:** change CORS `origin` to `true` (reflect any) → the disallowed-origin e2e goes red; drop one var from the required list → its unit test goes red.
- **Red run:** tests written first fail on the current code (no `/api/v1/health`, no CORS) — record the failing assertion.
- **Disqualifier:** a CORS test that sends no `Origin` header proves nothing; a green health test that hits `/` instead of `/api/v1/health`.
- **Consumers:** `server/src/app.controller.spec.ts`, `server/test/app.e2e-spec.ts` (design P-8); no front consumer.
- **Review:** checklist — bootstrap wiring; security-relevant parts (CORS) are covered by explicit tests.
- **Done when:** app refuses to start without auth vars naming them; health is the only route; CORS behaves per FR-16; error envelope on 404.
- **Skills:** nestjs-expert, nestjs-best-practices, error-handling-patterns

## T-2: Users, roles and role-assignments schema + migration
- **Status:** [x]
- **Size:** M
- **Depends on:** T-1
- **Requirements:** FR-1 (Unique identity; Duplicate active assignment — DB part; Revocation keeps history — CHECK part)
- **Design refs:** § 5, DD-7, DD-8; Premise P-15, P-17
- **Scope:** `schema/users.ts`, `roles.ts`, `role-assignments.ts`, `index.ts`; `pnpm db:generate` → `server/drizzle/0000_*.sql` committed. **Applying the migration to the shared `qadb` is a HITL step**: the Leader asks the user before `pnpm db:migrate`; never reset or drop.
- **Tests:** unit — schema metadata (unique columns, generated `active_key` expression present in the generated SQL, CHECKs present).
- **Verification:** server command; `pnpm db:generate` produces exactly one migration; at the HITL step, after `db:migrate`: inserting two identical active assignments fails, inserting after revoking succeeds, uppercase email insert fails (P-15 settled, outcome recorded in `execution.md`).
- **Falsifier:** remove the unique index on `active_key` → the HITL duplicate insert succeeds (gate red); remove the email CHECK → uppercase insert succeeds.
- **Red run:** n/a (no test gate) for the DB behavior — the gate is the HITL insert checks.
- **Disqualifier:** checks run against a DB where the migration was not applied; checking the SQL text only (presence ≠ enforcement — P-15).
- **Consumers:** none (no shared symbol changed)
- **Review:** full — schema is a shared boundary and hard to undo.
- **Done when:** migration committed; HITL checks recorded; if the user declines applying to `qadb`, P-15 stays UNVERIFIED and is carried to T-11.
- **Skills:** nestjs-expert, nestjs-best-practices

## T-3: Users module — repositories, seeds and authorization
- **Status:** [x]
- **Size:** M
- **Depends on:** T-2
- **Requirements:** FR-1 (Scoped assignment accepted; BUT program id/no key rejected; AND IT MUST global role with scope rejected; Duplicate — service part; Revocation), FR-2 (both scenarios incl. idempotency and BUT absent env), FR-3 (all four scenarios)
- **Design refs:** § 5 (scope integrity, seeds), § 7.1, DD-1, DD-4, DD-8
- **Scope:** `users/users.module.ts`, `users.repository.ts`, `role-assignments.repository.ts` (scope validation, revoke), `permissions.ts`, `authorization.service.ts` (`can`, `canAny`), `database/seeds/seed.ts`, `db:seed` script. Seed run on `qadb` is HITL.
- **Tests:** unit — table-driven `can()`/`canAny()` over every role × scope × context (incl. LEAD implies ASSESSOR only for the same key; missing context denied; revoked and inactive-role denied); repository scope validation with a fake DB port; seed idempotency with a fake.
- **Verification:** server command
- **Falsifier:** make LEAD_ASSESSOR expansion ignore the result type key → the "no lead on KP" row goes red; make missing context return true → the fail-closed row goes red.
- **Red run:** table tests written before `authorization.service.ts` fail on assertions (not on import errors — stub the module first).
- **Disqualifier:** a table that lacks the negative rows (KP lead, program 13, no context) can pass a wrong implementation.
- **Consumers:** none (no shared symbol changed) — new symbols only.
- **Review:** full — authorization core.
- **Done when:** every FR-3 row covered; seed idempotent; scope mismatches rejected with a domain error.
- **Skills:** nestjs-expert, tdd

## T-4: Token verifier
- **Status:** [x]
- **Size:** S
- **Depends on:** T-1
- **Requirements:** FR-10 (Valid token; Rejections — missing, malformed, expired, bad signature, id token, other client)
- **Design refs:** § 7.2 TokenVerifier; Premise P-13
- **Scope:** `auth/token-verifier.service.ts` (access + id verifiers, JWKS warm-up). **First step:** settle P-13 by reading the installed `aws-jwt-verify` typings; record the outcome. If injection is impossible, use a local JWKS HTTP stub in tests.
- **Tests:** unit with a locally generated RSA key set: valid access passes; expired, wrong `client_id`, `token_use=id`, wrong signature, wrong issuer, garbage → each rejected; id verifier accepts id and rejects access.
- **Verification:** server command
- **Falsifier:** drop the `clientId` option → the other-client test goes red; set `tokenUse: null` → the id-as-access test goes red.
- **Red run:** tests fail before the service exists (assertion level after a stub).
- **Disqualifier:** tests that mock the verifier itself instead of signing real JWTs prove nothing.
- **Consumers:** none (no shared symbol changed)
- **Review:** full — security boundary.
- **Done when:** all rejection cases covered with real signed tokens; P-13 outcome recorded.
- **Skills:** nestjs-expert, aws-serverless

## T-5: Global guards, decorators, current-user cache and `/auth/me`
- **Status:** [x]
- **Size:** M
- **Depends on:** T-3, T-4
- **Requirements:** FR-10 (handler must NOT run; public list), FR-11 (Not admitted → 401; Freshness ≤ 60 s and same-process invalidation), FR-12 (Missing permission; GUEST; Undeclared route → 403), FR-15, NFR-5
- **Design refs:** § 7.1 CurrentUserCache, § 7.2 guards, DD-4, DD-5, DD-6; Premise P-7
- **Scope:** `auth/guards/auth.guard.ts`, `permission.guard.ts`; decorators `@Public`, `@ReadAccess`, `@RequirePermission`, `@CurrentUser`; `users/current-user.cache.ts`; `auth/me.controller.ts`; register guards globally; mark `/health` `@Public`.
- **Tests:** e2e with test-only controllers (public, read, permission, undeclared) and the verifier overridden with the T-4 key set: no token → 401 and handler spy not called; GUEST → read 200, action 403; undeclared → 403; inactive / custom-without-roles → 401; cache: change assignments then advance a fake clock 61 s → new state; same-process `invalidate` → immediate.
- **Verification:** server command + `pnpm test:e2e --reporter=dot`
- **Falsifier:** default the PermissionGuard to allow when no decorator → undeclared-route test goes red; remove `@Public` handling → health returns 401 and its test goes red.
- **Red run:** e2e written first against the test controllers fail on status assertions.
- **Disqualifier:** a test controller that itself checks permissions would make the guard tests pass vacuously; time-based tests using real timers are flaky — use a fake clock.
- **Consumers:** `server/test/app.e2e-spec.ts` (health must stay public); grep `@Controller` over `server/src` at task start and list every controller (P-7: only `AppController` at `607dc0b`).
- **Review:** full — global access control.
- **Done when:** all scenarios green; `/auth/me` returns profile + assignments for GUEST and roles.
- **Skills:** nestjs-expert, nestjs-best-practices

## T-6: Auth microservice client
- **Status:** [x]
- **Size:** S
- **Depends on:** T-1
- **Requirements:** NFR-6 (503 within 10 s), FR-13 (empty refresh response → 401 — client part), FR-4 (Invalid credentials → 401 without revealing existence — client part)
- **Design refs:** § 7.2 AuthMicroserviceClient; Premise P-2, P-3, P-4, P-5, P-6
- **Scope:** `auth/auth-microservice.client.ts` with typed results for login, challenge, new-password, provider URL, code validation and refresh (`{ refreshToken, username }`).
- **Tests:** unit with a stubbed `fetch` and recorded fixture bodies shaped per P-2…P-6: header `auth` JSON sent; custom login sends `username` = email; 4xx → invalid credentials; 5xx, network error and > 10 s → upstream unavailable; empty 2xx body on refresh → invalid; bodies never logged (log spy).
- **Verification:** server command
- **Falsifier:** map 5xx to invalid credentials → the 503 test goes red; log the response body → the log-spy test goes red.
- **Red run:** fixtures-based tests fail before the client exists (assertion level).
- **Disqualifier:** fixtures invented without the microservice DTOs (P-2…P-6) — they must mirror the cited files.
- **Consumers:** none (no shared symbol changed)
- **Review:** checklist — adapter with explicit error mapping tests.
- **Done when:** every call and error mapping covered.
- **Skills:** nestjs-expert, error-handling-patterns

## T-7: Admission service
- **Status:** [x]
- **Size:** M
- **Depends on:** T-3, T-4
- **Requirements:** FR-8 (all five scenarios + table steps 1–7; BUT custom not created; AND IT MUST set auth_source from token), FR-13 (Admission re-checked — reads DB, never creates), FR-11 (AND IT MUST reflect changes immediately within the same process — writer side)
- **Design refs:** § 7.2 AdmissionService, DD-10
- **Scope:** `auth/admission.service.ts` (transactional resolve; `mode: 'login' | 'refresh'`; stores `cognito_username`; calls `CurrentUserCache.invalidate(user.id)` after the transaction commits — FR-11 same-process freshness, amended 2026-10-13 at the T-5 gate). Amended 2026-10-13 at the T-7 gate: custom-token email linking requires `email_verified` true (boolean or `"true"`) else 403, SSO links without it; the `sub` link is a conditional UPDATE (`WHERE cognito_sub IS NULL`), 0 rows → re-read: same `sub` continue, other `sub` 409. No locks added for this.
- **Tests:** unit with fakes for repositories and verifier — one test per FR-8 row: SSO new → created GUEST; pre-registered by email → sub linked + auth_source corrected; collision → 409; custom unknown → 403 and repository `create` never called; inactive → 403; custom without roles → 403; names/email updated; refresh mode never creates and bypasses cache; concurrent first-login unique violation → re-read, single user. After a resolve that changes the user (link `sub`, names/email), `invalidate(user.id)` was called after commit and a subsequent cache read reflects the change without advancing the clock. Amended: custom pre-registered + `email_verified` absent/false/`"false"` → 403 and nothing linked or created; `true` and `"true"` → linked; SSO without `email_verified` → linked; two concurrent links of the same email with different `sub`s → one admitted, the other 409 and the first link not overwritten.
- **Verification:** server command
- **Falsifier:** swap the order of steps 2 and 3 (check collision before email-link) → the pre-registered test goes red; let custom fall through to create → the "create never called" assertion goes red.
- **Red run:** tests fail before the service exists (assertion level).
- **Disqualifier:** asserting only the status without asserting "no row created" cannot catch the custom-creation bug.
- **Consumers:** none (no shared symbol changed)
- **Review:** full — admission rules are the core business rule of the spec.
- **Done when:** every FR-8 row and the refresh mode covered.
- **Skills:** nestjs-expert, tdd

## T-8: Login controller, cookies and throttling
- **Status:** [ ]
- **Size:** M
- **Depends on:** T-5, T-6, T-7
- **Requirements:** FR-4 (all scenarios; AND IT MUST validate before calling microservice), FR-5 (both), FR-6 (redirect allow-list; must NOT call microservice), FR-7, FR-9 (cookie attributes; companion cookie; BUT never in body/logs; no cookie on refusal), NFR-3, NFR-4, NFR-7
- **Design refs:** § 6, § 7.2 (throttling, error filter logging), § 7.3, DD-3; Premise P-16
- **Scope:** `auth/auth.controller.ts`, `auth/dto/*`, `auth/session-cookies.ts`, throttler config. P-16 (proxy count) recorded as an assumption in `execution.md` if still unconfirmed.
- **Tests:** e2e with the microservice client and verifier overridden: login success → body shape, `Set-Cookie` for `qa_rt` and `qa_ru` with `HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth/session`, no `Domain`; body contains neither refresh token, id token nor username cookie value; challenge → no cookies; 403/409 → no cookies; malformed body → 400 and client spy not called; bad redirect URI → 400 and client not called; 11th login in a minute → 429; auth log lines contain no token/password (log spy).
- **Verification:** server command + `pnpm test:e2e --reporter=dot`
- **Falsifier:** remove `HttpOnly` or set `Path=/` → cookie-attribute test goes red; include `refreshToken` in the response → body-leak test goes red.
- **Red run:** e2e fail on status/header assertions before the controller exists.
- **Disqualifier:** asserting the cookie name only (presence) cannot catch wrong attributes — assert each attribute.
- **Consumers:** none (no shared symbol changed)
- **Review:** full — session issuance.
- **Done when:** every listed scenario green.
- **Skills:** nestjs-expert, api-design-principles, nestjs-best-practices

## T-9: Session refresh and logout
- **Status:** [!] blocked — waits for the auth microservice to accept `username` on `/auth/refresh` (DD-2)
- **Size:** M
- **Depends on:** T-8; external: microservice change
- **Requirements:** FR-13 (all four scenarios: after reload/expiry; admission re-checked reading DB + cookies cleared; Origin → 403 and microservice not called; missing/invalid → 401 + cleared; rotation), FR-14 (both)
- **Design refs:** § 6, § 7.3, DD-2, DD-3, DD-6
- **Scope:** `auth/session.controller.ts`, `auth/guards/origin.guard.ts`; client call already exists (T-6). **First step:** confirm the microservice change is deployed in the env the tests target; otherwise stay `[!]`.
- **Tests:** e2e: valid cookies, no Authorization header → 200 session shape; rotation when client returns a new refresh token, kept otherwise; revoked last role (fake repo) → 403 and both cookies cleared, cache not consulted (spy); bad/missing Origin → 403 and client spy not called; no cookies → 401; client invalid → 401 and cleared; logout allowed → 204 and both cookies expired with the same Path; logout bad Origin → 403 and cookies untouched.
- **Verification:** server command + `pnpm test:e2e --reporter=dot`
- **Falsifier:** make refresh use the cached user → the revoked-role test goes red; skip OriginGuard → the bad-Origin test goes red.
- **Red run:** e2e fail on status assertions before the controller exists.
- **Disqualifier:** a refresh test that also sends a valid Bearer token does not prove the after-reload case.
- **Consumers:** none (no shared symbol changed)
- **Review:** full — session continuity and revocation.
- **Done when:** every scenario green and the microservice dependency recorded in `execution.md`.
- **Skills:** nestjs-expert, nestjs-best-practices

## T-10: Security hardening checks
- **Status:** [ ]
- **Size:** S
- **Depends on:** T-9 (or T-8 when T-9 stays blocked; rerun after T-9)
- **Requirements:** FR-10 (route inventory), FR-17, NFR-1, NFR-2 (matrix completeness), NFR-5, NFR-6
- **Design refs:** § 7.2, DD-5
- **Scope:** e2e route-inventory test (reads Nest's router and asserts every non-public route → 401 without token, and the public set equals FR-10's list); static check test that `server/src` has no `jwt.sign`/`sign(` of tokens and no client-secret config key; NFR-5 timing check; NFR-6 microservice-timeout e2e.
- **Tests:** as scope.
- **Verification:** server command + `pnpm test:e2e --reporter=dot`
- **Falsifier:** add a test controller without `@Public` handling mistakes (e.g. marked `@Public` by accident) → the public-set equality goes red; add a `sign(` helper → static check goes red.
- **Red run:** n/a (no test gate) for inventory on already-correct code — the falsifier run above is the evidence.
- **Disqualifier:** an inventory built from a hand-written list instead of the live router; NFR-5 measured with fewer than 200 requests or a cold JWKS — report the spread instead of a pass.
- **Consumers:** none (no shared symbol changed)
- **Review:** checklist — test-only task.
- **Done when:** inventory, static check, timing and timeout tests green, falsifiers executed.
- **Skills:** nestjs-expert

## T-11: HITL validation in TEST
- **Status:** [ ]
- **Size:** S
- **Depends on:** T-10 and a deployment of the branch to TEST (done by the repo owners, not by agents)
- **Requirements:** FR-8 step 1 (SSO detection in the real pool), FR-4/FR-5 (real custom user with challenge), FR-13 (real refresh after reload)
- **Design refs:** Premise P-10, P-11, P-12, P-14, (P-15 if not settled in T-2)
- **Scope:** with the user: log in once with SSO and once with a custom user; decode the id and access tokens (no tokens pasted into the repo or chat); record claim names present (`identities`, `cognito:username`, `client_id`, `token_use`, and whether SSO id tokens carry `email_verified` — informational only, not blocking) and token lifetimes; reload the page and confirm refresh. Record outcomes in `execution.md`.
- **Tests:** manual checklist above.
- **Verification:** each premise row gets "confirmed" or "refuted"; any refuted premise goes to the Pivot Protocol.
- **Falsifier:** a custom user's id token showing `identities` (or SSO without it) refutes P-10.
- **Red run:** n/a (no test gate)
- **Disqualifier:** claims read from documentation or from the microservice swagger instead of a real token.
- **Consumers:** none (no shared symbol changed)
- **Review:** checklist — recorded evidence only.
- **Done when:** P-10, P-11, P-12, P-14 settled and recorded.
- **Skills:** none required

---

## Coverage (scenario and clause level)

| Requirement | Scenario / clause | Task |
|---|---|---|
| FR-1 | Scoped accepted · BUT program/no key · AND IT MUST global with scope | T-3 |
| FR-1 | Duplicate active (DB + service) · re-grant after revoke | T-2, T-3 |
| FR-1 | Revocation keeps history · BUT not deleted | T-2 (CHECK), T-3 |
| FR-1 | Unique identity, lowercase email | T-2 |
| FR-2 | Roles seed + idempotent · Admin seed + idempotent · BUT absent env | T-3 |
| FR-3 | Union · BUT no lead on KP · Program 12/13 · no context · revoked/inactive role | T-3 |
| FR-4 | Valid · challenge (no tokens, AND IT MUST no cookie, BUT no admission yet) · invalid (BUT no existence leak) · AND IT MUST validate first | T-8 (T-6 client part) |
| FR-5 | Completed + admitted · completed not admitted (403, no cookie) | T-8 |
| FR-6 | Redirect allow-list · AND IT MUST NOT call microservice | T-8 |
| FR-7 | Invalid code → 401, no cookie | T-8 |
| FR-8 | Steps 1–7 · SSO first login · pre-registered · BUT custom not created · collision · AND IT MUST auth_source from token · unverified custom email → 403 · concurrent link → 409 | T-7 |
| FR-9 | Cookie attributes · companion cookie · BUT never in body/logs · no cookie on refusal | T-8 |
| FR-10 | Valid · rejections · BUT handler not run | T-4, T-5 |
| FR-10 | AND IT MUST public list only | T-1 (health), T-5, T-10 |
| FR-11 | Not admitted → 401 · AND IT MUST ≤ 60 s / immediate same process | T-5 (mechanism), T-7 (writer invalidation) |
| FR-12 | Missing permission (BUT handler not run) · GUEST · undeclared → 403 | T-5 |
| FR-13 | After reload/expiry + rotation · admission re-checked (AND IT MUST DB) · Origin (microservice not called) · missing/invalid | T-9 (T-6, T-7 parts) |
| FR-14 | Allowed → 204 cleared · disallowed → 403 untouched | T-9 |
| FR-15 | Profile + assignments | T-5 |
| FR-16 | Allowed origin echoed · BUT no `*` · other origin no headers | T-1 |
| FR-17 | Static guarantee | T-10 |
| FR-18 | Missing vars named · AND IT MUST https or localhost | T-1 |
| NFR-1, NFR-2 | Matrices | T-4, T-3, T-10 |
| NFR-3 | 400 before microservice | T-8 |
| NFR-4 | 429 | T-8 |
| NFR-5 | ≤ 20 ms p95 | T-10 |
| NFR-6 | 503 within 10 s | T-6, T-10 |
| NFR-7 | No secrets in logs | T-6, T-8 |
