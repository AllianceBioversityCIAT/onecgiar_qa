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

### T-3: `ResultSnapshot` ElectroDB entity and the `SNAPSHOT_STORE` port

- **Final status:** PASS
- **Date:** 2026-11-04
- **Implementer attempts:** 1
- **Requirements covered:** FR-6 "Retry of a lot" (same key + same hash → one item, success; different hash → `SnapshotConflictError`), FR-6 "History" (one Query per pk, sk order: year, cycle, timeline, load), NFR-7 (gzip above 256 KB)

**Attempt 1**
- Files changed (all new):
  - `server/src/database/dynamodb/entities/result-snapshot.entity.ts` (entity, `snapshotSortSuffix` key builder, `createResultSnapshotEntity`)
  - `server/src/ingestion/snapshot-store.port.ts` (`SNAPSHOT_STORE`, `SnapshotStore`, `ResultSnapshotRecord`, `SnapshotConflictError`)
  - `server/src/ingestion/dynamo-snapshot-store.ts`, `server/src/ingestion/dynamo-snapshot-store.spec.ts`, `server/src/ingestion/dynamo-snapshot-store.dynamo-local.spec.ts` (opt-in)
  - `server/test/support/fake-snapshot-store.ts`, `server/test/support/fake-dynamodb-client.ts`
- Implementer verification: `pnpm lint` clean; `pnpm build` OK; `pnpm test --reporter=dot` → `Test Files 65 passed | 1 skipped (66)`, `Tests 2561 passed | 3 skipped (2564)` (3 skipped = opt-in spec).
- Red run (observed in T-3, mutations applied then reverted):
  - Padding removed (`3 failed | 6 passed`): `AssertionError: expected '2026#1#2#10' to be '2026#000001#00000002#0000000010'`; history order red for both stores: `expected [ [ 2026, 10, 1 ], …(2) ] to deeply equal [ [ 2026, 2, 10 ], …(2) ]`.
  - Condition failure always success (`1 failed | 8 passed`): `put with a different hash for the same key is an error`: `AssertionError: promise resolved "undefined" instead of rejecting`.
- **Opt-in run — against the remote dev table, not DynamoDB Local.** Reason: Docker was off; the user (Juanda) chose on 2026-11-04: "Haz los test contra dynamo remoto, luego eliminamos la data, no problem". Guards: enabled only by `DYNAMODB_ENDPOINT` or `DYNAMODB_IT=remote`; throws before writing unless `DYNAMODB_TABLE_NAME === 'cgiar-qa-test'`; result codes `990000000 + random(0..9999)` (+ a second code 10,000 higher); `afterAll` deletes by exact pk/sk, re-queries both pks and throws if anything remains; no credential printed or written.
  - Implementer run: command shape `set -a; . ./.env; set +a; DYNAMODB_IT=remote pnpm vitest run src/ingestion/dynamo-snapshot-store.dynamo-local.spec.ts` → 3/3 passed; `[dynamo-it] items written: 6; remaining after cleanup: 0` (5 distinct keys, one idempotent repeat).
  - Leader re-run (same command): `Tests 3 passed (3)`; `[dynamo-it] items written: 6; remaining after cleanup: 0`. The dev table holds no test data from this task.
  - A `dynamodb:Scan` attempt got `AccessDenied` (the dev IAM user lacks Scan); not retried with other credentials. Cleanup evidence is the per-pk re-query.
- Evidence re-run (Leader-inline, non-author): **VERIFIED** — lint OK, build OK, `Test Files 65 passed | 1 skipped (66)`, `Tests 2561 passed | 3 skipped (2564)`; remote opt-in as above.
- Reviewer verdict: **PASS** (checklist). Keys `RESULT#{code}` / `SNAP#{year}#{06}#{08}#{010}`; 14 attributes; `values` JSON string, `valuesGz` only above 256 KB; conditional put with hash read-back; history one paged Query, no GSI; port + adapter + fake with contract tests over both stores; disqualifier not triggered (2 vs 10 ids; opt-in actually ran); every guard of the user-approved remote run enforced.
- runtime events: none
- spawns: implementer 17 calls, 107,695 tokens, ended complete; reviewer 15 calls, 54,303 tokens, ended complete

**ADVISORY (4R, not gating)**
- RISK: the opt-in spec reads `process.env.DYNAMODB_SECRET_ACCESS_KEY` directly (`config/AGENTS.md` § Secrets wants one reader); `no-qa-tokens.spec.ts` skips specs. Building the client from `dynamoDbConfig()` would fix it.
- RISK: with `DYNAMODB_ENDPOINT` set the table guard is skipped — an endpoint pointing at real AWS would bypass the `cgiar-qa-test` check. Guard unless the host is localhost/127.0.0.1.
- RELIABILITY: condition is `attribute_not_exists(#resultCode)` vs design § 5.4 `attribute_not_exists(pk)` — equivalent (every item carries `resultCode`), proven on the remote run; the in-memory fake does not check which condition is sent.
- RELIABILITY: `isConditionFailure` also matches `/ConditionalCheckFailed/` on `message`; matching `name`/`cause.name` only would be tighter.
- RELIABILITY: in the opt-in `afterAll`, a failed delete stops the loop before the remaining check; `Promise.allSettled` then report would leave fewer items behind.
- READABILITY: `history` maps a missing `values` to `JSON.parse('null')` typed as a record; throwing on an item with neither `values` nor `valuesGz` would be more honest.
- READABILITY: stale docs — `server/src/database/AGENTS.md:58` ("DynamoDB has no entities yet; put the entity next to the module that owns it") and `server/AGENTS.md:7` ("snapshots, not used yet"). Not in any task's scope — recorded for archive / the user.

**Decisions made**
- User-approved change to the verification route: opt-in against the remote dev table `cgiar-qa-test` instead of DynamoDB Local (above). The opt-in gate gained `DYNAMODB_IT=remote` beside `DYNAMODB_ENDPOINT`.
- Implementer: sk composite is a pre-padded `snapKey` attribute (ElectroDB templates cannot pad numbers), `casing: 'none'`; unit tests run the real adapter + ElectroDB over an in-memory DynamoDB HTTP layer (no new dependency); `SnapshotConflictError` in the port file (no `error-codes.ts` change); key builder throws `RangeError` on over-wide parts. Reviewer accepted all four.
- Skills: as listed (aws-serverless, nestjs-expert); effort medium; no deviation.

**Issues encountered:** Docker off (no DynamoDB Local) — resolved by the user's choice above. Dev IAM user has no `dynamodb:Scan`.

**Budget running totals:** tasks 3 / 11 · production LOC ≈ 704 + 228 ≈ 932 of ≈ 1,450 (entity & store estimated 150; ran ≈ 228) · test LOC ≈ 677 + 345 ≈ 1,022 of ≈ 1,800 · review rounds 3 / 14. Not exceeded — but production LOC is at 64 % with 3 of 11 tasks done, and every line so far ran over its estimate; the tripwire is likely to fire around T-7/T-8.

**Final verification:** unit command green (65 + 1 skipped files, 2,561 + 3 skipped tests); remote opt-in 3/3, 0 items remaining.

## Constitution Impact: T-3
- Module reshaped: `server/src/database/dynamodb` gains its first entity (`entities/result-snapshot.entity.ts`).
- Stale guides: `server/src/database/AGENTS.md:58` (says no entities yet and to put entities next to the owning module — the task placed it under `database/dynamodb/entities/`) and `server/AGENTS.md:7` ("snapshots, not used yet"). Not in any task's scope → `/akili-archive`.
- CodeGraph: not initialized.

### T-4: Pure rules and the KP classifier

- **Final status:** PASS
- **Date:** 2026-11-04
- **Implementer attempts:** 1
- **Requirements covered:** FR-2 "Window closed" (17:30 open, 17:31 refused), FR-4 "Collision" / "Later timeline after U closed" (rules), FR-7 "Auto-checked" / "A null fails the check" / "Non-KP", FR-9 (lease reading), FR-11 "Completed with zero" (rule over counts), DD-11 (`DUPLICATE_RESULT_CODE`)

**Attempt 1**
- Files changed (all new): `server/src/ingestion/load-rules.ts`, `server/src/ingestion/load-rules.spec.ts`, `server/src/ingestion/kp-classifier.ts`, `server/src/ingestion/kp-classifier.spec.ts`
- Implementer verification: `pnpm lint` clean; `pnpm build` ok; `pnpm test --reporter=dot` → `Test Files 67 passed | 1 skipped (68)`, `Tests 2633 passed | 3 skipped (2636)`.
- Red run (observed in T-4; code was written before the specs, so these are mutation reds; each reverted and diffed against a backup):
  - F1 accessibility compared with `===`: `FAIL kp-classifier.spec.ts > classifyResult: accessibility > "Open Access" equals "open access " ignoring case and trailing spaces` — `AssertionError: expected { status: 'pending', …(2) } to deeply equal { status: 'auto_validated', …(2) }` (2 failed | 70 passed).
  - F2 null equals null (`yearCg !== null` guard removed): `FAIL … > a null or a missing key fails the check > two null years are not equal` — `AssertionError: expected { status: 'auto_validated', …(2) } to deeply equal { status: 'pending', …(2) }` (1 failed | 71 passed). The task's predicted row ("WoS year null") cannot go red under this mutation (null vs 2025 is unequal either way); the both-null row is the gate. Reviewer: intent met, task wording wrong.
  - F3 window refused at the closing minute (inclusive comparison): `FAIL load-rules.spec.ts > loadWindow (FR-2) > active cycle at 2026-11-20T17:30 -> open` — `AssertionError: expected 'LOADS_WINDOW_CLOSED' to be 'open'` (2 failed | 70 passed).
- Rows: 72 tests — window 7, lease 6, membership end 4, skip reason 13, summary merge 2, has-a-load 4, KP § 12.1 table 17, accessibility 2, null/missing 7 + 4 missing keys, non-KP and wiring 2. Every expected value is a literal.
- Evidence re-run (Leader-inline, non-author): **VERIFIED** — lint OK, build OK, `Test Files 67 passed | 1 skipped (68)`, `Tests 2633 passed | 3 skipped (2636)`.
- Reviewer verdict: **PASS** (checklist). Pure functions, clock injected, `compareMinutes` on Rome minutes; literals only; the three reds hit behavioural assertions. Adjudications: key count — list is authoritative, no fifth pair exists; F2 intent met by the both-null row; F3 reading correct; precedence, null `is_melia`, skip order, lease boundary (5:00 alive, FR-9 "older than"), year/accessibility parsing accepted; `timelineHasLoad`, `LoadSummary`, `EMPTY_SUMMARY` are within the task ("Completed with zero as a rule over counts", "Summary merge"), not widening.
- runtime events: none
- spawns: implementer 21 calls, 114,928 tokens, ended complete; reviewer 15 calls, 56,609 tokens, ended complete

**ADVISORY (4R, not gating)**
- RISK (spec hygiene): fix "9 keys" (design § 7.1 step 4, § 7.5, proposal R-9) → 10, and tasks.md T-4 "5 pairs" → 4 pairs + `is_melia`/`type`, and its falsifier 2 wording — else T-7 may build `field_keys` from the wrong number. **Presented to the user at the T-4 gate as an amendment proposal.**
- RELIABILITY: proposal § 12.1 says accessibility ignores case and *trailing* spaces "as MySQL did"; design § 7.5 says "trimmed"; code uses `.trim()` (also drops leading spaces). Follows the design; a small difference from 2025 MySQL PAD SPACE.
- RELIABILITY: `isTrue` accepts only `true` and `1`; a `"1"` string would silently go to review — check feed types in T-8 fixtures.
- RELIABILITY: `yearOf` sends date strings not starting with a year to review — confirm against real feed samples.
- RESILIENCE: `EMPTY_SUMMARY` is a shared mutable object — `Object.freeze` it.
- READABILITY: `KP_RULE_KEYS` lists `accessibility_cg` (top-level, correct for `field_keys`); a comment that the sub-path is read in `cgAccessibility` would prevent a later "fix".

**Decisions made**
- Implementer followed proposal § 12.1's key list: `KP_RULE_KEYS` = 10 (`is_melia`, `type`, `issue_date_cg/wos`, `is_isi_cg/wos`, `peer_reviewed_cg/wos`, `accessibility_cg/wos`). T-7/T-8 must send these 10 as `field_keys`.
- Accessibility CG read from the object's `.accessibility` (plain string also accepted); year from a number or a `YYYY…` string; classifier precedence auto-checked → not-in-QA → review; null `is_melia` = not MELIA; skip order other-open → this → duplicate; lease exactly 5:00 alive; `skipVerdict` also returns the blocking `timelineId`.
- `LoadSummary` = `{loaded, byProgram, byType, kpGroups, skipped, otherTimelines: {id → {name, count}}}` (design § 5.1 names sections only) — T-7/T-9 may adapt it.
- Reused the T-2 schema types (status, kp_group, failure reason), the cycle status type, `RomeMinute`/`compareMinutes`. `KP_RULES` symbol + `KpRules { classify }` + `DEFAULT_KP_RULES`; no module wiring, no error codes.
- Skills: nestjs-expert + **`tdd` added by the Leader** (business rules with exhaustive tables). Effort medium.

**Issues encountered:** spec miscount (9 keys / 5 pairs vs the 10-key list) and a mis-predicted falsifier row — both in the spec text, not the code.

**Budget running totals:** tasks 4 / 11 · production LOC ≈ 932 + 276 ≈ 1,208 of ≈ 1,450 (83 %; rules & classifier estimated 120, ran 276) · test LOC ≈ 1,022 + 414 ≈ 1,436 of ≈ 1,800 · review rounds 4 / 14. **Not yet exceeded**, but T-5 (size L) alone will cross the production LOC line — flagged to the user at this gate.

**Final verification:** `cd server && pnpm lint && pnpm build && pnpm test --reporter=dot` → green (67 + 1 skipped files, 2,633 + 3 skipped tests).

## Gate after T-4 — spec amendments approved by the back lead (2026-11-04)
- **KP key count (spec tension from the T-4 review):** design § 7.1 step 4 and § 7.5, proposal R-9 ("9 keys") → "the 10 keys listed in proposal § 12.1"; tasks.md T-4 Tests ("5 pairs" → "each side of the 4 pairs") and Falsifier 2 (→ "the two-null-years row goes red"). User answer: "Sí, corrige a 10". Meaning of the rule unchanged. Carried as a named conformance check into the next Reviewer brief.
- **Budget re-estimate (tripwire pre-empted, not fired):** production LOC ≈ 1,450 → ≈ 3,200; test LOC ≈ 1,800 → ≈ 3,800 (design § 10, tasks.md header). Basis: T-1…T-4 ran ≈ 1,208 vs 630 estimated (× 1.9); the loads store and unit of work (T-5) had no budget line. User answer: "Re-estimar y seguir". Review rounds stay 14. The tripwire now compares against the new figures.
- Correction sweep (forward): `grep "1,450|1,800|9 keys|9 rule|5 pairs"` over the spec folder → no surviving stale value outside the amended lines and this log.

### T-5: Loads store and unit of work, with an in-memory world that emulates the keys

- **Status:** PASS on attempt 2 (see below). Attempt 1 FAIL; stopped before attempt 2 by the budget tripwire and an FR-12 spec tension (both escalated to the user, 2026-11-04)
- **Date:** 2026-11-04
- **Requirements in scope:** FR-2 "Start" / "One running load per cycle", FR-4 "Race" / "Later timeline after U closed", FR-9, FR-12

**Attempt 1 — FAIL (parallel lens review: lens 1 FAIL, lens 2 PASS)**
- Files changed (new, uncommitted): `server/src/ingestion/loads.store.ts` (519), `server/src/ingestion/loads.unit-of-work.ts` (508), `server/src/ingestion/loads.unit-of-work.spec.ts` (2,370), `server/test/support/in-memory-loads.ts` (611)
- Implementer verification: `pnpm lint` 0 warnings; build ok; `pnpm test --reporter=dot` → `Test Files 68 passed | 1 skipped`, `Tests 2699 passed | 3 skipped`; `pnpm test:e2e` 14 files, 885 passed.
- Start SQL order (asserted): begin; cycles `FOR SHARE`; timelines `FOR UPDATE`; timeline_steps; timeline_loads by `running_key` `FOR UPDATE`; programs; result types; insert timeline_loads; `update timelines set version = version + 1`; insert audit (`load_start`); `update idempotency_keys` (markExecuted); commit. A stale load adds `update timeline_loads` + `load_end` audit after the running_key lock.
- Red run (observed in T-5): F1 swapped lock order → 3 reds, `AssertionError: expected 'select \`id\`, \`cycle_id\`, \`name\`, \`kin…' to match /^select \`status\`, \`year\` from \`cycles…/`; F2 every duplicate → `ALREADY_IN_THIS_TIMELINE` → 4 reds, `- "reason": "ACTIVE_IN_OTHER_TIMELINE" + "reason": "ALREADY_IN_THIS_TIMELINE"`; Disqualifier probe: fake `running_key` disabled → 9 reds incl. `[ 'started', 'started' ]`. Guard describe: "the in-memory loads world refuses what the unique keys refuse (the guard of every concurrency case below)".
- Evidence re-run (Leader-inline): **VERIFIED** — lint OK, build OK, `Test Files 68 passed | 1 skipped (69)`, `Tests 2699 passed | 3 skipped (2702)`.
- Reviewer lens 2 (risk / data integrity + audit): **PASS** — rows never deleted; only membership write is `endMemberships` (`ended_at IS NULL` guard, chunks of 500); `changes` shapes match § 5.3; failure reason typed; FR-9 stale → `failed`/`ABANDONED` with exactly one `load_end`; FR-4 lazy end via `membershipEnds` (DD-5) on other timelines only; idempotency mark in-tx; no PII; protected files untouched.
- Reviewer lens 1 (reliability / concurrency): **FAIL** — verbatim:

> 1. **Discovered Issue:** A start of timeline T deadlocks against a lot or an end of T's own running load. The class comment says "The lot and the end take only the load row" (`loads.unit-of-work.ts`, LoadsUnitOfWork doc), but that is not true on InnoDB. Migration 0007 adds foreign keys from `timeline_results` to `timelines`, `cycles` and `timeline_loads` (`server/drizzle/0007_timeline_loads.sql:53-55`). Migration 0004 adds a foreign key from `timeline_audit_events.timeline_id` to `timelines` (`0004_timeline_edit.sql:15`). InnoDB checks each foreign key on insert by taking an S record lock on the parent row. The interleaving:
>    - `recordLot` takes X on `timeline_loads[L]` (`lockLoad`), then inserts a membership. That insert needs S on `timelines[T]`.
>    - At the same time, `start(T)` holds X on `timelines[T]` and is waiting for X on `timeline_loads[L]` in `lockRunningLoad`.
>    - That is a lock cycle, so MySQL returns error 1213. `end` hits the same cycle through its `load_end` audit insert.
>
>    A start that has written nothing yet is the likely victim. It then leaves `start()` as a generic error, which becomes a 500 instead of 409 `LOADS_ALREADY_RUNNING`. The trigger is ordinary: an ADMIN clicks Start again on the timeline that is already loading. The test at spec line 2534 avoids this case by starting timeline 12 against a load of timeline 11. The fake cannot show the problem because `TransactionalLoadsStore.insertMembership` and `insertAuditEvent` take no parent-row locks, even though the fake's header says "What each statement locks is what InnoDB locks".
>    * **Violated Rule:** `requirements.md` FR-2 "One running load per cycle" ("the others get 409 `LOADS_ALREADY_RUNNING` … MUST hold under concurrent requests"). Also `design.md` § 7.2 step 2 and P-8, where the start's lock order exists so that the start serializes "without deadlocks"; a lot and an end that take a conflicting order break that premise. Under `docs/trd/trd.md`, this is the NFR-6 concurrency correctness that DD-2 relies on.
>    * **Remediation Suggestion:**
>      - In `recordLot` and `end`, take the locks in the same order as the start before writing: cycle `FOR SHARE`, then timeline `FOR SHARE`, then load `FOR UPDATE`. Get the ids either from the command or from a plain read of the load first.
>      - In the fake, have `insertMembership`, `insertAuditEvent` and `insertLoad` take S on `timelines:<id>` and `cycles:<id>` (the foreign-key parent locks).
>      - Add an in-memory case where `start` of timeline T runs alongside a lot of T's load and alongside an `end` of it. Expect `already_running` and a recorded lot.
>      - Extend the stub-driver SQL-order tests of the lot and the end to assert the new lock order.

- Leader adjudication: lens FAIL **in scope** (T-5's Review is "full — concurrency and lock order"; FR-2 `AND IT MUST` under concurrency). The mechanism was checked: an InnoDB FK check on insert takes an S lock on the parent row. Attempt 1 consumed.
- runtime events: none
- spawns: implementer 88 calls, 386,543 tokens, ended complete (exceeded the persona's 60-call bound without checkpointing — `implementer.md` reported CURRENT by `akili doctor`); reviewer lens 1 20 calls, 91,646 tokens, ended complete (FAIL); reviewer lens 2 22 calls, 79,682 tokens, ended complete

**Not Done / Assumptions (Implementer, verbatim)**
> FR-12 names the step in the audit row, but design 5.3 gives `after: {id, phaseYear, scope}` without it. I followed the design; the step id is on the load row.
> `setTotal` and the 60 s timer heartbeat (single-statement writes) are not in T-5's scope. They are left for T-8.
> When both unique keys refuse, I emulate InnoDB reporting `uq_timeline_results_timeline_code` first, matching the order in migration 0007. Unverified on real MySQL, since no disposable database exists.
> I exceeded the 60-tool-call bound but finished verified, so no checkpoint.

**Forward pointers:** `setTotal` and the 60 s heartbeat write → T-8 (design § 7.3 steps 1 and 5). InnoDB key-report order on a double-key duplicate → T-12.

**Spec tension (lens 2, escalated):** FR-12 requires the load id on every load_start and load_end audit row. Design § 5.3's `load_end` shape has no `id`, and `timeline_audit_events` has no load column, so a `load_end` row cannot be tied to its load. Lens 2: "The requirement wins" → proposed amendment: add `id` to `load_end.after` (or `before: {id, status: 'running'}`). "Step" is met transitively (load row `timeline_step_id`). "Actor (start only)" vs NOT NULL `actor_id`: not a conflict (`started_by` on the end row is correct).

**ADVISORY (both lenses, not gating)**
- RELIABILITY: `recordLot` checks only `status === 'running'`, not the lease — a lot committing after its lease expired revives a load readers see as `failed`/ABANDONED (DD-6).
- RESILIENCE: two lots inserting overlapping codes in different orders can deadlock on MySQL (only reachable with two running loads); the lot rolls back instead of skipping — for the runner's retry (DD-8).
- RELIABILITY: double-key duplicate fallback — when no blocker is found, use `ALREADY_IN_THIS_TIMELINE`.
- RISK: `LoadsDb` type grants `delete`, unused — drop it so "rows are never deleted" holds at the type level.
- RISK: `load_end.request_id` differs by path (normal end: the start's; abandon: the new start's) — document which.
- RELIABILITY: `endExpired` does not re-read `closesAt` under the lock (safe while the FR-11 hold blocks step edits).
- RELIABILITY: `findMemberships` throws if a membership's timeline has no steps — one bad row aborts the lot; worth a log line in T-8.

**Budget tripwire — FIRED (2026-11-04, during T-5):** test LOC ≈ 1,436 + 2,981 ≈ **4,417** against the re-estimated **3,800** (+ 617, + 16 %); production LOC ≈ 1,208 + 1,027 ≈ 2,235 of 3,200 (70 %) with 5 of 11 tasks; review rounds 6 of 14 (T-5 used 2 lens verdicts). Cause: T-5 alone produced ≈ 1,027 production and ≈ 2,981 test lines against ≈ 400 production assumed at the re-estimate — the concurrency spec (66 tests) and the in-memory world with key emulation are much larger than budgeted. Not logged `auto-approved`; escalated to the user before attempt 2.

## Gate during T-5 — decisions of the back lead (2026-11-04)
- **Budget tripwire:** answer "Re-estimar y seguir". Production LOC ≈ 3,200 → ≈ 4,500; test LOC ≈ 3,800 → ≈ 7,000 (design § 10, tasks.md header). Review rounds stay 14.
- **FR-12 spec tension:** answer "Sí, agregar id a load_end". `design.md` § 5.3 `load_end` → `{load: {before: 'running', after: {id, status, total, processed, loaded, skipped, failureReason}}}`; step = the load row's `timeline_step_id`. Carried into the T-5 attempt-2 brief and as a named conformance check into its Reviewer brief.
- Attempt 2 effort: attempt 1 ran at `xhigh` (the T2 ceiling). No in-host Reviewer model differs from the T3 pick and is at least as strong, so **effort ceiling: held xhigh** — fresh T2 Implementer at xhigh with the full Attempt History; Reviewer stays `opus`.

**T-5 Attempt 2 — PASS (parallel lens review: lens 1 PASS, lens 2 PASS)**
- **Final status of T-5:** PASS on attempt 2 (date 2026-11-04). Implementer attempts: 2.
- Effort: xhigh — **effort ceiling: held xhigh** (no in-host Reviewer model differs from the T3 pick and is at least as strong); fresh T2 Implementer with the verbatim FAIL report and the Attempt History.
- Files changed (same four, still new): `server/src/ingestion/loads.store.ts` (564; + `findLoadById`, `findRunningLoad` plain reads, `lockTimelineShared`), `server/src/ingestion/loads.unit-of-work.ts` (551), `server/src/ingestion/loads.unit-of-work.spec.ts` (2,719), `server/test/support/in-memory-loads.ts` (667; FK parent S-locks modelled)
- New lock orders: `recordLot` and `end` — plain read of the load → cycle `FOR SHARE` → timeline `FOR SHARE` → load `FOR UPDATE` → writes; `endExpired` — no cycle/timeline/load lock (its UPDATE writes no FK column); abandon in `start` — cycle `FOR SHARE` → own timeline `FOR UPDATE` → step → plain read of the running load → if stale and of another timeline, that timeline `FOR SHARE` → running load `FOR UPDATE` → abandon, insert, rest. A second deadlock (start(11) abandoning a load of 12 vs start(12)) was found and fixed by the Implementer.
- Amendment applied: `load_end.after.id` on both paths; test `load_end names its load: changes.load.after.id is the id of the load that ended, for a normal end and for the abandon of a stale one (FR-12, design 5.3)`.
- Implementer verification: lint/build exit 0; `Test Files 68 passed | 1 skipped (69)`, `Tests 2738 passed | 3 skipped (2741)` (+39: 6 FK guard, 30 race, 2 stub, 1 `load_end` id).
- Red runs (each restored, compared against backups):
  - F1 (timeline `FOR UPDATE` before cycle `FOR SHARE`): `Tests 3 failed | 102 passed (105)` — e.g. `AssertionError: expected 'select \`id\`, \`cycle_id\`, \`name\`, \`kin…' to match /^select \`status\`, \`year\` from \`cycles…/`; `an edit that commits first…`: `expected { kind: 'stale', seen: 5 } to deeply equal { kind: 'updated', seen: 4 }`.
  - F2 (every duplicate → `ALREADY_IN_THIS_TIMELINE`): `Tests 4 failed | 101 passed (105)` — incl. `two lots inserting the same code in one cycle…`.
  - FK-lock falsifier (fake without FK parent S-locks): `Tests 6 failed | 99 passed (105)` — the six `the INSERT of $what takes S on its foreign-key parent $parent` guard cases, `AssertionError: expected true to be false`.
  - Production order reverted to attempt 1 (FK locks present): `Tests 17 failed | 13 passed | 75 skipped` — 5/10 lot, 6/10 end, 6/10 abandon with `Error: DEADLOCK: the transactions wait for each other (InnoDB answers ER_LOCK_DEADLOCK 1213)`.
- Evidence re-run (Leader-inline, non-author): **VERIFIED** — lint OK, build OK, `Test Files 68 passed | 1 skipped (69)`, `Tests 2738 passed | 3 skipped (2741)`.
- Reviewer lens 1 (reliability / concurrency): **PASS** — every pair among start, recordLot, end, endExpired, abandon and the timeline edit traced against InnoDB locking incl. FK parent S-locks: no cycle, no S→X upgrade; plain-read-before-lock safe in lot/end (a load's cycle/timeline never change; status judged on the locked re-read); SQL-order tests assert the four locks (`expectLoadLockOrder`).
- Reviewer lens 2 (risk / data integrity + audit): **PASS** — `load_end` shape matches amended § 5.3 on both paths (`loadEndAudit`); exactly one `load_end` per load (row lock + conditional update; tests for abandon racing an end and double end); no deletes; only membership update is ending it; typed failure reason; no PII; NFR-6 races decided by unique keys; protected files untouched.
- runtime events: none
- spawns: implementer 36 calls, 227,842 tokens, ended partial (assumptions-only); reviewer lens 1 16 calls, 98,129 tokens, ended complete (PASS); reviewer lens 2 10 calls, 51,069 tokens, ended complete

**Not Done / Assumptions (attempt 2, verbatim):** "The FKs to `users` and `timeline_steps` are not modelled in the fake. No transaction in this world locks those rows, and the fake's header says so." — Leader: assumptions-only, no owed item; lens 1 confirmed those parent S-locks are compatible with every transaction here.

**ADVISORY (attempt 2, not gating)**
- RESILIENCE: abandon path — if `lockRunningLoad` returns a different load than the plain read saw (`running.id !== seen?.id`), its timeline S-lock was never taken → possible 1213. Needs a competing start lasting longer than the 5-min lease; cheap guard: lock that timeline or refuse `already_running` when ids differ.
- RESILIENCE: `endExpired` from a zombie runner never checks its load is still running and can deadlock with the live load's lot (DD-8 retries would recover) — **forward pointer → T-8**: skip `endExpired` once the run learns its load ended.
- RELIABILITY: three concurrent starts on the same `running_key` with a rollback after insert → classic InnoDB 1213 → 500. Rare; **forward pointer → T-7**: consider mapping 1213 in `start` to `already_running` or a retry.
- TEST EVIDENCE: no race case for abandon-start vs the abandoned load's own lot/end, nor edit vs lot (both traced safe). The 1 s timeout harness does not model InnoDB queueing S behind a waiting X nor S locks on duplicate unique entries; no test on real MySQL — **known gap → T-12**.
- RISK (from attempt 1, still present): `LoadsDb` still grants `delete`; `load_end.request_id` still differs by path (normal end: the start's; abandon: the abandoning start's).
- RELIABILITY: `end()` returns `{kind:'load_not_running', status: 'running'}` in an unreachable branch — use a fixed sentinel.
- READABILITY: the `LoadsUnitOfWork` doc and one `describe` cite "DD-9" for the lock order (it is DD-7 / P-8); lot/end SQL-order test titles still say "the load row FOR UPDATE".

**Forward pointers (to carry into later briefs):**
- T-7: `LoadsUnitOfWork.start` returns typed results `cycle_closed`, `window_closed`, `already_running`, `timeline_not_found` → map to `CYCLES_CLOSED`, `LOADS_WINDOW_CLOSED`, `LOADS_ALREADY_RUNNING`, `TIMELINES_NOT_FOUND`; consider 1213 → `already_running`.
- T-8: `setTotal` and the 60 s heartbeat write (design § 7.3 steps 1 and 5) have no store method yet; skip `endExpired` once the load is no longer running; `findMemberships` throws on a timeline with no steps (log line); `recordLot` checks status not lease (a late lot revives a load readers see as ABANDONED — DD-6).
- T-12: InnoDB key-report order on a double-key duplicate; real-MySQL confirmation of the lock orders.

**Decisions made (attempt 2):** ids for lot/end from a plain `findLoadById` read (command shapes unchanged for the runner); the abandon path takes the foreign timeline S-lock only when the plain read sees the load stale; the fake has no deadlock detector (would need `in-memory-stores.ts`) → races run under `withoutDeadlock` (1 s) with `race(lag, first, second)` over lags −3…6 in both orders; cost: lot/end +3 statements, start +1 read, a lot now holds S on its timeline.

**Budget running totals (after T-5):** tasks 5 / 11 · production LOC ≈ 1,208 + 1,115 ≈ 2,323 of ≈ 4,500 · test LOC ≈ 1,436 + 3,386 ≈ 4,822 of ≈ 7,000 · review rounds 8 / 14 (T-5: 4 lens verdicts). Not exceeded against the T-5 re-estimate.

**Final verification:** `cd server && pnpm lint && pnpm build && pnpm test --reporter=dot` → green (68 + 1 skipped files, 2,738 + 3 skipped tests).

### T-6: Forced refresh of the catalog

- **Final status:** PASS
- **Date:** 2026-11-04
- **Implementer attempts:** 1
- **Requirements covered:** FR-8 (`catalog_version` differs → one forced reload); closes P-16

**Attempt 1**
- Files changed: `server/src/admin-config/field-config/reporting-qa-catalog.client.ts` (public `refresh(year)`; private `refresh` renamed `fetchAndStore`; in-flight logic in private `shared(year)`; `forYear` calls `shared`), `server/src/admin-config/field-config/field-catalog.ports.ts` (optional `refresh?(year)` on `FieldCatalogSource`), `server/src/admin-config/field-config/reporting-qa-catalog.client.spec.ts` (2 cases in `describe('refresh (forced)')`) — `3 files changed, 47 insertions(+), 9 deletions(-)`.
- Implementer verification: lint/build clean; `Test Files 68 passed | 1 skipped (69)`, `Tests 2740 passed | 3 skipped (2743)`.
- Red run: concurrent case before the change — `AssertionError: expected "vi.fn()" to be called 2 times, but got 3 times`. **Fetches-again pre-change red not observable** (the private `refresh` was reachable at runtime and already bypassed the fresh window; vitest does not type-check) — **the falsifier substitutes** (Reviewer ruling). A first run errored with `UpstreamUnavailableError` (a consumed Response body reused by `mockResolvedValue`, a setup fault fixed with `mockImplementation`; not counted as a red).
- Falsifier (`refresh` returns `this.forYear(year)`): both cases red — `AssertionError: expected "vi.fn()" to be called 2 times, but got 1 times` (2 failed | 22 passed); reverted → 24 passed.
- Consumers (`git grep -ln "ReportingQaCatalogClient\|FieldCatalogSource" -- server/src server/test`): `field-catalog.ports.ts`, `field-config.module.ts`, `field-config.service.ts`, `reporting-qa-catalog.client.spec.ts`, `reporting-qa-catalog.client.ts` — field-config suites unchanged and green.
- Evidence re-run (Leader-inline, non-author): **VERIFIED** — lint OK, build OK, `Test Files 68 passed | 1 skipped (69)`, `Tests 2740 passed | 3 skipped (2743)`.
- **Review intensity:** the task's `Review` field claimed `skip-eligible`; **not earned** — condition 3 fails (`Consumers` is a grep, not `none`) and override (b) applies (shared port `FieldCatalogSource`). A conformance Reviewer ran. Reported at the T-6 continue gate.
- Reviewer verdict: **PASS** (checklist). `forYear` unchanged step for step (fresh check → in-flight get-or-create with `finally` delete → await inside the same try with the stale fallback); Disqualifier respected (no cache reset between calls; clock moved 1 s inside the fresh hour; concurrent case warms the cache first); the falsifier proves the target mutation is caught; optional port method leaves other implementers and fakes compiling unchanged. ADVISORY: none (diff < 50 LOC).
- runtime events: none
- spawns: implementer 10 calls, 78,221 tokens, ended complete; reviewer not reported by host at write time, ended complete (PASS)

**Decisions made:** callers use `refresh?.()` (optional port method); tests call `client.refresh!` on the concrete class. Skills: nestjs-expert; effort **low** (small, mechanical).

**Budget running totals:** tasks 6 / 11 · production LOC ≈ 2,323 + 22 ≈ 2,345 of ≈ 4,500 · test LOC ≈ 4,822 + 25 ≈ 4,847 of ≈ 7,000 · review rounds 9 / 14. Not exceeded.

**Final verification:** server command green (68 + 1 skipped files, 2,740 + 3 skipped tests).

### T-7: `LoadsService`: preview, start and reads, plus the error codes — PASS (attempt 1)
- **Final status:** PASS on attempt 1 (date 2026-11-04). Implementer attempts: 1. continuations: 1 (FR-2 "Safe retry" test).
- Effort: **high** instead of the default medium — several concerns at once (full paging, chunked membership reads, KP details in the preview, refusal mapping, run-after-commit). Skills: nestjs-expert, api-design-principles, error-handling-patterns (task list, unchanged).
- Files changed:
  - new `server/src/ingestion/loads.service.ts` (552), `server/src/ingestion/loads.errors.ts` (30), `server/src/ingestion/loads.service.spec.ts` (1,117; 37 tests)
  - `server/src/common/error-codes.ts` (+13: `LOADS_WINDOW_CLOSED` 409, `LOADS_ALREADY_RUNNING` 409, `LOADS_NOT_FOUND` 404), `server/src/common/error-codes.spec.ts` (+50)
  - `server/src/ingestion/kp-classifier.ts` (1 line: export `KP_TYPE_KEY`; this spec's own T-4 file, Reviewer ruled acceptable)
- Implementer verification: `cd server && pnpm lint && pnpm build && pnpm test --reporter=dot` → exit 0, `Test Files 69 passed | 1 skipped (70)`, `Tests 2785 passed | 3 skipped (2788)`; consumer `error-codes.spec.ts` 148 passed.
- Red runs (greenfield, observed here; each reverted):
  - F1 (preview stops after page 1; fixture 200 + 200 + 20, collisions on page 3: 10 in U, 2 already in T, 1 in a timeline whose last step closed): `AssertionError: expected { phaseYear: 2026, …(4) } to deeply equal …` — expected `total` 408, received 200; skipped expected U:10 / T:2, received `[]`; `Tests 1 failed | 34 passed (35)`.
  - F2 (`runner.run(1)` before the unit of work): 6 red, e.g. `expected [ { loadId: 1, committed: +0, …(1) } ] to deeply equal [ { loadId: 1, committed: 1, …(1) } ]`.
- Continuation 1 (owed item, Reviewer advisory: no test set `ctx.idempotency`): +2 tests — `carries the request key to the unit of work: the key is marked executed with the load id, in the same commit as the load row`; `a second start with the same key ends with one load, and the key still points at the first`. Falsifier (drop the `reservation` forward): `Tests 2 failed | 35 passed (37)`, `expected { … } to match object { state: 'executed', targetUserId: 1 }` (got `in_progress` / `null`). Reverted. Test-only addition after the PASS; no production change.
- Evidence re-run (Leader-inline, non-author): **VERIFIED** — after attempt 1: lint OK, build OK, `Test Files 69 passed | 1 skipped (70)`, `Tests 2785 passed | 3 skipped (2788)`; after continuation 1: `Tests 2787 passed | 3 skipped (2790)`; `reservation:` forward present.
- Review intensity: task `Review` = checklist; Consumers ≠ none → conformance Reviewer ran.
- Reviewer verdict: **PASS** (lens checklist). FR-1/FR-2/FR-9/FR-10, § 6, § 7.1, § 7.2, DD-13 met; both falsifiers trace through the fixture; write counter wired to `world.history`; `transactions.begun === 0` for preview and failed probe; probe `page 1, pageSize 1` after the 404 and before `unitOfWork.start`; no duplication of unit-of-work steps; logs ids/codes only; DD-9 holds. Rulings: (1) non-401 4xx `rejected` → 500 conformant (§ 6 names 5xx/timeout/401 only); (2) a `notEligible` KP as a preview skip with Reporting's reason acceptable (FR-1 list is a floor); (3) 1213 → `LOADS_ALREADY_RUNNING` advisory; (4) runner throw caught, still 202, conformant with § 7.2.3; (5) `LOAD_RUNNER` / `LoadRunnerPort` in `loads.service.ts` acceptable; (6) unspecified nested field names stand; lease applied via `effectiveLoadStatus`; (7) `kp-classifier.ts` export acceptable; (8) summary with program ids only conformant.
- runtime events: none
- spawns: implementer 47 calls, 223,498 tokens, ended partial (assumptions-only); implementer continuation 5 calls, 229,713 tokens (cumulative, resumed context), ended complete; reviewer 13 calls, 74,672 tokens, ended complete (PASS)

**Not Done / Assumptions (Implementer, verbatim)**
> - The preview also lists a KP that Details reports as `notEligible` as a skip, under the reason Reporting gives, so the preview matches what the run will do. FR-1 names only two reasons, so this goes beyond it.
> - The loop that reads every feed page is private to the service. T-8 needs the same logic and should extract or copy it.
> - The detail `summary` has no program `code` (only `programId`), because the stored summary keeps ids only.
> - An e2e run was not needed: there is no HTTP surface yet (T-9).

Leader adjudication: assumptions-only, no owed item from this field; the Reviewer ruled on items 1 and 3. The owed item that did exist (Safe retry test) came from the Reviewer advisory against the task's Requirements list and was closed by continuation 1.

**ADVISORY (4R, not gating)**
- RISK: 1213 can also come from a concurrent timeline edit (DD-7); `LOADS_ALREADY_RUNNING` then names a load that may not exist. Accepted for now; candidate: a retryable 409/503.
- RELIABILITY: `LoadRunnerPort.run` returns `void`; an `async` T-8 runner's rejection would escape the sync `try/catch` — **forward pointer → T-8**: keep `run` sync or attach `.catch` inside it.
- READABILITY: a runner throw writes two `ingestion` lines (`runner_error` + `ok`); § 7.8 says one per request.
- READABILITY (spec drift): FR-12 says "one `admin_config` log line"; design § 7.8 says `ingestion`. Code follows the design — fix FR-12 at close-out.
- READABILITY: non-KP ineligibles surface only in the run, so preview and run counts can differ — **forward pointer → T-11** (`front-contract.md` line).
- READABILITY: preview `byProgram` carries `code`, the detail summary does not.
- READABILITY: `lockCycleShared` called on the pool just to read the cycle; a plain `findCycle` would say what is meant.

**Forward pointers (to carry into later briefs):**
- T-8: import `LOAD_RUNNER` / `LoadRunnerPort` from `loads.service.ts`; keep `run` sync (or `.catch` internally); the full-paging loop is private to `LoadsService` — extract or reuse, do not diverge.
- T-9: the HTTP test must prove the `Idempotency-Key` replay (same load id twice, one load).
- T-11: `front-contract.md` — preview vs run count difference for non-KP ineligibles; `rejected` 4xx surfaces as 500.

**Budget running totals:** tasks 7 / 11 · production LOC ≈ 2,345 + 596 ≈ 2,941 of ≈ 4,500 · test LOC ≈ 4,847 + 1,167 ≈ 6,014 of ≈ 7,000 (86 %, with T-8, T-9, T-10 still to write — likely overrun, flagged at the T-7 gate) · review rounds 10 / 14. Not exceeded.

**Final verification:** server command green (69 + 1 skipped files, 2,787 + 3 skipped tests).
