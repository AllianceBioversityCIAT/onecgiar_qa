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
