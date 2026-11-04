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
