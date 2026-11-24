# A stale edit can answer 200 as a no-op — Archive Summary

**Outcome:** fixed and proven on TEST. A stale edit now always answers 409 `TIMELINES_VERSION_STALE`. In 5/5 concurrent rounds after the deploy, each round gave exactly one 200.

## Document Control

| | |
|---|---|
| Original spec path | `docs/specs/bugfix/timeline-edit-noop-stale` |
| Archive date | 2026-10-22 |
| Final status | Complete: T-1 PASS (Reviewer), T-2 PASS (HITL on TEST) |
| Jira | P2-3936 (backend of P2-3904) |
| Branch | `fix/timeline-edit-noop-stale`, merged into `staging-center` (`3565946`) and `dev` (`4b97466`) |
| Archived by | the back lead (Juanda), via `/akili-archive` |

## Requirements Delivered

| ID | Delivered by | Evidence |
|---|---|---|
| FR-1 (the stale edit answers stale: no-op, would-be 400, would-be confirmation) | T-1, T-2 | 3 regression tests red → green; falsifier run per exit; TEST: 10 × 200 / 40 × 409 stale over 10 rounds |
| FR-2 (current-version answers unchanged) | T-1 | Existing unit and e2e suites green, no test edited |
| NFR-1 (fixed statement count) | T-1 | +1 read only on the 400 and the 409 unconfirmed, +0 on the no-op and on the write (DD-1) |
| NFR-2 (one 200 on MySQL) | T-2 | 5/5 rounds after the deploy; audit rows 14 → 19 |

## Files Changed

| File | Change |
|---|---|
| `server/src/admin-config/timelines/timelines.service.ts` | New private `confirmVersion`, called before steps 5 and 6. Step 7 checks the version of its own `read()` (+40/-2) |
| `server/src/admin-config/timelines/timelines.service.spec.ts` | `mixedRead` helper plus 3 mixed-read tests (+139) |

## Test Evidence

- Unit 1965/1965, e2e 779/779, lint and build green. The Leader re-ran them independently and got the same counts.
- No `test-report.md`: Bug Mode Lite. The tests were part of T-1. The back lead accepted this on 2026-10-22.

## Validation

- No `validation-report.md`. T-2 was the validation: an HITL run on TEST against the deployed fix. The back lead accepted this on 2026-10-22.
- T-2 run 1 ran before the fix was pushed. It is recorded but does not count (disqualifier: TEST was running a build without T-1).

## Accepted Warnings And Follow-Ups

| Item | Status |
|---|---|
| LOC over budget (src +40 vs ~25, mostly comments) | Accepted by the back lead |
| Reviewer advisory: no test for the 404 branch of `confirmVersion` | Open, not scheduled |
| Reviewer advisory: trim the repeated `@akili-spec` comments | Open, not scheduled |
| `server/src/admin-config/AGENTS.md` "Edit flow" sentence | Pending item P1 in `docs/specs/kaizen/bugfix--timeline-edit-noop-stale.md`, to apply on `staging` |
| CI e2e timeout on NFR-5 (`test/admin-config-timelines.e2e-spec.ts:1375`) | Recurring, unrelated to this diff; the back lead decides |
| Commit `028ddb2` (T-2 closure docs) and this archive commit | On the fix branch, not yet merged into `staging-center` / `dev` |
| `staging-center → staging` | Needs Yeck's OK |

## Historical Notes

- Root cause: `findBundle` reads in four autocommit statements, so an edit that commits between the row read and the steps read can produce a mixed bundle. Option A (re-confirm the version before each unlocked answer) was chosen over a `REPEATABLE READ` snapshot (B) and a no-op under the lock (C). See `design.md` DD-1.
- A window remains after the confirmation read. It is accepted by DD-1, because the pool cannot close it.
- The parent spec *edit* T-9 can cite T-2 run 2 for P-12.
