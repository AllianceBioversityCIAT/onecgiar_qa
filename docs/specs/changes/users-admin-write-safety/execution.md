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

### T-4: Exactly-once fence in the unit of work and the service — PASS (attempt 1)

- **Date:** 2026-10-20
- **Skills / effort:** nestjs-expert, nestjs-best-practices, tdd · effort `xhigh` · brief asked for compact tests (back lead budget decision)
- **Review mode:** parallel lenses (A: reliability — transactions/fencing; B: risk — exactly-once + readability)

**Attempt 1 — PASS**
- **Files changed:** `server/src/users/users-admin.unit-of-work.ts` (`UsersAdminRepositories.idempotency`, `new DrizzleIdempotencyStore(tx, clock)`, `@Optional() @Inject(IDEMPOTENCY_CLOCK)`), `server/src/users/users-admin.service.ts` (`AdminContext.idempotency?: IdempotencyHandle`; `mutate` and `create` mark as the last write in the tx; decision line `idempotency`), `server/src/users/users-admin.fence.spec.ts` (new, 52 tests), `server/src/users/users-admin.unit-of-work.spec.ts` (+6), `server/src/users/users-admin.service.spec.ts` and `server/test/users-admin-privacy.e2e-spec.ts` (exact log expectations gain the `idempotency` field — meaning unchanged, both lenses agree), `server/test/support/{in-memory-idempotency,in-memory-stores,users-admin-world}.ts` — +942/−56.
- **Implementer verification:** lint 0 warnings; build ok; `Test Files 40 passed (40)`, `Tests 1287 passed (1287)`; tsc 7 baseline only; e2e `Test Files 9 passed (9)`, `Tests 414 passed (414)`.
- **Red run:** 33 of 52 failed before wiring (e.g. `expected {…state 'in_progress'} to match { state: 'executed', targetUserId: 2 }`); take-over rows failed through the `failureOf` helper (call succeeded when it should be refused) — behavioral.
- **Falsifier 1** (mark outside the tx): in-memory autocommit store → 10 failed (`expected {state:'executed', targetUserId:3} to match {state:'in_progress', targetUserId:null}`); Drizzle `this.db` instead of `tx` → `expected 'pool' to be 'tx'`. **Falsifier 2** (ignore 0 rows): adapter `promise resolved "undefined" instead of rejecting`; in-memory 14 failed with a second change committed. All restored.
- **Evidence re-run (Leader inline):** VERIFIED — identical unit/e2e counts, 0 non-baseline tsc errors.
- **Lens A verdict:** PASS — "meets design § 7 'Exactly-once fence', DD-2, DD-3, P-5, P-6 and P-11, and FR-2, FR-5 and NFR-1, on every public mutation."
- **Lens B verdict:** PASS — "I found no public mutation that can apply twice or apply without its mark."
- **Upstream finding (advisory-grade, report only):** Cognito failures other than `UsernameExists`/`UserNotFound` → 503 `AUTH_SERVICE_UNAVAILABLE` (`cognito-admin.client.ts:169-177`); catalogs → 503 (`reporting-result-types.client.ts:36`, `clarisa-science-programs.client.ts:38`). None surface as a 4xx the interceptor would remember.
- **runtime events:** none
- **spawns:** Implementer not reported by host (54 tool calls, 205,293 tokens, ended complete); Reviewer A not reported by host (14 tool calls, 70,297 tokens), ended complete; Reviewer B not reported by host, ended complete
- **Requirements covered:** FR-2 (same-commit mark), FR-3 (service level: no second change/audit/invalidation after a lost fence), FR-5 (stalled request cannot commit after take-over), NFR-1 (fake + stub level; real MySQL at T-8).
- **ADVISORY (never gating):**
  - RISK (open — for the back lead): `resendInvitation` that loses its fence after Cognito answered has already sent the email; the taker runs as a first execution and sends a second one. Not an FR-3 breach (FR-3 covers replays; FR-5 says an abandoned key executes as new), but design § 7 does not record it as DD-7 does for create. **To be raised with the back lead; T-7 docs should state it if accepted.**
  - RISK/READABILITY: a lost fence on resend logs `outcome=error`, `reason=cognito_sent_not_recorded` for a 409, hiding the take-over.
  - RELIABILITY → **T-6:** make explicit and test that a fence-lost 409 is neither remembered nor released by the stalled request (today guaranteed only by the `owner_token` condition on `complete`/`release`).
  - RESILIENCE: `markExecuted` ignores `lease_until` by design (state + owner_token only) — add a comment so nobody "fixes" it.
  - RESILIENCE → **T-8:** `reserve` and its stale-row delete do not take the row lock in the fake; in MySQL a duplicate INSERT against a held row waits and may replay instead of 409 — both valid; observe on `qadb`.
  - READABILITY: fence spec selects rows by index (`CHANGING[1]`…) — look up by name; helpers declared after use; the unit of work's `IDEMPOTENCY_CLOCK` is never read by `markExecuted` — revisit once T-6 provides it.
- **Final verification:** VERIFIED + both lenses PASS.

### T-5: Aggregate edit in the service (`replaceUser`) and helper extraction — PASS (attempt 1)

- **Date:** 2026-10-20
- **Skills / effort:** nestjs-expert, nestjs-best-practices, tdd · effort `xhigh` · compact tests requested
- **Review mode:** parallel lenses (A: risk — rule parity + readability; B: reliability + resilience — atomicity)

**Attempt 1 — PASS**
- **Files changed:** `server/src/users/users-admin.service.ts` (`replaceUser`; extracted `applyEdit`, `applyPrograms`, `removeManualExclusion`, new `reconcileExclusions`; shared validation `shapePatch`/`shapeState`/`checkShapeCatalogs`; `LogAction` + `'replace'`), `server/src/users/users-admin.replace.spec.ts` (new), `server/src/users/users-admin.fence.spec.ts` (`replaceUser` rows; positional lookups → `changing(name)`, the T-4 advisory) — +816/−104. `users-admin.service.spec.ts` unchanged.
- **Implementer verification:** lint/build clean; `Test Files 41 passed (41)`, `Tests 1315 passed (1315)`; tsc 7 baseline only; e2e `Test Files 9 passed (9)`, `Tests 414 passed (414)`.
- **Red run:** stubbed `replaceUser` → 24 failed (parity `deeply equal`, refusals "expected the call to be refused, but it succeeded", fence rows not rejecting).
- **Falsifier 1** (edit in its own `mutate`, the rest in a second): 5 red — `last admin refusal leaves the nickname unchanged`: `expected 'Root B' to be 'Root'`; full-save parity `expected [ [ 3 ], [ 3 ] ] to deeply equal [ [ 3 ] ]` (invalidated twice). A nested `unitOfWork.run` variant deadlocked on the row lock. **Falsifier 2** (reconcile removal loop deleted): 2 parity rows red. Both restored.
- **Evidence re-run (Leader inline):** VERIFIED — identical counts.
- **Lens A verdict:** PASS — rule parity with the separate routes through shared helpers; extraction verbatim; disqualifier not hit.
- **Lens B verdict:** PASS — "`replaceUser` … follows design § 7 'Aggregate edit' and DD-7/DD-8 as written"; one transaction, lock order kept, mark last, single invalidate; refactor changes no tx/audit/invalidation behavior; no deadlock cycle traced.
- **runtime events:** none
- **spawns:** Implementer not reported by host (33 tool calls, 146,240 tokens, ended complete); Reviewer A not reported by host, ended complete; Reviewer B not reported by host (17 tool calls, 63,230 tokens), ended complete
- **Requirements covered:** FR-8 service level (Full save, All or nothing, Same rules, No change, Out of reach D4 — except `UNKNOWN_FIELD`, which is the DTO in T-6, Unknown user).
- **Decisions made:** shape issues from all parts returned as one 400; catalog check only when shape is valid; exclusion adds in list order, removals in row order.
- **ADVISORY (never gating):**
  - RISK → **T-6:** OpenAPI must state that an existing manual exclusion keeps its original reason (design § 7).
  - RESILIENCE → **T-6/T-7:** catalog validation runs before the target lock, so an unknown user during a catalog outage answers 503, not 404 (same as the separate routes) — worth a line in OpenAPI notes.
  - RELIABILITY → **T-7:** exclusion rows are locked `FOR UPDATE` after `role_assignments`; add "→ exclusion rows" to the documented lock order in `server/src/database/AGENTS.md` (TRD note pending for staging).
  - READABILITY: `reconcileExclusions` throws inside a `filter` callback (use a loop); `e!` / `as ExclusionInput[]` rely on an unwritten "already thrown" invariant — a narrowing function would remove both.
  - RISK: the `reporting` refusal can fire after earlier parts wrote (rolled back — correct but wasteful); checking first under the lock would avoid it.
- **Final verification:** VERIFIED + both lenses PASS.

### T-6: Route wiring, `PUT /users/:id`, DTO and OpenAPI — PASS (attempt 1)

- **Date:** 2026-10-20
- **Skills / effort:** nestjs-expert, api-design-principles, nestjs-best-practices · effort `xhigh` · compact tests requested
- **Review mode:** parallel lenses (A: contract; B: security), as the task's Review field names

**Attempt 1 — PASS**
- **Files changed:** `server/src/users/users-admin.controller.ts` (`@Idempotent()` on 11 routes, new `PUT /users/:id`, `context()` reads `idempotencyHandleOf`), `server/src/users/users.module.ts` (binds `IDEMPOTENCY_STORE`, `IDEMPOTENCY_CLOCK`, `IDEMPOTENCY_REPLAY_READER`; token factory unbound), `server/src/users/users.module.spec.ts`, `server/src/users/dto/replace-user.dto.ts` (new), `server/src/common/idempotency/idempotency.openapi.ts` (new), `server/src/common/idempotency/idempotent.decorator.ts` (+ `ApiHeader`), `server/src/common/api-response.ts` (`headers` option), `server/src/users/users-admin.unit-of-work.ts` (comment), `server/test/users-admin-idempotency.e2e-spec.ts` (new, 102 tests), `server/test/users-admin.e2e-spec.ts` (PUT cases, 13-route inventory, PUT row in the 403 matrix, exact OpenAPI table) — +1,811/−95. Files outside the literal scope list judged by lens A as covered by "OpenAPI (header, replay header, codes)" and DD-6.
- **Keyed routes (11):** `POST /users`, `PATCH /users/:id`, `PUT /users/:id`, `PUT /users/:id/roles`, `PUT /users/:id/programs`, `POST /users/:id/exclusions`, `DELETE /users/:id/exclusions/:exclusionId`, `POST /users/:id/exclusions/:exclusionId/dismiss`, `POST /users/:id/deactivate`, `POST /users/:id/activate`, `POST /users/:id/invitation`.
- **Implementer verification:** lint 0 warnings; build ok; `Test Files 41 passed (41)`, `Tests 1316 passed (1316)`; tsc 7 baseline only; e2e `Test Files 10 passed (10)`, `Tests 531 passed (531)`.
- **Red run:** idempotency e2e before wiring → 91 failed / 11 passed (`expected undefined to be 'true'`, `expected 409 to be 201`, `expected 200 to be 422`, side-effect counters; 2 in-flight timeouts were setup-style). PUT cases not red-run separately (route absent → 404).
- **Falsifier 1** (`@Idempotent()` removed from `POST /users/:id/invitation`): 6 failed — `expected { users: 10, audit: 2, …} to deeply equal { users: 10, audit: 1, …}` (cognitoResend 2 vs 1). **Falsifier 2** (constant actor id passed to `claim`): 11/11 `another admin` rows failed — `expected 'true' to be undefined`. Both restored.
- **Evidence re-run (Leader inline):** VERIFIED — identical unit/e2e counts, 0 non-baseline tsc errors.
- **Lens A verdict (contract):** PASS — 11 keyed routes, PUT contract and codes, real replay status, exact OpenAPI, forward pointers honored (bindings, real status, fence-lost neither remembered nor released, PUT notes).
- **Lens B verdict (security):** PASS — per-admin isolation, 401/403 reserve nothing, 403 matrix covers every non-admin role, malformed key refused before storage, reader exposes nothing cross-actor, token factory unbound, D4 fields unreachable.
- **runtime events:** none
- **spawns:** Implementer not reported by host (72 tool calls, 267,596 tokens, ended complete); Reviewer A not reported by host, ended complete; Reviewer B not reported by host (20 tool calls, 90,924 tokens), ended complete
- **Requirements covered:** FR-1…FR-6 (HTTP), FR-3 replayed create/invitation/refusal, FR-6 cross-admin, FR-8 (HTTP incl. `UNKNOWN_FIELD`), FR-10.
- **Decisions made:** `POST /users` asserts 0 invalidations (a new user has no cache entry).
- **ADVISORY (never gating):**
  - RISK (contract) → **T-7 addendum:** a replayed refusal also carries `Idempotency-Replayed: true`, while OpenAPI documents it on 2xx only ("Absent otherwise"); the addendum must state it, and OpenAPI text should be aligned later.
  - READABILITY → **T-7 addendum:** state that 409 `IDEMPOTENCY_IN_PROGRESS` is transient — retry later with the same key (design § 8, DD-4).
  - RISK: FR-6 cross-admin tested only for the same request; add "another admin, different body, same key → fresh run not 422" and "another admin while first is held → not 409".
  - RELIABILITY: the production reader's missing-user path (→ 503) has no unit test; `withIdempotencyErrors` replaces a route's own 422 list instead of merging.
  - RELIABILITY: PUT OpenAPI notes (reason kept, 503 before 404) and the request-body schema are not asserted by an OpenAPI e2e.
  - RISK → **T-7:** FR-3 "no decision line other than the replay line" and NFR-2 have no HTTP-level log test — the T-7 log spy must cover them.
  - READABILITY: `NON_ADMINS` duplicated in two e2e files.
  - RESILIENCE → **T-8:** everything ran on the in-memory key store (P-12).
- **Final verification:** VERIFIED + both lenses PASS.

### T-7: Privacy, docs and front contract addendum — PASS (attempt 2)

- **Date:** 2026-10-20
- **Skills / effort:** nestjs-expert, api-design-principles, cognitive-doc-design · effort `medium`
- **Review mode:** checklist (task Review field)

**Attempt 1 — FAIL**
- **Files changed:** `server/test/users-admin-idempotency-privacy.e2e-spec.ts` (new, 7 tests), `server/test/support/log-spy.ts` (new, extracted from `users-admin-privacy.e2e-spec.ts`), `server/test/perf/idempotency-overhead.measure.ts` (new), `server/vitest.config.measure.ts` (new), `docs/specs/changes/users-admin-write-safety/front-contract.md` (new), `server/test/users-admin-privacy.e2e-spec.ts`, `server/src/common/AGENTS.md`, `server/src/users/AGENTS.md`, `server/src/database/AGENTS.md`, `server/test/AGENTS.md` — +892/−61.
- **Implementer verification:** lint/build clean; `Test Files 41 passed (41)`, `Tests 1316 passed (1316)`; tsc 7 baseline only; e2e `Test Files 11 passed (11)`, `Tests 538 passed (538)`.
- **Falsifier** (extra replay line carrying `claim.body`): `AssertionError: POST /users: expected [ Array(2) ] to deeply equal [ { event: 'idempotency', …(5) } ]` (leaked email and reason); restored.
- **NFR-3 (as measured):** in-memory key store, real socket, 50 warm-up + 300 interleaved unkeyed/keyed `PATCH /users/:id` pairs, 4 runs; paired difference p50 3.04 ms, p95 5.35 ms (other runs 5.05–5.13 ms); per-arm IQR ≈ 12 ms; replay touches no catalog or Cognito (counters). Opt-in command: `cd server && pnpm exec vitest run --config ./vitest.config.measure.ts --silent=false`.
- **Evidence re-run (Leader inline):** VERIFIED — identical counts; the measure config is not picked up by the default suites.
- **Reviewer verdict:** FAIL — verbatim:
  1. **Discovered Issue:** The NFR-3 figure (p50 3.04 / p95 5.35 ms over 300 pairs) comes from the in-memory key store. That harness cannot measure what dominates the real cost: four MySQL round trips per keyed write (purge DELETE, INSERT, `markExecuted` UPDATE inside the business transaction, `complete` UPDATE). The purge also deletes nothing there, since no rows are expired, so its measured cost is a no-op. The measure file defers the gap with "the real figure is T-8" (`test/perf/idempotency-overhead.measure.ts:206-207`). `execution.md:145` likewise sends the purge/NFR-3 concern to T-8. But T-8's scope (`tasks.md:147-157`) has no overhead measurement, so the gap is not actually recorded anywhere that will close it. As things stand, the "≤ 20 ms" claim rests on a harness that cannot evaluate it. **Violated Rule:** `requirements.md:209` NFR-3 ("Added overhead p95 ≤ 20 ms"), and reviewer contract § 3: evidence from a harness that cannot evaluate the property must be a recorded gap, never a pass. **Remediation Suggestion:** Record the in-memory figure in `execution.md` as interceptor/store-call overhead only, with NFR-3 on MySQL marked as an explicit open gap. Then either add a keyed-vs-unkeyed check of at least 200 pairs (p95 plus spread) against the local API on `qadb` to T-8's checklist (Leader), or record that the gap is accepted. Make the measure-file comment point to wherever that lands.
- **Leader adjudication:** the finding is a **spec tension**, not an Implementer defect — T-7's task text specifies the measurement "on the e2e app", which cannot evaluate NFR-3 on MySQL. Leader-side remediation applied here: **NFR-3 status = interceptor/store-call overhead only (p95 ≈ 5 ms on the in-memory store); NFR-3 on MySQL is an OPEN GAP.** A one-line amendment proposal (add a ≥ 200-pair keyed-vs-unkeyed check against the local API on `qadb` to T-8) goes to the back lead at the next gate. Attempt 2 fixes the measure-file pointer and the in-scope guide inaccuracies ("guides … true of the code").
- **runtime events:** none
- **spawns:** Implementer not reported by host (44 tool calls, 178,241 tokens, ended complete); Reviewer not reported by host, ended complete
- **ADVISORY (attempt 1):** lock order in `database/AGENTS.md:101` / `users/AGENTS.md:37` omits the final `idempotency_keys` row lock taken by `markExecuted`; `database/AGENTS.md:92` says `response_body` is "never read by any route" (the same-actor replay reads it) and omits `reserve`'s stale-row delete; `common/AGENTS.md:64` "a few `*_failed` error lines" omits the `complete_lost` warn line; the log spy covers 6 of 11 routes.
- **TRD pending items (for `staging`, recorded per T-7 scope):** § 5.1 `idempotency_keys` table and migration `0002`; § 6 idempotency convention for writes (`Idempotency-Key`, `Idempotency-Replayed`, 409 `IDEMPOTENCY_IN_PROGRESS`, 422 `IDEMPOTENCY_KEY_REUSED`, 120 s lease, 24 h retention, `PUT /users/:id`); § 7 logging convention gains the `idempotency` field and `event:idempotency` lines.
- **P-14:** OPEN — addendum at `docs/specs/changes/users-admin-write-safety/front-contract.md` to be sent to the front lead by a human; if declined, DD-4 switches the in-flight answer to 503.

**Attempt 2 — PASS**
- **Effort:** `high` (bumped from `medium`).
- **Files changed:** `server/test/perf/idempotency-overhead.measure.ts` (SCOPE block: in-memory overhead only, purge deletes nothing here, NFR-3 on MySQL is an OPEN GAP recorded in this entry), `server/test/AGENTS.md`, `server/src/database/AGENTS.md` (lock order ends with the `idempotency_keys` row X-locked by `markExecuted`; `response_body` read only by the same-actor replay; `reserve` stale-row delete), `server/src/users/AGENTS.md` (same lock-order step), `server/src/common/AGENTS.md` (`settle_failed`/`complete_failed` error + `complete_lost` warn). Text only.
- **Sweep:** `grep -rn -i "T-8\|real figure\|real MySQL figure"` over perf, guides and addendum → only `server/test/AGENTS.md:30` "(P-12, T-8)" about MySQL locking (correct, kept).
- **Implementer verification:** lint/build clean; `Tests 1316 passed (1316)`; tsc 7 baseline; e2e `Tests 538 passed (538)`.
- **Evidence re-run (Leader inline):** VERIFIED — identical counts.
- **Reviewer verdict (re-review, override (e)):** PASS — "every changed claim matches the code"; the adjudication record exists and keeps the gap open, not claimed closed.
- **runtime events:** none
- **spawns:** Implementer not reported by host (14 tool calls, 74,199 tokens, ended complete); Reviewer not reported by host, ended complete
- **Requirements covered:** FR-9 (logs), NFR-2 (log spy over every logger), NFR-3 (in-memory overhead only — MySQL OPEN GAP), FR-10 (guides + addendum), P-14 (recorded OPEN).
- **Final verification:** VERIFIED + Reviewer PASS.

## Constitution Impact: T-2…T-7

- `server/src/common/idempotency/` is a new shared sub-module (`@Idempotent()`, interceptor, store, fingerprint); its guide section lives in `server/src/common/AGENTS.md` (updated in T-7). No new child guide needed.
- `users` public surface changed: `PUT /users/:id`, `@Idempotent()` on 11 routes, `AdminContext.idempotency`, `UsersAdminRepositories.idempotency` (guides updated in T-7).
- TRD pending items for `staging`: listed in the T-7 entry. CodeGraph not initialized — no re-index.
- Follow-up outside this spec: two identical `isDuplicateKeyError` copies (`common/idempotency/idempotency.errors.ts`, `users/users.errors.ts`).

### T-8: HITL validation (shared DB) — in progress

- **Date:** 2026-10-20 · with the back lead (operator), VPN connected.
- **Deploy:** feature merged `--no-ff` into `staging-center` (`617d560`, server suite re-run on the merge: 1316 unit / 538 e2e green) and `staging-center` into `dev` (`83980f0`); GitHub trigger run `39478851801` success; back lead confirmed the Jenkins `dev` deploy.
- **`0002` on `qadb` (read-only check, 192.168.20.210:3306/qadb):** **confirmed** — `idempotency_keys` exists exactly as migration `0002` (PK `(actor_id, idem_key)`, `idem_key` `ascii`/`ascii_bin`, state enum, `idx_idempotency_keys_expires`, FK to `users`); `__drizzle_migrations` holds 3 entries; 0 rows. Server: MySQL 8.0.46, global isolation `REPEATABLE-READ` (the unit of work sets `READ COMMITTED` per transaction), `binlog_format=ROW` (meets `server/src/database/AGENTS.md`).
- **P-12 (real MySQL locking) — CONFIRMED** with the real `DrizzleIdempotencyStore` (`dist/`) on `qadb`, concurrent connections (pool of 12); probe keys `t8-probe-*`, all deleted (46 rows deleted, 0 left):
  - concurrent `reserve` of one key: 20/20 rounds, exactly 1 winner of 8 racers (duplicate-key 1062 for the rest);
  - take-over race on an expired lease: 20/20 rounds, exactly 1 winner of 8; the old token is refused afterwards 20/20;
  - `markExecuted` inside a `READ COMMITTED` transaction vs a concurrent take-over: 5/5 rounds the take-over blocked on the row lock (≥ 500 ms) and lost after commit; the row stayed `executed` with the original owner;
  - stale `markExecuted` after a take-over: throws `IdempotencyFenceLostError`.
- **P-13 (qatest shares `qadb`):** open — pending the back lead / infrastructure owner.
- **API replays (FR-3/FR-5 on the running API) — CONFIRMED** on the local API (`staging-center` build, `localhost:3400`, `qadb`, MySQL + DynamoDB startup checks green), with the back lead's admin session (token used in memory only, never stored). TEST was not touched (`AGENTS.md`). Test user: `j.delgado+t8-idem@cgiar.org` (`custom`), user id **1036** — persists in `qadb` and the Cognito pool (users are not deletable).
  - `POST /users` with K1 twice → 201, then 201 `Idempotency-Replayed: true`, same id 1036, new `meta.requestId`; users with the test email: 0 → **1**.
  - Same K1, different body → 422 `IDEMPOTENCY_KEY_REUSED`.
  - `POST /users/1036/invitation` with K2 twice → 200, then 200 `Idempotency-Replayed: true`; audit rows added by both calls: **1** (one resend executed). **Email count to be confirmed by the back lead in the inbox:** expected one invitation from the create plus one from the first resend, none from the replay.
  - Two identical `PATCH /users/1036` with K3 at once → one 200 and one 409 `IDEMPOTENCY_IN_PROGRESS`; audit rows added: **1**.
  - No key twice → 200, 200, no replay header (FR-1). Malformed key → 400 `VALIDATION_FAILED`.
  - Stored rows for K1/K2/K3: `completed` with statuses 201/200/200 and `target_user_id` 1036.
- **Finding — replayed `data` key order (FR-3):** the replayed `data` is equal to the first answer in every value, but **not byte-equal**: MySQL's `JSON` column normalizes object key order (first: `id,email,firstName,…`; replay: `id,email,roles,status,lastName,…`). The e2e suite could not see it (the in-memory store keeps insertion order). JSON objects are unordered, so clients parsing JSON are unaffected; a client comparing raw bytes would see a difference. Raised to the back lead: accept, or store `response_body` as text in a follow-up.
- **Open decisions carried:** NFR-3 on MySQL (T-8 amendment proposed, undecided); resend second-email risk after a take-over (undecided); P-14 (addendum to send).

## Budget Tripwire: after T-3 attempt 1

- **Budget (design § 2):** 8 tasks · ~3,600 LOC · ~14 Reviewer passes.
- **Actual:** 3 of 8 tasks implemented; ≈ 3,670 LOC (T-1 ≈ 260, T-2 ≈ 2,000, T-3 ≈ 1,470 — tests ≈ 75 %); 5 Reviewer verdicts so far (T-3 review pending).
- **Delta:** LOC budget exceeded with 5 tasks left (T-4, T-5, T-6 each sized M with large test tables). Projected total ≈ 7,000–8,000 LOC; Reviewer passes on track.
- **Cause:** concurrency harness (SQL-executing driver + contract suite run against fake and adapter) and the interceptor decision table are far larger than the design's per-gate estimates (≈ 600 for T-2's pieces). Not scope growth: no task beyond the approved list; the size is in tests the defect-class gates require.
- **Escalated to the back lead:** 2026-10-20, before the T-3 Reviewer spawn.
- **Decision (back lead, 2026-10-20):** "Adelante, terminalo" — option 1: accept the larger size and continue; the LOC tripwire is re-baselined to the projection (≈ 8,000 LOC). Read as authorization to proceed through the remaining routine task gates; exceptions (HALT, Pivot, FATAL_FAIL, a further budget breach, the T-8 HITL step) still stop for the user.

## Constitution Impact: T-1

- Shared schema gained `idempotency_keys` and migration `0002_idempotency_keys` (additive). `server/src/database/AGENTS.md` update is T-7 deliverable; TRD § 5.1 is a pending item for `staging`. Migration `0002` must be applied to `qadb` by a human (T-8) before the API runs against it with this code.
