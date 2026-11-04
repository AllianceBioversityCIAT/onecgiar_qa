# Step-1 loads — Execution Log

## Document Control

| | |
|---|---|
| Spec path | `docs/specs/ingestion/step-1-loads` |
| Branch | `feat/step-1-loads` |
| Approval Mode | gated (proposal § 1) |
| Leader | Claude Code, `claude-opus-5-5` (T1) |
| Implementer / Reviewer | `akili-implementer` (`sonnet`, T2) / `akili-reviewer` (`opus`, T3) — Step 8E wrappers |
| Started | 2026-11-04 |
| Persona drift at start | `akili doctor --agents` (v2.37.2): `leader.md` primary-instructions + test-harness, `reviewer.md` audit-checklist, `tester.md` prove-behavior OUTDATED; `implementer.md` CURRENT. Not fixed on this branch (shared-file discipline) — pending item: run `akili doctor --agents --fix` on `staging` |

## Task Execution History

### T-1: `postJson` helper and the `RESULTS_FEED` port with its Reporting adapter

- **Final status:** PASS
- **Date:** 2026-11-04
- **Implementer attempts:** 1
- **Requirements covered:** FR-8 (error kinds), NFR-1 (key never logged), NFR-4 (10 s timeout part), FR-14 (`release` operation exists)

**Attempt 1**
- Files changed:
  - `server/src/users/catalogs/catalog-http.ts` (+51 / −8: `postJson`, private `requestJson`, `UpstreamStatusError`)
  - new `server/src/ingestion/results-feed.port.ts`, `server/src/ingestion/reporting-results-feed.client.ts`, `server/src/ingestion/reporting-results-feed.client.spec.ts`
  - new `server/src/ingestion/fixtures/{results-list,results-details,intake,release}.json` (extracted by script from `onecgiar_pr@654cbab4d:onecgiar-pr-server/docs/qa-catalog.en.md`)
  - new `server/test/support/fake-results-feed.ts`
- Implementer verification: `cd server && pnpm lint && pnpm build && pnpm test --reporter=dot` → lint clean, build green, `Test Files 64 passed (64)`, `Tests 2530 passed (2530)`.
- Red run (observed in T-1, mutation applied then reverted):
  - Falsifier 1 (401 → `unavailable`): `AssertionError: expected 'unavailable' to be 'unauthorized' // Object.is equality` — `Tests 4 failed | 56 passed (60)`, one per operation.
  - Falsifier 2 (headers in the warn line): `AssertionError: expected [ …(2) ] to deeply equal []` with `+ "upstream_unavailable source=reporting status=401 headers={\"x-api-key\":\"test-key-SHOULD-NOT-LEAK\"}"` — `Tests 1 failed | 59 passed (60)`.
- Consumers (`git grep -ln "catalog-http" -- src test`): `field-config-catalog.ts`, `reporting-qa-catalog.client.ts`, `catalog-http.spec.ts`, `clarisa-science-programs.client.ts`, `reporting-result-types.client.ts` — all green in the full run.
- Evidence re-run (Leader-inline, non-author): **VERIFIED** — lint clean, build green, `Test Files 64 passed (64)`, `Tests 2530 passed (2530)`.
- Reviewer verdict: **PASS** (checklist mode). FR-8 kinds for all four operations including the list GET; `release` exists; 10 s abort proven at 9,999/10,000 ms; `LogSpy` covers every sink and is non-vacuous; existing `getJson` callers unchanged. Fixture provenance checked against the `onecgiar_pr` working-tree contract (key-for-key match; only `catalog_version` 2026.31 vs 2026.33 differs, consistent with v1.29 being earlier); the exact commit could not be read by the Reviewer (no Bash).
- runtime events: none
- spawns: implementer 20 calls, 134,398 tokens, ended complete; reviewer 15 calls, 65,989 tokens, ended complete

**ADVISORY (4R, not gating)**
- RISK: NFR-4 "response size bounded" — `res.json()` reads the whole body with no byte cap. T-1 cites only the timeout part; open gap for a later task (T-8) or the user.
- READABILITY: a 4xx logs `upstream_unavailable … status=401` while the adapter classifies it `unauthorized`/`rejected` (changing it would alter existing callers' log text). `upstream_bad_body source=reporting` does not name the operation.
- RELIABILITY: `FakeResultsFeed.answer` — a scripted function that throws escapes synchronously instead of returning a rejected promise.
- RELIABILITY: `run()` maps any unexpected error to `unavailable`, programming errors included; a comment saying it is intentional would help.
- DOCS: `server/test/AGENTS.md` support list does not mention `support/fake-results-feed.ts` yet (T-11 territory).

**Decisions made**
- Ambiguity resolved by the Leader before spawning: design § 7.7 "same error mapping as `getJson`" read as same abort / redirect / parse / log discipline; the FR-8 kinds are binding for the adapter, list GET included; `getJson` callers unchanged.
- Implementer: `UpstreamStatusError extends UpstreamUnavailableError` carries `httpStatus` (`status` collides with a private member of the base exception); `getJson` and `postJson` share a private `requestJson`.
- Implementer: headers are passed by the caller (P-11 pattern); `x-api-key` is built in the adapter only.
- Implementer: reason fields typed `string` (the contract says new reasons are additive); bad shape / non-JSON → `unavailable` with fixed line `upstream_bad_body source=reporting`.
- **Execute-time spec edit:** `design.md` § 7.7, `postJson` row — amended 2026-11-04 to say headers are passed by the caller (P-11), the helper never logs or echoes them, and non-2xx keeps its status via `UpstreamStatusError`. Reason: the prior text ("key in a header built inside the helper") contradicted P-11 and the shipped `getJson` pattern; Reviewer adjudicated it conformant in substance. Requirement meaning unchanged (NFR-1 still holds). Carried as a named conformance check into the next task's Reviewer brief.
- Skills: as listed in the task (nestjs-expert, api-design-principles, error-handling-patterns); effort medium; no deviation.

**Issues encountered:** none.

**Budget running totals (design § 10):** tasks 1 / 11 · production LOC ≈ 434 (adapter + port + helper; estimate for the adapter line was 200) of ≈ 1,450 · test LOC ≈ 360 + 79 support of ≈ 1,800 · review rounds 1 / 14. Overall budget not exceeded; the adapter line ran ≈ 2× its estimate — watch at T-7/T-8.

**Final verification:** `cd server && pnpm lint && pnpm build && pnpm test --reporter=dot` → green (64 files, 2,530 tests).

### T-2: Migration `0007`, Drizzle schemas and the audit actions

- **Final status:** PASS
- **Date:** 2026-11-04
- **Implementer attempts:** 1
- **Requirements covered:** FR-2 (one running load per cycle — schema + SQL; MySQL enforcement deferred to T-12), FR-4 (race / same timeline after the end — unique indexes in schema + SQL; enforcement T-12), FR-5 (both ids NOT NULL), FR-12 (audit actions), NFR-6 (schema part)

**Attempt 1**
- Files changed:
  - new `server/src/database/drizzle/schema/timeline-loads.ts`, `server/src/database/drizzle/schema/timeline-results.ts`
  - `server/src/database/drizzle/schema/index.ts` (+2 exports), `server/src/database/drizzle/schema/timeline-audit-events.ts` (actions `update`, `load_start`, `load_end`), `server/src/database/drizzle/schema/schema.spec.ts` (+243 / −5)
  - generated `server/drizzle/0007_timeline_loads.sql`, `server/drizzle/meta/0007_snapshot.json`, `server/drizzle/meta/_journal.json` (+1 entry)
- Safety: only offline `drizzle-kit generate`; no connection to `qadb`, no `db:migrate`.
- Implementer verification: `cd server && pnpm lint && pnpm build && pnpm test --reporter=dot` → exit 0, `Test Files 64 passed (64)`, `Tests 2552 passed (2552)`.
- Red run (`:952` changed first, before the schema): `AssertionError: expected [ 'update' ] to deeply equal [ 'update', 'load_start', 'load_end' ]` at `schema.spec.ts:952`.
- Falsifiers (applied, run, reverted):
  - `active_key` with `timeline_id`: `expected 'IF(\`ended_at\` IS NULL, CONCAT(\`timeli…' to be 'IF(\`ended_at\` IS NULL, CONCAT(\`cycle_…'`.
  - Unique `(timeline_id, result_code)` dropped: `expected { …(1) } to deeply equal { …(2) }` (schema test). The 0007 SQL-text test stayed green only because the `.sql` was not regenerated; the Reviewer confirmed the SQL-text test pins `CONSTRAINT uq_timeline_results_timeline_code UNIQUE(...)` independently.
- 0007 statements: 2× CREATE TABLE · 1× `ALTER TABLE timeline_audit_events MODIFY COLUMN action enum('update','load_start','load_end') NOT NULL` · 7× ADD CONSTRAINT FK (`no action`) · 2× CREATE INDEX. No DROP / DELETE / UPDATE / RENAME / CHANGE.
- Consumers: P-14 grep re-run; extra hits are docs/comments only (`admin-config/AGENTS.md:37`, `database/AGENTS.md:14,35`, comments in `field-config-audit-events.ts:45`, `timelines.ts:70`). `timelines.store.ts`, `timelines.unit-of-work.spec.ts:747,795`, `test/support/in-memory-admin-config.ts:101,185` unchanged and green.
- Evidence re-run (Leader-inline, non-author): **VERIFIED** — lint OK, build OK, `Test Files 64 passed (64)`, `Tests 2552 passed (2552)`; column types in 0007 checked against design § 5.1–5.2 (enums for `status`, `kp_group`, `end_reason`; `failure_reason varchar(64)`).
- Reviewer verdict: **PASS** (full). Additive migration; generated keys STORED + unique per the `0003` pattern; types match design; FR-5 ids NOT NULL; snapshot chain `0007.prevId = 0006.id`; Disqualifier met (separate SQL-text tests). Rulings: `processed NOT NULL DEFAULT 0` accepted; `started_at`/`heartbeat_at` NOT NULL without default accepted (app clock, DD-6); no `rollback/0007` confirmed (guide requires down scripts only for non-additive); `schema.spec.ts:304` 7→8 and the 0006 journal check `.at(-1)` → `entries[6]` accepted.
- runtime events: none
- spawns: implementer 23 calls, 127,092 tokens, ended partial (Not Done / Assumptions: assumptions-only); reviewer 17 calls, 51,833 tokens, ended complete

**Not Done / Assumptions (Implementer, verbatim)**
> `server/src/database/AGENTS.md` is out of this task's fence and now lags in three places: the migration list stops at 0006; the `0003` note says the load tables are not created; `timeline_audit_events` is described as having the single action `update`. Update it in the merge or archive step.

Leader adjudication: no owed item of T-2 and no blocker (assumptions-only) → no continuation; carried to the Constitution Impact block below.

**ADVISORY (4R, not gating)**
- RISK: no test checks that the committed `0007` SQL still matches the Drizzle schema (Falsifier 2 showed drift stays green). A CI `drizzle-kit generate`/`check` step would close it — outside this spec; recorded only.
- RISK: the audit enum MODIFY may rebuild `timeline_audit_events` on `qadb` (values are appended, so MySQL may skip it). Apply in a quiet window at T-12.
- RELIABILITY: `failure_reason` is free `varchar(64)`; the T-5/T-8 store should type writes as `TimelineLoadFailureReason`.
- READABILITY: `server/src/database/AGENTS.md:14` stale (see Constitution Impact). Not in T-11's scope — not added to it (advisories never widen a task); for the user / archive.
- READABILITY: premise P-14 was slightly wrong — the `0006` journal check (`.at(-1)`) *was* affected by `0007` and had to change.

**Decisions made**
- Implementer: `timeline_loads.processed` NOT NULL DEFAULT 0; `started_at`, `heartbeat_at` NOT NULL with no default; `failure_reason` closed list exported as a TS constant; no `drizzle/rollback/0007` (additive).
- Skills: as listed (nestjs-expert, nestjs-best-practices). Effort: **high** instead of the default medium — shared-DB migration with generated columns.

**Issues encountered:** P-14 understated the consumers (the 0006 journal check); fixed in `schema.spec.ts`.

**Budget running totals:** tasks 2 / 11 · production LOC ≈ 434 + 261 (schema 205 + SQL 56) + 9 ≈ 704 of ≈ 1,450 (migration & schema line estimated 160; ran ≈ 270) · test LOC ≈ 439 + 238 ≈ 677 of ≈ 1,800 · review rounds 2 / 14. Not exceeded.

**Final verification:** `cd server && pnpm lint && pnpm build && pnpm test --reporter=dot` → green (64 files, 2,552 tests).

## Constitution Impact: T-2
- Module reshaped: `server/src/database/drizzle` (two new tables, `timeline_audit_events.action` enum extended).
- Child guide stale: `server/src/database/AGENTS.md` — migration list stops at `0006`; `0003` note says `timeline_loads`/`timeline_results` are not created; audit action described as `update` only. Not named in any T-n scope → for `/akili-archive` (or the user to add it to a task).
- Parent `## Module Guides` index: no new entry needed (database guide already indexed).
- CodeGraph: not initialized — no re-index pending.
