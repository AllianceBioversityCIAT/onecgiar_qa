# Round 2: Lead Assessor, TPB and PPU — Requirements

## 1. Document Control

| Spec path | Status | PRD stories | Tickets | Depth | Last updated |
|---|---|---|---|---|---|
| `docs/specs/escalation/round-2` | **Approved** — back lead, 2026-11-19 ("Si") | US-8 (built), US-9 and US-10 (designed) | P2-3912 (built) · P2-3916, P2-3917 (designed) | Full (migration, API, status model, release) | 2026-11-19 |

| Field | Value |
|---|---|
| Type / Deliverable | Change / software |
| Approval Mode | gated. The per-phase gates of `/akili-specify` are folded into **one** gate, set by the brief: "Antes de construir, muéstrame la spec y espera mi OK" (back lead, 2026-11-19). No task starts before that OK |
| Sources | Jira P2-3912, P2-3916, P2-3917 (read 2026-11-19). Back-lead comments of 2026-11-18 on P2-3910 (end rule) and P2-3912 (round-2 core-only rule) |
| Open questions | OQ-1 … OQ-8 (§ 9). Each row says which default this spec is built on |
| Extends | `assessment/step-1-assessment` (view, writes, end rule, status table, release outbox) · `assessment/ai-suggestions` (LEAD audience) · `ingestion--timeline-sync` (archived: round-2 memberships) · P2-3911 SP view (responses, clarifications) |

## 2. Executive Summary

In round 2 (step 3) the **Lead Assessor** reviews the results that were returned in round 1 and re-submitted, plus the results new to round 2. Only core fields count.

The Lead reads each core comment's whole round-1 thread, then:

- **validates** what the program corrected;
- on each disagreement, either **agrees with the program** (the comment closes, the field goes green) or **escalates to the TPB**.

When all core fields are green, the result ends **Quality Assessed** by itself. Otherwise "Finish review" ends it **Pending for TPB review**.

The same model carries the TPB (step 4) and PPU (step 5) stories. They are designed here (design § 12) and built later.

## 3. Glossary

| Term | Meaning |
|---|---|
| Round-2 membership | A `timeline_results` row with `entry_round = 2`. **Re-submitted:** it has `previous_membership_id`, the returned round-1 row. **New:** it has none |
| Round-1 thread | For one field, the round-1 comments of the previous membership's step-1 assessment, each with the program's latest response, any clarification exchanged, and later decisions |
| Disagreement | A round-1 core comment whose latest state is `disagreed` (OQ-4: also `open` or `clarification_requested` at re-submission) |
| Decision | A role's ruling on one comment. Lead: `agree_program` or `escalate`. TPB: `tpb_agree_program` or `tpb_agree_assessor`. PPU: `ppu_done`. One per comment and role |
| Carried green | A core field green in round 1, without a round-1 comment and not in `changed_fields`. It starts green for the Lead (OQ-3) |
| Effective green | The Lead's stored validation if any, else the carried green, else grey |
| Escalated (assessment) | A Lead (or TPB) assessment ended by handing items to the next step. No release is sent |

## 4. System Context & Scope

**In scope (built):**

- the Lead role row;
- worklist and view;
- core-only writes;
- the round-1 thread;
- the "Updated" tag per field;
- decisions;
- the Lead's own escalated comments;
- deleting another reviewer's comment;
- Finish review;
- the round-2 end and release rule;
- status `pending_tpb_review`;
- the round-2 return fix;
- migration `0013`;
- the front contract.

**Designed, not built:** TPB decisions and Pending PPU (P2-3916); PPU Done, Unresolved, and "Changed in Reporting" (P2-3917).

**Out of scope:**

- escalating non-core comments;
- returning to the program in round 2;
- notifications;
- the comments export (P2-3914).

**Current behavior:**

- Only the ASSESSOR row writes. LEAD, TPB and PPU are declared `round: 2`, `enabled: false` (`server/src/assessment/role-steps.ts:38-64`).
- Re-submitted round-2 memberships carry `previous_membership_id` and `changed_fields` (`schema/timeline-results.ts`, migration `0008`).
- `escalated`, `tpb_sided_program`, `tpb_sided_assessor` and `done` are declared comment states, reachable by no route (`schema/assessment-comments.ts:22-33`; `comment-transitions.ts:46-61`).
- `pending_tpb_review`, `pending_ppu` and `unresolved` are declared statuses with no rule row (`qa-status.ts:14-24`, `:57-77`).
- `endOnFinish` returns `returned` for a round-2 result with a grey, commented core field. Probe run 2026-11-19 at `3750182`: `npx tsx -e …endOnFinish([{validated:false,commented:true},{validated:true}], false)` → `"returned"`. `applyEnd` turns that into a `not_qaed` release (`assessment.service.ts:599-623`). The ack's `endAsReturned` ends round 1 only (`ingestion/loads.store.ts:765-772`).
- The "Updated" flag exists per **row** of the worklist only (`worklist.store.ts:476`), not per field in the view (`grep -n "changedFields\|updated" assessment-view.ts assessment.service.ts` → no hit).
- An ended assessment makes its comments visible to the program (`applyEnd` → `markCommentsVisible`, `assessment.service.ts:623`).
- The release ack ends a membership `released_qaed` in either round (`ingestion/loads.store.ts:800-801`).

## 5. Stakeholders / Personas

| Role (PRD § 3) | Scope | What they need |
|---|---|---|
| LEAD_ASSESSOR | Their result types (role scope) and programs (user program scope), timelines they are assigned to | Decide each core disagreement with the whole thread in view; finish once |
| ASSESSOR | Round 1 | Unchanged. Their comments may be deleted by a Lead (AC11), with history |
| PROGRAM (SP view) | Their program | Unchanged. Never sees round-2 comments or decisions |
| TPB, PPU | Global (PRD) | Designed only. Rows stay disabled |
| ADMIN | Every timeline | Reads round-2 statuses correctly: Pending, Pending for TPB review, Quality Assessed |
| Front (Yeck) | Review page | A stable contract: thread, `updated`, decisions, errors |

## 6. Functional Requirements

### FR-1: Lead scope and window (AC2, AC15)

The system SHALL give a LEAD_ASSESSOR a worklist and write access to round-2 memberships only. These are memberships of timelines where the Lead is assigned, within the result types of their live LEAD_ASSESSOR grants and their program scope. Writes are allowed only while the timeline's `lead_assessors` step is `in_progress` (Rome minute).

#### Scenario: Lead opens a round-2 result in scope

- GIVEN a Lead granted for `innovation_development`, assigned to timeline T, step 3 in progress
- WHEN they list T's worklist and open re-submitted result R (innovation development, their program)
- THEN R is listed with status Pending and opens writable
- BUT it must NOT list R's round-1 membership, a round-2 membership of another result type or program, or any membership of a timeline they are not assigned to (same 404 body as missing)
- AND IT MUST answer `writable: false` with the existing `readOnlyReason` (`step_upcoming` before step 3 opens, `step_closed` after it closes), and refuse every write with the existing step-closed error

#### Scenario: Assessor does not reach round 2

- GIVEN an ASSESSOR of the same scope
- WHEN they open R's round-2 membership
- THEN they get the assessment 404

### FR-2: Review structure (AC1)

The view of a round-2 membership SHALL keep the step-1 structure: Reporting sections and field order, the ToC section rule, and the Hidden / View only / Assessed configuration of the pinned version.

#### Scenario: Same structure

- GIVEN R's round-2 membership
- WHEN the Lead opens it
- THEN its sections and fields appear in the same order the step-1 view gives for that result type and configuration version

### FR-3: Core fields only (AC3)

In round 2 only **Assessed core** fields SHALL accept a validation, a comment or a decision. Every other non-hidden field is read-only context.

#### Scenario: Write on a non-core field

- GIVEN `general.description` is Assessed and not core
- WHEN the Lead validates or comments it
- THEN 409 `ASSESSMENT_FIELD_NOT_CORE`, nothing written
- AND IT MUST mark such fields in the view as not actionable (`actionable: false`)
- BUT "Check all" and "Uncheck all" must NOT fail on them: in round 2 they act on core fields only

### FR-4: Round-1 thread (AC4)

For each core field, the view SHALL show the round-1 thread from the previous membership's step-1 assessment. For each comment that is neither withdrawn nor deleted it shows:

- the body;
- the author's nickname;
- the date;
- the value copy (value when written);
- the current value;
- the program's latest response (kind, body, date, responder name);
- every clarification request and answer, in order;
- the Lead's current decision.

The view SHALL read the threads in a fixed number of statements, independent of how many comments there are (NFR-1).

#### Scenario: Disagreement with a clarification

- GIVEN round-1 comment C on core field F: the program requested a clarification, the assessor answered, the program then disagreed with a justification
- WHEN the Lead opens the round-2 view
- THEN F shows C with both values, the clarification request and answer, and the disagreement with its justification
- AND C is marked `decidable` with the choices `agree_program` and `escalate`
- BUT a withdrawn or deleted round-1 comment must NOT be listed in the thread

#### Scenario: New round-2 result

- GIVEN a membership with no previous membership
- THEN every core field has an empty thread, and the Lead reviews it like a fresh assessment (OQ-2)

### FR-5: "Updated" per field (AC5)

Every field whose key is in the membership's `changed_fields` SHALL be marked `updated: true`.

#### Scenario: Changed field

- GIVEN `changed_fields = ["general.title"]`
- THEN `general.title` has `updated: true` and every other field `false`
- BUT on a new round-2 membership (`changed_fields` NULL), no field is updated

### FR-6: AI suggestion for the Lead (AC6)

A Lead SHALL read AI suggestions on core fields of a round-2 membership in scope, with the `reviewer` audience (`assessment/ai-suggestions` FR-5).

#### Scenario: Lead reads suggestions

- GIVEN R in the Lead's scope
- WHEN they call `GET …/ai-suggestions`
- THEN 200 with the suggestion views, without the copied/edited mark

### FR-7: Validate and carried greens (AC7, OQ-3)

The Lead SHALL be able to turn a core field green or grey. A core field that was green in round 1, carries no round-1 comment and is not in `changed_fields` SHALL start green (carried green). The Lead can un-green it.

#### Scenario: Accepted and corrected

- GIVEN round-1 comment C on F, program response `accept`, F in `changed_fields`
- WHEN the Lead validates F
- THEN F is green in the Lead's assessment

#### Scenario: Carried green

- GIVEN F green in round 1, uncommented, unchanged
- THEN F shows green before the Lead writes anything, and counts as green for the end rule
- BUT a field in `changed_fields` must NOT be carried green

### FR-8: Decide a disagreement (AC7, AC8, AC9)

On a decidable round-1 core comment the Lead SHALL set `agree_program` or `escalate`, with a comment of 1–2000 characters (trimmed). Until the review ends, the Lead may change the decision or clear it.

| Decision | Effect while the review is open | Effect when the review ends |
|---|---|---|
| `agree_program` | The field turns green | Comment → `lead_sided_program` (closed) |
| `escalate` | The field stays grey; validating it is refused | Comment → `escalated` (open) |
| cleared | An `agree_program` green goes back to grey | none |

#### Scenario: Agree with the program

- GIVEN C `disagreed` on core field F
- WHEN the Lead sets `agree_program` with "The program's figure matches the evidence"
- THEN the decision is stored with the author and time, and F is green
- AND if every core field is now effectively green, the review ends Quality Assessed (FR-12)

#### Scenario: Escalate

- WHEN the Lead sets `escalate` on C with a comment
- THEN F stays grey
- AND a later validation of F is 409 `ASSESSMENT_FIELD_ESCALATED` until the decision is changed or cleared

#### Scenario: Not decidable

- WHEN the decision targets an `accepted`, `accepted_with_comment`, withdrawn or deleted comment, a non-core field, or a comment of another result
- THEN 409 `ASSESSMENT_DECISION_INVALID` (another result: the 404 body)
- AND IT MUST refuse an empty or over-2000 comment with 400

#### Scenario: Un-green a field the Lead agreed on

- GIVEN F is green through `agree_program` on C
- WHEN the Lead un-greens F
- THEN the decision on C is cleared in the same transaction

### FR-9: Lead's own escalated comment (AC10, OQ-2, OQ-5)

The Lead SHALL be able to comment a core field in round 2, and to `escalate` their own comment (a decision with the same body rules). The Lead may withdraw their own comment while the review is open.

#### Scenario: New KP, core field wrong

- GIVEN a new round-2 KP, core field F grey
- WHEN the Lead comments F and escalates that comment
- THEN Finish review can end the result Pending for TPB review (FR-11)
- BUT `agree_program` on the Lead's own comment must NOT be accepted (409 `ASSESSMENT_DECISION_INVALID`)

### FR-10: Delete another reviewer's comment (AC11, OQ-8)

The Lead SHALL be able to delete a comment written by another reviewer on a membership of the Lead's result types. Deleting stores who and when, keeps the row, and hides the comment from every list, count and end rule. The history (comment events) shows the deletion.

#### Scenario: Delete

- GIVEN a round-1 comment C by an assessor on R, not yet answered by the program
- WHEN the Lead deletes C
- THEN C leaves the thread, and its events show "deleted" with the Lead and the time
- BUT the Lead must NOT delete their own comment (they withdraw it), a comment the program already answered, or a comment outside their result types (409 `ASSESSMENT_COMMENT_NOT_DELETABLE`; outside scope: the 404 body)

### FR-11: Finish review (AC12, AC14)

"Finish review" SHALL end the Lead's assessment in one transaction:

1. Every effectively grey core field must carry an `escalate` decision (on a round-1 comment or the Lead's own). Otherwise 409 `ASSESSMENT_CORE_UNDECIDED`, naming the fields.
2. With at least one grey core field, the assessment ends `escalated` and the result is **Pending for TPB review**.
3. With none, it ends Quality Assessed (FR-12).

On the end, every Lead decision is applied to its comment state, with a comment event. Exactly one of several concurrent finishes wins (409 `ASSESSMENT_FINISHED` for the others).

#### Scenario: Escalated

- GIVEN F1 green and F2 grey with C2 escalated
- WHEN the Lead finishes
- THEN the status is Pending for TPB review, "Assessed by" is the Lead, C2 is `escalated`
- AND no release row is written
- BUT afterwards every decision, validation, comment, withdraw or delete on this assessment must be refused with `ASSESSMENT_FINISHED`

#### Scenario: Undecided

- GIVEN F2 grey with no escalate decision
- WHEN the Lead finishes
- THEN 409 `ASSESSMENT_CORE_UNDECIDED` with `fields: ["F2"]`, nothing written

### FR-12: Quality Assessed in round 2 (AC13)

When a write leaves every core field effectively green, the round-2 assessment SHALL end `quality_assessed` in the same transaction, with one `qaed` release, whatever non-core fields carry. Finish with no grey core field ends the same way. A configuration with no core field ends only through Finish.

#### Scenario: Last agree turns it green

- GIVEN F1 carried green, F2 grey with a disagreement
- WHEN the Lead sets `agree_program` on F2's comment
- THEN the result is Quality Assessed, one release row `qaed`, C2 is `lead_sided_program`
- AND when Reporting answers `released`, the round-2 membership ends `released_qaed`

### FR-13: Round 2 never returns (defect fix)

A round-2 end SHALL never be `returned` and SHALL never queue `not_qaed`.

#### Scenario: Regression

- GIVEN a round-2 assessment with a grey core field carrying a comment but no escalate decision
- WHEN it is finished
- THEN 409 `ASSESSMENT_CORE_UNDECIDED`, not `returned`
- AND IT MUST be covered by a test that is red on the code before the change

### FR-14: Status in round 2

The QA status of a round-2 membership SHALL come from its current step's assessment:

| Assessment state | Status |
|---|---|
| No assessment, or pending | Pending |
| Lead assessment ended `escalated` | Pending for TPB review |
| Ended `quality_assessed` | Quality Assessed |

The status SHALL be the same in the worklist (filters, counts, sort), in the view, and for ADMIN. Round-1 statuses do not change. In the worklist's pending / finished counters, Pending for TPB review counts as **finished**: the Lead's review has ended (back lead, 2026-11-19).

#### Scenario: Admin worklist

- GIVEN R's Lead assessment ended `escalated`
- WHEN an ADMIN lists the timeline and filters `pending_tpb_review`
- THEN R's round-2 membership is listed with that status, and the count includes it
- AND it counts in `finished`, not in `pending`

### FR-15: Round-2 writing stays internal

Lead comments and decisions SHALL never become visible to the program. A round-2 end does not mark comments visible.

#### Scenario: SP view after the Lead finishes

- GIVEN R ended Pending for TPB review with a Lead comment
- WHEN the program opens R in the SP view
- THEN only the round-1 comments it already saw are listed, with their round-1 states, and no decision text

### FR-16: TPB and PPU stay designed only

The TPB and PPU role rows SHALL stay disabled. The model they need is defined in design § 12 and adds no table beyond migration `0013`.

#### Scenario: TPB today

- WHEN a TPB opens R
- THEN the assessment 404, as today

### FR-17: Front contract

The spec SHALL publish what the front may rely on in `front-contract.md`:

- the view additions (`round`, per-field `updated`, `actionable`, `thread`, `effectiveValidated`, `carried`);
- the decision and delete routes;
- the new error codes.

#### Scenario: Contract matches the code

- GIVEN `front-contract.md`
- THEN every `ASSESSMENT_*` code in `assessment.errors.ts` appears in it (the existing grep check), and the OpenAPI e2e stays green

## 7. Non-Functional Requirements

| ID | Attribute | Scenario | Measure | TRD ref |
|---|---|---|---|---|
| NFR-1 | Performance | The Lead opens a round-2 view with N round-1 comments | Statement count of the view constant in N (an e2e counts statements for N = 1 and N = 30) | § 3 |
| NFR-2 | Privacy | Any write | Log lines carry ids, fixed words and error codes only: no body, value, name or email. `assessment-log.ts` gets no new field that can hold text | § 11 |
| NFR-3 | Consistency | Decision, validation, delete and finish racing on one assessment | Each runs under the existing lock order (timeline share → assessment update). Concurrent finishes: one 200, others 409 | step-1 DD-5 |
| NFR-4 | Time | Every window and timestamp | Read only through `ADMIN_CONFIG_CLOCK`, once per request | step-1 NFR-4 |
| NFR-5 | Reversibility | Migration `0013` | A down script in `drizzle/rollback/`, applied and re-applied on a disposable MySQL 8 in the HITL | — |
| NFR-6 | Regression | Round 1, SP view, AI suggestions | Existing unit and e2e suites stay green unchanged, apart from the tests this spec names | — |

### Defect classes and their gates

| Defect class | Gate |
|---|---|
| Wrong end outcome (round 2 returns, ends early, never ends) | Unit table over `assessment-rules` round-2 mapping + service specs (in-memory stores) |
| Scope leak (Lead sees another type/program/round) | e2e over the in-memory world (`assessment-*.e2e-spec.ts`) |
| Status drift between TS and SQL | `qa-status.spec.ts` (both read one table) + worklist e2e filter/count |
| Per-row queries (N+1) | NFR-1 statement-count e2e |
| Typed contract broken (DTO/OpenAPI) | `pnpm build` (stricter than vitest) + OpenAPI e2e |
| Migration wrong on real MySQL (enum change, CHECKs, FKs) | **No automated check** (e2e runs in memory). Substitute: the API HITL on qatest (T-14) applies `0013` and its rollback |
| Real lock order or deadlock under MySQL | **No automated check.** Substitute: T-14 parallel-finish probe on qatest; accepted risk otherwise, as in step 1 |
| Program sees round-2 text | `sp-view.e2e-spec.ts` extended (planted Lead comment) |
| Front renders the thread wrong | Not gated here. Yeck's front tasks and the UI HITL |

## 8. Requirement ID Index

| ID | Ticket AC |
|---|---|
| FR-1 | P2-3912 AC2, AC15 |
| FR-2 | AC1 |
| FR-3 | AC3 |
| FR-4 | AC4 |
| FR-5 | AC5 |
| FR-6 | AC6 |
| FR-7 | AC7 (validate) |
| FR-8 | AC7, AC8, AC9 |
| FR-9 | AC10 |
| FR-10 | AC11 |
| FR-11 | AC12, AC14 |
| FR-12 | AC13; P2-3910 / P2-3912 comments of 2026-11-18 |
| FR-13 | Defect found while specifying |
| FR-14 | AC9, AC14 (status names) |
| FR-15 | P2-3912 out-of-scope "returning to the program" |
| FR-16 | P2-3916, P2-3917 |
| FR-17 | Team rule (front by Yeck) |
| NFR-1 … NFR-6 | — |

## 9. Open Questions (defaults this spec is built on)

| # | Question | Default | Who confirms | Answer |
|---|---|---|---|---|
| OQ-1 | `docs/qa-context.md:14` (Santi, 2026-11-12) says the Lead does not close comments, has no final step, and highlights any commented field. P2-3912 says the opposite | **The ticket** | Back lead now; Angel to ratify | Default accepted — back lead, 2026-11-19 (spec approved as written); Angel to ratify |
| OQ-2 | A result NEW to round 2: who reviews it? | **The Lead, full core review**, for every type | Back lead; Angel | Default accepted — back lead, 2026-11-19 (spec approved as written); Angel to ratify |
| OQ-3 | A core field green in round 1, uncommented and unchanged | **Carried green** | Back lead | Default accepted — back lead, 2026-11-19 (spec approved as written) |
| OQ-4 | A round-1 comment still `open` or `clarification_requested` at re-submission | **Decidable, like a disagreement** | Back lead | Default accepted — back lead, 2026-11-19 (spec approved as written) |
| OQ-5 | An accepted comment the Lead still finds wrong | **The Lead's own comment, escalated** (FR-9) | Back lead | Default accepted — back lead, 2026-11-19 (spec approved as written) |
| OQ-6 | Field config pinning: core may differ from round 1 | **Keep DD-3.** A thread on a field no longer core is read-only and never blocks | Back lead | Default accepted — back lead, 2026-11-19 (spec approved as written) |
| OQ-7 | Step 3 closes before the Lead finishes | **Stays Pending, read-only** (same as step 1) | Angel | Default accepted — back lead, 2026-11-19 (spec approved as written); Angel to ratify |
| OQ-8 | Delete (AC11) | **Soft delete.** Not own comments, not answered comments | Back lead | Default accepted — back lead, 2026-11-19 (spec approved as written) |
