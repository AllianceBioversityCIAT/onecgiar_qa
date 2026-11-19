# Round 2: Lead Assessor (P2-3912) — Tasks

Tasks build **P2-3912 only**. TPB and PPU (design § 12) get their own tasks in their stories. No task starts before the back lead's OK on this spec (requirements § 1).

Every back task runs this verification before it closes (team rule from the brief: unit, e2e and both builds before each push):

```
cd server && pnpm lint && pnpm build && pnpm test --reporter=dot && pnpm test:e2e --reporter=dot
cd client && npm run build
```

## Dependency graph

```
T-1 (gate) → T-2 → T-3 → T-4 → T-5 → T-6 → T-7 → T-9 → T-12 → T-14
                               T-5 → T-8 → T-9
                               T-5 → T-10 ───────→ T-12
                               T-4 → T-11 ───────→ T-12
T-12 → T-13 (Yeck)
```

All back tasks touch `server/src/assessment/` (one shared boundary), so they run serially. T-3 alone touches `server/src/database/**`.

## T-1: Record the gate decisions

- **Status:** [x]
- **Size:** S
- **Depends on:** the back lead's OK on this spec
- **Requirements:** requirements § 9 (OQ-1 … OQ-8); P-19
- **Design refs:** § 11 (P-19)
- **Scope:**
  - Write each OQ answer into `requirements.md` § 9 with who and when.
  - If OQ-1 holds, correct `docs/qa-context.md` step 3 (Lead) to the ticket, with source and date. This is only possible on this branch because `qa-context.md` is a shared doc that travels in a branch (CLAUDE.md § 5).
  - Any answer that differs from a default → amend the affected FR/DD **before** T-2 (Correction Closure sweep).
- **Tests:** none.
- **Verification:**
  - `grep -n "Default\|Answer" docs/specs/escalation/round-2/requirements.md` shows an answer per OQ.
  - `grep -n "highlight" docs/qa-context.md` shows no claim that contradicts the decision.
- **Falsifier:** an OQ row left with only its default → the grep shows a row without "Answer".
- **Red run:** n/a (no test gate).
- **Disqualifier:** an answer written from this conversation without the back lead's words.
- **Consumers:** none (no shared symbol changed).
- **Review:** checklist — docs only.
- **Done when:** 8 answers recorded, and the amended FRs/DDs are swept.
- **Skills:** cognitive-doc-design

## T-2: Round 2 never returns (regression test first)

- **Status:** [x]
- **Size:** S
- **Depends on:** T-1
- **Requirements:**
  - FR-13 (Scenario: Regression; AND IT MUST red before the change).
  - FR-11 (Scenario: Undecided, at rule level).
  - FR-12 (end mapping, at rule level).
- **Design refs:** § 7 (round-2 rules), DD-5
- **Scope:**
  - New `server/src/assessment/round-two-rules.ts` with `endRoundTwoOnFinish` and `endRoundTwoAfterWrite`, mapping over `endOnFinish` / `endAfterValidation`.
  - `assessment-rules.ts` is not changed.
  - No service wiring yet.
- **Tests:** `round-two-rules.spec.ts`, a table test:
  - all green → `quality_assessed`;
  - grey with escalate → `escalated`;
  - grey without escalate → `core_undecided` with the keys;
  - no core field → Finish `quality_assessed`, after-write `none`;
  - a non-core comment never changes the outcome.
- **Verification:** the block above.
- **Falsifier:** map `returned` straight through instead of to `escalated`. The row "grey F2 with escalate" then reads `returned`.
- **Red run:** observed at baseline. `endOnFinish([{validated:false,commented:true},{validated:true,…}], false)` → `"returned"` (P-4, `npx tsx` probe, 2026-11-19). The new spec must be quoted red on its `escalated` assertion before the mapping exists.
- **Disqualifier:** the test calls `endOnFinish` itself instead of the mapping (it would assert the old helper).
- **Consumers:** `assessment-rules.spec.ts` (unchanged, must stay green).
- **Review:** full — end-rule logic.
- **Done when:** the table is green, the falsifier makes it red, and `assessment-rules.spec.ts` is untouched and green.
- **Skills:** tdd, nestjs-best-practices

## T-3: Migration `0013_round_two`

- **Status:** [x]
- **Size:** M
- **Depends on:** T-2
- **Requirements:**
  - FR-8 and FR-9 (decision storage).
  - FR-10 (delete columns).
  - FR-11 (`escalated`).
  - DD-6 state.
  - NFR-5.
- **Design refs:** § 5; P-12, P-13, P-20
- **Scope:**
  - Drizzle schema files: `result-assessments`, `assessment-comments`, `comment-events` (via enum), `assessment-audit-events`, and the new `comment-decisions` (+ `index.ts`).
  - `server/drizzle/0013_round_two.sql`, generated and reviewed by hand.
  - `server/drizzle/rollback/0013_round_two.down.sql`.
  - `meta/` journal.
  - Before generating, re-check that `0013` is free on `origin/staging-center` and `origin/dev`.
- **Tests:** `schema.spec.ts` gets the new table, enums and CHECK names. `comment-transitions.spec.ts` is touched only if it enumerates states.
- **Verification:** the block above, plus `git ls-tree --name-only origin/dev server/drizzle/ | tail -1` re-run.
- **Falsifier:** drop `lead_sided_program` from the enum → `schema.spec.ts` red, and `pnpm build` red once T-9 assigns it.
- **Red run:** predicted — greenfield artifact (observed in T-3).
- **Disqualifier:** a schema test that only checks the TS array, not the SQL file. The SQL is checked by the T-14 apply.
- **Consumers:** `schema/comment-events.ts`, `models/assessment.model.ts`, `comment-transitions.spec.ts` (P-12).
- **Review:** full — migration on shared boundary.
- **Done when:**
  - the build and suites are green;
  - the SQL holds exactly the § 5 changes;
  - a down script exists;
  - the number was re-checked.
- **Skills:** nestjs-best-practices

## T-4: Enable the Lead row, current step, status `pending_tpb_review`

- **Status:** [x]
- **Size:** M
- **Depends on:** T-3
- **Requirements:**
  - FR-1 (both scenarios; BUT not listed; AND IT MUST step window).
  - FR-14 (Admin worklist scenario).
  - FR-16 (TPB today).
  - FR-2 (same structure, through the reused view).
- **Design refs:** DD-3; § 7 Scope; P-1, P-7, P-8, P-9, P-11, P-18
- **Scope:**
  - `role-steps.ts`: LEAD `enabled: true`, plus a current-step helper.
  - `assessmentStep` for ADMIN by round.
  - `qa-status.ts`: the `pending_tpb_review` rule and the round-aware assessment input.
  - `worklist.store.ts`: join on the current step.
  - Quick comments for LEAD: confirm the behaviour (P-11).
- **Tests:**
  - `role-steps.spec.ts` and `scope.spec.ts`: Lead rows.
  - `qa-status.spec.ts`: the new row, in TS and SQL.
  - `worklist.service.spec.ts`.
  - e2e `assessment-round-two-scope.e2e-spec.ts`, using `runRealLoad` to build round 1 → returned → round 2:
    - in-scope list and open;
    - another type, another program, round 1 and an unassigned timeline → 404;
    - step not open → read-only;
    - TPB → 404;
    - ADMIN filter `pending_tpb_review`, with a seeded escalated row.
- **Verification:** the block above.
- **Falsifier:** leave the ADMIN step on `assessors` → the ADMIN filter test shows `pending`, not `pending_tpb_review`.
- **Red run:** predicted — greenfield test (observed in T-4).
- **Disqualifier:** a hand-built `SNAP#` key (module rule) — the round-2 membership must come from `runRealLoad`.
- **Consumers:** `role-steps.spec.ts`, `scope.spec.ts`, `worklist.service.spec.ts`, `ai-suggestions-rules.spec.ts`, `qa-status.spec.ts`; client `results/qa-status.ts` (reads the value; additive) (P-14, P-18).
- **Review:** full — scope and status are security- and report-relevant.
- **Done when:** every scenario above has a green test, the falsifier is red, and the step-1 suites are unchanged and green.
- **Skills:** nestjs-expert, tdd

## T-5: Core-only writes in round 2 and the new error codes

- **Status:** [x]
- **Size:** S
- **Depends on:** T-4
- **Requirements:** FR-3 (Write on a non-core field; AND IT MUST `actionable`; BUT Check all), FR-17 (codes).
- **Design refs:** § 6 codes; § 7 `isActionable`
- **Scope:**
  - The round-2 guard in validate / comment.
  - Check all / Uncheck all limited to core.
  - The 5 codes in `common/error-codes.ts` + `assessment.errors.ts`.
  - The filter forwards `fields` for `ASSESSMENT_CORE_UNDECIDED`.
- **Tests:**
  - Service specs: non-core 409 with nothing written; Check all touches core only.
  - The errors spec.
- **Verification:** the block above.
- **Falsifier:** drop the core check → the non-core validation returns 200.
- **Red run:** predicted — greenfield test (observed in T-5).
- **Disqualifier:** asserting the status code without asserting that no row was written.
- **Consumers:** `assessment.errors.spec.ts`; the contract grep (`assessment/AGENTS.md` Rules).
- **Review:** checklist — a guard plus a catalog.
- **Done when:** the tests are green and the falsifier is red.
- **Skills:** nestjs-best-practices, error-handling-patterns

## T-6: Round-2 view: thread, `updated`, carried greens

- **Status:** [x]
- **Size:** M
- **Depends on:** T-5
- **Requirements:**
  - FR-4 (both scenarios; BUT withdrawn/deleted not listed).
  - FR-5 (changed field; BUT new membership).
  - FR-7 (carried green; BUT changed field not carried).
  - FR-6 (Lead reads AI).
  - NFR-1.
- **Design refs:** § 6 view; § 7 Thread read; DD-4; P-2, P-15, P-16
- **Scope:**
  - The thread query (one SELECT).
  - `effectiveGreen`.
  - View fields `round`, `updated`, `actionable`, `effectiveValidated`, `carried`, `thread[]`.
  - The OpenAPI models.
- **Tests:**
  - `assessment-view.spec.ts` (pure).
  - e2e `assessment-round-two-view.e2e-spec.ts`: clarification + disagree thread; withdrawn hidden; `updated` true/false/NULL; carried vs changed.
  - Statement count for N = 1 and N = 30 equal.
  - `GET …/ai-suggestions` for the Lead returns 200.
- **Verification:** the block above.
- **Falsifier:** load responses per comment in a loop → the statement count differs between N = 1 and N = 30.
- **Red run:** predicted — greenfield test (observed in T-6).
- **Disqualifier:** a statement counter that counts only the thread query and not the whole view.
- **Consumers:** client `core/api/assessment.models.ts` and its 19 importers (additive; Yeck, T-13) (P-14).
- **Review:** full — query shape and privacy of the thread.
- **Done when:** every scenario is green, NFR-1 holds, and the falsifier is red.
- **Skills:** nestjs-expert, tdd

## T-7: Decisions (`PUT` / `DELETE …/decisions/:commentId`)

- **Status:** [x]
- **Size:** M
- **Depends on:** T-6
- **Requirements:**
  - FR-8, every scenario: agree; escalate + 409 `ASSESSMENT_FIELD_ESCALATED`; not decidable + 400 body; un-green clears.
  - FR-12 (last agree turns it green: end + release).
  - NFR-3.
- **Design refs:** § 6; § 7 write path; DD-2, DD-7; P-6
- **Scope:**
  - Controller, DTO and service `decide` / `clearDecision`.
  - Store upsert and delete with the comment row lock.
  - Audit `decision_set` / `decision_clear`.
  - Interplay with validate.
  - The auto end through `endRoundTwoAfterWrite`.
- **Tests:**
  - Service specs (in memory).
  - e2e `assessment-round-two-decisions.e2e-spec.ts`, including the last agree → Quality Assessed → one `qaed` release → the ack ends `released_qaed`.
  - A concurrent decide + finish (barrier) → serialized.
- **Verification:** the block above.
- **Falsifier:** skip the decidable-state check → a decision on an `accepted` comment returns 200.
- **Red run:** predicted — greenfield test (observed in T-7).
- **Disqualifier:** the release assertion reads the outbox before the end commits (it must read after the request).
- **Consumers:** `assessment.controller.ts` OpenAPI e2e.
- **Review:** full — state, locks, release.
- **Done when:** every FR-8 scenario and the FR-12 scenario are green, and the falsifier is red.
- **Skills:** nestjs-expert, tdd, api-design-principles

## T-8: Lead's own comment and its escalation; withdraw in step 3

- **Status:** [x]
- **Size:** S
- **Depends on:** T-7
- **Requirements:** FR-9 (New KP scenario; BUT `agree_program` on own comment refused).
- **Design refs:** § 7 `isDecidable`; § 6 withdraw row
- **Scope:**
  - Comments in round 2 carry `round: 2` and step 3.
  - `escalate` on the Lead's own comment.
  - The withdraw window also opens during step 3 for round-2 comments.
- **Tests:**
  - Service specs.
  - e2e: a new round-2 KP → comment → escalate → (finish in T-9).
- **Verification:** the block above.
- **Falsifier:** allow `agree_program` on own comment → the refusal test returns 200.
- **Red run:** predicted — greenfield test (observed in T-8).
- **Disqualifier:** a fixture without `previous_membership_id` that never exercises the "new" path.
- **Consumers:** `role-steps.ts` `isWithdrawWindowOpen` readers (`grep -rn isWithdrawWindowOpen server/src` at execution time).
- **Review:** checklist.
- **Done when:** the scenarios are green and the falsifier is red.
- **Skills:** nestjs-best-practices, tdd

## T-9: Finish review and the round-2 end

- **Status:** [x]
- **Size:** M
- **Depends on:** T-7, T-8
- **Requirements:**
  - FR-11 (Escalated; Undecided; BUT frozen after the end; concurrent finishes).
  - FR-12 (Finish with no grey core).
  - FR-13 (service-level regression).
  - FR-15.
  - NFR-3.
- **Design refs:** § 7 End application; DD-5, DD-7, DD-8; P-5
- **Scope:**
  - Wire `endRoundTwoOnFinish`.
  - The `applyEnd` round-2 branch: no release on `escalated`; decisions → comment states + `comment_events`; no `markCommentsVisible`; audit `end_escalated`.
  - Every write refused after the end.
  - The validations PUT response carries `effectiveValidated` per field (design § 6 validations row; coverage gap found in T-7's review, assigned here 2026-11-19).
- **Tests:**
  - Service specs.
  - e2e:
    - escalated → status Pending for TPB review, no release row, comment `escalated`;
    - undecided 409 with `fields`;
    - 5 parallel finishes → one 200;
    - every write after the end → `ASSESSMENT_FINISHED`;
    - service-level FR-13: never a `not_qaed` in round 2.
- **Verification:** the block above.
- **Falsifier:** keep `insertRelease` on `escalated` → the "no release row" assertion is red.
- **Red run:** predicted — greenfield test (observed in T-9). The FR-13 service test is quoted red against the T-8 state, before the wiring.
- **Disqualifier:** asserting the status without asserting the release table and the comment states.
- **Consumers:** `release.service.spec.ts`, `assessment-ends.service.spec.ts`, `assessment.end-store.spec.ts`; the hand-typed status copies `EndStatus` (`assessment.service.ts:195`) and `AssessmentSummaryModel.status` (`models/assessment.model.ts:235-237`, OpenAPI) must include `escalated` (P-13, corrected in T-3).
- **Review:** full — the end and the release.
- **Done when:** every scenario is green, both falsifiers are red, and the step-1 end suites are unchanged and green.
- **Skills:** nestjs-expert, tdd

## T-10: Delete another reviewer's comment

- **Status:** [ ]
- **Size:** S
- **Depends on:** T-5
- **Requirements:** FR-10 (Delete; BUT own / answered / out-of-scope).
- **Design refs:** § 5 delete columns; DD-9; § 6 delete route
- **Scope:**
  - The route, service and store (conditional UPDATE).
  - The `comment_events` row (to_state unchanged, deletion recorded through the audit `comment_delete` + the event's role).
  - Deleted comments excluded from the thread, counts and end rules.
- **Tests:**
  - Service specs.
  - e2e: delete, then the thread hides it and the history shows it; the 3 refusals.
- **Verification:** the block above.
- **Falsifier:** omit the `deleted_at IS NULL` filter in the thread read → the deleted comment stays listed.
- **Red run:** predicted — greenfield test (observed in T-10).
- **Disqualifier:** a fixture whose comment has no program answer only (the "answered" refusal must be exercised).
- **Consumers:** `findCommentedFieldKeys`, `markCommentsVisible`, SP view queries (`grep -rn "withdrawnAt" server/src/assessment` at execution time: each reader must also exclude deleted).
- **Review:** full — a destructive-looking action with history.
- **Done when:** the scenarios are green, the falsifier is red, and every reader from the grep is handled.
- **Skills:** nestjs-best-practices, tdd

## T-11: SP view and logs stay clean

- **Status:** [ ]
- **Size:** S
- **Depends on:** T-4
- **Requirements:** FR-15 (SP view after the Lead finishes), NFR-2.
- **Design refs:** DD-8; § 7 Logging
- **Scope:** extend `test/sp-view.e2e-spec.ts` and the log tests. No production change is expected.
- **Tests:**
  - A planted Lead comment and decision text never appear in any `/sp` answer.
  - The `assessment` log lines for `decide` / `delete` carry ids only.
- **Verification:** the block above.
- **Falsifier:** set `visible_to_program_at` on the Lead comment in the fixture → the SP test goes red.
- **Red run:** predicted — greenfield test (observed in T-11).
- **Disqualifier:** a planted text that also appears in round-1 data (the test must use a unique marker).
- **Consumers:** `test/sp-view.e2e-spec.ts`.
- **Review:** checklist.
- **Done when:** green, and the falsifier is red.
- **Skills:** tdd

## T-12: Whole round 2 end to end, OpenAPI and the front contract

- **Status:** [ ]
- **Size:** M
- **Depends on:** T-9, T-10, T-11
- **Requirements:**
  - FR-17 (contract matches code).
  - The success criteria of the proposal § 13.
  - FR-2.
- **Design refs:** § 6, § 8, § 9
- **Scope:**
  - e2e `assessment-round-two-flow.e2e-spec.ts`: round 1 returned → SP disagree ×2 → re-submitted → Lead agrees on one, escalates the other → Pending for TPB review, no release.
  - A second flow ending Quality Assessed with one `qaed`.
  - `front-contract.md` written.
  - `server/src/assessment/AGENTS.md` round-2 section.
  - Jira close-out draft for the back lead (not sent).
- **Tests:** the two flows. OpenAPI e2e. The contract grep (codes).
- **Verification:** the block above, plus `grep -o "ASSESSMENT_[A-Z_]*" server/src/assessment/assessment.errors.ts | sort -u` equals the same extraction from both contracts.
- **Falsifier:** remove one code from `front-contract.md` → the contract grep differs.
- **Red run:** predicted — greenfield test (observed in T-12).
- **Disqualifier:** a flow that seeds round-2 rows by hand instead of `runRealLoad`.
- **Consumers:** `docs/specs/assessment/step-1-assessment/front-contract.md` (codes list).
- **Review:** checklist.
- **Done when:** both flows are green, the contract is published, and the guide is updated.
- **Skills:** cognitive-doc-design, tdd

## T-13: Lead mode of the Review page (front — Yeck)

- **Status:** [ ]
- **Size:** L (Yeck splits it)
- **Depends on:** T-12
- **Owner:** **Yeck.** It touches `client/src/app/pages/workspace/review/**` and `results/**`. Not started by the back agent; coordinate first (DD-10).
- **Requirements:** FR-3 (View only rendering), FR-4, FR-5, FR-7 (hint), FR-8 (controls), FR-9, FR-10, FR-11 (Finish errors) — UI side.
- **Design refs:** § 8
- **Scope:** Yeck's plan from `front-contract.md`.
- **Tests:** Yeck's (vitest + build).
- **Verification:** `cd client && npm test && npm run build`, plus the UI HITL.
- **Falsifier:** Yeck's.
- **Red run:** n/a here.
- **Disqualifier:** n/a here.
- **Consumers:** client `assessment.models.ts` importers (19).
- **Review:** full — Yeck's review.
- **Done when:** Yeck's tasks are closed.
- **Skills:** angular-developer, tailwind-design-system

## T-14: API HITL on qatest

- **Status:** [ ]
- **Size:** M
- **Depends on:** T-12 (back merged into `dev`)
- **Requirements:** NFR-3, NFR-5, and the P-17 and P-21 premises.
- **Design refs:** § 11 (P-17, P-21)
- **Scope:**
  - Apply `0013` and its rollback on a disposable MySQL 8, then on qatest.
  - Stage one result through round 1 → SP disagree → re-submit at step 3.
  - Run the Lead flow through the API: 5 parallel finishes; escalated with no release; one QA path with `qaed` → `released_qaed`.
  - Results are recorded in `execution.md` with ids and counts only.
- **Tests:** manual, with an expected observation per step.
- **Verification:** the HITL checklist in `execution.md`, PASS by the back lead.
- **Falsifier:** n/a (manual). Each step names its expected observation.
- **Red run:** n/a (no test gate).
- **Disqualifier:** a run on a timeline whose step 3 is not open (writes refused for the wrong reason).
- **Consumers:** none.
- **Review:** full — HITL.
- **Done when:** the back lead marks PASS.
- **Skills:** aws-database (read-only checks)

## Coverage check (scenario and clause → task)

| Requirement clause | Task |
|---|---|
| FR-1 main; BUT not listed; AND IT MUST window; Assessor 404 | T-4 |
| FR-2 | T-4 (reused view), T-12 |
| FR-3 main; AND IT MUST `actionable`; BUT Check all | T-5 |
| FR-4 both scenarios; BUT withdrawn/deleted | T-6 (withdrawn), T-10 (deleted) |
| FR-5; BUT NULL | T-6 |
| FR-6 | T-6 |
| FR-7 both; BUT changed not carried | T-6 (view), T-7 (validate interplay) |
| FR-8 all four scenarios; AND IT MUST body 400 | T-7 |
| FR-9; BUT own agree refused | T-8 |
| FR-10; BUT three refusals | T-10 |
| FR-11 both; BUT frozen; concurrency | T-9 |
| FR-12 | T-7 (auto end), T-9 (finish), T-12 (flow) |
| FR-13; AND IT MUST red first | T-2 (rule), T-9 (service) |
| FR-14 | T-4 |
| FR-15 | T-9 (no visibility), T-11 (SP check) |
| FR-16 | T-4 (TPB 404) |
| FR-17 | T-5 (codes), T-12 (contract) |
| NFR-1 | T-6 |
| NFR-2 | T-11 |
| NFR-3 | T-7, T-9, T-14 |
| NFR-4 | every write task (clock rule unchanged; T-12 grep) |
| NFR-5 | T-3, T-14 |
| NFR-6 | the verification block of every task |

**Skip-eligible tasks:** none.
