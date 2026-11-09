# Kaizen Entry — ingestion/timeline-sync

## Document Control

| Field | Value |
|---|---|
| Spec Path | `ingestion/timeline-sync` |
| Date | 2026-11-09 |
| Branch | feat/ingestion-timeline-sync (spec branch; apply-capable branch: `staging`) |
| Archive Run | 1 |
| Approval Mode | gated |

## Metrics

| Signal | Value | Source |
|---|---|---|
| Tasks executed | 8 build tasks + T-9 HITL, plus one follow-up approved by the owner (`recordLot`) | tasks.md, execution.md |
| Reviewer FAIL rework attempts | 4 (T-3 ×1 boundary rows; T-7 ×1 preview double count; T-8 ×1 down-script claim; T-9 ×1 unobserved scenario claimed) | execution.md — T-3, T-7, T-8, T-9 |
| Continuations | 1 (T-4: six step-1 pins in files outside the brief) | execution.md — T-4 |
| HALTs / FATAL_FAILs | 0 | execution.md |
| Pivots | 0; execute-time amendments 6 (T-4 scope, § 7.3 step 6, S-9 + FR-7/FR-8 + § 7.3 steps 4–5, T-6 Done-when, § 7.7, replacement AC) | execution.md — gate records |
| Budget tripwires | 1 fired (T-7). Review rounds ≈ 12 → 18; production LOC ≈ 1,000 → 1,010 | execution.md — T-7, Summary |
| Defect found in a closed, reviewed task | 1: `SNAP#` prefix mismatch from T-5 (checklist review), found by the T-6 Implementer | execution.md — T-6 Issues encountered |
| PRODUCT_BUGs | n/a (no `test-report.md`, accepted) | — |
| Validation FAIL / WARN | n/a (no `validation-report.md`, accepted) | — |
| Tasks closed under `REVIEW_WAIVED` | 0 | execution.md |
| Tasks closed under `REVIEW_SKIPPED` | 0 | execution.md |
| Escaped defects (§3) | 0 (no `REVIEW_SKIPPED` task) | — |
| Disqualifier waivers | 1 (T-9, admin token pasted in chat) | execution.md — T-9 |
| Drift attributable | none recorded (no drift report) | docs/specs/audits/ |

## Lessons

- **KZ-ingestion--timeline-sync-1 — A key stored in one module and read back by another was tested only with hand-built keys.** (Product, Medium)
  - Root cause: T-5 added `SnapshotStore.get(resultCode, sk)`, which takes the sort-key suffix, and tested it with suffixes it built itself. `timeline_results.snapshot_sk` stores the full `'SNAP#' + suffix`. No test passed a stored column value through `get`. Design § 5.4 did not say which form the column holds, and T-5's checklist review audited the method against its own fixtures. On DynamoDB every changed re-entry would have missed and failed `INTERNAL`.
  - Evidence: execution.md — T-6 "Issues encountered" (`snapshot-store.port.ts:31-32`, entity template `SNAP#${snapKey}`); T-6 falsifier F4 (8 red).
  - Standardization: → P1

- **KZ-ingestion--timeline-sync-2 — A task that changed a behavior did not own the existing tests that pinned the old behavior.** (Product + Methodology, Medium)
  - Root cause: T-4 moved the start window from step 1 to the last step. The six tests that pinned the step-1 window lived in `loads.service.spec.ts` and the e2e files, which T-4's scope assigned to T-7. T-4's Done-when ("V-e2e green") could not be met inside its scope, which forced a continuation and a scope amendment. T-6 repeated the pattern: FR-11 changed `load_end` and nine step-1 pins, which tasks.md had not named. The tasks were cut by file, not by behavior.
  - Evidence: execution.md — T-4 Not Done #1 and the amendment of 2026-11-09; T-6 "Decisions made" (Done-when amendment at the Reviewer's request).
  - Standardization: → P2 (local), P3 (upstream)

## Noted, not a lesson

- **The step-1 lesson held.** KZ-ingestion--step-1-loads-1 (a "BA to confirm" row blocks the tasks built on it) stopped T-6 step 4 and T-8 until the back lead's named acceptance. The acceptance also widened S-9 to type changes, which nobody had specified, before any code was written. This is evidence for that entry's P1/P2 at apply time.
- The preview repeats the runner's classification (T-7 FAIL: double count of returned results). The Reviewer caught it. The duplicated rule is a drift risk (follow-up in archive-summary § 9). Recorded once.
- The Leader's HITL script compared clock strings with a shell test that silently failed, and two extra loads (8, 9) ran early. There was no harm, and it is disclosed in execution.md — T-9. Recorded once.
- Persona drift (`leader.md`, `reviewer.md`, `tester.md` OUTDATED) is still unfixed. `akili doctor --agents --fix` is listed for `staging` again.

## Pending Items

### P1

| Field | Value |
|---|---|
| Kind | standardization |
| Target | `server/src/ingestion/AGENTS.md` — rules section |
| Edit | "A key that one module stores (e.g. `timeline_results.snapshot_sk`, `'SNAP#' + suffix`) and another reads back is tested with the stored value passed through the reader, never only with keys the test builds itself. (KZ-ingestion--timeline-sync-1)" |
| Severity | Medium |
| Status | pending |

### P2

| Field | Value |
|---|---|
| Kind | standardization |
| Target | `docs/specs/general-setup/tasks.md` — task Scope / Consumers guidance |
| Edit | "A task that changes a behavior owns rewriting every existing test that pins the old behavior, whatever file it lives in. List them in its Scope (`git grep` the old value), and never leave them to the task that owns the file." |
| Severity | Medium |
| Status | pending |

### P3

| Field | Value |
|---|---|
| Kind | upstream |
| Target | methodology |
| Edit | `/akili-specify` tasks step: cut tasks by behavior, not by file. For each changed behavior, `git grep` the tests that pin its current value and assign them to the task that changes it. A Done-when that requires a suite to be green must be reachable inside that task's scope. (Source: KZ-ingestion--timeline-sync-2.) |
| Severity | Medium |
| Status | pending |

### P4

| Field | Value |
|---|---|
| Kind | digest-update |
| Target | KZ-admin-config--cycle-timelines-3 |
| Edit | Add source `ingestion/timeline-sync`: the admin token was pasted in chat at T-9. The Leader declined it and asked for `~/.qa-admin-token`; the back lead told the Leader to use the pasted token and waived the disqualifier. This is the fifth occurrence. Keep Medium and raise the standardization priority: the HITL plan's token-file step should be a precondition the Leader checks before the first live call, not a disqualifier found afterwards. |
| Severity | Medium |
| Status | pending |

### P5

| Field | Value |
|---|---|
| Kind | digest-update |
| Target | KZ-auth--user-management--core-2 |
| Edit | Add source `ingestion/timeline-sync`: review rounds ≈ 12 → 18 (tripwire at T-7). Causes: parallel lens reviewers count one round per lens (T-4: 2), plus an owner-approved follow-up review and four rework rounds. The budget's review-round line should be derived from each task's `Review` mode (full / lenses / checklist), not from the task count. Recurrence across ingestion specs (step-1: 14 → 20). |
| Severity | Medium |
| Status | pending |

### P6

| Field | Value |
|---|---|
| Kind | guide-sync |
| Target | `server/src/ingestion/AGENTS.md` — line 3 and line 56 |
| Edit | Replace `docs/specs/ingestion/timeline-sync/` with `docs/specs/archive/2026-11-09-ingestion--timeline-sync/`. Line 3: "**Current spec:** none active; the latest is `docs/specs/archive/2026-11-09-ingestion--timeline-sync/` (`design.md`; what the front may rely on: `front-contract.md` there)". Line 56: the contract path becomes `docs/specs/archive/2026-11-09-ingestion--timeline-sync/front-contract.md` (section 8). |
| Severity | Low |
| Status | pending |
