# Round 2: Lead Assessor, TPB and PPU — Proposal

## 1. Document Control

| Field | Value |
|---|---|
| Spec Path | `escalation/round-2` (domain `escalation` = "Lead → TPB → PPU", root `AGENTS.md`) |
| Slug | `round-2`, derived from the free-text argument |
| Type | Change |
| Deliverable | software |
| Tickets | **P2-3912** (Lead Assessor, built here) · P2-3916 (TPB) and P2-3917 (PPU): designed here, built later |
| Epic | P2-3902 |
| Sources | Jira P2-3912, P2-3916, P2-3917 (read 2026-11-19); comments of 2026-11-18 on P2-3910 (end rule, OQ-2) and P2-3912 (round-2 core-only rule) |
| Visual source | None. No mockup is linked in the tickets. The Lead reuses the step-1 Review page |
| Approval Mode | gated. The brief chains `/akili-propose` and `/akili-specify` ("una spec de ronda 2 … tasks solo para P2-3912"); the human gate is **before building**: "Antes de construir, muéstrame la spec y espera mi OK" (back lead, 2026-11-19) |
| Branch | `feat/P2-3912-lead-assessor-round-2`, from `origin/staging-center` |
| Owner | Back lead (Juanda). The assessment front (`review-*`, `results-*`) is Yeck's |

## 2. Intent

Build the second round of QA. A result the program re-submitted, or a result new to round 2, reaches the Lead Assessor in step 3. The Lead closes each core-field disagreement, or escalates it to the TPB (step 4), whose "agree with the assessor" opens a case for the PPU (step 5).

This spec defines the model the three roles share and builds only the Lead's part (P2-3912). The TPB and PPU stories then enable their rows and add their decisions without changing the model.

## 3. Problem / Current Behavior

| Today | Source |
|---|---|
| Only the ASSESSOR row writes. The LEAD_ASSESSOR, TPB and PPU rows exist with `round: 2` and `enabled: false` | `server/src/assessment/role-steps.ts:38-64` |
| A round-2 membership already exists: a re-submitted result gets `entry_round = 2`, `previous_membership_id` pointing to its returned round-1 row, and `changed_fields` | `schema/timeline-results.ts` (columns from migration `0008`); archived spec `ingestion--timeline-sync` FR-5 |
| The comment states `escalated`, `tpb_sided_program`, `tpb_sided_assessor` and `done` are declared, but no route can reach them | `schema/assessment-comments.ts:22-33`; `comment-transitions.ts:46-61` |
| The status vocabulary already names `pending_tpb_review`, `pending_ppu` and `unresolved`. No row of the status table produces them | `qa-status.ts:14-24`, `:57-77` |
| `endOnFinish` / `endAfterValidation` already count only core fields when the round is not 1 | `assessment-rules.ts:33-69` (dev `f0b4fa2`, staging-center `5b97421`) |
| **Defect in waiting.** Finishing round 2 with a grey core field returns `returned` and queues a `not_qaed` release. Round 2 never returns to the program. The release ack then refuses to end the membership, because `endAsReturned` only ends round 1 | `assessment.service.ts:509-520`, `:599-616`; `loads.store.ts:765-772` |
| Program responses are stored on the **round-1** comments (`sp_comment_responses`, latest row counts), together with the assessor's clarification answers | `schema/sp-comment-responses.ts`; `schema/comment-clarification-answers.ts` |
| `docs/qa-context.md:14` says the Lead "does not close comments and has no final step" and highlights any commented field. P2-3912 says the opposite: the Lead validates, closes, escalates only disagreements on core fields, and finishes | `docs/qa-context.md:14` vs Jira P2-3912 |
| KPs to review are assessed in step 1 (S-9). P2-3912 speaks of "Knowledge Products that must be assessed" in step 3 | `docs/qa-context.md:29`; archived `ingestion--step-1-loads` S-9 |

## 4. Proposed Outcome

1. **Lead (P2-3912).** In step 3 a Lead opens a round-2 result of their scope and sees the same Review page. Only core fields can be acted on; the other fields are read-only context.
   - Each round-1 core comment shows its whole thread: the assessor's comment, the value then and now, the program's response, any clarification, and "Updated" when the field changed.
   - The Lead validates corrected fields. On each disagreement they choose **Agree with the program** (the comment closes and the field turns green) or **Escalate to TPB** (the comment stays open). Both need a comment.
   - Ending the review:
     - Every core field green ends **Quality Assessed** automatically and sends `qaed`.
     - Otherwise "Finish review" with at least one escalation ends **Pending for TPB review**. No release is sent.
2. **Common model.**
   - One assessment per membership and step, as today: step 3 for the Lead, 4 for the TPB, 5 for the PPU.
   - One **decision** record per comment and role.
   - Comment states follow TRD 7.3.
   - One status table, extended with `pending_tpb_review`, `pending_ppu` and `unresolved`.
   - One release, sent only when the membership finally reaches Quality Assessed.
3. **TPB and PPU (designed, not built).** Each is a role row plus decision kinds on the same tables. No new model.

## 5. Scope

| In (P2-3912, built) | In (designed only) |
|---|---|
| Enable the LEAD_ASSESSOR role row (round 2, step 3, write) | TPB: escalated items, two decisions, "Pending PPU" (P2-3916) |
| Lead worklist and view of round-2 memberships, core fields only | PPU: cases, "Done", "Unresolved" after step 5 closes, "Changed in Reporting" (P2-3917) |
| The round-1 thread on each core field (comment, response, clarification, value then/now, "Updated") | Release on the final Quality Assessed reached in step 4 or 5 |
| Decisions: validate, Agree with the program, Escalate to TPB, each with a comment where required | |
| Finish review and the round-2 end: Quality Assessed (`qaed`) or Pending for TPB review (no release) | |
| Fix the round-2 `returned` path above | |
| Lead deletes another reviewer's comment, with history (AC11) | |
| Status table rows, migration `0013`, front contract for Yeck | |

## 6. Non-Goals

- Escalating a non-core comment (P2-3912 out of scope).
- Returning a result to the program in round 2.
- TPB and PPU routes and screens, and enabling their rows.
- Notifications. The comments export (P2-3914).
- Changing round 1, apart from the shared end helper.

## 7. Affected Users, Systems, And Specs

| Area | Effect |
|---|---|
| `server/src/assessment/` | Role row, scope, view (round-1 thread), write rules for round 2, decisions, end, status table, errors |
| Migration `0013` (next free number on `staging-center` and `dev`) | Assessment status `escalated`; comment state `lead_sided_program`; `comment_decisions` table; comment deletion columns; audit actions |
| `sp-view/` | Round-2 comments (the Lead's) are **not** shown to the program |
| `release.service.ts` | Unchanged sender. A round-2 end inserts a row only on Quality Assessed |
| Front (Yeck) | `review-*`, `results-*`: Lead mode of the Review page. **Coordination needed** (see § 12) |
| Specs | `assessment/step-1-assessment` (status table, end rule) is extended, not rewritten. `assessment/ai-suggestions` already serves LEAD |
| `docs/qa-context.md` | Step 3 to be corrected to the ticket, once confirmed |

## 8. Visual Reference

- **Source:** None.
- **Location:** n/a.
- **Notes:** the Lead uses the step-1 Review page (sections, cards, Core tag, comments). The new pieces are a thread block on core cards and the two decision buttons. The design is described in the front contract; Yeck builds it.

## 9. Requirement Delta Preview

### ADDED

- **Lead worklist (step 3).** Round-2 memberships in the Lead's result types and programs, while step 3 is open. (AC2, AC15)
- **Round-1 thread per core field,** read from the previous membership. (AC4, AC5)
- **Decisions on a disagreed core comment:**
  - `agree_program` closes the comment and greens the field (AC7, AC8).
  - `escalate` keeps the comment open (AC9).
  - Both carry a required comment, and can be changed until the review ends (AC12).
- **Lead's own core comment marked "escalate".** It covers a grey core field with no round-1 comment, and the KP case. (AC10)
- **Finish review in round 2.**
  - Every grey core field must be escalated; otherwise 409.
  - Result: Pending for TPB review (AC14), or Quality Assessed (AC13).
- **Status rows:** `pending_tpb_review` now; `pending_ppu` and `unresolved` declared for 3916/3917.
- **Comment deletion by the Lead,** kept in history (AC11).

### MODIFIED

- **The Finish of round 2 no longer returns.** `endOnFinish` is reused: the "commented" fact becomes "escalated", and its `returned` maps to `escalated`.
- **Writes in round 2 accept only core fields.**

### REMOVED

- None.

## 10. Approach Options

| Option | What | For | Against |
|---|---|---|---|
| **A. One assessment per step + a decisions table** (recommended) | The Lead's step-3 assessment holds validations and the Lead's own comments. `comment_decisions` (comment, role, decision, body, actor) holds Lead, TPB and PPU decisions on round-1 comments. Comment states follow TRD 7.3 | Reuses the validate/comment/finish paths, locks, releases and status table. TPB and PPU add rows, not tables | One migration with several changes |
| B. Decisions as new comment rows | A Lead "agree"/"escalate" is a comment with a kind | No new table | Comments and decisions get mixed in counts, the export and the SP view. Finish rules get harder |
| C. A separate `escalation` module with its own cases table | Cases created at escalation, owned by a new module | Clean boundary | Duplicates scope, locks, view and release logic that `assessment/` already has. Biggest change |

## 11. Recommended Approach

**Option A.** It is the smallest path that reuses what exists:

- `ROLE_STEPS` (enabling the row);
- the scope rows;
- the writes with lock order timeline → assessment;
- `endOnFinish` / `endAfterValidation`;
- the release outbox;
- `QA_STATUSES`.

The new parts are three:

1. **Decision table.** Decisions live in their own table, keyed by comment and role and unique per pair. They can be changed until the assessment ends and are frozen after that.
2. **Previous-membership read.** The view reads the previous membership's step-1 comments in one query per view, with no query per row.
3. **Round-2 end mapping.** Escalated means "handed to the next step": the assessment ends `escalated` and sends no release.

## 12. Risks, Dependencies, And Open Questions

| # | Item | Default proposed |
|---|---|---|
| OQ-1 | **The Lead's role.** `qa-context.md` (Santi, 2026-11-12): the Lead highlights any commented field and does not close. P2-3912: the Lead validates, closes, escalates core disagreements only, and finishes | **The ticket.** `qa-context.md` gets corrected after your OK |
| OQ-2 | **Who reviews a result NEW to round 2** (no round-1 assessment: a KP or any type entered at step 3). S-9 says KPs to review go through step 1 | **The Lead does a full core review.** They validate, or comment and escalate (AC10 extended to every type) |
| OQ-3 | **Round-1 greens.** A core field the assessor greened in round 1 and the program did not change | **Carried green** into the Lead's assessment when it has no round-1 comment and is not in `changed_fields`. The Lead can un-green it |
| OQ-4 | **A round-1 comment left `open` or `clarification_requested`** (the program re-submitted without answering) | **Treated as a disagreement:** the Lead can agree with the program or escalate |
| OQ-5 | **An `accepted` comment whose field the Lead still finds wrong** | The Lead leaves it grey, writes their own comment and escalates it (same rule as OQ-2) |
| OQ-6 | **Field config pinning.** The round-2 assessment pins the version in force at step 3, so the core set may differ from round 1 | **Keep the pin rule (DD-3).** A round-1 comment on a field that is no longer core is shown read-only and does not block |
| OQ-7 | **Step 3 closes with Lead reviews not finished** | Out of scope. The review stays "Pending", read-only; same as step 1 today |
| OQ-8 | **Delete (AC11)** | **Soft delete** (`deleted_at`, `deleted_by`). Only another reviewer's comments within the Lead's result types; the history shows who and when. Never a round-1 comment the program already answered |
| R-1 | **Front:** the Lead mode touches `review-*` / `results-*` (Yeck) | Back first, plus a `front-contract.md`. The front tasks are assigned to Yeck or coordinated with Yeck before anyone touches those files |
| R-2 | **The `returned` defect in round 2** (§ 3) is reachable today only if someone enables the Lead row | Fixed in this spec, test first |
| R-3 | **Migration numbering.** Other open branches might also take `0013` | Checked on `staging-center` and `dev` (2026-11-19: last is `0012`). Check again before merging |

## 13. Success Criteria

- **AC1–AC15 of P2-3912 pass** in unit and e2e. Each AC is mapped to a test in `tasks.md`.
- **One whole round 2 works end to end in e2e:**
  - round 1 returned;
  - SP disagree;
  - re-submitted at step 3;
  - Lead agrees on one disagreement and escalates another;
  - status Pending for TPB review;
  - no release row.
- **The Quality Assessed path in round 2** sends exactly one `qaed` and ends the membership `released_qaed`.
- **Shared code is unchanged in effect:** step-1 suites, AI suggestions and the SP view stay green.
- **The design names what TPB and PPU add:**
  - a role row;
  - decision kinds;
  - status rows;
  - the end rules.

  Nothing else.

## 14. Next Step

```text
/akili-specify escalation/round-2
```
