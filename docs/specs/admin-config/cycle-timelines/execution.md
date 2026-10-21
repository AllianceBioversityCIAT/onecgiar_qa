# Cycles and QA timelines — Execution Log

## Document Control

| | |
|---|---|
| Spec path | `docs/specs/admin-config/cycle-timelines` |
| Branch | `feat/cycle-timelines` |
| Approval Mode | gated (from the proposal) |
| Started | 2026-10-21 |
| Leader | Claude Code, `opus` (T1) — operator: Juan D. Guzmán (back lead) |
| Workers | `akili-implementer` (T2 wrapper) · `akili-reviewer` (T3 wrapper) |
| Budget (design § 10) | 10 tasks · ~2,600 LOC · ~14 Reviewer passes |

Persona check: `akili doctor --agents` — no drift blocking (2026-10-21).

## Task Execution History

### T-1: Schema and migration `0003` for the six tables — PASS

- **Date:** 2026-10-21
- **Final status:** PASS (attempt 1)
- **Implementer attempts:** 1
- **Skills / effort:** nestjs-expert, nestjs-best-practices (as listed) · effort `high` (above the T2 `medium` default: a shared schema on a DB that is never reset; exact SQL matters).
- **Scheduling:** T-1 and T-2 were both eligible with disjoint source files, but they share `dist/` and the full test run. They ran serially (leader.md → *Disjoint source files are necessary but not sufficient*).

**Attempt 1**
- **Files changed:** `server/src/database/drizzle/schema/{cycles,timelines,timeline-steps,timeline-programs,timeline-result-types,timeline-users}.ts` (new), `server/src/database/drizzle/schema/index.ts`, `server/src/database/drizzle/schema/schema.spec.ts`, `server/drizzle/0003_cycle_timelines.sql` (new), `server/drizzle/meta/0003_snapshot.json` (new), `server/drizzle/meta/_journal.json`, `server/src/database/AGENTS.md`.
- **runtime events:** session death ×1 (the previous Claude Code session ended mid-spawn) → rung 1 tree probe (partial edits found: the six schema files, `0003` + snapshot, spec, index, journal, AGENTS.md) → rung 3 resume-by-message (worker context survived). The worker re-read its files from the tree and finished.
- **Red run:** the six re-exports were removed and `0003` + snapshot moved aside. First failure: `AssertionError: expected [ '0000_silent_risque.sql', …(2) ] to have a length of 4 but got 3`. Totals 43 failed / 38 passed. The table pins failed with `the table is exported by schema/index.ts: expected undefined to be defined`. Restored afterwards (journal identical).
- **Falsifiers** (each run as `pnpm exec vitest run src/database/drizzle/schema/schema.spec.ts`, then reverted):
  - F1, `official_key` as a plain column: `schema.spec.ts:680`, `AssertionError: official_key is stored: expected undefined to be 'stored'` (1 failed).
  - F2, `position <> 1 OR` dropped: `schema.spec.ts:815`, `AssertionError: expected '`requires_load`' to be '`position` <> 1 OR `requires_load`'`.
  - F3, `opens_on` in date mode: `schema.spec.ts:764`, `AssertionError: opens_on: expected 'date' to be 'string'`.
- **Implementer verification:** `pnpm lint` exit 0 · `pnpm build` exit 0 · `pnpm test --reporter=dot` 41 files / 1360 tests passed · `npx tsc --noEmit` 7 errors, all in `src/auth/token-verifier.service.spec.ts` (baseline). An extra tsc error from an `.autoIncrement` pin was replaced by an SQL pin after the falsifier runs; everything was re-run green afterwards.
- **Evidence re-run (Leader inline, non-author):** VERIFIED. Lint OK, build OK, 41 files / 1360 tests passed, and tsc reported 7 errors in `token-verifier.service.spec.ts` only.
- **Reviewer verdict:** PASS. T-1 matches design § 5 table by table. `0003` is strictly additive: 6 CREATE TABLE, 13 FK ADD CONSTRAINT, 2 CREATE INDEX, and no DROP, MODIFY, RENAME or data statements. The reserved load tables are absent. Pins are exact: full column maps, exact CHECK SQL and generated SQL, `toEqual` on unique and FK sets, and collation asserted in both schema and SQL. Each falsifier fails on its target behavior.
- **spawns:** implementer — not reported by host for the first (killed) segment; resumed segment 8 calls, 167,732 tokens, ended complete · reviewer 16 calls, 72,627 tokens, ended complete.

**ADVISORY (Reviewer, 4R — not gating)**
- RISK: `server/drizzle/meta/0003_snapshot.json` must be committed with the migration, or the next `drizzle-kit generate` re-emits the six tables. → Committed in the T-1 commit.
- RISK: the `timelines.ts` comment equates `utf8mb4_0900_ai_ci` with what `users.nickname` gets implicitly. That holds only if qadb's server default is `0900_ai_ci`, which is unverified. Confirm at T-10 (`SHOW FULL COLUMNS FROM users`).
- READABILITY: `ai` makes accents collide too ("Julio" = "Júlio"), which goes beyond FR-6's "regardless of letter case". Worth one line in the database AGENTS.md and a business question.
- RELIABILITY: NOT NULL on `created_by` / `assigned_by` rules out seeded or system-created rows. That is acceptable here; recorded below as deliberate.
- RESILIENCE: CHECK and generated-key behavior on real MySQL is still owed by T-10.

**Requirements covered:** FR-1 (unique year key), FR-3 (`active_key`), FR-5 (`official_key` backstop), FR-6 (unique per cycle, case-insensitive collation), FR-8 (`chk_timeline_steps_dates`, same day valid), FR-9 (`chk_timeline_steps_first_load`, no default), FR-14 / FR-15 (`timeline_users.active_key`, `chk_timeline_users_removed`, soft remove), NFR-3 (DB part), NFR-6 (reserved tables not created).

**Decisions made**
- **P-12 settled:** without `dateStrings`, mysql2 builds a local-zone `Date` for DATE. See `lib/parsers/text_parser.js:58-63`, `lib/packets/packet.js:731-747` (`localDate(...)` when timezone is unset or `'local'`), and `lib/parsers/local_date.js:6-7`. The defaults are `connection_config.js:123` (`dateStrings = false`) and `:142` (`timezone = 'local'`), and `drizzle.module.ts:18-21` sets neither. Drizzle's mysql2 session `typeCast` returns `field.string()` for DATE on reads (`drizzle-orm/mysql2/session.js:26-31, 36-41, 168-173`), so a default-mode `date` reads as UTC midnight with no shift. The shift risk is on writes: a default-mode `date` has no `mapToDriverValue`, and sql-escaper `dateToString` serializes with timezone `'local'` (`sql-escaper/lib/index.js:319-326`). **DD-5 (string mode) stays justified**, because it removes both paths. Nothing else changes. This finding comes from reading source only; the round-trip is confirmed at T-10.
- `timelines.name` collation is explicit `utf8mb4_0900_ai_ci`, which is case- and accent-insensitive. The Reviewer judged it within FR-6 / P-7 ("same collation approach as `users.nickname`"). Accent-insensitivity is surfaced to the back lead at the T-1 gate.
- `cycles.created_by`, `timelines.created_by` and `timeline_users.assigned_by` are NOT NULL, because every writer in this spec is an authenticated ADMIN route. Design § 5 is silent on this.
- `chk_cycles_lifecycle` follows design § 5 literally: `closed` requires `closed_*` and leaves `activated_*` unconstrained.
- Generated SQL was not hand-edited; drizzle `customType` expresses the generated columns, CHECKs and collation.

**Issues encountered:** the worker's first red-run attempt dropped two unrelated exports. It discarded that attempt and redid it correctly. Nothing was left in the tree.

**Final verification:** VERIFIED, as in the evidence re-run above. `pnpm db:migrate` was never run (T-10 is a human step).

### T-2: Error codes, field codes, Rome dates, default steps, clock — PASS

- **Date:** 2026-10-21
- **Final status:** PASS (attempt 1)
- **Implementer attempts:** 1
- **Skills / effort:** nestjs-best-practices, error-handling-patterns, tdd (as listed) · effort `medium`.

**Attempt 1**
- **Files changed:** `server/src/common/error-codes.ts`, `server/src/common/error-codes.spec.ts`, `server/src/admin-config/{rome-date,rome-date.spec,admin-config.clock,admin-config.errors}.ts` (new), `server/src/admin-config/timelines/{default-steps,default-steps.spec}.ts` (new).
- **runtime events:** none.
- **Red run:** `rome-date.spec` was run against a stub returning `toISOString().slice(0,10)`, and 23 tests failed on assertions. One example: `todayInRome > 25 Oct, 23:30Z is 00:30 Rome on 26 Oct`, `expected '2026-10-25' to be '2026-10-26'`.
- **Falsifiers** (executed, then reverted):
  - UTC (`toISOString().slice(0,10)`): `TZ=UTC pnpm exec vitest run src/admin-config/rome-date.spec.ts` had 7 failures, including the 25-Oct 23:30Z case.
  - Local getters: `TZ=America/Bogota pnpm exec vitest run src/admin-config/rome-date.spec.ts` had 7 failures, including `summer, 22:00Z is the next Rome day`, `expected '2026-07-15' to be '2026-07-16'`.
- **Implementer verification:** lint clean · build OK · 43 files / 1422 tests passed · tsc 7 baseline errors (`token-verifier.service.spec.ts`) · rome-date 34/34 in `TZ=UTC` and in `TZ=America/Bogota` · `pnpm test:e2e` 11 files / 538 passed.
- **Evidence re-run (Leader inline, non-author):** VERIFIED. All of the counts above matched exactly.
- **Reviewer verdict:** PASS. The § 7.5 codes and statuses match, and so do the seven field-code names. FR-4 is pinned literally. The catalog change is additive only, and `todayInRome` never reads the local zone. Expected values are literals. `TimelineValidationError` builds its messages only from `FIELD_ERRORS`. The `import type` of `FieldIssue` from `users/` is acceptable (P-11).
- **spawns:** implementer 17 calls, 103,552 tokens, ended complete · reviewer 16 calls, 52,678 tokens, ended complete.

**ADVISORY (Reviewer, 4R — not gating)**
- READABILITY / RISK: `default-steps.ts` declares its own `StepAudience` union, which duplicates `stepAudiences` / `StepAudience` in `server/src/database/drizzle/schema/timeline-steps.ts:15-22`. The two can drift silently.
- READABILITY: `FieldIssue` is now shared by two modules but still lives in `users/`.
- RELIABILITY: `todayInRome` has no Invalid Date guard (it throws `RangeError`, so a broken clock gives a 500). Acceptable, because the clock is injected.
- RELIABILITY: `isCalendarDate` accepts years 0100–0999, below the MySQL DATE range. The step rules make these unreachable.

**Requirements covered:** FR-4 (table), FR-8 (Rome date for back-dated starts, date part), FR-11 (catalog codes only), FR-12 (DST date part), NFR-4.

**Decisions made**
- The signature is `todayInRome(now: Date): string`; the design gives none.
- The seven field-code messages were worded by the Implementer, because design § 7.5 gives names only. The Reviewer checked them against FR-8: "cannot be before" still allows the same day. They are surfaced to the back lead at the gate.
- The `ADMIN_CONFIG_CLOCK` binding is left to T-5, the module task.

**Issues encountered:** none.

**Final verification:** VERIFIED (see the evidence re-run above).

### T-3: Timeline create rules (pure) — PASS

- **Date:** 2026-10-21
- **Final status:** PASS (attempt 1)
- **Implementer attempts:** 1
- **Skills / effort:** tdd, nestjs-best-practices (as listed) · effort `high` (above default: every AC 4–11 rule lives here, and the boundaries must sit exactly on the boundary).

**Attempt 1**
- **Files changed:** `server/src/admin-config/timelines/timeline-rules.ts` (new), `server/src/admin-config/timelines/timeline-rules.spec.ts` (new, 57 tests).
- **runtime events:** none.
- **Red run:** the full table was run against a stub returning `[]`, and 37 tests failed on assertions. One example: `name (FR-6) > empty`, `AssertionError: expected [] to deeply equal [ { field: 'name', code: 'REQUIRED' } ]`.
- **Falsifiers** (run with `pnpm test --reporter=dot src/admin-config/timelines/timeline-rules.spec.ts`, then restored from a backup and diffed):
  - F1, `return issues.slice(0, 1)`: 4 failed, including `all issues at once (FR-11) > lists name, programs and a missing closing date, and nothing else`.
  - F2, overlap `compareDates(opensOn, previousClose) <= 0` changed to `< 0`: 2 failed, including `the next step opens on the previous closing day`, `expected [] to deeply equal [ { field: 'steps[1].opensOn', …(1) } ]`. The day-after row stayed green.
  - F3, the empty-list branch pushes no issue: 4 failed, including `an empty list is not "all"` (the `programIds` and `resultTypeKeys` rows).
- **Implementer verification:** lint clean · build OK · 44 files / 1479 tests passed · tsc 7 baseline errors (`token-verifier.service.spec.ts`).
- **Evidence re-run (Leader inline, non-author):** VERIFIED. All counts matched.
- **Reviewer verdict:** PASS. FR-6 to FR-11, § 7.1, § 7.2, § 7.5, DD-6, DD-8, S-1, S-2 and S-4 are met. No Implementer assumption contradicts a scenario. Boundary rows sit exactly on their boundaries, and each falsifier reddens its target row. The several-problems row conforms to FR-11 as amended.
- **spawns:** implementer 17 calls, 108,371 tokens, ended partial (report carried assumptions only, no owed item, so no continuation was due) · reviewer 11 calls, 52,611 tokens, ended complete.

**Not Done / Assumptions (Implementer, verbatim)**
1. **Field path conflict.** FR-11 literally says the 400 lists `name`, `programs` and `steps[2].closesOn`, but design § 6 names the request keys `allPrograms`/`programIds` and `allResultTypes`/`resultTypeKeys`. Design § 7.2 and § 7.5 name no path for either list, so I did not read this as a § 7.2 conflict and did not stop. I used the request keys `programIds` and `resultTypeKeys`, as with `steps[i].<key>`. If you want `programs` and `resultTypes` instead (as users does), the fix is two string literals in `timeline-rules.ts` plus the matching spec rows. T-6 and the DTO should settle which one it is.
2. **Codes the requirements don't fix:**
   - A missing, null or empty date is `REQUIRED`, and a malformed one such as `2026-02-30` or `02/11/2026` is `INVALID`.
   - An empty scope list is `REQUIRED`.
   - "All" together with ids is `INVALID` on the list, and the catalog is not also checked in that case.
   - An unknown audience is `INVALID`; a repeated or out-of-order one is `AUDIENCE_ORDER` on the later step.
   - A first step with `requiresLoad: false` is `FIRST_STEP_LOAD` on `steps[0].requiresLoad`.
   - A bad first round, or a round that is neither the previous step's round nor that plus one, is `ROUND_SEQUENCE` on that step's `round`.
3. **Count and per-step checks both run.** A request with 6 steps reports `steps OUT_OF_RANGE` and also `steps[5].audience AUDIENCE_ORDER`, because a sixth step can only repeat an audience. The spec pins this literally. It also runs the per-step checks (name, audience, dates, load, round) on out-of-range counts, since FR-11 says to collect everything.
4. **Date comparisons.** The overlap check compares only with the immediately preceding step, and is skipped when that step's closing date is missing or invalid. The close-before-open check is skipped when either date is missing or invalid, so each bad date yields one issue.
5. **Extra rules beyond your list.** I also check step names (`steps[i].name`: `REQUIRED`, or `TOO_LONG` with max 120 after trim), because FR-7 requires them. Names are trimmed before the length check.
6. **Input shape.** `TimelineCreateInput` and `TimelineStepInput` are defined in `timeline-rules.ts`. Dates are typed optional and nullable so the "missing date" scenario is representable. The T-6 DTO should satisfy this structurally.

**ADVISORY (Reviewer, 4R — not gating)**
- RELIABILITY: overlap is skipped when the previous step's closing date is missing or invalid, so a real overlap surfaces only in a second round. FR-8 leaves this case undefined. A fallback to the previous step's opening date would keep it in one round.
- READABILITY: `FieldIssue` is still imported from `users/` (same advisory as T-2).
- READABILITY: no row uses the FR-10 "Regrouped rounds" fixture (`1,1,1,2,2`) literally.
- RISK: the timeline name and the step name share one constant, `NAME_MAX = 120`.

**Requirements covered:** FR-6 (scope; empty list is not "all"), FR-7, FR-8 (all scenarios, Rome date as an argument), FR-9 (rule; the input is never mutated), FR-10, FR-11 (every issue, catalog codes only).

**Decisions made**
- **Execute-time spec edit:** `requirements.md` → FR-11 "Scenario: Several problems", THEN line. `programs` was changed to `programIds`, with the note "field paths are the request keys of design § 6; result types report on `resultTypeKeys`". Reason: a spec tension between the FR-11 wording and the design § 6 `TimelineCreate` keys. The back lead chose `programIds` on 2026-10-21. The meaning is unchanged (same field, path aligned). The forward sweep for stale `programs` field paths over the spec folder found no hits (the remaining `programs` mentions are the audience). This edit is carried as a named conformance check into the T-4 Reviewer brief.
- The codes for cases the requirements leave open (assumption 2) were accepted by the Reviewer against § 7.5 and DD-8.

**Forward pointer → T-6:** the T-6 DTO must satisfy `TimelineCreateInput` / `TimelineStepInput` structurally (assumption 6), and its e2e three-problem request must expect `programIds` as the path.

**Issues encountered:** none.

**Final verification:** VERIFIED (see the evidence re-run above).

### T-4: Timeline view — status, current step, readiness (pure) — PASS

- **Date:** 2026-10-21
- **Final status:** PASS (attempt 1)
- **Implementer attempts:** 1
- **Skills / effort:** tdd (as listed) · effort `medium`.
- **Review intensity:** the task is not marked `skip-eligible` (Review: checklist), and override (g) applied because the FR-11 edit-carry needed a Reviewer brief. A conformance Reviewer was spawned. The 249-line diff was delivered as a scratchpad file rather than inline; the size rule allows inline delivery at that length, and the Reviewer keeps `Read`.

**Attempt 1**
- **Files changed:** `server/src/admin-config/timelines/timeline-view.ts` (new), `server/src/admin-config/timelines/timeline-view.spec.ts` (new, 18 tests).
- **runtime events:** none.
- **Red run:** run against a stub returning `scheduled`, null, null, `[]`. 16 of 18 tests failed on assertions; one example is `on 2026-11-07 the current step is null and the next is 2`, `expected [ null, null ] to deeply equal [ null, 2 ]`.
- **Falsifiers** (run with `npx vitest run src/admin-config/timelines/timeline-view.spec.ts`, then restored from a backup):
  - F1, `compareDates(today, step.closesOn) <= 0` changed to `< 0`: 3 failed, including `on 2026-11-06 the current step is 1 and the next is 2`, `expected [ null, 2 ] to deeply equal [ 1, 2 ]`.
  - F2, as worded ("map `programs` to a role"): an equivalent mutant that stayed green, because `MISSING_ROLE_ITEM` has no `PROGRAM` entry and an `undefined` guard drops it. The stronger mutant maps `programs` to `'PROGRAM'` **and** adds `PROGRAM: 'NO_PROGRAM_ASSIGNED'`. It failed 4 readiness rows, including `lists the missing assessor and no Science Programs item`. The Reviewer ruled the falsifier meaningfully executed with the stronger mutant: the test's exact `toEqual` fails on any extra item, and the gap lies in the falsifier's wording, not in the test.
- **Implementer verification:** lint and build OK · 45 files / 1497 tests passed · tsc 7 baseline errors (`token-verifier.service.spec.ts`).
- **Evidence re-run (Leader inline, non-author):** VERIFIED. All counts matched.
- **Reviewer verdict:** PASS. FR-12 status, current step and next step are correct at every boundary (25 Oct, 26 Oct, 6 Nov, 7 Nov, 9 Nov, 20 Nov, 21 Nov). The function is pure and stores nothing (DD-2). Readiness matches the FR-13 table and the design § 7.1 audience → role map, with `programs` mapped to none. The FR-11 carry does not apply to this diff: the `'programs'` string here is the step audience, not a request key.
- **spawns:** implementer 12 calls, 74,900 tokens, ended complete · reviewer 7 calls, 32,218 tokens, ended complete.

**ADVISORY (Reviewer, 4R — not gating)**
- READABILITY / RELIABILITY: two guards (the `null` in `AUDIENCE_ROLE` and the `Partial` `MISSING_ROLE_ITEM`) both block a Science Programs item. Typing `MISSING_ROLE_ITEM` as a total record of the four roles would leave one point of control, and the F2 falsifier as written would then turn red.
- RELIABILITY: readiness codes are typed `string[]`. A `ReadinessCode` union would give T-7 and T-8 compile-time checks.
- READABILITY: `StepAudience` is duplicated in `default-steps.ts:2` and `schema/timeline-steps.ts:22` (also noted at T-2).
- RELIABILITY: if two steps were open on the same day, the first in array order would win. S-1 and FR-8 rule this out at create time.

**Requirements covered:** FR-12 (status, current step and next step; no stored change; DST date part in T-2), FR-13 (readiness table, no Science Programs item, not blocking).

**Decisions made**
- The readiness codes follow FR-13's `NO_<ROLE>_ASSIGNED` pattern: `NO_ASSESSOR_ASSIGNED`, `NO_LEAD_ASSESSOR_ASSIGNED`, `NO_TPB_ASSIGNED`, `NO_PPU_ASSIGNED`. They are plain strings, not error-catalog entries.
- Readiness order: `NO_RESULTS_LOADED` first, then the missing roles in step order, with no duplicates.
- `nextStep` is the earliest step whose `opensOn` is after today. Steps are used in the order given (by `position`).
- The FR-11 edit-carry made its second and last appearance in this Reviewer brief, and now drops.

**Forward pointer → T-9:** `front-contract.md` must list the exact readiness codes above, so the client takes them from the contract.

**Issues encountered:** none.

**Final verification:** VERIFIED (see the evidence re-run above).

### T-5: Cycles module — create, list, activate — PASS

- **Date:** 2026-10-21
- **Final status:** PASS (attempt 1)
- **Implementer attempts:** 1
- **Skills / effort:** nestjs-expert, nestjs-best-practices, api-design-principles, error-handling-patterns (as listed) · effort `xhigh` (above default: first module, concurrency, idempotency wiring).
- **Review mode:** parallel lens reviewers (effort `xhigh` plus an authorization surface). Reviewer A covered reliability and resilience; Reviewer B covered risk and readability. Both also checked baseline spec conformance, from a shared brief file in the session scratchpad. The diff was 2896 lines, delivered by file.

**Attempt 1**
- **Files changed:** `server/src/app.module.ts` (+2, additive); new: `server/src/admin-config/admin-config.module.ts`, `server/src/admin-config/admin-config.context.ts`, `server/src/admin-config/cycles/{cycles.module,cycles.controller,cycles.service,cycles.store,cycles.unit-of-work,cycle-view}.ts`, `server/src/admin-config/cycles/dto/{create-cycle.dto,cycle-params}.ts`, `server/src/admin-config/cycles/models/cycle.model.ts`, `server/src/admin-config/cycles/{cycles.service,cycles.unit-of-work}.spec.ts`, `server/test/support/{in-memory-admin-config,admin-config-app}.ts`, `server/test/admin-config-cycles.e2e-spec.ts`.
- **runtime events:** none.
- **Red run:** the service was stubbed and the controller had no routes. Unit: 39 failed / 3 passed, for example `AssertionError: expected { cycleId: +0 } to deeply equal { cycleId: 1 }`. e2e: 56 failed / 2 passed, for example `create 2026: expected 404 to be 201`.
- **Falsifiers** (executed, then reverted from a backup; the diff against the backup was empty):
  - F1, the two lines in `activateOnce` swapped (activate before close): `pnpm exec vitest run src/admin-config/cycles/cycles.service.spec.ts` had 6 failures, including `Error: Duplicate entry '1' for key 'cycles.uq_cycles_active_key'` and `activate (FR-3) > makes the draft active and closes the previous one in one transaction, closing first`. e2e had 4 failures, including `activate 2: expected 500 to be 200`.
  - F2, `@RequirePermission(Permission.ADMIN_ACCESS)` removed: e2e had 55 failures, including `create 2026: expected 403 to be 201` and `FR-16: access > activate: ASSESSOR gets 403 ...`. The global guard fails closed for everyone, so the rows failed in their admin setup step. Reviewer B: this evidence is weak as recorded, but the suite is not. A reflection test pins `ADMIN_ACCESS` on every route, and a weaker permission would fail the 403 rows on their own assertion.
- **Implementer verification:** lint 0 warnings · build OK · unit 47 files / 1539 · tsc 7 baseline errors · e2e 12 files / 596 (including openapi). Those totals were taken before a final type-only fix to the e2e spec; lint, tsc, build and the cycles e2e file were re-run after it.
- **Evidence re-run (Leader inline, non-author, after the final fix):** VERIFIED. Lint OK · build OK · unit 47 files / 1539 passed · tsc 7 errors, all in `token-verifier.service.spec.ts` · e2e 12 files / 596 passed.
- **Reviewer A (reliability / resilience) verdict:** PASS. FR-1, FR-2, FR-3, FR-16, FR-17, NFR-1/2/3/7, design § 6, § 7.3, § 7.5–7.7, DD-4 and DD-9 are met. The fake models row locks through the existing `RowLocks`, with every statement awaiting a round trip. The none-active test proves interleaving (`begun: 3, committed: 2, rolledBack: 1`; a serial run would show `begun: 2`), so the disqualifier does not apply. FR-17 replay returns the same 201, one row, and no new commit. On assumption 1 (the activation retry): **a spec gap, not a violation; the behavior conforms** to FR-3 and NFR-3 and to the § 7.3 race-outcome column.
- **Reviewer B (risk / readability) verdict:** PASS. Every cycles route returns 401 / 403 (six non-admin roles, nothing read or written), and a reflection test checks the permission. Invalid years return 400 `VALIDATION_FAILED` on `year` with catalog codes. Writes log one line each with the § 7.6 fields, and no DB text reaches logs or responses. `app.module.ts` is additive only, and auth/users are untouched. OpenAPI matches § 6.
- **spawns:** implementer 69 calls, 366,686 tokens, ended complete · reviewer A 22 calls, 94,701 tokens, ended complete · reviewer B 20 calls, 100,659 tokens, ended complete.

**ADVISORY (Reviewers, 4R — not gating)**
- RESILIENCE (A): one retry may not be enough on real InnoDB. With three or more concurrent activations and none active, the third can hit 1062 twice and answer 500. The invariant still holds because the change rolls back. Suggestion: map a final-attempt 1062 to 409, or loop. **Added to the T-10 HITL checks.**
- RESILIENCE (A): deadlock (1213) and lock-wait timeout (1205) are not retried and surface as 500. No deadlock cycle is visible today. Revisit at T-6, when activate and timeline create contend for cycle rows.
- RELIABILITY (A): the retry would mask the removal of the active-row `FOR UPDATE` in the fake. Only the stub-driver SQL assertion pins it. Suggestion: assert `rolledBack === 0` and that no `close:<id>` repeats in the with-active-row concurrency test.
- RELIABILITY (A): the fake's `cycles:active_key` locking is coarser than InnoDB's. It is conservative; note it in the fake's comment.
- RISK (B): F2 should be re-worded as "swap in a permission an ASSESSOR holds"; removing the decorator fails closed.
- READABILITY (B): `FieldValidationError` is reused from `users/users.errors.ts` for the year error. DD-7 has admin-config own its validation error. The response is identical; consider an admin-config field-error class before T-6 copies the pattern.
- READABILITY (B): `admin-config.context.ts` and `cycle-view.ts` are not in the design § 4 tree.
- READABILITY (B): `validYear`'s `REQUIRED` / `INVALID_TYPE` branches cannot be reached over HTTP; the year constants are imported from the DTO file.
- RISK (B): refusals by the pipe write no decision line. This matches users, and NFR-7 says "ADMIN action".

**Requirements covered:** FR-1 (new cycle is a draft; duplicate year, including concurrently on the fake; invalid year), FR-2, FR-3 (switch; never two active or none; not a draft), FR-16 (cycles routes), FR-17 (cycle create replay), NFR-1, NFR-2, NFR-3 (fake part; MySQL at T-10), NFR-7 (cycle actions).

**Decisions made**
- The activation retry (`ACTIVATION_ATTEMPTS = 2`): with no active cycle there is no row to lock, so the second concurrent activation hits 1062 on `uq_cycles_active_key`. It rolls back fully and retries once, finding and closing the first. Reviewer A classed this as a spec gap in design § 7.3. **A one-line amendment to § 7.3 is proposed to the back lead at the T-5 gate**; the user's answer will be recorded here.
- `findActive` locks through `WHERE active_key = 1 ... FOR UPDATE` (the unique index) rather than a `status` scan, to avoid waiting on target rows and deadlocks.
- `ADMIN_CONFIG_CLOCK` is bound in `CyclesModule`, and `createdAt` / `activatedAt` / `closedAt` come from the clock (NFR-4).
- `@Idempotent()` is on create only (design § 6). Activate is unkeyed and returns 200.
- `admin-config.context.ts` was added outside the listed scope, for reuse by T-6 and T-8.

**Issues encountered**
- The Implementer made 69 tool calls, past the persona's 60-call checkpoint bound, without reporting a checkpoint. Its report came back complete and verified. This is recorded as a persona-compliance note: `akili doctor --agents` showed the persona current.

**Forward pointers**
- **→ T-6:** decide whether to replace the reused users `FieldValidationError` with the admin-config `TimelineValidationError` path (DD-7). Bind `ADMIN_CONFIG_CLOCK` in `TimelinesModule` with the same factory. `AdminConfigContext` is available for reuse.
- **→ T-9:** document that `idempotency_keys.target_user_id` holds a cycle id for `POST /cycles` (and a timeline id later), and document the activation retry.
- **→ T-10:** add a check of three or more concurrent activations with no cycle active (no 500), alongside the 20-activation check.

**Final verification:** VERIFIED (see the evidence re-run above).

**T-5 gate (2026-10-21):** the back lead approved the § 7.3 amendment. **Execute-time spec edit:** `design.md` § 7.3, Activate cycle row. It adds the none-active case: no row to lock, so the second activation gets 1062 on `uq_cycles_active_key`, rolls back fully and retries once with the same outcome. The "never fires" clause now reads "while an active row exists". Reason: the T-5 Reviewer A spec gap. Requirement meaning is unchanged (FR-3 / NFR-3 outcomes). This edit is carried as a named conformance check into the T-6 and T-7 Reviewer briefs.

### T-6: Timelines — defaults and create — in progress (decisions recorded as made)

- **2026-10-21, attempt 1 lens adjudication:** Reviewer A (reliability / resilience) returned FAIL (a misnamed concurrency test claims coverage of the § 7.3 carry check). Reviewer B (risk / readability) returned PASS. The Leader judged A's FAIL **in scope**: it is false evidence for a named conformance check in the task's own tests. It consumes attempt 1.
- **Execute-time spec edits (back lead approved 2026-10-21):**
  - `design.md` § 7.2 step 2: "reads both catalogs" became "reads each catalog an explicit list needs (none when the request says "all" or the list is empty)". Reason: both Reviewers ruled the conditional read conformant with FR-6 ("a catalog **needed** to check the scope"). Requirement meaning is unchanged.
  - `design.md` § 7.2 step 1: added that `programIds` / `resultTypeKeys` and step dates are optional at the pipe, so an absent list reaches the rules as `REQUIRED` in one round (FR-6 "missing", FR-11). Reason: Reviewer A's spec gap. The back lead chose "lists reach the rules" over amending FR-11. This needs a code change, carried into attempt 2.
  - Both edits are carried as named conformance checks into the attempt-2 and T-7 Reviewer briefs.
- **Execute-time spec edit (follows the approved § 7.2 step 1 decision):** in the `design.md` § 6 `TimelineCreate` row, `programIds[]` and `resultTypeKeys[]` are now marked "optional at the pipe, § 7.2". This is a consistency edit flagged by the attempt-2 Implementer, with no new meaning.

### T-6: Timelines — defaults and create — PASS

- **Date:** 2026-10-21
- **Final status:** PASS (attempt 2)
- **Implementer attempts:** 2
- **Skills / effort:** attempt 1 used nestjs-expert, nestjs-best-practices, api-design-principles and error-handling-patterns (as listed) at effort `xhigh`. Attempt 2 used nestjs-expert, nestjs-best-practices and tdd (tdd added because the rework was test-first evidence repair; api-design-principles was dropped because no route changed) at effort `xhigh`. That is not bumped: the next level, `max`, may not run on the T2 tier, and the narrow rework did not justify escalating the tier.

**Attempt 1 — FAIL (lens A)**
- **Files changed:** new `server/src/admin-config/timelines/{timelines.store,timelines.unit-of-work,timelines.service,timelines.controller,timelines.module,timeline-response}.ts`, `timelines/dto/create-timeline.dto.ts`, `timelines/models/timeline.model.ts`, `timelines/{timelines.service,timelines.unit-of-work}.spec.ts`, `server/test/admin-config-timelines.e2e-spec.ts`; modified `server/src/admin-config/admin-config.module.ts`, `server/test/support/{in-memory-admin-config,admin-config-app}.ts`.
- **runtime events:** none.
- **Red run:** the create handler was replaced with `NotImplementedException`, and 18 e2e create tests failed on the answer, for example `AssertionError: expected 501 to be 201` and `expected [ 501, 501 ] to deeply equal [ 201, 201 ]`.
- **Falsifiers:**
  - F1, kind decided before the cycle lock: unit `AssertionError: expected 1 to be +0` (`officialKeyViolations`), `expected 4 to be +0` (five instances); e2e `expected 1 to be +0`. Deviation: the retry-as-additional backstop masks "two officials", so the observable is that the unique key never fired. Both Reviewers ruled this meaningful (§ 7.3: the 1062 "should not happen while locked").
  - F2, rules after opening the transaction: unit 7 failed, for example `expected '[[],[],[],[],["timeline:official:1"]]' to be '[[],[],[],[],[]]'`; e2e 6+ failed.
- **Implementer verification:** lint 0 · build OK · unit 49 / 1588 · tsc 7 baseline · e2e 13 / 644.
- **Evidence re-run (Leader inline):** VERIFIED. Unit 49 / 1588 · e2e 13 / 644 · tsc 7 baseline.
- **Reviewer A (reliability / resilience): FAIL** (verbatim issue):
  1. **Discovered Issue:** In `server/src/admin-config/timelines/timelines.service.spec.ts`, the test "a create racing an activation of the same cycle serializes on the cycle row and both succeed" creates two timelines in two *different* cycles. It runs no activation and shares no lock. It claims coverage of the brief's named carry check (create sharing the `cycles:<id>` lock with activation) that nothing exercises. A smaller instance of the same problem: in `timelines.unit-of-work.spec.ts`, the test "a request that breaks a rule, and a catalog that cannot be read, run no statement at all" only exercises the rule case.
     * **Violated Rule:** `.agents/reviewer.md` § 2 Red Run & Mutation Trace ("a test named after a mutation is not evidence it exercises it") and § 3 (a presence claim is not behavioural proof). The behaviour is design.md § 7.3 "Create timeline" with the 2026-10-21 Activate amendment, and DD-9.
     * **Remediation Suggestion:** Make the first test real. Use one `InMemoryAdminConfigDatabase`, and run `InMemoryCyclesUnitOfWork` activation of cycle X concurrently with a timeline create in X (and, separately, a create in the currently active cycle Y while X is activated). Assert both settle, the cycle states are right, there is one official, and no deadlock or timeout. Or rename it to what it actually checks ("creates in different cycles do not block each other"). For the second test, add a failing-catalog case with `log` equal to `[]`, or drop "and a catalog" from its name.
  - Reviewer A also ruled: F1 deviation meaningful; assumption 1 (catalog reads) conforms to FR-6, so amend § 7.2; the § 7.3 carry is not broken; assumption 3 (absent list = two rounds) is a spec gap.
- **Reviewer B (risk / readability): PASS.** FR-16 401/403 on both routes; `kind` → 400 `UNKNOWN_FIELD` (top level and in a step); errors only through `TimelineValidationError` (DD-7) with catalog messages; NFR-7 one line per write; OpenAPI matches § 6. Ruled assumption 1 conformant with FR-6 and recommended the § 7.2 amendment.
- **Lens adjudication:** A's FAIL is in scope (false evidence for a named conformance check). It consumed attempt 1.
- **spawns:** implementer 55 calls, 323,942 tokens, ended complete · reviewer A 13 calls, 123,739 tokens, ended complete · reviewer B 19 calls, 128,737 tokens, ended complete.

**Attempt 2 — PASS**
- **Files changed:** `server/src/admin-config/timelines/{timeline-rules,timeline-rules.spec,timelines.service,timelines.service.spec,timelines.unit-of-work.spec}.ts`, `timelines/dto/create-timeline.dto.ts`, `server/test/support/in-memory-admin-config.ts`, `server/test/admin-config-timelines.e2e-spec.ts`.
- **runtime events:** none.
- **What changed:**
  - The race tests are now real. `CyclesService.activate` and `TimelinesService.create` run over one fake DB with shared row locks, in a staggered sweep (16 interleavings per scenario, both orders). The `history` log asserts that each transaction's writes stay together, aggregate tests prove both orders and both outcomes are reached, and a 2 s deadline catches hangs.
  - The misnamed test was renamed "creates in different cycles do not block each other". The unit-of-work test was split, with catalog-down `it.each` cases (503, empty `log`).
  - `programIds` / `resultTypeKeys` are optional at the pipe, and an absent list is reported as `REQUIRED` by the rules (8 rule rows plus an FR-11 omitted-key row). The e2e FR-11 request is sent with `programIds` omitted.
- **Falsifiers:**
  - NEW, the create's cycle `FOR UPDATE` removed: `pnpm test --reporter=dot --maxWorkers=2 src/admin-config/timelines/timelines.service.spec.ts` → 14 failed | 62 passed. The real catch is a timeline written into a closed cycle: "create in the active cycle that the activation closes, activate first and 3 statements ahead": `AssertionError: expected [ 'close:1', 'activate:2', …(4) ] to deeply equal [ 'timeline:official:1', …(5) ]`.
  - F1 re-run: 3 failed. F2 re-run: 9 failed (the unit-of-work spec alone failed 3, including both catalog-down cases).
- **Red-run gaps (recorded per the Reviewer):** the new absent-list rule rows were first red only as `TypeError: Cannot read properties of undefined (reading 'length')` at `timeline-rules.ts:153`, not on an assertion. The service absent-list tests were green immediately (`new Set(undefined)` is empty). The race tests were written against already-correct code, and their evidence is the new falsifier. The e2e omitted-key test was never run red; it would have failed on the attempt-1 DTO (pipe 400 on `programIds` only).
- **Not Done / Assumptions (Implementer, verbatim):**
  - The e2e run above is the only thing not done. If the new e2e expectations are wrong, they will show up there. The most likely suspect is the changed field list in the "shape problem" test.
  - A `null` list is treated like an absent one, because `@IsOptional()` lets null through to the rules.
  - T-5 (cycles) tests pass in the full unit run. I did not change cycles behaviour.
  - Docs: design 6's `TimelineCreate` row does not mark the two lists optional. That is the Leader's docs to update.
  - I used about 58 tool calls, under the 60-call bound. Nothing was committed, staged or stashed.
  → **Owed item discharged:** the e2e was blocked for the Implementer by the local resource guard (RAM below 4500 MB) and was not bypassed. The Leader's non-author re-run then ran it green (below). The design § 6 row was updated by the Leader (see the decisions above).
- **Implementer verification:** lint 0 · build OK · unit 49 / 1636 · tsc 7 baseline · prettier clean · e2e not run (resource guard).
- **Evidence re-run (Leader inline, non-author, after all edits):** VERIFIED. Lint OK · build OK · unit 49 files / 1636 passed · tsc 7 errors, all in `token-verifier.service.spec.ts` · **e2e 13 files / 648 passed** (the first run of the new e2e expectations).
- **Reviewer verdict (single reviewer, all lenses):** PASS. The attempt-1 FAIL is fixed: the race tests share the cycle lock, both orders and outcomes are reached, the old test is renamed, and the unit-of-work test is split. All five named conformance checks hold (§ 7.2 steps 1 and 2, the § 6 row, the § 7.3 carry, and FR-11 with `programIds` omitted). The race evidence is adequate through the new falsifier.
  - Review mode deviation: a single all-lens Reviewer instead of parallel lenses for the rework. Lens B had already passed the unchanged parts in attempt 1, and the rework touched tests, the DTO and the rules only.
- **spawns:** implementer 60 calls, 213,994 tokens, ended partial (the report carried the e2e as owed; discharged by the Leader re-run, so no continuation was spawned) · reviewer — not reported by host, ended complete.

**ADVISORY (attempt-2 Reviewer, 4R — not gating)**
- RELIABILITY: the red-run quality gaps listed above.
- RISK: `null` lists are accepted and treated as missing, which is an unstated rule. Document it in design § 6 or refuse `null` at the pipe.
- READABILITY (carried from attempt 1): the e2e 403 matrix assertion `expect(w.catalogs).toEqual(catalogCalls)` compares switches, not call counts, so it checks nothing. The private `logged()` copy and the OpenAPI optional dates remain.
- RESILIENCE: "creates in different cycles do not block each other" relies on `history.slice(0,2)`, which depends on the fake's microtask timing.
- From attempt 1: the unreachable `Error('An additional timeline was refused as official')` deserves a comment or a named class; the post-commit read failure path is tested only by seeding; the official-first 1062 order with a duplicate name is untested; the front must always send both lists (now relaxed by the absent-list change).

**Requirements covered:** FR-4 (route), FR-5 (first, later, two at once on the fake with any number of instances, closed or unknown cycle, kind sent), FR-6 (catalog unreachable only when needed; duplicate name, another cycle allowed; missing list), FR-11 (several problems end to end with `programIds` omitted; catalog codes only), FR-16, FR-17 (replayed timeline create, no second, no official → additional), NFR-1, NFR-2, NFR-3 (fake part), NFR-7 (timeline create).

**Decisions made:** see "T-6 … in progress" above (lens adjudication; the § 7.2 step 1 and step 2 amendments; the § 6 row consistency edit). Also: duplicate ids and keys are deduplicated before insert; `assignedCount` = `{ ASSESSOR, LEAD_ASSESSOR, TPB, PPU }`, all 0 until T-8; decision-log `targetId` is null on a refusal.

**Forward pointers**
- **→ T-7:** carry the § 7.2 step 1, § 7.2 step 2 and § 6 edits into the T-7 Reviewer brief (second and last carry). `assignedCount` and readiness must be filled from assignments in T-7 / T-8.
- **→ T-9:** `front-contract.md` must say the lists may be omitted or empty (both `REQUIRED` when "all" is false) and that `null` is treated as absent.
- **→ T-10:** the create-vs-activate interplay on real MySQL is covered by the existing concurrency checks; no addition needed.

**Final verification:** VERIFIED (see the attempt-2 evidence re-run above).
