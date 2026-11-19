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
