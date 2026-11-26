# Round 2, step 4: the Third-Party Broker — Requirements

## 1. Document Control

| Spec path | Status | Ticket | Depth | Last updated |
|---|---|---|---|---|
| `docs/specs/escalation/round-2-tpb` | Built on the back lead's brief (2026-11-26); review on the pushed branch | P2-3916 | Standard (no migration) | 2026-11-26 |

| Field | Value |
|---|---|
| Type / Deliverable | Change / software |
| Source | Jira P2-3916 (AC1 … AC12), read 2026-11-26 |
| Decisions | Back lead, 2026-11-26: the TPB ends only with Finish (OQ-1); the worklist lists what reached step 4 (OQ-2). § 8. Found while building: OQ-3 (§ 8) |
| Extends | `escalation/round-2` (FR-1 … FR-17, DD-1 … DD-11; design § 12) · `admin/acts-as-reviewer` |

## 2. Executive Summary

In step 4 the TPB receives the results a Lead Assessor ended **Pending for TPB review**. On each comment the Lead escalated, the TPB sides either with the program or with the assessor, giving a reason each time. "Finish review" ends the result:

- **Quality Assessed** (`qaed` release) when every core field is green;
- **Pending PPU** when the TPB sided with the assessor at least once.

## 3. Glossary

| Term | Meaning |
|---|---|
| Escalated item | A comment in state `escalated`: a round-1 comment, or one of the Lead's own round-2 comments, that the Lead's end moved there |
| TPB decision | `tpb_agree_program` or `tpb_agree_assessor`, with a reason. One per comment (`comment_decisions`, `role_code = 'TPB'`) |
| Step-4 effective green | The TPB's stored validation if any, else the step-3 effective green (the Lead's stored mark, else the carried round-1 green) |
| PPU case | An escalated comment the TPB decided `tpb_agree_assessor`. At the end it is in state `tpb_sided_assessor` and keeps the field, the decision and its reason |

## 4. System Context & Scope

**In scope:**

- the TPB row;
- worklist and view;
- decisions;
- Finish;
- the two ends;
- status rows `pending_tpb_review` (step 4) and `pending_ppu`;
- quick comments;
- an Admin acting as TPB;
- audit and logs;
- the front contract.

**Out of scope:**

- the PPU closure, `unresolved` and "Changed in Reporting" (P2-3917);
- non-core escalations;
- returning the result to the program or to the Lead;
- TPB comments and TPB validations;
- the front.

**Current behavior** (cited in `proposal.md` § 2): the TPB row is disabled. `pending_ppu` has no rule. Only the Lead decides, and every round-2 end applies Lead decisions.

## 5. Stakeholders / Personas

| Role | Scope | Needs |
|---|---|---|
| TPB | Timelines they are assigned to, every result type (global role), their program scope | Decide each escalated comment with its full context; finish once |
| LEAD_ASSESSOR | Unchanged | Their read-only view keeps showing their own step-3 review after the TPB starts |
| ADMIN | Every timeline | Reads the step-4 statuses; acts as TPB with `X-Acting-Role: TPB` |
| PROGRAM | Their program | Unchanged: never sees the review outcome (round-2 DD-11) |
| Front (Yeck) | Review page, worklist | A stable contract |

## 6. Functional Requirements

### FR-1: Review structure (AC1)

The TPB's view SHALL keep the step-1 structure: the Reporting sections and fields, in order, under the pinned configuration. Escalated core fields are flagged in place: `thread[]` holds items with `decidable: true`.

#### Scenario: Same structure, escalated fields flagged

- GIVEN a result the Lead escalated on `FIRST`
- WHEN the TPB opens it
- THEN the sections and fields come in the step-1 order
- AND `FIRST`'s thread holds a decidable item

### FR-2: Scope and window (AC2)

The system SHALL list, for a TPB, only the round-2 memberships whose Lead (step-3) assessment ended `escalated`. These must be in timelines the TPB is assigned to and within their program scope. TPB is a **global** role: its grant takes no result type, so it covers every result type (DD-T9). Writes SHALL be allowed only while the timeline's `tpb` step is `in_progress`. The worklist counters count `pending_tpb_review` as the TPB's pending work, and `quality_assessed` / `pending_ppu` as finished.

#### Scenario: Escalated result listed and writable in step 4

- GIVEN a TPB on timeline T, with step 4 in progress, and result R that the Lead ended `escalated`
- WHEN the TPB lists T
- THEN R is listed with status Pending for TPB review and opens writable
- BUT a round-2 result the Lead has not ended, or ended Quality Assessed, must NOT be listed, and opening it is the scope 404
- AND IT MUST answer `writable: false` with `step_upcoming` / `step_closed` outside step 4

#### Scenario: Finished results stay visible (OQ-2)

- GIVEN the TPB finished R
- WHEN they list T
- THEN R is still listed with its status (Quality Assessed or Pending PPU) and opens read-only (`finished`)

### FR-3: Items to decide (AC3)

In the TPB's view, only items in state `escalated` SHALL be decidable, with choices `tpb_agree_program` and `tpb_agree_assessor`. Every other field and comment is read-only context.

#### Scenario: Only escalated items are decidable

- GIVEN a field with an escalated round-1 comment and a `lead_sided_program` one
- WHEN the TPB opens the result
- THEN the escalated item reads `decidable: true` with both TPB choices
- AND the other reads `decidable: false`, `choices: []`

### FR-4: Context of each escalated item (AC4)

Each `thread[]` item SHALL carry:

- the value when it was written and the field's current value;
- the assessor's comment;
- the program's latest response and clarifications;
- the Lead's decision with its reason (`leadDecision`);
- the TPB's own decision (`decision`);
- whether it is a round-1 comment or the Lead's own (`round`).

The field SHALL carry `updated`. The AI suggestion is read on the existing AI route, read-only, with the copy mark (ai-suggestions FR-9).

#### Scenario: The Lead's reason travels with the item

- GIVEN the Lead escalated comment C with reason "Program figure is wrong"
- WHEN the TPB opens the result
- THEN C's item has `leadDecision.decision = 'escalate'` and `leadDecision.body = 'Program figure is wrong'`

### FR-5: Decide (AC5, AC6)

`PUT …/assessment/decisions/:commentId` SHALL accept `tpb_agree_program` or `tpb_agree_assessor` from a TPB, with a required reason (trimmed, 1 to 2,000 characters). It stores who decided and when. The TPB may change or clear (`DELETE`) a decision until the review ends.

#### Scenario: Reason required

- WHEN the TPB sends a decision with an empty body
- THEN 400 `VALIDATION_FAILED` on `body`

#### Scenario: Wrong item or wrong value

- WHEN the TPB decides a comment that is not `escalated`, or sends a Lead value
- THEN 409 `ASSESSMENT_DECISION_INVALID`, nothing written
- AND a comment outside the result is the 404

### FR-6: Agree with the program (AC7)

A `tpb_agree_program` SHALL leave the result unchanged. The field turns green in the TPB's step-4 assessment once **every** escalated item on it is decided `tpb_agree_program`. At the end the comment closes as `tpb_sided_program`.

#### Scenario: Field green when all its escalated items side with the program

- GIVEN `FIRST` with one escalated item
- WHEN the TPB decides it `tpb_agree_program`
- THEN `FIRST` reads `effectiveValidated: true`
- AND clearing the decision turns it grey again

### FR-7: Agree with the assessor (AC8)

A `tpb_agree_assessor` SHALL keep the field grey. At the end the comment moves to `tpb_sided_assessor`: the PPU case. The case keeps the field, the decision and its reason (the decision row).

### FR-8: Finish review (AC9, AC10, AC11)

`POST …/assessment/finish` SHALL end the TPB's review only when every escalated item has a TPB decision. Otherwise it returns 409 `ASSESSMENT_CORE_UNDECIDED` with the fields, and nothing is written. Then:

- at least one `tpb_agree_assessor` ends the step-4 assessment `escalated`. The status is Pending PPU, and no release is sent;
- otherwise every core field is green, so the end is `quality_assessed` with one `qaed` release.

After the end every write is 409 `ASSESSMENT_FINISHED`. Decisions never end the review by themselves (OQ-1).

#### Scenario: All with the program

- GIVEN two escalated items, both decided `tpb_agree_program`
- WHEN the TPB finishes
- THEN `status: quality_assessed`, one `qaed` release, comments `tpb_sided_program`

#### Scenario: One with the assessor

- GIVEN one item `tpb_agree_program` and one `tpb_agree_assessor`
- WHEN the TPB finishes
- THEN `status: escalated`, the result reads Pending PPU, there is no release, and the comments are `tpb_sided_program` / `tpb_sided_assessor`

#### Scenario: Undecided item

- GIVEN an escalated item with no TPB decision
- WHEN the TPB finishes
- THEN 409 `ASSESSMENT_CORE_UNDECIDED` naming its field

### FR-9: Status in step 4

| Current step's assessment | Status |
|---|---|
| Lead (step 3) ended `escalated`, no TPB row | Pending for TPB review (unchanged) |
| TPB (step 4) `pending` | Pending for TPB review |
| TPB (step 4) ended `escalated` | Pending PPU |
| TPB (step 4) ended `quality_assessed` | Quality Assessed |

### FR-10: Quick comments (AC12)

A TPB SHALL read and save the TPB role's quick comment list on the existing routes.

### FR-11: TPB writes only decisions

A TPB's validation, comment, delete or AI usage event SHALL be refused with 403 `ASSESSMENT_READ_ONLY`, and nothing written.

### FR-12: Admin as TPB

An Admin with `X-Acting-Role: TPB` SHALL act as the TPB on any result type and program, whatever the step-4 dates (admin/acts-as-reviewer R1–R7). The result must have reached step 4 (R6).

### FR-13: The Lead's read-only view

After the TPB's first write, the Lead's view SHALL still show the Lead's own step-3 review: validations, own comments, decisions and assessed-by.

### FR-14: Audit and logs

Every TPB write SHALL leave the round-2 audit rows: `decision_set`, `decision_clear` and `end_escalated` / `end_quality_assessed`. The end adds one `comment_events` row per moved comment (actor role `TPB`). There is one `assessment` log line per request, with ids only.

## 7. Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-1 | The TPB view adds a constant number of statements: one thread read over both assessments and the step-3 validations. Never one per comment |
| NFR-2 | No migration. Every value is declared by `0013` |
| NFR-3 | The program view is unchanged (round-2 DD-11 covers `tpb_sided_*`) |

### Defect classes and their gates

| Class | Gate |
|---|---|
| Wrong state machine (end, status, transitions) | Unit specs on the pure rules plus the e2e flow |
| Scope leak (TPB sees a non-escalated result) | e2e scope suite plus the `rowCovers` unit spec |
| SQL / TS status drift | `qa-status.spec.ts` checks `statusOf` and `statusSqlCase` from one table |
| Real MySQL row locks | Not gated here: the qatest HITL (§ 9) |

## 8. Decisions (back lead, 2026-11-26)

| # | Question | Answer |
|---|---|---|
| OQ-1 | The Lead auto-ends when all core fields turn green. Does the TPB? | No. The TPB ends only with Finish (AC9). "Automatically" in AC10 means no extra manual step after Finish |
| OQ-2 | Does the worklist list only Pending for TPB review? | It lists what reached step 4. Finished results stay visible read-only; outside step 4 they are read-only, like the Lead's |
| OQ-3 | AC2 says "within their result types", but the role catalog makes TPB **global** (`users/permissions.ts`: `scopeType: 'global'`; a grant takes no result type) | Built as: every result type, the user's program scope applies (DD-T9). **Open for the back lead to confirm** |

## 9. Requirement ID Index

| AC (Jira) | FR |
|---|---|
| AC1 | FR-1 |
| AC2 | FR-2 |
| AC3 | FR-3 |
| AC4 | FR-4 |
| AC5, AC6 | FR-5 |
| AC7 | FR-6 |
| AC8 | FR-7 |
| AC9, AC10, AC11 | FR-8, FR-9 |
| AC12 | FR-10 |
| Brief | FR-11, FR-12, FR-13, FR-14 |
