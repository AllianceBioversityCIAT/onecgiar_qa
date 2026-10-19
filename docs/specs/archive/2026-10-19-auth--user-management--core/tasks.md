# User management (core) — Tasks

| | |
|---|---|
| Spec path | `docs/specs/auth/user-management/core` |
| Branch | `feat/auth-user-management` (from `origin/staging-center`) |
| Jira | P2-3908 — commits `<emoji> <type>(users) P2-3908: …` |
| Budget (design § 2) | 10 tasks (the HITL step is its own task) · ~12,500 LOC · ~20 Reviewer passes — re-baselined 2026-10-19 (was ~3,200 LOC · ~16 passes) |
| Verification (server) | `cd server && pnpm lint && pnpm build && pnpm test --reporter=dot` (+ `pnpm test:e2e --reporter=dot` where stated) |

Status: `[ ]` pending · `[~]` in progress · `[x]` done (after a Reviewer PASS or a recorded `REVIEW_WAIVED`) · `[!]` blocked.

## Dependency graph

```
T-1 ──┬─▶ T-3 ─▶ T-4 ──┐
      │                 ├─▶ T-6 ─▶ T-7 ─▶ T-8 ─▶ T-9 ─▶ T-10 (HITL)
T-2 ──┴─────────────────┤
T-5 [external: IAM] ────┘
```

Serial boundaries: T-1 (schema, `server/src/database/**`), T-2 and T-5 (`server/src/config/**` — run one after the other, not in parallel). T-2 and T-5 are otherwise independent of T-1/T-3.

---

## T-1: Schema and migration for nickname, program scope, exclusions and audit
- **Status:** [x]
- **Size:** M
- **Depends on:** none
- **Requirements:** FR-2 (nickname unique — schema part), FR-4 (exclusion origin/status/history — schema part), FR-8 (invitation state), FR-13 (audit storage), NFR-5 (unique email/nickname, one active exclusion per user/program)
- **Design refs:** § 5; DD-1, DD-4, DD-5; P-7, P-13
- **Scope:** `server/src/database/drizzle/schema/{users,user-programs,user-program-exclusions,user-audit-events,index}.ts`; generated `server/drizzle/0001_*.sql`; `schema.spec.ts`. Not touched: repositories, services.
- **Tests:** extend `schema.spec.ts`: nickname unique index; `user_programs` PK; exclusions: `active_key` stored generated + unique, CHECKs (manual ⇒ reason, dismissed ⇒ reporting + end_reason, `ended_at` iff not active; `ended_by`/`end_reason` NULL while active; `ended_by` NULL only for `reporting` + `removed` — DD-12); audit table append-only columns and index.
- **Verification:** server command; review the generated SQL by hand against § 5.
- **Falsifier:** drop the `dismissed ⇒ origin reporting` CHECK → its `schema.spec` assertion goes red; make `active_key` ignore `status` → the uniqueness assertion goes red.
- **Red run:** new `schema.spec` cases fail before the schema exists (assertion level).
- **Disqualifier:** asserting only that a table exists says nothing about its constraints; a migration never reviewed against § 5.
- **Consumers:** `server/src/database/drizzle/schema/index.ts` re-exports (schema consumers compile against it — `pnpm build`).
- **Review:** full — shared schema on a DB that is never reset.
- **Done when:** schema + migration + tests green; P-7 and P-13 written as read-only queries for T-10 (not run against `qadb` by the agent).
- **Skills:** nestjs-expert, nestjs-best-practices

## T-2: Catalogs — result types (Reporting) and Science Programs (CLARISA)
- **Status:** [x]
- **Size:** M
- **Depends on:** none (config boundary: not in parallel with T-5)
- **Requirements:** FR-11 (its one scenario, upstream down → 503, plus the stale-copy clause: a cached copy ≤ 24 h MAY be served), FR-1 (catalog routes admin-only — route part), NFR-3
- **Design refs:** § 6 catalogs rows, § 7 CatalogService, § 9 env; DD-9; P-5, P-6
- **Scope:** **first step: settle P-5 and P-6** (read the Reporting `GET /api/qa/catalog` and the CLARISA programs endpoint with the local keys; record shapes in `execution.md`; a refuted premise → Pivot). Then `server/src/users/catalogs/*` (clients behind ports, service with 1 h cache / 24 h stale, controller with `/catalogs/roles|result-types|science-programs`), `server/src/config/catalogs.config.ts`, env validation + `.env.example`, error-catalog usage, OpenAPI.
- **Tests:** unit — clients against stubbed `fetch` with fixtures shaped from the settled responses; cache fresh/stale/expired; 5xx/timeout → `UpstreamUnavailable`; grantable roles exclude PROGRAM. e2e — each route: 200 for ADMIN, 403 for an Assessor, 401 without token; 503 envelope when the source fails with no cache.
- **Verification:** server command + `pnpm test:e2e --reporter=dot`
- **Falsifier:** serve a copy older than 24 h → the stale-limit test goes red; include PROGRAM in grantable roles → its test goes red.
- **Red run:** client/service tests fail before the code exists (assertion level).
- **Disqualifier:** fixtures invented without the settled real responses.
- **Consumers:** `server/src/config/env.validation.ts` (+ spec); `test/openapi.e2e-spec.ts` (new routes must be documented).
- **Review:** full — two external contracts.
- **Done when:** P-5/P-6 settled and recorded; routes green; OpenAPI lists them with their codes.
- **Skills:** nestjs-expert, api-design-principles, error-handling-patterns

## T-3: Permissions and assignment rules (ADMIN all, `*`, Assessor/Lead exclusivity, effective scope)
- **Status:** [x]
- **Size:** M
- **Depends on:** T-1
- **Requirements:** FR-14; FR-3 (Mixed roles; Assessor and Lead on the same type incl. **all**; All result types covers future types); FR-4 (exclusion always wins — pure part; active ADMIN exempt, DD-13); FR-2 (non-grantable PROGRAM — rule part)
- **Design refs:** § 7 effective scope/`canReview`, ADMIN; DD-1, DD-2, DD-10, DD-11, DD-13; P-3, P-11, P-14
- **Scope:** `server/src/users/permissions.ts` (ADMIN grants every permission; grantable-role list), `authorization.service.ts` (`*` matches any key; `canReview`), `effective-scope.ts` (pure), `role-assignments.repository.ts` (accept `*` for result-type roles only; refuse Assessor/Lead overlap for one user, `*` included), `users.errors.ts`/error catalog (`USERS_ROLE_CONFLICT`). **First step:** update `role-assignments.repository.spec.ts:225` (the test that grants Assessor+Lead on KP) to expect the refusal.
- **Tests:** table tests: every overlap shape (A/A, A/L same key, A/L `*` vs key, L `*` vs A `*`, different keys allowed, revoked ignored); `can`/`canAny`/`canReview` with `*`, program list, all programs, exclusion over scope; matrix spec: ADMIN true everywhere.
- **Verification:** server command
- **Falsifier:** let `*` match only literal `*` → the "all covers a new type" test goes red; drop the overlap check for `*` → its row goes red; ADMIN back to one permission → matrix red.
- **Red run:** new tests fail on assertions before the change.
- **Disqualifier:** overlap tests that never include `*`; a matrix that skips future permissions (derive from the catalog).
- **Consumers:** `server/src/users/authorization.matrix.spec.ts`, `authorization.service.spec.ts`, `role-assignments.repository.spec.ts`, `current-user.cache.spec.ts`, `database/seeds/seed{,.spec}.ts`, `test/auth-{session,login,guards,hardening}.e2e-spec.ts` (P-11, P-14).
- **Review:** full — authorization rules.
- **Done when:** every overlap row and the matrix are green; the pinned test is updated with a note citing DD-11.
- **Skills:** nestjs-expert, nestjs-best-practices

## T-4: Repositories, unit of work and cache for program scope, exclusions and audit
- **Status:** [x]
- **Size:** M
- **Depends on:** T-1, T-3
- **Requirements:** FR-4 (manual add/remove; dismiss with reason; history kept — storage part); FR-6 (cache carries scope + exclusions; invalidate after commit); FR-7 (last admin — locking part, AND IT MUST hold concurrently); FR-13 (audit rows per DD-15; none on refusal — storage part); NFR-5
- **Design refs:** § 7 UsersAdminService steps 1–5, CurrentUserCache; DD-3, DD-5; P-2
- **Scope:** `user-programs.repository.ts`, `user-audit.repository.ts`, `users-admin.unit-of-work.ts` (lock target user `FOR UPDATE`; lock ADMIN role row `FOR UPDATE` on admin-reducing changes; active-admin count), `current-user.cache.ts` (load program scope + active exclusions), in-memory fakes in `test/support/in-memory-stores.ts` incl. a snapshot fake for the last-admin race.
- **Tests:** unit — exclusion lifecycle (active → removed / dismissed, history kept, unique active per program); audit rows written in the same transaction and absent on rollback; last-admin: two concurrent demotions with the snapshot fake → exactly one succeeds; cache loads scope/exclusions and `invalidate` makes the next read fresh.
- **Verification:** server command
- **Falsifier:** count admins with a plain read instead of under the lock → the concurrent-demotion test lets both pass (red); write the audit row outside the transaction → the rollback test goes red.
- **Red run:** tests fail before the repositories exist (assertion level).
- **Disqualifier:** a concurrency test whose fake serializes calls (it cannot show the race); generated-SQL not asserted for `FOR UPDATE`.
- **Consumers:** `server/src/users/current-user.cache.ts` readers (P-11); `test/support/in-memory-stores.ts` users (all e2e suites).
- **Review:** full — concurrency and audit integrity.
- **Done when:** lifecycle, audit and race tests green; `FOR UPDATE` asserted in generated SQL; real-MySQL locking listed for T-10.
- **Skills:** nestjs-expert, nestjs-best-practices

## T-5: Cognito admin client (create user, existing user, resend invitation)
- **Status:** [x]
- **Size:** M
- **Depends on:** none; **external: IAM credentials with `AdminGetUser`/`AdminCreateUser` on the pool (P-8)** — was `[!]` until Cris provided them (IAM provided 2026-10-19) (config boundary: not in parallel with T-2)
- **Requirements:** FR-2 (custom new → account + email; existing → no change; Cognito down → 503); FR-8 (resend; not applicable); NFR-2 (no email/credentials in logs); NFR-3
- **Design refs:** § 7 CognitoAdminClient; § 9 env/IAM; DD-6; P-4, P-8, P-9
- **Scope:** **first step: settle P-8** (credentials exist and allow the two actions — a read-only `AdminGetUser` on a known user). Then add `@aws-sdk/client-cognito-identity-provider`; `server/src/auth/cognito-admin.client.ts`; `server/src/config/cognito-admin.config.ts` (keys local-only, both or neither; default chain otherwise); env validation; extend the FR-17 static check (`no-qa-tokens.spec.ts`) to the new secret.
- **Tests:** unit with a stubbed SDK client: create (attributes: email, verified, names; email delivery), `UsernameExists`/existing user → `existing_account`, resend allowed/refused, throttling/5xx/timeout → 503, logs carry no email or key (log spy).
- **Verification:** server command
- **Falsifier:** send `email_verified=false` → the attributes test goes red; log the email → the log-spy test goes red.
- **Red run:** tests fail before the client exists.
- **Disqualifier:** fixtures not shaped like the SDK's real errors; a static check that does not include the new secret name.
- **Consumers:** `server/src/auth/no-qa-tokens.spec.ts`, `server/src/config/env.validation{,.spec}.ts`, `.env.example`.
- **Review:** full — credentials and an external admin API on a shared pool.
- **Done when:** P-8 settled; tests green; real-pool smoke listed for T-10.
- **Skills:** nestjs-expert, error-handling-patterns, aws-serverless

## T-6: UsersAdminService (create, edit, roles, programs, exclusions, activation, invitation)
- **Status:** [x]
- **Size:** L → executed as one task with two checkpoints (create/edit; roles/programs/exclusions/activation)
- **Depends on:** T-2, T-4, T-5
- **Requirements:** FR-2 (SSO; custom new; custom existing — BUT existing account not changed; validation and uniqueness 409s — BUT no record left on failure; Cognito down → 503 and no record); FR-3 (Replacing roles — BUT unchanged grants not re-issued); FR-4 (all four scenarios, AND IT MUST reason; unknown program); FR-5 (email immutable; name only before first sign-in; 404); FR-6 (invalidate after commit); FR-7 (deactivated: login 403, refresh fails, BUT Cognito account untouched; last admin incl. self); FR-8; FR-13 (every listed action audited; BUT none on refusal)
- **Design refs:** § 7 UsersAdminService, Create, Name rule, Invitation; DD-7, DD-8; P-1
- **Scope:** `server/src/users/users-admin.service.ts`, error codes (§ 7 list), decision logging. Not touched: controllers.
- **Tests:** unit with fakes for every scenario above; SSO pre-registered user then admission links it (P-1, through `AdmissionService` with in-memory stores); deactivate → admission 403 and refresh refused; Cognito called **before** the transaction and never on `sso`; failure after Cognito leaves no QA row.
- **Verification:** server command
- **Falsifier:** re-issue unchanged grants → the "unchanged grant keeps its id" test goes red; write the QA row before calling Cognito → the "Cognito down → no record" test goes red; allow a name edit after sign-in → its test goes red.
- **Red run:** service tests fail before the service exists (assertion level).
- **Disqualifier:** asserting only the HTTP status without "no row / no audit / Cognito not called"; a cache test that advances the clock instead of checking `invalidate`.
- **Consumers:** none (new service).
- **Review:** full — the core behavior.
- **Done when:** every FR scenario above has a passing test; the audit assertions cover each action.
- **Skills:** nestjs-expert, nestjs-best-practices, error-handling-patterns

## T-7: Users list and detail read model
- **Status:** [x]
- **Size:** M
- **Depends on:** T-4
- **Requirements:** FR-9 (search, filters, team by default, GUESTs only by filter; AND IT MUST cursor 50/200); FR-10 (detail with exclusion history)
- **Design refs:** § 6 `UserSummary`/`UserDetail`, § 7 List
- **Scope:** `server/src/users/users-query.repository.ts` (port + Drizzle adapter), mapping to summary/detail.
- **Tests:** unit with fakes (search over email/nickname/names, each filter, population team/guests/all, cursor stability across pages, limit bounds); generated SQL asserted for `LIKE`, filters and keyset cursor.
- **Verification:** server command
- **Falsifier:** offset-based paging → the "page 2 stable after an insert" test goes red; include GUESTs by default → its test goes red.
- **Red run:** tests fail before the repository exists.
- **Disqualifier:** a fake that ignores the cursor; no assertion on the real SQL (the fake alone cannot prove the query).
- **Consumers:** none (new).
- **Review:** checklist — query + mapping, rules covered by explicit tests.
- **Done when:** all list/detail tests green; NFR-4 measurement listed for T-10 (needs data).
- **Skills:** nestjs-expert, api-design-principles

## T-8: Admin controllers, DTOs, OpenAPI and `/auth/me` nickname
- **Status:** [x]
- **Size:** M
- **Depends on:** T-6, T-7
- **Requirements:** FR-1 (non-admin 403 — BUT no existence leak; no token 401); FR-2/3/4/5/7/8/9/10 (HTTP surface); FR-12 (own profile nickname; public-user mapper); NFR-1
- **Design refs:** § 6 (all rows), § 7 Nickname exposure, Errors; P-12
- **Scope:** `server/src/users/users-admin.controller.ts`, `dto/*` (validation + OpenAPI with per-route codes), `server/src/auth/me.controller.ts` (+ nickname), public-user mapper; update `test/auth-guards.e2e-spec.ts:625` (exact profile shape).
- **Tests:** e2e (`test/users-admin.e2e-spec.ts`): each route — 403 for every grantable non-admin role (Assessor, Lead Assessor, TPB, PPU, GUEST, multi-grant) with the same body for an existing and a missing id, 401 without token, happy path, validation fields, 409/404 codes; `/auth/me` returns `nickname`; route inventory and OpenAPI tests stay green with the new routes.
- **Verification:** server command + `pnpm test:e2e --reporter=dot`
- **Falsifier:** remove `@RequirePermission(ADMIN_ACCESS)` from one route → its 403 test and the route inventory go red; return 404 to a non-admin for a missing id → the existence-leak test goes red.
- **Red run:** e2e fail on status assertions before the controllers exist.
- **Disqualifier:** 403 tests that only use GUEST (each role must be checked); a profile test with `toMatchObject` (cannot see an extra or missing field).
- **Consumers:** `test/auth-guards.e2e-spec.ts:625`; `test/auth-hardening.e2e-spec.ts` (route inventory); `test/openapi.e2e-spec.ts`; front `client/src/app/core/auth/auth.models.ts` (additive, informative only).
- **Review:** full — the public contract.
- **Done when:** every route tested for 200/401/403 and its error codes; OpenAPI lists each route's codes.
- **Skills:** nestjs-expert, api-design-principles, nestjs-best-practices

## T-9: Privacy, docs and contract hand-off
- **Status:** [x]
- **Size:** S
- **Depends on:** T-8
- **Requirements:** NFR-2 (no email/name/credential in logs); FR-12 (no full name/email of another user to non-admins — rule recorded for later specs); FR-13 (audit coverage check)
- **Design refs:** § 7 Logging, § 8 contract notes, § 9
- **Scope:** log-spy e2e over every mutation route; an audit-coverage test (audit rows per DD-15: an edit writes one `update` row; each grant/revoke, scope change, exclusion action, deactivation, reactivation and resend its own row; none on refusal); docs: `server/src/users/AGENTS.md`, `server/src/config/AGENTS.md`, `.env.example`, `docs/infrastructure.md` § 6 (new env, IAM), TRD pending items for `staging` (§ 5.1, § 6) recorded in `execution.md`; contract notes for the front (§ 8) as a short markdown in the spec folder.
- **Tests:** as scope.
- **Verification:** server command + `pnpm test:e2e --reporter=dot`
- **Falsifier:** log the created email in the decision line → the log-spy test goes red; skip the audit on `activate` → the coverage test goes red.
- **Red run:** n/a for docs; the two tests fail when the mutation is applied (falsifier run is the evidence).
- **Disqualifier:** a log spy that only captures one logger.
- **Consumers:** none.
- **Review:** checklist — tests + docs.
- **Done when:** both tests green with falsifiers executed; docs updated; contract note written.
- **Skills:** nestjs-expert, api-design-principles

## T-10: HITL validation (shared DB, real pool, real catalogs)
- **Status:** [x]
- **Size:** S
- **Depends on:** T-9; a human applies migration `0001` on `qadb`
- **Requirements:** FR-2 real Cognito (new / existing / email received), FR-7 last admin under real MySQL locking, FR-11 real catalogs, NFR-4 (p95 ≤ 300 ms, ≥ 200 requests, 500 users — or record the spread), P-7, P-10, P-13
- **Design refs:** § 11 UNVERIFIED rows
- **Scope:** with the user: apply the migration (human); run the read-only queries for P-7 and P-13; create one custom user new to the pool and one existing; resend; check the invitation email; exercise two concurrent admin demotions; call the three catalogs; measure the list. Record outcomes in `execution.md`; refuted premises → Pivot.
- **Tests:** manual checklist above.
- **Verification:** each premise row gets "confirmed" or "refuted"; each check has its observation.
- **Falsifier:** a second concurrent demotion that succeeds refutes DD-3 on real MySQL.
- **Red run:** n/a (no test gate)
- **Disqualifier:** NFR-4 measured with fewer than 200 requests or an empty table — report the spread instead of a pass.
- **Consumers:** none.
- **Review:** checklist — recorded evidence only.
- **Done when:** all UNVERIFIED rows settled and recorded.
- **Skills:** none required

---

## Coverage (scenario and clause level)

| Requirement | Scenario / clause | Task |
|---|---|---|
| FR-1 | Non-admin 403 · BUT no existence leak · No token 401 | T-8 (T-2 for catalog routes) |
| FR-2 | SSO (no Cognito; first login links) | T-6 (P-1), T-10 |
| FR-2 | Custom new (account + email) · existing (BUT account unchanged; `existing-account`) | T-5, T-6, T-10 |
| FR-2 | Validation fields · 409 email/nickname · BUT no record on failure · PROGRAM refused | T-6 (T-3 rule, T-1 unique index), T-8 (HTTP) |
| FR-2 | Cognito unavailable → 503, no record | T-5, T-6 |
| FR-3 | Mixed roles · Assessor+Lead same type incl. all → 409 · All covers future types | T-3 |
| FR-3 | Replacing roles · BUT unchanged grants not re-issued | T-6 |
| FR-4 | Manual exclusion (wins over scope) · remove (history) · dismiss reporting (AND IT MUST reason) · unknown program | T-3 (wins; ADMIN exempt, DD-13), T-4 (storage), T-6 (behavior) |
| FR-5 | Email immutable · name only before first sign-in · 404 | T-6, T-8 |
| FR-6 | Same instance immediately · other instances ≤ 60 s | T-4 (cache), T-6 (invalidate) |
| FR-7 | Deactivated: login 403 · refresh fails · BUT Cognito untouched · history keeps names | T-6 |
| FR-7 | Last admin incl. self · AND IT MUST hold concurrently | T-4 (lock), T-6 (rule), T-10 (real MySQL) |
| FR-8 | Resend · not applicable | T-5, T-6, T-10 |
| FR-9 | Search/filters · team by default, GUESTs by filter · AND IT MUST cursor 50/200 | T-7, T-8 |
| FR-10 | Detail + exclusion history | T-7, T-8 |
| FR-11 | Catalogs · upstream down 503 · BUT stale ≤ 24 h MAY | T-2, T-10 |
| FR-12 | Non-admin sees nickname only · own profile nickname | T-8, T-9 (rule recorded) |
| FR-13 | Every action audited · BUT none on refusal | T-4, T-6, T-9 |
| FR-14 | ADMIN grants everything, future included | T-3 |
| NFR-1 | 100 % 403 for non-admins | T-8 |
| NFR-2 | No PII/credentials in logs | T-5, T-9 |
| NFR-3 | 503 within 10 s | T-2, T-5 |
| NFR-4 | List p95 ≤ 300 ms | T-10 |
| NFR-5 | Unique email/nickname, one active grant/exclusion, last admin under concurrency | T-1, T-3, T-4, T-10 |
