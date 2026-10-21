# Edit a QA timeline — Proposal

## Document Control

| | |
|---|---|
| Spec path | `docs/specs/admin-config/timeline-edit` |
| Slug | `timeline-edit`, derived from the story title (no argument given) |
| Type | Change |
| Approval Mode | gated |
| Status | Approved (back lead, 2026-10-21): every proposed default of Q-1…Q-8 accepted |
| Branch | `feat/timeline-edit` (from `origin/feat/cycle-timelines` @ `c2cab59`; `staging` has no `server/src/admin-config/timelines` yet, `git ls-tree -r --name-only origin/staging -- server/src/admin-config/timelines` → 0 files) |
| Source | Jira P2-3904 (story, reporter: BA), backend sub-task P2-3936; epic P2-3902. Front sub-task P2-3937 (front lead), design sub-task P2-3972 (designer) |
| Builds on | `docs/specs/archive/2026-10-21-admin-config--cycle-timelines/` (DD-1…DD-10, `front-contract.md`) |
| Depends on | `admin-config/cycle-timelines` (merged in `staging-center`, not yet in `staging`) |
| Unblocks | P2-3937 (front edit drawers), P2-3938 (testing) |
| Parallel-safe | no. It changes `timeline-view.ts` and the timeline response that P2-3905 / P2-3906 (loads) also extend, adds migration `0004` and touches the shared error catalog |
| Scope | Server only (`server/`). The front consumes the API in P2-3937 |
| Date | 2026-10-21 |

## Intent

Let the QA Admin fix a timeline after it is created without asking the tech team. That covers its name, its step names and dates, and its scope while step 1 has not started. The server owns every rule about what can still change. It also tells the admin when step 1 cannot open because no load was done ("Waiting for load").

## Problem / Current Behavior

1. **No way to change a timeline after creation.** `TimelinesController` exposes defaults, create, list, detail, assign and remove, and has no update route (`server/src/admin-config/timelines/timelines.controller.ts`, routes `@Get('timeline-defaults')`, `@Post('cycles/:id/timelines')`, `@Get('cycles/:id/timelines')`, `@Get('timelines/:id')`, `@Post('timelines/:id/users')`, `@Delete('timelines/:id/users/:assignmentId')`). The store only inserts steps (`timelines.store.ts:242` `insertSteps`). Editing was explicitly left out of the previous spec (`docs/specs/archive/2026-10-21-admin-config--cycle-timelines/proposal.md:69`, `front-contract.md:131`).
2. **The create rules assume nothing has happened yet.** `validateTimelineCreate` checks `BEFORE_TODAY` only on step 1 and has no notion of a step that is closed or in progress (`server/src/admin-config/timelines/timeline-rules.ts:94-97`). Reused as is, it would refuse every edit to a timeline that has already started.
3. **No "Waiting for load" status.** `TimelineStatus` is `'scheduled' | 'live' | 'finished'`, derived from dates only (`server/src/admin-config/timelines/timeline-view.ts:5,68-73`). A timeline whose step 1 date arrives with no load is reported `live` with step 1 current.
4. **Loads do not exist yet.** Readiness always lists `NO_RESULTS_LOADED` (`timeline-view.ts:75`), and `timeline_loads` / `timeline_results` are reserved, not created (`server/src/admin-config/AGENTS.md`, section *Reserved tables*).
5. **No persisted audit for timelines.** Writes leave one log line (`event: 'admin_config'`, `timelines.service.ts:489-520`). The only audit table is `user_audit_events`, scoped to users (`server/src/database/drizzle/schema/user-audit-events.ts:36-60`). AC 8 asks for who, when and what changed.
6. **The front already has edit drawers on mock data.** The save stops at `// TODO(api): PUT the timeline` (`client/src/app/pages/workspace/cycle/timeline-drawer.ts:304`). The prototype already shows the "Change a step in progress?" confirmation and locked closed rows (`docs/qa-timeline-stories-check-2026-10-20.md:12-29`).
7. **There is no version or `updated_at` on `timelines`** (`server/src/database/drizzle/schema/timelines.ts`, columns `id`…`createdBy`). Two admins editing the same timeline would overwrite each other silently.

## Proposed Outcome

- A QA Admin can **edit a timeline**: its name, each step's name and dates, and its scope. Scope means the Science Programs and result types, or "all".
- What can change **depends on each step's state today in Rome**:

  | Step state | Name | Opens on | Closes on |
  |---|---|---|---|
  | **Closed** (closed before today) | editable | locked | locked |
  | **In progress** (open today) | editable | locked | editable, today or later |
  | **Upcoming** (opens after today, or step 1 waiting for load) | editable | editable, today or later | editable |

- **Scope** can change only while step 1 has not started, which includes "Waiting for load". After that, a scope change is refused.
- The create rules still hold on the result: a step cannot close before it opens, steps must not overlap and stay in order. Name rules and the unique name per cycle also still apply. **Every** broken rule comes back in one 400, as in creation (FR-11).
- Saving a change to an **in-progress** step requires an explicit confirmation in the request. Without it, the server refuses and nothing is written.
- **"Waiting for load"**: when step 1's opening date arrives and no load exists for the timeline, step 1 does not open. The timeline is shown as `waiting_for_load`, and the admin can load results (later story) or move the dates.
- Changes apply **immediately** to everyone, because status is computed on read (DD-2). No job runs.
- Every successful edit is **recorded**: who, when, the request id, and each changed field with its value before and after.
- Two admins editing the same timeline cannot silently overwrite each other: the second save is refused as stale.

## Scope

- `PATCH /timelines/:id`, admin-only (`ADMIN_ACCESS`, inherited from the class). It comes with OpenAPI, error codes and `@Idempotent()`, like create.
- Pure edit rules in `timeline-rules.ts` (`validateTimelineUpdate`). They take the stored timeline, the request and today in Rome, and return every issue.
- Step state (`closed` / `in_progress` / `upcoming`) in `timeline-view.ts`. The status gains `waiting_for_load`, and each step in the response carries its state so the front can lock fields without recomputing rules.
- A loads seam: a port answering "does this timeline have a step-1 load?". It answers `false` until P2-3905 creates `timeline_loads`, and P2-3905 swaps the adapter without touching the rules.
- Migration `0004`:

  | Change | Holds | Key rules |
  |---|---|---|
  | `timelines.version` (+ `updated_at`, `updated_by`) | Optimistic concurrency | `UPDATE … WHERE id = ? AND version = ?`; 0 rows → 409 stale |
  | `timeline_audit_events` (new) | `timeline_id`, `actor_id`, `action` (`update`), `changes` JSON `{ field: { before, after } }`, `request_id`, `created_at` | Append-only, same shape as `user_audit_events`; written in the edit's transaction |

- The `admin_config` log line gains the action `timeline_update`.
- `front-contract.md` for this spec: the request, the step states, the new status and the new codes. The front's `cycles.models.ts` status union must add `waiting_for_load`.
- Module guide `server/src/admin-config/AGENTS.md` updated as a named deliverable.

## Non-Goals

- **Front** drawers, confirmation pop-up and locked fields: P2-3937 (front lead) and P2-3972 (designer).
- **Loading results** and the load itself: P2-3905 / P2-3906. This spec only adds the seam and the status.
- **Changing the step structure**: adding, removing or reordering steps, and changing a step's audience, round or `requiresLoad`. AC 2 names only names and dates. See Q-4.
- **Reading the history**: no endpoint lists the audit events. The "history and audit log story" owns that. See Q-7.
- **Out of scope in the story:** pausing or stopping a timeline, deleting a timeline with loaded results, and moving results between timelines (D-6 of the previous spec).
- Editing a timeline in a `closed` cycle (409 `CYCLES_CLOSED`, same as assignments).

## Affected Users, Systems, And Specs

| Affected | How |
|---|---|
| QA Admin | Edits timelines without the tech team; sees "Waiting for load" |
| Assessors, Leads, TPB, PPU | See new dates at once (computed on read) |
| `server/src/admin-config/timelines/` | Controller route, service, store, unit of work, `timeline-rules.ts`, `timeline-view.ts`, DTO, OpenAPI models |
| `server/src/database/drizzle/schema/`, `server/drizzle/0004_*` | `timelines` columns, `timeline_audit_events`; `schema.spec.ts` pins the DDL |
| `server/src/common/error-codes.ts` | New `TIMELINES_*` codes (stale version, unconfirmed in-progress change) and field codes (locked date, scope locked, opens before today) |
| Front (P2-3937), `client/src/app/core/api/cycles.models.ts` | New route; status union gains `waiting_for_load`; steps carry `state` |
| P2-3905 / P2-3906 (loads) | Implement the loads seam; reuse the audit table if loads need one |
| `docs/trd/trd.md` § 5.1 / § 6 | New table and route, recorded as a pending item for `staging` (write discipline) |

## Visual Reference

- Source: existing prototype (Angular port of the mockup).
- Location: `client/src/app/pages/workspace/cycle/` (`timeline-drawer.ts`, `step-drawer.ts`) on mock data, and branch `jp-design/mockup-completo`. Check: `docs/qa-timeline-stories-check-2026-10-20.md`.
- Notes: this is a backend-only change. The confirmation pop-up and the closed-row lock already exist in the prototype. The step-1 load warning is still to be designed (P2-3972).

## Requirement Delta Preview

### ADDED Requirements

- Edit a timeline's name, its step names and dates, and its scope, with every rule problem in one 400.
- Step state per Rome day: dates of closed steps are locked, an in-progress step keeps its opening day, and an upcoming step cannot open before today.
- Scope is locked once step 1 has started.
- An in-progress change needs an explicit confirmation in the request.
- Timeline status `waiting_for_load`: step 1's date has arrived and the timeline has no load.
- An append-only audit row for every successful edit.
- Optimistic concurrency: a stale edit is refused, never merged.

### MODIFIED Requirements

- FR-12 / FR-13 of `cycle-timelines` (read model): the status set grows by `waiting_for_load`, and `currentStep` is `null` while waiting. Each step in the response carries its state.
- The create rule `BEFORE_TODAY` (step 1 only) generalizes on edit to "an upcoming step cannot open before today".

### REMOVED Requirements

- None.

## Approach Options

| | **A. One `PATCH /timelines/:id` with the editable fields (recommended)** | B. Split routes: `PATCH /timelines/:id` (name, scope) + `PATCH /timelines/:id/steps/:position` | C. `PUT /timelines/:id`: full replace, same body as create |
|---|---|---|---|
| Matches the front | Yes: one drawer, one save | Two calls per save; a partial failure leaves half an edit | Yes, but the body carries fields that cannot change |
| Cross-step rules (no overlap, order) | Checked once over the whole new state | Each step call re-checks its neighbours, and two calls can race | Checked once |
| Every problem in one 400 (FR-11) | Yes | No, split per call | Yes |
| Audit | One row per save | One row per call | One row, but a diff over locked fields adds noise |
| Risk | Smallest new surface | More routes, more races | Invites editing audience, round and load, which AC 2 does not allow |

## Recommended Approach

**Option A.** It keeps the create flow's guarantees, with every problem in one 400 and one transaction (DD-9 lock order: cycle `FOR SHARE` → timeline `FOR UPDATE`). It matches the single save of the front drawer and exposes only what AC 2 allows.

- **Body:** `version` (required), plus `name?`, `allPrograms?`, `programIds?`, `allResultTypes?`, `resultTypeKeys?`, `steps?` as `[{ position, name?, opensOn?, closesOn? }]` and `confirmInProgress?`. Steps are matched by `position`. An unknown field such as `audience`, `round` or `requiresLoad` is a 400, as everywhere (NFR-2).
- **Validation:** merge the request over the stored timeline, then run the create rules on the merged state together with the state rules. Return every issue in one `VALIDATION_FAILED`, before any write (design 7.2 pattern).
- **Waiting for load:** in `viewTimeline`, if today ≥ step 1's `opensOn` and the loads seam says "no step-1 load", status is `waiting_for_load`, `currentStep` is `null` and step 1's state is `upcoming`. The default for later steps is Q-2.
- **Concurrency (KZ-admin-config--cycle-timelines-1):** the version check is the guard; the 409 is typed, never a 500. The spec's HITL task includes two concurrent edits against real MySQL, because fakes cannot reproduce InnoDB re-reads.
- **HITL on a shared environment (KZ-admin-config--cycle-timelines-3):** the HITL task names who holds the admin token, how it reaches the check without passing through chat, and the data the checks leave behind.

## Risks, Dependencies, And Open Questions

### Open questions (for the BA unless noted)

**Closed 2026-10-21:** the back lead accepted every proposed default below; `requirements.md` records them as decisions S-1…S-8. The BA can still overrule Q-1, Q-2, Q-4, Q-6 and Q-7; an overrule reopens the spec.

| ID | Question | Proposed default | Blocks |
|---|---|---|---|
| Q-1 | "Waiting for load" before loads exist: with no way to load, every timeline that reaches its step-1 date will show `waiting_for_load`. Build it now or with P2-3905? | Build it now, with the seam answering "no load". The status is truthful, and the admin is warned to move dates | Status design |
| Q-2 | While step 1 is waiting, what happens when step 2…n dates arrive? | The whole timeline holds: no step is current and the status stays `waiting_for_load` until the admin moves the dates or a load happens | Status design |
| Q-3 | In-progress step: can its opening date change, or only its closing date? | Only the closing date, today or later | Rules |
| Q-4 | Beyond names and dates, can the admin add or remove steps, or change audience, round or `requiresLoad`? The prototype's step drawer edits "Who can work" | No: structure locked on edit (AC 2). A later story can open it | Body shape |
| Q-5 | Can an upcoming step be moved to open before today? | No. Today or later (generalizes `BEFORE_TODAY`) | Rules |
| Q-6 | If results are loaded before step 1 starts and the scope then shrinks, what happens to results now out of scope? | Refuse a scope change once the timeline has a load (seam), even before step 1 starts | Rules |
| Q-7 | AC 8 points to the "history and audit log story": which ticket? Does it read `timeline_audit_events`? | This spec writes the table; that story reads it | Audit shape |
| Q-8 *(back lead)* | Should the server require `confirmInProgress`, or leave confirmation to the front? | Require it: cheap, and a stale or scripted client cannot skip AC 9 | API |

### Risks and dependencies

| ID | Item | Owner | Blocks |
|---|---|---|---|
| R-1 | Built on `feat/cycle-timelines`, which is in `staging-center` but not `staging`. Merging this before `cycle-timelines` reaches `staging` would carry it along | Back lead | Merge order |
| R-2 | Status union change: the front's `cycles.models.ts` (just merged, P2-3934) must add `waiting_for_load` and step `state`, or it breaks on the new value | Front lead | Integration |
| R-3 | `qadb` gets migration `0004` by a human step; agents never run it | Back lead | Manual tests |
| R-4 | P2-3905 / P2-3906 also extend `timeline-view.ts` and readiness; whichever lands second rebases. The seam keeps the overlap small | Back lead | — |
| R-5 | TRD § 5.1 / § 6 edits are a pending item for `staging` unless `tasks.md` names them as a deliverable (write discipline) | Back lead | — |

## Success Criteria

- Every P2-3904 acceptance criterion maps to a requirement and a passing test. AC 1 is access, AC 2–5 are rules, AC 6 is status, AC 7 is read-time computation, AC 8 is audit and AC 9 is the confirmation flag.
- Editing a closed step's dates, or the scope after step 1 started, returns 400 naming each field, and nothing is written.
- Two concurrent edits on the same version: one succeeds, the other gets the typed 409 (fake test + HITL on MySQL).
- Each successful edit writes exactly one audit row with before/after for the changed fields only.
- `pnpm lint && pnpm build && pnpm test && pnpm test:e2e` green; the OpenAPI e2e stays in step with the router.

## Next Step

```text
/akili-specify admin-config/timeline-edit
```
