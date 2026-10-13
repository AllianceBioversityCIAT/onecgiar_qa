# Cognito-native authentication and session — Execution Log

## 1. Document Control

| | |
|---|---|
| Spec path | `docs/specs/auth/cognito-native-session` |
| Branch | `feat/auth-cognito-session` |
| Approval Mode | gated |
| Leader model | Opus 5.5 (T1) |
| Implementer / Reviewer | `akili-implementer` (T2 wrapper) / `akili-reviewer` (T3 wrapper) |
| Persona drift | `akili doctor --agents` — no drift (2026-10-13) |
| Started | 2026-10-13 |

## 2. Task Execution History

### T-1: Bootstrap the API surface and auth configuration — PASS (attempt 2)

- **Date:** 2026-10-13
- **Attempt 1** (effort `medium`; skills nestjs-expert, nestjs-best-practices, error-handling-patterns — as listed in the task)
  - **Pre-check (infrastructure § 6):** node v22.23.2 · pnpm 10.6.5 · `server/.env` present. The e2e suite needs no DB (lazy pools, dummy env in `vitest.config.e2e.ts`).
  - **Files changed (per checkpoint *Tree state*, confirmed in the working tree):**
    - added: `server/src/common/configure-app.ts`, `server/src/common/http-exception.filter.ts`, `server/src/config/auth.config.ts`, `server/src/config/env.validation.spec.ts`
    - modified: `server/src/config/env.validation.ts`, `server/src/main.ts`, `server/src/app.module.ts`, `server/src/app.controller.ts`, `server/src/app.controller.spec.ts`, `server/test/app.e2e-spec.ts`, `server/vitest.config.e2e.ts`, `server/.env.example`, `server/package.json`, `server/pnpm-lock.yaml`
    - deleted: `server/src/app.service.ts`
  - **Checkpoint 1:** `STATUS: CHECKPOINT`. Bound reached: neither a loop bound nor the call bound; the environment blocked the heavy commands.
    - Done: the full scope. Passing: `pnpm lint`, `tsc --noEmit`, and `pnpm test --reporter=dot` (28 passed).
    - Remaining: `pnpm test:e2e`, `pnpm build`, the CORS falsifier, and the e2e red run.
    - Tried and failed: every `pnpm test:e2e` and `pnpm build` call (about 8) was blocked by the `resource-guard` hook, because free RAM was under 4500 MB. `RG_FORCE=1` needs the user's authorization.
    - Notes: no Pivot flag.
  - **Blocker:** the `resource-guard` hook stops `pnpm build` and `pnpm test:e2e`.
    - Leader probe ("Deferring a check"): about 3842 MB was free, inactive or speculative, which is under the 4500 MB floor. The blocker is confirmed.
    - Under the Step 2.3 *Precedence* rule, a checkpoint that names a blocker is handled as a blocker. T-1 is set to `[~]` and escalated to the user.
  - **Red run (unit, pre-change code):** 23 failures. Examples:
    - `TypeError: parseAllowedOrigins is not a function`
    - `AssertionError: expected [Function] to throw an error`, for each new missing var and for `http://evil.com`
    - The e2e red run was not obtained.
  - **Falsifier 1 (dropped `COGNITO_CLIENT_ID`):** executed and reverted. It went red with 3 failed / 25 passed, including `names COGNITO_CLIENT_ID when it is missing`. After the revert, 28 passed.
  - **Falsifier 2 (CORS `origin: true`):** not executed, because it needs the e2e suite.
  - **Implementer judgment calls (carried verbatim in summary):**
    - `ALLOWED_ORIGINS` entries must equal their own `URL.origin`. A bare `http://localhost` with no port is rejected.
    - `requestId` is the client's `x-request-id` when it matches `[A-Za-z0-9._-]{1,64}`, else `randomUUID()`. It is echoed in the response header.
    - Validation arrays are mapped to `{message:'Validation failed', details}`.
    - Unknown errors return a generic 500.
    - `trust proxy` is 1, set in `configureApp`, which `main.ts` and the e2e test share.
    - `/health` has no `@Public()`, because that decorator arrives in T-5.
    - `SEED_ADMIN_EMAIL` is commented in `.env.example`.
    - `app.service.ts` was deleted as unused.
  - **Reviewer:** not run, because no completion report was received.
  - **Evidence re-run:** not run, for the same reason.
- **checkpoints:** 1 (environment block: resource-guard RAM floor)
- **spawns:** implementer 29 calls (host-reported; the worker self-reported ~45), 89272 tokens, ended checkpoint
  - **Respawn after checkpoint 1:** the user asked to retry. The Leader probe found ~5.9 GB free. A fresh Implementer finished the Remaining items.
    - It ran lint, build, unit (28/28) and e2e (10/10).
    - Falsifier 2 (CORS `origin: true`) turned 2 tests red: `returns no CORS allow headers for a disallowed origin` and its preflight twin. Both failed with `expected 'https://evil.example.com' to be undefined`. After the revert, e2e passed 10/10.
    - E2E red run, in a HEAD worktree: `Error: Cannot find module './../src/common/configure-app.js'`. This is a failure at module load.
    - The report carried a `Not Done / Assumptions` field with assumptions only, verbatim:
      > "The e2e red run shows a module-load failure rather than named assertion failures. Capturing named assertions would need a shim for `configureApp` in the worktree. I judged that not worth faking."
      >
      > "I did not re-check the CORS test's no-`Origin` disqualifier beyond the falsifier."
    - No owed item and no blocker, so this was not a continuation.
  - **Evidence re-run (Leader-inline, non-author):** VERIFIED. lint exit 0 · `nest build` clean · unit 28/28 · e2e 10/10.
  - **Reviewer verdict (attempt 1): FAIL** (verbatim):
    > **Discovered Issue:** The recorded e2e red run failed at setup, not on an assertion. The evidence is `Error: Cannot find module './../src/common/configure-app.js'`, which happens when the module loads, before any test runs. Falsifier 2 gives an assertion-level red only for the disallowed-origin pair. Three of the task's e2e tests have never been seen failing for the right reason:
    > - health 200 at `/api/v1/health`
    > - the allowed origin echoed with credentials
    > - the 404 error envelope
    >
    > The Implementer listed this as an assumption, so it was not resolved.
    >
    > **Violated Rule:** `docs/specs/auth/cognito-native-session/tasks.md` T-1 **Red run**: "tests written first fail on the current code (no `/api/v1/health`, no CORS) — record the failing assertion." Also the Reviewer contract (Red Run & Mutation Trace): a red run must fail "on the behavioral assertion (not on setup …)".
    >
    > **Remediation Suggestion:** Code stays as it is. In the HEAD worktree, add a stub `src/common/configure-app.ts` that exports `configureApp(){}` and `API_PREFIX`, then run the new `test/app.e2e-spec.ts` against it. Record the named failing assertions, which should be:
    > - health: expected 200, got 404
    > - allowed origin: `access-control-allow-origin` expected `https://qa.example.org`, got undefined
    > - envelope: `requestId` missing, or `toEqual` mismatch
    >
    > Then delete the stub and append the output to `execution.md`.
  - **ADVISORY (attempt 1 Reviewer; recorded, not gating):**
    - Risk: there is no `Vary: Origin` header.
    - Reliability: `requestId` only exists inside the exception filter, so it should move to middleware by T-5/T-8 (NFR-7).
    - Readability: `configureApp` and `useGlobalFilters` deviate from design § 4, which places the wiring in `main.ts` and the filter in `app.module.ts`. Record it as a deviation.
    - Reliability: there is no `ValidationPipe` rejection test yet, so T-8 must cover `forbidNonWhitelisted`.
    - Resilience: the filter can pass a non-string `message` into the envelope.
    - Reliability: the localhost unit test should assert `not.toThrow()`.
  - **Decision:** the code is accepted as-is, and DD/§ 4 deviation is noted: setup lives in `common/configure-app.ts`. It is shared by `main.ts` and the e2e suite so the e2e exercises the real bootstrap.
- **Attempt 2** (effort `high`, bumped after the FAIL; same skills). Feedback is the attempt-1 FAIL, verbatim. Scope is evidence only: an assertion-level e2e red run.
  - **Files changed (attempt 2):** none in the checkout. This attempt was evidence only, run in a throwaway HEAD worktree that was then removed. The same 16 paths as attempt 1.
  - **Implementer verification:** e2e red run at HEAD `607dc0b`, with the new spec and a no-op `configureApp` stub (`export const API_PREFIX='api/v1'; export function configureApp(_app){}`). 7 failed / 3 passed:
    - `GET /api/v1/health` → expected 200, got 404 (:30)
    - `GET /` no longer served → expected 404, got 200 (:35)
    - allowed-origin GET → expected 200, got 404, at the status check before the header checks
    - allowed-origin preflight → expected 204, got 404
    - Helmet → `expected undefined to be 'nosniff'` (:85)
    - 404 envelope → `toEqual` mismatch, `requestId` missing (:93)
    - `x-request-id` echo → `expected undefined to be 'abc-123'` (:105)
    - The disallowed-origin pair and the no-wildcard test pass with nothing to test at red. The disallowed pair is proven by Falsifier 2 (attempt 1). The no-wildcard test is backed only by the exact-echo `toBe` assertion.
    - Green in the main checkout: lint 0 · build clean · unit 28/28 · e2e 10/10.
  - **Implementer Not Done / Assumptions (verbatim, assumptions only, no owed item):**
    > "CORS header assertions were not reached at red. The allowed-origin test and the allowed-preflight test both fail at the status `.expect(...)` (200 and 204, got 404). Execution stops there, so the `access-control-allow-origin` expectation is never evaluated. That differs from the "expected `https://qa.example.org`, got undefined" the remediation predicted. The failure is still behavioral (no `/api/v1/health` route), and the header assertion is covered by green plus Falsifier 2 from attempt 1. I did not change the test, per the brief. If you want the header assertion seen failing at red, the spec would need the status check moved after the header checks. That is a Leader decision."
    >
    > "Three tests pass at red. The disallowed-origin pair and the no-wildcard test pass vacuously, because a 404 with no CORS wiring sends no allow header. They only prove something against Falsifier 2 from attempt 1, which turns the disallowed-origin pair red. The no-wildcard test is not covered by that falsifier."
  - **Evidence re-run (Leader-inline, non-author):** VERIFIED. lint 0 · build 0 · unit 28/28 · e2e 10/10. `git worktree list` shows only the main checkout.
  - **Reviewer verdict (attempt 2): PASS.**
    - The red run now fails on named behavioral assertions, which meets the Red run field.
    - The Disqualifier holds: every CORS test sets `Origin`, and health hits `/api/v1/health`.
    - Both falsifiers stand.
    - Attempt-1 conformance (FR-10 health part, FR-16, FR-18, design § 4/6/7.2/9, DD-9, TRD § 6/10/11) still stands.
  - **ADVISORY (attempt 2 Reviewer, labeled advisory, not gating):**
    - Reliability: no run has shown the allowed-origin header check failing. Option: a falsifier that removes `enableCors` while keeping the route, or assert the headers before the status.
    - Readability: the no-wildcard test is redundant with the exact-echo `toBe`. Drop it, or comment that it documents the FR-16 "BUT no `*`" clause.
    - Risk: the disallowed-origin pair passes vacuously at red. Keep the Falsifier 2 result paired with the red run, as recorded above.
- **Final status:** PASS (attempt 2 of 3)
- **checkpoints:** 1 (environment block: the resource-guard RAM floor; respawned on the user's "Intenta de nuevo")
- **spawns:**
  - implementer: 29 calls, 89272 tokens, ended checkpoint
  - implementer: 11 calls, 64797 tokens, ended partial (assumptions only)
  - reviewer: 13 calls, 47827 tokens, ended fail
  - implementer: 10 calls, 56896 tokens, ended partial (assumptions only)
  - reviewer: 5 calls, 26634 tokens, ended complete
- **runtime events:** none
- **Requirements covered:** FR-16 (both scenarios, no `*`), FR-18 (missing vars named; https-or-localhost), FR-10 (public list, health part; `@Public` is owed by T-5)
- **Decisions made:**
  - The bootstrap (prefix, helmet, cookie-parser, ValidationPipe, CORS, trust proxy, global filter) lives in `server/src/common/configure-app.ts`. `main.ts` and the e2e suite both use it, so the e2e exercises the real bootstrap. This deviates from design § 4, which puts the wiring in `main.ts` and the filter in `app.module.ts`.
  - `app.service.ts` was deleted as unused.
  - `requestId` is the client's `x-request-id` when it matches `[A-Za-z0-9._-]{1,64}`, otherwise `randomUUID()`.
- **Forward pointers (to carry into later briefs):**
  - T-5: mark `/health` with `@Public()`.
  - T-5/T-8: move `requestId` generation into request middleware so every auth log line carries it (NFR-7). This is a T-1 attempt-1 advisory.
  - T-8: ValidationPipe 400 tests must cover `forbidNonWhitelisted`. This is also a T-1 attempt-1 advisory.
- **Issues encountered:** the `resource-guard` hook blocked build and e2e at under 4.5 GB free RAM (checkpoint 1). It cleared at about 5.9 GB.
- **Final verification:** `cd server && pnpm lint && pnpm build && pnpm test --reporter=dot` + `pnpm test:e2e --reporter=dot` → all green (28 unit, 10 e2e).

## Constitution Impact: T-1

- **Module reshaped:** the API surface. All routes now sit under `/api/v1`, and `GET /` is replaced by `GET /api/v1/health`. A new `server/src/common/` folder holds the bootstrap and the error filter.
- **Child guide:** none needed yet.
- **Pending shared-doc sync (apply on `staging`, not on this branch):**
  - `docs/infrastructure.md` § 6, Health check row: `curl -s localhost:3000` → `curl -s localhost:3000/api/v1/health`.
  - The same row's `/api/health` note → `/api/v1/health`.
  - New required env vars: `COGNITO_*`, `MS_AUTH_*`, `ALLOWED_ORIGINS`.
- **CodeGraph re-index:** n/a (not initialized).

### T-2: Users, roles and role-assignments schema + migration — PASS (attempt 1)

- **Date:** 2026-10-13
- **Attempt 1** (effort `high`, set because the schema is a shared, hard-to-undo boundary; skills nestjs-expert, nestjs-best-practices, as the task lists). It ran serially after T-1. T-4 was not run in parallel: they share `dist/`, and the RAM guard had already blocked builds once.
  - **Files changed:**
    - `server/src/database/drizzle/schema/{users,roles,role-assignments,schema.spec}.ts` (new), `schema/index.ts` (modified)
    - `server/drizzle/0000_silent_risque.sql`, `server/drizzle/meta/{_journal.json,0000_snapshot.json}` (generated)
    - `docs/specs/auth/cognito-native-session/design.md` § 5 (execute-time spec edit, below)
  - **Implementer verification:**
    - lint 0 · build clean · unit 41/41 (3 files)
    - `pnpm db:generate` ran offline and produced exactly one migration
    - Falsifier 1 (`active_key` unique index removed, migration regenerated) went red: `expected [] to deep equally contain [ 'active_key' ]` plus the `UNIQUE` regex.
    - Falsifier 2 (email CHECK removed) went red: `expected [] to include 'chk_users_email_lowercase'`.
    - Both were reverted. `drizzle/` is byte-identical afterwards (`diff -r` clean).
  - **Implementer Not Done / Assumptions (verbatim):**
    > "`pnpm db:migrate` and the DB behavior checks (P-15) are not run. If the user declines the `qadb` migration, P-15 carries to T-11."
    >
    > "I wrote column references in the generated column and the CHECKs as unqualified `sql.identifier(...)`. drizzle's `${t.col}` form emits `` `table`.`col` `` inside constraints, and I could not confirm MySQL accepts that. There is no local MySQL, so this is untested against a server. If `db:migrate` errors on the CHECKs or the generated column, report it as a spec gap; do not hand-edit the SQL."
    >
    > "`updated_at` uses `.$onUpdate(() => new Date())`, which only applies to writes made through drizzle. This is not DB-level, because drizzle's mysql `datetime` has no `onUpdateNow()`. Writers go through repositories, so I left it."
    >
    > "`uniqueIndex('uq_role_assignments_active_key')` is emitted by drizzle-kit as `CONSTRAINT … UNIQUE(active_key)`. It is still a unique index in MySQL."
    >
    > "Lookup note: TRD § 5.1 and § 13 and the UX/UI design were not read. The brief only reminded me that the design supersedes `role_grants`, and I did not edit the TRD."
    - The owed item (the HITL migrate and probe) belongs to the Leader's HITL gate by the task's own Scope. It is not an Implementer continuation.
  - **Evidence re-run (Leader-inline, non-author):** VERIFIED. lint 0 · build 0 · unit 41/41 · one migration file.
  - **Reviewer verdict: PASS.**
    - All three tables conform to design § 5, DD-7 and DD-8, and to TRD § 13 (generated, not hand-edited).
    - The red-run trace holds.
    - Named check: the § 5 email CHECK amendment holds. The default `utf8mb4_0900_ai_ci` makes `email = LOWER(email)` always true. The binary-cast form is byte-wise and deterministic, and the meaning of FR-1 is unchanged.
    - The HITL script would prove all three behaviors once the migration is applied.
  - **ADVISORY (labeled advisory, not gating):**
    - Risk (HITL): add a probe that ties the results to the applied migration. Query `information_schema.TABLE_CONSTRAINTS` and `__drizzle_migrations`, and record the `email` column collation.
    - Risk (HITL): before migrating, check that `qadb` has no `users`, `roles` or `role_assignments` tables. A name collision must never be fixed with a drop (P-17).
    - Risk (migrate): MySQL forbids FK referential actions on CHECK and generated-column base columns. The emitted `no action` should be allowed; if it is rejected, it is a spec gap.
    - Reliability: the T-3 repository should normalize `cognito_sub` `''` to NULL and reject `result_type_key` `''`.
    - Reliability: `updated_at` is only bumped by drizzle writes. Consider DB-level `ON UPDATE`.
    - Readability: the test name "unique index on active_key only" doesn't assert "only".
    - Risk (pending): the TRD § 5.1 `role_grants` update stays pending on `staging`.
- **Decisions made:**
  - **Execute-time spec edit:** `design.md` § 5, `users.email` row. The CHECK `email = LOWER(email)` becomes `CAST(email AS BINARY) = CAST(LOWER(email) AS BINARY)`. Reason: under the default case-insensitive collation the literal form enforces nothing. The meaning (FR-1 "stored lowercase") is unchanged. This check is carried into the next Reviewer brief.
- **Forward pointers:**
  - T-3: normalize `cognito_sub` `''` → NULL, and reject `''` scope values in repository scope validation (T-2 advisory).
- **HITL step (approved by the user via the AskUserQuestion gate, 2026-10-13, "Sí, aplicar y probar"):**
  - **Read-only pre-check:** `qadb` is MySQL `8.0.45-0ubuntu0.22.04.1`, database collation `utf8mb3_general_ci`. There were **no tables** before the migration, so there was no collision risk.
  - **`pnpm db:migrate`:** `migrations applied successfully!`. `__drizzle_migrations` holds 1 row (hash `71a74269…f21a8`).
  - **Applied constraints** (`information_schema.TABLE_CONSTRAINTS`):
    - `users`: `chk_users_email_lowercase`, `uq_users_email`, `uq_users_cognito_sub`, `users_created_by_users_id_fk`
    - `roles`: `uq_roles_code`
    - `role_assignments`: `chk_role_assignments_one_scope`, `chk_role_assignments_revocation`, `uq_role_assignments_active_key`, and 4 FKs
  - **`users.email` column:** charset `utf8mb3`, collation `utf8mb3_general_ci` (case-insensitive). This confirms the § 5 amendment was necessary.
  - **Probe script** (`t2-hitl.sql`, one transaction + ROLLBACK, run statement by statement through mysql2) — observed results:
    - 1a: insert KP, `active_key = '2:1:KP:'` → OK
    - 1b: duplicate active → **ERR 1062** Duplicate entry `'2:1:KP:'` for key `uq_role_assignments_active_key` ✅
    - 1c: different scope (IPI) → OK
    - 2a: revoke → OK, `active_key` = NULL
    - 2b: re-grant KP → **OK**, and `kp_rows = 2` (the revoked row is kept) ✅
    - 3a: `T2Probe-Upper@…` → **ERR 3819** `chk_users_email_lowercase` ✅
    - 3b: lowercase → OK
    - 3c: duplicate email → ERR 1062 `uq_users_email`
    - 4a: both scope columns set → ERR 3819 `chk_role_assignments_one_scope`
    - 4b: inactive without revocation data → ERR 3819 `chk_role_assignments_revocation`
    - 4c: active with revocation data → ERR 3819 `chk_role_assignments_revocation`
    - after ROLLBACK, leftovers: users 0, roles 0, assignments 0
  - **P-15: CONFIRMED.** MySQL 8.0.45 enforces the CHECK constraints and the unique index on the stored generated column.
  - **DB-level falsifier:** not executed. It would require altering the shared `qadb` schema (P-17). The test-level falsifiers (attempt 1) and the enforcement probe above stand in for it.
- **Final status:** PASS (attempt 1 of 3)
- **spawns:**
  - implementer: 24 calls, 86654 tokens, ended partial (the owed item is the Leader's HITL step)
  - reviewer: 10 calls, 41849 tokens, ended complete
- **runtime events:** none
- **Requirements covered:** FR-1 (Unique identity; duplicate active assignment, DB part; revocation keeps history, CHECK part)
- **Issues encountered:**
  - The `qadb` default charset is `utf8mb3`, so the new tables inherit it, which means no 4-byte characters (for example emoji in names).
  - The design does not set a charset. Noted as an advisory for a later spec, with no change in this task.
- **Final verification:** server command green (lint 0 · build 0 · unit 41/41) plus the HITL probes above.

### T-3: Users module — repositories, seeds and authorization — PASS (attempt 1)

- **Date:** 2026-10-13
- **Attempt 1:** effort `high`, chosen because this is the authorization core and scope leaks are security defects. Skills were nestjs-expert and tdd, as the task lists. The two T-2 forward pointers were carried in the brief.
  - **Files changed:**
    - Production: `server/src/users/{permissions,authorization.service,users.errors,users.repository,role-assignments.repository,users.module}.ts` and `server/src/database/seeds/seed.ts`.
    - `server/package.json`: `db:seed` = `nest build && node dist/database/seeds/seed.js`.
    - Test support: `server/test/support/in-memory-stores.ts`.
    - Specs: `authorization.service.spec.ts`, `role-assignments.repository.spec.ts`, `users.repository.spec.ts`, `users.module.spec.ts`, `database/seeds/seed.spec.ts`.
  - **Implementer verification:**
    - lint 0, build clean, unit 195/195 across 8 files.
    - The compiled seed with `DATABASE_URL` unset printed `DATABASE_URL is required` and exited 1.
  - **Red runs:**
    - `can`/`canAny` against a stub returning false: 24/76 failed with `expected false to be true`.
    - Against a stub returning true: 53/76 failed, including `LEAD(ID) no lead on KP`, `PROGRAM(12) denied program 13` and `PROGRAM(12) denied without a program (fail closed)`.
    - Repository stubs: 58/141 failed on assertions, e.g. `expected '' to be null` and `expected 'Jane.Doe@CGIAR.org' to be 'jane.doe@cgiar.org'`.
    - Seed: no red run, because it was written code-first. Mutations stood in for it.
  - **Falsifier 1** (LEAD expansion ignores the result type key): 6 failed, including `LEAD(ID) no lead on KP` and `union: no lead on KP`, each with `expected true to be false`.
  - **Falsifier 2** (missing context returns true): 9 failed, including `ASSESSOR(KP) denied assessor without a result type (fail closed)` and `PROGRAM(12) denied without a program (fail closed)`.
  - **Seed mutations:**
    - A (insert roles on every run): 3 failed, including `changes nothing when run again`.
    - B (stop swallowing the duplicate-assignment error): 1 failed.
    - Both were reverted.
  - **Implementer Not Done / Assumptions** (verbatim, assumptions only; the owed item is the Leader's HITL seed run):
    > "**Seed idempotency is shown only on in-memory fakes.** The Drizzle adapters were not exercised against MySQL. That covers duplicate-key detection (`ER_DUP_ENTRY` / errno 1062, direct or as a `cause`), `insertId` read-back and `affectedRows` on revoke. The HITL seed run on `qadb` settles them."
    >
    > "**Permission names were my call.** § 7.1 names no concrete permissions, so I added one per group (`ADMIN_ACCESS`, `TPB_ACCESS`, `PPU_ACCESS`, `ASSESSOR_ACCESS`, `LEAD_ACCESS`, `PROGRAM_ACCESS`) plus `READ`. `can(READ)` and `canAny(READ)` are true for any subject; the route guard handles `@ReadAccess()` anyway. LEAD_ASSESSOR lists `ASSESSOR_ACCESS` in its grants, so the expansion always shares the lead's own key."
    >
    > "**Files outside the scope list:** `users.errors.ts` (typed errors on Nest HTTP exceptions, so the existing filter maps them; also `isDuplicateKeyError`) and `test/support/in-memory-stores.ts` (the fake DB ports)."
    >
    > "**`UsersModule` is not imported by `AppModule`.** That belongs to a later task; a DI spec with a faked `DrizzleModule` proves it resolves."
    >
    > "**Seed behavior:** roles are inserted only when missing, and an administrator-deactivated role is never reactivated. An existing role stored with a different `scope_type` aborts the run. An empty or whitespace `SEED_ADMIN_EMAIL` counts as absent. An existing admin user is left as it is; only a missing active ADMIN assignment is added. The whole seed runs in one transaction."
    >
    > "**Revocation also checks `revokedAt`.** `can` and `canAny` deny an assignment when `isActive` is false or `revokedAt` is non-null, as defense in depth."
  - **Evidence re-run (Leader-inline, non-author):** VERIFIED. lint 0, build 0, unit 195/195.
  - **Reviewer verdict: PASS.**
    - FR-1 (service part), FR-2 and FR-3 are met, and both T-2 pointers are handled.
    - `can`/`canAny` fail closed on every path traced. The LEAD → ASSESSOR expansion is bound to the assignment's own key, and no scope leak was found.
    - The table includes the disqualifier's negative rows.
    - The named check (design § 5 email amendment) holds: `normalizeEmail` runs on write and on lookup.
  - **ADVISORY (labeled advisory, not gating):**
    - Reliability: `findOrCreateByEmail` re-reads after losing a race inside REPEATABLE READ, so it may not see the winning row. Use `FOR UPDATE` or READ COMMITTED. This is a forward pointer to T-7 (DD-10).
    - Spec drift: design § 5 says "upsert" roles, but the seed inserts only the missing ones and aborts on a `scope_type` mismatch. This is recorded as an interpretation below.
    - Reliability: JS `toLowerCase` and MySQL `LOWER` differ on some non-ASCII characters, and email validation is minimal. Tighten it at the DTO edge in T-8.
    - Risk: the seed grants ADMIN to an inactive existing user without a warning.
    - Proportionality: about 100 LOC of forward surface has no consumer yet (`findByCognitoSub`, `findById`, `cognitoUsername` and name inputs, `findActiveViewsByUserId`, the seed scope abort, `formatReport`, upper bounds). All of it is tested.
    - Error design: HTTP-status-bearing domain errors are acceptable under TRD § 11. There is a trade-off with § 2.3's hexagonal edges.
    - Readability: move `AssignmentView` out of `authorization.service.ts`.
    - The Drizzle adapters have not run against MySQL. The HITL seed run covers the role and user paths, but not revoke or re-grant.
- **Decisions made:**
  - Design § 5 says "upsert the six roles by `code`". This is interpreted as insert-if-missing plus an abort on a `scope_type` mismatch, never an overwrite. It keeps FR-2's "running it again changes nothing" literal and never reactivates an admin-deactivated role. No spec edit.
- **Forward pointers:**
  - T-7: the admission concurrent-first-login re-read must use a locking read or READ COMMITTED (T-3 advisory).
  - T-8: tighten email validation at the DTO edge (T-3 advisory).
- **Budget tripwire (design § 2: 11 tasks · ~1,600 LOC · ~17 Reviewer passes):**
  - After T-3, the server diff is about 3,000 LOC: 786 committed for T-1 and T-2, plus about 2,240 for T-3, of which about 770 is production and about 1,370 is tests.
  - Reviewer passes so far: 4 of about 17.
  - Cause: the table-driven `can()` suite the task requires (629 lines), the repository ports with in-memory fakes, the defensive seed, and about 100 LOC of forward surface.
  - Escalated to the user before closing T-3.
- **User decisions (AskUserQuestion gate, 2026-10-13):**
  - Budget: "Re-estimar y seguir".
  - Seed: "Solo roles".
- **Re-baselined budget, replacing design § 2 for the tripwire:**
  - 11 tasks · about 5,500 LOC (about 2,000 production and 3,500 tests) · about 22 Reviewer passes.
  - The next tripwire fires against these numbers.
- **HITL seed on `qadb` (roles only, `SEED_ADMIN_EMAIL` unset and absent from `.env`):**
  - Run 1, `pnpm db:seed`: `roles: 6 created, 0 already present` and `admin: skipped (SEED_ADMIN_EMAIL is not set; the first ADMIN was not seeded)`.
  - Run 2, `node dist/database/seeds/seed.js`: `roles: 0 created, 6 already present` and the same admin skip. FR-2 idempotency is **confirmed on MySQL**.
  - `roles` now holds ADMIN (global), LEAD_ASSESSOR (result_type), ASSESSOR (result_type), TPB (global), PPU (global) and PROGRAM (program), all active.
  - `users` = 0 and `role_assignments` = 0.
  - Role ids start at 2 because the rolled-back T-2 probe advanced the auto-increment. This is harmless.
  - The first-ADMIN seed path and the revoke and re-grant adapter paths are not yet exercised on MySQL. They are carried to T-11.
- **Final status:** PASS (attempt 1 of 3)
- **spawns:**
  - implementer: 30 calls, 145531 tokens, ended partial (assumptions plus the Leader's owed HITL step)
  - reviewer: 16 calls, 70249 tokens, ended complete
- **runtime events:** none
- **Requirements covered:** FR-1 (service part: scoped acceptance, rejection of program id or missing key, rejection of a scoped global role, duplicate, revocation), FR-2 (both scenarios; roles idempotency confirmed on MySQL), FR-3 (all four scenarios)
- **Final verification:** server command green (lint 0 · build 0 · unit 195/195) plus the HITL seed runs above.

### T-4: Token verifier — PASS (attempt 1)

- **Date:** 2026-10-13
- **Attempt 1:** effort `high` (security boundary). Skills nestjs-expert and aws-serverless, as listed.
  - **Files changed:** `server/src/auth/token-verifier.service.ts` and `server/src/auth/token-verifier.service.spec.ts` (both new).
  - **What the service does:**
    - Exports `TokenVerifier`, `InvalidTokenError` (401, generic message) and the `JWKS_CACHE` DI token.
    - Builds two `CognitoJwtVerifier`s, access and id, each with `clientId` and `tokenUse`, sharing one JWKS cache.
    - Warms the JWKS at `onApplicationBootstrap`. A warm-up failure is logged and retried on first use.
    - Logs a rejection by its error class name only.
  - **Implementer verification:** lint clean · build 0 · unit 218/218 (9 files).
    - The resource-guard blocked the combined command twice, so the three commands were run separately. `RG_FORCE` was not used.
  - **P-13: VERIFIED (YES).** aws-jwt-verify 5.2.1 supports it:
    - `CognitoJwtVerifier.create(props, { jwksCache })` and `cacheJwks(jwks)`, in `cognito-verifier.d.ts`.
    - `SimpleJwksCache` with `addJwks` and a custom `fetcher`, in `jwk.d.ts` and `https.d.ts`.
    - The tests inject a pre-loaded `SimpleJwksCache`, and the warm-up tests use a fake `Fetcher`. There is no network access and no local HTTP stub.
  - **Red run** (stub resolving `{}`, exports kept): 22 of 23 failed.
    - Examples: `expected undefined to be 'user-sub-1'`; `promise resolved "{}" instead of rejecting`, once per rejection case; `expected +0 to be 2` (warm-up); `TypeError: error.getStatus is not a function`.
    - The no-token-logging test passed vacuously, because it checks a negative property.
  - **Falsifier 1:**
    - Dropping `clientId` literally is impossible: the library requires the option to be set or `null`, and dropping it turned 4 tests red but not the target test.
    - With `clientId: null`, 2 tests went red: `rejects a token from another app client with InvalidTokenError` (`promise resolved "{ sub: 'user-sub-1', …(9) }" instead of rejecting`) and `maps rejections to a 401 without revealing the reason`.
  - **Falsifier 2** (`tokenUse: null`): 1 test went red, `rejects an id token with InvalidTokenError`.
  - Both falsifiers were reverted, and the file is byte-identical afterwards.
  - **Implementer Not Done / Assumptions (verbatim, assumptions only):**
    > "**Two warm-up fetches:** `hydrate()` fetches two JWKS URIs, because the library accepts both Cognito issuer formats (`cognito-idp.<region>` and `issuer-cognito-idp.<region>`). The warm-up test asserts 2 fetches and no further fetches during verification. Also covered: a refetch on an unknown `kid` (TRD § 9) and a retry on first use after a failed warm-up."
    >
    > "**Exception class in this file:** I put `InvalidTokenError` here rather than a separate errors file, to stay inside the scoped file list. T-5's guard can import it from here."
    >
    > "**P-12 unchanged:** the id-token claim names `cognito:username`, `aud` and `token_use` are still UNVERIFIED until T-11. My test tokens use the claim names from the library's typings."
    >
    > "**Resource-guard:** it blocked the combined lint, build and test command twice. I ran the three commands separately, as noted at the top. `RG_FORCE` was not used."
  - **Evidence re-run (Leader-inline, non-author):** VERIFIED. lint 0 · build 0 · unit 218/218.
  - **Reviewer verdict: PASS.**
    - The service conforms to FR-10, design § 7.2 and ADR-003. All rejection cases are tested with real RS256 tokens: expired, other client, id-as-access, same-kid other key, other issuer, `alg none`, garbage, empty, `..`, and undefined.
    - The red run and both falsifiers check out. `clientId: null` is the correct form of the falsifier.
    - On the Leader's question: the issuer is not widened. `cognito-verifier.js:48-75,84-110` builds exactly two issuer configs from QA's `userPoolId`, `cognito-idp` and `issuer-cognito-idp`. Each has its own JWKS URI on the same pool.
  - **ADVISORY (labeled advisory, not gating):**
    - Risk: add tests for an `issuer-cognito-idp` token from another pool, and for a global-format `iss` whose keys sit only in the regional JWKS (keys bound to their issuer).
    - Risk: record a pending TRD note (on `staging`) that the library accepts both issuer formats and fetches two JWKS URIs.
    - Reliability: record P-13 as VERIFIED. Done above.
    - Readability: T-5 must import `JWKS_CACHE` and `InvalidTokenError` from this file, not redefine them.
    - Resilience: the library's default `SimplePenaltyBox` throttles refetches on an unknown kid. Add a comment so nobody swaps in an unthrottled cache.
- **spawns:**
  - implementer: 38 calls, 99515 tokens, ended partial (assumptions only)
  - reviewer: 10 calls, 40263 tokens, ended complete
- **runtime events:** none (the resource-guard blocks were absorbed inside the worker's own loop, with no checkpoint)
- **Requirements covered:** FR-10 (Valid token; Rejections, at the verifier level). The "handler must NOT run" part is owed by T-5.
- **Forward pointers:** T-5 imports `TokenVerifier`, `InvalidTokenError` and `JWKS_CACHE` from `auth/token-verifier.service.ts`, and overrides the verifier in e2e with this local key-set technique (an injected `SimpleJwksCache`).
- **Pending shared-doc sync (on `staging`):** ADR-003 and TRD § 9 JWKS row: note that both Cognito issuer formats are accepted for the same pool, so two JWKS URIs are fetched.
- **Budget (re-baselined):** about 3,500 of about 5,500 LOC · 7 of about 22 Reviewer passes · 4 of 11 tasks.
- **Final verification:** server command green (lint 0 · build 0 · unit 218/218).

### T-5: Global guards, decorators, current-user cache and `/auth/me` — PASS (attempt 1)

- **Date:** 2026-10-13
- **Attempt 1:** effort `xhigh`. These are the global access-control guards, and a fail-open bug here would expose every route. Skills: nestjs-expert, nestjs-best-practices, as the task lists. The brief carried the T-1/T-3/T-4 forward pointers.

**Files changed**
- New:
  - `server/src/auth/{auth.module,authenticated-request,me.controller}.ts`
  - `server/src/auth/guards/{auth,permission}.guard.ts`
  - `server/src/auth/decorators/{public,read-access,require-permission,current-user}.decorator.ts`
  - `server/src/users/current-user.cache.ts` and its spec
  - `server/test/auth-guards.e2e-spec.ts`
  - `server/test/support/jwt-test-keys.ts`, extracted from the T-4 spec byte-identical, plus `localJwksCache()`
- Modified:
  - `server/src/app.module.ts`
  - `server/src/app.controller.ts` (`@Public` on `/health`)
  - `server/src/users/users.module.ts` and its spec
  - `server/src/auth/token-verifier.service.spec.ts` (helper import only)
  - `server/test/app.e2e-spec.ts` (JWKS override only)

**Implementer verification**
- lint 0, build 0, unit 242/242 (10 files), e2e 55/55 (2 files). Consumer suites green.
- `@Controller` grep: at start, only `app.controller.ts` (P-7 holds). After: `AppController` (`/health`, `@Public`) and `MeController` (`/auth/me`, `@ReadAccess`). Probe controllers exist only in the test.

**Red run (HEAD, new modules stubbed, tree untouched):** 36 failed / 9 passed of 45, all on status assertions. The full log is in the session scratchpad (`red-run.keep.txt`). Examples:
- `expected 401 "Unauthorized", got 200 "OK"` for no-token and the 10 rejection variants
- `expected 403, got 200` for GUEST on admin and on undeclared routes
- `/auth/me` gives `expected 200, got 404`

**Falsifiers** (all reverted and diff-verified)
- **Falsifier 1** (PermissionGuard allows undeclared routes): 2 red, `denies a route that declares neither a permission nor the read marker` and `denies an undeclared route even to an ADMIN (no bypass)`. Both: `expected 403 "Forbidden", got 200 "OK"`.
- **Falsifier 2** (AuthGuard ignores `@Public`): 5 red, including `GET /api/v1/health returns 200 { status: "ok" }` with `expected 200 "OK", got 401 "Unauthorized"`.
- **Extra falsifier** (stale-load guard removed): `current-user.cache.spec.ts > invalidate > is not undone by a load that was already in flight` went red.

**Implementer Not Done / Assumptions** (verbatim, assumptions only)
1. **No writer calls `invalidate` yet.**
   - FR-11's "immediately in the same process" rests on `CurrentUserCache.invalidate(userId)`, which is exported and tested.
   - `RoleAssignmentsRepository.create` and `revoke` don't call it, because that would make the repository depend on the cache, which already depends on the repository.
   - T-9 (AdmissionService) and the future admin writers must call it after commit. **[Leader: admission is T-7]**
2. **The JWKS fetch needed a local fetcher.**
   - The verifier's startup warm-up fetches the JWKS even from a pre-loaded `SimpleJwksCache`. My first e2e run took 28 s because every `app.init()` went to the network.
   - I added `localJwksCache()` to `test/support/jwt-test-keys.ts`, which serves the JWKS from memory. Both e2e suites use it, and the suite now runs in about 1 s.
   - `AuthModule` registers `JWKS_CACHE` as a provider (`new SimpleJwksCache()`) so `overrideProvider` works. Production behavior is unchanged.
3. **What counts as a live assignment.**
   - A live assignment is one that is active, not revoked, on an active role, and on a role the permission catalog knows.
   - It decides custom-user admission and which assignments `/auth/me` lists, which is stricter than FR-11's literal wording.
   - The same checks exist inside T-3's `grantingRole`, which I did not edit, so the two could drift.
4. **Decorator precedence.**
   - A declared `@RequirePermission` always wins over `@ReadAccess`, at handler or class level.
   - Handler metadata overrides class metadata within the same decorator.
   - `@Public` at class level makes all of its handlers public.
5. **Edits outside the Scope list.** The edits listed under Files changed (wiring, `auth.module.ts`, `authenticated-request.ts`, the extracted test helper, one `users.module.spec.ts` assertion, the JWKS override in `app.e2e-spec.ts`).
6. **Gaps.**
   - There is no route-inventory test, because the task text doesn't list one.
   - NFR-5 is unmeasured; it belongs to T-10.
   - Prettier flags `server/src/common/http-exception.filter.ts`. That is pre-existing and I left it alone.
   - Not-admitted refusals raise a typed `UserNotAdmittedError` (a 401) so T-8 can use it for reason codes.

**Evidence re-run (Leader-inline, non-author):** VERIFIED. lint 0, build 0, unit 242/242, e2e 55/55.

**Review mode:** parallel lens reviewers, because effort was `xhigh` and the task is an authentication surface. Two lenses were run: Risk (security) and Reliability. Each also checked baseline spec conformance.

**Reviewer verdict, Risk lens: PASS.** No fail-open path was found.
- Bearer extraction is strict, and every verify error maps to 401.
- `@Public` counts only on a strict `=== true`, and each guard checks it on its own.
- `@RequirePermission` takes precedence over `@ReadAccess`. An undeclared route returns 403 even for ADMIN.
- GUEST gets 403 on every action route.
- Cache: the 60 s bound counts from before the reads, users that don't exist are not cached, and an epoch counter blocks stale in-flight loads.
- `/auth/me` copies explicit fields only, and a test pins the key set.
- Guard order is AuthGuard first.

**Reviewer verdict, Reliability lens: PASS.**
- Every FR-10/11/12/15 scenario is genuinely exercised, with handler spies asserting the handler did not run.
- The fake clock tests both the 59 s and 61 s cases. The invalidate e2e test does not pass vacuously.
- Guard order is proven by the GUEST/ADMIN 403 tests.
- The cache TTL boundaries are unit-tested.
- The production `JWKS_CACHE` behaves the same as the verifier's fallback.
- The T-4 helper extraction is byte-identical, and no assertion hunk changed.

**ADVISORY (both lenses; labeled advisory, not gating)**
- Risk/Resilience (both lenses): nothing calls `CurrentUserCache.invalidate`, and no task in `tasks.md` says to. T-7's admission writes (link `sub`, update email and names) would show up only after up to 60 s, which breaks FR-11's "immediately within the same process". **This is a spec tension, raised at the gate. See the Spec tension entry below.**
- Risk/Reliability (both lenses): nothing enforces FR-10's public-route "only" list. Suggested fix: a route-inventory test in T-10, which that task's scope already covers.
- Risk: class metadata is inherited through the prototype chain, so a subclass of a `@Public` controller inherits it. Add a note on `Public`.
- Risk: a handler-level `@RequirePermission` overrides the class-level one, so a class-level permission is a default, not a minimum.
- Risk/Reliability (both lenses): the live-assignment logic is duplicated in `isLiveAssignment` (cache) and `grantingRole` (T-3). Unify them later.
- Reliability: concurrent misses are not merged, and a single `invalidate` drops every in-flight store. Revisit if T-10 shows contention.

**Spec tension (Pivot evidence, lightest grade), for the gate**
- FR-11's "immediately within the same process when the change happens through QA" is mapped only to T-5 in the coverage table. But it can only hold if every QA writer calls `invalidate`.
- In this spec, the writer is T-7 (admission: link `sub`, update email, names and `auth_source`). T-7's text does not mention invalidation.
- Amendment proposed to the user: add to T-7's Scope and Tests "call `CurrentUserCache.invalidate(user.id)` after the admission transaction commits; test that a second resolve or `/auth/me` reflects the change without advancing the clock".

**Forward pointers**
- T-7: `invalidate` after commit, pending the user's answer on the amendment. Also the T-3 locking re-read pointer.
- T-8: carries `UserNotAdmittedError` for reason codes (NFR-7).
- T-10: the route-inventory test covers the FR-10 "only" list.

**Records**
- **spawns:**
  - implementer: 56 calls, 187363 tokens, ended partial (assumptions only)
  - reviewer (risk): 15 calls, 74402 tokens, ended complete
  - reviewer (reliability): 15 calls, 70995 tokens, ended complete
- **runtime events:** none
- **Requirements covered:**
  - FR-10: handler does not run; public list currently `/health`.
  - FR-11: not admitted gives 401; the 60 s freshness bound holds. Same-process invalidation holds at the mechanism level; the writer side is pending T-7.
  - FR-12: all three scenarios.
  - FR-15.
  - NFR-5: measurement belongs to T-10.
- **Budget (re-baselined):** about 5,300 of about 5,500 LOC, which is near the tripwire because T-5 added about 1,770 diff lines. Reviewer passes: 9 of about 22. Tasks: 5 of 11.
- **Final verification:** server command plus e2e, green (lint 0, build 0, unit 242/242, e2e 55/55).

## Gate after T-5: user decisions (AskUserQuestion, 2026-10-13)

- **Spec tension resolved: "Sí, enmendar T-7".** `tasks.md` T-7 is amended as follows:
  - Requirements: + FR-11 (writer side).
  - Scope: + `CurrentUserCache.invalidate(user.id)` after the transaction commits.
  - Tests: + a test that invalidate was called and the change is visible without advancing the clock.
  - Coverage table: the FR-11 row now reads `T-5 (mechanism), T-7 (writer invalidation)`.
  - Consistency sweep: design DD-6 ("invalidated on QA writes") and § 7.1 already state this, so no design edit was needed.
  - Grep sweep for `invalidate` over the spec folder: T-5 is the mechanism and T-7 is the writer.
  - The meaning of FR-11 is unchanged. The amendment makes T-7 own the writer side.
- **Budget: "Re-estimar a ~10,000 LOC".**
  - Measured pace: about 1,000 LOC per task, roughly 1/3 production and 2/3 tests.
  - New tripwire baseline: 11 tasks, about 10,000 LOC, about 25 Reviewer passes.
  - Current position after T-5: about 4,990 LOC, 9 Reviewer passes.

### T-6: Auth microservice client — PASS (attempt 2)

- **Date:** 2026-10-13
- **Attempt 1** (effort `medium`; skills nestjs-expert and error-handling-patterns, as listed). The microservice source of truth was the local checkout `one-cgiar-microservices/auth-microservice` at `bf29541f`, read-only.
  - **Files changed:**
    - `server/src/auth/auth-microservice.client.ts` (new)
    - `server/src/auth/auth-microservice.client.spec.ts` (new)
    - `server/src/auth/auth.module.ts` (provider added)
  - **Implementer verification:** lint 0, build clean, unit 255/255 (11 files, 13 new).
    - Red run against a stub: 13 of 13 failed. Twelve failed on assertions. One failed with `TypeError: Cannot read properties of undefined (reading '1')` (the timeout test).
    - Falsifier 1 (5xx mapped to `InvalidCredentialsError`): `maps a 5xx to UpstreamUnavailableError` went red.
    - Falsifier 2 (response body logged): `never logs bodies, tokens or passwords` went red (`… not to contain 'SECRET-BODY-MARK'`).
    - Both falsifiers were reverted.
  - **Fixture citations:** every route and body cites file:line in `auth-microservice/src` at `bf29541f`. The refresh body `{refreshToken, username}` is marked "per DD-2, pending microservice change".
  - **Implementer Not Done / Assumptions (verbatim, assumptions only):**
    > "**DD-2 refresh:** the real microservice does not accept `username` yet. Until it ships, the client's `refresh` response has not been exercised against a live microservice (T-9 is blocked on it)."
    >
    > "**Refresh token optional:** I made `refreshToken` optional in `RefreshResult`. Today the microservice always returns it, but the DD-2 change is unshipped."
    >
    > "**Challenge scope:** only `NEW_PASSWORD_REQUIRED` is recognised. Any other challenge name is treated as an invalid body (401)."
  - **Evidence re-run (Leader-inline, non-author):** VERIFIED. lint 0, build 0, unit 255/255, e2e 55/55.
  - **Reviewer verdict (attempt 1): FAIL** (verbatim):
    > 1. **Discovered Issue:** The 10 s timeout test does not prove the abort with an assertion.
    >    - In the red run it failed with `TypeError: Cannot read properties of undefined (reading '1')`. That is a setup crash, not an assertion. The test never checks that `fetch` was called before it indexes `mock.calls[0][1]`.
    >    - Mutation trace: delete the `setTimeout(() => controller.abort(), …)` line or raise the timeout above 10 s. The `9_999` check still passes, and `await assertion` never settles under fake timers. The test then goes red only on Vitest's own test timeout.
    >    - So the main NFR-6 mutation, "no timeout", is caught by a timeout and not by a behavioral assertion.
    >    - **Violated Rule:**
    >      - Task T-6 *Red run*: "fixtures-based tests fail before the client exists (assertion level)".
    >      - The reviewer contract § Red Run & Mutation Trace: "not on setup, an intercept, a timeout".
    >      - NFR-6 (requirements.md § 7): "answer 503 within 10 s".
    >    - **Remediation Suggestion:** In `server/src/auth/auth-microservice.client.spec.ts`, timeout test:
    >      - Assert `expect(fetchMock).toHaveBeenCalledTimes(1)` before reading `mock.calls[0][1]`.
    >      - After `advanceTimersByTimeAsync(1)`, assert `signal?.aborted` is `true` before `await assertion`.
    >      - Re-run two mutations and record that each fails on an assertion: (a) remove the abort timer; (b) set `MS_AUTH_TIMEOUT_MS = 20_000`.
  - **Reviewer fixture check:** the fixtures were spot-checked against `bf29541f`. All routes and shapes match, and the Disqualifier is not triggered.
  - **ADVISORY (attempt 1 Reviewer; labeled advisory, not gating):**
    - Risk: a QA-side misconfiguration surfaces as 401 "Invalid credentials" with only `upstream_refused status=401` in the log. This covers wrong `MS_AUTH_*` (CLARISA 401) and a missing `mis_auth` (400). Consider a distinct reason code. No 400 path is needed for redirect URIs, because FR-6 checks them QA-side in T-8.
    - Reliability: every completeNewPassword failure is a 400 upstream, including a password-policy rejection, so the user sees "Invalid credentials". This is a gap outside FR-5 and is noted for the front spec.
    - Reliability (Leader Q1): mapping an unknown challenge to 401 is consistent with § 7.2. The microservice only forwards `NEW_PASSWORD_REQUIRED`.
    - Resilience: a further challenge on new-password (MFA) arrives as a 500 and is mapped to 503. Note this for T-7/T-8.
    - Readability (spec): design § 7.2 cites "(P-7)" for the empty or malformed body, but the right reference is P-6. This is a pending spec fix and was not edited now.
    - Readability: a Nest `@Post` returning `undefined` likely answers 201, not 200. Prefer a 201 fixture.
- **Attempt 2** (effort `high`, bumped after the FAIL): rework of the timeout test and the two mutations only, with the FAIL report passed verbatim.
  - **Files changed:** only the timeout test in `server/src/auth/auth-microservice.client.spec.ts`. Production code is unchanged (diff-verified).
  - **Implementer verification:** lint 0, build 0, unit 255/255.
    - The test no longer awaits the client promise. It records the outcome through `.then` into `{settled, error}`, so a mutated client cannot hang it.
    - Assertion order: `toHaveBeenCalledTimes(1)` first, then `AbortSignal`, then at 9_999 ms not aborted and not settled, then at 10_000 ms aborted, settled and `UpstreamUnavailableError`.
  - **Mutations** (each reverted, diff clean):
    - (a) Abort timer removed: 1 failed. `AssertionError: expected false to be true` at spec `:237` (`expect(signal?.aborted).toBe(true)`), 167 ms, no Vitest timeout.
    - (b) `MS_AUTH_TIMEOUT_MS = 20_000`: 1 failed, same assertion at `:237`.
    - (c) Client never calls fetch (the red run): 10 failed / 3 passed, all on assertions. The timeout test failed with `expected "vi.fn()" to be called 1 times, but got 0 times` at `:228`.
  - **Implementer Not Done / Assumptions (verbatim, a note only):**
    > "My first attempt at mutation (a) used `timeout`, which doesn't exist on this macOS shell, so that run never executed. I re-ran it without `timeout` and the result above is from that re-run. The file was restored in between."
  - **Evidence re-run (Leader-inline, non-author):** VERIFIED. lint 0, build 0, unit 255/255.
  - **Reviewer verdict (attempt 2): PASS.**
    - The attempt-1 FAIL is resolved. Every failure mode is a behavioral assertion: no setup crash and no hang.
    - The 9_999 ms and 10_000 ms checks pin NFR-6 from both sides.
    - The red run meets the task's assertion-level requirement.
    - The attempt-1 conformance verdict carries over: FR-4 and FR-13 client parts, NFR-6/7, design § 7.2, fixtures matching `bf29541f`.
  - **ADVISORY (attempt 2):** Reliability: add `vi.clearAllTimers()` in `afterEach` to make the cleanup explicit.
- **Final status:** PASS (attempt 2 of 3)
- **spawns:**
  - implementer: 16 calls, 87212 tokens, ended partial (assumptions only)
  - reviewer: 11 calls, 49179 tokens, ended fail
  - implementer: 12 calls, 61451 tokens, ended complete
  - reviewer: 4 calls, 29436 tokens, ended complete
- **runtime events:** none
- **Requirements covered:** NFR-6 at the client level (503 within 10 s); FR-13 client part (an empty refresh body gives 401); FR-4 client part (4xx gives 401 with a generic message); NFR-7 at the client level (no bodies, tokens or passwords logged).
- **Forward pointers:**
  - T-8: consider a distinct log reason code for QA-side misconfiguration (CLARISA 401 or `mis_auth` 400), so it is not logged as user "invalid credentials" (T-6 advisory). FR-6's redirect-URI allow-list is checked QA-side before the call.
  - T-8: a further challenge on complete-new-password (MFA) arrives as 503. Note it in the T-8 flow tests.
  - T-9: the refresh body `{refreshToken, username}` is pending the DD-2 microservice change.
- **Pending spec fix (not edited now):** design § 7.2 cites "(P-7)" for "empty or malformed body → 401"; it should be P-6.
- **Budget (re-baselined to about 10,000 LOC):** about 5,500 LOC · 12 of about 25 Reviewer passes · 6 of 11 tasks.
- **Final verification:** server command green (lint 0, build 0, unit 255/255).

### T-7: Admission service — PASS (attempt 2)

- **Date:** 2026-10-13
- **Attempt 1** (effort `high`; skills nestjs-expert, tdd). Carried pointers: T-3 locking re-read, T-5 invalidate-after-commit, T-5 `isLiveAssignment` reuse.

**Files changed**
- New in `server/src/auth/`: `admission.service.ts`, `admission.service.spec.ts` (24 tests), `admission.unit-of-work.ts`, `auth.errors.ts`.
- Modified:
  - `server/src/auth/auth.module.ts`
  - `server/src/users/users.repository.ts` (`forUpdate`, `update`, `lastLoginAt`)
  - `server/src/users/current-user.cache.ts` (`toAuthenticatedUser` extracted)
  - `server/test/support/in-memory-stores.ts`
  - `server/src/users/users.repository.spec.ts`

**Implementer verification**
- Lint clean, unit 279/279, e2e 55/55.
- `pnpm build` was blocked 3 times by the resource-guard (RAM). As a stand-in, `tsc --noEmit -p tsconfig.build.json` exited 0.

**Red run.** Against the service stub, all 24 tests failed on assertions. Examples:
- `expected [] to have a length of 1 but got +0`
- `expected null to be 'sub-ana'`
- `expected 'sso' to be 'custom'`
- `expected [] to deeply equal [ 'commit', 'invalidate:0' ]`

**Falsifiers**
- **Falsifier 1** (collision check before the email link): 8 tests went red, including the pre-registered test (`EmailCollisionError` thrown out of `resolve`).
- **Falsifier 2** (custom user falls through to create): `expected "create" to not be called at all, but actually been called 1 times`.
- **Extra mutations**, all red:
  - removing `invalidate`
  - a plain re-read instead of `forUpdate`
  - updating `last_login_at` on refresh

**Implementer Not Done / Assumptions** (verbatim; the context file is in the session scratchpad `t7-review-context.md`):
- "Build: the `pnpm build` blocker above is the only unfinished verification" → closed by the Leader's re-run.
- "Untested against MySQL: `DrizzleAdmissionUnitOfWork` and the `FOR UPDATE` and `update` paths … covered only by type-check … T-11 should exercise them at the HITL step."
- "Test seam: the fake transaction does not emulate rollback …"
- "Locking read: the first lookups are plain reads … Only the re-read after a lost insert uses `forUpdate` …"
- "Refresh mode: It does not update `last_login_at`. It can still link a `sub`, sync email and names, and correct `auth_source`. A refresh with no change writes nothing and invalidates nothing."
- "Step 6 auth source: step 6 uses the token-derived `auth_source` …"
- "Missing claims: … A token with no `cognito:username` is not refused: it yields `cognitoUsername: null` … T-8 or T-11 should decide whether that must be a hard error …"
- "Email change collision: … surfaces as `DuplicateUserError`, a 409 …"
- "Names: … trimmed and cut to 100 characters …"
- "Unrelated type errors: `tsc -p tsconfig.json` still shows 5 type errors in `token-verifier.service.spec.ts` …"

**Evidence re-run** (Leader-inline, non-author): VERIFIED.
- lint 0, `nest build` exit 0, unit 279/279, e2e 55/55.
- The build owed item is closed.

**Review mode:** parallel lens reviewers (admission is an authentication surface), Risk and Reliability, each with baseline conformance.

**Reviewer verdict, Reliability lens: FAIL** (verbatim):
> 1. **Discovered Issue:** On real MySQL, the concurrent first-login path will most likely fail with a 500, which is the exact case DD-10 exists to prevent. The sequence:
>    - The loser's REPEATABLE READ snapshot predates the winner's commit.
>    - After its insert loses, the loser re-reads the winner with `FOR UPDATE`, which works. `changes()` then patches only `lastLoginAt`, plus `updated_at` through `$onUpdate`.
>    - Both columns are `datetime` with no fractional seconds, so in a concurrent login the new values round to the same second the winner just wrote. InnoDB sees an identical row (`HA_ERR_RECORD_IS_THE_SAME`) and creates no new row version.
>    - `DrizzleUsersStore.update` then reads the row back with a plain `findById`. Under the loser's snapshot that row does not exist, so the call returns `undefined`. The code throws `Error('Updated user could not be read back')`, the transaction rolls back, and the client gets a 500.
>    - Even when the update does change the row, the read-back only works because of the InnoDB rule that a transaction always sees its own changes.
>
>    The test does not catch this because `SnapshotUsersStore` does not override `findById`, and `InMemoryUsersStore.update` never reads back. So the fake does not faithfully model the step it claims to prove.
>    * **Violated Rule:** `design.md` § 10 DD-10: "Unique violations inside the transaction are re-read and resolved, not surfaced". `docs/trd/trd.md` § 11 (error mapping: no 500 for a resolvable conflict).
>    * **Remediation Suggestion:** Pick one fix:
>      - Make the read-back in `DrizzleUsersStore.update` a locking read (`findById` with `ReadOptions`, `.for('update')`).
>      - Have the repository return the in-hand row merged with the patch instead of reading back.
>
>      Then make `SnapshotUsersStore` snapshot `findById` too, and give it an `update` that reads back through `view()`. That way the DD-10 test goes red under the current code.
> 2. **Discovered Issue:** Refresh mode deliberately skips `last_login_at`, and a test asserts it stays `0`. FR-8 says the resolution table applies "On every token acquisition … and on refresh (FR-13)", and step 7 reads "Update `last_login_at`". Design § 7.2 lists no exemption for refresh: it only says refresh "reads fresh from the DB and never creates users".
>    * **Violated Rule:** `requirements.md` FR-8 (lead paragraph + table step 7). `design.md` § 7.2 AdmissionService.
>    * **Remediation Suggestion:** Either update `last_login_at` on refresh and flip the assertion in "is not a login…", or have the Leader amend FR-8 step 7 to "on login only" before PASS. The Implementer's "a refresh is not a login" is a spec decision; it cannot be recorded as an assumption.

**Reviewer verdict, Risk lens: FAIL.** Same as Reliability issue 2: refresh skips `last_login_at`, which violates the FR-8 intro and step 7. Remediation: (a) set it in both modes, or (b) a Leader spec amendment.
- Otherwise the admission paths fail closed:
  - a never-registered custom user is refused and `create` is never called;
  - inactive users, custom users without roles, and tokens that fail verification are all refused before any write;
  - a collision gives 409 and links nothing;
  - `FOR UPDATE` is used on the re-read;
  - `invalidate` runs after commit and only on a write.
- The amended T-7 is met.

**ADVISORY** (both lenses; labeled advisory, not gating):
- **Risk (high), raised to the user at the gate:**
  - Email linking (step 2) and the email sync trust the token's `email` without `email_verified`.
  - In the shared CLARISA pool, a native user with an unverified arbitrary email could custom-login, be linked to a pre-registered row with a null `sub`, and inherit its assignments (including ADMIN).
  - A reverse takeover is also possible via an email change.
  - This is spec-compliant today. A possible amendment: link by email only when `email_verified === true` (or only for SSO).
- **Risk:** a non-array `identities` claim is classified as `sso`, the permissive outcome. It should be treated as invalid or as `custom`.
- **Risk:** a missing `cognito:username` still admits the user. T-8 should fail closed rather than set a null `qa_ru`.
- **Risk:** refresh mode can still link a `sub` by email, which widens the email-trust issue.
- **Resilience (both lenses):** a 3+ way first-login race can deadlock (1213) and surface as a 500. Consider one retry, or note it for T-11.
- **Reliability:** the "cache read right after linking the sub" test passes without `invalidate`, because misses are not cached. Rename it; the real proof is the name-change test.
- **Risk:** check that T-8's filter maps `DuplicateUserError` to 409.

**Leader adjudication:** both FAILs are in scope for T-7.
- Issue 2 is resolved by following the spec text: update `last_login_at` on refresh too. No spec amendment.
- The `email_verified` advisory is spec-compliant and goes to the user as a proposed amendment at the T-7 gate. It is not added to this rework (narrow-never-widen).

**Attempt 2** (effort `xhigh`, bumped after the FAIL): both FAIL reports passed verbatim.
  - **Files changed (attempt 2):** `server/src/auth/admission.service.ts`, `server/src/auth/admission.service.spec.ts`, `server/src/users/users.repository.ts`, `server/test/support/in-memory-stores.ts`.
  - **What attempt 2 changed:**
    - The read-back is now `findById(id, { forUpdate: true })`, inside `UsersRepository.update`.
    - `UsersStore.update` now returns `{kind:'updated'}|{kind:'duplicate'}`, and `findById(id, options?)` accepts `ReadOptions`. **This is a shared port change.** Consumers are recorded below.
    - `last_login_at` is now updated in both modes.
    - Every successful resolve invalidates the cache after commit.
  - **Test changes:**
    - The snapshot fake now models InnoDB REPEATABLE READ: it sees its own writes, and an identical UPDATE creates no new row version.
    - The DD-10 suite freezes only `Date`.
  - **Implementer verification:** lint 0, `nest build` 0, unit 280/280, e2e 55/55. Generated SQL (offline): `select … limit ? for update`.
  - **Red run before the fixes:** `expected 0 to be greater than 0` (refresh stamp) and `promise rejected "Error: Updated user could not be read back" instead of resolving` (DD-10).
  - **Mutations and falsifiers:**
    - Plain read-back: the DD-10 test goes red.
    - Refresh skipping the stamp: red.
    - Falsifier 1 (steps 2/3 swapped): 8 red.
    - Falsifier 2 (custom user falls through to create): `"create" … called 1 times`.
    - Removing `invalidate`: 2 red.
    - Plain re-read after a lost insert: 3 red.
    - All reverted and diff-verified.
  - **Implementer Not Done / Assumptions (verbatim, assumptions only):**
    > "**Still untested against MySQL:** `DrizzleAdmissionUnitOfWork` and the Drizzle `update` and `FOR UPDATE` paths are checked only by the type-check and the SQL string above. T-11 should exercise them at the HITL step. `qadb` was not touched."
    >
    > "**Contract change you did not ask for:** moving the read-back to the repository changes the `UsersStore.update` contract from attempt 1. It was needed so the unit test can reach the read-back."
    >
    > "**Every admission now invalidates the cache:** … safe. I did not narrow it, to avoid a new decision."
    >
    > "**Redundant write on first login:** a first SSO login does INSERT and then an UPDATE of `last_login_at`. … I left it."
    >
    > "**Advisories not touched:** the `email_verified`, non-array `identities`, missing `cognito:username` and 1213-retry items."
    >
    > "**Unrelated type errors:** the 5 type errors in `token-verifier.service.spec.ts` are still there, outside the build config."
  - **Evidence re-run (Leader-inline, non-author):** VERIFIED. lint 0, build 0, unit 280/280, e2e 55/55.
  - **Reviewer verdict (attempt 2), Risk lens: PASS.**
    - The `last_login_at` fix holds.
    - Refresh never creates and bypasses the cache.
    - No refusal writes, invalidates, links or admits: every refusal throws before the first write, and `invalidate` runs only after `run` resolves.
    - The `FOR UPDATE` read-back never admits a missing row.
    - Baseline conformance holds, including the amended T-7.
  - **Reviewer verdict (attempt 2), Reliability lens: PASS.** Both attempt-1 FAILs are fixed and were traced through the fakes.
    - The `FOR UPDATE` read-back holds the row lock and never blocks.
    - The snapshot fake is faithful: the snapshot is taken at the first plain read, it sees its own writes, `sameRow` uses whole seconds, and `updated_at` is included.
    - The plain read-back mutation goes red on an assertion.
    - The `UsersStore.update` contract change does not affect other callers (seed, cache, guards e2e).
    - Baseline conformance holds.
  - **ADVISORY (attempt 2; labeled advisory, not gating):**
    - **Risk, TOCTOU.** Steps 5 and 6 decide on snapshot reads. An admin deactivation or revoke that lands between the snapshot and the UPDATE still admits the user.
      - The returned user can carry `isActive: false`, but the next request gets a 401, so the window is bounded.
      - Cheap fix: re-check `isActive` on the read-back row. **Raised to the user at the gate.**
    - **Reliability, lost link.** Two concurrent first logins for the same email with different `sub`s can each see `cognito_sub IS NULL`, and the second overwrites the first link.
      - This is not a unique violation, so DD-10 does not cover it, and it is very unlikely.
      - Fix: lock the email-found row (`FOR UPDATE`) before deciding, or link with `WHERE cognito_sub IS NULL` and treat 0 affected rows as a collision. **Raised to the user at the gate.**
    - **Risk:** refresh can still link a `sub` to a pre-registered row by email. This is spec-allowed.
    - **Risk:** T-7's `Consumers: none` is stale, since the `UsersStore` port changed. Recorded below.
    - **Reliability:** the commit-then-invalidate order is asserted only on the create path. All paths go through the one `invalidate` line, so this is acceptable.
    - **Risk/Reliability:** the Drizzle unit of work, `update` and the `FOR UPDATE` paths are verified only by type-check and the SQL string. T-11 should run a real concurrent first login, with both an identical and a changed row.
    - **Carried from attempt 1** (Risk): `email_verified` is not checked before email linking (high, raised to the user at the gate); a non-array `identities` classifies the token as `sso`; a missing `cognito:username` still admits the user (T-8 should fail closed before setting a null `qa_ru`); a 3-way race can hit deadlock 1213 (T-11 should note it).
- **Final status:** PASS (attempt 2 of 3).
- **spawns:**
  - implementer: 41 calls, 141873 tokens, ended partial (owed build, closed by the re-run)
  - reviewer (reliability): 13 calls, 61560 tokens, ended fail
  - reviewer (risk): 14 calls, 68829 tokens, ended fail
  - implementer: 38 calls, 126224 tokens, ended partial (assumptions only)
  - reviewer (risk): 9 calls, 58508 tokens, ended complete
  - reviewer (reliability): 10 calls, 60507 tokens, ended complete
- **runtime events:** none.
- **Requirements covered:** FR-8 (steps 1–7, all five scenarios), FR-13 (admission re-checked: reads the DB, never creates; `last_login_at` stamped), FR-11 (writer side: invalidate after commit, per the amended T-7).
- **Shared port change (consumers for T-8, T-9 and T-11):**
  - `UsersStore.update` returns `{kind}`.
  - `UsersStore.findById(id, { forUpdate? })`.
  - `CurrentUserCache` exports `toAuthenticatedUser`.
  - `AuthModule` exports `AdmissionService` (`resolve(idToken, { mode })`).
- **Forward pointers:**
  - **T-8:** fail closed when `cognito:username` is missing, before setting `qa_ru`.
  - **T-8:** map `DuplicateUserError` to 409 (check the filter).
  - **T-11:** run a real concurrent first login on MySQL, the identical and changed UPDATE cases, deadlock 1213, and the `FOR UPDATE` SQL.
- **Budget:** about 6,800 of about 10,000 LOC; 16 of about 25 Reviewer passes; 7 of 11 tasks.
- **Final verification:** server command plus e2e green (lint 0, build 0, unit 280/280, e2e 55/55).

## Gate after T-7: user decisions (AskUserQuestion, 2026-10-13)

The user's answers, verbatim:

> **email_verified:** "Opción 1 con ajuste. Enmienda FR-8 paso 2:- Custom (sin claim `identities`): vincular por email solo si email_verified es verdadero (aceptar boolean true o string "true"); si no, 403 sin vincular ni crear.- SSO (con `identities`): vincular por email sin exigir email_verified; el email viene del directorio activo de CGIAR. Retrabajo en T-7 con pruebas para ambos casos. T-11 registra si los tokens SSO traen email_verified, solo como dato; no bloquea."
>
> **Races:** "Corregir solo (2), sin locks. Vincular el sub con un UPDATE condicional: UPDATE users SET cognito_sub = ? WHERE id = ? AND cognito_sub IS NULL Si affected rows = 0, releer la fila: si el sub coincide, continuar; si es otro, 409. Prueba: dos vinculaciones concurrentes del mismo email con sub distinto → una gana y la otra recibe 409. (1) se registra como riesgo aceptado: el guard recarga usuario y asignaciones en cada petición (con caché corta) y el refresh vuelve a aplicar las reglas, así que el acceso admitido no sobrevive más allá de ese TTL. Sin cambios en DD-10 para (1)."

**Spec amendments applied** (Pivot-lightest grade: the user approved them at the gate, so this is a scope change, not a design reversal):

- **`requirements.md`**
  - FR-8 table, step 2: custom tokens link by email only when `email_verified` is true (boolean or `"true"`), otherwise 403 with nothing linked or created. SSO tokens link without the claim. The link is conditional.
  - Two new scenarios: "Unverified email on a custom token" and "Concurrent link of the same email".
  - The index count for FR-8 goes from 5 to 7.
- **`design.md`**
  - § 7.2 AdmissionService: email-link rule plus the conditional `UPDATE … WHERE cognito_sub IS NULL`. If 0 rows are affected, re-read: the same `sub` continues, another `sub` gets 409.
  - DD-10 consequence: conditional link, never an overwrite. Records accepted risk (1): a deactivation or revoke during a login's transaction can admit that one login, bounded by the guard's 60 s cache TTL and by refresh re-applying the rules. Risk (1) needs no DD-10 mechanism change.
- **`tasks.md`**
  - T-7 is reopened (`[x]` → `[~]`), with Scope and Tests amended.
  - T-11 Scope now records whether SSO id tokens carry `email_verified`. This is informational and does not block.
  - The FR-8 coverage row is updated.
- **Correction-closure sweep**
  - Forward: `grep email_verified` over the spec folder hits only the amended sites.
  - Backward: the FR-8 references in `tasks.md` (T-7, coverage) are updated, T-8 and T-9 cite FR-8 only through T-7, and no stale text remains.
  - `git diff` removed lines: only the replaced lines. No heading or clause was destroyed.

**Re-run accounting**
- T-7's earlier PASS stands for the approved scope. The amendment runs as a new loop on T-7, "amendment loop, attempt 1 of 3". The attempt counter restarts because this is approved new scope, not a FAIL.
- Every amended section is a named conformance check in this loop's Reviewer brief.
