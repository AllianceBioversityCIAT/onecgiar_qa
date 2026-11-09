# Archive Summary — ingestion/timeline-sync

> **Outcome:** the QA Admin can sync a timeline at any step until the last minute of its last step. Each sync enters the round of the step in force, memberships are kept per round, and a result returned in Round 1 re-enters Round 2 only when its program re-submits it. Delivered, merged to `staging-center` and `dev`, deployed to qatest and checked live.

## 1. Document Control

| Field | Value |
|---|---|
| Spec | Timeline sync at any step |
| Jira | P2-3906 (moved to To Be Reviewed, 2026-11-09) |
| Depth / Approval mode | Full / gated |
| Branch | `feat/ingestion-timeline-sync` (from `staging-center` @ `01a5404`) |
| Merged | `staging-center` @ `ec87ce9`, `dev` @ `e5a9b26` (2026-11-09) |
| Archived by | Claude Code (`claude-opus-5-5`), for the back lead |

## 2. Original Spec Path

`docs/specs/ingestion/timeline-sync/`

## 3. Archive Date

2026-11-09

## 4. Final Status

**Complete.** T-1…T-9 `[x]`, plus one follow-up the back lead approved (the `recordLot` duplicate fix). No HALT, no pivot, no waived review.

## 5. Requirements Delivered

| Requirement | Where it was proved |
|---|---|
| FR-1 sync at any step, window to the last step's close | T-3 rules, T-4 start, T-7 e2e; T-9 live (step 4 sync 202; +1 min 409) |
| FR-2 round and position at start, under the lock | T-3, T-4; T-9 live (rounds 1/1/2/2/2 by step) |
| FR-3 at most 2 rounds | T-2; T-7 e2e (`ROUND_ABOVE_MAX` on create, `round` on edit → `UNKNOWN_FIELD`) |
| FR-4 skip order v2 (incl. S-6) | T-3, T-6, T-7 |
| FR-5 one membership per round | T-1 (migration `0008`), T-4 |
| FR-6 `endAsReturned` (store only, no route) | T-4 |
| FR-7 / S-9 re-submitted results, incl. type changes | T-6, T-7 |
| FR-8 changed fields (`NULL` / `[]` / keys / `["result_type_key"]`) | T-3, T-6 |
| FR-9 `returnedNotResubmitted`, preview equals the sync | T-4, T-6, T-7 (attempt 2) |
| FR-10 round and position in the API, old loads read 1/1 | T-7; T-9 live |
| FR-11 audit and logs with the round | T-4, T-6 (§ 7.7 amended) |
| FR-12 ADMIN only, idempotent, privacy unchanged | T-7 |
| FR-13 documents | T-8 (`front-contract.md`, guides, PRD) |
| NFR-1…NFR-5 | T-1, T-3, T-6 (one DynamoDB read per changed re-entry, no field content in logs) |

## 6. Files Changed Summary

| Area | Files |
|---|---|
| Migration | `server/drizzle/0008_timeline_sync_rounds.sql`, `rollback/0008_*.down.sql`, schema `timeline-results.ts`, `timeline-loads.ts` |
| Rules | `server/src/ingestion/load-rules.ts`, `admin-config/timelines/timeline-rules.ts`, `common/error-codes.ts` |
| Persistence | `loads.store.ts`, `loads.unit-of-work.ts`, `test/support/in-memory-loads.ts`, `snapshot-store.port.ts`, `dynamo-snapshot-store.ts` |
| Run | `load-runner.ts` |
| API | `loads.service.ts`, `loads.controller.ts`, `models/load.model.ts` |
| Docs | `front-contract.md` (this folder), `server/src/ingestion/AGENTS.md`, `server/src/database/AGENTS.md`, `docs/prd.md` |

Production code ≈ 1,010 LOC against ≈ 1,000 planned.

## 7. Test Evidence Summary

- **No `test-report.md` (accepted by the back lead, 2026-11-09).** Evidence is in `execution.md`: each task's red run, executed falsifiers and a non-author re-run.
- Final suites on `dev`: unit 3041 passed | 4 skipped, e2e 968 passed, lint and build clean.
- Live on qatest (T-9): sync in step 1 (timeline 29) and step 4 (test timeline 32) with the right round and position; preview `closed` and 409 `LOADS_WINDOW_CLOSED` one minute after the last step; `0008` applied by the deploy pipeline (indirect evidence).

## 8. Validation Summary

- **No `validation-report.md` (accepted by the back lead, 2026-11-09).** Every task had an independent Reviewer verdict; T-4 had two lens Reviewers in parallel.
- Reviewer FAILs, all fixed: T-3 (missing boundary rows), T-7 (preview counted returned results twice), T-8 (wrong down-script guard in a guide), T-9 (an unobserved scenario claimed).

## 9. Accepted Warnings Or Follow-Ups

| Follow-up | Owner |
|---|---|
| Ratify S-9 (with type changes) and the replacement AC (proposal § 9.4); update the AC in Jira P2-3906 | Angel (BA) |
| `client/.../cycle/cycle.logic.ts` `loadTargets` hides the load after step 1 (front contract § 12) | Yeck |
| P-7 query on PROD before the PROD deploy | Back lead / team |
| P-8 `TZ` of every QA server process | Infrastructure (Cris) |
| `docs/prd.md:24`, `:84`, `:98` (US-4 AC) still describe a step-1-only load | Back lead (next PRD edit) |
| A live Round-2 re-entry needs a route that returns a result | The assessment spec |
| Move `countReturnedNotResubmitted` into `end()`'s transaction once `endAsReturned` has a caller | The assessment spec |
| Extract the same-type re-submission rule shared by `preview()` and `LoadRunner.classify` into `load-rules.ts` | Later ingestion spec |
| `akili doctor --agents --fix` (persona drift) | `staging` |

## 10. Historical Notes

- **Execute-time amendments, all by the back lead:** T-4 scope (window pins), § 7.3 step 6 (duplicate classification by memberships), S-9 widened to type changes (FR-7, FR-8, § 7.3 steps 4–5, DD-4), T-6 Done-when (named pins), § 7.7 (only runner log lines carry `round`), S-9 and the replacement AC accepted as default.
- **Defects found during execution:** the `SNAP#` prefix mismatch between `timeline_results.snapshot_sk` and `SnapshotStore.get` (from T-5, found in T-6); the preview's double count (T-7); a wrong down-script claim (T-8).
- **Budget:** review rounds 18 against ≈ 12. The tripwire fired at T-7 and the back lead accepted the overrun.
- **HITL:** the admin token was pasted in chat; the back lead waived T-9's disqualifier. Result 10068 was released as `qaed` in Reporting TEST. Test timeline 32 and loads 8–10 remain in `qadb`.

## 11. Diagrams

None. The spec has no `diagrams/` folder and made no baseline diagram slot stale.
