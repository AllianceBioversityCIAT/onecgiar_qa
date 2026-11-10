# Step 1 assessment: worklist and field-by-field review — Tasks

> Spec: `requirements.md` (FR-1…FR-25, NFR-1…NFR-8) · `design.md` (DD-1…DD-16, Premise Ledger P-1…P-41). Branch `feat/assessment-step-1`. Approval mode: gated.
> **Verification commands** (`AGENTS.md`): server `cd server && pnpm lint && pnpm build && pnpm test --reporter=dot`; server HTTP `cd server && pnpm test:e2e --reporter=dot`; client `cd client && npx ng build && npx ng test --watch=false`.
> **Red runs.** Every falsifier whose target is created by this spec reads `predicted — greenfield artifact (observed in T-n)`. The owning task quotes the observed red verbatim in `execution.md` before it closes. A red that differs from the prediction is recorded as observed.

## Dependency graph

```text
T-2 (migration) ─┬→ T-3 (pure rules) → T-6 (module) ─┬→ T-7 (worklist) → T-8 (routes) ──────────┐
                 └→ T-5 (ingestion end/title) ───────┼→ T-7                                      │
                                                     │    T-5 → T-13 (backfill) ────────────────┤
T-4 (labels) ────────────────────────────────────────┴→ T-9 (view) → T-10 → T-11 → T-12 ─────────┤
                                                                     (T-12 also ← T-5)            │
                                                     T-8, T-11, T-12 → T-14 → T-15 (← T-13) → T-16 (API HITL)
T-16 → T-17 (client api + layout) ─┬→ T-18 (Results) ─────────────┐
                                   └→ T-19 (Review read) → T-20 ──┴→ T-21 (UI HITL)
T-1 (OQ gate) gates T-9 (OQ-7), T-10 (OQ-5, OQ-8), T-11 (OQ-2, OQ-9), T-12 (OQ-1)
```

Gate edges from **T-1** are listed on the last line of the graph. Nothing else waits on T-1, and T-1, T-2 and T-4 can start at once.

---

## T-1: Settle the open-question defaults (gate)
- **Status:** [ ]
- **Size:** S
- **Depends on:** none
- **Requirements:** every `[OQ-n default]` row (FR-6 OQ-3/OQ-4, FR-9 OQ-7, FR-13 OQ-8, FR-14 OQ-2, FR-15 OQ-9, FR-18 OQ-1, FR-19 OQ-5), DD-15
- **Design refs:** proposal § 12, design DD-15
- **Scope:** record in `execution.md`, for each OQ, Angel's answer or the back lead's named acceptance ("I accept OQ-n default"). Any answer that differs from a default triggers a spec amendment (Correction Closure sweep) before its blocked task starts. No code.
- **Tests:** none
- **Verification:** manual. Every one of the 9 OQ rows has an answer line with who and when
- **Falsifier:** n/a (no test gate). Disqualifier case: an answer recorded from a person's recollection without a Jira comment or a message link
- **Red run:** n/a (no test gate)
- **Disqualifier:** a "yes" with no OQ number, or an acceptance given in bulk without naming each OQ, does not count (KZ-ingestion--step-1-loads-1)
- **Consumers:** none (no shared symbol changed)
- **Review:** skip-eligible. It writes no code; the claim to prove at execute time is "every blocked task cites its OQ line"
- **Done when:** 9 answer lines exist, and each blocked task (T-9 part, T-10, T-11, T-12) cites its line
- **Skills:** product-manager-toolkit

## T-2: Migration `0009_assessment` and Drizzle schemas
- **Status:** [x]
- **Size:** M
- **Depends on:** none
- **Requirements:** FR-10, FR-11, FR-12, FR-13, FR-17 (one assessment per membership and step), FR-18 (one release per end, NFR-3), FR-19 (state enum), FR-21 (audit enum), FR-24 (title column), NFR-7 (size check)
- **Design refs:** design § 5
- **Scope:** the 7 new schema files and the `title` column on `timeline-results.ts`, `schema/index.ts`, `pnpm db:generate` output (`0009_assessment.sql`, meta), a hand-written `rollback/0009_assessment.down.sql`, and `schema.spec.ts` assertions. It does **not** run `db:migrate` (P-19).
- **Tests:** `schema.spec.ts` assertions over the generated SQL:
  - `uq_result_assessments_membership_step`
  - `uq_assessment_releases_assessment`
  - `uq_quick_comments_role_hash`
  - PK of the validations table
  - `chk_result_assessments_finished`
  - `chk_comment_withdrawn`
  - `chk_value_copy_size`
  - `title varchar(1000) COLLATE utf8mb4_0900_ai_ci`
  - every enum's members, exactly as § 5
- **Verification:** server command; `git diff --stat server/drizzle` lists only the 0009 files plus the journal
- **Falsifier:** drop the `unique()` on `result_assessments`, or the COLLATE on `title` → `schema.spec.ts` red on that assertion
- **Red run:** predicted — greenfield artifact (observed in T-2)
- **Disqualifier:** the assertions read the TS schema object instead of the generated SQL (they would pass a schema drizzle-kit renders differently). A hand edit of the generated `.sql` (forbidden, `database/AGENTS.md:14`)
- **Consumers:** `server/src/database/drizzle/schema/schema.spec.ts` (pins `timeline_results` columns), `server/src/database/drizzle/schema/index.ts`
- **Review:** full. New invariants carried by keys
- **Done when:** the SQL has the 7 tables, the keys and the title column. The rollback drops exactly those. The falsifier went red
- **Skills:** nestjs-expert, nestjs-best-practices

## T-3: Pure rules — role steps, status, transitions, end rule, scope
- **Status:** [x]
- **Size:** M
- **Depends on:** T-2 (enum types)
- **Requirements:**
  - FR-1: all five scenarios' predicates (*Assessor sees only their scope*, *Revoked grant*, *Admin sees all*, *Role with no active row*; *Out-of-scope by URL* only as the predicate)
  - FR-2 (*open, then closed* boundaries; *AND IT MUST* clock rule as the pure input)
  - FR-5 (*Status after each end*; *BUT must NOT be stored*: TS evaluator and SQL CASE built from one table)
  - FR-14 / FR-15 end rule (zero core, all core green, grey core commented or not)
  - FR-19 transition table
- **Design refs:** § 7.1, § 7.2, § 7.5 (end rule), § 7.7, DD-2, DD-4, DD-10
- **Scope:** `server/src/assessment/role-steps.ts`, `qa-status.ts` (`statusOf`, `statusSqlCase`), `comment-transitions.ts`, `assessment-rules.ts`, `scope.ts`, with their specs. No I/O.
- **Tests:**
  - Table tests: FR-5 every row; the end rule (0 core + finish → QA; all green → QA; grey with a comment → returned; grey without → error listing the keys); transitions (allowed and refused).
  - Scope matrix: role × grant live or revoked × assignment active or removed × `'*'` or exact key × program in scope, out of scope, excluded × ADMIN.
  - Step open at `opensAt` −1, 0 and +0:59, and `closesAt` :59 and +1 min; hold.
  - `statusSqlCase()` text equals a snapshot derived from the same table.
- **Verification:** server command
- **Falsifier:**
  - flip `round: 1` to `2` in the ASSESSOR row → scope test *Assessor sees only their scope* red;
  - drop the `exclusions` check → "excluded program" row red;
  - map `returned` + `clarification_requested` thread to `returned_to_program` → FR-5 row red
- **Red run:** predicted — greenfield artifact (observed in T-3)
- **Disqualifier:** a fixture where no program is excluded and no grant is revoked (the mutations would not diverge), or SQL CASE tested only by length
- **Consumers:** none (no shared symbol changed)
- **Review:** full. These tables decide visibility and ends
- **Done when:** every listed fixture row exists, and the three falsifiers went red
- **Skills:** nestjs-expert, tdd

## T-4: Labels from Reporting — port, parse, snapshot, fixture
- **Status:** [x]
- **Size:** M
- **Depends on:** none
- **Requirements:** FR-20 (*Rename is not an update*; *AND IT MUST* one hash for equal values; absent, malformed or `null` labels)
- **Design refs:** § 7.8, DD-6, DD-7, P-5, P-6, P-31, P-40
- **Scope:**
  - **First step:** settle P-31 by reading the Reporting commit `448debd0f` (`git -C ../onecgiar_pr show 448debd0f -- onecgiar-pr-server/docs/qa-catalog.en.md`, run by the back lead if the worktree guard refuses). Record the observed shape. If it differs, use the Pivot Protocol.
  - Code: `results-feed.port.ts` (`labels?`); `reporting-results-feed.client.ts` (lenient `parseLabels`, fixed log reason `labels_malformed`); `snapshot-store.port.ts` and `dynamo-snapshot-store.ts` (`labels` / `labelsGz`, hash on `values` only); `result-snapshot.entity.ts`; `load-runner.ts` (pass the labels through); move `snapshotKeyOf` to `load-rules.ts` as an export; `fixtures/results-details.json` (synthetic labels, including one `null`).
- **Tests:**
  - client spec: labels present, absent, malformed (array, number values) → kept or dropped, never a `FeedError`;
  - snapshot store spec: same values with other labels → same hash and no conflict;
  - runner spec: re-entry with renamed labels → `changed_fields` `[]`;
  - `snapshotKeyOf` round trip on a key built by the real `snapshotSortSuffix` (KZ-ingestion--timeline-sync-1).
- **Verification:** server command (plus `dynamo-snapshot-store.dynamo-local.spec.ts` when `DYNAMODB_ENDPOINT` is set)
- **Falsifier:** include `labels` in `hashValues` → *Rename is not an update* red. Make `parseLabels` throw `BadShape` → the malformed case red
- **Red run:** predicted — greenfield artifact (observed in T-4)
- **Disqualifier:** the rename fixture keeps the same label text (no divergence), or the hash test mocks `hashValues`
- **Consumers:** `ingestion/results-feed.port.ts`, `snapshot-store.port.ts`, `dynamo-snapshot-store.ts`, `load-runner.ts`, `dynamo-snapshot-store.spec.ts`, `dynamo-snapshot-store.dynamo-local.spec.ts`, `test/support/fake-snapshot-store.ts`, `reporting-results-feed.client.spec.ts` (fixture `:120`, `:156`) (P-23, P-40)
- **Review:** full. It changes a pinned ingestion behavior (DD-12)
- **Done when:** P-31 is settled. Every consumer suite is green. Both falsifiers went red
- **Skills:** nestjs-expert, aws-serverless, error-handling-patterns

## T-5: Ingestion — title copy, `endAsReleasedQaed`, count inside `end()`
- **Status:** [ ]
- **Size:** M
- **Depends on:** T-2
- **Requirements:** FR-24 (title stored; count in the end transaction), FR-18 (membership ends after a `qaed` ack: the store method)
- **Design refs:** § 7.8, P-1, P-2, P-3
- **Scope:**
  - `load-runner.ts`: write `title` on membership insert; stop computing the count before `end()` at `:267` and `:668`.
  - `loads.unit-of-work.ts` `end()`: count on the transaction handle.
  - `loads.store.ts`: `endAsReleasedQaed` (conditional, no round condition).
  - `test/support/in-memory-loads.ts`.
  - The preview (`loads.service.ts:443`) is unchanged.
- **Tests:**
  - `loads.unit-of-work.spec.ts`: a returned-not-resubmitted result whose round-2 membership commits between the old pre-count and `end()` is not counted (deferred store);
  - runner spec: a title is written; a non-string title gives null;
  - store spec: `endAsReleasedQaed` on active, already-ended and missing rows.
- **Verification:** server command plus the HTTP command (`ingestion-loads*.e2e-spec.ts`)
- **Falsifier:** call the count on the pool again inside `end()` → the deferred-interleaving test red. Drop `IS NULL` from `endAsReleasedQaed` → the already-ended test red
- **Red run:** predicted — greenfield artifact (observed in T-5). The interleaving test is new and runs against the old code first
- **Disqualifier:** an interleaving test with synchronous fakes, where the commit can never fall between the reads (the race is not exercised)
- **Consumers:** `load-rules.spec.ts`, `loads.unit-of-work.spec.ts`, `load-runner.spec.ts`, `loads.service.spec.ts`, `test/ingestion-loads.e2e-spec.ts`, `test/ingestion-loads-privacy.e2e-spec.ts`, `test/support/in-memory-loads.ts` (grep `countReturnedNotResubmitted|returnedNotResubmitted`, `endAsReturned|snapshotKeyOf`, as run)
- **Review:** lenses (concurrency + regression). It moves a count into a transaction
- **Done when:** all the listed consumers are green, and both falsifiers went red
- **Skills:** nestjs-expert, tdd

## T-6: Assessment module wiring, error codes, catalog export
- **Status:** [ ]
- **Size:** S
- **Depends on:** T-3
- **Requirements:** FR-22 (authenticated routes), FR-25 (error codes), DD-1
- **Design refs:** § 6 (codes), § 9, DD-1, P-15, P-17, P-18, P-24, P-41
- **Scope:** `assessment.module.ts` (imports `UsersModule` and `FieldConfigModule`; binds `DRIZZLE`-based stores, `SNAPSHOT_STORE`, `RESULTS_FEED`, `ADMIN_CONFIG_CLOCK`, `IDEMPOTENCY_*`), registration in `app.module.ts`, `assessment.errors.ts`, the 8 codes in `common/error-codes.ts`, and `FieldConfigModule` exporting `FIELD_CATALOG_SOURCE`.
- **Tests:** module spec (resolves every provider; there is no `IngestionModule` in its imports); `error-codes.spec.ts` (new codes and statuses); `field-config.module.spec.ts` (export list now has 2)
- **Verification:** server command
- **Falsifier:** import `IngestionModule` → the module spec's "no IngestionModule" assertion red. Remove `FIELD_CATALOG_SOURCE` from the exports → resolution red
- **Red run:** predicted — greenfield artifact (observed in T-6)
- **Disqualifier:** a module spec that overrides every provider (it proves nothing about the bindings)
- **Consumers:** `admin-config/field-config/field-config.module.spec.ts` (pins exports), `admin-config/admin-config.module.ts`, `field-config.unit-of-work.ts`, `admin-config/AGENTS.md` ("only export"), `common/error-codes.spec.ts`, `test/openapi.e2e-spec.ts` (P-41, grep `ERROR_CATALOG`)
- **Review:** checklist. Wiring
- **Done when:** the app boots in tests with the module, and the falsifiers went red
- **Skills:** nestjs-expert

## T-7: Worklist store and service (scope, filters, status, sort, cursor, counters)
- **Status:** [ ]
- **Size:** M
- **Depends on:** T-5 (title column), T-6
- **Requirements:**
  - FR-1: scenarios *Assessor sees only their scope* (incl. *BUT* other timelines and *AND IT MUST* revoke and remove), *Revoked grant*, *Admin sees all* (*BUT* not `not_in_qa`), *Role with no active row* (*BUT* not 403)
  - FR-3 (*Default is official*)
  - FR-4 (*Auto-validated hidden* incl. *AND IT MUST* counters; *Search by title* incl. empty)
  - FR-5 (filter accepts the 3 unproduced values)
  - FR-6 (*Updated* incl. *BUT* no keys; *Assessed by with no nickname*; Action Area and Export absent)
  - FR-7 (*Sort by Science Program* incl. *AND IT MUST* fixed query count; *Bad cursor*; counters ignore other filters)
  - FR-19 (*Predicate ready*)
  - NFR-1
- **Design refs:** § 7.3, DD-4, DD-11, P-20, P-36, P-39
- **Scope:** `worklist.store.ts` (Drizzle + port), `worklist-cursor.ts`, `worklist.service.ts`, `test/support/in-memory-assessment.ts` (counts statements)
- **Tests:** service spec over the fake: every scenario above; a 120-row fixture across 5 programs, paged with sort by program descending (each row once, in order); the statement count is ≤ 8 at 30 and at 1,000 rows (the same number); cursor tampering and a cursor from another sort → `VALIDATION_FAILED` on `cursor`; the Drizzle adapter's generated SQL contains the status `CASE` from `statusSqlCase()` and the `ended_at` filter (§ 7.2)
- **Verification:** server command
- **Falsifier:**
  - count the comments per row in a loop → statement count grows at 1,000 rows (red);
  - drop the Auto-validated hiding from the counters → *AND IT MUST* red;
  - return `changedFields` → the *BUT* red
- **Red run:** predicted — greenfield artifact (observed in T-7)
- **Disqualifier:** a fixture with fewer rows than one page (paging is never exercised), or every program sharing one name (the sort does not diverge)
- **Consumers:** none (no shared symbol changed)
- **Review:** full. Scope leak is the main defect class
- **Done when:** every listed scenario has a test, and the three falsifiers went red
- **Skills:** nestjs-expert, api-design-principles, tdd

## T-8: Worklist routes
- **Status:** [ ]
- **Size:** S
- **Depends on:** T-7
- **Requirements:** FR-1 (*Out-of-scope result by URL*: 404 for a timeline not offered), FR-3 (*BUT* `?timeline` not assigned → 404 `TIMELINES_NOT_FOUND`), FR-7 (limit bounds 1–100, default 25), FR-22
- **Design refs:** § 6 (first three rows)
- **Scope:** `worklist.controller.ts`, `dto/`, `models/` (OpenAPI)
- **Tests:** e2e `test/assessment-worklist.e2e-spec.ts`: routes, envelope, `meta.page.nextCursor`, 401 without a token, 404 for an unassigned timeline, limit 0 / 101 → 400, OpenAPI listing
- **Verification:** server HTTP command
- **Falsifier:** answer an unassigned timeline with an empty 200 → the 404 test red
- **Red run:** predicted — greenfield artifact (observed in T-8)
- **Disqualifier:** e2e that calls the service directly instead of HTTP (P-37 live path)
- **Consumers:** `test/openapi.e2e-spec.ts` (keeps the document in step with the router)
- **Review:** checklist. A thin HTTP layer over T-7
- **Done when:** the e2e is green over HTTP, and the falsifier went red
- **Skills:** nestjs-expert, api-design-principles

## T-9: Assessment view (read)
- **Status:** [ ]
- **Size:** M
- **Depends on:** T-4, T-6, T-1 (OQ-7 only, for the ToC rule)
- **Requirements:**
  - FR-8 (*Structure follows the catalog* incl. *AND IT MUST* 409 / 503; header; "Other fields"; "Not applicable")
  - FR-9 (*Hidden ToC* incl. *BUT* other Hidden fields absent from the response; View only; Assessed + Core)
  - FR-1 (*Out-of-scope result by URL* → 404 `ASSESSMENT_NOT_FOUND`)
  - FR-2 (writable flag and read-only reason; admin read-only)
  - FR-11 (labels shown, or ids)
  - NFR-2
- **Design refs:** § 7.4, DD-3, DD-7, P-7, P-8, P-14, P-16
- **Scope:** `assessment-view.ts` (pure), the read side of `assessment.store.ts`, `assessment.service.ts` `open`, the GET route in `assessment.controller.ts`
- **Tests:**
  - pure spec over the real 2026 catalog fixture: order, Hidden dropped, ToC forced with 3 contributions, other / not applicable;
  - service spec: `FieldConfigNoVersionError` → 409, catalog 503 → 503, out of scope → 404, the same 404 for a missing code;
  - snapshot read with an `sk` produced by the real `LoadRunner` path (KZ-ingestion--timeline-sync-1);
  - e2e GET, statement count ≤ 8.
- **Verification:** server command plus the HTTP command
- **Falsifier:**
  - pass `snapshot_sk` without `snapshotKeyOf` → the real-writer key test red;
  - filter Hidden in the controller instead of the service → the *BUT* (response body) red;
  - answer 403 for out of scope → the 404 test red
- **Red run:** predicted — greenfield artifact (observed in T-9)
- **Disqualifier:** a hand-built `sk` without the `SNAP#` prefix in the fixture (the KZ-timeline-sync-1 blindness)
- **Consumers:** none (no shared symbol changed)
- **Review:** full
- **Done when:** every scenario is tested, and the falsifiers went red
- **Skills:** nestjs-expert, aws-serverless

## T-10: Writes I — unit of work, validations, check all, comments, withdraw
- **Status:** [ ]
- **Size:** L → executed as two commits (validations, then comments). Each passes the Reviewer separately
- **Depends on:** T-9, T-1 (OQ-8, OQ-5)
- **Requirements:**
  - FR-2 (*Step 1 not yet open, then closed*: 08:59 and 17:31 refused, 09:00 and 17:30 accepted; *AND IT MUST* clock)
  - FR-10 (*Check all skips other fields* incl. *BUT* 400 naming the field; same state is a no-op)
  - FR-11 (*Value at the time of writing* incl. *AND IT MUST* labels; *Comment on a non-assessed field*; idempotent create; 1–2,000 characters)
  - FR-13 (*Not someone else's comment*: 403, second withdraw 409; window per OQ-8)
  - FR-16 (no validation or comment after the end)
  - FR-19 (writes only `open` and `withdrawn`)
  - FR-21 (one audit row per applied change; none for refusals or no-ops)
  - NFR-4, NFR-7
- **Design refs:** § 5 (lock order), § 7.5, § 7.7, DD-3, DD-8, P-17, P-38
- **Scope:** `assessment.unit-of-work.ts`, the write side of `assessment.store.ts`, `assessment.service.ts` (`validate`, `comment`, `withdraw`), PUT, POST and withdraw routes, the comment replay reader
- **Tests:**
  - service specs over the fake unit of work for every scenario;
  - the clock pinned at 08:59, 09:00, 17:30 and 17:31 Rome on a timeline with those minutes;
  - DST day: 02:30 on the spring change is rejected by admin-config already, so the test only checks a step open across the change;
  - idempotent comment replay returns the same comment;
  - `grep -rn "new Date()\|Date.now()" server/src/assessment` returns only `assessment.module.ts` (clock binding);
  - e2e for each route;
  - value copy over 64 KiB → `value_truncated`.
- **Verification:** server command plus the HTTP command
- **Falsifier:**
  - judge the step with `new Date()` → the pinned-clock tests red;
  - skip `status = 'pending'` under the lock → *no write after the end* red;
  - copy the value from the latest snapshot of the result instead of the membership's → *Value at the time of writing* red (the fixture holds two memberships with different titles)
- **Red run:** predicted — greenfield artifact (observed in T-10)
- **Disqualifier:** a clock test whose step minutes equal the clock's default (every boundary passes), or a value-copy fixture where both memberships hold the same title
- **Consumers:** none (no shared symbol changed)
- **Review:** lenses (correctness + privacy). Writes and copied values
- **Done when:** every listed clause is tested, the three falsifiers went red, and the grep holds
- **Skills:** nestjs-expert, error-handling-patterns, tdd

## T-11: Writes II — ends (auto Quality Assessed, finish → returned) and quick comments
- **Status:** [ ]
- **Size:** M
- **Depends on:** T-10, T-1 (OQ-2, OQ-9)
- **Requirements:**
  - FR-14 (*Last core goes green*: QA, Assessed by, release row queued, non-core comment visible; zero core is not automatic)
  - FR-15 (*Return*: status, Assessed by, release queued, all comments visible; `ASSESSMENT_CORE_UNCOMMENTED` with keys; pending until then)
  - FR-16 (locked after the end)
  - FR-17 (*Five concurrent finishes* incl. *BUT* validation before is kept, after is refused: the unit-of-work level)
  - FR-12 (*Shared by role* incl. *BUT* TPB does not see it; dedupe returns the existing row)
  - FR-21 (end and quick-comment audit)
- **Design refs:** § 7.5 end rule, § 7.7 quick comments, DD-5
- **Scope:** `assessment.service.ts` `finish` and the end path inside `validate`; `quick-comments.service.ts`, `quick-comments.controller.ts`; finish and quick-comment routes
- **Tests:**
  - service specs for each scenario;
  - deferred fake unit of work: 5 finishes interleaved → 1 end, 4 `ASSESSMENT_FINISHED`, 1 release row, 1 end audit;
  - a validation committed before the finish is kept, one queued after it is refused;
  - quick comments: two saves of the same trimmed text → one row, the second answer 200;
  - e2e for the routes.
- **Verification:** server command plus the HTTP command
- **Falsifier:**
  - remove `WHERE status = 'pending'` from the end update → the 5-finish test gives 5 ends (red);
  - compute auto-QA over every Assessed field instead of core → *Last core goes green* red (the fixture has a grey non-core field)
- **Red run:** predicted — greenfield artifact (observed in T-11)
- **Disqualifier:** finishes run sequentially in the fake (the race is not exercised; deferred stores are required)
- **Consumers:** none (no shared symbol changed)
- **Review:** lenses (concurrency + correctness)
- **Done when:** every clause is tested, and both falsifiers went red
- **Skills:** nestjs-expert, tdd

## T-12: Release outbox
- **Status:** [ ]
- **Size:** M
- **Depends on:** T-5, T-11, T-1 (OQ-1)
- **Requirements:** FR-18 (*Reporting down* incl. *AND IT MUST NOT* two releases; `not_in_qa` counts as released; refused reasons; admin list and retry; membership ended only after the ack), FR-5 (`returned` membership ended still listed), NFR-3, NFR-6
- **Design refs:** § 7.6, DD-1, DD-5, P-1, P-3, P-4
- **Scope:** `release.store.ts`, `release.service.ts` (`dispatch`, claim, send, ack), `releases.controller.ts`, the after-commit call from `AssessmentService`, `event: 'assessment_release'` log line
- **Tests:**
  - fake feed: 503 three times → the row stays `pending`, and the user's end answered 200;
  - `released` → `sent` + membership ended `released_qaed` / `returned`;
  - `not_in_qa` on a retry → `sent` + ended;
  - `not_submitted` → `refused`, membership active;
  - two dispatchers interleaved (deferred) → one send per row;
  - 51 due rows → two calls of ≤ 50;
  - admin routes 403 for an assessor;
  - the end answers before the feed resolves (NFR-6, with a feed that never resolves).
- **Verification:** server command plus the HTTP command
- **Falsifier:**
  - drop the lease condition from the claim → the two-dispatcher test sends twice (red);
  - treat `not_in_qa` as refused → the retry test red;
  - await the dispatch in the request → the NFR-6 test times out on the assertion
- **Red run:** predicted — greenfield artifact (observed in T-12)
- **Disqualifier:** a fake feed that always succeeds on the first call (the retry path is never run)
- **Consumers:** `ingestion/loads.store.ts` (`endAsReturned`, `endAsReleasedQaed` gain a caller; `ingestion/AGENTS.md` "no caller" sentence is now false → T-15)
- **Review:** lenses (concurrency + external contract)
- **Done when:** every case above is tested, and the three falsifiers went red
- **Skills:** nestjs-expert, error-handling-patterns, tdd

## T-13: Title backfill
- **Status:** [ ]
- **Size:** S
- **Depends on:** T-5
- **Requirements:** FR-24 (earlier memberships get their title without manual SQL)
- **Design refs:** § 7.8, DD-9
- **Scope:** `title-backfill.ts` (bootstrap hook, not awaited, pages of 50, conditional update)
- **Tests:** 120 untitled rows → all titled, 3 snapshot pages; a second run touches 0 rows; a missing snapshot leaves null and continues; bootstrap is not delayed (the hook returns before the work ends)
- **Verification:** server command
- **Falsifier:** drop `AND title IS NULL` from the update → a row titled meanwhile is overwritten (red, deferred fixture)
- **Red run:** predicted — greenfield artifact (observed in T-13)
- **Disqualifier:** fewer than 51 rows (the paging is never exercised)
- **Consumers:** none (no shared symbol changed)
- **Review:** checklist
- **Done when:** the tests above pass, and the falsifier went red
- **Skills:** nestjs-expert, aws-serverless

## T-14: Cross-cutting HTTP suites — concurrency, clock, privacy, OpenAPI
- **Status:** [ ]
- **Size:** M
- **Depends on:** T-8, T-11, T-12
- **Requirements:** FR-17 (over HTTP: 5 parallel finishes), FR-2 (over HTTP, with the clock overridden as in admin-config e2e), FR-22 (*no PII in logs*; nickname only), NFR-3, NFR-4, NFR-5
- **Design refs:** § 7.9, P-37
- **Scope:** `test/assessment-concurrency.e2e-spec.ts`, `test/assessment-privacy.e2e-spec.ts` (log spy over every new route, with planted title, body, label, nickname and email strings), OpenAPI coverage
- **Tests:** as scoped
- **Verification:** server HTTP command
- **Falsifier:** log the comment body in the service line → privacy suite red. Remove the conditional end → concurrency red
- **Red run:** predicted — greenfield artifact (observed in T-14)
- **Disqualifier:** a log spy that does not wrap every logger and `console` (the ingestion privacy suite pattern is the reference)
- **Consumers:** `test/openapi.e2e-spec.ts`
- **Review:** full
- **Done when:** the suites are green over HTTP, and both falsifiers went red
- **Skills:** nestjs-expert

## T-15: Documents — front contract, module guide, pending items
- **Status:** [ ]
- **Size:** S
- **Depends on:** T-14, T-13
- **Requirements:** FR-25 (all items), DD-13 (the known gap for Overview and Notifications deep links)
- **Design refs:** § 9
- **Scope:**
  - `docs/specs/assessment/step-1-assessment/front-contract.md`;
  - `server/src/assessment/AGENTS.md` (bindings, lock order, rules, testing);
  - `server/src/ingestion/AGENTS.md`: `endAsReturned` has a caller, the `changed_fields` emptiness rule, `snapshotKeyOf` location, labels — these are this spec's own deliverables;
  - `server/src/admin-config/AGENTS.md`: the visibility predicate is built, `FIELD_CATALOG_SOURCE` is exported;
  - pending items (kaizen pending list) for root `AGENTS.md` (domain row), `docs/ux-ui/design.md` § 7, TRD § 5.1 / § 7.3.
- **Tests:** none
- **Verification:** manual docs-against-code check. Every code in `assessment.errors.ts` appears in the contract (`grep -o "ASSESSMENT_[A-Z_]*" server/src/assessment/assessment.errors.ts | sort -u` equals the contract's list)
- **Falsifier:** add a code to `assessment.errors.ts` without the contract → the grep comparison differs
- **Red run:** n/a (no test gate)
- **Disqualifier:** contract shapes copied from the design instead of read from the DTOs and models
- **Consumers:** `server/src/ingestion/AGENTS.md`, `server/src/admin-config/AGENTS.md` (statements the code now falsifies: "no caller", "only export", "not built")
- **Review:** checklist. Docs against code
- **Done when:** the grep comparison is equal, and the three falsified sentences are rewritten
- **Skills:** cognitive-doc-design

## T-16: API HITL on dev (gate before the UI)
- **Status:** [ ]
- **Size:** S
- **Depends on:** T-15
- **Requirements:** NFR-1, NFR-2 (latency on dev with real data), NFR-3 (a real-MySQL race), FR-18 (one live release on TEST data the back lead names)
- **Design refs:** DD-16
- **Scope:** the back lead applies `0009` on dev (P-19). Run, with tokens read from a git-ignored file (never chat):
  - 5 parallel finishes on one result;
  - a worklist page timing at the largest timeline;
  - one finish → release `not_qaed` and Reporting's answer;
  - the frozen `front-contract.md` handed to Yeck.
- **Tests:** none
- **Verification:** manual, each check recorded in `execution.md` with ids only
- **Falsifier:** n/a (no test gate)
- **Red run:** n/a (no test gate)
- **Disqualifier:** a token pasted in chat; timings taken while another agent runs builds (`AGENTS.md` concurrency rule); fewer than 100 memberships in the timed timeline (the latency proves nothing; report the spread instead)
- **Consumers:** none (no shared symbol changed)
- **Review:** skip-eligible. A human gate; the claim to prove is "each check has its recorded observation"
- **Done when:** all checks are recorded, and the back lead says PASS
- **Skills:** none

## T-17: Client — API transport, models, `WorkspaceLayout`
- **Status:** [ ]
- **Size:** S
- **Depends on:** T-16
- **Requirements:** FR-8 (AC2: one control collapses the menu and the navigator), FR-25 (the client mirrors the contract)
- **Design refs:** § 8 (first and last rows), DD-14, P-28, P-29
- **Scope:** `core/api/assessment-api.ts`, `assessment.models.ts`, `shell/workspace-layout.ts`, `qa-shell.ts` (reads the service; the same default: collapsed on `/results/:code`). **Yeck approves the `qa-shell.ts` change before merge** (team `CLAUDE.md` § 2)
- **Tests:** api spec with `provideHttpClientTesting` (envelope, cursor, error codes); a layout spec (default per URL, `setFocus(true)` collapses both)
- **Verification:** client command
- **Falsifier:** keep the shell's local `linkedSignal` → the focus test leaves the menu open (red)
- **Red run:** predicted — greenfield artifact (observed in T-17)
- **Disqualifier:** a layout test that reads the service and never the shell's binding
- **Consumers:** `client/src/app/shell/qa-shell.html` (only reader of `collapsed`, P-29)
- **Review:** checklist
- **Done when:** the client command is green, and the falsifier went red
- **Skills:** angular-developer

## T-18: Results page on the API
- **Status:** [ ]
- **Size:** M
- **Depends on:** T-17
- **Requirements:**
  - FR-3 (default timeline; only assigned ones);
  - FR-4 (filters, search, Auto-validated hidden);
  - FR-5 (8 status labels);
  - FR-6 (columns; Updated; no Action Area or Export; "—" for no nickname);
  - FR-7 (sort on the server, pager, counters, a click opens the review);
  - FR-23 (loading, empty ×3, error with retry, read-only banner; table scroll at 360 px).
- **Design refs:** § 8 (Results rows), DD-13, P-25, P-26
- **Scope:** `results-store.ts`, `results.mapper.ts`, `results-view.ts/.html`, `results-table.ts`. Removes the Assessor filter, the reassign and export outputs, and the mock reads in these files only. `results.mock.ts` stays
- **Tests:**
  - rewrite `results-view.spec.ts` over a fake API (its mock assertions are this task's consumers);
  - mapper spec over every status;
  - state specs (loading, the three empties, error + retry, read-only banner);
  - sort-header accessible name and `aria-sort`;
  - an unknown `?stage=` value is dropped (DD-13).
- **Verification:** client command
- **Falsifier:** sort with `TableSort.apply` on the page rows → the spec asserting the requested `sort` query param fails. Show Auto-validated in the default request → the default-filter spec red
- **Red run:** predicted — greenfield artifact (observed in T-18)
- **Disqualifier:** specs that keep reading `RESULTS` from the mock (they test the old page)
- **Consumers:** `results/results-view.spec.ts` (pins mock rows), `notifications/notifications.mock.spec.ts` (reads `results.mock`, must stay green), `overview/overview-view.ts`, `overview/ov-cycle-hero.ts`, `notifications/*` (P-26)
- **Review:** full. It is Juanpa's and Yeck's screen
- **Done when:** the client command is green, the falsifiers went red, and Overview and Notifications specs are unchanged and green
- **Skills:** angular-developer, tailwind-design-system, frontend-design

## T-19: Review page — read on the API
- **Status:** [ ]
- **Size:** M
- **Depends on:** T-17
- **Requirements:** FR-8 (header, sections, navigator, focus control), FR-9 (Hidden absent, View only read-only, Assessed green or grey + Core, ToC complete), FR-2 (read-only banner and disabled actions), FR-23 (states; navigator as a drawer below 768 px)
- **Design refs:** § 8 (Review rows), P-27
- **Scope:** `review-store.ts`, `review.mapper.ts` (API → existing VMs, `ai: null`), `review-view.ts/.html` (AI disconnected, `aiCount` 0), `review-aside.*` (focus control via `WorkspaceLayout`). The reads of `review.mock.ts` are replaced in these files
- **Tests:** mapper spec (sections, ToC groups, Core tag, view vs assessed); component specs (states; the accessible names "Validated" / "Not validated"; no `review-ai-note` rendered; keyboard path through the fields)
- **Verification:** client command
- **Falsifier:** map `mode: 'view'` fields with a validation mark → the view-only spec red. Leave `aiCount` from the mock → the "no AI" spec red
- **Red run:** predicted — greenfield artifact (observed in T-19)
- **Disqualifier:** VM tests that build VMs by hand instead of through the mapper from an API fixture
- **Consumers:** `review/review-aside.ts`, `review-toc-section.ts`, `review-model.ts`, `review-comments-drawer.ts`, `review-view.ts` (the `review.mock` importers, P-27)
- **Review:** full
- **Done when:** the client command is green, and both falsifiers went red
- **Skills:** angular-developer, tailwind-design-system, frontend-design

## T-20: Review page — actions
- **Status:** [ ]
- **Size:** M
- **Depends on:** T-19
- **Requirements:**
  - FR-10 (green/grey, undo, Check all / Uncheck all);
  - FR-11 (add a comment, quick-comment insert and edit, idempotency key per submit);
  - FR-12 (save as quick comment);
  - FR-13 (withdraw on own open comments);
  - FR-14 / FR-15 (finish flow; the auto-QA end is shown);
  - FR-16 / FR-17 (`ASSESSMENT_FINISHED` → reload + "Finished by <nickname>");
  - FR-23 (error toasts from the catalog message).
- **Design refs:** § 8 (actions, comments drawer)
- **Scope:** `review-store.ts` actions, `review-comments-drawer.ts` (quick comments as an input; save; withdraw), `review-footer` wiring
- **Tests:** a component spec per action over a fake API, including the 409 paths (`ASSESSMENT_FINISHED`, `ASSESSMENT_STEP_CLOSED`, `ASSESSMENT_CORE_UNCOMMENTED` naming the fields)
- **Verification:** client command
- **Falsifier:** ignore `ASSESSMENT_FINISHED` (keep the local state) → the "Finished by" spec red
- **Red run:** predicted — greenfield artifact (observed in T-20)
- **Disqualifier:** a fake API that always succeeds (no 409 path exercised)
- **Consumers:** `review/review-comments-drawer.ts` (reads `QUICK_COMMENTS`, P-27)
- **Review:** full
- **Done when:** the client command is green, and the falsifier went red
- **Skills:** angular-developer, frontend-design

## T-21: UI HITL — visual, keyboard, contrast (T6)
- **Status:** [ ]
- **Size:** S
- **Depends on:** T-18, T-20
- **Requirements:** FR-23 (layout at 360, 768 and 1440 px; drawer navigator), NFR-8 (contrast, focus order, keyboard path), FR-8 (focus control collapses both)
- **Design refs:** requirements § 7 *Defect classes* (layout and contrast rows)
- **Scope:** a T6 multimodal review of both screens against the in-repo mockup at three widths, with screenshots in `execution.md`. Yeck and Juanpa sign off on the design deltas (vocabulary, removed filter)
- **Tests:** none
- **Verification:** manual. A checklist per width: no page-level horizontal scroll, the table scrolls inside its card, the navigator drawer opens and closes, focus is visible, green/grey readable in light and dark
- **Falsifier:** n/a (no test gate)
- **Red run:** n/a (no test gate)
- **Disqualifier:** screenshots taken at one width only, or with the dev-tools device frame at a zoom other than 100 % (effective CSS px unknown)
- **Consumers:** none (no shared symbol changed)
- **Review:** skip-eligible. A human and T6 gate; the claim to prove is "three widths × two screens recorded, plus sign-off"
- **Done when:** the checklist is complete, and Yeck's sign-off is recorded
- **Skills:** frontend-design

---

## Coverage — scenarios and clauses to tasks

| Requirement · scenario / clause | Task(s) |
|---|---|
| FR-1 *Assessor sees only their scope* (incl. BUT other timelines; AND IT MUST revoke and remove) | T-3 (predicate), T-7 (query) |
| FR-1 *Revoked grant with a stale assignment* | T-3, T-7 |
| FR-1 *Admin sees all* (BUT not `not_in_qa`) | T-3, T-7 |
| FR-1 *A role with no active row* (BUT not 403, not step-1 results) | T-3, T-7 |
| FR-1 *Out-of-scope result by URL* (404 = missing) | T-9 (result), T-8 (timeline) |
| FR-2 *Step 1 not yet open, then closed* (incl. AND IT MUST clock) | T-3 (pure), T-10 (service), T-14 (HTTP) |
| FR-2 *Timeline on hold* | T-3 (hold → upcoming), T-7 (empty) |
| FR-2 admin read-only unless assigned | T-3, T-9, T-10 (403 `ASSESSMENT_READ_ONLY`) |
| FR-3 *Default is official* (BUT unassigned `?timeline` → 404) | T-7, T-8, T-18 |
| FR-4 *Auto-validated hidden* (AND IT MUST counters) | T-7, T-18 |
| FR-4 *Search by title* (empty state) | T-7, T-18 |
| FR-5 *Status after each end* (BUT not stored) | T-3, T-7, T-11 |
| FR-5 unproduced values accepted as filters | T-7 |
| FR-6 *Updated* (BUT no keys) | T-7, T-18 |
| FR-6 *Assessed by with no nickname* | T-7, T-18 |
| FR-6 Action Area and Export not shown | T-7, T-18 |
| FR-7 *Sort by Science Program* (AND IT MUST fixed query count) | T-7, T-18 |
| FR-7 *Bad cursor* | T-7 |
| FR-7 limits and counters ignore other filters | T-7, T-8 |
| FR-8 *Structure follows the catalog* (AND IT MUST 409 / 503) | T-9 |
| FR-8 header, other fields, not applicable, navigator, focus control | T-9, T-17, T-19, T-21 |
| FR-9 *Hidden ToC* (BUT other Hidden absent from the response) | T-9, T-19 |
| FR-10 *Check all skips other fields* (BUT 400 naming the field); no-op | T-10, T-20 |
| FR-11 *Value at the time of writing* (AND IT MUST labels) | T-10 |
| FR-11 *Comment on a non-assessed field*; idempotent; quick-comment insert and edit | T-10, T-20 |
| FR-12 *Shared by role* (BUT TPB does not see it); dedupe | T-11, T-20 |
| FR-13 *Not someone else's comment*; window | T-10, T-20 |
| FR-14 *Last core goes green*; zero core not automatic | T-3, T-11, T-20 |
| FR-15 *Return*; `ASSESSMENT_CORE_UNCOMMENTED` | T-3, T-11, T-20 |
| FR-16 locked after the end; step close | T-10, T-11, T-14 |
| FR-17 *Five concurrent finishes* (BUT validation before kept, after refused) | T-11 (unit of work), T-14 (HTTP), T-16 (real MySQL) |
| FR-18 *Reporting down* (AND IT MUST NOT two releases); `not_in_qa`; refused; admin list and retry | T-12, T-16 |
| FR-19 *Predicate ready*; transitions | T-3, T-7, T-10 |
| FR-20 *Rename is not an update* (AND IT MUST one hash); absent, malformed, null | T-4 |
| FR-21 audit rows; none on refusal or no-op | T-10, T-11, T-12 |
| FR-22 authorization, nickname only, no PII in logs | T-6, T-8, T-14 |
| FR-23 client states, responsive, accessibility | T-18, T-19, T-20, T-21 |
| FR-24 title stored, earlier rows backfilled, count in end tx | T-5, T-13 |
| FR-25 documents | T-6 (codes), T-15 |
| NFR-1 | T-7, T-16 |
| NFR-2 | T-9, T-16 |
| NFR-3 | T-2, T-11, T-12, T-14, T-16 |
| NFR-4 | T-3, T-10, T-14 |
| NFR-5 | T-14 |
| NFR-6 | T-12 |
| NFR-7 | T-2, T-10 |
| NFR-8 | T-19, T-21 |

## Budget (from design § 10, re-measured here)

**21 tasks:** 18 build tasks plus 3 gates (T-1, T-16, T-21). Production LOC ≈ 4,800, test LOC ≈ 7,500, review rounds ≈ 26.
