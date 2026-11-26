# Round 2, step 5: the PPU — Design

## 1. Document Control

| Spec path | Requirements | Builds on | Last updated |
|---|---|---|---|
| `docs/specs/escalation/round-2-ppu` | FR-1 … FR-13, NFR-1 … NFR-4 | round-2 § 12 (PPU column), round-2-tpb DD-T1 … DD-T10 | 2026-11-26 |

## 2. Executive Summary

This design is the round-2 § 12 PPU column, built on the TPB's machine:

- **Role and scope:** the TPB's role branch, with step-4 facts in place of step-3 ones.
- **Ending:** a Done-driven end like the Lead's auto-end, with no Finish.
- **Status:** a sixth status input, "the `ppu` step is closed", for Unresolved.
- **AC6:** one small table that records when a Reporting change was first seen.

## 3. Pieces

| Piece | Change |
|---|---|
| `role-steps.ts` | PPU row enabled, with `dateBound: false` (the PPU has no date window). `isWithdrawWindowOpen` is unchanged |
| `scope.ts` | `MembershipFacts.tpbEscalated`. `rowCovers` lets a PPU row cover a membership only when it is `true`. `writeDecision` makes a row with no date window writable whatever its step state, when the timeline has the step |
| `worklist.store.ts` | `stepEscalatedSql(audience)` (the TPB's `leadEscalatedSql` generalised); the PPU row adds it for `tpb`. Status column `ppuStepClosed`: a per-timeline literal computed in TS |
| `assessment.store.ts` | Membership read: `tpbAssessment` (the step-4 row). The thread read adds the TPB's decision (`tpbDecision*`). New reads/writes for `reporting_field_changes` |
| `qa-status.ts` | Sixth input `ppuStepClosed`. Rows `unresolved` (tpb+escalated or ppu+pending, closed) and `pending_ppu` (ppu+pending) |
| `round-two-rules.ts` | `isPpuDecidable`, `ppuFieldGreen`, `ppuOpenCases` (pure) |
| `comment-transitions.ts` | Actor `ppu`: `tpb_sided_assessor → done` |
| `assessment.service.ts` | Decide / clear branch for the PPU with the auto-end; `applyEnd` applies PPU decisions; Finish, validations, comments and deletes refuse a PPU; the view's AC6 step |
| `assessment-view.ts` | `ThreadItem.tpbDecision` (PPU view only); PPU decidable items; step-5 effective green; `changedInReporting` per field |
| `dto/decide-comment.body.ts` | Accepts `ppu_done`; `body` is optional for it only |
| `worklist.service.ts` | PPU counters; `unresolved` finished for the others |
| `server/drizzle/0015_reporting_field_changes.sql` + `rollback/0015_….down.sql` + schema | § 4 |

## 4. Data (migration `0015_reporting_field_changes`)

```sql
CREATE TABLE `reporting_field_changes` (
  `id` int unsigned AUTO_INCREMENT NOT NULL,
  `timeline_result_id` int unsigned NOT NULL,
  `field_key` varchar(128) NOT NULL,
  `detected_at` datetime NOT NULL,
  CONSTRAINT `reporting_field_changes_id` PRIMARY KEY(`id`),
  CONSTRAINT `reporting_field_changes_membership_field_uq` UNIQUE(`timeline_result_id`,`field_key`),
  CONSTRAINT `reporting_field_changes_membership_fk` FOREIGN KEY (`timeline_result_id`) REFERENCES `timeline_results`(`id`)
);
```

- It is additive: one new table, no change to existing rows.
- The down script drops the table. It is lossy: it loses the detection dates.
- `INSERT … ON DUPLICATE KEY UPDATE id = id` keeps the **first** date.

Other writes reuse `0013`:

- the step-5 row (`role_code = 'PPU'`);
- `comment_decisions` `ppu_done` (`body` NULL allowed by its CHECK);
- comment state `done`;
- `comment_events` with `actor_role = 'PPU'`;
- the audit actions;
- the release.

## 5. Rules

**Decidable (PPU):** the item is in state `tpb_sided_assessor`, not deleted, on a core field, and the view is writable. The only choice is `ppu_done`.

**Field green (FR-6):** after each Done or clear, the field's step-5 mark becomes "every live case on the field is Done". It is written only when it differs from the step-5 effective green.

**Step-5 effective green:**

```
eff5(key) = stored5 ?? eff4(key)
eff4(key) = stored4 ?? eff3(key)
eff3(key) = stored3 ?? carried(key)
```

**Auto-end (FR-6):** after a Done, if no live case is undecided and every core field has `eff5 = true`, run `applyEnd('quality_assessed')`:

- the release `qaed`;
- `applyPpuDecisions`: `tpb_sided_assessor → done`;
- audit.

A clear never ends the review.

**Unresolved (FR-8):** `ppuStepClosed` is `audienceStepState('ppu', timing) === 'closed'`. The view computes it in TS. The worklist computes it once per request, because the worklist is per timeline, and binds it as a literal `1`/`0` in the status CASE. Readers that leave it out never produce `unresolved`.

**AC6 (FR-9):** the view, for a PPU reader (a PPU, or an Admin acting as PPU), on a membership with open cases and not ended:

1. One `RESULTS_FEED.details({ phaseYear, resultIds: [resultId], fieldKeys: caseFields })` call.
2. Compare each field with `canonicalJson` (the loader's own rule) against the snapshot `values`.
3. One insert-ignore per changed field (a single multi-row statement).
4. Then the view reads every stored row of the membership: one select, for every round-2 reader.

A feed error is logged (`reporting_change_check_failed`, ids only) and skipped.

## 6. Design Decisions

| ID | Decision | Rejected | Why / consequence | FR |
|---|---|---|---|---|
| DD-P1 | The PPU row has **no date window** (`dateBound: false`): listed and writable before, during and after step 5. The timeline must have the step | Step-bound like the TPB | § 12 and the brief: "cases stay open after step 5". An Admin acting as PPU waives nothing extra | FR-2 |
| DD-P2 | The last Done **auto-ends** the result in the same transaction; there is no Finish | A Finish like the TPB's | AC7: "automatically"; the brief: "No hay Finish" | FR-6 |
| DD-P3 | **Undo:** the PPU may clear a Done until the result ends; the field greys again | Done is final | A mis-click on one of several cases must be fixable. The last Done ends the result at once, so only earlier ones can be undone; after the end, 409 `ASSESSMENT_FINISHED` | FR-5 |
| DD-P4 | The PPU's scope is "reached step 5" (the TPB's row ended `escalated`), like the TPB's OQ-2 | Only status `pending_ppu` | Pending PPU, Unresolved and the PPU's own finished results; the 404 covers the rest | FR-2 |
| DD-P5 | `unresolved` is a **sixth status input** (`ppuStepClosed`), per timeline, bound in SQL as a literal | Compare dates in SQL per row | One worklist is one timeline: the TS step rule (`viewTimeline`) is the single source; nothing per row | FR-8 |
| DD-P6 | AC6 is read on open, and the **first** detection date is stored (`0015`). The read of a GET writes this one table (an exception to "a read never writes", step-1 DD-3) | Store nothing (no date); a sync job | Back lead, OQ-1. The insert is idempotent, outside the assessment lock, and touches no assessment row | FR-9 |
| DD-P7 | The thread read always joins the TPB's decision too; only the PPU view shows it (`tpbDecision`) | A second thread read | NFR-1: one statement | FR-3 |
| DD-P8 | A PPU's Finish, validations, comments and deletes are 403 `ASSESSMENT_READ_ONLY` | 404 | Same as DD-T6 | FR-7 |

## 7. Premise Ledger

| # | Claim | Citation (as run, 2026-11-26, `eb2db04`) | If false |
|---|---|---|---|
| P-1 | `ppu_done` is in the decision enum and its CHECK lets `body` be NULL | `schema/comment-decisions.ts` | A migration is needed |
| P-2 | `done` is a comment state, and the SP view hides it | `schema/assessment-comments.ts`; `sp-view/sp-state.ts` `REVIEW_STATES` | DD-11 work |
| P-3 | Snapshot `values` are the feed's `details` values as is | `ingestion/load-runner.ts` (`values: result.values`) | The AC6 compare needs the loader's transform |
| P-4 | `canonicalJson` is the loader's equality rule | `ingestion/load-rules.ts` (`changedFields`) | False positives in AC6 |
| P-5 | The assessment module has its own `RESULTS_FEED` binding | `assessment.module.ts` (`ReportingResultsFeedClient`) | AC6 needs a provider |
| P-6 | PPU is a global role | `users/permissions.ts` (`scopeType: 'global'`) | DD-T9 would not cover it |
| P-7 | The Overview has no server endpoint | `grep -ril overview server/src` → none | AC8's Overview part needs one |
| P-8 | The test world has a PPU-capable user only if one is added | `test/support/assessment-app.ts` (no PPU actor) | Tests add `sub-ppu` |

## 8. Risks

- **The AC6 read adds one Reporting call to the PPU's open.** The feed's timeout bounds it, and a failure is skipped.
- **The program may not be able to edit while the result is in QA,** if Reporting locks edits (an earlier open finding). Then AC6 never fires, and the PPU's follow-up is blocked. This has to be checked with Reporting.
