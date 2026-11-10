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
