# Round 2: Lead Assessor, TPB and PPU — Design

## 1. Document Control

| Spec path | Requirements | Status | Last updated |
|---|---|---|---|
| `docs/specs/escalation/round-2` | `requirements.md` (FR-1 … FR-17, NFR-1 … NFR-6) | Draft — waiting for the back lead's OK | 2026-11-19 |

| Field | Value |
|---|---|
| Verified at | `3750182` (`origin/staging-center`, 2026-11-19) |
| Builds on | `assessment/step-1-assessment` design (DD-1 … DD-16), `assessment/ai-suggestions`, P2-3911 SP view |
| Code home | `server/src/assessment/`. The TRD lists an `escalation` module; this design keeps the code in `assessment/` (DD-1) |
| Budget | § 13 |

## 2. Executive Summary

Round 2 reuses the step-1 machine:

- one assessment per membership and step;
- the same writes and lock order;
- the same end helpers (`endOnFinish` / `endAfterValidation`);
- the same release outbox and status table.

Four additions carry the Lead, and later the TPB and PPU:

1. **A decisions table.** One row per comment and role, changeable until that role's assessment ends.
2. **A current-step rule.** The status and the worklist read the assessment of the membership's current step, not always step 1.
3. **A round-2 end mapping.** Grey core fields that are all escalated end the assessment `escalated`, which sends no release. All green ends `quality_assessed` and sends `qaed`.
4. **A thread read.** One query per view gathers the previous membership's step-1 comments, responses, clarifications and decisions.

## 3. Architecture Overview

```
Lead ──HTTP──▶ AssessmentController ──▶ AssessmentService ──▶ AssessmentUnitOfWork (MySQL, READ COMMITTED)
                     │                        │   ├─ role-steps (LEAD row enabled, round 2, step 3)
                     │                        │   ├─ round2-rules (pure: core-only, decidable, end mapping)
                     │                        │   └─ assessment-rules (endOnFinish / endAfterValidation, reused)
                     │                        ├──▶ ThreadStore (one SELECT per view: previous membership's thread)
                     │                        └──▶ ReleaseDispatcher (only on quality_assessed)
SP view ─────────────────────────────────────▶ unchanged reads: round-2 rows never get visible_to_program_at
```

The flow for one result:

1. **Round 1.**
   - The assessor ends the assessment `returned`.
   - The program answers in step 2.
   - The result is re-submitted.
   - The sync inserts the round-2 membership, with `previous_membership_id` and `changed_fields`.
2. **Step 3.**
   - The Lead's assessment row is created on the first write, as in step 1.
   - Decisions are written to `comment_decisions`.
   - The review ends as one of:
     - `quality_assessed`: release `qaed`, then the ack ends the membership `released_qaed`;
     - `escalated`: status Pending for TPB review; the membership stays active for step 4.

## 4. Extended Directory Structure

| Path | Change |
|---|---|
| `server/src/assessment/role-steps.ts` | LEAD row `enabled: true`. The current-step helper by round (DD-3) |
| `server/src/assessment/round-two-rules.ts` (new, pure) | Core-only check, decidable states, the effective green (carried), the round-2 end mapping over `endOnFinish` / `endAfterValidation` |
| `server/src/assessment/assessment-rules.ts` | Unchanged; reused (DD-5) |
| `server/src/assessment/qa-status.ts` | Rule row `pending_tpb_review`; the round-2 rows read the current step's assessment (DD-3) |
| `server/src/assessment/comment-transitions.ts` | Actor `lead` (later `tpb`, `ppu`); transitions `disagreed\|open\|clarification_requested → escalated\|lead_sided_program` and the delete event |
| `server/src/assessment/assessment.service.ts` | Round-2 branches in validate / comment / finish / withdraw; new `decide`, `clearDecision`, `deleteComment` |
| `server/src/assessment/assessment.store.ts`, `assessment.unit-of-work.ts` | Thread read; decision, delete and end-state writes |
| `server/src/assessment/assessment-view.ts` | `round`, per-field `updated`, `actionable`, `thread`, `effectiveValidated`, `carried` |
| `server/src/assessment/worklist.store.ts` | Join on the current step's assessment (DD-3) |
| `server/src/assessment/assessment.controller.ts`, `dto/`, `models/` | `PUT` / `DELETE …/decisions/:commentId`, `POST /assessment-comments/:id/delete` |
| `server/src/assessment/assessment.errors.ts`, `common/error-codes.ts` | 4 new codes (§ 6) |
| `server/src/database/drizzle/schema/*` + `server/drizzle/0013_round_two.sql` + `drizzle/rollback/0013_round_two.down.sql` | § 5 |
| `docs/specs/escalation/round-2/front-contract.md` (new) | FR-17 |
| `client/src/app/pages/workspace/review/**`, `results/**` | **Yeck's**: Lead mode (§ 8). Not touched by the back tasks |

## 5. Data Model (migration `0013_round_two`)

| Table | Change | Why |
|---|---|---|
| `result_assessments.status` | Add `escalated` to the enum. The CHECK is unchanged (`escalated` is a finished state: `finished_at` and `finished_by` are set) | FR-11, FR-14 |
| `assessment_comments.state` | Add `lead_sided_program` (closed) | FR-8. TRD 7.3 has no state for "Lead agrees with the program"; DD-6 |
| `assessment_comments` | Add `deleted_at DATETIME NULL` and `deleted_by INT UNSIGNED NULL` (FK users). CHECK: both null or both set. A deleted comment keeps its `state` | FR-10 |
| `comment_decisions` (new) | `id`, `comment_id` (FK), `assessment_id` (FK: the deciding role's assessment), `role_code` varchar(32), `decision` enum(`agree_program`, `escalate`, `tpb_agree_program`, `tpb_agree_assessor`, `ppu_done`), `body` varchar(2000) NULL, `decided_by` (FK users), `decided_at`, `updated_at`. **Unique (`comment_id`, `role_code`)**. CHECK: `body` is not null unless `decision = 'ppu_done'` | FR-8, FR-9, § 12 |
| `comment_events.to_state` | Follows the `commentStates` enum (`lead_sided_program`) | ADR-006 |
| `assessment_audit_events.action` | Add `decision_set`, `decision_clear`, `comment_delete`, `end_escalated` | FR-8, FR-10, FR-11 |

Further rules:

- **A decision row is changeable** (upsert on the unique key, or delete) only while its `assessment_id` row is `pending`. Its history is in `assessment_audit_events`. When the assessment ends, the row is frozen, and the comment state plus a `comment_events` row record it.
- **No backfill is needed.** Every new column is nullable, and the enum additions are appended.

## 6. API Design

All routes are under `/api/v1`, with the existing envelope and scope 404.

| Method | Path | Roles | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/timelines/:t/results/:code/assessment` | ASSESSOR, LEAD (row by round), ADMIN (read) | — | Step-1 view + `round`; per field `updated`, `actionable`, `effectiveValidated`, `carried`, `thread[]`. Each thread item: `{ commentId, author, createdAt, body, valueCopy, state, response?, clarifications[], decision?, decidable, choices[] }` | 404 |
| PUT | `/timelines/:t/results/:code/assessment/validations` | ASSESSOR (r1), LEAD (r2) | unchanged | unchanged + `effectiveValidated` | + `ASSESSMENT_FIELD_NOT_CORE`, `ASSESSMENT_FIELD_ESCALATED` (r2) |
| POST | `…/assessment/comments` | ASSESSOR, LEAD | unchanged | unchanged | + `ASSESSMENT_FIELD_NOT_CORE` (r2) |
| PUT | `…/assessment/decisions/:commentId` | LEAD (TPB, PPU later) | `{ decision, body }` | `{ decision, validations, status, assessedBy?, finishedAt? }` | 400 body, 404, 409 `ASSESSMENT_DECISION_INVALID`, `ASSESSMENT_FINISHED`, step closed |
| DELETE | `…/assessment/decisions/:commentId` | LEAD | — | same shape | 404, 409 `ASSESSMENT_FINISHED` |
| POST | `…/assessment/finish` | ASSESSOR, LEAD | unchanged | status ∈ `quality_assessed`, `returned` (r1), `escalated` (r2) | + `ASSESSMENT_CORE_UNDECIDED` with `fields` (r2) |
| POST | `/assessment-comments/:id/delete` | LEAD | — | the comment, with `deletedAt` and `deletedBy` | 404, 409 `ASSESSMENT_COMMENT_NOT_DELETABLE`, `ASSESSMENT_FINISHED` |
| POST | `/assessment-comments/:id/withdraw` | author | unchanged | unchanged | The window also opens during step 3 for a round-2 comment |

**New codes:**

| Code | Status |
|---|---|
| `ASSESSMENT_FIELD_NOT_CORE` | 409 |
| `ASSESSMENT_FIELD_ESCALATED` | 409 |
| `ASSESSMENT_DECISION_INVALID` | 409 |
| `ASSESSMENT_CORE_UNDECIDED` | 409, with `fields: string[]` |
| `ASSESSMENT_COMMENT_NOT_DELETABLE` | 409 |

All five go into `common/error-codes.ts` and `front-contract.md`. `ASSESSMENT_CORE_UNDECIDED` joins `ASSESSMENT_CORE_UNCOMMENTED` as a code whose `fields` the filter forwards.

**Idempotency.** A decision is a PUT (the same body twice gives the same state), so there is no `Idempotency-Key`. A delete is conditional: a second delete is 409 `ASSESSMENT_COMMENT_NOT_DELETABLE`.

## 7. Backend Module Design

**Write path** (every round-2 write). The lock order is the step-1 order:

1. timeline `FOR SHARE`;
2. assessment `ensureAssessment` / `lockAssessment` `FOR UPDATE`;
3. then the children.

A decision or a delete on a **round-1** comment also takes that comment's row `FOR UPDATE`, after the round-2 assessment lock. It never locks the round-1 assessment row: that row is finished, and only the release ack (which never touches comments) takes it.

**Round-2 rules** (`round-two-rules.ts`, pure, table-tested):

| Function | Input → output |
|---|---|
| `isActionable(field)` | Assessed and core in the pinned version |
| `isDecidable(comment, field, role)` | Lead, round-1 comment: state ∈ {`disagreed`, `open`, `clarification_requested`} and not deleted, field actionable → `agree_program` \| `escalate`. Lead's own round-2 comment, not withdrawn → `escalate` only. Anything else → none |
| `effectiveGreen(field, stored, round1)` | stored ?? (round-1 green ∧ no round-1 comment ∧ ∉ `changed_fields`) |
| `endRoundTwoOnFinish(core)` | Maps the facts to `CoreFieldState` (`validated` = effective green, `commented` = has an `escalate` decision) and calls `endOnFinish`. Its `returned` becomes `escalated`, and its `core_uncommented` becomes `core_undecided` |
| `endRoundTwoAfterWrite(core)` | `endAfterValidation(core)` with effective greens (round > 1, so comments are not read) |

**End application** (`applyEnd` gains a round-2 branch):

- `quality_assessed`:
  - the end UPDATE, as today;
  - the release row `qaed`;
  - the Lead decisions applied (`agree_program` → `lead_sided_program`; an `escalate` cannot exist on a green field);
  - one `comment_events` row per change;
  - audit `end_quality_assessed`.
- `escalated`:
  - the end UPDATE;
  - **no release row**;
  - decisions applied (`escalate` → `escalated`, `agree_program` → `lead_sided_program`);
  - events;
  - audit `end_escalated`.
- **Round 2 never calls `markCommentsVisible`** (FR-15).

**Thread read** (NFR-1). One SELECT joins:

- the previous membership's step-1 assessment comments (not withdrawn, not deleted);
- the latest `sp_comment_responses` row per comment;
- the clarification requests and answers;
- the Lead decision.

It is ordered by field, then comment, then event time. The service groups it in memory. Clarification pairs come from the responses with `kind = request_clarification` joined to `comment_clarification_answers`; the full response history adds no statement.

**Scope.** `ReviewerRow` already carries `round` (`scope.ts:46-50`). Enabling the LEAD row gives `round: 2`, `audience: 'lead_assessors'`, and the scope from LEAD grants and programs. `assessmentStep` (`assessment.service.ts:1366-1377`) picks the step from the caller's row. ADMIN gets the current step (DD-3).

**Logging.** `loggedWrite` actions gain `decide`, `decision_clear` and `delete`, with ids only.

## 8. Frontend / UX Component Architecture (Yeck's; contract only here)

| Piece | Behaviour |
|---|---|
| Review page in round 2 | Same page. Non-actionable fields render as View only (no check, no comment box). Header status as today |
| Thread block on a core card | Items in order: assessor's comment (value then / now), program response, clarifications, Lead decision. "Updated" tag from `updated` |
| Decision controls | On `decidable` items: "Agree with the program" and "Escalate to TPB", each opening a required comment (≤ 2000). The current decision is shown and can be changed or cleared until the end |
| Carried green | The check shows green with a hint ("Green in round 1, unchanged") from `carried` |
| Finish review | Same footer action. A 409 `ASSESSMENT_CORE_UNDECIDED` lists the fields, like `ASSESSMENT_CORE_UNCOMMENTED` today |
| Delete | On another reviewer's comment where allowed. The history shows "Deleted by … on …" |

States: loading, error, empty thread (new result), read-only (step closed / finished). No new tokens.

## 9. Shared Contracts or Package Extensions

- `front-contract.md` (new, this folder): the view additions, the 3 routes, the 5 codes, and the round-2 status values.
- `client/src/app/core/api/assessment.models.ts` mirrors the contract. That is Yeck's task, since 19 client files import it.

## 10. Design Decisions

| ID | Decision | Alternatives rejected | Consequence | Requirements |
|---|---|---|---|---|
| DD-1 | Code stays in `server/src/assessment/`; the spec lives under `escalation/` | A new `escalation` module (TRD § 4) | No second copy of scope, locks, view, release or bindings (`assessment/AGENTS.md` DD-1). TRD § 4 row to be updated at archive: a pending item, not edited on this branch | all |
| DD-2 | Decisions live in their own table, one per comment and role, changeable until the role's assessment ends | Decisions as comments; or as comment states written at once | Draft decisions are not program-visible states. TPB and PPU add enum values, not tables | FR-8, FR-9, FR-16 |
| DD-3 | **Current step.** A round-1 membership reads the `assessors` step's assessment. A round-2 membership reads the latest existing assessment among steps 3–5, else step 3. The status table and the worklist join use that one rule | Always the caller's step | ADMIN and every role see one status. The TPB/PPU worklists inherit it | FR-14 |
| DD-4 | Carried greens are **computed, not copied**: the stored row wins, else the round-1 fact | Seed rows on creation | No write on read, no seed race. One extra column in the thread read | FR-7 |
| DD-5 | Reuse `endOnFinish` / `endAfterValidation` through a round-2 mapping (escalate = "commented", `returned` → `escalated`) | A new end function | One end rule, as the 2026-11-18 comment asks. The rule file stays unchanged | FR-11, FR-12, FR-13 |
| DD-6 | Add comment state `lead_sided_program` | Reuse `accepted` (it is a program state) or `done` (PPU) | Reports and the export (P2-3914) can tell who closed a comment | FR-8 |
| DD-7 | Comment states are written **at the end**, not at decision time | Write states on each decision | The thread never shows half-applied states; a changed decision costs nothing | FR-8, FR-11 |
| DD-8 | Round-2 ends never mark comments visible to the program | Reuse `markCommentsVisible` | The SP view stays round-1 only | FR-15 |
| DD-9 | Soft delete with `deleted_at` / `deleted_by` | A `deleted` comment state | The state history stays intact; one CHECK | FR-10 |
| DD-10 | Front work is Yeck's, from `front-contract.md` | The back agent edits `review-*` | Team rule (the brief). Back PR first | FR-17 |

**Reversion challenge (Step 2.3).**

- DD-5 and FR-13 remove the round-2 path to `returned` / `not_qaed`. *What breaks?* No release in round 2 could ever be acknowledged: `endAsReturned` refuses round 2 (`loads.store.ts:765-772`), so the row stayed `pending` forever. Nothing in the tree reaches that path today, because the Lead row is disabled. **Breaks nothing.**
- DD-8 removes `markCommentsVisible` from round-2 ends. *What breaks?* Nothing: no round-2 end exists today.

## 11. Premise Ledger

Verified: 15 · UNVERIFIED: 3 (High 1, Low 2).
Blast-radius triggers:

- `live-path` (Lead opens / writes a result);
- `shared-state` (status table, end helpers, `applyEnd`, enums read by several readers);
- `consumer` (enums, view shape, error codes).

| # | Claim | Class | Citation (as run) | Verified at | If false | Settled by |
|---|---|---|---|---|---|---|
| P-1 | The LEAD row exists, `round: 2`, `audience: 'lead_assessors'`, disabled | location | `server/src/assessment/role-steps.ts:38-45` | 3750182 | FR-1 needs a new row, not an enable (Low) | — |
| P-2 | A re-submitted round-2 membership holds `previous_membership_id` and `changed_fields` | data-env | `schema/timeline-results.ts` (columns `previousMembershipId`, `changedFields`); archived timeline-sync FR-5/FR-8 | 3750182 | The thread read has no anchor; DD-4 and FR-4/FR-5 change (High) | — |
| P-3 | `escalated`, `tpb_sided_*` and `done` are already in the comment enum | existence | `schema/assessment-comments.ts:22-33` | 3750182 | `0013` adds more values (Low) | — |
| P-4 | Round 2 today: `endOnFinish` gives `returned` for a grey commented core field | existence | `npx tsx -e …endOnFinish([{validated:false,commented:true},{validated:true}], false)` → `"returned"` (2026-11-19) | 3750182 | FR-13 is not a defect; T-2 becomes a pin test (Low) | — |
| P-5 | `applyEnd` queues a release for every end and marks comments visible | live-path | `assessment.service.ts:599-640` (`insertRelease` at :615, `markCommentsVisible` at :623) | 3750182 | DD-8 / FR-15 need no change (Low) | — |
| P-6 | The ack ends `qaed` in any round, `not_qaed` in round 1 only | live-path | `ingestion/loads.store.ts:765-772`, `:800-801` | 3750182 | FR-12's `released_qaed` for round 2 needs an ingestion change (High) | — |
| P-7 | Writes resolve the step from the caller's reviewer row; ADMIN falls back to the first enabled writer (`assessors`) | live-path | `assessment.service.ts:1366-1377` | 3750182 | DD-3 not needed for ADMIN (Low) | — |
| P-8 | Live path of a Lead open: controller → `open` → `resolveMembership` → `findMembership` with `assessmentStepPosition` from `assessmentStep` → view | live-path | `assessment.service.ts:1081-1088`, `:1210-1237`; `assessment.store.ts:320-380` | 3750182 | Round-2 branches go elsewhere (High) | — |
| P-9 | The status reads the role's step assessment; there are no rules for `pending_tpb_review` | shared-state | `qa-status.ts:55-76`; readers: `statusOf` (TS) and `statusSqlCase` (worklist SQL) | 3750182 | FR-14 is already partly built (Low) | — |
| P-10 | `endOnFinish` / `endAfterValidation` readers | shared-state | `grep -rln "endOnFinish\|endAfterValidation" server/src server/test` → `assessment-rules.ts`, `assessment-rules.spec.ts`, `assessment.service.ts` | 3750182 | Another reader would need the mapping (Low) | — |
| P-11 | `ROLE_STEPS` readers | shared-state | `grep -rln ROLE_STEPS server/src server/test` → `scope.ts`, `quick-comments.service.ts`, `role-steps.ts`, `role-steps.spec.ts` | 3750182 | Quick comments for LEAD start working too; checked in T-4 (Low) | — |
| P-12 | `commentStates` consumers | consumer | `grep -rln commentStates server/src server/test` → `schema/comment-events.ts`, `schema/assessment-comments.ts`, `comment-transitions.spec.ts`, `models/assessment.model.ts` | 3750182 | Missed consumer breaks the build (Low) | — |
| P-13 | `resultAssessmentStatuses` / `assessmentAuditActions` consumers | consumer | The same grep → only their own schema files | 3750182 | (Low) | — |
| P-14 | The view shape is consumed by the front | consumer | `grep -rl "assessment.models" client/src \| wc -l` → 19 files. QA status values in `client/src/app/pages/workspace/results/qa-status.ts`, `pages/sp/sp-format.ts`, `results.mapper.spec.ts` | 3750182 | The front breaks on additive fields only if it validates strictly (Low) | — |
| P-15 | LEAD reads AI suggestions as `reviewer` once the row is enabled | location | `ai-suggestions-rules.ts:37` | 3750182 | FR-6 needs a rules change (Low) | — |
| P-16 | The latest SP response per comment is the one that counts; responses never touch validations | data-env | `schema/sp-comment-responses.ts` header; `assessment/AGENTS.md` SP rules ("A response changes the comment only") | 3750182 | The thread must read the state, not the response (Low) | — |
| P-17 | No real round-2 membership with responses exists on qatest yet; the in-memory world can build one (`runRealLoad`) | data-env | `UNVERIFIED — confirm at source before relying on it` | — | The HITL needs a staged round on qatest (Low) | T-14, back lead |
| P-18 | Tests that pin the disabled LEAD row (they flip when it is enabled) | consumer | `grep -rln "LEAD_ASSESSOR\|LEAD_ACCESS" server/src/assessment server/test` → 19 files, assessment ones: `scope.spec.ts`, `worklist.service.spec.ts`, `ai-suggestions-rules.spec.ts`, `role-steps.spec.ts` (others are users/admin-config) | 3750182 | A missed pin goes red in CI (Low) | — |
| P-19 | Business: the Lead closes and finishes (P2-3912), not "highlight only" (`qa-context.md:14`) | other | `UNVERIFIED — confirm at source before relying on it` (user-stated through the ticket) | — | FR-8, FR-11 and DD-2 change shape (High) | The back lead's OK at this gate (OQ-1); Angel to ratify |
| P-20 | Migration numbering: last is `0012` on `staging-center` and `dev` | data-env | `git ls-tree --name-only origin/dev server/drizzle/` → last `0012_ai_usage_indicative.sql` (2026-11-19) | 3750182 | Rename to the next free number (Low) | Re-checked in T-3 before merge |
| P-21 | MySQL enum appends and the new CHECKs apply on qatest's MySQL 8 | data-env | `UNVERIFIED — confirm at source before relying on it` | — | `0013` is rewritten (Low) | T-14 |

## 12. TPB and PPU on the same model (designed, not built)

| Piece | TPB (P2-3916, step 4) | PPU (P2-3917, step 5) |
|---|---|---|
| Role row | Enable `TPB` (round 2, `tpb`) | Enable `PPU` (round 2, `ppu`) |
| Worklist | Round-2 memberships whose Lead assessment is `escalated` (DD-3 → status Pending for TPB review), within types and programs, while step 4 is open | Status Pending PPU or Unresolved, within types and programs. **No window** for Done (AC: cases stay open after step 5) |
| Items | Comments in state `escalated` (round-1 or the Lead's own) | Comments in state `tpb_sided_assessor` |
| Decisions | `tpb_agree_program` (field green in the TPB's step-4 assessment) or `tpb_agree_assessor` (PPU case). Body required | `ppu_done`, optional body; the field turns green. Never automatic |
| Effective green | The step-3 effective greens carried forward (DD-4 extended) + TPB greens | The step-4 greens + Done |
| End | Finish requires a decision on every item → `escalated` (any `tpb_agree_assessor` → Pending PPU) or `quality_assessed` (`qaed`). Comment states written at the end (DD-7) | Auto `quality_assessed` (`qaed`) when the last case is Done. No Finish |
| New status rows | `pending_ppu`: the current step-4 assessment ended `escalated` | `unresolved`: Pending PPU **and** the PPU step closed. The status gets a 5th input, "current step closed", bound per timeline in SQL (DD-3 extended) |
| Extra | Quick comments for the TPB role (existing route). AI read-only with the mark (FR-5 of ai-suggestions) | "Changed in Reporting on <date>" needs a fresh value after the TPB decision. Open: a round-2 membership is not reloaded (`ALREADY_IN_THIS_TIMELINE`). To be decided in P2-3917: a Reporting read on view, or a sync rule |
| Migration | None beyond `0013` | None beyond `0013` |

## 13. Budget (tripwire for `/akili-execute`)

| Measure | Expected |
|---|---|
| Tasks | 14 (12 back, 1 front by Yeck, 1 HITL) |
| LOC | ~2,300 back (≈ 900 src, 1,400 tests) + migration ~80. Front: Yeck's estimate |
| Review rounds | ~16 (one per task, plus 2 for T-7 and T-9, the decision and end logic) |
