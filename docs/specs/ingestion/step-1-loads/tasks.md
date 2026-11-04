# Step-1 loads — Tasks

| | |
|---|---|
| Spec path | `docs/specs/ingestion/step-1-loads` |
| Branch | `feat/step-1-loads` (from `origin/staging` @ `7163227`) |
| Commits | `[SPEC:ingestion/step-1-loads] <emoji> <type>(ingestion) P2-3905: …` |
| Budget (design § 10) | 11 build tasks + 1 HITL · ≈ 4,500 production LOC + ≈ 9,000 test LOC (test LOC re-estimated 2026-11-04 at the T-8 tripwire; before: 7,000 at the T-5 tripwire, 3,800 at the T-4 gate, originally 1,800; production: 4,500 at T-5, 3,200 at T-4, originally 1,450) · ≈ 20 review rounds (was 14; re-estimated at the T-8 tripwire). Tripwire: stop and escalate when exceeded |
| Verification (server) | `cd server && pnpm lint && pnpm build && pnpm test --reporter=dot`; plus `pnpm test:e2e --reporter=dot` where stated |
| PRs | 3 PRs. **PR 1**: T-1 … T-6 (persistence, ports, pure rules). **PR 2**: T-7 … T-9 (service, runner, routes). **PR 3**: T-10, T-11 (edit binding, docs) |
| Open at execution | S-10 (Q3) taken at its default: snapshots keep **every** key (no `field_keys`). An overrule before T-8 changes one constant; after real loads, it needs a rewrite of snapshots |

Status: `[ ]` pending · `[~]` in progress · `[x]` done (after a Reviewer PASS) · `[!]` blocked.

## Dependency graph

```
T-1 ─────────────┐
T-2 ─▶ T-5 ──────┼─▶ T-7 ─▶ T-8 ─▶ T-9 ─▶ T-10 ─▶ T-11 ─▶ T-12 (HITL)
T-3 ─────────────┤
T-4 ─────────────┤
T-6 ─────────────┘
```

**Serial boundaries:**
- Only T-2 touches `server/src/database/drizzle/**` and `server/drizzle/**`.
- Only T-3 touches `server/src/database/dynamodb/**`.
- Only T-7 touches `server/src/common/error-codes.ts`.
- T-1 touches `server/src/users/catalogs/catalog-http.ts`.
- T-6 touches `field-config/reporting-qa-catalog.client.ts`.
- T-10 is the only task that touches `server/src/admin-config/timelines/**`.

**Greenfield:** most falsifier targets do not exist yet. Their `Red run` reads `predicted — greenfield artifact (observed in T-n)`, and that task quotes the observed red in `execution.md` before it closes.

---

## T-1: `postJson` helper and the `RESULTS_FEED` port with its Reporting adapter
- **Status:** [x]
- **Size:** M
- **Depends on:** none
- **Requirements:**
  - FR-8 (the error kinds: 401 → unauthorized, other 4xx → rejected, 5xx, timeout or network → unavailable)
  - NFR-1 (the key is never in a log line or an error message)
  - NFR-4 (10 s timeout on every call)
  - FR-14 (the `release` operation exists)
- **Design refs:** § 7.7; P-11
- **Scope:**
  - `catalog-http.ts`: add `postJson`, with the same abort and mapping as `getJson`.
  - New `ingestion/results-feed.port.ts` (types for list, details, intake and release, as in contract v1.29), `ingestion/reporting-results-feed.client.ts` (field-by-field parsing), and `test/support/fake-results-feed.ts` (records calls in order, scripted answers).
  - Not touched: callers of `getJson`.
- **Tests:** `reporting-results-feed.client.spec.ts`:
  - parse fixtures copied from the contract examples (list, details, intake, release);
  - each status maps to its kind;
  - a malformed body is `unavailable`;
  - the timeout aborts at 10 s (fake timers);
  - a log spy over a 401, a 500 and a timeout never sees the key value.
- **Verification:** server command.
- **Falsifier:**
  - Map 401 to `unavailable`: the 401 case goes red (expected `unauthorized`).
  - Put the request headers in the warn line: the log-spy case goes red on the key string `test-key-SHOULD-NOT-LEAK`.
- **Red run:** predicted — greenfield artifact (observed in T-1)
- **Disqualifier:** fixtures typed by hand from memory instead of copied from `qa-catalog.en.md` v1.29. A log spy on a single sink.
- **Consumers:** `git grep -ln "catalog-http" -- server/src server/test` (run in T-1; the existing `getJson` callers must stay green)
- **Review:** checklist — a new adapter on an existing helper pattern
- **Done when:** all four operations parse their contract fixtures; the error kinds are tested; the key is absent from every captured sink; build green.
- **Skills:** nestjs-expert, api-design-principles, error-handling-patterns

## T-2: Migration `0007`, Drizzle schemas and the audit actions
- **Status:** [x]
- **Size:** M
- **Depends on:** none
- **Requirements:**
  - FR-2: One running load per cycle (`AND IT MUST` hold under concurrency, enforced by the database)
  - FR-4: Race (`AND IT MUST` be enforced by a unique index); Same timeline after the end (S-5 by index)
  - FR-5 (both ids stored)
  - FR-12 (audit actions)
  - NFR-6
- **Design refs:** § 5.1–5.3; DD-2, DD-3; P-10, P-14
- **Scope:**
  - New `schema/timeline-loads.ts` and `schema/timeline-results.ts`. Generated `running_key` and `active_key` STORED with unique indexes, unique `(timeline_id, result_code)`, index `(result_code)`, and FKs.
  - `timeline-audit-events.ts`: actions `update`, `load_start`, `load_end`.
  - `pnpm db:generate` → `server/drizzle/0007_timeline_loads.sql`. Hand-check that it is additive (no DROP, no data change).
- **Tests:** `schema.spec.ts`:
  - shapes of both tables;
  - the generated expressions, as SQL text;
  - the unique keys;
  - the `0007` statements are only CREATE TABLE, CREATE INDEX, ALTER … ADD, and the MODIFY of the enum;
  - update `:952` to the three actions.
- **Verification:** server command.
- **Falsifier:**
  - Write `active_key` as `CONCAT(timeline_id,'#',result_code)`: the expression test goes red (expected `cycle_id`).
  - Drop the `(timeline_id, result_code)` unique: the unique-keys test goes red.
- **Red run:** the `:952` change first, before the schema change. Expected red: `expected [ 'update' ] to deeply equal [ 'update', 'load_start', 'load_end' ]`. Quote it in `execution.md`; the new-table cases are predicted — greenfield artifact (observed in T-2).
- **Disqualifier:** asserting the Drizzle object only and not the generated SQL file, since the SQL is what runs on `qadb`. MySQL's own enforcement of the indexes is **not** provable here; it moves to T-12.
- **Consumers:** `schema.spec.ts:952,1172,1185-1230`; `timelines.unit-of-work.spec.ts:747,795`; `test/support/in-memory-admin-config.ts:101,185` (P-14; these must stay green)
- **Review:** full — migration on the shared dev DB (R-7)
- **Done when:** `0007` is generated and additive; schema tests are green; the timeline suites are unchanged and green.
- **Skills:** nestjs-expert, nestjs-best-practices

## T-3: `ResultSnapshot` ElectroDB entity and the `SNAPSHOT_STORE` port
- **Status:** [x]
- **Size:** M
- **Depends on:** none
- **Requirements:**
  - FR-6: Retry of a lot (same keys, same content, no second item)
  - FR-6: History (one query, ordered by year, cycle, timeline and load)
  - NFR-7 (gzip above 256 KB)
- **Design refs:** § 5.4; DD-1, DD-4, DD-12; P-2, P-3
- **Scope:**
  - New `database/dynamodb/entities/result-snapshot.entity.ts`.
  - New `ingestion/snapshot-store.port.ts`: `put` (idempotent) and `history(resultCode)`.
  - New `ingestion/dynamo-snapshot-store.ts`: conditional put, hash read-back on condition failure, zero-padded sk, gzip path.
  - New `test/support/fake-snapshot-store.ts`.
- **Tests:**
  - Unit tests over the key builder: padding gives the order `2026#000001#00000002#0000000010` < `2026#000001#00000010#0000000001`.
  - Put twice with the same hash → one item, success.
  - Put with a different hash → error.
  - A 300 KB value round-trips through gzip.
  - Opt-in `*.dynamo-local.spec.ts` against DynamoDB Local (`DYNAMODB_ENDPOINT`), skipped when the env var is unset.
- **Verification:** server command; and the opt-in run once with DynamoDB Local, recorded in `execution.md`.
- **Falsifier:**
  - Remove the zero padding: the ordering case goes red (`10` sorts before `2`).
  - Make a condition failure always count as success: the different-hash case goes red.
- **Red run:** predicted — greenfield artifact (observed in T-3)
- **Disqualifier:** the order test using single-digit ids, which cannot show the padding bug. The opt-in test being reported as run when its env var was unset.
- **Consumers:** none (new symbols)
- **Review:** checklist — first ElectroDB entity, small surface
- **Done when:** the entity and the store are tested; the fake implements the same port; the DynamoDB Local run is recorded (or recorded as not run, with the reason).
- **Skills:** aws-serverless, nestjs-expert

## T-4: Pure rules and the KP classifier
- **Status:** [x]
- **Size:** M
- **Depends on:** none
- **Requirements:**
  - FR-2: Window closed (17:31 refused; `AND IT MUST` accept 17:30)
  - FR-4: Later timeline after U closed; Collision
  - FR-7: Auto-checked; A null fails the check; Non-KP
  - FR-9 (the lease reading)
  - FR-11: Completed with zero (S-6, as a rule over counts)
  - DD-11 (`DUPLICATE_RESULT_CODE`)
- **Design refs:** § 7.4, § 7.5; DD-5, DD-6, DD-11
- **Scope:** new `ingestion/load-rules.ts` and `ingestion/kp-classifier.ts`, with the `KP_RULES` token. Pure functions; no Nest, no I/O.
- **Tests:** table-driven specs:
  - Window: the closing minute, one minute later, and a closed cycle.
  - Lease: 4:59 → alive; 5:01 → `ABANDONED`.
  - Membership end: last step closed one minute ago → ends; closes this minute → active.
  - Skip reasons: every combination.
  - KP: the § 12.1 table, a MELIA journal article that passes, accessibility `"Open Access"` vs `"open access "`, a null on each side of the 4 pairs (amended 2026-11-04, was "5 pairs"), a missing key, type `"journal article"`, a non-KP.
  - Summary merge is associative.
- **Verification:** server command.
- **Falsifier:**
  - Compare accessibility with `===`: the `"Open Access"`/`"open access "` row goes red (expected `auto_checked`).
  - Make a null equal to a null: the two-null-years row goes red (expected `review`); a single null against a year is unequal either way (amended 2026-11-04 after the T-4 red run).
  - Use `<` for the window: the 17:30 row goes red.
- **Red run:** predicted — greenfield artifact (observed in T-4)
- **Disqualifier:** expected values derived by calling the function under test. Every value is written out.
- **Consumers:** none (new symbols)
- **Review:** checklist — pure functions with exhaustive tables
- **Done when:** every row of the tables is green and each falsifier is observed red.
- **Skills:** nestjs-expert

## T-5: Loads store and unit of work, with an in-memory world that emulates the keys
- **Status:** [x]
- **Size:** L → split at execution if it exceeds one session (store / unit of work)
- **Depends on:** T-2
- **Requirements:**
  - FR-2: One running load per cycle (two starts at once → one row); Start (version bumped)
  - FR-4: Race (exactly one succeeds); Later timeline after U closed (end under the lot transaction)
  - FR-9 (stale `running` persisted as `failed` at the next start)
  - FR-12 (`load_start` and `load_end` rows)
- **Design refs:** § 7.2, § 7.3 step 2.1 and 2.6–2.7; DD-2, DD-5, DD-6, DD-7; P-8
- **Scope:**
  - New `ingestion/loads.store.ts`: memberships by codes for a cycle, `IN` chunked by 500; loads by timeline; one load.
  - New `ingestion/loads.unit-of-work.ts`:
    - the start transaction: cycle `FOR SHARE`, then timeline `FOR UPDATE`, abandon stale loads, insert the load, bump the version, the audit row, the idempotency mark;
    - the end-expired transaction;
    - the lot transaction: insert memberships with duplicate-key → skip, then progress and heartbeat;
    - the end transaction with the audit row.
  - New `test/support/in-memory-loads.ts`, emulating `running_key`, `active_key` and `(timeline_id, result_code)`, on the lock model of `in-memory-stores.ts`.
- **Tests:** `loads.unit-of-work.spec.ts`:
  - SQL order of the start (cycle lock first, as `timelines.unit-of-work.spec.ts` asserts);
  - two concurrent starts → one `LOADS_ALREADY_RUNNING`;
  - two lots inserting the same code in one cycle → one membership, one skip;
  - a stale running load becomes `failed`/`ABANDONED` inside the start;
  - the audit rows and their `changes` shape.
- **Verification:** server command.
- **Falsifier:**
  - Swap the lock order: the SQL-order test goes red.
  - Catch every duplicate key as `ALREADY_IN_THIS_TIMELINE`: the cross-timeline race case goes red (expected `ACTIVE_IN_OTHER_TIMELINE`).
- **Red run:** predicted — greenfield artifact (observed in T-5)
- **Disqualifier:** a fake that does not reject duplicates. The concurrency case then passes with two rows unless the fake emulates the unique keys; assert the fake rejects them first.
- **Consumers:** `test/support/in-memory-stores.ts` (reused, not changed; grep in T-5)
- **Review:** full — concurrency and lock order
- **Done when:** every case is green with the emulated keys; the lock order matches the edit's.
- **Skills:** nestjs-expert, nestjs-best-practices, error-handling-patterns

## T-6: Forced refresh of the catalog
- **Status:** [x]
- **Size:** S
- **Depends on:** none
- **Requirements:** FR-8 (`catalog_version` differs → one forced reload)
- **Design refs:** § 7.3 step 2.3; P-16
- **Scope:** `reporting-qa-catalog.client.ts`: a public `refresh(year)` that bypasses the fresh window and shares the in-flight promise. Extend the `FieldCatalogSource` port only with an optional method, so field configuration is untouched.
- **Tests:** `reporting-qa-catalog.client.spec.ts`: a forced refresh inside the fresh hour fetches again; two concurrent forced refreshes make one call.
- **Verification:** server command.
- **Falsifier:** make `refresh` return the cached entry; the "fetches again" case goes red (expected 2 calls, got 1).
- **Red run:** run the new case before the change. Expected red: `refresh is not a function`, or the call count. Quote it.
- **Disqualifier:** a test that resets the cache between calls (the cache would then hide nothing).
- **Consumers:** `git grep -ln "ReportingQaCatalogClient\|FieldCatalogSource" -- server/src server/test` (run in T-6)
- **Review:** skip-eligible — must prove: the diff touches only `refresh` and its spec, and the field-config suites are unchanged and green
- **Done when:** the forced refresh is tested; the field-config suites are green.
- **Skills:** nestjs-expert

## T-7: `LoadsService`: preview, start and reads, plus the error codes
- **Status:** [x]
- **Size:** M
- **Depends on:** T-1, T-4, T-5
- **Requirements:**
  - FR-1: Preview counts (`BUT` no intake, release or write; `AND IT MUST` read every page); Scope "all"; Nothing eligible
  - FR-2: Start; Window closed; Safe retry (one load per key); the refusal table (404, 409 × 3, 503)
  - FR-10: Progress
  - FR-9 (stale reads `failed`)
  - DD-13 (probe before the write)
- **Design refs:** § 6, § 7.1, § 7.2; DD-13
- **Scope:**
  - New `ingestion/loads.service.ts`.
  - New `ingestion/loads.errors.ts`: `LOADS_WINDOW_CLOSED`, `LOADS_ALREADY_RUNNING`, `LOADS_NOT_FOUND`. Reuse `TIMELINES_NOT_FOUND`, `CYCLES_CLOSED`, `SERVICE_UNAVAILABLE`.
  - `common/error-codes.ts` and its spec.
  - The runner is called through an injected `LOAD_RUNNER` token.
- **Tests:** `loads.service.spec.ts` with the fake feed, the in-memory world and a fake clock:
  - preview over 3 pages; `ACTIVE_IN_OTHER_TIMELINE` naming U;
  - the fake feed records **no** intake or release, and the world has 0 writes;
  - the "all" scope sends no filters;
  - `total 0`;
  - start → 202 data, runner invoked once **after** commit;
  - each refusal code, with no row written;
  - probe 401 → 503 with no row.
- **Verification:** server command.
- **Falsifier:**
  - Stop the preview after page 1: the 3-page case goes red (expected 110, got 40 or so; fixture: 200 + 200 + 20 items with collisions on page 3).
  - Invoke the runner before the commit: the order assertion goes red.
- **Red run:** predicted — greenfield artifact (observed in T-7)
- **Disqualifier:** a one-page fixture (it cannot catch the paging bug); a write counter not wired to the world.
- **Consumers:** `common/error-codes.spec.ts` (pins the code table)
- **Review:** checklist — orchestration over tested parts
- **Done when:** every listed scenario is a passing test; the codes are in the table.
- **Skills:** nestjs-expert, api-design-principles, error-handling-patterns

## T-8: `LoadRunner`: lots, retries, lease, catalog check, KP release port
- **Status:** [x]
- **Size:** L → split at execution if needed (lot pipeline / failure handling)
- **Depends on:** T-1, T-3, T-4, T-5, T-6, T-7
- **Requirements:**
  - FR-3: A lot (`BUT` no details for skipped or refused; `AND IT MUST` intake before details); Re-run; The scope is read at start
  - FR-6: Retry of a lot; Orphan
  - FR-7 (groups applied to memberships)
  - FR-8: 401 (no retry, `BUT` the key is not logged); Taken but failed later; the error table
  - FR-9: Restart (heartbeat at least once a minute)
  - FR-14: Off (no release call)
  - FR-12 (`load_end`)
- **Design refs:** § 7.3, § 7.5; DD-4, DD-8, DD-10
- **Scope:** new `ingestion/load-runner.ts`: the list, then lots, retries with jitter, the heartbeat timer, the catalog check with one forced refresh, the summary, the end. The KP release constant is `false`.
- **Tests:** `load-runner.spec.ts`, using the fake feed with recorded call order, the fake snapshot store, the in-memory world and fake timers:
  - the FR-3 lot fixture (2 collisions, 1 `not_submitted`, 47 taken);
  - call order `intake([47+1])` before `details([47])`;
  - re-run skips the 47;
  - details 500 ×3 → `failed`/`REPORTING_UNAVAILABLE`, with earlier lots kept;
  - intake 401 → `failed` at once, with 1 call;
  - catalog mismatch then match → completes; mismatch twice → `CATALOG_VERSION_MISMATCH`;
  - snapshot written then the lot transaction fails → the retry writes the same key and hash;
  - heartbeat advances under fake time;
  - with the constant off, the fake feed records no `release`.
- **Verification:** server command.
- **Falsifier:**
  - Call details before intake: the order test goes red.
  - Retry a 401: the "1 call" assertion goes red (expected 1, got 3).
  - Drop the heartbeat timer: the lease test goes red.
- **Red run:** predicted — greenfield artifact (observed in T-8)
- **Disqualifier:** synchronous fakes for retry timing. Use fake timers and assert the backoff delays (1 s and 4 s ± 20 %), not only the call count.
- **Consumers:** none (new symbols)
- **Review:** full — the core of the spec
- **Done when:** every listed case is a passing test with its falsifier observed red.
- **Skills:** nestjs-expert, error-handling-patterns, aws-serverless

## T-9: Controller, DTOs, module wiring, OpenAPI and the HTTP suites
- **Status:** [x]
- **Size:** M
- **Depends on:** T-8
- **Requirements:**
  - FR-13 (every non-ADMIN role → 403, with no Reporting call)
  - FR-2: Safe retry over HTTP (`@Idempotent`)
  - FR-12 (one `ingestion` log line per request)
  - NFR-1 and NFR-2 (log spy)
  - NFR-3 (the start answers without awaiting the run)
- **Design refs:** § 6, § 7.8; P-12
- **Scope:**
  - New `ingestion/loads.controller.ts`, `dto/`, `models/`, `ingestion.module.ts`; register it in `app.module.ts`.
  - New `test/ingestion-loads.e2e-spec.ts`, `test/ingestion-loads-privacy.e2e-spec.ts`, `test/support/ingestion-app.ts`.
- **Tests:**
  - e2e: every route's shapes and codes; each grantable non-admin role → 403 and the fake feed not called; idempotent replay returns the same load id;
  - `openapi.e2e-spec.ts` stays green with the new routes documented;
  - privacy: log spy over every route, a forced 5xx and a probe 401 → no key and no person field.
- **Verification:** server command, then `cd server && pnpm test:e2e --reporter=dot`.
- **Falsifier:**
  - Replace `@RequirePermission(ADMIN_ACCESS)` with `@ReadAccess()` (or a permission a non-admin holds): the 403 cases go red. Removing the decorator outright does not: the route then fails closed for everyone and only the ADMIN case goes red (amended 2026-11-04 after the T-9 red run).
  - Log the request headers: the privacy suite goes red.
- **Red run:** predicted — greenfield artifact (observed in T-9)
- **Disqualifier:** a privacy spy on `Logger.prototype` only (see `test/AGENTS.md`: every sink).
- **Consumers:** `test/openapi.e2e-spec.ts`, `test/auth-hardening.e2e-spec.ts` (route inventory; grep in T-9)
- **Review:** checklist — HTTP surface over the existing patterns
- **Done when:** both e2e suites and the OpenAPI suite are green.
- **Skills:** nestjs-expert, api-design-principles

## T-10: Real "has a load" and the edit race
- **Status:** [x]
- **Size:** M
- **Depends on:** T-5, T-9
- **Requirements:**
  - FR-11: Hold ends; Edit during a load; Load and edit race (`BUT` never an edit after the load read the scope); Completed with zero
- **Design refs:** § 7.6; DD-7, DD-9; reversion challenge; P-13, P-15
- **Scope:**
  - `timeline-loads.ts`: add `DrizzleTimelineLoads` (one statement). **Keep** `NoTimelineLoads` as the double.
  - `timelines.module.ts`: bind the Drizzle adapter.
  - Update `admin-config/AGENTS.md` § *Loads port*: the port is real, and the query count is 7.
  - Not touched: `timelines.service.ts`, `timeline-rules.ts`, `timeline-view.ts`.
- **Tests:**
  - `timeline-loads.spec.ts`: the SQL of `withLoad` covers membership, completed, and running with an alive lease, and excludes a running load with an expired lease.
  - Race test in the in-memory world: an edit read on version v, then a load start (v+1), then the edit's locked write → `TIMELINES_VERSION_STALE`.
  - The list query count is 7.
- **Verification:** server command and `pnpm test:e2e --reporter=dot`.
- **Falsifier:**
  - Remove the version bump from the start (T-5): the race test goes red (the edit commits).
  - Count failed loads in `withLoad`: the zero-member failed case goes red.
- **Red run:** run the race test before binding and before the bump exists. Quote the observed red (the edit commits).
- **Disqualifier:** the edit suites switching to the real adapter without a world. They keep `NoTimelineLoads` or an explicit fake; assert the existing edit suites are unchanged (`git diff --stat` shows no change to them).
- **Consumers:** the 10 files of P-15; `timelines.service.spec.ts` list query count
- **Review:** full — it touches a delivered module's behavior
- **Done when:** the race is closed by version; the existing timeline suites are unchanged and green; `AGENTS.md` updated.
- **Skills:** nestjs-expert

## T-11: Documents
- **Status:** [x]
- **Size:** S
- **Depends on:** T-9, T-10
- **Requirements:** FR-15 (every listed document)
- **Design refs:** § 8, § 9
- **Scope:**
  - New `server/src/ingestion/AGENTS.md`.
  - New `docs/specs/ingestion/step-1-loads/front-contract.md`.
  - `docs/prd.md` US-4, P1 and § 5 item 2.
  - `docs/infrastructure.md:29` (the `cgiar-qa-test` facts from P-3).
  - Pending items for the TRD (listed in design § 9).
  - Not touched: `AGENTS.md`, `CLAUDE.md`, `docs/trd/trd.md`.
- **Tests:** none (documents).
- **Verification (manual):**
  - `git grep -n "automatically when a batch opens" -- docs/prd.md` → 0 hits.
  - `git diff --stat` shows no change to `AGENTS.md`, `CLAUDE.md` or `docs/trd/trd.md`.
  - The front contract lists the 4 routes, 3 statuses, every skip reason and every code. Cross-check against the controller and `loads.errors.ts`.
- **Falsifier:** a code in `loads.errors.ts` missing from `front-contract.md`. The cross-check `git grep -o "LOADS_[A-Z_]*" -- server/src/ingestion | sort -u` vs the contract would show it.
- **Red run:** n/a (no test gate)
- **Disqualifier:** a sweep for the old PRD text keyed only on the exact phrase. Also grep `automatic` in US-4's section.
- **Consumers:** none (no shared symbol changed)
- **Review:** checklist — documents against code
- **Done when:** every listed document is written; the protected files are untouched.
- **Skills:** api-design-principles

## T-12: HITL on dev (human check)
- **Status:** [ ]
- **Size:** M
- **Depends on:** T-11, plus R-1 (intake on the Reporting environment QA calls), P-5 and P-6
- **Requirements:**
  - The parts no automated gate can reach: MySQL enforcement of `running_key`, `active_key` and `(timeline_id, result_code)` on `qadb` (FR-2, FR-4, NFR-6)
  - Real DynamoDB writes and the history query (FR-6)
  - A live load against Reporting (FR-3); NFR-5 throughput measured
  - P-1 sampled again
- **Design refs:** § 5, § 7.3
- **Scope:**
  - On dev, with a timeline of a **test** cycle: preview, start, read progress, complete; re-run; a second timeline of the same cycle collides.
  - Plan in `execution.md` before running. It lists what the checks leave behind: load rows, memberships, snapshots, and results In QA in Reporting TEST (R-12, R-13), and how they are released (KZ-admin-config--cycle-timelines-3).
- **Tests:** manual, with the observations recorded.
- **Verification (manual):** the counts match the preview; the re-run adds 0; the collision is named in the summary; DynamoDB has one item per membership; a forced double start gives one 409.
- **Falsifier:** a duplicate start that creates two `running` rows on `qadb` → FAIL.
- **Red run:** n/a (no test gate)
- **Disqualifier:** running it on a cycle real users see; running before P-5 is settled (a 401 later invalidates the result).
- **Consumers:** none (no shared symbol changed)
- **Review:** full — the human gate
- **Done when:** the observations are recorded, and the leftovers are released or listed.
- **Skills:** nestjs-expert, aws-serverless

## Coverage

| Requirement | Clause | Task |
|---|---|---|
| FR-1 | Preview counts; `BUT` no writes; `AND IT MUST` every page; Scope "all"; Nothing eligible | T-7 |
| FR-2 | Start | T-5 (version), T-7 |
| FR-2 | Window closed, incl. `AND IT MUST` accept 17:30 | T-4 (rule), T-7 (refusal) |
| FR-2 | One running per cycle, `AND IT MUST` by the database | T-2 (index), T-5 (emulated), T-12 (MySQL) |
| FR-2 | Safe retry | T-7, T-9 |
| FR-3 | A lot, `BUT` no details for skips; `AND IT MUST` intake first | T-8 |
| FR-3 | Re-run; Scope read at start | T-8 |
| FR-4 | Collision, `BUT` no lot failure; `AND IT MUST` per cycle | T-4, T-8 |
| FR-4 | Later timeline after U closed | T-4 (rule), T-5 (end) |
| FR-4 | Same timeline after the end | T-2 (index), T-4 |
| FR-4 | Race, `AND IT MUST` by a unique index | T-2, T-5, T-12 |
| FR-5 | Two phases | T-2 (columns), T-8 |
| FR-6 | Retry of a lot; Orphan | T-3, T-8 |
| FR-6 | History | T-3, T-12 |
| FR-7 | Auto-checked; A null fails; Non-KP | T-4, T-8 |
| FR-8 | 401, `BUT` no key; Taken but failed later; the error table | T-1, T-8 |
| FR-9 | Restart | T-4, T-5, T-8 |
| FR-10 | Progress | T-7 |
| FR-11 | Hold ends; Edit during a load; Race, `BUT` never after the read; Completed with zero | T-10 (T-4 for S-6) |
| FR-12 | Audit rows; log line | T-5, T-8, T-9 |
| FR-13 | 403 for every non-admin role, nothing read | T-9 |
| FR-14 | Off | T-8 |
| FR-15 | Documents | T-11 |
| NFR-1 / NFR-2 | Key and PII never logged | T-1, T-9 |
| NFR-3 | Start answers at once | T-9 |
| NFR-4 | Bounded calls | T-1 |
| NFR-5 | Throughput measured | T-12 |
| NFR-6 | Database invariants | T-2, T-12 |
| NFR-7 | Snapshot size | T-3 |
