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
