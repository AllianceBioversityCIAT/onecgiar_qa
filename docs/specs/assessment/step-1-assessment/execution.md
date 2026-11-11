# Step 1 assessment — Execution Log

## 1. Document Control

| Field | Value |
|---|---|
| Spec path | `docs/specs/assessment/step-1-assessment` |
| Branch | `feat/assessment-step-1` (worktree `onecgiar_qa-assessment`) |
| Approval mode | gated |
| Leader | Claude Code, `opus` (T1) |
| Implementer / Reviewer | `akili-implementer` (`sonnet`, T2) / `akili-reviewer` (`opus`, T3) |
| Started | 2026-11-10 |
| Budget (design § 10) | 21 tasks · ≈ 4,800 production LOC · ≈ 26 review rounds |

**Persona drift at start (2026-11-10):** `akili doctor --agents` reported that `leader.md` primary-instructions and test-harness, `reviewer.md` audit-checklist, and `tester.md` prove-behavior are OUTDATED (they match v2.30/2.32, and the CLI is v2.37.2). `implementer.md` is current. `--fix` was not run, because `.agents/` is a shared file that this spec branch must not edit. The drift was reported to the back lead and is pending on `staging`.

## 2. Task Execution History

### T-2: Migration `0009_assessment` and Drizzle schemas — PASS

| | |
|---|---|
| Date | 2026-11-10 |
| Final status | PASS (attempt 1 of 1) |
| Requirements covered | FR-10, FR-11, FR-12, FR-13, FR-17, FR-18, FR-19, FR-21, FR-24, NFR-3 (keys), NFR-7 (size check) |
| Skills | nestjs-expert, nestjs-best-practices (as task) |
| Effort | medium |

**Attempt 1**

- **Files changed:**
  - new schemas `server/src/database/drizzle/schema/{result-assessments, assessment-field-validations, assessment-comments, comment-events, quick-comments, assessment-audit-events, assessment-releases}.ts`;
  - `timeline-results.ts` (+ `title`), `schema/index.ts`, `schema.spec.ts`;
  - generated `server/drizzle/0009_assessment.sql`, `meta/0009_snapshot.json` and `meta/_journal.json`;
  - hand-written `server/drizzle/rollback/0009_assessment.down.sql`;
  - `server/src/ingestion/loads.unit-of-work.spec.ts:3655`: a one-line regex update. The new column extends the insert column list, so this is consumer fallout and lies outside the named scope.
- **Implementer verification:** `pnpm lint` clean, `pnpm build` clean, `pnpm test --reporter=dot`: `Test Files 71 passed | 1 skipped (72)`, `Tests 3058 passed | 4 skipped (3062)`. The SQL came from `drizzle-kit generate --name assessment`. No `db:migrate` was run.
- **Falsifier (red run, observed):** the committed `0009_assessment.sql` was mutated temporarily, removing the unique key on `result_assessments` and the `COLLATE` on `title` to simulate a regeneration. It was then restored byte for byte. The run was `vitest run src/database/drizzle/schema/schema.spec.ts` → `Tests 2 failed | 201 passed (203)`. Verbatim:
  - `allows one assessment per membership and step (FR-17)` — `AssertionError: expected 'CREATE TABLE `result_assessments` (\n…' to match /CONSTRAINT `uq_result_assessments_mem…/`
  - `adds title varchar(1000) with an explicit _ci collation to timeline_results (FR-24)` — `AssertionError: expected 'CREATE TABLE `result_assessments` (\n…' to contain 'ALTER TABLE `timeline_results` ADD `t…'`
- **Evidence re-run (Leader inline, non-author):** `pnpm -C server lint`, `build` and `test --reporter=dot` gave the same counts → **VERIFIED**.
- **Reviewer verdict:** PASS. Every § 5 key, check and enum matches. The assertions read the generated SQL (the disqualifier does not apply). The SQL shows no sign of a hand edit. The rollback drops exactly the 7 tables and `title`.
- **Runtime events:** none.

**Decisions made**

- The comment `state` enum declares all 10 states (TRD § 7.3 plus `withdrawn`), per DD-10 and FR-19. `comment_events.from_state` and `to_state` use the same list.
- The FK `fk_assessment_field_validations_assessment` is named by hand in the TS schema, because the default name has 67 characters and MySQL allows 64. It reaches the SQL through the generator. A test pins that every constraint name is 64 characters or fewer and that every FK is `ON DELETE no action`.
- Where § 5 is silent:
  - `field_config_version` is `int unsigned`, with no FK;
  - `value_copy` is `json NOT NULL`;
  - `state` defaults to `open`;
  - `request_id` is nullable, as in `field_config_audit_events`;
  - there is no FK on `comment_id`, `assessment_releases.timeline_result_id` or `field_config_version`;
  - `attempts` defaults to 0, and `status` defaults to `pending`.
- Environment: the worktree had no `node_modules`. The Implementer ran `npx pnpm@10.6.5 install --frozen-lockfile`, because the global pnpm 12 refuses the pinned 10.6.5.

**ADVISORY (4R, recorded only)**

- RISK: `comment_events` has no `reason` or `body` column, while TRD ADR-006 and § 5.1 list them and design § 5 leaves them out. If P2-3911 needs a reason, DD-10's "transitions, not schema" fails. Raised at the T-2 gate as a possible amendment.
- READABILITY: `field_config_version` does not say whether it holds `field_config_versions.id` or the per-cycle `number`. T-10 should state which.
- RELIABILITY: `request_id` is nullable, while FR-21 says every audit row holds one. The T-10 and T-11 writers must always set it.
- RELIABILITY: § 5 has no unique key for comment idempotency, so T-10 must cover NFR-3 for double-clicked comments through `@Idempotent()`.
- RISK: the CHECKs on the JSON column (`chk_value_copy_size`) and the cross-column checks are verified only as SQL text. The T-16 HITL confirms that MySQL 8 accepts them.

**Issues encountered**

- `server/src/database/AGENTS.md` (the migration list and schema guarantees) is not updated. It is a shared guide outside T-2's scope, so it is recorded for `/akili-archive`.

**Spawns:** implementer 54 calls, 147,623 tokens, ended complete; reviewer 19 calls, 66,613 tokens, ended complete.

**Running totals (budget tripwire):**

| Measure | Actual | Budget |
|---|---|---|
| Tasks | 1 of 21 | 21 |
| Production LOC | ≈ 415 (TS) + 141 (generated SQL and rollback) | 4,800 |
| Review rounds | 1 | 26 |

Within budget.

**Gate (2026-11-10).** The T-2 gate offered adding `reason` to `comment_events`. The back lead answered "Continue" without taking up the amendment, so the column is not added. It stays an advisory (the P2-3911 schema risk).

### T-3: Pure rules — role steps, status, transitions, end rule, scope — PASS

| | |
|---|---|
| Date | 2026-11-10 |
| Final status | PASS (attempt 2 of 2) |
| Requirements covered | FR-1 (predicates of all five scenarios), FR-2 (step open and hold, pure), FR-5 (table, TS evaluator and SQL CASE from one table), FR-14 and FR-15 (end rule), FR-19 (transition table and predicate) |
| Skills | nestjs-expert, tdd (as task) |
| Effort | attempt 1 `high`, raised above the T2 default `medium` because the tables decide visibility (a security-like scope leak). Attempt 2 `xhigh` (the rework bump) |

**Attempt 1 — FAIL**

- **Files changed** (all new): `server/src/assessment/{role-steps, qa-status, comment-transitions, assessment-rules, scope}.ts`, each with its `.spec.ts`. That is 717 production lines and 125 tests.
- **Implementer verification:** lint 0 warnings, build clean, `Test Files 76 passed | 1 skipped (77)`, `Tests 3183 passed | 4 skipped (3187)`.
- **Falsifiers (observed red):**
  1. ASSESSOR `round: 1` changed to `2`: 31 failed. Among them, `scope.spec.ts > FR-1 Assessor sees only their scope > lists only the (policy_change, SP01) membership` failed with `AssertionError: expected [ false, false, false ] to deeply equal [ true, false, false ]`.
  2. Exclusions dropped in `programSet`: 5 failed. Among them, `no scope rows, SP02 actively excluded` failed with `AssertionError: expected true to be false // Object.is equality`.
  3. The FR-5 clarification row mapped to `returned_to_program`: 4 failed. Among them, `statusOf (FR-5 table) > returned assessment, clarification thread, membership not ended` failed with `AssertionError: expected 'returned_to_program' to be 'clarification_requested' // Object.is equality`. The SQL CASE text snapshot also went red.
- **Evidence re-run (Leader inline):** same counts. `grep "new Date()|Date.now"` over the non-spec files of `src/assessment` returned 0. **VERIFIED.**
- **Reviewer verdict: FAIL** (verbatim):
  > 1. **Discovered Issue:** `server/src/assessment/scope.ts:31` creates `const authorization = new AuthorizationService();` at module level and uses it only for `admin: authorization.can(user, Permission.ADMIN_ACCESS)`. That is an `@Injectable` provider built outside Nest DI, inside a file the task says has no I/O and no providers. No other production file does this; the only other `new AuthorizationService()` calls are in `*.spec.ts`. A test or module that overrides the `AuthorizationService` provider would not reach this copy, so the admin decision would silently stop following it.
  >    **Violated Rule:** `server/AGENTS.md:63`: "inject with `@Inject(Token)` explicitly (constructor parameters), including classes". `server/src/users/AGENTS.md:3`: other modules use `AuthorizationService` through `UsersModule`.
  >    **Remediation Suggestion:** Keep `scope.ts` pure. Have `resolveAccess` take the admin answer from its caller, for example `resolveAccess(user, timelineRoles, isAdmin)`. In T-6/T-7 the caller computes it with the injected `AuthorizationService.can(user, Permission.ADMIN_ACCESS)`. Do not rebuild the permission check by hand in `scope.ts`.
- **Runtime events:** none.

**Attempt 2 — PASS**

- **Files changed:** `scope.ts` and `scope.spec.ts` only. The other four modules are byte-identical to attempt 1.
  - `resolveAccess(user, timelineRoles, isAdmin: boolean)` takes the admin answer as a required parameter, and there is no module-level instance.
  - The spec computes `isAdmin` with a spec-local `AuthorizationService`, as the users specs already do.
  - Three new tests: "FR-1 the admin answer comes from the caller".
- **Red then green:** before the fix, two of the new tests were red, with `AssertionError: expected false to be true // Object.is equality` (`Tests 2 failed | 67 passed (69)`).
- **Implementer verification:** lint and build clean, `Tests 3186 passed | 4 skipped (3190)`. The three falsifiers were re-run, and each went red as in attempt 1.
- **Evidence re-run (Leader inline):** same counts. `grep "new AuthorizationService|new Date()|Date.now"` over the non-spec files returned 0. **VERIFIED.**
- **Reviewer verdict: PASS.** Issue 1 is resolved and nothing regressed. The ADMIN rows still exercise the real permission rule.
- **Runtime events:** none.

**Decisions made (Implementer assumptions, accepted by the Reviewer):**

- The FR-5 table is read in requirement order, and the first matching row wins. A membership that matches no row gets the status `null` and is never listed.
- `inScope` ignores the ended filter, so an ended membership can still be read by URL. `listedFor` applies the filter.
- An ADMIN who also holds an ASSESSOR assignment and a live grant gets the reviewer row, limited to their own program scope and exclusions. This follows FR-1 and FR-2 to the letter, and it differs on purpose from `canReview`'s ADMIN program exemption (DD-13). T-7 and T-10 must not "fix" it.
- `statusSqlCase(columns)` takes column fragments from the caller. Status literals are guarded by `/^[a-z_]+$/`, and no parameters are bound.
- `isAdmin` is a required boolean with no default, so a caller that forgets it does not compile.

**ADVISORY (4R, recorded only):**

- RELIABILITY: the FR-19 lift in `listedFor` also lists memberships that ended `timeline_closed`. For those, `statusOf` gives `null`, because FR-5 rows 3 and 4 allow only `endReason` null or `returned`. T-7 must handle this.
- RISK: `ProgramSet { mode: 'in', ids: [] }` can happen. T-7 must turn it into an always-false condition, never `IN ()`.
- RELIABILITY: `statusSqlCase` assumes the clarification flag is exactly 0 or 1. T-7 must pass `EXISTS(...)` or `COALESCE(..., 0)`.
- RISK: T-7 and the write path must compute `isAdmin` only with the injected `AuthorizationService.can(user, Permission.ADMIN_ACCESS)`, never with a role-code comparison.
- READABILITY: `RoleStepRow.permission` is declared but never read.

**Forward pointers to T-7:** the four advisories above (FR-19 `timeline_closed`, empty `IN`, 0/1 clarification flag, `isAdmin` source).

**Spawns:** implementer 52 calls, 207,248 tokens, ended complete; reviewer 25 calls, 91,705 tokens, ended complete (FAIL); implementer 38 calls, 121,471 tokens, ended complete; reviewer not reported by host at the time of writing, ended complete (PASS).

**Running totals:**

| Measure | Actual | Budget |
|---|---|---|
| Tasks | 2 of 21 | 21 |
| Production LOC | ≈ 1,140 TS (415 + 725) + 141 SQL | 4,800 |
| Review rounds | 3 | 26 |

Within budget.

### T-4: Labels from Reporting — port, parse, snapshot, fixture — PASS

| | |
|---|---|
| Date | 2026-11-10 |
| Final status | PASS (attempt 1 of 1) |
| Requirements covered | FR-20 (*Rename is not an update*; one hash for equal values; labels absent, malformed or `null`) |
| Skills | nestjs-expert, aws-serverless, error-handling-patterns (as task) |
| Effort | `high`, raised above `medium` because the task changes pinned ingestion behavior (DD-12) |

**P-31 settled (Leader, inline, before the spawn).** Reporting commit `448debd0f` (`onecgiar_pr`, local) gives `QaResultsDetailsItem.labels: Record<string, Record<string, string | null>>`: "`{}` (never absent) when it holds none. `null` is an id with no row." This matches the design, so no Pivot. The commit does not touch `docs/qa-catalog.en.md`; the shape was read from `qa-results-response.dto.ts`.

**Attempt 1**

- **Files changed** (under `server/src/`):
  - `ingestion/results-feed.port.ts` (`FeedLabels`, `labels?`);
  - `ingestion/reporting-results-feed.client.ts` (lenient `parseLabels`, log line `upstream_bad_labels source=reporting reason=labels_malformed`);
  - `ingestion/snapshot-store.port.ts`;
  - `ingestion/dynamo-snapshot-store.ts` (`packJson`, `unpackJson`, `toRecord`: one row-to-record path);
  - `database/dynamodb/entities/result-snapshot.entity.ts` (`labels`, `labelsGz`);
  - `ingestion/load-rules.ts` (exports `SNAPSHOT_SK_PREFIX` and `snapshotKeyOf`);
  - `ingestion/load-runner.ts`;
  - `ingestion/fixtures/results-details.json` (synthetic labels: `countries` `170` → "Colombia", `999` → `null`);
  - specs: `reporting-results-feed.client.spec.ts`, `dynamo-snapshot-store.spec.ts`, `dynamo-snapshot-store.dynamo-local.spec.ts`, `load-rules.spec.ts`, `load-runner.spec.ts`.

  `test/support/fake-snapshot-store.ts` needed no change. About 134 production lines.
- **Implementer verification:**
  - lint and build clean;
  - unit: `Test Files 76 passed | 1 skipped (77)`, `Tests 3210 passed | 6 skipped (3216)`;
  - e2e: `Test Files 16 passed (16)`, `Tests 968 passed (968)`.
- **Falsifiers (observed red):**
  1. Labels added to the hash in the runner: `Tests 4 failed | 43 passed (47)`. The failing test is `load-runner.spec.ts > labels (FR-20, DD-6) > re-entry with the same values and a renamed label: one hash, changed_fields [], no earlier snapshot read, the old labels kept`, with `AssertionError: expected 'e5d16f698f8f47c755f8736cadb710b733946…' to be 'd35b1d88d66d811545929847a371613822f56…' // Object.is equality`.
  2. `parseLabels` made to throw `BadShape`: `Tests 8 failed | 62 passed (70)`. For example, `details: labels (FR-20, DD-6) > malformed (number values): dropped, the load does not fail, the values stay, only the reason word is logged` failed with `FeedError: reporting_feed_unavailable`.
- **Evidence re-run (Leader inline):** lint, build, unit and e2e give the same counts. **VERIFIED.**
- **Reviewer verdict: PASS.**
  - The hash and the conflict check compare `values` only, so the first labels win (P-6).
  - No label text is logged.
  - The disqualifier does not apply: the rename fixture diverges, and the hash is not mocked.
  - `snapshotKeyOf` is tested with the real `snapshotSortSuffix`.
- **Runtime events:** none.

**Decisions made:**

- A present `labels: null` is malformed: it is dropped, with the fixed log line.
- Any malformed part drops the whole `labels` object (§ 7.8).
- `{}` is stored as `"{}"`.
- `hashValues` stays private and is tested through the runner.

**Issues encountered:** `DYNAMODB_ENDPOINT` was not set, so the two new cases in `dynamo-snapshot-store.dynamo-local.spec.ts` were written but did not run. **Gap:** they must run once against DynamoDB Local before the spec closes, at T-16 at the latest.

**ADVISORY (4R, recorded only):**

- RELIABILITY: `onLabelsMalformed` logs once per result, so a bad batch gives up to 50 identical warning lines.
- RISK: the DynamoDB Local cases have not run (see the gap above).
- READABILITY: `ingestion/AGENTS.md:24` still calls `fixtures/` "Reporting contract examples", while `results-details.json` now carries synthetic labels. T-15 should cover it.
- READABILITY: the casts in `packJson` could be simpler.

**Spawns:** implementer 41 calls, 140,276 tokens, ended complete; reviewer not reported by host, ended complete (PASS).

**Running totals:**

| Measure | Actual | Budget |
|---|---|---|
| Tasks | 3 of 21 | 21 |
| Production LOC | ≈ 1,275 TS + 141 SQL | 4,800 |
| Review rounds | 4 | 26 |

Within budget.

### T-5: Ingestion — title copy, `endAsReleasedQaed`, count inside `end()` — PASS

| | |
|---|---|
| Date | 2026-11-10 |
| Final status | PASS (attempt 1 of 1) |
| Requirements covered | FR-24 (title stored; `returnedNotResubmitted` counted in the end transaction), FR-18 (store method `endAsReleasedQaed` only; no caller until T-12) |
| Skills | nestjs-expert, tdd (as task) |
| Effort | `xhigh`, raised above `medium` because the task moves a count into a transaction and needs a real interleaving test (effort dial: concurrency) |
| Review mode | parallel lens reviewers (2): concurrency + reliability, regression + risk; each with baseline conformance |

**Attempt 1**

- **Files changed** (under `server/`):
  - `src/ingestion/load-runner.ts` (title on the membership; both pre-counts removed);
  - `src/ingestion/loads.unit-of-work.ts` (`end()` counts on the transaction handle after the load-row lock; `EndLoadCommand.returnedNotResubmitted` removed);
  - `src/ingestion/loads.store.ts` (`endAsReleasedQaed`);
  - `test/support/in-memory-loads.ts`;
  - specs: `src/ingestion/load-runner.spec.ts`, `src/ingestion/loads.unit-of-work.spec.ts`.

  `loads.service.ts` (the preview, P-2) is untouched. About 94 production lines.
- **Implementer verification:**
  - lint and build clean;
  - unit: `Test Files 76 passed | 1 skipped (77)`, `Tests 3246 passed | 6 skipped (3252)`;
  - e2e (focused): `ingestion-loads`, `ingestion-loads-privacy`, `openapi`: 96 passed. The full `pnpm test:e2e` was blocked twice by the host resource guard (RAM below 4,500 MB) and reported under *Not Done* as owed.
- **Red runs (observed):**
  - title: `load-runner.spec.ts -t "the title of the membership"` → 4 failed, e.g. `expected null to be 'Climate-smart rice in the Mekong'`;
  - interleaving against the old code: `loads.unit-of-work.spec.ts -t "is read inside the end transaction"` → 3 failed, e.g. `expected { total: 0, byProgram: {}, byType: {} } to deeply equal { total: 2, … }`. This red differs from the prediction: it comes from `end()` not counting at all, because the count was the runner's;
  - store: first run against a stub returning `not_found` → 3 failed, e.g. `expected { ended: false, reason: 'not_found' } to deeply equal { ended: true }`.
- **Falsifiers (observed red, then restored):**
  1. M1, the count in a separate transaction before the end: `loads.unit-of-work.spec.ts` → 2 failed. The deferred-interleaving test failed at `expect(storedCount(world)).toEqual(await world.store.countReturnedNotResubmitted(11))`: stored `total:2`, rows say `total:1`.
  2. M2, `IS NULL` dropped from `endAsReleasedQaed`: `-t endAsReleasedQaed` → 3 failed: expected `where (id = ? and ended_at is null)`, received `where id = ?`.
- **Evidence re-run (Leader inline):** lint, build and unit give the same counts. **VERIFIED.** The full e2e, blocked for the Leader too (4 attempts, about 3.7 GB free), was then run with `RG_FORCE=1` at the user's explicit authorization: `Test Files 16 passed (16)`, `Tests 968 passed (968)`. The owed item is closed.
- **Reviewer verdicts:** concurrency + reliability **PASS**; regression + risk **PASS**.
  - The count runs on the transaction's own handle after `lockLoadInStartOrder` (`loads.unit-of-work.ts:648`). The stub test pins `via === 'tx'` and no pool count.
  - The Disqualifier does not apply. `DeferredCount` wraps the real `InMemoryLoadsTransactions`, which has round trips and row locks, so the lot really blocks on the load-row lock.
  - `end()` has two callers (`load-runner.ts:281`, `:678`); both are updated.
  - There is one membership insert path, and it carries the title for new rows and round-2 re-entries.
  - The in-memory fake matches the adapter for `endAsReleasedQaed`.
- **Runtime events:** none.

**Continuations:** none. The *Not Done* item (full e2e owed) was closed by the Leader's forced re-run after the user authorized it.

**Decisions made:**

- **Count error at end (user decision, 2026-11-10: "Accept and record it").** A count error now rolls back the whole end transaction. At a failed end, the runner retries 3 times, then logs `end_not_written`, and the lease later reads the load as ABANDONED instead of `failed` with its reason. On the completed path, a count failure leads to `fail()`, which counts again. Before T-5, a failed end counted best effort (timeline-sync archive `execution.md:193`). § 7.8 requires the in-transaction count and says nothing about count failure. The count and the end hit the same database, so an outage takes down both. Accepted as is, with no spec amendment.
- `end()` always counts, at a failed end too, and runs `recordProgress`. This adds two statements per end under the load-row lock. The summary always carries `returnedNotResubmitted`, which `storedSummary` already filled when reading, so the API output is unchanged.
- The title is cut by code point to 1,000 characters, which matches utf8mb4 `varchar(1000)`. `title` is optional on `LotMembership` and `NewMembershipValues`.
- `endAsReleasedQaed` returns `{ended:true}` or `{ended:false, reason:'not_found'|'already_ended'}`, with one read after a zero-row update (same shape as `endAsReturned`, P-1).
- Which test catches which mutation: the literal Falsifier wording ("the count on the pool again inside `end()`") is caught by the stub test's `via === 'tx'` and no-pool assertions, not by the deferred test. Under READ COMMITTED with the load row held, a pool read after the lock is as accurate. The race form (M1, a count before the lock) is what the deferred-interleaving test catches.

**Issues encountered / gaps:**

- **Gap:** M2 is caught only by SQL-text assertions on the stub driver. The in-memory fake has its own guard and stayed green. The already-ended effect on a live MySQL row is not checked (no disposable MySQL). Recorded as a gap, not as coverage; open for T-12 or a HITL.
- `tsc` over the tests shows 2 pre-existing `title` missing-property errors, from T-2: `src/ingestion/loads.service.spec.ts:194` and `test/ingestion-loads.e2e-spec.ts:256`. Vitest does not typecheck, so nothing is hidden today. They were left out of scope.
- The full e2e was blocked by the host RAM guard and needed the user-authorized `RG_FORCE=1`.

**ADVISORY (4R, recorded only):**

- RELIABILITY: a persistent count-only bug, such as a query timeout, would turn every failure reason into ABANDONED (see the decision above). A runner test that pins a throwing count (`end_not_written`, no `load_end` row) would document it.
- RESILIENCE (for T-12): the load-row lock serializes this load's lots, but not a concurrent `endAsReturned` from the release ack. A round-1 row ended `returned` that commits after the count is missed until the next end. One line for T-12's design.
- READABILITY: `server/src/ingestion/AGENTS.md:19` is stale. It still says `endAsReturned` is "port only", and it does not mention `endAsReleasedQaed` or the count in `end()`. Goes to the FR-25 pending items (T-15).
- RELIABILITY: adding `title: null` to the two fixtures above would make `tsc` over the tests clean.

**Spawns:**

| Role | Calls | Tokens | Ended |
|---|---|---|---|
| implementer | 154 | 326,633 | partial (*Not Done*: full e2e owed) |
| reviewer (concurrency) | 13 | 57,872 | complete (PASS) |
| reviewer (regression) | 18 | 69,787 | complete (PASS) |

**Running totals:**

| Measure | Actual | Budget |
|---|---|---|
| Tasks | 4 of 21 | 21 |
| Production LOC | ≈ 1,370 TS + 141 SQL | 4,800 |
| Review rounds | 6 | 26 |

Within budget.

### T-6: Assessment module wiring, error codes, catalog export — PASS

| | |
|---|---|
| Date | 2026-11-11 |
| Final status | PASS (attempt 2 of 2) |
| Requirements covered | FR-22 (the module is registered; authenticated routes come later), FR-25 (the 8 error codes in the catalog), DD-1 |
| Skills | nestjs-expert (as task) |
| Effort | `medium` in attempt 1 (wiring); `high` in attempt 2 (rework bump) |
| Review mode | lens checklist, single Reviewer |

**Attempt 1 — FAIL**

- **Files changed** (under `server/src/`):
  - new: `assessment/assessment.module.ts`, `assessment/assessment.errors.ts` (8 typed errors), `assessment/assessment.module.spec.ts`;
  - edited: `app.module.ts` (registers `AssessmentModule`), `common/error-codes.ts` (+8 codes), `common/error-codes.spec.ts`, `admin-config/field-config/field-config.module.ts` (exports `FIELD_CONFIG_EFFECTIVE` and `FIELD_CATALOG_SOURCE`), `admin-config/field-config/field-config.module.spec.ts` (pins 2 exports), `admin-config/AGENTS.md` (the "only export" sentence became false and was rewritten; this module guide is a listed consumer, P-15).
- **Bindings:**
  - `LOADS_STORE` → `DrizzleLoadsStore`, `SNAPSHOT_STORE` → `DynamoSnapshotStore`, `RESULTS_FEED` → `ReportingResultsFeedClient`;
  - `ADMIN_CONFIG_CLOCK`, `IDEMPOTENCY_STORE` → `DrizzleIdempotencyStore`, `IDEMPOTENCY_CLOCK`;
  - imports: `DrizzleModule`, `DynamoDbModule`, `ConfigModule.forFeature(catalogsConfig)`, `UsersModule`, `FieldConfigModule`.
- **Implementer verification:**
  - lint and build clean;
  - unit: `Test Files 77 passed | 1 skipped (78)`, `Tests 3267 passed | 6 skipped (3273)`;
  - `test/openapi.e2e-spec.ts`: 15 passed.
- **Red run:** not observed before the code. The implementer wrote the code before the specs, so the first run was green. This differs from the prediction ("greenfield artifact"); the first observed reds are the falsifiers.
- **Falsifiers (observed red, then restored):**
  1. `IngestionModule` imported: `expected [ [Function DrizzleModule], …(5) ] to not include [Function IngestionModule]` (`assessment.module.spec.ts:70`).
  2. `FIELD_CATALOG_SOURCE` removed from the exports:
     - `field-config.module.spec.ts` failed with `expected [ Symbol(FIELD_CONFIG_EFFECTIVE) ] to deeply equal [ Array(2) ]`.
     - The module spec first stayed green, because the `strict:false` lookup found the provider inside `FieldConfigModule`. A probe provider that injects through the import list was added, and then it failed with `Nest can't resolve dependencies of the Probe (?, AuthorizationService) … Symbol(FIELD_CATALOG_SOURCE)`.
- **Evidence re-run (Leader inline):** same counts. **VERIFIED.**
- **Reviewer verdict: FAIL** (verbatim):
  > 1. **Discovered Issue:** `assessment.errors.ts` `AssessmentCoreUncommentedError` keeps `fields` off the response. `error-codes.spec.ts` then pins that absence: "carries the uncommented core keys on the error, outside the response" asserts `not.toContain('"a"')`. The class's own docstring says the opposite ("`fields` are for the response details and logs"). The spec needs the keys in the 409. Also, `http-exception.filter.ts:185-191` forwards `fields` only for `VALIDATION_FAILED`, and no task names that filter change. T-11's Consumers is "none", so this test is a trap that T-11 would have to undo without the spec saying so.
  >    * **Violated Rule:** `design.md` § 6 (line 132): "409 `ASSESSMENT_CORE_UNCOMMENTED` (`fields` = keys)". `requirements.md` FR-15 (line 315): "else 409 `ASSESSMENT_CORE_UNCOMMENTED` with the field keys". `tasks.md` T-11 (line 278): "`ASSESSMENT_CORE_UNCOMMENTED` with keys".
  >    * **Remediation Suggestion:** Delete the "outside the response" test, or turn it into a test that the response body carries the keys (`{ ...errorBody('ASSESSMENT_CORE_UNCOMMENTED'), fields }`). Make the docstring match the behavior. If the keys are not carried in T-6, write a forward pointer for T-11 in `execution.md`: the filter must forward `fields` for this code, and `http-exception.filter.ts` plus its spec become T-11 consumers.

  The same Reviewer judged two items correct:
  - Leaving `IDEMPOTENCY_REPLAY_READER` unbound is right. `tasks.md:251` gives "the comment replay reader" to T-10.
  - The `admin-config/AGENTS.md` edit was necessary and is accurate.
- **Runtime events:** none.

**Leader adjudication:** the FAIL is in scope, because the test is part of the T-6 diff. I chose the narrow remediation:

- delete the test;
- correct the docstring;
- leave `http-exception.filter.ts` alone, since forwarding the field keys is T-11's work;
- record the forward pointer below.

Two items were added as `[advisory-grade]`: a strict per-module lookup in the module spec, and a JSDoc reflow.

**Attempt 2 — PASS**

- **Files changed:**
  - `common/error-codes.spec.ts`: the "outside the response" test is deleted;
  - `assessment/assessment.errors.ts`: the docstring now says the keys are carried for the 409 details, and that the filter forwards them from T-11;
  - `assessment/assessment.module.spec.ts`: `moduleRef.select(AssessmentModule).get(token, { strict: true })` for all six bindings; only `MYSQL_POOL` and `DRIZZLE` are overridden;
  - `admin-config/field-config/field-config.module.ts`: JSDoc reflow.

  `http-exception.filter.ts` is untouched.
- **Implementer verification:**
  - lint and build clean;
  - unit: `Test Files 77 passed | 1 skipped (78)`, `Tests 3266 passed | 6 skipped (3272)`;
  - openapi e2e: 15 passed.
- **Falsifiers (observed red, then restored):**
  1. `ADMIN_CONFIG_CLOCK` binding deleted: `Nest could not find Symbol(ADMIN_CONFIG_CLOCK) element (this provider does not exist in the current context)`.
  2. `IDEMPOTENCY_CLOCK` binding deleted: `Nest can't resolve dependencies of the DrizzleIdempotencyStore (Symbol(DRIZZLE), ?, Symbol(IDEMPOTENCY_TOKEN_FACTORY)) … AssessmentModule`.
  3. `IngestionModule` imported: `expected [ [Function DrizzleModule], …(5) ] to not include [Function IngestionModule]`.
  4. `FIELD_CATALOG_SOURCE` export removed: `Nest can't resolve dependencies of the Probe (?, AuthorizationService) … Symbol(FIELD_CATALOG_SOURCE)` and `expected [ Symbol(FIELD_CONFIG_EFFECTIVE) ] to deeply equal [ Array(2) ]`.
- **Evidence re-run (Leader inline):** lint, build, unit and openapi e2e give the same counts. **VERIFIED.**
- **Reviewer verdict: PASS.** The attempt-1 finding is resolved. There are 8 codes with the § 6 statuses (404, 403, 409×5, 403), and every error is built with `errorBody(code)` (P-18). There is no `IngestionModule` (DD-1, P-24). `AuthorizationService` comes through `UsersModule`. The Disqualifier does not apply (only connection overrides).
- **Runtime events:** none.

**Forward pointer → T-11 (recorded 2026-11-11; copy it into the T-11 brief):** `AssessmentCoreUncommentedError` carries `fields`, the uncommented core keys. `http-exception.filter.ts:185-191` forwards `fields` only for `VALIDATION_FAILED`. T-11 must make the filter forward `fields` for `ASSESSMENT_CORE_UNCOMMENTED`, as required by design § 6 (line 132), FR-15 (line 315) and `tasks.md` T-11 (line 278). That makes `server/src/common/http-exception.filter.ts` and its spec T-11 consumers. A test should also pin `new AssessmentCoreUncommentedError(['general.title']).fields` equal to the input (Reviewer advisory). Today no test covers the keys, because the attempt-1 test was deleted.

**Forward pointer → T-10 (recorded 2026-11-11):** `IDEMPOTENCY_REPLAY_READER` is not bound in `AssessmentModule`. T-10 binds it together with the comment service (`tasks.md:251`).

**Decisions made:**

- The 8 error messages are the implementer's wording, because the design gives only codes and statuses. The Reviewer checked them: they leak no data, and `ASSESSMENT_NOT_FOUND` does not reveal whether the result exists.
- DD-1's "imports `UsersModule` and `FieldConfigModule` only" is read as "no other feature module". `DrizzleModule`, `DynamoDbModule` and `ConfigModule.forFeature` are infrastructure, as in `FieldConfigModule`.

**Issues encountered:** none beyond the attempt-1 FAIL.

**ADVISORY (4R, recorded only):**

- READABILITY (spec drift): `design.md:89` says "9 ASSESSMENT_* codes", while § 6 and T-6 say 8. The code follows 8. Fix the document in T-15.
- RISK: the T-15 module guide should say that DD-1's "only" covers feature modules, so it is not read literally.
- READABILITY: the Probe test reads `Reflect.getMetadata('imports', AssessmentModule)`, which depends on static `imports`. It needs a one-line comment if the module ever moves to dynamic imports.

**Spawns:**

| Role | Calls | Tokens | Ended |
|---|---|---|---|
| implementer (attempt 1) | 42 | 114,959 | complete |
| reviewer (attempt 1) | 19 | 65,709 | fail |
| implementer (attempt 2) | 19 | 85,907 | complete |
| reviewer (attempt 2) | 6 | 45,171 | complete (PASS) |

**Running totals:**

| Measure | Actual | Budget |
|---|---|---|
| Tasks | 5 of 21 | 21 |
| Production LOC | ≈ 1,535 TS + 141 SQL | 4,800 |
| Review rounds | 8 | 26 |

Within budget.

### T-7: Worklist store and service (scope, filters, status, sort, cursor, counters) — PASS

| | |
|---|---|
| Date | 2026-11-11 |
| Final status | PASS (attempt 2 of 2) |
| Requirements covered | FR-1 (scope, revoked grant, admin sees all, role with no active row), FR-3 (default official; active cycle only), FR-4 (Auto-validated hidden incl. counters; search by title), FR-5, FR-6, FR-7, FR-19 (predicate), NFR-1 (statement count) |
| Skills | nestjs-expert, api-design-principles, tdd (as task) |
| Effort | default in attempt 1; `high` in attempt 2 (rework bump) |
| Review mode | full, single Reviewer (scope-leak lens) |

**Attempt 1 — FAIL**

- **Files changed** (under `server/`):
  - new: `src/assessment/worklist.store.ts` (port, `DrizzleWorklistStore`, `scopeCondition`), `worklist-cursor.ts`, `worklist.service.ts`, `worklist.service.spec.ts`, `worklist.store.spec.ts`, `test/support/in-memory-assessment.ts` (counts statements);
  - edited: `src/assessment/assessment.module.ts` (binds `WORKLIST_STORE`, `TIMELINE_LOADS` → existing `DrizzleTimelineLoads`, `WorklistService`), `assessment.module.spec.ts` (strict lookup of the three).
- **Observed red** (stub service, real fake and spec): `Tests 35 failed | 2 passed (37)`, e.g. `AssertionError: expected [] to deeply equal [ 1, 4 ]` (Admin sees all), `expected [] to have a length of 120 but got +0` (Sort by Science Program). The two stub passes were strengthened (a `100% done` title for the `%` escape) or are covered by falsifier 1.
- **Falsifiers (observed red, then restored):**
  1. per-row comment count: `AssertionError: expected 34 to be less than or equal to 8` (NFR-1 test).
  2. counters without the Auto-validated hiding: `- "total": 10, + "total": 13,`.
  3. `changedFields` returned: `expected '{"rows":[{"membershipId":34,…' not to contain 'general.title'`, plus the documented-columns test (extra key `changedFields`).
- **Statement count:** 4 at 30 rows and 4 at 1,000 rows (timeline join, load probe, page, counters).
- **Disqualifier respected:** 120 rows over 5 programs named Mango, Zebra, Apple, Quince, Berry (not in id order), paged at 25; 12 sort × direction combinations each page every row once.
- **Implementer verification:** lint and build clean; `Test Files 79 passed | 1 skipped (80)`, `Tests 3315 passed | 6 skipped (3321)`.
- **Evidence re-run (Leader inline):** same counts. **VERIFIED.**
- **Reviewer verdict: FAIL** (verbatim, condensed to the issue):
  > **Discovered Issue:** `InMemoryWorklistStore.findTimelines` (`server/test/support/in-memory-assessment.ts:123-147`) returns every timeline whatever its cycle. `FakeTimeline.cycleId` is accepted but never filtered, so the fake's scope is looser than the Drizzle SQL, which inner-joins `cycles.status = 'active'` (`worklist.store.ts:252-255`). On top of that, the adapter's `findTimelines` SQL has no assertion. Two FR-1 and FR-3 rules therefore have no test that would fail: active cycle only; removed assignment (`isNull(timelineUsers.removedAt)`).
  > **Violated Rule:** `requirements.md:83`, `:135`, `:93`; `tasks.md:176-177`, `:186`; `design.md:177`.
  > **Remediation Suggestion:** give the fake a cycle status and filter on it; a service test for a non-active cycle (admin and assessor); a `buildTimelinesQuery` builder with `toSQL()` assertions on the cycles join and the `removed_at` condition inside the `timeline_users` join.

  The Reviewer accepted the ten choices the spec left open (below) except the missing `findTimelines` SQL assertion, which is the issue above.

**Attempt 2 — PASS**

- **Files changed:** `worklist.store.ts` (public `buildTimelinesQuery(userId, timelineId?)`; same SQL), `test/support/in-memory-assessment.ts` (`FakeTimeline.cycleStatus`, default `'active'`, filtered; header documents that `DrizzleTimelineLoads` also counts a running load with a live lease), `worklist.service.spec.ts` (`it.each(['draft','closed'])` for admin and assessor), `worklist.store.spec.ts` (3 `findTimelines` SQL tests; an exclusion-branch `not in (?, ?)` test, Reviewer advisory).
- **Observed red** (new tests against attempt-1 code): `Tests 5 failed | 50 passed (55)`, `AssertionError: expected [ 1, 2 ] to deeply equal [ 1 ]`, `TypeError: store.buildTimelinesQuery is not a function` (×3).
- **Falsifiers (observed red, then restored):** cycles join removed → `expected 'select …' to contain 'inner join `cycles` on'`; status condition removed → `… to contain '`cycles`.`status` = ?'`; `removed_at` removed → `… to contain '`timeline_users`.`removed_at` is null'`; the fake's cycle filter removed → `expected [ 1, 2 ] to deeply equal [ 1 ]` (2 failed); `notInArray` removed → the exclusion test red.
- **Implementer verification:** lint and build clean; `Test Files 79 passed | 1 skipped (80)`, `Tests 3321 passed | 6 skipped (3327)`.
- **Evidence re-run (Leader inline):** same counts. **VERIFIED.**
- **Reviewer verdict: PASS** (targeted re-review plus regression check). Issue 1 is resolved; the verdicts on the other choices stand.
- **Runtime events:** none.

**Decisions made (spec silent; Reviewer judged each acceptable):**

- Cursor is base64url JSON `{s, d, v, c, i}`: `i` (membership id) is added to design's `{s,d,v,c}` because an admin can hold one result code in two rounds. Validated like `users-query.repository.ts`; any failure → `VALIDATION_FAILED` on `cursor`, including another sort or direction.
- Page size default 25, bounds 1–100 in the service (`limit`); tiebreak result code then membership id, ascending.
- Counters are one grouped statement over the scope, ignoring other filters, with the page's `hideAutoValidated`; they include `total` (FR-4 "the total says 10", `requirements.md:150`).
- Service result adds `noActiveRole` (FR-1) and `nextCursor` (→ `meta.page` in T-8).
- 404 `TIMELINES_NOT_FOUND` when the timeline is not in the active cycle, or a non-admin has no active `timeline_users` row; assigned with no live grant → empty 200 with `noActiveRole: true`.
- Comment count is a correlated scalar subquery (still one statement). Program and result-type sorts use `FIELD(…)` over the catalog order; `answered` sorts as the constant 0.
- With no status filter, `COALESCE(statusCase,'') <> 'auto_validated'`: a row with no status rule stays visible with `status: null`.
- FR-19 lift only when the programs step is open, a reviewer row covers the membership and the user authored a `clarification_requested` comment (matches T-3 `listedFor`).

**Gaps and forward pointers:**

- Nothing ran against a live MySQL; the adapter is pinned by `toSQL()` text and behavior by the fake. NFR-1's p95 of 500 ms at 1,000 rows (comment subquery in SELECT, ORDER BY and keyset WHERE) is to be checked at T-16 HITL on dev.
- **→ T-8:** state in the OpenAPI model that `timelines()` `roles` can include `'ADMIN'` (design § 6 example shows `['ASSESSOR']`); decide whether `counters.total` is exposed (FR-4 needs it).

**Running totals:**

| Measure | Actual | Budget |
|---|---|---|
| Tasks | 6 of 21 | 21 |
| Production LOC | ≈ 2,552 TS + 141 SQL | 4,800 |
| Review rounds | 10 | 26 |

Within budget.

### T-8: Worklist routes — PASS

| | |
|---|---|
| Date | 2026-11-11 |
| Final status | PASS (attempt 1, with an evidence follow-up) |
| Requirements covered | FR-1 (out-of-scope timeline → 404), FR-3 (*BUT* unassigned `?timeline` → 404 `TIMELINES_NOT_FOUND`), FR-4 (filter options inside the scope; counters total), FR-7 (limit 1–100, default 25), FR-22 |
| Skills | nestjs-expert, api-design-principles (as task) |
| Effort | default |
| Review mode | checklist, single Reviewer |

- **Routes** (`@ReadAccess()`): `GET /api/v1/worklist/timelines`, `GET /api/v1/timelines/:timelineId/worklist`, `GET /api/v1/timelines/:timelineId/worklist/options`.
- **Files changed** (under `server/`):
  - new: `src/assessment/worklist.controller.ts`, `dto/worklist-params.ts`, `dto/worklist.query.ts`, `models/worklist.model.ts`, `test/assessment-worklist.e2e-spec.ts` (33 tests, HTTP only), `test/support/assessment-app.ts` (real `AppModule`; only stores, loads probe, clock, catalog sources and JWKS are overridden);
  - edited: `assessment.module.ts` (controller), `worklist.service.ts` (new `options()`; the timeline lookup and 404 moved to a private `offered()`), `worklist.service.spec.ts` (7 `options()` tests).
- **Observed red** (before the controller): `Tests 33 failed (33)`, e.g. `- "code": "TIMELINES_NOT_FOUND", + "code": "NOT_FOUND",` and `AssertionError: /api/v1/worklist/timelines: expected undefined to be defined`.
- **Falsifiers (observed red, then restored):**
  1. empty 200 instead of the 404: `AssertionError: expected 200 to be 404` in 3 tests (`Tests 3 failed | 30 passed (33)`).
  2. `options()` exclusion subtraction removed: `AssertionError: expected [ 1, 2, 3, 4, 5 ] to deeply equal [ 1, 3, 5 ]` (the "all" scope test; for a list scope the exclusion is already applied by `resolveAccess` in `scope.ts`, so that test stays green by design).
- **Evidence correction:** the Implementer's first report claimed 2 `options()` unit tests, but none was on disk. The shell had refused the compound command that appended them. The Reviewer flagged it and the Leader confirmed it (`git status`, `grep -c options` = 0, unit count unchanged at 3321). The follow-up added the 7 tests above and the falsifier 2 red.
- **Implementer verification (after the follow-up):** lint and build clean; unit `Test Files 79 passed | 1 skipped (80)`, `Tests 3328 passed | 6 skipped (3334)`; focused e2e `Tests 48 passed (48)`.
- **Evidence re-run (Leader inline, after the follow-up):** lint and build clean; unit `Tests 3328 passed | 6 skipped (3334)`; full e2e `Test Files 17 passed (17)`, `Tests 1001 passed (1001)`. **VERIFIED.**
- **Reviewer verdict: PASS.** Routes match design § 6 rows 1–3. 401 on all three routes. The 404 is byte-equal for unassigned and missing timelines. `meta.page.nextCursor` is null on the last page. No email or changed-field keys appear (`assessedBy` is `{id, nickname}`). The Disqualifier does not apply (the guards, pipe, filter, interceptor and controller are real). `options()` was read for scope leak (exclusions, revoked grant, disabled role, removed assignment, non-active cycle) and none was found. The Reviewer's advisories (missing `options()` tests; the `writable` description for an admin holding an assessor row) were both applied in the follow-up, which changes only tests and one model description.
- **Runtime events:** the shell refused a compound append command without the Implementer noticing (see the evidence correction above).

**Decisions made (spec silent; Reviewer judged each acceptable):**

- `WorklistService.options()` was added outside the listed scope, because the route is in design § 6:127 and no service answered it. It needs no SQL: it builds the programs (scope minus exclusions; all for ADMIN), the result types (granted keys, or all) and the 8 statuses. A caller with no active role gets empty lists.
- `data` adds `noActiveRole` (FR-1, `requirements.md:109`) to design § 6's `{rows, counters, writable}`. `counters.total` is exposed (FR-4).
- The page object passes through `Paged<T>` with one documented cast; `common/` is untouched.
- Query: `status`, `programId` and `resultTypeKey` accept CSV or repeated values, capped at 50. `limit` is validated 1–100 in the DTO as well as in the service. An unknown parameter is a 400 `UNKNOWN_FIELD`.
- The OpenAPI `roles` description says an admin carries `'ADMIN'`.

**Forward pointer → T-15:** record `noActiveRole`, `counters.total`, `'ADMIN'` in `roles`, and the options shape (`{key,label}` and `{id,code,name}`) in `front-contract.md`, since they go beyond design § 6:126. Also add the new suite to the `test/AGENTS.md` suite table.

**Running totals:**

| Measure | Actual | Budget |
|---|---|---|
| Tasks | 7 of 21 | 21 |
| Production LOC | ≈ 3,120 TS + 141 SQL | 4,800 |
| Review rounds | 11 | 26 |

Within budget, but the LOC tripwire is close: 65 % of the lines are spent at 33 % of the tasks.

### T-13: Title backfill — PASS

| | |
|---|---|
| Date | 2026-11-11 |
| Final status | PASS (attempt 2 of 2) |
| Requirements covered | FR-24 (earlier memberships get their title without manual SQL), DD-9 |
| Skills | nestjs-expert, aws-serverless (as task) |
| Effort | default in attempt 1; `high` in attempt 2 (rework bump) |
| Review mode | checklist, single Reviewer |

**Attempt 1 — FAIL**

- **Files changed** (under `server/`):
  - new: `src/assessment/title-backfill.ts` (the `TitleBackfill` bootstrap hook and `DrizzleTitleBackfillStore` behind `TITLE_BACKFILL_STORE`), `title-backfill.spec.ts`;
  - edited: `assessment.module.ts`; `ingestion/load-rules.ts` (exports `titleOf` and `TITLE_MAX_CHARACTERS`, moved verbatim from `load-runner.ts`); `ingestion/load-runner.ts` (imports them); `vitest.config.e2e.ts` (`TITLE_BACKFILL_DISABLED`).
- **Observed red:** `Error: Cannot find module './title-backfill.js'` (`Tests no tests`). This is the predicted greenfield red; the falsifier supplies the behavioral red.
- **Falsifier:** dropping `isNull(title)` from the update turned the deferred fixture red (`AssertionError: expected 'Title of 1077' to be 'Written meanwhile'`) and the SQL test red (`Received: "update `timeline_results` set `title` = ? where `timeline_results`.`id` = ?"`). The fake applies the guard only when the real adapter's `toSQL()` contains it; the Reviewer judged this coupling sound, not tautological.
- **Implementer verification:** unit `Tests 3340 passed | 6 skipped (3346)`; e2e `Tests 1001 passed (1001)`.
- **Evidence re-run (Leader inline):** same counts. **VERIFIED.**
- **Reviewer verdict: FAIL** (verbatim):
  > **Discovered Issue:** `title-backfill.ts:105` reads `process.env.TITLE_BACKFILL_DISABLED` inside a Nest provider. No other provider under `src/` outside `src/config/` reads `process.env`.
  > **Violated Rule:** `server/AGENTS.md:77` ("Inside the app, read env only through `src/config/`"). Also `server/src/config/AGENTS.md:3` and `:41`.
  > **Remediation Suggestion:** remove the env check; (a) preferred: a `test/support/` helper that overrides `TITLE_BACKFILL_STORE` in each `Test.createTestingModule` loading `AppModule`; (b) a typed `src/config` flag (scope extension).

  The Reviewer judged the `titleOf` move behavior-preserving and acceptable, although the task lists no consumers.

**Leader adjudication:** remediation (a). The scope was extended to `test/support/**`, the e2e specs that build `AppModule`, and `test/perf/idempotency-overhead.measure.ts`, for the override only. Two advisories were added: stop the backfill on shutdown, and a direct `titleOf` test with the marker moved.

**Attempt 2 — PASS**

- **Files changed:**
  - new: `test/support/without-title-backfill.ts` (`withoutTitleBackfill(builder)` and `emptyTitleBackfillStore`);
  - the helper applied at 15 `createTestingModule` sites: 4 `test/support/*-app.ts`, 10 e2e specs, `test/perf/idempotency-overhead.measure.ts`;
  - `title-backfill.ts`: the env read removed; a `stopRequested` flag checked per row and per page; `beforeApplicationShutdown()` sets it and awaits the run (it runs before `DrizzleModule`'s `onApplicationShutdown` → `pool.end()`);
  - `load-rules.ts`: `TITLE_MAX_CHARACTERS` below the `@akili-spec` marker; `load-rules.spec.ts`: a direct `titleOf` describe;
  - `vitest.config.e2e.ts` restored.
- **Reds (observed, then restored):**
  1. helper override removed: `AssertionError: expected DrizzleTitleBackfillStore{ db: {} } to be { …(2) }` (2 failed);
  2. stop-flag checks removed: `expected [ … ] to have a length of 5 but got 120` and `… length of 50 but got 120` (2 failed);
  3. `isNull(title)` removed: the deferred fixture, the update SQL and the page SQL tests red (3 failed).
- **Negative control:** without the helper, 13 `assessment_title_backfill` log lines appeared in 2 e2e files; with it, 0.
- **Implementer verification:** lint and build clean; unit `Test Files 80 passed | 1 skipped (81)`, `Tests 3354 passed | 6 skipped (3360)`; e2e `Test Files 17 passed (17)`, `Tests 1001 passed (1001)`.
- **Evidence re-run (Leader inline):** same counts; `grep -c assessment_title_backfill` on the full e2e output = 0; no `process.env` under `src/assessment/`. **VERIFIED.**
- **Reviewer verdict: PASS.** Issue 1 is resolved. The override is at all 15 sites, and the only other `app.init()` in `src` (`idempotency.interceptor.spec.ts:918`) loads neither module. Each stop check has its own test, and the shutdown is proven to wait for the run.
- **Runtime events:** none.

**Decisions made:**

- Paging uses an id cursor (`id > ? ORDER BY id LIMIT 50`), not an offset; a page shorter than 50 ends the run.
- `UPDATE … SET title = ? WHERE id = ? AND title IS NULL`; a row counts as titled only when `affectedRows > 0`. With several app instances, the losing writer is a no-op.
- Logging: one line `{event:'assessment_title_backfill', scanned, titled, missing}` on success; on failure, the error class name only (no message, title, host or personal data).
- **Accepted deviation from DD-9 ("reads at most one snapshot per untitled row once"):** rows whose Reporting title is not a string, and rows whose snapshot is missing, stay null and are re-read on every bootstrap (one snapshot get per row). This costs reads and never changes data. Accepted by the Leader on 2026-11-11 and reported to the back lead; revisit if the count of such rows grows.

**Forward pointers:**

- **→ T-15:** add a line to `test/AGENTS.md` (near `:40`): every builder that loads `AppModule` and calls `init()` must wrap it in `withoutTitleBackfill`. Also list `test/support/without-title-backfill.ts` and the `assessment-worklist` suite there.
- **→ T-16 (HITL on dev):** `setTitleIfNull`'s `affectedRows` path and the page query are pinned only by `toSQL()`; check them against MySQL.

**Running totals:**

| Measure | Actual | Budget |
|---|---|---|
| Tasks | 8 of 21 | 21 |
| Production LOC | ≈ 3,300 TS + 141 SQL | 4,800 |
| Review rounds | 13 | 26 |

Within budget. The LOC tripwire is close: 69 % of the lines are spent at 38 % of the tasks.

### T-1: Settle the open-question defaults (gate) — PASS

| | |
|---|---|
| Date | 2026-11-11 |
| Final status | PASS (no code; skip-eligible review) |
| Requirements covered | every `[OQ-n default]` row, DD-15 |
| Authority | The back lead (Juanda) delegated the decisions to the Leader on 2026-11-11: "Toma las decisiones tu y dejalo documentado en la US". Each OQ below was decided and recorded individually, with its own line, so this is not a bulk "yes". Business (Angel) has not answered yet and can override any line |
| Record | Jira comment on P2-3910 (id 44785, all nine OQs) and on P2-3909 (id 44786, OQ-3, OQ-4, OQ-5), both 2026-11-11 |

Every decision takes the spec default (`proposal.md` § 12), so no spec amendment is needed.

| OQ | Decision | Who and when | Gates |
|---|---|---|---|
| OQ-1 | Release sent right after the end commits (Finish or automatic Quality Assessed), not at step 1 close | Leader, delegated by the back lead, 2026-11-11 · P2-3910 comment 44785 | T-12 |
| OQ-2 | Automatic Quality Assessed in the same transaction as the last green core field (AC16); zero core fields → Finish ends it as Quality Assessed | same · P2-3910 comment 44785 | T-11 |
| OQ-3 | Action Area column hidden until a source is agreed | same · P2-3909 comment 44786 | (applied in T-7/T-8) |
| OQ-4 | Export comments button hidden until P2-3914 | same · P2-3909 comment 44786 | (client) |
| OQ-5 | States and the worklist predicate modeled now; the answer action moves to P2-3911 | same · P2-3910 comment 44785, P2-3909 comment 44786 | T-10 |
| OQ-6 | One finish wins; "Assessed by" is that person | same · P2-3910 comment 44785 | — |
| OQ-7 | ToC group = `toc.*` + `contributors.science_programs`, a virtual "Theory of Change" section at its first field's catalog position, always complete; Hidden → View only | same · P2-3910 comment 44785 | T-9 (ToC rule) |
| OQ-8 | Withdraw while the program has not answered and step 1 or step 2 is open | same · P2-3910 comment 44785 | T-10 |
| OQ-9 | Every grey core field needs a non-withdrawn comment before Finish, else 409 `ASSESSMENT_CORE_UNCOMMENTED` with the keys | same · P2-3910 comment 44785 | T-11 |

**Rule for the blocked tasks:** the briefs for T-9, T-10, T-11 and T-12 cite their OQ line above. If Angel later answers differently, run the Correction Closure sweep (spec amendment) before the affected task is built or reworked.

**Risk accepted:** OQ-1 and OQ-2 change what the program sees (an immediate `not_qaed` lets the program edit in Reporting before step 2; automatic QA locks the result before non-core comments). They were decided without the business owner, on the back lead's delegation.

### T-9: Assessment view (read) — PASS

| | |
|---|---|
| Date | 2026-11-11 |
| Final status | PASS (attempt 2 of 2, plus a small follow-up) |
| Requirements covered | FR-1 (*Out-of-scope result by URL* → 404), FR-2 (writable flag, read-only reason, admin read-only), FR-8, FR-9 (incl. *BUT* Hidden absent from the body), FR-11 (labels or ids), NFR-2 |
| OQ gate | OQ-7, `execution.md` T-1 entry (ToC group, Hidden → View only) |
| Skills | nestjs-expert, aws-serverless (as task) |
| Effort | default in attempt 1; `high` in attempt 2 (rework bump) |
| Review mode | full, single Reviewer |

- **Route:** `GET /timelines/:timelineId/results/:resultCode/assessment?round=` (round honored for ADMIN only; default latest).
- **Files** (under `server/`):
  - new: `src/assessment/assessment-view.ts` (pure), `assessment.store.ts`, `assessment.service.ts`, `assessment.controller.ts`, `dto/assessment-params.ts`, `models/assessment.model.ts`, specs `assessment-view.spec.ts`, `assessment.service.spec.ts`, `assessment.store.spec.ts`, `test/assessment-view.e2e-spec.ts`, `test/support/real-load-writer.ts` (runs the real `LoadRunner`, so every `sk` is the writer's own `SNAP#` key);
  - edited: `assessment.module.ts`, `test/support/assessment-app.ts`, `test/support/in-memory-assessment.ts`;
  - edited outside the module (attempt 2): `admin-config/field-config/field-config.module.ts` (port gains `versionItems(versionId, resultTypeKey)`), `field-config.service.ts` + spec, `field-config-catalog.ts` + spec (`CatalogField.controlLists`), `admin-config/AGENTS.md` (`:44`, `:53`).

**Attempt 1 — FAIL**

- **Red run:** produced after the code existed, by moving the implementation files aside (`Cannot find module './assessment-view.js'` …). Process deviation, recorded; attempt 2 observed its reds before the fixes.
- **Falsifiers:** `snapshot_sk` without `snapshotKeyOf` → `Error: assessment_snapshot_missing` (12 red); Hidden not filtered in the service → `expected { key: 'general.description', … } to be undefined` and the e2e body test red; 403 for out of scope → `expected 403 to be 404`.
- **Evidence re-run (Leader inline):** unit `Tests 3388 passed | 6 skipped (3394)`, e2e `Tests 1016 passed (1016)`. **VERIFIED.**
- **Reviewer verdict: FAIL** (verbatim, condensed to the four issues):
  > 1. Production `effectiveFor` runs 5 statements, not 3 … So a real open runs 8 statements without an assessment row and **10 with one**. The "exactly 8" assertions pass only because the fake is looser than production. (requirements.md:418; tasks.md:224; design.md:187) — read the items of the **pinned** version in one statement.
  > 2. Labels are looked up by field key (`assessment-view.ts:129`). Reporting keys them by control list (`results-feed.port.ts:45-48`) … In production every field would get `labels: null`. The tests build labels keyed by field key, so they reproduce the bug. (FR-8, FR-11, FR-20; design.md:245)
  > 3. `DrizzleAssessmentStore` has no `toSQL()` spec … `eq(timelineId)` (`scopeCondition` carries no timeline, so dropping it leaks across timelines) … T-7 failed on this same defect. (requirements.md:92, :115, :430; design.md:188)
  > 4. `other` never looks at the configuration … a key configured Hidden in the pinned version but missing from the current catalog … is returned under `other`. (FR-9 *BUT*; design.md:192)

  The Leader confirmed issue 2 against `results-feed.port.ts` and issue 1 against `design.md:187` before the rework.

**Attempt 2 — PASS**

- **Red run (before the fixes):** 15 failed | 68 passed across 4 spec files, e.g. `expected 10 to be 6`, `expected { '7': 'SP07' } to be null`, `TypeError: store.buildValidationsQuery is not a function`, `expected [ 'removed.hidden', …(3) ] to deeply equal [ 'removed.other_type', …(2) ]`.
- **Fixes:** `findMembership` joins `field_config_versions` on (`cycle_id`, `number`) and returns the pinned version id; with a row the service reads `versionItems` (1 statement); labels are filtered by the field's `controlLists`; 11 `toSQL()` store tests; `other` keys whose item is `hidden` are dropped. Advisories: `TimelineNotFoundError` from `effectiveFor` → the same 404; e2e asserts no `@`; the service spec's `add` runs the real `LoadRunner`.
- **Statement count:** 6 with an assessment row, 8 without (asserted exactly in the service spec and the e2e; the fake counts 5 for `effectiveFor`, like production).
- **Falsifiers (observed red, then restored):** (a) `effectiveFor` on the with-row path → `expected 10 to be 6`; (b) labels by field key → 6 unit + 1 e2e red; (c) `eq(timelineId)` dropped → `expected ' where (…' to contain '`timeline_results`.`timeline_id` = ?'` (4 red); (c2) round applied to non-admins → red; (d) hidden `other` kept → view and raw-body e2e red; (e) the three original falsifiers still red.
- **Reviewer verdict: PASS** (full re-review). No regressions.
- **Follow-up (Leader request after the PASS, from a Reviewer risk advisory):** a `null` or absent `control_list` is now "no list" instead of 503, because `shapeCatalog` also feeds `LoadRunner` and the field-config screens; real shape errors stay 503. Red first: `UpstreamUnavailableError: The service is temporarily unavailable…` (`Tests 1 failed | 32 passed (33)`). `admin-config/AGENTS.md` updated.
- **Evidence re-run (Leader inline, final tree):** lint and build clean; unit `Test Files 83 passed | 1 skipped (84)`, `Tests 3412 passed | 6 skipped (3418)`; e2e `Test Files 18 passed (18)`, `Tests 1019 passed (1019)`. **VERIFIED.**
- **Runtime events:** none.

**Consumers (the task listed none; actual):** the `FieldConfigEffective` port (`versionItems`, additive) and `CatalogField.controlLists` / `shapeCatalog`, consumed by `field-config.service.ts:254`, `:653`, `load-runner.ts:238`, `:580` and the view. All suites green.

**Decisions made:**

- The ToC section sits just before the catalog section holding its first field; that section is not split. A ToC field configured Assessed stays Assessed; only Hidden or unclassified becomes View only.
- An ended membership stays readable (scope without the worklist's ended filter; FR-2).
- A pinned version number with no version row → 409 `ASSESSMENT_NO_FIELD_CONFIG` (no fallback to `effectiveFor`). With a row, the type-in-timeline check is skipped.
- `FieldConfigCatalogMissingError` (Reporting has no catalog for the year) → 409 `ASSESSMENT_NO_FIELD_CONFIG`; an unreadable catalog → 503. FR-8 names 503 for "cannot be read"; a missing year is treated as a configuration gap.
- A missing snapshot → 500, logged by id only.
- The read-only reason adds `finished` when status ≠ `pending` (FR-16); the worklist row does not.
- The header title is shown even when `general.title` is configured Hidden (FR-8 requires a title).
- `other` fields and Not applicable fields carry `labels: null`.
- Withdrawn comments are returned to the assessor with their state.

**Forward pointers:**

- **→ P2-3911 / step-2 SP view:** filter withdrawn comments (FR-13).
- **→ T-16 HITL:** check the TEST and PROD catalogs for `control_list` shapes; nothing here ran against MySQL.

**Running totals:**

| Measure | Actual | Budget |
|---|---|---|
| Tasks | 10 of 21 | 21 |
| Production LOC | ≈ 4,620 TS + 141 SQL | 4,800 |
| Review rounds | 15 | 26 |

**Budget tripwire hit:** production LOC is at 96 % of the budget with 11 tasks left (T-10, T-11, T-12, T-14, T-15 and the client T-17 to T-21). The overrun is certain; reported to the back lead before T-10.

### Budget re-estimate — 2026-11-11

The back lead chose "continue and re-estimate" after the T-9 tripwire.

| Measure | Original (design § 10) | Re-estimated | Basis |
|---|---|---|---|
| Production LOC | ≈ 4,800 | ≈ 11,000 | ≈ 4,620 spent at 10 of 21 tasks. Remaining estimates: T-10 ≈ 1,200, T-11 ≈ 800, T-12 ≈ 800, T-14/T-15 ≈ 200 (mostly tests and docs), client T-17 to T-20 ≈ 3,000, plus about 5 % margin |
| Review rounds | ≈ 26 | ≈ 34 | 15 rounds over 10 tasks (1.5 per task) × 11 remaining tasks ≈ 17, rounded and adjusted for doc and HITL tasks |

**Why the overrun:** the original figure did not count OpenAPI models, DTOs and SQL builders exposed for `toSQL()` tests. Those layers made up about a third of T-7 to T-9.

**No scope was cut.** The new tripwire is 90 % of the re-estimate, about 9,900 LOC or 31 rounds.
