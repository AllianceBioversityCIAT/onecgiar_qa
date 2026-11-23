# Round 2: Lead Assessor (P2-3912) — Execution Log

## Document Control

| Field | Value |
|---|---|
| Spec path | `docs/specs/escalation/round-2` |
| Branch | `feat/P2-3912-lead-assessor-round-2` (from `origin/staging-center` `3750182`) |
| Approval | Spec approved as written by the back lead, 2026-11-19 ("Si"); every OQ takes its default |
| Approval Mode | gated for T-1; **pre-approved from T-2 to T-12** (back lead, 2026-11-19, "SI" to: "pasar a modo pre-aprobado desde T-2 hasta T-12 … me detengo siempre ante un HALT, un Pivot, que se pase el presupuesto, un FATAL_FAIL o cualquier acción destructiva … No hago push ni merge sin preguntarte"). Routine continue gates auto-pass and are logged `auto-approved (pre-approved mode)` |
| Leader | Claude Opus 5.5 (session). Implementer / Reviewer through the `.claude/agents/akili-*` wrappers |
| Scope rule | T-13 is Yeck's and is not started here. No Slack, Jira or email messages; drafts only |
| Persona drift (pending item for `staging`) | `akili doctor --agents` (v2.37.2), 2026-11-19: leader `primary-instructions`, `test-harness`; reviewer `audit-checklist`; tester `prove-behavior` OUTDATED. Not fixed on this spec branch (shared-file write discipline) |

## Task Execution History

### T-1: Record the gate decisions — PASS (2026-11-19)

- **Attempts:** 3 (author: Leader inline, docs-only — the task records the gate the Leader ran; Reviewer independent, `akili-reviewer` wrapper).
- **Attempt 1** — files: `docs/specs/escalation/round-2/requirements.md` (§ 1 status, § 9 Answer column), `docs/specs/escalation/round-2/design.md` (§ 1 status), `docs/qa-context.md` (step 3, step 4 wording, export line). Reviewer **FAIL**: (1) `qa-context.md:15` "No final step either." still carried the old Lead claim; (2) `qa-context.md:59` glossary still defined "Highlighted" with no source; (3) `design.md` P-19 still `UNVERIFIED` and waiting for the gate. RE-RUN: VERIFIED.
- **Attempt 2** — fixed (1)–(3); took advisories (step-3 wording separates "field turns green" from "comment closes when the review ends"; OQ-1/2/7 answers add "Angel to ratify"). Reviewer **FAIL**: Premise Ledger count line read "Verified: 16" for 21 rows with 2 UNVERIFIED. RE-RUN: VERIFIED.
- **Attempt 3** — count line "Verified: 19 · UNVERIFIED: 2 (High 0, Low 2)"; `qa-context.md:18` footer credits steps 1, 2, 4, 5 to Santi and says step 3 is sourced inline. Reviewer **PASS**. RE-RUN: VERIFIED (header + 8 OQ answers; "highlight" only as replaced wording; 21 rows / 2 UNVERIFIED / 19 verified).
- **spawns:** reviewer ×3 — 45,981 / 40,081 tokens, 10 / 9 tool calls, ended complete; third run not reported by host.
- **Requirements covered:** requirements § 9 (OQ-1 … OQ-8), P-19.
- **Decisions made:** every OQ takes its default (back lead "Si", 2026-11-19); no FR/DD amendment needed. Execute-time spec edits: `requirements.md` § 1 and § 9; `design.md` § 1 and § 11 (P-19, count line) — carried as named conformance checks into T-2's Reviewer brief.
- **ADVISORY (not acted on):** `qa-context.md:15` keeps the old TPB choice names beside P2-3916's; settle the vocabulary when TPB is built.
- **Running totals vs budget:** tasks 1/14 · LOC ~0 code (docs only) · review rounds 3/~16.

### T-2: Round 2 never returns (regression test first) — PASS (2026-11-19)

- **Attempts:** 1. Effort medium. Skills: tdd, nestjs-best-practices.
- **Files changed:** `server/src/assessment/round-two-rules.ts` (new), `server/src/assessment/round-two-rules.spec.ts` (new).
- **Red run (assertion-level):** pass-through stub → `pnpm exec vitest run src/assessment/round-two-rules.spec.ts` 4 failed / 6 passed: "expected 'returned' to deeply equal 'escalated'"; "expected { error: 'core_uncommented', … } to deeply equal { error: 'core_undecided', … }"; "never returns `returned` … expected [ 'returned', … ] to not include 'returned'". Baseline P-4 probe: `endOnFinish(…, false)` → `"returned"`.
- **Falsifier:** `if (outcome === 'returned') return outcome as never;` → 2 failed (FR-11 Escalated, FR-13 never returns); reverted.
- **Implementer verification:** lint ok · build ok · unit 3920 passed / 6 skipped (115 files) · e2e 1261 passed (33 files) · client build ok (pre-existing initial-bundle budget warning, not caused here).
- **Evidence re-run (Leader inline, non-author):** round-two-rules + assessment-rules specs 26/26 · build ok · lint clean → **VERIFIED**.
- **Reviewer:** **PASS** — mapping matches design § 7 / DD-5; `assessment-rules.ts` untouched; spec exercises the mapping only.
- **ADVISORY:** (readability) note in the module doc that the round-1 flag is never passed; (reliability) cross-reference DD-5 reuse in `endOnFinish`'s doc; (risk) green + escalate on one field is read as green — the T-7 rule "validating an escalated field is refused" and T-9 tests must keep that state unreachable (forward pointer to T-7 / T-9 briefs).
- **Not Done / Assumptions (assumptions only, no owed item):** type names `RoundTwoCoreFact`, `effectiveGreen`, `escalated`, `CoreUndecided` chosen by the Implementer.
- **spawns:** implementer 8 calls, 83,334 tokens, ended complete; reviewer not reported by host.
- **Requirements covered:** FR-13 (Regression), FR-11 (Undecided, rule level), FR-12 (rule level).
- **Running totals vs budget:** tasks 2/14 · LOC ~140 · review rounds 4/~16.
- auto-approved (pre-approved mode)

### T-3: Migration `0013_round_two` — PASS (2026-11-19)

- **Attempts:** 1. Effort high. Skills: nestjs-best-practices. Review mode: parallel lens reviewers (migration / data-loss surface) — (A) SQL + rollback risk/reliability, (B) TS schema + scope + consumers.
- **Files changed:** schema `result-assessments.ts`, `assessment-comments.ts`, `assessment-audit-events.ts`, `comment-events.ts` (header), `index.ts`, new `comment-decisions.ts`; `server/drizzle/0013_round_two.sql`, `meta/0013_snapshot.json`, `meta/_journal.json`, `rollback/0013_round_two.down.sql`; tests `schema.spec.ts`, `assessment.write-store.spec.ts`; `assessment.service.ts:117` (type widening, see below).
- **P-20 re-check:** after `git fetch`, `origin/staging-center` and `origin/dev` both end at `0012_ai_usage_indicative.sql` → `0013` free.
- **Red run (assertion-level):** schema.spec before any schema change: 8 failed, e.g. "expected [ 'pending', 'quality_assessed', …(1) ] to deeply equal [ … (2) ] - \"escalated\""; audit actions; "expected undefined to be 'datetime'" (deleted_at); 5 on `comment_decisions` and the 0013 SQL file.
- **Falsifier:** remove `'lead_sided_program'` from `commentStates` → "Tests 1 failed | 228 passed"; restored.
- **Implementer verification:** lint ok · build ok · unit 3928 passed / 6 skipped · e2e 1261 passed · client build ok.
- **Evidence re-run (Leader inline):** schema.spec + write-store.spec + comment-transitions.spec 279/279 · build ok → **VERIFIED**.
- **Reviewers:** (A) **PASS** — every § 5 row present, enums appended, names ≤ 64, journal/snapshot chain consistent, rollback follows the 0011 exemplar, safe on populated MySQL 8. (B) **PASS** — the two out-of-scope edits (service type widening; write-store SQL text) are necessary consequences of the build gate; API model left to T-9; no exhaustive reader broken.
- **ADVISORY:** (A-risk) the down script drops data before the enum narrowing, the step most likely to fail — reorder (narrow first) or run carefully; checked in T-14. (A-risk) CHECK/FK on `assessment_comments` copies the table — apply in a quiet window, time it in T-14. (A-reliability) `comment_decisions.updated_at` has no ON UPDATE: the T-7 upsert sets it explicitly (forward pointer to T-7). (B-readability) `write-store.spec.ts` withdraw test reformatted (formatter noise); `schema.spec.ts` casts `schema.commentDecisions` defensively. (B-risk) narrowing the audit enum fails once new audit rows exist (append-only) — T-14 note.
- **Decisions made / execute-time spec edits:** `design.md` § 11 P-13 corrected (premise partly refuted: the types are read widely and hand-typed copies exist; Impact Low, If-false acted on); `tasks.md` T-9 Consumers gains `EndStatus` and `AssessmentSummaryModel.status`. Carried as named conformance checks into T-4's Reviewer brief.
- **Not Done / Assumptions (no owed item):** service type widened at `:117`; API model, `EndStatus`, client `AssessmentStatus` left to T-9 / T-13; FKs named by hand; Implementer wrote a log under `/tmp/claude-501/` (outside the repo).
- **spawns:** implementer 24 calls, 108,118 tokens, ended complete; reviewer A 16 calls, 50,296 tokens; reviewer B 15 calls, 78,425 tokens.
- **Requirements covered:** FR-8/FR-9 (storage), FR-10 (columns), FR-11 (`escalated`), DD-6, NFR-5 (down script; apply in T-14).
- **Running totals vs budget:** tasks 3/14 · LOC ~140 code + ~420 schema/SQL/tests (excluding generated snapshot) · review rounds 6/~16.
- auto-approved (pre-approved mode)

### T-4: Enable the Lead row, current step, status `pending_tpb_review` — PASS (2026-11-19)

- **Attempts:** 1 (+1 continuation). Effort high. Skills: nestjs-expert, tdd.
- **Files changed:** `server/src/assessment/role-steps.ts` (LEAD enabled; `currentStepPositionsOf`, `currentStepPosition`), `qa-status.ts` (rule `pending_tpb_review`), `worklist.store.ts` (`currentStepSql`, `roundTwoStepPositions`), `assessment.store.ts` (membership join on the current step; record carries `stepPosition`), `assessment.service.ts` (`assessmentStep` removed; ADMIN gets the membership's current step; write `held` check by step position), `worklist.service.ts` (same spread; `FINISHED_STATUSES` + `pending_tpb_review`), `sp-view/sp-view.service.ts`, `sp-view/sp-response.service.ts` (`roundTwoStepPositions: []`, build-forced, SP stays round 1), `test/support/in-memory-assessment.ts` (`currentAssessment` twin), `test/support/assessment-app.ts` (synthetic `lead` user), specs `role-steps`, `scope`, `qa-status`, `worklist.service`, `assessment.store`, `worklist.store`, new `test/assessment-round-two-scope.e2e-spec.ts`.
- **Red run (assertion-level):** qa-status "expected null to be 'pending_tpb_review'"; role-steps "expected [ 'ASSESSOR' ] to deeply equal [ 'ASSESSOR', 'LEAD_ASSESSOR' ]"; worklist.service "expected [] to deeply equal [ 'pending_tpb_review' ]". The e2e was written after the code; its red was taken by disabling the LEAD row → 6/8 failed ("expected 404 to be 200"). Counter continuation: "expected { pending: 1, finished: 1, total: 3 } to deeply equal { pending: 1, finished: 2, total: 3 }".
- **Falsifier:** `currentStepPosition` forced to the assessors step → "expected [ 'pending' ] to deeply equal [ 'pending_tpb_review' ]" (unit) and FR-14 e2e red; counters: value removed from `FINISHED_STATUSES` → same two reds. Restored.
- **Implementer verification:** lint clean · build ok · unit 3949 passed / 6 skipped · e2e 1269 passed (34 files) · client build ok.
- **Evidence re-run (Leader inline):** 6 touched unit specs 207/207; new e2e 8/8; build ok; after the continuation worklist.service.spec 53/53 and e2e 8/8 → **VERIFIED**.
- **Reviewer:** **PASS** (attempt) and **PASS** (continuation delta) — TS `currentStepPosition` and SQL `currentStepSql` agree on every branch; one status table; round-1 statuses unchanged; scope 404 bodies byte-equal; LEAD pins flipped legitimately (disabled-row cases moved to TPB).
- **continuations:** 1 (FR-14 finished counter, after the back lead's amendment).
- **ADVISORY:** do **not** merge T-4 alone — with the Lead row on, a Lead finish runs the round-1 end path until T-5/T-9 land (merge only after T-9); FR-2 comment in the e2e says "another result" but opens the same code; rename the stale "LEAD whose row is not enabled yet" test (`ai-suggestions-rules.spec.ts:62`); Prettier-only rewraps; the front contract must say `pending_tpb_review` counts as finished (forward pointer to T-12).
- **Not Done / Assumptions (no owed item):** `readOnlyReason` keeps `step_upcoming` / `step_closed` (FR-1 clarified); Lead writes in an open step run the round-1 write path until T-5; e2e Lead grant on `policy_change` (seed config); `assessment.store.ts` `buildEnsureAssessment` left un-Prettier-formatted.
- **Decisions made / execute-time spec edits:** `requirements.md` FR-1 AND IT MUST clarified (existing `step_upcoming` / `step_closed`); `requirements.md` FR-14 amended by the back lead ("Si", 2026-11-19): Pending for TPB review counts as finished. Both carried as named checks into T-5's Reviewer brief.
- **spawns:** implementer 77 + 5 calls, ~236,508 tokens, ended complete; reviewer 21 calls, 94,111 tokens + delta (not reported).
- **Requirements covered:** FR-1, FR-2, FR-14, FR-16.
- **Running totals vs budget:** tasks 4/14 · LOC ~140 + ~420 + ~1,100 (T-4, tests ≈ 70 %) ≈ 1,660 of ~2,380 · review rounds 8/~16.
- auto-approved (pre-approved mode)

### T-5: Core-only writes in round 2 and the new error codes — PASS (2026-11-19)

- **Attempts:** 1. Effort medium. Skills: nestjs-best-practices, error-handling-patterns.
- **Files changed:** `server/src/common/error-codes.ts` (5 codes, 409), `common/http-exception.filter.ts` (forwards `fields` for `ASSESSMENT_CORE_UNDECIDED`), `common/api-response.ts` (doc), `assessment/assessment.errors.ts` (5 classes), `assessment/round-two-rules.ts` (`isActionable`), `assessment/assessment.service.ts` (round-2 guard in validate/comment; Check all on core in round 2; `assessedOf` core via `isActionable`), `assessment/assessment.controller.ts` (OpenAPI 409), tests: new `assessment-round-two-writes.service.spec.ts`, `assessment.errors.spec.ts`, `http-exception.filter.spec.ts`, `error-codes.spec.ts`, `round-two-rules.spec.ts`, `test/openapi.e2e-spec.ts`.
- **Red run (assertion-level):** 4/11 failed — "Error: expected a refusal" (non-core validate, mixed, non-core comment returned 200); Check all wrote 12 Assessed fields instead of the 4 core.
- **Falsifier:** `isActionable` without the core check → "Tests 4 failed | 7 passed"; reverted.
- **Implementer verification:** lint 0/0 · build ok · unit 3976 passed / 6 skipped (116 files) · e2e 1269 passed · client build ok.
- **Evidence re-run (Leader inline):** 5 touched specs 245/245 · build ok → **VERIFIED**.
- **Reviewer:** **PASS** — FR-3 and the codes half of FR-17 met; round 1 unchanged; every refusal asserts no row of any kind.
- **Open gap until T-12 (Reviewer-accepted deferral):** the `assessment/AGENTS.md` codes/contract grep differs by 5 codes (`ASSESSMENT_FIELD_NOT_CORE`, `ASSESSMENT_FIELD_ESCALATED`, `ASSESSMENT_DECISION_INVALID`, `ASSESSMENT_CORE_UNDECIDED`, `ASSESSMENT_COMMENT_NOT_DELETABLE`) from the step-1 `front-contract.md` § 9. **T-12 must not close without that grep passing over both contracts; no merge before T-12** (forward pointer to T-12).
- **ADVISORY:** `assessment/AGENTS.md:23` "8 typed refusals" → 13 (T-12 guide update); message wording for `ASSESSMENT_FIELD_ESCALATED` ("change or clear the escalate decision first") and `ASSESSMENT_FIELD_NOT_CORE` (avoid "round 2"); nested ternary for the write target; no Hidden-key row in the round-2 400-before-409 test.
- **Not Done / Assumptions (no owed item):** round 2 = `membership.round !== 1`; 400 `VALIDATION_FAILED` before 409 for non-Assessed keys; mixed request refused whole; Check all with no core returns the empty summary; message wording by the Implementer; an accidental Prettier run on 12 unrelated files was reverted (`git checkout` to HEAD; tree was clean at `36c6a00`).
- **spawns:** implementer 31 calls, 145,702 tokens, ended complete; reviewer not reported.
- **Requirements covered:** FR-3 (rule; the view's `actionable` flag is T-6), FR-17 (codes).
- **Running totals vs budget:** tasks 5/14 · LOC ≈ 2,050 (T-5 ≈ 390 net) of ~2,380 · review rounds 9/~16.
- auto-approved (pre-approved mode)

### Budget checkpoint — after T-5 (2026-11-19)

- Actuals vs `3750182`: production 396 · unit specs 1,147 · e2e + support 436 · SQL 54 → ~2,030 of ~2,380; review rounds 9 of ~16. Projection ~5,500 / ~22.
- Stopped before T-6 (tripwire class, never auto-approved). Back lead answered "Si" to raising the budget to ~5,500 LOC and ~22 review rounds; `design.md` § 13 amended.

### T-6: Round-2 view: thread, `updated`, carried greens — PASS (2026-11-19)

- **Attempts:** 1. Effort high. Skills: nestjs-expert, tdd.
- **Files changed:** `server/src/assessment/round-two-rules.ts` (`effectiveGreen`, `isCarriedGreen`, `isDecidable`), `assessment-view.ts` (`annotateForRound`, `toThreadItems`; `buildAssessmentView` and the SP view untouched), `assessment.store.ts` (membership record + `previousMembershipId`, `changedFields`, `previousAssessmentId`; `findRoundOneThread` / `buildRoundOneThreadQuery`), `assessment.service.ts` (`open()` round-2 annotation; response `round`), `models/assessment.model.ts` (thread item and decision models; field members; `round`), `test/support/in-memory-assessment.ts`, specs `round-two-rules`, `assessment-view`, `assessment.store`, new `test/assessment-round-two-view.e2e-spec.ts` (20 tests).
- **Red run (assertion-level):** rules 5 failed ("expected [] to deeply equal [ 'agree_program', 'escalate' ]"); view 10 failed (one was a fixture bug, fixed) ("expected [] to deeply equal [ { commentId: 11, … } ]"); e2e 16 failed ("expected undefined to be 2", "expected [] to deeply equal [ 'general.primary_program' ]"). FR-6 AI read was green before any change (pin: T-4 enabled the row). Store-spec and OpenAPI assertions written after the code.
- **Falsifier:** per-comment re-read loop → "expected 40 to be 11"; reverted.
- **Statement counts:** round-2 view 10 for N = 1 and N = 30 (thread 1 + round-1 validations 1); new round-2 membership 8; round 1 unchanged (8 / 6 pins).
- **Implementer verification:** lint 0 · build ok · unit 4028 passed / 6 skipped · e2e 1289 passed (35 files) · client build ok.
- **Evidence re-run (Leader inline):** 3 unit specs 102/102; round-two-view + assessment-view + openapi e2e 56/56; build ok → **VERIFIED**.
- **Reviewer:** **PASS** — one SELECT thread with withdrawn/deleted filters and no responder email; latest response by `MAX(id)`; DD-4 exact; round-1 and SP views unchanged; TS and OpenAPI consistent.
- **ADVISORY:** (1) DD-4 text said "one extra column" — impossible for an uncommented field; amended (below). (2) add `step_position = 1` to the previous-assessment join to make the invariant structural. (3) `decidable` ignores `writable`: the front must gate decision controls on `writable && decidable` — **forward pointer to T-12 (front contract)**. (4) ordering by response id stands in for time. (5) `responder_name` is NOT NULL in `schema/sp-comment-responses.ts` — confirmed, no action. (6) the in-memory fake filters withdrawn by state, the adapter by `withdrawn_at`.
- **Not Done / Assumptions (no owed item):** no step filter on the previous-assessment join; 2 constant extra statements; "no round-1 comment" = no non-withdrawn, non-deleted thread row; threads/carried only on actionable fields, `updated` on any field; extra `valueTruncated` and decision `{ decision, body, decidedAt }`; `assessment.store.ts` pre-existing Prettier noise left as is.
- **Decisions made / execute-time spec edits:** `design.md` DD-4 consequence amended (thread + round-1 validations = 2 statements, constant in N) — carried as a named check into T-7's Reviewer brief.
- **spawns:** implementer 82 calls, 285,904 tokens, ended complete; reviewer not reported.
- **Requirements covered:** FR-3 (`actionable`), FR-4, FR-5, FR-6, FR-7 (view), NFR-1.
- **Running totals vs budget (raised):** tasks 6/14 · LOC ≈ 4,200 of ~5,500 · review rounds 10/~22.
- auto-approved (pre-approved mode)

### Budget checkpoint — after T-6 (2026-11-19)

- Actuals vs `3750182`: ~4,070 LOC (production ~700, the rest tests); projection ~8,000 against the raised ~5,500. The Leader's earlier projection was wrong.
- Options put to the back lead: (1) raise to ~8,000 / ~26 rounds; (2) keep ~5,500 and lean the remaining tests (one shared round-2 e2e fixture, HTTP path only; edges in unit specs). Leader recommended (2). Back lead answered "Si"; read as acceptance of the recommendation (2) and said so to the back lead. `design.md` § 13 records the test strategy.

### T-7: Decisions (`PUT` / `DELETE …/decisions/:commentId`) — PASS (2026-11-19)

- **Attempts:** 2. Effort high → xhigh (attempt 2). Skills: nestjs-expert, tdd, api-design-principles.
- **Attempt 1** — files: `assessment.service.ts` (`decide`, `clearDecision`, round-2 `validateAt` over effective greens, `applyEnd` round-2 `quality_assessed` branch: one `qaed` release, agree → `lead_sided_program` with `comment_events`, audit, no `markCommentsVisible`), `assessment.store.ts` (`lockDecisionTarget`, `findDecisions`, `upsertDecision` with explicit `updated_at`, `deleteDecision`, `setCommentState`, `findLiveCommentedFieldKeys`), `assessment.controller.ts`, `models/assessment.model.ts` (`DecisionResultModel`), `dto/decide-comment.body.ts`, `dto/assessment-params.ts`, `assessment-log.ts` (`decide`, `decision_clear`), tests `assessment-decisions.service.spec.ts` (43), `assessment.write-store.spec.ts` (+7 SQL pins), `test/assessment-round-two-decisions.e2e-spec.ts` (13), shared `test/support/round-two-fixture.ts` (view e2e switched, no `expect` changed), `test/support/in-memory-assessment.ts`. Red (pass-through stub): unit 37/42, e2e 6/13 behavioral ("FR-12 Last agree … expected { status: 'pending' … } to match object { status: 'quality_assessed' … }", "expected 200 to be 409"). Falsifier: decidable check off → 7 unit refusals missing, e2e "expected 200 to be 409". Verification: lint 0 · build · unit 4077 · e2e 1302 · client ok. Re-run VERIFIED (65/65, 51/51). Reviewer **FAIL**: Lead state moves written outside the transition table (ADR-006; design § 4 `comment-transitions.ts` row).
- **Attempt 2** — `comment-transitions.ts` (actor `lead`; 3 reachable `→ lead_sided_program`; 3 declared, not reachable `→ escalated`), `applyLeadDecisions` gated by `isTransitionAllowed` (skip, no update/event), `comment-transitions.spec.ts` (26 reachable), ADR-006 test. Red: 5 failed ("allows disagreed -> lead_sided_program by lead: expected false to be true"; "length of 26 but got 23"). Falsifier: drop the disagreed row → 5 failed incl. FR-12. Verification: lint · build · unit 4092 / 6 skipped · e2e 1302 · client ok. Re-run (Leader): 99/99, build ok → **VERIFIED**. Reviewer **PASS** (skip over throw accepted: a throw would block the end).
- **ADVISORY:** log a `lead_move_skipped` line (ids only); Check all refused whole once a field is escalated → **front contract (T-12)**; a no-op round-2 un-grey can create an empty pending row; fixture cache keeps a rejected load promise; deleted comment carrying an agree — decide in T-9/T-10; formatting-only churn in `assessment.store.ts`.
- **Forward pointers to T-9 (copied into its brief):** route `escalate → escalated` through the transition table (flip the 3 rows to reachable); rework the decide-vs-finish race test to assert both orders and error codes; validations PUT returns `effectiveValidated` (assigned to T-9 in `tasks.md`); `EndStatus` / `AssessmentSummaryModel` include `escalated`.
- **Decisions made / execute-time spec edits:** `tasks.md` T-9 scope gains "validations PUT carries `effectiveValidated`" (design § 6 row had no owner). Leader narrowing: `applyEnd` round-2 `quality_assessed` branch built in T-7 (FR-12), `escalated` in T-9.
- **Not Done / Assumptions (no owed item):** `findCommentedFieldKeys` unchanged (SQL pinned), `findLiveCommentedFieldKeys` added; own round-2 comment as target → 404 until T-8; non-Lead 404, ADMIN 403; `all:true` refused whole if any core escalated; escalate on a green field greys it and clears agrees there; Finish still stored-only until T-9.
- **spawns:** implementer 76 + 6 calls, ~348,291 tokens, ended complete; reviewer 24 calls, 121,355 tokens + re-audit (not reported).
- **Requirements covered:** FR-7 (validate interplay), FR-8, FR-12 (last agree), NFR-3 (lock order; race sharpened in T-9).
- auto-approved (pre-approved mode)

### Budget tripwire — after T-7 (2026-11-19)

- Tripped: ≈ 6,530 LOC (production 1,925 · unit 2,785 · e2e 1,770 · SQL 54) against ~5,500; review rounds 12 / ~22. Cause: production also above the estimate (store, controller, DTOs, OpenAPI models, transition table, in-memory adapter); 43 unit cases in T-7.
- Options: (1) raise to ~9,500; (2) split into two PRs; (3) stop. Back lead chose **1** ("1"). `design.md` § 13 amended. Not auto-approved.

### T-8: Lead's own comment and its escalation; withdraw in step 3 — PASS (2026-11-19)

- **Attempts:** 1. Effort medium. Skills: nestjs-best-practices, tdd.
- **Files changed:** `server/src/assessment/assessment.service.ts` (`decideAt` accepts the Lead's own comment of this assessment; `withdrawAt` passes the round to the window checks and clears a Lead decision with a `decision_clear` audit inside the withdraw transaction), `role-steps.ts` (`isWithdrawWindowOpen(timing, round = 1)`: step 3 opens it for round 2), `assessment.store.ts` (`DecisionTarget.authorId`), `test/support/in-memory-assessment.ts`, specs `assessment-decisions.service.spec.ts` (FR-9, 8 tests), `role-steps.spec.ts`, e2e `test/assessment-round-two-decisions.e2e-spec.ts` (new round-2 result).
- **Red run (assertion-level):** escalate own → `AssessmentNotFoundError`; agree own → "expected { status: 404 … } to match object { status: 409 … }"; withdraw in step 3 → `AssessmentStepClosedError` (5 failed | 3 passed). A setup failure (snapshot missing) was not counted. The e2e was written after the code.
- **Falsifier:** own-comment branch of `isDecidable` returns both choices → unit refusal red; e2e "expected 200 to be 409"; reverted.
- **Implementer verification:** lint · build · unit 4101 / 6 skipped · e2e 1303 · client ok.
- **Evidence re-run (Leader inline):** decisions + role-steps specs 85/85; decisions e2e 14/14; build ok → **VERIFIED**.
- **Reviewer:** **PASS** — own comment = same assessment and author; escalate only; withdraw transaction atomic; round-1 window unchanged; `isWithdrawWindowOpen` consumers all accounted for (`assessment.service.ts:1464`, `:1473` pass the round).
- **ADVISORY:** the OQ-8 "withdraw after the end" rule now also covers round-2 comments — **forward pointer to T-9: refuse a round-2 withdraw on a non-pending assessment, with a test, and narrow the comment at `assessment.service.ts:1499` to round 1**; decision clear on withdraw keys on `LEAD_ASSESSOR` (revisit for TPB/PPU); comment the `held === null` early path; the front needs to see the Lead's decision on their own comment — **front contract (T-12)**.
- **Not Done / Assumptions (no owed item):** decision cleared on withdraw only while pending; 404 with no previous assessment and no round-2 row; service spec writes the Lead comment into the fake world (route covered by e2e).
- **spawns:** implementer 27 calls, 140,787 tokens, ended complete; reviewer not reported.
- **Requirements covered:** FR-9.
- **Running totals vs budget (~9,500):** tasks 8/14 · LOC ≈ 6,950 · review rounds 13/~22.
- auto-approved (pre-approved mode)

### T-9: Finish review and the round-2 end — PASS (2026-11-19)

- **Attempts:** 1. Effort high. Skills: nestjs-expert, tdd. Review mode: parallel lens reviewers (release / data surface) — (A) end rule, release, state machine; (B) freeze, contract, consumers, round 1.
- **Files changed:** `server/src/assessment/assessment.service.ts` (round-2 `finishAt` via `endRoundTwoOnFinish` over effective greens and live escalate decisions; `applyEnd` `escalated` branch — no release, decisions through the transition table with `comment_events`, no visibility, audit `end_escalated`; round-2 withdraw refused after the end, OQ-8 narrowed to round 1; `EndStatus` + `escalated`; validations PUT returns `effectiveValidated` in round 2; `isLiveDecision` / `escalatedFieldKeys` exclude withdrawn and deleted comments), `assessment.store.ts` + fake (`DecisionRecord.commentDeleted`), `comment-transitions.ts` + spec (3 `lead → escalated` rows reachable; 29 reachable), `models/assessment.model.ts` (`escalated` status; optional `effectiveValidated`), `assessment.controller.ts` (OpenAPI), `test/openapi.e2e-spec.ts`, new `assessment-round-two-end.service.spec.ts` (16), new `test/assessment-round-two-end.e2e-spec.ts` (4), decide-vs-finish race reworked into both orders in `test/assessment-round-two-decisions.e2e-spec.ts`.
- **Red run (FR-13, against the T-8 service):** "expected { status: 200, body: { … "status": "returned" … } } to match object { status: 409, body: { … "ASSESSMENT_CORE_UNDECIDED" … } }"; 13/16 new service tests red before wiring (3 pin unchanged behaviour).
- **Falsifiers:** keep `insertRelease` on `escalated` → "expected [ { assessmentId: 1000, … } ] to deeply equal []" (3 unit, 2 e2e); old `endOnFinish` path → 11/16 red incl. FR-13. Reverted.
- **Implementer verification:** lint 0 · build · unit 4126 / 6 skipped · e2e 1308 (37 files) · client ok.
- **Evidence re-run (Leader inline):** 5 unit specs 208/208; 3 e2e 37/37; build ok → **VERIFIED**.
- **Reviewers:** (A) **PASS** — DD-5 mapping, no release on `escalated`, one winner, round 1 unchanged, own comment `open → escalated` through the table. (B) **PASS** — freeze complete for every existing write; `effectiveValidated` additive and round-2 only; OpenAPI and hand-typed copies updated.
- **ADVISORY:** `decide`'s agree guard still counts dead escalate decisions — **switch to `escalatedFieldKeys` in T-10**; a skipped Lead move has no signal (log line); real row-lock races → T-14; withdraw of an escalated own comment after the end answers `ASSESSMENT_COMMENT_NOT_OPEN` before `ASSESSMENT_FINISHED` — **front contract (T-12)**; `effectiveValidated` needs one HTTP assertion — **T-12 flow**; **T-10 must carry "delete after the end → 409 `ASSESSMENT_FINISHED`"**; rename `roundTwo` outcome variable; all new codes into the front contract (T-12).
- **Not Done / Assumptions (no owed item):** delete-after-end deferred to T-10 (route absent); `effectiveValidated` = sorted `{fieldKey, validated}` array over core fields, round 2 only; race tests model the lock via `beforeLockAssessment`.
- **spawns:** implementer 56 calls, 246,125 tokens, ended complete; reviewer A 20 calls, 83,314 tokens; reviewer B not reported.
- **Requirements covered:** FR-11, FR-12 (Finish), FR-13 (service), FR-15 (no visibility), NFR-3.
- auto-approved (pre-approved mode)

### T-10: Delete another reviewer's comment — PASS (2026-11-19)

- **Attempts:** 2. Effort medium → high. Skills: nestjs-best-practices, tdd.
- **Attempt 1** — files: `assessment.service.ts` (`deleteComment` / `deleteAt`; agree guard on `escalatedFieldKeys`), `assessment.controller.ts` (`POST assessment-comments/:commentId/delete`), `models/assessment.model.ts` (`AssessmentDeletedCommentModel`), `assessment-log.ts` (`delete`), `assessment.store.ts` (`deleteComment`, `buildDeleteComment` with `deleted_at IS NULL AND NOT EXISTS (sp response)`; deleted filters on `findComments`, `markCommentsVisible`, withdraw UPDATE), `worklist.store.ts` (counts skip deleted), SP view `sp-view.store.ts` (visible counts and list skip deleted; scope reports `deleted`), `sp-response.service.ts` (deleted → `SpNotFoundError`), `sp-response.unit-of-work.ts` (state UPDATE `deleted_at IS NULL`), pinned-SQL specs, fakes, new `assessment-delete.service.spec.ts` (21), new `test/assessment-round-two-delete.e2e-spec.ts` (3). Red (stub): "expected [ 7001, 7002 ] to deeply equal [ 7002 ]", "expected undefined to match object { id: 8001, deletedBy: 20 }", lock order "expected [] to deeply equal [ 'lockTimelineShared', … ]". Falsifier: drop the deleted filter in both thread reads → unit, e2e ("[7001, 7003] vs [7003]") and SQL pin red. Verification: unit 4148 · e2e 1311 · lint · build · client ok. Re-run VERIFIED (102/102, 14/14). Reviewer **FAIL**: e2e covered 1 of the 3 FR-10 refusals (`tasks.md` T-10 Tests).
- **Attempt 2** — e2e own-comment 409 and out-of-scope 404 (byte-equal to missing); FR-12 on delete: `deleteAt` runs `endRoundTwoAfterWrite` when the deleted round-1 comment makes a core field carried green (guarded: round-1 comment, core, no stored Lead validation, now carried green), release dispatched after commit; `stillAgreed` uses `isLiveDecision`. Red: "expected { id: 1000 … } to match object { status: 'quality_assessed' … } — status 'pending'". Verification: unit 4150 / 6 skipped · e2e 1313 · lint · build · client ok. Re-run (Leader): delete spec 23/23, delete e2e 5/5, build → **VERIFIED**. Reviewer **PASS** (narrow guard proven equivalent for FR-12).
- **SP privacy (FR-15 / AGENTS SP rules):** a deleted comment never reaches `/sp` lists or counts; an SP response cannot land on a deleted comment (conditional UPDATE); non-deleted SP behaviour unchanged.
- **ADVISORY:** delete response does not report an end — **front contract (T-12): re-read the view after a delete**; no assertion that `dispatchRelease` fires after a delete end; order the in-memory guard before the two reads; a non-Lead during step 3 gets 409 not 404 (Swagger text); `assessment/AGENTS.md:50` add "not deleted" (T-12 guide update); `findCommentedFieldKeys` left unchanged on purpose — round-1 end rules only, and a round-1 comment can only be deleted after its round-1 membership ended.
- **Decisions made:** the deletion is recorded as a `comment_events` row with to = from state (no state change) and audit `comment_delete`; it is not a transition-table row because the state does not move (deliberate reading of design § 4 "the delete event"). Withdrawn comments → 409 `ASSESSMENT_COMMENT_NOT_DELETABLE`.
- **spawns:** implementer 62 + 8 calls, ~238,583 tokens, ended complete; reviewer 24 calls, 100,286 tokens + re-audit.
- **Requirements covered:** FR-10, FR-11 BUT (delete after the end), FR-12 (delete path), FR-15 (SP never shows deleted).
- auto-approved (pre-approved mode)

## Pivot Record: T-11 (2026-11-19)

- **Blocker:** T-11 attempt 1 (tests only, `server/test/sp-view.e2e-spec.ts`, +119) — Reviewer **FAIL**: FR-15 requires the program to see its round-1 comments "with their round-1 states", but DD-7 writes `escalated` / `lead_sided_program` on the comment at the end and the SP read passes `state` through (`sp-view.store.ts:329`, `sp-thread.ts:137/166`). Spec tension FR-15 vs DD-7. Attempt-1 evidence: falsifier 1 as specified stayed green (structural round-1-only SP read, also true in Drizzle: `sp-view.service.ts:304-328`, `sp-view.store.ts:287,294`); stronger variant red ("expected '{"success":true,…' not to contain 'Xq7Lead-Comment-Marker-91f3'"); falsifier 2 red. Verification green; re-run 13/13 VERIFIED.
- **Alternatives put to the back lead:** (a) keep FR-15 — the SP read shows the program-side state; (b) amend FR-15 — the program may see the outcome state.
- **Decision (back lead, 2026-11-19):** (a). `design.md` DD-11 added; `tasks.md` T-11 scope amended to allow the SP-read change. No TRD ADR affected. Budget raised to ~10,200 LOC (back lead, same answer set).

### T-11: SP view and logs stay clean — PASS (2026-11-19)

- **Attempts:** 3 (attempt 2 after the Pivot Record above). Effort medium → high → xhigh. Skills: tdd.
- **Attempt 1** — `server/test/sp-view.e2e-spec.ts` (+119, tests only). Reviewer **FAIL**: FR-15 "with their round-1 states" broken by DD-7 (see Pivot Record: T-11). Re-run VERIFIED (13/13).
- **Attempt 2** — DD-11 built: new `sp-view/sp-state.ts` (`programSideState`, `REVIEW_STATES`, `STATE_OF_KIND` moved from `sp-response.service.ts`), `sp-thread.ts` (`toSpComments` maps the state), `sp-view.store.ts` (`programState()` SQL CASE for `answered` and `hasClarificationThread`), `test/support/in-memory-sp.ts`, `sp-state.spec.ts`, SQL pins, e2e. Red: "expected … to match object { comments: 2, answered: 2 } — answered 0". Falsifier: identity mapping → 1 e2e + 25/26 unit red. Re-run VERIFIED (55/55, 13/13). Reviewer **FAIL**: an answered clarification would read `clarification_requested` again after the Lead finishes (DD-11 table gap).
- **Attempt 3** — DD-11 completed by the Leader (answered `request_clarification` → `open`; design.md § 10, execute-time completion of the back lead's T-11 decision; **ratification by the back lead requested at this gate**); `programSideState(…, latestAnswered)`, `toSpComments` answered flag, SQL `EXISTS` on `comment_clarification_answers.response_id` = latest response id, fake mirror, JSDoc moved back, unit cases, SQL pin (fragment present twice), e2e comment 7004 (clarification answered → stays `open`; list and header status unchanged). Reds: unit "expected 'clarification_requested' to be 'open'"; e2e "expected 'clarification_requested' to be 'returned_to_program'". Falsifiers: ignore `latestAnswered` → same reds; drop the `EXISTS` → "expected [ Array(1) ] to have a length of 3 but got 1". Verification: unit 4177 / 6 skipped · e2e 1315 · lint · build · client ok. Re-run (Leader): SP unit 56/56, sp-view e2e 13/13, build → **VERIFIED**. Reviewer **PASS**.
- **ADVISORY:** stale e2e comments ("two comments remain", "same two comments"); assert 7004's text in the CSV; check the two correlated latest-response subqueries against indexes `sp_comment_responses(comment_id, id)` and `comment_clarification_answers(response_id)` in T-14.
- **Requirements covered:** FR-15, NFR-2.
- **spawns:** implementer 19 + 27 + 7 + 8 calls, ~160,956 tokens, ended complete; reviewer 18 + 6 + re-audit calls, ~74,223 tokens.
- **Running totals vs budget (~10,200):** tasks 11/14 (T-13 is Yeck's) · LOC ≈ 9,460 · review rounds 21/~22.
- auto-approved (pre-approved mode)

### T-12: Whole round 2 end to end, OpenAPI and the front contract — PASS (2026-11-19)

- **Attempts:** 1. Effort high. Skills: cognitive-doc-design, tdd.
- **Files changed:** new `server/test/assessment-round-two-flow.e2e-spec.ts` (2 flows over the shared fixture's real loader), new `docs/specs/escalation/round-2/front-contract.md`, `docs/specs/assessment/step-1-assessment/front-contract.md` § 9 (+5 codes, pointer), `server/src/assessment/AGENTS.md` (round-2 section; code count; SP window "not withdrawn and not deleted"). Jira close-out draft outside the repo (scratchpad), not sent.
- **Red run:** greenfield, green on first run (as predicted). **Falsifiers:** escalated end inserts a release → flow (a) "expected [ { assessmentId: 1000, … } ] to deeply equal []"; a code removed from a copy of the step-1 contract → grep diff "1d0 < ASSESSMENT_COMMENT_NOT_DELETABLE". Restored.
- **Implementer verification:** lint · build · unit 4177 / 6 skipped · e2e 1317 (39 files) · client ok.
- **Evidence re-run (Leader inline):** grep parity `assessment.errors.ts` vs step-1 contract → EQUAL (13 codes); flow + openapi e2e 20/20 → **VERIFIED**.
- **Reviewer:** **PASS** — every carried front-facing behaviour checked against the code; flows meet proposal § 13.
- **Leader doc precision edits after the PASS (task-owned docs, no behaviour):** contract § 4.1 (escalate on a green field greys it and drops agrees; clearing an agree greys only if no other live agree holds the field), § 4.5 (open own comment after the end: `ASSESSMENT_FINISHED` while step 3 is open, `ASSESSMENT_STEP_CLOSED` after); `assessment/AGENTS.md` code-count wording.
- **ADVISORY (open, not acted on):** the flow header cites FR-2 without asserting order (covered in the scope e2e); OpenAPI: `DecisionResultModel` inherits optional `effectiveValidated` it never sends; the withdraw route description (`assessment.controller.ts:291`) still names steps 1–2 only and not `ASSESSMENT_COMMENT_NOT_OPEN` — OpenAPI follow-up.
- **spawns:** implementer 42 calls, 172,500 tokens, ended complete; reviewer 43 calls, 99,596 tokens.
- **Requirements covered:** FR-17, FR-2 (via the reused view; asserted in the scope e2e), proposal § 13.
- **Running totals vs budget (~10,200):** back tasks done 12/12 · LOC ≈ 9,800 · review rounds 22/~22.
- auto-approved (pre-approved mode)

### T-14: API HITL on qatest — RUN, awaiting the back lead's PASS (2026-11-20)

- **Environment:** qatest API after the `dev` deploy of `0a4379f` (pipeline success). Own timeline only; timelines 34–37 untouched (read-only GETs of their scope and assignments).
- **`0013` applied:** indirect evidence only — the pipeline runs the migrate image before the container swap and succeeded; worklist and assessment view answer 200 on round-2 queries; the decision routes exist (admin write 403). No direct read of `__drizzle_migrations` (no DB access from this machine).
- **Rollback of `0013`: NOT tested on a real MySQL** (no Docker/MySQL here; never on qatest, it is shared). Back lead, 2026-11-20: resolve with a disposable server DB or a CI job **before** P2-3912 goes to `staging-center`.
- **DD-11 ratified** by the back lead, 2026-11-20 (an answered clarification shows `open` to the program; P2-3911 AC11).
- **Staging (ids only):** timeline 40 in cycle 34 (SP05, `policy_change`, 5 steps); pinned config v4 has one core assessed field, `general.title`. Results 10151, 10152, 10153 (Reporting test data, no personal data). Assignments 37 (Assessor, user 1050) and 38 (Lead, user 1053). Loads 22 (round 1, 3/3) and 23 (round 2, 3/3 resubmitted). Comments 11, 12, 14 (title, core) and 13 (result level, non-core). User 1053 got `LEAD_ASSESSOR` on `policy_change` only (Assessor and Lead on the same type is 409 `USERS_ROLE_CONFLICT`); restored to `ASSESSOR` all at the end.

| # | Step | Expected | Observed |
|---|---|---|---|
| 1 | Lead opens a result in round 1 | 404 (FR-1) | 404 |
| 2 | Round 1: 3 finishes with core comments | `returned`, one `not_qaed` release each | 3 × `returned`; 2 releases acknowledged at once, 10153's stayed `pending` (attempts 1) — see finding F-1 |
| 3 | Admin `POST /assessment-releases/retry` | the stuck row is sent | `attempted 1, sent 1, refused 0, stillPending 0`; Reporting unlocked 10153 |
| 4 | SP answers (step 2): 11 disagree, 12 disagree, 13 accept, 14 none | stored | stored (Reporting report) |
| 5 | Round-2 load (step 3) | 3 resubmitted, 0 skipped | load 23: 3/3 `resubmitted` |
| 6 | Lead view | core `actionable`, non-core not; round-1 thread with SP answer; `disagreed` and `open` decidable | as expected; `choices: [agree_program, escalate]` on 11, 12, 14 |
| 7 | 10151: escalate 11 | stays `pending` | `pending` |
| 8 | 10151: **5 parallel finishes** (real MySQL) | exactly one end | 1 × 200 `escalated`, 4 × 409 `ASSESSMENT_FINISHED` |
| 9 | 10151 after the end | `pending_tpb_review`, no release, comment `escalated` | as expected; release queue empty |
| 10 | 10152: `agree_program` on 12 (13 non-core accepted) | ends `quality_assessed` on the write; `qaed` release | `quality_assessed`; `qaed` queued and acknowledged < 4 s; comment 12 `lead_sided_program` |
| 11 | 10153: finish with the core field undecided | 409 `ASSESSMENT_CORE_UNDECIDED` with `fields` | 409, `fields: ["general.title"]` |
| 12 | 10153: Lead validates `general.title` | ends `quality_assessed`; `qaed` release | `quality_assessed`; release acknowledged; then a decision on 14 is 409 `ASSESSMENT_FINISHED` — see observation O-1 |

- **F-1 (pre-existing, P2-3910 `e013845`):** the release outbox has no periodic sweep. A row whose post-end dispatch fails stays `pending` until another end or an admin retry; with neither it stays forever and Reporting keeps the result locked. Not fixed here.
- **O-1 (needs a business call):** validating a core field directly ends the review while its round-1 comment has no decision. Comment 14 stays `open` on a `quality_assessed` result (FR-8 maps only decided comments; a plain validation is allowed). Options: accept as is, or treat a validation over an undecided round-1 comment as `agree_program`.
- **Index check (T-11 ADVISORY):** not run — no DB access; the SP read answered in normal time on 3 results, which proves nothing about scale.
- **Reporting-side notes (not QA):** Reporting let General information of a locked result be edited (reverted by its agent); the SP answers 11–13 carry the real identity of the session that made them.
- **Credentials:** tokens kept in a 600 file outside the repo, never printed; deleted at the end. Logout answered 403 (the route uses the session cookie), so the access tokens live until they expire (≤ 1 h).

### T-14: PASS (back lead, 2026-11-20)

- PASS with two items **pending before `staging-center`**: the direct check that `0013` is applied, and its rollback on a real MySQL (to settle with Cris). O-1 → T-15 (block). F-1 → separate bugfix spec `bugfix/release-sweep` on branch `fix/P2-3910-release-sweep` (round 1, not this branch).

### T-15: Lead cannot validate a core field whose round-1 comment is undecided (HITL O-1) — PASS (2026-11-20)

- **Attempts:** 2. Effort high → xhigh. Skills: tdd, nestjs-best-practices.
- **Spec amendment (Leader, back lead's decision "bloquear"):** FR-8 row *none (undecided)*, the "decided field" definition and the new scenario; design § 4 code; `front-contract.md` validations + codes; step-1 contract § 9 (14 codes). Back lead confirmed: with two round-1 comments on a core field, `agree_program` on one keeps the field grey until the other is decided.
- **Attempt 1** — new 409 `ASSESSMENT_CORE_COMMENT_UNDECIDED` with sorted `fields` (errors, registry, filter, OpenAPI, AGENTS); `undecidedCommentFields` (pure, on `isDecidable`); store `findLiveCommentStates` (not withdrawn, not deleted); guard in the round-2 validations PUT after the escalated check, whole request refused, nothing written; `agree_program` greens only when nothing on the field is undecided. 6 existing test setups changed to decide before validating (Leader checked each against HEAD: justified, assertions kept). Red/falsifier: guard removed → unit 6 failed ("expected a refusal"), e2e "expected 200 to be 409", falsifier log `200 quality_assessed [[7001,"open"],[7002,"open"]]` (the qatest outcome). Verification: unit 4189 / 6 skipped · e2e 1318 · lint · build · client ok. Re-run (Leader): decisions + common unit 510/510, decisions + openapi e2e 34/34, parity EQUAL → **VERIFIED**. Reviewer **FAIL**: clearing one of two agrees left the field green with the cleared comment undecided (pre-existing test asserted it) → O-1 by another route.
- **Attempt 2** — FR-8 "cleared" row amended (Leader): clearing an agree greys the field even if another agree remains; other decisions kept; re-deciding greens it. `stillAgreed` removed from the clear branch; test flipped; new test clear → finish 409 `ASSESSMENT_CORE_UNDECIDED` → re-agree → end. Red: "expected [ … validated: true … ] to deeply equal [ … validated: false … ]". Verification: unit 4190 / 6 skipped · e2e 1318 · lint · build · client ok. Re-run (Leader): decisions unit 62/62 → **VERIFIED**. Reviewer **PASS**.
- **ADVISORY (taken):** a field may end with an agree on one comment and an escalate on another — FR-8 note added (per-comment end states, the field counts as escalated). Open: the Drizzle query `buildLiveCommentStates` is only type-checked by the e2e (in-memory world) — re-run the O-1 path at the next qatest HITL.
- **Requirements covered:** FR-8 (undecided scenario, cleared row).

### T-16: The Lead's own round-2 comments carry their decision in the view — PASS (2026-11-20)

- **Attempts:** 2. Effort high → xhigh. Skills: tdd, nestjs-best-practices. Back lead's request for Yeck's front (T-13).
- **Attempt 1** — `OwnViewComment` with `decision`, `decidable`, `choices` on the Lead's own round-2 comments in `comments[]` (`withOwn` in `annotateForRound`); `isDecidable` own branch narrowed to state `open`; `findDecisions` on the read store; OpenAPI `AssessmentOwnCommentModel`; `front-contract.md` § 3.2. Red: 4 view + 1 rules cases (keys absent; escalated still offered). Falsifier: `decision: null` → e2e reload check red. Verification: unit 4196 / 6 skipped · e2e 1319 · lint · build · client ok. Re-run (Leader): view + rules + decisions unit 152/152, decisions + openapi + round-two-view e2e 55/55 → **VERIFIED**. Reviewer **FAIL**: an own comment still `open` at the end read `decidable: true, choices: ['escalate']` (card: `[]` after the end).
- **Attempt 2** — `RoundViewInput.ended`; after the end own comments read `decidable: false, choices: []`, decision kept; `thread[]` untouched. Advisories taken: `anyOf`, withdrawn-decision e2e, `findDecisions` only for the Lead inside the `Promise.all`, fake delegates. Red: "decidable: false expected, true received". Verification: unit 4197 / 6 skipped · e2e 1320 · lint · build · client ok. Re-run (Leader): view + rules unit 91/91, decisions + openapi e2e 36/36 → **VERIFIED**. Reviewer **PASS**.
- **Leader doc precision edit:** `front-contract.md` gating sentence scoped to round-1 `thread[]` items.
- **Open (not acted on):** `thread[]` can still read `decidable: true` after the end for an undecided round-1 comment on a field another comment escalated (pre-existing; the front gates on `writable && decidable`) — offered to the back lead as a small follow-up. `ended` reads the assessment status only, like the existing `finished` flag.
- **Also recorded:** the deletion history UI ("Deleted by … on …") is out of scope of P2-3912 → P2-3915 (`requirements.md` § 4), back lead 2026-11-20.
- **Requirements covered:** FR-9 (view), FR-2.

### T-17: thread[] items read not decidable once they can no longer be decided — PASS (2026-11-20)

- **Attempts:** 1 (with two Leader-directed extensions before review). Effort high. Skills: tdd. Back lead's request: the front looks at `decidable` only.
- **Changes:** `toThreadItems(..., ended, escalatedOn)`; `ended` = `!writable || finished` ("the view takes no decision": end of review, step closed, read-only), also for own comments (T-16 rule widened); before the end a round-1 item on a field where another live comment is escalated offers `['escalate']` only (mirrors 409 `ASSESSMENT_FIELD_ESCALATED`; own escalate does not count; clearing restores). View builder only; decide write path unchanged. `front-contract.md` (§ 3, gating sentence, § 3.2, checklist): gate on `decidable` alone. OpenAPI and AGENTS texts.
- **Red:** unit "expected [ { commentId: 7001, …(9) } ] to match object [ { commentId: 7001, …(2) } ]" (ended); unit 2 failed + e2e 1 failed (escalate filter). **Falsifiers:** ended check dropped → unit + e2e red; escalate filter dropped → unit 2 + e2e 1 red; after the review's advisory tests: `!writable` half dropped → closed-step e2e red; field-agnostic `escalatedOn` → per-field unit red.
- **Verification:** unit 4201 / 6 skipped · e2e 1323 · lint · build · client ok. Re-run (Leader): view + decisions unit 113/113, decisions + openapi e2e 38/38 → **VERIFIED**. Reviewer **PASS**.
- **ADVISORY taken:** closed-step e2e, per-field unit test, contract line on read-only views (Leader edit).
- **Requirements covered:** FR-8 (view side), FR-2.
