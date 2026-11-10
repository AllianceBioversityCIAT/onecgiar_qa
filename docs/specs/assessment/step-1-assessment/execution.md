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
