# A stale edit can answer 200 as a no-op — Requirements

## 1. Document Control

| | |
|---|---|
| Spec path | `docs/specs/bugfix/timeline-edit-noop-stale` |
| Type | Bug (Bug Mode) |
| Depth | Lite (one service method, no API shape, data or migration change) |
| Approval Mode | gated |
| Status | Draft |
| Source | `proposal.md` (2026-10-22): Bug Diagnosis is the source of truth |
| Builds on | `docs/specs/admin-config/timeline-edit/` (cited below as *edit*) |
| Jira | P2-3936 (backend of P2-3904) |
| Scope | Server only (`server/`) |
| Last updated | 2026-10-22 |

**Decisions taken at specify (proposal defaults; the back lead may overrule at this gate):**

| # | Decision |
|---|---|
| Q-1 | The regression test is a **unit test** with a fake store whose reads make the mixed state deterministic. The in-memory e2e fake cannot produce the race (KZ-admin-config--cycle-timelines-1), so the real-database proof is a HITL re-run on TEST |
| Q-2 | The HITL re-run uses a token held in the back lead's shell. The agent never receives it (KZ-admin-config--cycle-timelines-3) |
| Q-3 | No `front-contract.md` edit: § 6 already promises this behavior ("Stale beats everything below it") |

## 2. Executive Summary

An edit made on an old version must always answer 409 `TIMELINES_VERSION_STALE`. Today, if another edit commits while the request is still reading, the request can instead get a 200 "nothing changed", a 400 or the 409 confirmation (*edit* FR-9; proposal § Bug Diagnosis). This spec closes those three answers. The write path already holds and does not change.

## 3. Glossary

| Term | Meaning |
|---|---|
| Stale edit | An edit whose `version` is no longer the timeline's version when the server answers |
| Unlocked answer | An answer given without the write transaction: the 400, the 409 unconfirmed and the no-op 200 |
| Mixed read | A read that sees the timeline row from before another edit's commit and the steps or scope from after it |

## 4. System Context & Scope

- **In scope:** the three unlocked answers of the timeline edit (`PATCH /timelines/:id`).
- **Out of scope:**
  - the write path, the 1213 / 1205 mapping (*edit* `execution.md:352`), and closing *edit* T-9;
  - any API shape change.
- **Current behavior:**
  - The bundle is read in four separate statements, the row first (`server/src/admin-config/timelines/timelines.store.ts:501-509`).
  - The version is checked once against that row (`timelines.service.ts:452`), and again under the lock only on the write path (`:517`).
  - The no-op answer re-reads the row and returns it as it is now (`:508-510`, `:231-236`).
  - Observed on TEST, 2026-10-22: two 200s in one round of five same-version, same-body edits; one write (version +1, 9 audit rows for 9 bumps).

## 5. Stakeholders / Personas

| Role (PRD § 3) | Scope | What they need from this spec |
|---|---|---|
| QA Admin | Edits timelines (front P2-3937) | A save made on an old view always tells them to reload; never a silent success |
| Front lead | `updateTimeline` (`9e5fcb4`) | The answer the contract promises; no client change |

## 6. Functional Requirements

### FR-1: A stale edit always answers stale

When the version the edit names is no longer the timeline's version at the time the server answers, the system SHALL answer 409 `TIMELINES_VERSION_STALE` and write nothing. This holds for every answer the edit can give without writing.

#### Scenario: Identical edit committed during the read (the reproduction)
- GIVEN timeline T at version 6 and two admins sending the same change on version 6
- WHEN the first edit commits after the second request has read T's row and before it reads T's steps
- THEN the first answers 200 with version 7, and the second answers 409 `TIMELINES_VERSION_STALE`
- BUT the second must NOT answer 200, and must NOT write a second audit record
- AND IT MUST hold when both requests arrive at the same moment

#### Scenario: Stale edit that would be a 400
- GIVEN an edit on version 6 whose values break a rule against the steps another edit just committed (version 7)
- WHEN the server reads the old row and the new steps
- THEN the answer is 409 `TIMELINES_VERSION_STALE`, not 400 `VALIDATION_FAILED`
- BUT it must NOT write anything

#### Scenario: Stale edit that would ask for confirmation
- GIVEN an edit on version 6 that, against the steps another edit just committed, touches a step in progress without `confirmInProgress`
- WHEN the server reads the old row and the new steps
- THEN the answer is 409 `TIMELINES_VERSION_STALE`, not 409 `TIMELINES_IN_PROGRESS_UNCONFIRMED`

### FR-2: Current-version answers do not change

The system SHALL keep every answer to an edit whose version is still current exactly as *edit* FR-5, FR-8, FR-9 and FR-11 define it.

#### Scenario: Real no-op
- WHEN an admin saves unchanged values on the current version
- THEN the answer is 200 with the same version, and no audit record is written
- BUT it must NOT answer 409

#### Scenario: Current-version refusals and writes
- WHEN an edit on the current version breaks a rule, needs confirmation, or applies
- THEN it answers 400, 409 unconfirmed, or 200 with version + 1, as today

## 7. Non-Functional Requirements

| ID | Attribute | Scenario (source → stimulus → response) | Measure | TRD ref |
|---|---|---|---|---|
| NFR-1 | Performance | ADMIN → any edit | Still a fixed number of statements whatever the number of steps (*edit* NFR-5). At most one more statement, only on the unlocked answers. The write path is unchanged | QAS-PERF-1 |
| NFR-2 | Correctness under concurrency | 5 overlapping same-version, same-body edits on MySQL | Exactly one 200 and four 409 stale, in each of at least 5 logged rounds | *edit* NFR-3 |

### Defect classes and their gates

| Defect class this spec can produce | Gate (command or check) | Substitute / accepted risk |
|---|---|---|
| One of the three unlocked answers left unguarded | Unit regression test, one per answer, in `timelines.service.spec.ts` with a mixed-read fake (`pnpm test`) | — |
| A real no-op or current-version refusal turns into 409 | Existing FR-11 / FR-5 / FR-8 unit and e2e tests (`pnpm test`, `pnpm test:e2e`) | — |
| Statement-count regressions (NFR-1) | `timelines.unit-of-work.spec.ts` statement-log assertions (`pnpm test`) | — |
| Type errors that the test runner erases | `pnpm build` | — |
| The fix holds on fakes but not on InnoDB timing | **No automated gate**: the fakes cannot reproduce the race (KZ-admin-config--cycle-timelines-1) | HITL re-run on TEST (NFR-2), token in the back lead's shell |

## 8. Requirement ID Index

| ID | Title | Scenarios | Owning task(s) |
|---|---|---|---|
| FR-1 | A stale edit always answers stale | Reproduction · Would be 400 · Would ask for confirmation | T-1, T-2 |
| FR-2 | Current-version answers do not change | Real no-op · Current-version refusals and writes | T-1 |
| NFR-1 | Fixed statement count | — | T-1 |
| NFR-2 | One 200 on MySQL | — | T-2 (HITL) |
