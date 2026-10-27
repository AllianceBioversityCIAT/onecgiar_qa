# A stale edit can answer 200 as a no-op — Proposal

## Document Control

| | |
|---|---|
| Spec path | `docs/specs/bugfix/timeline-edit-noop-stale` |
| Slug | `timeline-edit-noop-stale`, from the argument; `bugfix/` domain because the type is Bug (`AGENTS.md` § Spec organization) |
| Type | Bug |
| Approval Mode | gated |
| Status | Draft, waiting for the back lead's review |
| Branch | `fix/timeline-edit-noop-stale` (from `origin/feat/timeline-edit` @ `d7c2f36`; `staging` does not hold the edit flow yet: `git merge-base --is-ancestor fa16275 origin/staging` → not an ancestor) |
| Source | T-9 HITL run on TEST, 2026-10-22 (back lead with the agent). Jira P2-3936 (backend of P2-3904) |
| Builds on | `docs/specs/admin-config/timeline-edit/` (FR-9, FR-11, DD-6, P-12, T-9) |
| Depends on | `admin-config/timeline-edit` (merged in `staging-center` and `dev`, not yet in `staging`) |
| Parallel-safe | no. It edits `timelines.service.ts`, which the load stories P2-3905 / P2-3906 also extend |
| Scope | Server only (`server/src/admin-config/timelines/`). No API shape change |
| Date | 2026-10-22 |

## Intent

Make the edit keep its promise: an edit made on an old version always answers 409 `TIMELINES_VERSION_STALE`, never 200, even when another identical edit commits during the request.

## Problem / Current Behavior

- When two edits carry the same `version` and the same body, both can answer 200. Seen once in six concurrent rounds on TEST (below).
- Only one of them writes: the version rose by one in that round, and timeline 22 holds 9 audit rows for 9 applied edits (back lead's SQL on `qadb`, 2026-10-22).
- The second 200 comes from the no-op exit (`server/src/admin-config/timelines/timelines.service.ts:506-510`), which never reaches the locked version re-check (`:517`).
- The contract promises the opposite: "Stale beats everything below it" (`docs/specs/admin-config/timeline-edit/front-contract.md` § 6), and FR-9 says a stale edit SHALL be refused with 409 (`requirements.md:244`).

## Proposed Outcome

| Situation | Today | After |
|---|---|---|
| Stale edit whose values equal what another edit just wrote | 200 (no-op) | 409 `TIMELINES_VERSION_STALE` |
| Stale edit judged 400 or 409 unconfirmed on a mixed read | that answer | 409 `TIMELINES_VERSION_STALE` |
| Real no-op (current version, nothing changed) | 200, same version | unchanged |
| Applied edit, stale edit with a changed body | 200 / 409 | unchanged |

## Scope

- The unlocked answers of `TimelinesService.update`: the 400 (`:494`), the 409 unconfirmed (`:503`) and the no-op 200 (`:508-510`).
- The regression check (see the Open Questions).
- A line in `front-contract.md` § 6 only if the wording changes. Today it already promises the fixed behavior.

## Non-Goals

- The write path (step 8), which held in every round.
- The 1213 / 1205 mapping, still open under T-9 (`execution.md:352`).
- Closing T-9 itself. Its evidence is recorded in the parent spec.

## Affected Users, Systems, And Specs

| Who / what | Effect |
|---|---|
| QA Admin (front drawer, P2-3937) | A second identical save sees the reload message instead of a silent success |
| `client/src/app/core/api/cycles.api.ts` (`updateTimeline`, `9e5fcb4` on `staging-center`) | Already lists `TIMELINES_VERSION_STALE`; no change |
| `admin-config/timeline-edit` | FR-9 is met in full; T-9 can record P-12 as "write path verified, answer fixed here" |

## Visual Reference

- Source: None
- Notes: backend-only change. No screen changes.

## Bug Diagnosis

### Observed Symptom

In a round of 5 concurrent `PATCH /timelines/22`, all with `version: 6` and the same body, two answered 200 and three answered 409 stale. The contract and FR-9 expect exactly one 200.

### Reproduction Steps

1. TEST (`https://qatest-serv.ciat.cgiar.org/api/v1`), disposable `draft` cycle 33, timeline 22.
2. Send 5 overlapping `PATCH /timelines/22` with `{"version": N, "steps": [{"position": 5, "closesOn": <same day>}]}` and a fresh `Idempotency-Key` each.
3. Expected: one 200, four 409. Actual: rounds N = 1, 4 and 5 gave 1 × 200 and 4 × 409; round N = 6 gave **2 × 200** and 3 × 409. Rounds N = 2 and 3 were not logged per request.

| Round | 200 request ids | Overlap |
|---|---|---|
| N = 6 | `a25d15d8-90ce-4715-8205-9ce1384bb5d1`, `419a654b-e7e5-459c-a68b-b33b4a34c01f` | all 5 sent within 1 ms, answered 1792674911.250 – .258 |
| N = 1, 4, 5 | `c864f62a…`, `45ae7a9d…`, `ec807f5d…` | yes |

The race is a timing window, so the bug shows up only some of the time (1 in 4 logged rounds). The in-memory fake cannot produce it (KZ-admin-config--cycle-timelines-1).

### Root Cause (confirmed)

`findBundle` reads the bundle in four separate autocommit statements on the pool, the timeline row first (`timelines.store.ts:501-509`; asserted by `timelines.unit-of-work.spec.ts:811-823`). An edit that commits between statement 1 and statement 2 leaves the request with:

- the **old** row: `version` 6, so the early check at `timelines.service.ts:452` passes;
- the **new** steps: `closesOn` already equal to the request's value, so `diffTimeline` returns no change.

The flow then takes the no-op exit (`:508-510`), returns `this.read()` (`:231-236`: a fresh `findById`, so the answer shows version 7) and never runs the locked re-check at `:517`.

The design meant every write to be guarded: "step 8 re-checks the version under the row lock" (`design.md:153`; port comment `timelines.store.ts:211`). The no-op exit, the 400 and the 409 unconfirmed are not writes, so they answer from an unchecked, possibly mixed read.

### Blast Radius

| Check | Recorded as | Result |
|---|---|---|
| **Already fixed?** | `git log --all --oneline -i --grep="stale\|no-op\|noop\|P2-3936"` and `git log --all --oneline --since=10.days -- …/timelines.service.ts …/timelines.store.ts` (2026-10-22): only the timeline-edit commits (`978e9ec` … `d7c2f36`) and their merges; `git log HEAD..origin/staging-center` adds front and design merges, no server change | Not fixed on any branch |
| **Live path?** | `PATCH /timelines/:id` → `TimelinesController.update` (`timelines.controller.ts:200-207`) → `TimelinesService.update` → `store.findBundle` (`:440`) → version check (`:452`) → `diffTimeline` (`:458`) → no-op exit (`:508`) → `read` (`:509`, `:231`) | On the path. The run reached it: 200 without a version bump |
| **Siblings on the same state** | The same mixed bundle feeds the 400 (`validateTimelineUpdate`, `:488-494`) and the 409 unconfirmed (`changesAnInProgressStep`, `:499-503`). No other module checks a version: `grep -rnE "VERSION_STALE\|version !==" server/src` → only `timelines.service.ts:452,517` and catalog/OpenAPI text | Two siblings in scope; nothing outside the timelines service |
| **Downstream consumers** | Front `updateTimeline` (`9e5fcb4`, `staging-center`); `timelines.service.spec.ts:522` (fake `findBundle`); `timelines.unit-of-work.spec.ts:811,833`; `server/test/admin-config-timelines.e2e-spec.ts` (in-memory store `in-memory-admin-config.ts:803`); idempotency replay of a stored answer (a stale 409 would now be stored instead of a 200) | No contract change for the front. The tests assert statement counts that the fix may change |

- Data integrity: none. Writes stay serialized and audited once per applied edit (9 audit rows = 9 version bumps).
- Security: none.

### Fix Strategy

Not cosmetic: the fix changes which answer the API gives. Route: `/akili-specify` Lite in Bug Mode.

## Approach Options

| Option | What | For | Against |
|---|---|---|---|
| **A. Re-check the version before every unlocked answer** | Before the 400, the 409 unconfirmed and the no-op 200, read the row's `version` once more. If it moved, throw `TimelineVersionStaleError`. On the no-op path, reuse the `findById` that `read` already does | Small (one service method). No transaction. Same version means no edit committed in between, so the bundle was consistent | One extra statement on refusals (still a fixed count, NFR-5 holds) |
| B. Read the bundle in one snapshot | `findBundle` inside a short `REPEATABLE READ` read-only transaction, so the four statements see one state | Fixes the class at the source | Goes against the module's READ COMMITTED choice (`timelines.unit-of-work.ts:101-104`). Takes a pooled connection for the read and changes the `findBundle` "on the pool" contract and its test |
| C. Decide the no-op under the lock | Move the no-op check after `findForUpdate` | Uses the existing re-check | Every no-op opens a transaction and takes a row lock, and FR-11 / the design say a no-op opens none. The 400 / unconfirmed siblings stay open |

## Recommended Approach

**Option A.** It is the smallest change that closes all three exits. It keeps READ COMMITTED and the no-transaction no-op. It also follows the order the design already promises: stale before 400, before unconfirmed, before the no-op.

## Risks, Dependencies, And Open Questions

| # | Item | Proposed default |
|---|---|---|
| Q-1 | **Regression test.** Bug Mode requires one that is red before and green after. The e2e in-memory fake cannot produce the race (KZ-admin-config--cycle-timelines-1). The back lead asked on 2026-10-22 not to adjust tests (said about the CI timeout) | A unit test in `timelines.service.spec.ts` with a fake store whose second `findById` returns a higher version (the mixed read made deterministic). The real-database proof stays a HITL re-run on TEST |
| Q-2 | **HITL credentials.** The token went through chat again on 2026-10-22, the recurrence KZ-admin-config--cycle-timelines-3 describes | The re-run uses a token held in the back lead's shell (`! …` command); the agent never sees it |
| Q-3 | `front-contract.md` § 6 already states the fixed behavior | No contract edit; one line in "Known limits" is not needed |
| Q-4 | A real no-op answered while another edit commits returns the newer version | Accepted, as today. The answer is the timeline as it is now |
| R-1 | Unit-of-work and service specs assert exact statement logs | Update the counts that the extra `findById` changes; part of Q-1's decision |

## Success Criteria

- A stale edit never answers 200: unit regression test red → green.
- Five overlapping same-version, same-body edits on TEST give exactly one 200 in at least 5 logged rounds, with request ids recorded.
- Real no-op, applied edit and stale-with-changes answers do not change: the existing unit and e2e suites stay green.

## Next Step

```text
/akili-specify bugfix/timeline-edit-noop-stale
```

In **Bug Mode** (Lite). Settle Q-1 there.
