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
