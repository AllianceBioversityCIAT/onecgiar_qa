# Users admin write safety — Execution Log

## Document Control

| | |
|---|---|
| Spec path | `docs/specs/changes/users-admin-write-safety` |
| Branch | `feat/users-admin-write-safety` (worktree `onecgiar_qa-users`) |
| Approval Mode | gated |
| Leader | Claude Code `opus` (T1) · Implementer `akili-implementer` (`sonnet`, T2) · Reviewer `akili-reviewer` (`opus`, T3) |
| Operator | Juan D. Guzmán (back lead) |
| Started | 2026-10-20 |
| Budget (design § 2) | 8 tasks · ~3,600 LOC · ~14 Reviewer passes |

## Task Execution History

### T-1: Schema and migration for `idempotency_keys` — PASS

- **Date:** 2026-10-20
- **Final status:** PASS (attempt 1 of 3)
- **Requirements covered:** FR-2, FR-5, FR-6, FR-7 (storage part); NFR-5 (expiry index)
- **Skills / effort:** nestjs-expert, nestjs-best-practices (as listed) · effort `medium`

**Attempt 1**
- **Files changed:** `server/src/database/drizzle/schema/idempotency-keys.ts` (new), `server/src/database/drizzle/schema/index.ts`, `server/src/database/drizzle/schema/schema.spec.ts`, `server/drizzle/0002_idempotency_keys.sql` (new), `server/drizzle/meta/0002_snapshot.json` (new), `server/drizzle/meta/_journal.json`
- **Implementer verification:** `cd server && pnpm lint && pnpm build && pnpm test --reporter=dot && npx tsc --noEmit -p tsconfig.json` → lint clean, build clean, `Test Files 35 passed (35)`, `Tests 1025 passed (1025)`, tsc 7 errors all in baseline `src/auth/token-verifier.service.spec.ts`.
- **Red run:** `schema.spec.ts` failed at collection before the table existed: `TypeError: Cannot read properties of undefined (reading 'Symbol(drizzle:Columns)')` (suite-level red).
- **Falsifier 1** (PK on `idem_key` alone): `uses (actor_id, idem_key) as the composite primary key: per admin (FR-6)` → `AssertionError: expected [] to have a length of 1 but got +0`. Restored.
- **Falsifier 2** (expiry index dropped): `indexes expires_at for the retention purge (NFR-5)` → `AssertionError: expected undefined to be defined`. Restored.
- **Evidence re-run (Leader inline, non-author):** VERIFIED — same command: 35 files / 1025 tests passed, 7 baseline tsc errors, no new ones; `git status` shows only the six task files; `0000`/`0001` snapshots untouched.
- **Reviewer verdict:** PASS — "T-1 (attempt 1) matches design § 5 column for column and meets the task's test gate." Generated SQL read line by line; the five Implementer assumptions accepted (see below).
- **runtime events:** none
- **Not Done / Assumptions (Implementer, verbatim summary of the field):**
  - FK emitted by drizzle-kit as `ALTER TABLE idempotency_keys ADD CONSTRAINT` (same as `0001`); the test allows only ALTERs that add a constraint to the new table and forbids DROP/MODIFY/RENAME/DML. Reviewer: accepted — design § 5 "additive only (one new table)" holds.
  - The existing "are exactly two SQL files" assertion now expects three.
  - `actor_id` and `target_user_id` are `int unsigned` (design says `int`) to match `users.id`; no FK on `target_user_id` (design specifies none). Reviewer: accepted — MySQL needs matching FK types.
  - `created_at` defaults to `CURRENT_TIMESTAMP` (design gives no default).
  - `db:generate` ran with a dummy inline `DATABASE_URL` (no connection); no `db:migrate`/`db:seed`.
  - No owed item and no blocker → no continuation.

- **spawns:** Implementer not reported by host (15 tool calls, 84,481 tokens, ended complete); Reviewer not reported by host, ended complete
- **ADVISORY (Reviewer, never gating):**
  - RISK: `idem_key` takes the table's default collation (likely case-insensitive `utf8mb4_0900_ai_ci`), so keys differing only by case collide in the PK and could yield a false 422 `IDEMPOTENCY_KEY_REUSED`. Suggests `CHARACTER SET ascii COLLATE ascii_bin`; if adopted, it belongs in `0002` before it is applied anywhere. **Raised to the back lead at the T-1 gate.**
  - READABILITY: `server/src/database/AGENTS.md` Files table and Schema guarantees do not list `idempotency_keys`/`0002` yet — already in T-7 scope.
  - RELIABILITY: the expiry-index assertion selects the first non-unique index; selecting by name would survive a second index.
  - RISK: `response_body json` has no size bound; fine for `UserDetail`, note for future `@Idempotent()` routes.
- **Decisions made:** Reviewer diff delivered by scratchpad path (245 lines, under the 300-line inline threshold) — Leader economy, the Reviewer kept `Read`.
- **Issues encountered:** none.
- **Final verification:** VERIFIED (Leader re-run) + Reviewer PASS.

## Constitution Impact: T-1

- Shared schema gained `idempotency_keys` and migration `0002_idempotency_keys` (additive). `server/src/database/AGENTS.md` update is T-7 deliverable; TRD § 5.1 is a pending item for `staging`. Migration `0002` must be applied to `qadb` by a human (T-8) before the API runs against it with this code.
