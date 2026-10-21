# Edit a QA timeline — Requirements

## 1. Document Control

| | |
|---|---|
| Spec path | `docs/specs/admin-config/timeline-edit` |
| Type | Change |
| Depth | Full (API contract change, new persisted data, migration, concurrency, read-model change consumed by the front) |
| Approval Mode | gated |
| Status | Draft |
| Source | `proposal.md` (approved 2026-10-21, Q-1…Q-8 defaults accepted); Jira P2-3904, sub-task P2-3936 |
| BA confirmation | Defaults posted to the BA on P2-3904 (comment 44119, 2026-10-21) and by Slack. An overrule of S-2, S-3, S-5, S-6 or S-7 reopens this spec |
| Builds on | `docs/specs/archive/2026-10-21-admin-config--cycle-timelines/` (cited as *timelines*: FR-6…FR-13, FR-16, FR-17, S-1, S-4, DD-2, DD-9) |
| PRD stories | US-1 (cycle configuration — timeline part); PRD problem P2 |
| Scope | Server only (`server/`) |
| Last updated | 2026-10-21 |

**Decisions (proposal Q-n defaults, accepted by the back lead 2026-10-21):**

| # | Decision | From |
|---|---|---|
| S-1 | `waiting_for_load` is built now. Until loads exist (P2-3905), "the timeline has a load" is always false | Q-1 |
| S-2 | While step 1 waits for a load, the **whole timeline holds**: no step is open, whatever the dates of steps 2–5 | Q-2 |
| S-3 | An in-progress step keeps its opening date; only its closing date can change, to today or later | Q-3 |
| S-4 | Editing changes names, dates and scope only. The step structure (count, order, audience, round, requires load) is fixed after creation | Q-4 |
| S-5 | A step that has not opened cannot be moved to open before today. *timelines* S-4 is generalized from step 1 to every step that has not opened | Q-5 |
| S-6 | Once a timeline has a load, its scope is locked, even before step 1 opens | Q-6 |
| S-7 | Every edit is recorded in a timeline audit record that this spec writes; the history story reads it | Q-7 |
| S-8 | The server requires an explicit confirmation for a change to an in-progress step (AC 9) | Q-8 |

## 2. Executive Summary

Today a timeline cannot be changed after it is created, so the QA Admin asks the tech team when a load is late or a step needs more days. This spec gives the **ADMIN** an edit of a timeline: its name, step names and dates, and its scope. Each step's state today in Rome decides what can still change. The read model adds **"Waiting for load"**, shown when step 1's date arrives with no load. Every edit is recorded, and a stale edit never overwrites a newer one. PRD problem P2.

## 3. Glossary

| Term | Meaning |
|---|---|
| Timeline, step, scope, load, Rome date | As in *timelines* § 3 |
| Step state | `closed`, `in_progress` or `upcoming`, computed from the step's dates, today's Rome date and the hold (FR-2) |
| Hold | The state of a timeline whose step 1 date has arrived with no load: nothing is open (S-2) |
| Waiting for load | The timeline status shown during a hold (FR-6) |
| Version | A number each timeline carries that changes on every edit; an edit names the version it was made on (FR-9) |
| Audit record | One stored entry per edit: who, when, request id, and each changed field's value before and after (FR-10) |
| In-progress confirmation | A flag in the edit request saying the ADMIN accepted changing a step that is open now (FR-8) |

## 4. System Context & Scope

**In scope:** edit a timeline (name, step names and dates, scope); step states; date and scope locks; the `waiting_for_load` status and the hold; in-progress confirmation; stale-edit refusal; the audit record; admin-only access; safe retries; OpenAPI; migration; module guide; front contract note.

**Out of scope:** the front (P2-3937, P2-3972); loads and the load itself (P2-3905 / P2-3906); changing step structure (S-4); reading the audit history (history story, S-7); pausing or stopping a timeline; deleting a timeline; moving results between timelines; editing in a closed cycle; TRD § 5.1 / § 6 edits beyond a pending item (proposal R-5).

**Current behavior:**

| # | Today | Evidence (`feat/timeline-edit` @ `c2cab59`) |
|---|---|---|
| C1 | No route changes a timeline; the controller has defaults, create, list, detail, assign and remove | `server/src/admin-config/timelines/timelines.controller.ts` (route decorators `@Get('timeline-defaults')`, `@Post('cycles/:id/timelines')`, `@Get('cycles/:id/timelines')`, `@Get('timelines/:id')`, `@Post('timelines/:id/users')`, `@Delete('timelines/:id/users/:assignmentId')`) |
| C2 | Steps are only inserted, never updated | `server/src/admin-config/timelines/timelines.store.ts:242` (`insertSteps`); no step update method in the `TimelinesStore` port (`timelines.store.ts:91-166`); the only `.update(` in the adapter is assignment removal (`timelines.store.ts:401`) |
| C3 | Status is `scheduled`, `live` or `finished` from dates only; `currentStep` is the step whose dates include today | `server/src/admin-config/timelines/timeline-view.ts:5,55-73` |
| C4 | Readiness always lists `NO_RESULTS_LOADED`; no load can exist | `timeline-view.ts:75`; `server/src/admin-config/AGENTS.md` § *Reserved tables* |
| C5 | Only step 1 is checked against today (`BEFORE_TODAY`) | `server/src/admin-config/timelines/timeline-rules.ts:94-97` |
| C6 | Timeline writes leave one log line, no stored audit; `user_audit_events` is the only audit table | `server/src/admin-config/timelines/timelines.service.ts:489-520`; `server/src/database/drizzle/schema/user-audit-events.ts:36-60` |
| C7 | `timelines` has no version or update columns | `server/src/database/drizzle/schema/timelines.ts` (columns `id`, `cycleId`, `name`, `kind`, `officialKey`, `allPrograms`, `allResultTypes`, `createdAt`, `createdBy`) |

## 5. Stakeholders / Personas

| Role (PRD § 3) | Scope | What they need from this spec |
|---|---|---|
| ADMIN ("QA Admin", *timelines* D-4) | Global | Fix names, dates and scope without the tech team; know when step 1 is blocked by a missing load |
| ASSESSOR, LEAD_ASSESSOR, TPB, PPU | Assigned timelines | New dates take effect for them at once (no visible change in this spec beyond dates) |
| Front (P2-3937) | — | One edit call, step states to lock fields, the new status, the error codes |
| Load stories (P2-3905 / P2-3906) | — | A single place to say "this timeline has a load" that the status and the scope lock read |

## 6. Functional Requirements

### FR-1: Edit a timeline

An ADMIN SHALL be able to change, in one request, any of: the timeline's name; the name, opening date and closing date of any of its steps; its Science Programs scope; its result types scope (AC 2, AC 4). Fields left out SHALL keep their stored value. Steps SHALL be identified by their position (S-4).

#### Scenario: Extend a step
- GIVEN a timeline whose step 1 is upcoming
- WHEN an ADMIN sends a new closing date for step 1 only
- THEN step 1's closing date changes and every other field keeps its value
- AND the answer is the timeline as read after the change, with its new version

#### Scenario: Structure is fixed
- WHEN the request carries a step audience, a round, a "requires load" flag, a kind, a new step or a step without a position
- THEN it is refused with 400 and nothing is written
- BUT it must NOT add, remove or reorder steps (S-4)
- AND IT MUST refuse a position the timeline does not have, or the same position twice, naming that step

### FR-2: Step state

Each step SHALL have a state computed on read from its dates, today's Rome date and the hold (FR-6). A step is open from 00:00 of its opening day to 23:59:59 of its closing day, Rome time (*timelines* S-1).

| State | When |
|---|---|
| `closed` | Its closing day is before today, and the timeline is not on hold |
| `in_progress` | Today is between its opening and closing days, both included, and the timeline is not on hold |
| `upcoming` | Its opening day is after today, **or** the timeline is on hold (every step) |

#### Scenario: Midnight boundary
- GIVEN step 1 closes on 6 Nov and the timeline has a load
- WHEN read at 23:59 Rome on 6 Nov, then at 00:00 Rome on 7 Nov
- THEN step 1 is `in_progress`, then `closed`

#### Scenario: On hold
- GIVEN step 1 opened on 2 Nov, step 2 opens on 10 Nov, there is no load, and today is 12 Nov
- THEN every step is `upcoming`
- BUT step 2 must NOT be `in_progress` (S-2)

### FR-3: Date locks by step state

The system SHALL refuse a date change the step's state does not allow (AC 3, S-3, S-5):

| State | Opening date | Closing date |
|---|---|---|
| `closed` | locked | locked |
| `in_progress` | locked | today or later |
| `upcoming` | today or later | not before its opening date |

A date sent with its stored value is not a change, and SHALL NOT be refused by these locks.

#### Scenario: Closed step
- WHEN an ADMIN sends a new closing date for a closed step
- THEN the request is refused with 400 naming that step's closing date as locked
- BUT a new name for that step must NOT be refused

#### Scenario: In-progress step
- GIVEN step 1 is in progress since 2 Nov and today is 5 Nov
- WHEN an ADMIN moves its closing date to 4 Nov, and its opening date to 3 Nov
- THEN both are refused in one 400: the closing date as before today, the opening date as locked
- AND IT MUST accept a closing date of 5 Nov (today) — the step then closes at the end of today

#### Scenario: Upcoming step
- WHEN an ADMIN moves an upcoming step to open yesterday
- THEN it is refused as before today
- AND IT MUST accept today — the step is then in progress at once

#### Scenario: Unchanged past date on hold
- GIVEN the timeline is on hold and step 1's stored opening day is in the past
- WHEN an ADMIN only renames the timeline
- THEN the rename succeeds
- BUT the past opening day must NOT be reported as before today, because it was not changed

### FR-4: Scope lock

The system SHALL accept a scope change only while step 1 has not started and the timeline has no load (AC 4, S-6). Step 1 has not started while its state is `upcoming` (on hold included). A scope sent equal to the stored one is not a change.

#### Scenario: Before step 1
- GIVEN step 1 is upcoming and there is no load
- WHEN an ADMIN changes the programs from SP01 to SP01 and SP02
- THEN the scope changes, under the same rules as creation (explicit "all" or at least one known item — *timelines* FR-6, DD-6)

#### Scenario: After step 1 started
- GIVEN step 1 is in progress or closed
- WHEN an ADMIN changes the result types
- THEN it is refused with 400 naming the result types as locked, and nothing is written

#### Scenario: Load done, step 1 not started
- GIVEN the timeline has a load and step 1 is upcoming
- WHEN an ADMIN changes the programs
- THEN it is refused as locked
- BUT until loads exist this case cannot occur (S-1); the lock MUST still read the same "has a load" source as FR-6

### FR-5: The creation rules still hold, every problem at once

After applying the request over the stored timeline, the result SHALL satisfy every creation rule (AC 5): name and step names required and at most 120 characters; the name unique in the cycle whatever the letter case; dates real; no step closing before it opens; each step opening after the previous step's closing day; scope rules. When the request breaks any rule of FR-1, FR-3, FR-4 or this one, the system SHALL answer one 400 listing **every** problem with its field path and catalog code, and write nothing (*timelines* FR-11).

#### Scenario: Overlap introduced by an edit
- GIVEN step 2 opens on 10 Nov
- WHEN an ADMIN moves step 1's closing date to 12 Nov
- THEN it is refused naming step 2's opening date as overlapping the previous step
- AND IT MUST report it on the step whose position the rule names, even though only step 1 was sent

#### Scenario: Several problems
- WHEN the name is empty, a closed step's date is changed and the scope changes after step 1 started
- THEN one 400 lists all three
- BUT it must NOT stop at the first, and must NOT use free text or database text

#### Scenario: Name taken
- WHEN the new name equals another timeline's name in the same cycle, in any letter case
- THEN it is refused with 409 and nothing is written

### FR-6: Waiting for load

A timeline SHALL be **on hold** when today is on or after step 1's opening day and the timeline has no load (AC 6, S-1, S-2). While on hold, its status SHALL be `waiting_for_load`, it SHALL have no current step, and its next step SHALL be step 1. The hold ends when a load exists or when step 1's opening day is moved after today.

| Status | When |
|---|---|
| `scheduled` | Today is before step 1's opening day |
| `waiting_for_load` | On hold |
| `live` | Not on hold, and today is on or before the last step's closing day |
| `finished` | Not on hold, and today is after the last step's closing day |

#### Scenario: Step 1 date arrives without a load
- GIVEN step 1 opens on 2 Nov and no load exists
- WHEN the timeline is read at 00:00 Rome on 2 Nov
- THEN its status is `waiting_for_load`, it has no current step, and its next step is step 1
- BUT it must NOT be `live`

#### Scenario: All dates passed while on hold
- GIVEN the timeline is on hold and every step's closing day has passed
- THEN its status is still `waiting_for_load`, not `finished` (S-2)

#### Scenario: Admin moves the dates
- GIVEN the timeline is on hold
- WHEN an ADMIN moves step 1 to open after today
- THEN on the next read its status is `scheduled`

#### Scenario: Load present (seam)
- GIVEN the "has a load" source answers yes for the timeline
- THEN the status, current step and step states are those of *timelines* FR-12

### FR-7: Changes apply at once

An edit SHALL take effect on the next read for everyone, with no job and no stored status (AC 7, *timelines* DD-2).

#### Scenario: Extend an in-progress step
- GIVEN step 3 is in progress and closes today
- WHEN an ADMIN moves its closing date to next week (with confirmation)
- THEN any read after the edit shows step 3 in progress until next week
- BUT no stored status may be written for this to happen

### FR-8: In-progress confirmation

An edit that changes any field of an `in_progress` step SHALL be accepted only when the request carries the in-progress confirmation (AC 9, S-8). Without it the system SHALL refuse with 409 and write nothing. The check SHALL run only when the request has no rule problem (FR-5): rule problems answer first.

#### Scenario: Not confirmed
- WHEN an ADMIN changes the closing date of an in-progress step without confirmation
- THEN the answer is 409 with a code saying confirmation is needed, and nothing is written

#### Scenario: Confirmed
- WHEN the same request carries the confirmation
- THEN the change is saved

#### Scenario: Confirmation not needed
- WHEN the request changes only upcoming or closed-step names, the timeline name or the scope
- THEN no confirmation is required, and a confirmation sent anyway is accepted and ignored

### FR-9: Stale edits are refused

Each timeline SHALL carry a version, returned on every read. An edit SHALL name the version it was made on; the system SHALL apply it only if that is still the timeline's version, and SHALL change the version on every applied edit. Otherwise it SHALL refuse with 409 and write nothing.

#### Scenario: Two admins
- GIVEN Ana and Luis both read version 4
- WHEN Ana saves, then Luis saves
- THEN Ana's edit applies and the version changes; Luis gets 409 stale and his edit is not applied
- BUT Luis's edit must NOT be merged into or overwrite Ana's
- AND IT MUST hold when both requests arrive at the same moment

#### Scenario: Version missing
- WHEN the request has no version
- THEN it is refused with 400

### FR-10: Audit record

Every applied edit SHALL store one audit record with: the timeline, the acting ADMIN, the time, the request id, and each changed field with its value before and after, steps identified by position (AC 8, S-7). It SHALL be written in the same transaction as the edit.

#### Scenario: One record per edit
- WHEN an ADMIN changes the timeline name and step 2's closing date in one request
- THEN exactly one record exists for it, listing those two fields with before and after
- BUT it must NOT list fields that did not change

#### Scenario: Failed edit
- WHEN an edit is refused (400, 404, 409)
- THEN no audit record is written

#### Scenario: Append-only
- THEN audit records are never changed or deleted by this spec's code

### FR-11: No-op edit

An edit whose fields all equal the stored values SHALL succeed with the timeline as read, and SHALL NOT change the version or write an audit record.

#### Scenario: Same values
- WHEN an ADMIN saves the drawer without changing anything, with the current version
- THEN the answer is 200 with the same version, and no audit record is added

### FR-12: Access and refusals

The edit SHALL require the ADMIN permission (AC 1, *timelines* FR-16). An unknown timeline SHALL answer 404. A timeline in a `closed` cycle SHALL answer 409 `CYCLES_CLOSED`. A malformed body or unknown field SHALL answer 400 (*timelines* NFR-2).

#### Scenario: Non-admin
- WHEN an ASSESSOR calls the edit
- THEN the answer is 403 and nothing is read or written
- WHEN no or an invalid token is sent
- THEN the answer is 401

#### Scenario: Closed cycle
- GIVEN the timeline's cycle is closed
- WHEN an ADMIN edits it
- THEN the answer is 409 and nothing is written

### FR-13: Safe retries

The edit SHALL accept an optional `Idempotency-Key` with the same guarantees as the creates (*timelines* FR-17): a replay with the same key and body returns the first answer and applies nothing again.

#### Scenario: Replay after a lost answer
- GIVEN an edit applied with 200 under key K, moving the version from 4 to 5
- WHEN the same request (version 4) is sent again with K
- THEN the first 200 is returned
- BUT it must NOT answer 409 stale, and must NOT write a second audit record

### FR-14: Read model carries the new fields

Timeline list and detail SHALL return, beside what *timelines* FR-12 returns: the `waiting_for_load` status (FR-6), each step's state (FR-2) and the timeline's version (FR-9).

#### Scenario: Detail
- WHEN an ADMIN reads a timeline
- THEN each step has its state and the timeline has its version
- AND IT MUST keep every field *timelines* FR-12 returns, with the same meaning, except that status can now also be `waiting_for_load`

## 7. Non-Functional Requirements

| ID | Attribute | Scenario (source → stimulus → response) | Measure | TRD ref |
|---|---|---|---|---|
| NFR-1 | Security | Non-admin → the edit route → refused before any read | 403, covered by the e2e access matrix | QAS-SEC-2 |
| NFR-2 | Security | Any client → unknown or structural field (audience, round, kind…) → refused | 100 % → 400 | QAS-SEC-3 |
| NFR-3 | Integrity | Two ADMINs → concurrent edits of one timeline, or an edit racing a create of the same name → no lost update, no duplicate name | Exactly one of two same-version edits applies; enforced in the database write, not only by a prior read; HITL on real MySQL (KZ-admin-config--cycle-timelines-1) | QAS-AVL-1 |
| NFR-4 | Correctness | Clock → any instant, including both daylight-saving changes → step state, hold, locks | One injectable clock; tests at midnight boundaries and both DST changes; run with `TZ=UTC` and `TZ=America/Bogota` | *timelines* NFR-4 |
| NFR-5 | Performance | ADMIN → edits a timeline; lists a cycle with up to 50 timelines | Edit: fixed number of queries whatever the number of steps; list: still a fixed number of queries (*timelines* NFR-5) after adding the load source | QAS-PERF-1 |
| NFR-6 | Modifiability | Load stories → provide "has a load" | One provider swapped; no change to the edit rules, the status rules or this spec's tables | QAS-MOD-1 |
| NFR-7 | Observability | ADMIN edit → one decision line | Action `timeline_update`, ids, outcome, reason; no names, emails or bodies | *timelines* NFR-7 |
| NFR-8 | Auditability | Any applied edit → retrievable record | 100 % of applied edits have exactly one audit record; 0 for refused ones | PRD P3 (history) |

### Defect classes and their gates

| Defect class this spec can produce | Gate (command or check) | Substitute / accepted risk |
|---|---|---|
| A lock rule missing or wrong (state × field × changed/unchanged) | Table-driven unit tests over every state and field — `pnpm test --reporter=dot` | — |
| Step state or hold wrong at a boundary (midnight, DST, server zone) | Unit tests with an injected clock under `TZ=UTC` and `TZ=America/Bogota` | — |
| Merged-state rule missed (an edit to one step breaks a neighbour) | Unit tests that send one step and assert the issue on another | — |
| Several errors collapsed, or 409 confirmation answered before rule problems | Unit + e2e asserting the full `fields` list and the answer order | — |
| Lost update under concurrency | Service tests over the fake store + a database-level conditional write | **Fakes cannot reproduce InnoDB re-reads** (KZ-admin-config--cycle-timelines-1): HITL concurrent-edit check on MySQL after migration `0004` |
| Audit record missing, duplicated on replay, or written for a refused edit | Unit-of-work tests; e2e replay test | — |
| Read-model change breaks an existing consumer (status union, new step field) | e2e of list/detail; front contract note; consumer grep in `design.md` | Front update is P2-3937 (front lead) |
| Route without the admin guard, wrong status code | e2e 401/403 matrix — `pnpm test:e2e --reporter=dot` | — |
| OpenAPI out of step with the router | `test/openapi.e2e-spec.ts` | — |
| Type errors the test runner erases | `pnpm build` | — |
| Lint drift | `pnpm lint` (0 warnings) | — |
| Migration differs from schema, or not applied | `schema.spec.ts` pins the DDL | Applying `0004` to `qadb` is a human step (proposal R-3); HITL plan names the token handover and leftover data (KZ-admin-config--cycle-timelines-3) |

## 8. Requirement ID Index

| ID | Title | Scenarios | Owning task(s) |
|---|---|---|---|
| FR-1 | Edit a timeline | Extend a step · Structure is fixed | T-3, T-5, T-6, T-7 |
| FR-2 | Step state | Midnight boundary · On hold | T-2 |
| FR-3 | Date locks by step state | Closed step · In-progress step · Upcoming step · Unchanged past date on hold | T-3, T-7 |
| FR-4 | Scope lock | Before step 1 · After step 1 started · Load done, step 1 not started | T-2, T-3, T-7 |
| FR-5 | Creation rules still hold | Overlap introduced by an edit · Several problems · Name taken | T-3, T-4, T-7 |
| FR-6 | Waiting for load | Step 1 date arrives without a load · All dates passed while on hold · Admin moves the dates · Load present | T-2, T-7, T-9 |
| FR-7 | Changes apply at once | Extend an in-progress step | T-2, T-5, T-7 |
| FR-8 | In-progress confirmation | Not confirmed · Confirmed · Confirmation not needed | T-5, T-7 |
| FR-9 | Stale edits are refused | Two admins · Version missing | T-4, T-5, T-6, T-7, T-9 |
| FR-10 | Audit record | One record per edit · Failed edit · Append-only | T-1, T-3, T-4, T-5 |
| FR-11 | No-op edit | Same values | T-3, T-5, T-7 |
| FR-12 | Access and refusals | Non-admin · Closed cycle | T-5, T-6, T-7 |
| FR-13 | Safe retries | Replay after a lost answer | T-6, T-7 |
| FR-14 | Read model carries the new fields | Detail | T-2, T-7 |
| NFR-1…NFR-8 | See § 7 | — | see tasks.md § Coverage |

### Acceptance criteria → requirements (P2-3904)

| AC | Requirement |
|---|---|
| 1 Only QA Admin | FR-12, NFR-1 |
| 2 Name, step names and dates | FR-1 |
| 3 Closed steps' dates locked | FR-2, FR-3 |
| 4 Scope only before step 1 | FR-4 |
| 5 Same date validations as creation | FR-5 |
| 6 Waiting for load | FR-6, FR-14 |
| 7 In-progress changes apply at once | FR-7 |
| 8 Every change recorded | FR-10, NFR-8 |
| 9 Confirm before changing an in-progress step | FR-8 |
