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

