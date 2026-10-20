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

### T-1 (amendment): `idem_key` binary collation — PASS

- **Date:** 2026-10-20
- **Final status:** PASS (attempt 1 of 3)
- **Trigger:** back lead chose option 1 at the T-1 gate ("1 y sigue con la T2"), adopting the T-1 Reviewer RISK advisory. T-1 reopened `[~]` for this change only.
- **Decisions made — execute-time spec edit:** `design.md` § 5, row `idempotency_keys`: `idem_key` varchar(128) → varchar(128) `CHARACTER SET ascii COLLATE ascii_bin` ("keys are opaque and case-sensitive, FR-6"). Does not change any requirement's meaning (strengthens FR-6 scope; FR-6 allowed chars are ASCII). Carried as a named conformance check into this Reviewer brief and the T-2 Reviewer brief. `0002` was not applied anywhere, so editing it obeys `server/src/database/AGENTS.md`.
- **Skills / effort:** nestjs-expert, nestjs-best-practices · effort `medium`

**Attempt 1**
- **Files changed:** `server/src/database/drizzle/schema/idempotency-keys.ts` (`customType` `asciiBinKey`; drizzle mysql-core has no per-column collation), `server/src/database/drizzle/schema/schema.spec.ts`, `server/drizzle/0002_idempotency_keys.sql`, `server/drizzle/meta/0002_snapshot.json`, `server/drizzle/meta/_journal.json` (only `when`) — regenerated with `pnpm db:generate --name idempotency_keys` and a dummy `DATABASE_URL`; no `db:migrate`.
- **Implementer verification:** server command → lint/build clean, `Tests 1025 passed (1025)`, tsc 7 baseline errors only.
- **Red run:** 2 assertions failed before the schema change (`getSQLType()` and the SQL `toContain` of the `idem_key` line).
- **Falsifier** (collation removed): `AssertionError: expected 'varchar(128)' to be 'varchar(128) CHARACTER SET ascii COLL…'`, 1 failed | 37 passed; restored. The SQL-file assertion guards the committed DDL text, not generation (disclosed).
- **Evidence re-run (Leader inline):** VERIFIED — 35 files / 1025 tests passed, 0 non-baseline tsc errors.
- **Reviewer verdict:** PASS — "The T-1 amendment matches the amended `design.md` § 5 row `idempotency_keys`"; migration still additive, snapshot carries the collation, `0000`/`0001` untouched. No ADVISORY (under 50 LOC).
- **runtime events:** none
- **spawns:** Implementer not reported by host (10 tool calls, 75,047 tokens, ended complete); Reviewer not reported by host, ended complete
- **Issues encountered:** none.
- **Final verification:** VERIFIED + Reviewer PASS.

### T-2: Fingerprint and idempotency store — PASS (attempt 2)

- **Date:** 2026-10-20
- **Skills / effort:** nestjs-expert, nestjs-best-practices, tdd · attempt 1 effort `xhigh` (concurrency + isolation)
- **Review mode:** parallel lenses (A: reliability + resilience; B: risk + readability), each with baseline spec conformance.

**Attempt 1 — FAIL (lens B)**
- **Files changed:** `server/src/common/idempotency/{fingerprint,fingerprint.spec,idempotency.errors,idempotency.store,idempotency.store.spec}.ts` (new), `server/src/common/error-codes.ts`, `server/src/common/error-codes.spec.ts`, `server/test/support/in-memory-idempotency.ts` (new), `server/test/support/idempotency-sql-driver.ts` (new) — 1,896 insertions.
- **Implementer verification:** lint 0 warnings; build ok; `Test Files 37 passed (37)`, `Tests 1163 passed (1163)`; tsc 7 baseline only; e2e `Test Files 9 passed (9)`, `Tests 414 passed (414)`.
- **Red run:** skeleton → `Tests 60 failed | 56 passed (116)`, assertion failures.
- **Falsifiers:** owner_token dropped → `4 failed | 126 passed (130)` (`take-overs racing from instances whose clocks are a lease apart`: `expected [ …(2) ] to have a length of 1 but got 2`); actor_id dropped from `find` → `3 failed` (`expected { actorId: 1, … } to be undefined`); arrays sorted → `3 failed` (`array order matters`). Extra falsifiers (release state guard, markExecuted token, purge limit, expired-as-live) all red.
- **Evidence re-run (Leader inline):** VERIFIED — identical unit/e2e counts, 0 non-baseline tsc errors.
- **Lens A verdict:** PASS — store and fingerprint meet design § 7, DD-1, DD-3, P-7 at the store layer; stale-row handling in `reserve` judged in scope (FR-7); named check (`ascii_bin`) consistent.
- **Lens B verdict:** FAIL — verbatim issues:
  1. **Discovered Issue:** `DrizzleIdempotencyStore` is `@Injectable()` but its third constructor parameter `private readonly newToken: () => string = randomUUID` (`server/src/common/idempotency/idempotency.store.ts:134`) has no injection token. When Nest instantiates the class (e.g. `useClass` provider in T-3), decorator metadata types it as `Function` → boot fails with "can't resolve dependencies (DRIZZLE, IDEMPOTENCY_CLOCK, ?)". All other `Drizzle*Store` classes take only `@Inject(DRIZZLE)`. **Violated Rule:** `server/AGENTS.md` § Dependency injection: "inject with `@Inject(Token)` explicitly (constructor parameters), including classes. Use `Symbol` tokens for ports". **Remediation:** add an `IDEMPOTENCY_TOKEN_FACTORY` Symbol with `@Optional() @Inject(IDEMPOTENCY_TOKEN_FACTORY)`, or drop `@Injectable()` and document factory/`new` construction. Add a unit test resolving the class through a `Test.createTestingModule` provider.
  2. **Discovered Issue:** the shared `common/` layer imports a feature module: `import { isDuplicateKeyError } from '../../users/users.errors.js'` (`idempotency.store.ts:10`). Reverses dependency direction (`users` already depends on `common`), contradicting DD-6 ("Reusable by later modules"). **Violated Rule:** `docs/trd/trd.md` ADR-001 Implications ("a module talks to another only through its exported service"); `design.md` § 10 DD-6. **Remediation:** move `isDuplicateKeyError` to a neutral location (e.g. `server/src/common/mysql-errors.ts`) and re-export from `users/users.errors.ts` — outside T-2 scope list, needs Leader approval.
- **Leader adjudication:** both in scope. Issue 2 is remediated **without** widening scope: the store gets a duplicate-key check inside T-2's own files (`idempotency.errors.ts`), `users.errors.ts` untouched; consolidating the two helpers is recorded as a follow-up, not a task.
- **runtime events:** none
- **spawns:** Implementer not reported by host (53 tool calls, 209,823 tokens, ended complete); Reviewer A not reported by host, ended complete; Reviewer B not reported by host, ended complete
- **ADVISORY (both lenses, never gating):**
  - RELIABILITY: `reserve` throws a plain `Error('Could not reserve the idempotency key')` after 3 attempts — renders 500 unless T-3 maps it to 503 (forward pointer to T-3).
  - RELIABILITY: `find` returns rows past `expires_at` not yet purged; a direct caller could replay an expired answer (forward pointer to T-3).
  - RELIABILITY: `IDEMPOTENCY_CLOCK` has no provider yet (forward pointer to T-3).
  - RESILIENCE: leases use each instance's app clock; skew lets a fast instance take over early (fence still holds) — record at T-8.
  - RESILIENCE: `datetime` without fractional seconds rounds ms (±0.5 s); the SQL driver keeps ms.
  - READABILITY: port docstring "Every method is keyed by `actorId`" should name `purgeExpired` as the global exception.
  - READABILITY: fake vs adapter differ (clock read at apply vs issue; `undefined` vs `null` in `complete`).
  - READABILITY: `server/src/common/AGENTS.md` Files table lacks `idempotency/` (T-7).
  - RISK: `requestFingerprint` uses the path "as received" — T-3 must pass one consistent form (`originalUrl` vs `url`, prefix) and pin it (forward pointer to T-3).
  - T-4 note: the in-memory fake does not hold the `markExecuted` row lock until the business tx commits — T-4's `InMemoryDatabase` extension must emulate it (forward pointer to T-4).

**Attempt 2 — PASS**
- **Effort:** kept `xhigh` (the bump would be `max` on T2; the fix was mechanical and narrowly adjudicated, so no tier escalation — Leader deviation from the bump rule).
- **Files changed:** `server/src/common/idempotency/idempotency.store.ts` (`IDEMPOTENCY_TOKEN_FACTORY` Symbol, `@Optional() @Inject(...)`, local `isDuplicateKeyError` import), `server/src/common/idempotency/idempotency.errors.ts` (+ `isDuplicateKeyError`, same semantics as `users/users.errors.ts:201-214`), `server/src/common/idempotency/idempotency.errors.spec.ts` (new, 7-case table), `server/src/common/idempotency/idempotency.store.spec.ts` (+ `Test.createTestingModule` DI test). `server/src/users/**` untouched.
- **Implementer verification:** lint clean; build clean; `Test Files 38 passed (38)`, `Tests 1171 passed (1171)`; tsc 7 baseline only; e2e `Test Files 9 passed (9)`, `Tests 414 passed (414)`.
- **Falsifier (DI, `@Optional()` removed):** `Error: Nest can't resolve dependencies of the DrizzleIdempotencyStore (Symbol(DRIZZLE), Symbol(IDEMPOTENCY_CLOCK), ?)…` → 1 failed; restored. F1 re-run (owner_token): 4 failed; F2 re-run (actor_id): 3 failed; restored.
- **Red run:** the helper table had no meaningful red ("not a function" before the helper existed); accepted by the Reviewer as a byte-for-byte copy of an already-tested helper.
- **Evidence re-run (Leader inline):** VERIFIED — identical counts; `grep -rn "from '.*users/" server/src/common/idempotency/` empty.
- **Reviewer verdict (re-review, risk + readability + conformance; override (e) rework):** PASS — "Issue 1 (DI) is fixed… Issue 2 (layering) is fixed… Lens A guards are intact."
- **runtime events:** none
- **spawns:** Implementer not reported by host (14 tool calls, 88,301 tokens, ended complete); Reviewer not reported by host, ended complete
- **ADVISORY:** two identical `isDuplicateKeyError` copies (`common/idempotency/idempotency.errors.ts`, `users/users.errors.ts`) — consolidation is a recorded follow-up outside this spec unless the back lead reopens it; `IDEMPOTENCY_TOKEN_FACTORY` doc should say it stays unbound outside tests.

**T-2 summary**
- **Requirements covered:** FR-3 (lookup), FR-4 (fingerprint), FR-5 (in-flight, lease, CAS take-over), FR-6 (per-admin scope, case-sensitive keys), FR-7 (retention, stale-row-as-new, purge), FR-9 (no cross-admin read), NFR-1 (store layer), NFR-4 (driver errors propagate), NFR-5 (bounded purge).
- **Decisions made:** stale-row-as-new in `reserve`, `find` on the port, and `release` limited to own `in_progress` rows (judged in scope by lens A). Issue 2 remediated inside T-2 files instead of editing `users/`.
- **Forward pointers → T-3:** map every store failure to 503 including `reserve` exhausting retries (plain `Error`) and `DrizzleQueryError` causes; do not store `IdempotencyFenceLostError` (409) as a remembered refusal; provide `IDEMPOTENCY_CLOCK`; leave `IDEMPOTENCY_TOKEN_FACTORY` unbound; `find` returns expired-unpurged rows — filter or go through `reserve`; pass one consistent path form to `requestFingerprint` (`originalUrl` vs `url`, prefix) and pin it in a test.
- **Forward pointers → T-4:** the in-memory fake does not hold the `markExecuted` row lock until the business tx commits; T-4's `InMemoryDatabase` extension must emulate it; build the adapter as `new DrizzleIdempotencyStore(tx, clock)`.
- **Forward pointers → T-8:** P-12 still UNVERIFIED; app-clock leases under instance skew; `datetime` rounds ms.
- **Budget:** T-2 ≈ 2,000 LOC (design estimated ≈ 600 for fingerprint + fakes). Cumulative ≈ 2,200 of ~3,600; Reviewer verdicts so far 5 of ~14.
- **Final verification:** VERIFIED + Reviewer PASS.

### T-3: Idempotency interceptor and `@Idempotent()` decorator — PASS (attempt 1)

- **Date:** 2026-10-20
- **Skills / effort:** nestjs-expert, error-handling-patterns, tdd · effort `xhigh`

**Attempt 1 — PASS**
- **Files changed:** `server/src/common/idempotency/{idempotency.context,idempotency.interceptor,idempotency.interceptor.spec,idempotent.decorator}.ts` (new) — 1,471 insertions.
- **Implementer verification:** lint 0 warnings; build ok; `Test Files 39 passed (39)`, `Tests 1229 passed (1229)`; tsc 7 baseline only; e2e not run (no HTTP surface changed; task lists none).
- **Red run:** pass-through interceptor → `Tests 45 failed | 13 passed (58)`, assertion failures (first red run invalid — helper sent no key — fixed and re-run).
- **Falsifier 1** (handler subscribed before the store claim): 33 failed — `expected "vi.fn()" to not be called at all, but actually been called 1 times`. **Falsifier 2** (`isRefusal` bound `< 600`): 3 failed — `500: nothing remembered (release)…` `expected { Object (actorId, idemKey, ...) } to be undefined`. Both restored.
- **Evidence re-run (Leader inline):** VERIFIED — `Test Files 39 passed (39)`, `Tests 1229 passed (1229)`, 0 non-baseline tsc errors, no `users/` import in `common/idempotency/`.
- **Implementer notes for T-4/T-6:** fingerprint path = `request.originalUrl ?? request.url` (global prefix, ids kept, query stripped), pinned; success status from `response.statusCode`; interceptor needs `IDEMPOTENCY_STORE`, `IDEMPOTENCY_CLOCK`, `IDEMPOTENCY_REPLAY_READER` bound (T-6), `IDEMPOTENCY_TOKEN_FACTORY` unbound; purge before every keyed reserve, purge failure → 503; fence-lost goes through `release`; interceptor logs only `replayed`/`in_progress`/`reused` (`event:'idempotency'`), a taken-over or first run writes no interceptor line — **forward pointer → T-4:** the service decision line reads `handle.outcome` for `idempotency=`; **→ T-7:** the log-spy must count `event:'idempotency'` lines; no actor id on the request → 503. `@ApiHeader` is T-6/T-7.

- **Lens A verdict (reliability + resilience):** PASS — "the interceptor matches design § 7 and FR-1…FR-6, NFR-2 and NFR-4"; all six T-2 forward pointers honored.
- **Lens B verdict (risk + readability):** PASS — contract rendering, per-admin scope, privacy of decision lines, boundaries and test validity confirmed.
- **runtime events:** none
- **spawns:** Implementer not reported by host (38 tool calls, 193,346 tokens, ended complete); Reviewer A not reported by host, ended complete; Reviewer B not reported by host (13 tool calls, 66,917 tokens), ended complete
- **Requirements covered:** FR-1, FR-2 (interceptor part), FR-3 (handler not called on replay), FR-4, FR-5, FR-6, NFR-2 (interceptor lines), NFR-4.
- **ADVISORY (never gating):**
  - RELIABILITY (lenses disagree): lens A says `replay()`'s `response.status(stored)` is overridden by Nest's `ExpressAdapter.reply` with the route status, so the unit test expecting a stored 201 over a route 200 certifies a `FakeResponse`-only behavior; lens B traced `createHandleResponseFn` without `httpStatusCode` and says the override holds. Harmless today (stored success status = route status). **Forward pointer → T-6:** the e2e replay must assert the real status.
  - RISK: missing `request.user.id` answers 503, which the front retries forever (P-10); 500 `INTERNAL_ERROR` would describe a setup error.
  - RISK/RESILIENCE: a reader failure (incl. a 4xx) on the crash path becomes a 503 repeated until retention ends; acceptable since users are not deletable.
  - RESILIENCE: purge before every keyed reserve can block writes on a lock wait and adds to NFR-3 overhead — **forward pointer → T-7 (NFR-3 measurement) and T-8.**
  - RELIABILITY: every handler 4xx is remembered 24 h (D3), incl. 408/429 — **forward pointer → T-4:** confirm upstream timeouts/throttling map to 5xx.
  - RELIABILITY: a handler returning `undefined` replays as `data: null`; document on the decorator for DD-6 reuse.
  - RISK: a refusal relying on a response header (429 `retryAfter`) is stored without it.
  - RELIABILITY: a failed `release` leaves the key `in_progress` ≤ 120 s → 409; relies on the design § 8 front note shipping (T-7).
  - READABILITY: `complete_lost` logged at `warn` with `outcome:'error'` vs `error` level siblings; the pipe-400 pipeline replay test needs a comment.
- **Final verification:** VERIFIED + both lenses PASS.

## Budget Tripwire: after T-3 attempt 1

- **Budget (design § 2):** 8 tasks · ~3,600 LOC · ~14 Reviewer passes.
- **Actual:** 3 of 8 tasks implemented; ≈ 3,670 LOC (T-1 ≈ 260, T-2 ≈ 2,000, T-3 ≈ 1,470 — tests ≈ 75 %); 5 Reviewer verdicts so far (T-3 review pending).
- **Delta:** LOC budget exceeded with 5 tasks left (T-4, T-5, T-6 each sized M with large test tables). Projected total ≈ 7,000–8,000 LOC; Reviewer passes on track.
- **Cause:** concurrency harness (SQL-executing driver + contract suite run against fake and adapter) and the interceptor decision table are far larger than the design's per-gate estimates (≈ 600 for T-2's pieces). Not scope growth: no task beyond the approved list; the size is in tests the defect-class gates require.
- **Escalated to the back lead:** 2026-10-20, before the T-3 Reviewer spawn.
- **Decision (back lead, 2026-10-20):** "Adelante, terminalo" — option 1: accept the larger size and continue; the LOC tripwire is re-baselined to the projection (≈ 8,000 LOC). Read as authorization to proceed through the remaining routine task gates; exceptions (HALT, Pivot, FATAL_FAIL, a further budget breach, the T-8 HITL step) still stop for the user.

## Constitution Impact: T-1

- Shared schema gained `idempotency_keys` and migration `0002_idempotency_keys` (additive). `server/src/database/AGENTS.md` update is T-7 deliverable; TRD § 5.1 is a pending item for `staging`. Migration `0002` must be applied to `qadb` by a human (T-8) before the API runs against it with this code.
