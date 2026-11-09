# Timeline sync at any step — Execution Log

## 1. Document Control

| | |
|---|---|
| Spec path | `docs/specs/ingestion/timeline-sync` |
| Approval mode | gated |
| Branch | `feat/ingestion-timeline-sync` (from `staging-center` @ `01a5404`) |
| Leader | Claude Code, `claude-opus-5-5` (T1) |
| Implementer / Reviewer | `.claude/agents/akili-implementer.md` (T2) / `.claude/agents/akili-reviewer.md` (T3) |
| Started | 2026-11-06 |
| Budget (design § 10) | 8 tasks + 1 HITL · ≈ 1,000 production LOC · ≈ 12 review rounds |

### Pre-run decisions (2026-11-06, back lead)

- **E2E without a database (spec amendment).** `tasks.md` T-1 said the e2e suites build a database from the migrations, and the disqualifiers of T-4 and T-7 required cases "on MySQL". The e2e suites run on in-memory stores and apply no migration (`server/vitest.config.e2e.ts`: "no real database is needed"; `server/test/AGENTS.md`), and no local MySQL or Docker exists (infrastructure § 6). Back lead chose "defer to HITL": T-1 is proved by the SQL text pinned in `schema.spec.ts` and the down script; T-4/T-7 run on the in-memory stores; `pnpm db:migrate` of `0008` on `qadb` (human step) is added to T-9. Edited: `tasks.md` T-1 Verification, T-4 Disqualifier and Done when, T-7 Disqualifier, T-9 Scope and Done when; `requirements.md` § verification row "A unique key that does not match the rule". No requirement's meaning changed.
- **Persona drift.** `akili doctor --agents` (v2.37.2): leader `primary-instructions` (2.32.0), `test-harness` (2.30.0); reviewer `audit-checklist` (2.30.0); tester `prove-behavior` (2.30.0) outdated. Implementer current. Back lead chose to run as is; `akili doctor --agents --fix` is a pending item for `staging` (shared-file write discipline).
- **FR-3 edit half (spec amendment at the T-1/T-2 gate, 2026-11-06, back lead).** The edit body has no `round` (`update-timeline.dto.ts:25`, 400 `UNKNOWN_FIELD`), so "400 `ROUND_ABOVE_MAX` on create and edit" could not pass for the edit. Edited: `requirements.md` FR-3 statement; `design.md` § 6 contract row; `tasks.md` T-7 Requirements and Scope. Meaning kept: no request can store a round above 2. Carried as a named conformance check into the next Reviewer brief.
- **T-1 scope widened (back lead, 2026-11-06):** a continuation fixes the positional stub in `loads.unit-of-work.spec.ts` (fixture only) and reorders the `0008` down script (Reviewer advisory adopted by the user, not by the Leader).
- **Kaizen log.** `docs/specs/kaizen-log.md` does not exist; no Active Lessons table to load.
- **CodeGraph.** `.codegraph/` absent.

## 2. Task Execution History

### T-2: Round limit in the timeline edit — PASS

- **Date:** 2026-11-06 · **Attempts:** 1 · **Effort:** medium · **Skills:** nestjs-expert · run in parallel with T-1 (disjoint files)
- **Requirements covered:** FR-3 (Scenario: Round 3; rounds 1 and 2 validated as today); S-3; design § 7.6, DD-9
- **Attempt 1**
  - files changed: `server/src/admin-config/timelines/timeline-rules.ts`, `server/src/admin-config/timelines/timeline-rules.spec.ts`, `server/src/common/error-codes.ts`, `server/src/common/error-codes.spec.ts`
  - red run: `npx vitest run src/admin-config/timelines/timeline-rules.spec.ts` → 5 failed / 204 passed (`× 1,1,2,2,3 goes above the last round (FR-3)`, `× 1,2,3 is a valid sequence, so only the limit is reported (FR-3)`, `× 1,1,3 skips a round`, and 2 existing cases updated for the new issue; `AssertionError: expected [] to deeply equal [ { field: 'steps[4].round', …(1) } ]`)
  - falsifier (`step.round > 3`): 5 failed incl. `× 1,1,2,2,3 goes above the last round (FR-3)`; restored
  - Implementer verification: unit 2 files / 359 passed; lint clean; build ok; e2e 16 files / 956 passed
  - evidence re-run (Leader inline): **VERIFIED** — unit 2 files / 359 passed; after T-1 ended: lint clean, `pnpm build` exit 0, e2e 16 files / 956 passed (whole unit: 1 failure, T-1's consumer test, not T-2's)
  - Reviewer: **PASS** (checklist) — "`ROUND_ABOVE_MAX` sits right next to `ROUND_SEQUENCE` … as design § 7.6 says"; sequence verdicts unchanged; three FR-3 cases call the real `validateTimelineCreate`
  - runtime events: none
- **Not Done / Assumptions (verbatim, Implementer; no owed item, no blocker):**
  - "Existing expectations changed. Five existing expectations contained a round above 2, so they now also carry `ROUND_ABOVE_MAX`… The old valid case `1,2,3,3,3` expecting `[]` now expects the limit on steps 2 to 4. I replaced it with the `1,2,3` case that FR-3 describes."
  - "Create only. FR-3 says 'creating or editing', but `TimelineStepUpdate` in `timeline-rules.ts` has no `round` field, and an edit cannot change rounds." (Leader checked: `update-timeline.dto.ts:25` rejects `round` as an unknown field.)
  - "`MAX_ROUND` has no consumer yet." (T-3 imports it.)
- **ADVISORY (Reviewer, 4R):**
  - RISK: T-7 asks for an e2e "400 `ROUND_ABOVE_MAX` on create and edit" and design § 6 lists "Timeline create / edit"; an edit sending `round` gets the pipe's `UNKNOWN_FIELD` 400, so T-7's edit half cannot pass as written. A timeline stored with round 3 before this change is not caught on edit (P-7: max stored round on qatest is 2).
  - READABILITY: the new row `'1,1,2,2,2 stays within the limit (FR-3)'` repeats the input of the existing `'1,1,2,2,2'` row.
- **Forward pointer → T-7:** the edit half of "400 `ROUND_ABOVE_MAX` on create and edit" is a spec tension (round is immutable on edit); amendment proposed to the back lead at the T-1/T-2 gate.
- **spawns:** implementer 15 calls, 90,373 tokens, ended partial; reviewer 11 calls, 37,976 tokens, ended complete
- **Running totals vs budget:** tasks 1/8 · production LOC ≈ 11 / ≈ 1,000 · review rounds 1 / ≈ 12
- **Final verification:** green (lint, build, unit for T-2's suites, e2e)

### T-1: Migration `0008` and the schema of rounds — PASS

- **Date:** 2026-11-06 · **Attempts:** 1 (+ 1 continuation) · **Effort:** high (continuation medium) · **Skills:** nestjs-expert · run in parallel with T-2
- **Requirements covered:** FR-2, FR-5 (Two rounds; Duplicate insert), FR-6 (`returned`), FR-8 (columns), FR-10 (defaults), NFR-1, NFR-3, NFR-5; design § 5.1, § 5.2, DD-2, DD-5
- **P-9 (settled):** applicable `fields[]` per type in `server/src/admin-config/field-config/fixtures/reporting-qa-catalog-2026.json` (catalog 2026.30): policy_change 50, innovation_use 70, other_outcome 43, capacity_sharing 51, knowledge_product 69, innovation_development 70, other_output 43, impact_contribution 43, innovation_package 65. Max **70** → CHECK `changed_fields IS NULL OR JSON_LENGTH(changed_fields) <= 96`. Design § 11 P-9 row updated to verified (execute-time edit, no change of meaning).
- **Attempt 1**
  - files changed: `server/src/database/drizzle/schema/timeline-results.ts`, `server/src/database/drizzle/schema/timeline-loads.ts`, `server/src/database/drizzle/schema/schema.spec.ts`, `server/drizzle/0008_timeline_sync_rounds.sql` (new), `server/drizzle/meta/0008_snapshot.json` (new), `server/drizzle/meta/_journal.json`, `server/drizzle/rollback/0008_timeline_sync_rounds.down.sql` (new)
  - drizzle-kit ordering: **edited** — drizzle-kit emitted `DROP INDEX uq_timeline_results_timeline_code` first; moved to directly after the ADD of `uq_timeline_results_timeline_code_round` (only edit). A second `db:generate` reports no changes. New columns placed last in the schema definitions (matches `ALTER … ADD`).
  - red run: `schema.spec.ts` 20 failed / 185 (column shapes, CHECK names, unique-key map, the 0008 journal entry, 6 SQL pins, 4 down-script tests); expected SQL written from design § 5.1/§ 5.2 before `db:generate`
  - falsifiers: old key kept → 2 red (`expected { …(3) } to deeply equal { …(2) }`, `+ "uq_timeline_results_timeline_code"`; DROP count `expected [] to have a length of 1`); `entry_round` default 0 → 2 red on the **default pins** (`expected +0 to be 1`), not on the CHECK pin as `tasks.md` predicted — the CHECK pin compares constraint text, which a default does not change; Reviewer judged it equivalent coverage. Restored, 185/185.
  - Implementer verification: schema.spec 185/185; lint clean; build 0; e2e 16/956; whole unit 1 failed (`loads.unit-of-work.spec.ts:1397`, positional stub, P-11 consumer)
  - evidence re-run (Leader inline): **VERIFIED** — same outputs, incl. the one unit failure
  - Reviewers (parallel lenses, migration surface): risk+reliability **PASS**; conformance+pin quality **PASS**
- **Continuation 1** (scope widened by the back lead at the gate): the `loadValues` fixture in `loads.unit-of-work.spec.ts` appends `1, 1`; the down script's `MODIFY end_reason` moved to statement 2 (both refusals before any drop), second pre-check `SELECT COUNT(*) FROM timeline_results WHERE end_reason = 'returned';` and the `__drizzle_migrations` note in the header; pins updated.
  - red (pins first): 4 failed / 290 passed; falsifier (MODIFY back to old place): 2 failed / 184; restored byte for byte
  - Implementer verification: whole unit 71 files / 2854 passed; lint, build clean; e2e 16/956
  - evidence re-run (Leader inline): **VERIFIED** — lint clean, build 0, whole unit 71 passed | 1 skipped / 2854 passed, e2e 16 / 956
  - Reviewer (whole final diff): **PASS** — down order accepted by MySQL 8 statement by statement; pins catch any reorder; named check FR-3/§ 6 amendment: no conflict
- continuations: 1 (fixture stub; down-script order — user-approved scope widening, not an advisory turned task by the Leader)
- runtime events: none
- **Not Done / Assumptions (verbatim, Implementer):** "No database was connected and `db:migrate` was not run. The down script's statement order is verified only by the text pins, not against MySQL." → T-9 (human `pnpm db:migrate`).
- **ADVISORY (Reviewers, 4R, recorded only):**
  - RISK: the down script, run as `mysql < file`, would choke on the `;--> statement-breakpoint` suffix (not a MySQL comment) — run statements one at a time; same convention as `0006`.
  - RELIABILITY: down not re-entrant — after a refusal at statement 2, a re-run fails at statement 1 (duplicate key name). `0008` up is 13 DDL statements and not re-runnable after a partial failure (check `SHOW CREATE TABLE`) — note for the T-9 runbook.
  - RISK: the `returned` refusal depends on strict `sql_mode`; a `SELECT @@sql_mode` pre-check would make it harder to miss.
  - RISK: `timeline_results` rebuilt ~4× (ALGORITHM=COPY for CHECK/FK) — fine at qatest size; PROD has no timelines (P-7).
  - RELIABILITY: no DB CHECK for "`changed_fields` NULL ⇔ `previous_membership_id` NULL" (§ 5.1 states the rule; enforced in code). Design decision for the back lead.
  - RISK: if a catalog type grows past 96 keys, inserts for that type fail the CHECK.
  - RESILIENCE: `are exactly nine SQL files` pin breaks with every future migration (existing pattern).
  - READABILITY: a `not.toContain('uq_timeline_results_timeline_code')` after the exact `toEqual` map cannot fail on its own; `server/src/database/AGENTS.md` Files row stops at `0006` (T-8 adds `0008`).
- **spawns:** implementer 35 calls, 138,482 tokens, ended partial; reviewer (risk lens) 15 calls, 56,199 tokens, ended complete; reviewer (pins lens) 14 calls, 55,522 tokens, ended complete; implementer (continuation) 8 calls, 78,352 tokens, ended complete; reviewer (final) 11 calls, 55,573 tokens, ended complete
- **Running totals vs budget:** tasks 2/8 · production LOC ≈ 75 (schema 58 + migration 12 + T-2 11; down script 42 not counted) / ≈ 1,000 · review rounds 5 / ≈ 12 (T-2 1, T-1 4: 2 parallel lenses + continuation re-review, counted as rounds) — **within budget**, but review rounds run ahead of plan (5 used on 2 of 8 tasks).
- **Final verification:** green — lint, build, whole unit (2854), e2e (956)

### T-5: Snapshot read by key — PASS

- **Date:** 2026-11-06 · **Attempts:** 1 · **Effort:** medium · **Skills:** aws-serverless, nestjs-expert · run in parallel with T-3
- **Requirements covered:** FR-8 (the read only; the "read only when the hash differs" rule is T-6's), NFR-2 (one GetItem); design § 5.4
- **Attempt 1**
  - files changed: `server/src/ingestion/snapshot-store.port.ts`, `server/src/ingestion/dynamo-snapshot-store.ts`, `server/src/ingestion/dynamo-snapshot-store.spec.ts`, `server/src/ingestion/dynamo-snapshot-store.dynamo-local.spec.ts`, `server/test/support/fake-snapshot-store.ts`
  - port implementers (`git grep -l "SnapshotStore"`): `dynamo-snapshot-store.ts`, `test/support/fake-snapshot-store.ts` — both updated; consumers unchanged
  - red run: 5 failed (`× get returns the record at the exact (resultCode, sk) key` ×2, `× get returns null for a near-miss key` ×2, `× round-trips a 300 KB value through gzip …`; `TypeError: store.get is not a function`)
  - falsifier (no inflate of `valuesGz`): `AssertionError: expected null to deeply equal { Object (blob) }`, 1 failed / 12; restored
  - Implementer verification: spec 13 passed; lint, build clean; whole unit green
  - **DynamoDB Local suite: not run** — DynamoDB Local was not running and `DYNAMODB_ENDPOINT` was empty. The new local case is written and unexecuted; this is not a pass. To run: `DYNAMODB_ENDPOINT=<local> npx vitest run src/ingestion/dynamo-snapshot-store.dynamo-local.spec.ts`.
  - evidence re-run (Leader inline): **VERIFIED** — spec 13 passed; after T-3 ended: lint clean, build 0, whole unit 71 passed | 1 skipped / 2952 passed, e2e 16 / 956
  - Reviewer: **PASS** (checklist) — one ElectroDB `get` with the entity's key composites; inflate as `history`; fake answers only the exact key; near-miss misses defeat the disqualifier; named check FR-3/§ 6 amendment: no conflict (last carry)
  - runtime events: none
- **Not Done / Assumptions (verbatim):** "DynamoDB Local was not running … so the new local case is written but unexecuted." · "`get` repeats `history`'s record-mapping block instead of sharing a helper, because the task said `history` is not touched." · "`sk` is the `snapKey` string produced by `snapshotSortSuffix`, as in design § 5.4."
- **ADVISORY (Reviewer, 4R):** READABILITY — extract a shared `toRecord(r)` later (touches `history`); add the `@akili-spec ingestion/timeline-sync` tag to `dynamo-snapshot-store.ts`. RELIABILITY — a stored missing `values` parses to `null` behind a non-null type (same as `history`).
- **Forward pointer → T-6:** treat a `null` `values` from `SnapshotStore.get` defensively when computing `changedFields` (Reviewer advisory, recorded for the T-6 brief).
- **spawns:** implementer 14 calls, 92,989 tokens, ended partial; reviewer 12 calls, 40,610 tokens, ended complete
- **Running totals vs budget:** tasks 3/8 · production LOC ≈ 104 / ≈ 1,000 · review rounds 6 / ≈ 12
- **Final verification:** green (lint, build, unit, e2e); DynamoDB Local case unexecuted

### T-3: Pure rules of a sync — PASS (attempt 2)

- **Attempt 1** (2026-11-06, effort high, skills nestjs-expert + tdd, parallel with T-5)
  - files changed: `server/src/ingestion/load-rules.ts`, `load-rules.spec.ts`, `load-runner.ts`, `loads.service.ts`, `loads.unit-of-work.ts`, `loads.store.ts`, `loads.unit-of-work.spec.ts`, `server/test/support/in-memory-loads.ts`
  - red: 83 failed / 47 (130) against fixed-value stubs; falsifiers: `<` → 10 red, `>=` → 6 red, S-6 ignored → 3 red, `JSON.stringify` → 1 red; restored
  - Implementer verification: `load-rules.spec.ts` 130 passed; whole unit 2952 passed; e2e 16/956; lint, build 0
  - evidence re-run (Leader inline): **VERIFIED** (same outputs)
  - Reviewer: **FAIL** (full report, verbatim):

    > ISSUES:
    > 1. **Discovered Issue:** The `stepInForce` / `entryRound` boundary table is incomplete for the admin shape `1,1,1,2,2` (`adminRows`, `load-rules.spec.ts` ~L99–115). It is missing one minute before step 2 opens (`2026-11-09T08:59`), the closing minutes of steps 1, 2 and 4 (`11-06T17:00`, `11-13T17:00`, `11-27T17:00`), and the gap minute after the last close (`12-04T00:00`). The default and one-step shapes are complete.
    >    * **Violated Rule:** T-3's tests block in `docs/specs/ingestion/timeline-sync/tasks.md`: "`entryRound`/`stepInForce` table over 3 shapes … rows one minute before each opening, the opening minute, the closing minute, the gap minute after each close". Its "Done when: every listed row passes" condition is not met. The defect gate in `requirements.md` § 7 ("Wrong round at a boundary minute → `load-rules.spec.ts` boundary table") names this table.
    >    * **Remediation Suggestion:** Add the 5 missing rows to `adminRows` with literal expected values: `11-09T08:59 → 1,1`; `11-06T17:00 → 1,1`; `11-13T17:00 → 2,1`; `11-27T17:00 → 4,2`; `12-04T00:00 → 5,2`. Do not compute them with the function under test. Optionally give all three shapes the same row set so the table is uniform.

  - Reviewer focus answers: `previous` matches design § 7.3 step 2 verbatim; `mergeSummary` left-keep matches § 5.3; round > 1 for "returned here" matches FR-4 order; caller edits within "enough to compile".
  - ADVISORY: RISK — stage only T-3 files at commit. RELIABILITY — `lot.round = stored.round` inherits the start's initial summary round: T-4 must write the load's round into the initial summary (or T-6 take it from `load.round`). READABILITY — `returned` round-1 row with `endedAt === null` fails closed to `ALREADY_IN_THIS_TIMELINE`, untested, uncommented. RELIABILITY — `stepInForce` assumes `opensAt` rises with position (guaranteed by timeline validation; uncommented).
  - spawns: implementer 51 calls, 198,912 tokens, ended partial; reviewer — not reported by host
- **Forward pointer → T-4:** write the load's round into the initial stored summary (`lot.round = stored.round` in `loads.unit-of-work.ts`). Fix the spec-file type errors in `load-runner.spec.ts`, `loads.service.spec.ts`, `loads.unit-of-work.spec.ts` fixtures that lack the T-1 columns (`tsc -p tsconfig.json`; T-4/T-6 own them).
- **Attempt 2** — effort xhigh (bumped from high)
  - files changed: `server/src/ingestion/load-rules.spec.ts` only (`load-rules.ts` byte-identical to attempt 1)
  - rows added: admin shape `1,1,1,2,2` 15 → 20 (`11-09T08:59 → 1,1`, `11-06T17:00 → 1,1`, `11-13T17:00 → 2,1`, `11-27T17:00 → 4,2`, `12-04T00:00 → 5,2`, derived by hand from the fixture dates and FR-2); default (20) and one-step (4) audited complete; +1 guard test `reads every shape at the same boundary minutes` (time columns only)
  - falsifier (`<` for `<=` in `stepInForce`): 10 failed / 126, incl. `timeline admin 1,1,1,2,2 > now 2026-11-09T09:00 -> step 2, round 1` (`expected 1 to be 2`); restored byte-identical
  - Implementer verification: spec 136 passed; whole unit 2958 passed | 4 skipped; lint, build 0; e2e 16/956
  - evidence re-run (Leader inline): **VERIFIED** — same outputs
  - Reviewer: **PASS** — "The attempt 1 FAIL is fixed and nothing regressed"; every expected value a literal; guard test additive, no scope widening
  - ADVISORY: RELIABILITY — comment that close/gap rows behave as mid-step rows by design (`RoundStep` has no `closesAt`). RISK — `loads.service.ts:358` and `loads.unit-of-work.ts:311` still pass step 1's `closesAt` to `syncWindow` (marked for T-4).
  - spawns: implementer 22 calls, 110,456 tokens, ended complete; reviewer 5 calls, 54,579 tokens, ended complete (attempt-1 reviewer: 12 calls, 74,696 tokens)
  - runtime events: none
- **Requirements covered:** FR-1, FR-2, FR-4, FR-8, FR-9, NFR-4 (as rules); design § 5.3, § 7.4, DD-1, DD-3, DD-6, DD-8
- **Not Done / Assumptions (attempt 1, verbatim, abridged):** "`tsc -p tsconfig.json` (with specs) reports type errors in `load-runner.spec.ts`, `loads.service.spec.ts` and `loads.unit-of-work.spec.ts` … fixture rows lacking the T-1 columns … T-4/T-6 fixtures own them." · "`returnedNotResubmitted` … keeps the left side's value (associative, like `round`)." · "a skip is `{reason, timelineId?}` and a take is `{kind, previous}`." · "an unparseable string counts as not re-submitted." · "`server/src/ingestion/AGENTS.md` still names `loadWindow` … the FR-13 documents task."
- **Forward pointer → T-4 (add):** switch `syncWindow` callers to the last step's close (`loads.service.ts:358`, `loads.unit-of-work.ts:311`); the T-4 Reviewer checks it.
- **Running totals vs budget:** tasks 4/8 · production LOC ≈ 333 / ≈ 1,000 · review rounds 8 / ≈ 12 — within budget on tasks and LOC; review rounds at 67 % of budget with 50 % of tasks done (projected ≈ 15–16, above ≈ 12; reported at the gate).
- **Final verification:** green — lint, build, whole unit (2958), e2e (956)


### T-4: Store and unit of work — PASS (attempt 1, 1 continuation)

- **Attempt 1** (2026-11-09, effort high, skill nestjs-expert)
  - files changed: `server/src/ingestion/loads.store.ts`, `loads.unit-of-work.ts`, `loads.unit-of-work.spec.ts`, `server/test/support/in-memory-loads.ts`; continuation (test-only): `loads.service.spec.ts`, `server/test/ingestion-loads.e2e-spec.ts`, `server/test/ingestion-loads-privacy.e2e-spec.ts`
  - red run against T-3's production files (checked out, then restored, MD5 equal): 15 failed / 5 passed of the new and rewritten window and round cases, e.g. `the closing minute of the last step is still open: 17:30 Rome starts` → `expected 'window_closed' to be 'started'`; new store methods greenfield
  - falsifiers (post-change, restored byte-identical): round key → `ACTIVE_IN_OTHER_TIMELINE` 2 red; store constant set to the old name 1 red; drop `entry_round = 1` in `endAsReturned` → Drizzle SQL pin 1 red, in-memory 2 red; steps read before `findTimelineForUpdate` 5 red (incl. existing `a keyed start`, `a stale running load is ended`, `an edit that read version 4`); window on step 1 instead of last step 11 red; summary without the round 5 red; `entryRound: 1` in `recordLot` 3 red; drop resubmitted count 2 red
  - Implementer verification (before continuation): spec 158 passed; whole unit 3 failed | 3005 passed | 4 skipped; e2e 3 failed / 956 — the six step-1 window pins in `loads.service.spec.ts` (3) and the two e2e files (3), outside the brief's files
  - **Not Done / Assumptions (verbatim, abridged):** "1. The Done-when condition 'V-e2e green' is not met. FR-12 names these six tests … Decision for you: either T-7 absorbs these six rewrites, or you widen my scope." · "2. `load_end` audit fields are not done … design 5.5" → Leader: owned by T-6 (FR-11 `load_end`), not owed. · "3. `LotMembership.kind/previousMembershipId/changedFields` optional (defaults `new`, null, null) … until T-6 sets `kind`." · "4. Unique-key order assumption: InnoDB walks indexes in creation order, so a same-timeline same-round active re-insert is reported as `active_key` … the unit of work reads the cycle's memberships … T-9 should confirm." · "5. `endAsReturned` reason priority: a round-2 row answers `not_round_1`, ended or not." · "6. The Drizzle store is not run against MySQL (T-9)." · "7. Spec edits beyond new cases: step-1 window pins rewritten; `violations.timelineCode` → `timelineCodeRound`; stub `step1Closes` → `steps`."
  - continuations: 1 (rewrite the six step-1 window pins, test-only, to the last step's close)
  - continuation verification: whole unit 3008 passed | 4 skipped (3012); e2e 956/956; lint, build clean; `tsc` over specs: only the T-1-column fixture errors owned by T-6/T-7 (`load-runner.spec.ts:132,:162`, `loads.service.spec.ts:168,:191`, `ingestion-loads.e2e-spec.ts:218,:578`)
  - evidence re-run (Leader inline, both rounds): **VERIFIED** — same counts (spec 158; unit 3 failed → 3008 passed; e2e 3 failed → 956; lint, build OK)
  - Reviewer (parallel lens mode, 2 reviewers): **concurrency & lock order — PASS**; **data — PASS**. Start order cycle `FOR SHARE` → timeline `FOR UPDATE` → `findSteps` pinned; refusals write nothing; key name pinned literally (Disqualifier met); unlisted returned result in the count fixtures (Disqualifier met); pre-`0008` defaults pinned on both stores; T-3 forward pointer (round in the initial summary) met; P-10 file untouched; no `findStepOne`; the 2026-11-09 amendment matched exactly (3 + 2 + 1); FR-3 amendment not contradicted.
  - ADVISORY (concurrency): RESILIENCE — `recordLot` maps an `active_key` duplicate to `ALREADY_IN_THIS_TIMELINE` after reading memberships, beyond design § 7.3 step 6 (see spec tension below). RISK — the comment/docstrings claiming MySQL names `active_key` first (creation order) are unproven and probably wrong (MySQL sorts all-NOT-NULL unique keys first); reword to "either key may be named; T-9 pins which". RELIABILITY — the same-timeline test `timelineId === load.timelineId && entryRound === load.round` is narrower than FR-4 rule 2 (misses an active round-1 row here; race-only). READABILITY — two tests model an edit changing rounds, which the FR-3 amendment forbids; move `opensAt` instead. READABILITY — `in-memory-loads.ts` header (~L57–59) still names the old key and order. RESILIENCE — fake `endAsReturned` takes no lock on a non-matching row (unused today). READABILITY — `closeAllStepsOfTimeline13` duplicated in two e2e files.
  - ADVISORY (data): RISK — same § 7.3 step 6 drift and key-order premise. RELIABILITY — same narrow same-timeline check. RELIABILITY — lot round from `stored.round` vs memberships from `load.round` (two sources; null summary → round 1). RELIABILITY — in-memory store does not default a seeded load's missing `round` to 1. RISK — nothing enforces `changed_fields` null iff `previous_membership_id` null (§ 5.1); worth a T-6 test. READABILITY — the round-mutating edit tests (as above).
  - spawns: implementer 73 calls, 296,379 tokens, ended partial; implementer (continuation, resumed) 9 calls, 309,535 tokens cumulative, ended complete; reviewer-concurrency 13 calls, 105,520 tokens, ended complete; reviewer-data 12 calls, 105,459 tokens, ended complete
  - runtime events: none
- **Requirements covered:** FR-1 (start refusals), FR-2 (round/position at start under the lock), FR-5 (duplicate insert → skip), FR-6 (`endAsReturned`), FR-9 (count query), FR-10 (old-row defaults), FR-11 (`load_start`), NFR-1; design § 5.1–5.3, § 7.1, § 7.2, § 7.3 step 7, § 7.5; DD-2, DD-7, DD-10
- **Decisions made:**
  - Execute-time spec edit (2026-11-09, back lead): `tasks.md` T-4 Scope — the six step-1 window pins (`loads.service.spec.ts` ×3, `ingestion-loads.e2e-spec.ts` ×2, `ingestion-loads-privacy.e2e-spec.ts` ×1) rewritten here, test-only, so PR 1 stays green. No requirement's meaning changed. Carried as a named conformance check into the T-6 Reviewer brief.
  - Implementer's Not Done #2 (`load_end` fields) ruled T-6's by its FR-11 line.
- **Spec tension (raised at the T-4 gate):** design § 7.3 step 6 ("a duplicate on `active_key` becomes `ACTIVE_IN_OTHER_TIMELINE`") vs FR-5 "Duplicate insert in the same round" → `ALREADY_IN_THIS_TIMELINE`, since MySQL may name either key. Proposed amendment: § 7.3 step 6 reads "a duplicate on either key is classified by reading the code's memberships: this timeline (active, or entered in this round) → `ALREADY_IN_THIS_TIMELINE`; otherwise `ACTIVE_IN_OTHER_TIMELINE`". Pending the back lead's answer.
- **Forward pointers:**
  - → T-6: set `kind`, `previousMembershipId`, `changedFields` on `LotMembership` (defaults count every take as `loadedNew`); `load_end` gains round and counts (design § 5.5); test `changed_fields` null iff `previous_membership_id` null; consider `round: load.round` for the lot; T-1-column fixture errors in `load-runner.spec.ts`.
  - → T-7: `loads.service.ts:358` preview `syncWindow` still on step 1's close; T-1-column fixture errors in `loads.service.spec.ts:168,:191`, `ingestion-loads.e2e-spec.ts:218,:578`.
  - → T-8: `server/src/ingestion/AGENTS.md` still step-1 window text; § 7.3 step 6 amendment text if approved.
  - → T-9: confirm which unique key MySQL names on a same-timeline same-round active re-insert; `endAsReturned` and `NOT EXISTS` live.
- **Running totals vs budget:** tasks 5/8 · production LOC ≈ 590 / ≈ 1,000 (T-4: store +180/−25, unit of work +77/−19) · review rounds 10 / ≈ 12 — within budget; review rounds at 83 % with 3 review-bearing tasks left (T-6 full, T-7 full, T-8 checklist): projected ≈ 13–14, above ≈ 12 (reported at the gate).
- **Final verification:** green — `loads.unit-of-work.spec.ts` 158, whole unit 3008 | 4 skipped, e2e 956, lint, build
