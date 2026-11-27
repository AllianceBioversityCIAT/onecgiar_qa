# Round 2, step 4: the Third-Party Broker — Design

## 1. Document Control

| Spec path | Requirements | Builds on | Last updated |
|---|---|---|---|
| `docs/specs/escalation/round-2-tpb` | FR-1 … FR-14, NFR-1 … NFR-3 | `escalation/round-2` design (DD-1 … DD-11, § 12) | 2026-11-26 |

## 2. Executive Summary

This design is the round-2 § 12 TPB column, built on the Lead's machine:

- the same writes, locks, decision table and end helpers;
- one role branch where the Lead's rules differ.

There is no migration and no new error code.

## 3. Pieces

| Piece | Change |
|---|---|
| `role-steps.ts` | TPB row `enabled: true` |
| `scope.ts` | `MembershipFacts.leadEscalated`. `rowCovers` lets a TPB row cover a membership only when it is `true` (DD-T2) |
| `worklist.store.ts` | `reviewerRowCondition` adds the same test as SQL: an `EXISTS` on a `result_assessments` row of the membership whose step is the timeline's `lead_assessors` step, in status `escalated` |
| `assessment.store.ts` | Membership read: `leadAssessment` (`{ id, status, fieldConfigVersion }`, the step-3 row). `findEscalationThread`: one statement over the round-1 and step-3 assessments, with both the TPB's and the Lead's decision |
| `qa-status.ts` | Fifth input `currentStep` (the audience of the current assessment's step). Rows `pending_ppu` (tpb, `escalated`) and `pending_tpb_review` (tpb, `pending`) come before the generic ones |
| `round-two-rules.ts` | `isTpbDecidable(state)`, `tpbFieldGreen(items)`, `tpbUndecidedFields(...)` (pure) |
| `comment-transitions.ts` | Actor `tpb`: `escalated → tpb_sided_program`, `escalated → tpb_sided_assessor` |
| `assessment.service.ts` | Decide, clear and finish branch on the role. `applyEnd` applies the deciding role's decisions. Validate, comment and delete refuse a TPB |
| `assessment-view.ts` | `ThreadItem` gains `round` and `leadDecision?`. The TPB annotation: decidable on `escalated` items, step-4 effective green |
| `dto/decide-comment.body.ts` | Accepts the TPB values. The service judges the role |
| `acting-role.ts` | Nothing: `TPB` joins `actingRoleCodes()` once the row is enabled |

## 4. Data

No migration (NFR-2). The step-4 assessment is a `result_assessments` row (membership, step 4, `role_code = 'TPB'`), created on the TPB's first write as in step 1 (DD-3). It **pins the Lead's configuration version** (DD-T4).

| Write | Where |
|---|---|
| Decision | `comment_decisions` (`comment_id`, `assessment_id` = step-4 row, `role_code = 'TPB'`, `decision`, `body`, `decided_by`, `decided_at`, `acted_as_admin`) |
| Field green | `assessment_field_validations` of the step-4 row |
| End | `result_assessments.status` (`escalated` / `quality_assessed`), `finished_by`, `finished_at`, `finished_as_admin` |
| Comment state at the end | `assessment_comments.state` + `comment_events` (`actor_role = 'TPB'`) |
| Audit | `decision_set`, `decision_clear`, `end_escalated`, `end_quality_assessed` |
| Release | `assessment_releases` `qaed`, on `quality_assessed` only |

## 5. API

There are no new routes. These are the existing ones, as a TPB sees them:

| Method | Path | TPB |
|---|---|---|
| GET | `/timelines/:t/results/:code/assessment` | View (FR-1, FR-3, FR-4) |
| PUT | `…/assessment/decisions/:commentId` | `{ decision: 'tpb_agree_program' \| 'tpb_agree_assessor', body }` |
| DELETE | `…/assessment/decisions/:commentId` | Clears the decision |
| POST | `…/assessment/finish` | `quality_assessed` or `escalated` |
| PUT `…/validations`, POST `…/comments`, POST `/assessment-comments/:id/delete` | — | 403 `ASSESSMENT_READ_ONLY` |
| GET/POST | `/quick-comments?role=TPB` | The TPB list |

## 6. Rules

**Decidable (TPB):**

- The item's state is `escalated`.
- It is not deleted.
- It sits on a comment of the previous round-1 assessment or of the Lead's step-3 assessment.
- Choices are `tpb_agree_program` and `tpb_agree_assessor`.
- `ended` (the review is finished or the step is not writable) gives `[]`, as for the Lead (T-17).

**Field green (FR-6):** after every decision or clear, the field's step-4 validation is set to "every live escalated item on the field is decided `tpb_agree_program`". It is written only when it differs from the step-4 effective green.

**Step-4 effective green:**

```
eff4(key) = stored4(key) ?? eff3(key)
eff3(key) = stored3(key) ?? carried(key)
```

`carried` is round-2 DD-4. It is computed on read, never copied.

**Finish (FR-8):**

1. Fields with an escalated item and no TPB decision → `ASSESSMENT_CORE_UNDECIDED` (sorted fields).
2. Otherwise the core facts are `effectiveGreen = eff4` and `escalated = has a tpb_agree_assessor`. They go through `endRoundTwoOnFinish`:
   - all green → `quality_assessed`;
   - grey fields that all carry an assessor decision → `escalated`.
   - A grey field without one cannot remain after step 1 (it would be an undecided item), but if it ever does, the rule answers `core_undecided`.

**End application:** `applyEnd` writes, in order:

- the conditional end UPDATE;
- the release row (`quality_assessed` only);
- the TPB decisions as states (`tpb_agree_program → tpb_sided_program`, `tpb_agree_assessor → tpb_sided_assessor`, from `escalated`, one `comment_events` row each);
- the end audit row.

## 7. Design Decisions

| ID | Decision | Rejected | Why / consequence | FR |
|---|---|---|---|---|
| DD-T1 | **No auto-end.** A TPB decision never ends the review. Finish is the only end (OQ-1) | Mirror the Lead's FR-12 auto-end | AC9: "explicitly with Finish; the decision cannot be changed after finishing". The Lead's precedent would freeze a decision without Finish | FR-8 |
| DD-T2 | The TPB row covers a membership only when its Lead assessment ended `escalated`. TS (`rowCovers`) and SQL (`reviewerRowCondition`) read the same fact | Filter by status in the worklist only | The scope 404 then covers the view and every write too. A finished result stays covered (OQ-2) | FR-2 |
| DD-T3 | Status gains a fifth input, the **current step's audience**. § 12 said "`pending_ppu`: the current step-4 assessment ended `escalated`"; that needs the step | Compare positions | Without it a pending step-4 row reads `pending`, and an ended one reads `pending_tpb_review`. Optional in TS: callers that never see step 4 (SP view) leave it out | FR-9 |
| DD-T4 | The step-4 row pins the **Lead's** configuration version, not the cycle's latest | F-012 (latest for a result nobody started) | Someone has started the result. The TPB judges the same fields the Lead escalated | FR-1 |
| DD-T5 | The TPB's thread is **one** statement over the round-1 and step-3 assessments, with two decision joins (the TPB's and the Lead's) | Two thread reads; a per-comment read | NFR-1. The Lead's own escalated comments come in the same read | FR-4 |
| DD-T6 | A TPB writes no validation, comment or delete (403 `ASSESSMENT_READ_ONLY`). The green is a by-product of the decision | Let the TPB tick fields | The AC asks for decisions only; a tick would bypass the reason | FR-11 |
| DD-T7 | A role reads **its own step's** assessment in the view when it is not the current one: the Lead after the TPB starts, and the TPB before its first write | Every role reads the current step (round-2 DD-3) | Otherwise the Lead's view would show the TPB's (empty) step-4 row and lose its own comments. The status still reads the current step (DD-3 unchanged) | FR-13 |
| DD-T8 | The field green needs **every** escalated item on it to side with the program | Any one agree | Mirrors the Lead's "agree greens unless another comment on it is undecided" | FR-6 |
| DD-T9 | A **global** role's reviewer row (TPB) covers every result type; the user's program scope still applies | Read the grant's result types (there are none: `role-assignments.repository.ts` refuses a type on a global grant) | Without it a TPB covers nothing. AC2's "their result types" reads as "all" (OQ-3, open) | FR-2 |
| DD-T10 | The worklist counters follow the caller: TPB-only callers count `pending_tpb_review` as pending; `pending_ppu` is finished for everyone | One role-blind counter | Otherwise the TPB's whole queue reads "finished" (the Lead's FR-14 rule) | FR-2 |
| DD-T11 | **One effective reviewer role per result** (`effectiveRow`, `scope.ts`), exposed as `header.reviewerRole`. With `X-Acting-Role`: that role when it fits the round (else `null`, read-only). Otherwise: among the caller's rows that **cover** the membership, the one of the **furthest step** (role-step order). Since a TPB row covers only once the Lead escalated and a PPU row only once the TPB escalated (DD-T2, DD-P4), this is `pending` → Lead, `pending_tpb_review` → TPB, `pending_ppu` / `unresolved` → PPU, among the roles the person holds; an ended result reads the role of the step that ended it. ADMIN without `X-Acting-Role`: `null`. The view (`ownAssessment`, the TPB / PPU branches), `writeDecision` (so every decision, clear and finish: `decision.row`), the withdraw audit and the **AI route** (`aiAudienceOf(access, membershipFacts(m))`: a Lead who is also TPB gets the TPB AI mode on a `pending_tpb_review` result) use it; `writeDecision` no longer falls back to another covering row. **Approved consequence** (back lead, 2026-11-26): a Lead who is also TPB opening an escalated result while step 3 is still open reads it read-only, `step_upcoming`, until step 4 opens | The first row of the round (`reviewerRows.find`, the old `open()`), and "the first covering row whose step is open" (the old `writeDecision` loop) | Both depended on the row order: a Lead who is also TPB opened an escalated result as the Lead (its ended step-3 review, `finished`) and could write as the Lead while step 3 was still open. Back lead brief, 2026-11-26 (Yeck's front request) | FR-2, FR-13 |

## 8. Premise Ledger

| # | Claim | Citation (as run, 2026-11-26, `fa90020`) | If false |
|---|---|---|---|
| P-1 | `tpb_agree_program` and `tpb_agree_assessor` are in the decision enum | `schema/comment-decisions.ts:25-26` | A migration is needed |
| P-2 | `tpb_sided_program` and `tpb_sided_assessor` are comment states | `schema/assessment-comments.ts:33-34` | A migration is needed |
| P-3 | `comment_events.actor_role` is a free varchar(32) | `schema/comment-events.ts:36` | A migration is needed for `TPB` |
| P-4 | The release ack ends `qaed` in any round | round-2 P-6 (`ingestion/loads.store.ts:800-801`) | A TPB Quality Assessed never settles |
| P-5 | The AI rules already map a TPB caller to `{ kind: 'tpb' }` | `ai-suggestions-rules.ts:40` | FR-4's AI part needs a rules change |
| P-6 | Quick comments read the role-step rows | round-2 P-11 | FR-10 needs a change |
| P-7 | The test world already has a TPB user (`sub-tpb`, a global TPB grant) | `test/support/assessment-app.ts:197` | Tests add one |
| P-8 | TPB is a global role: its grant carries no result type | `users/permissions.ts` (`RoleCode.TPB`, `scopeType: 'global'`); `role-assignments.repository.ts:183-187` refuses a scope value | DD-T9 is not needed |
| P-9 | `open()` picked the role as the first reviewer row of the membership's round, whatever the result's step | `assessment.service.ts:2702-2704` on `dd58393` (`access.reviewerRows.find((row) => row.round === membership.round)`) | DD-T11 is not needed |
| P-10 | `writeDecision` wrote with the first covering row whose step was open | `scope.ts:330-345` on `dd58393` (the `for (const row of rows)` loop) | Writes already followed the result's step |

## 9. Verification outside the suites

The real MySQL row locks on the step-4 row, and the status `CASE` under `ONLY_FULL_GROUP_BY`, are checked on qatest (HITL). Without a migration, the merge to `dev` is enough.

To test it there, you need a round-2 result that a Lead ended `escalated` (Pending for TPB review), on a timeline with a step 4 open and a TPB assigned.
