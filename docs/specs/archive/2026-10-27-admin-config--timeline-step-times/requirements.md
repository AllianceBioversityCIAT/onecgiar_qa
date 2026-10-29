# Timeline step times — Requirements

## 1. Document Control

| | |
|---|---|
| Spec path | `docs/specs/admin-config/timeline-step-times` |
| Type | Change |
| Depth | Full: migration of stored data, API contract change, and rules shared by three specs |
| Approval Mode | gated |
| Status | Delivered (archived 2026-10-27). T-8 partially done; see `archive-summary.md` |
| Source | `proposal.md`, accepted when the back lead ran `/akili-specify` on 2026-10-27. Q-1…Q-7 are taken at their proposed defaults. Jira P2-4019 (AC 1–7), sub-tasks P2-4020 (back) and P2-4021 (front) |
| BA confirmation | Pending. S-1, S-2 and S-6 are business choices; an overrule reopens this spec |
| Builds on | *timelines* = `docs/specs/archive/2026-10-21-admin-config--cycle-timelines/`; *edit* = `docs/specs/admin-config/timeline-edit/`; *fields* = `docs/specs/archive/2026-10-27-admin-config--field-configuration/` |
| PRD stories | US-1 (cycle configuration, timeline part) |
| Scope | Server (`server/`). The front adapts through `front-contract.md` (P2-4021) |
| Last updated | 2026-10-27 |

**Decisions (proposal defaults, accepted by the back lead on 2026-10-27):**

| # | Decision | From |
|---|---|---|
| S-1 | Two steps **may share a day**. The next step opens strictly after the previous step's closing minute | Q-1 |
| S-2 | The closing minute is included: a step closing at `17:30` is open until 17:30:59 | Q-2 |
| S-3 | Times from 02:00 to 02:59 on the two Rome DST change days are refused | Q-3 |
| S-4 | "Before today" rules become "before now" (to the minute). The field code stays `BEFORE_TODAY` | Q-4 |
| S-5 | Each timeline in a response states the time zone (`Europe/Rome`). The server defines it in exactly one place | Q-5, back lead |
| S-6 | A day-only date means 00:00 when it opens a step and 23:59 when it closes one. This applies to migrated rows and to day-only requests | Q-6, proposal AC 6 |
| S-7 | Stored as Rome wall-clock time, minute precision, one fixed zone. No UTC storage and no per-cycle zone | Back lead, 2026-10-27 |

## 2. Executive Summary

Today a timeline step opens at 00:00 and closes at 23:59:59 Rome time on whole days. QA wants each step to open and close at an exact hour and minute (P2-4019).

With this spec, the **ADMIN** sets `opensAt` and `closesAt` for every step. Every rule that depends on step dates then works on the **current Rome minute** instead of today's date:

- order and overlap;
- status, step state and the load hold;
- edit locks;
- which field-configuration version a timeline uses.

Existing timelines keep behaving exactly as they do today. The API stays backward compatible until the front moves (P2-4021).

## 3. Glossary

| Term | Meaning |
|---|---|
| Rome time | Wall-clock time in IANA `Europe/Rome` (CET / CEST). Written `YYYY-MM-DDTHH:mm`, with no offset |
| Opening moment (`opensAt`) | The Rome minute at which a step opens, from its second :00 |
| Closing moment (`closesAt`) | The last Rome minute in which a step is open, up to its second :59 (S-2) |
| Now (Rome) | The current instant read as Rome time. Every rule compares it at second precision against a step's window |
| Day-only date | `YYYY-MM-DD`: the old `opensOn` / `closesOn` form, kept for compatibility (FR-9) |
| DST change day | The last Sunday of March (02:00 does not exist) and the last Sunday of October (02:00–02:59 happens twice), in Rome |
| Step, scope, load, hold, step state, version, audit record | As in *timelines* § 3 and *edit* § 3 |

## 4. System Context & Scope

**In scope:**

- step opening and closing moments, with validation (format, order, overlap, DST);
- now-based rules: the create back-date check, the edit locks, step state, status and hold, and the field-configuration start and finish;
- the day-only compatibility read and write;
- the time zone stated once and exposed;
- migration of stored steps;
- audit keys; the cycle span;
- OpenAPI, the module guide, and the front contract.

**Out of scope:**

- the date and time picker, labels and "Reset to official timeline" in the front (P2-4021; this spec only describes the contract);
- a configurable or per-cycle zone; storing UTC;
- second precision;
- changing the steps flow or the load rules (P2-4019 *Out of scope*);
- removing `opensOn` / `closesOn` from the API;
- a cycle span to the minute.

**Current behavior** (evidence at `feat/timeline-step-times` @ `8ac4df7`):

| # | Today | Evidence |
|---|---|---|
| C1 | Steps store `opens_on` / `closes_on` as `DATE`, read as `YYYY-MM-DD` Rome strings. The check allows the same day | `server/src/database/drizzle/schema/timeline-steps.ts:44-47`, check `chk_timeline_steps_dates` (`closes_on >= opens_on`) |
| C2 | A step is open from 00:00 of its opening day to 23:59:59 of its closing day. The next step opens on a later day | *timelines* `requirements.md:22` (S-1); `server/src/admin-config/timelines/timeline-rules.ts:196-215` (`compareDates(opensOn, previousClose) <= 0` → `OVERLAPS_PREVIOUS_STEP`; `compareDates(closesOn, opensOn) < 0` → `CLOSES_BEFORE_OPENS`) |
| C3 | A malformed or missing date is `INVALID` / `REQUIRED` | `timeline-rules.ts:259-273` (`readDate`) |
| C4 | Rules receive `today` (`YYYY-MM-DD`), never a time. That covers step 1 `BEFORE_TODAY`, edit `LOCKED` / `BEFORE_TODAY`, and the status, step state and hold | `timeline-rules.ts:44-45`, `:104-106`, `:529-561`; `server/src/admin-config/timelines/timeline-view.ts:22-23`, `:66-105` |
| C5 | `'Europe/Rome'` is a literal in the server and again in the front | `server/src/admin-config/rome-date.ts:7`; `client/src/app/core/domain/rome-date.ts:66` |
| C6 | A timeline starts at 00:00 Rome on step 1's day, for field-configuration versions | `server/src/admin-config/field-config/field-config-versions.ts:50-102`; *fields* `requirements.md:24,26` (S-3, S-5) |
| C7 | The API speaks in days: DTOs, response, OpenAPI model, and the audit diff keys `steps.<n>.opensOn` / `closesOn` | `server/src/admin-config/timelines/dto/create-timeline.dto.ts:55,66`; `timeline-response.ts:25-26,99-100`; `models/timeline.model.ts:56,64`; `timeline-diff.ts:76-77` |
| C8 | The cycle span is `min(opens_on)` / `max(closes_on)` | `server/src/admin-config/cycles/cycles.store.ts:128-129` |
| C9 | The front labels assume 00:00 and 23:59 | `client/src/app/core/domain/rome-date.ts:55-62` |
| C10 | The latest migration is `0005_field_configuration` | `server/drizzle/meta/_journal.json` (last `tag`) |

## 5. Stakeholders / Personas

| Role (PRD § 3) | Scope | What they need from this spec |
|---|---|---|
| ADMIN ("QA Admin") | Global | Set the exact hour; get one clear error per wrong time |
| ASSESSOR, LEAD_ASSESSOR, TPB, PPU | Assigned timelines | Their step opens and closes at the announced minute |
| Front (P2-4021) | — | `opensAt` / `closesAt` and `timeZone` in every timeline; the error codes; a compatibility window |
| BA | — | Confirm S-1, S-2 and S-6 |

## 6. Functional Requirements

### FR-1: Step opening and closing moments

Every step SHALL have an opening moment and a closing moment in Rome time, written `YYYY-MM-DDTHH:mm`. Create and edit SHALL accept them, and every timeline read SHALL return them (AC 1, AC 2).

#### Scenario: Valid moments
- GIVEN now is 2026-11-02T10:00 Rome
- WHEN an ADMIN creates a timeline whose step 1 runs from `2026-11-10T14:00` to `2026-11-12T17:30`
- THEN the step is stored and returned with exactly those moments

#### Scenario: Malformed or missing moment
- WHEN a moment is missing, carries seconds or an offset (`…T14:00:00`, `…T14:00Z`), or is not a real date and time (`2026-02-30T10:00`, `…T24:00`)
- THEN the request is refused with 400 naming that field, with code `REQUIRED` or `INVALID`
- BUT the step must NOT be dropped, and the value must NOT be read in any other zone

### FR-2: A step's open window

A step SHALL be open from second :00 of its opening minute to second :59 of its closing minute, Rome time, both included (S-2, AC 3).

#### Scenario: Boundaries
- GIVEN a step runs from `2026-11-10T14:00` to `2026-11-12T17:30` and the timeline has a load
- WHEN it is read at 13:59:59 and at 14:00:00 on 10 Nov, then at 17:30:59 and at 17:31:00 on 12 Nov
- THEN its state is `upcoming`, `in_progress`, `in_progress`, `closed`
- AND IT MUST give the same answer whatever the server's process time zone

#### Scenario: Whole-day window is unchanged
- GIVEN a step runs from `2026-11-02T00:00` to `2026-11-06T23:59`
- THEN it is open exactly when *timelines* S-1 said a 2–6 Nov step was open

### FR-3: Order and overlap at minute level

A step's closing moment SHALL be after its opening moment, and a step SHALL open after the previous step's closing moment (AC 4, S-1).

#### Scenario: Same moment or reversed
- WHEN a step opens and closes at the same minute, or closes before it opens
- THEN the request is refused with 400 naming its `closesAt`, with code `CLOSES_BEFORE_OPENS`

#### Scenario: Two steps on the same day
- GIVEN step 1 closes at `2026-11-10T12:00`
- WHEN step 2 opens at `2026-11-10T14:00`
- THEN the timeline is valid

#### Scenario: Overlap
- GIVEN step 1 closes at `2026-11-10T12:00`
- WHEN step 2 opens at `2026-11-10T12:00` or earlier
- THEN it is refused, naming step 2's `opensAt`, with code `OVERLAPS_PREVIOUS_STEP`
- AND IT MUST accept `2026-11-10T12:01`

### FR-4: Hours that DST makes ambiguous

The system SHALL refuse an opening or closing moment from 02:00 to 02:59 on a Rome DST change day (S-3).

#### Scenario: Spring and autumn
- WHEN a step opens at `2027-03-28T02:30` (the hour does not exist) or closes at `2026-10-25T02:15` (the hour happens twice)
- THEN it is refused with 400 naming that field, with code `DST_HOUR`
- BUT `2026-10-25T03:00` and `2026-10-25T01:59` must NOT be refused

#### Scenario: A step that spans the change
- GIVEN a step runs from `2026-10-24T09:00` to `2026-10-26T09:00`
- WHEN it is read at 02:30 Rome on 25 Oct, during either occurrence of that hour
- THEN it is `in_progress`

### FR-5: Creating a timeline cannot start in the past (to the minute)

A new timeline's step 1 SHALL NOT open before the current Rome minute. This updates *timelines* S-4 / FR-8 (S-4).

#### Scenario: Earlier today
- GIVEN now is 2026-11-10T14:20 Rome, and the timeline has a load *(amended 2026-10-27: step 1 always requires a load, FR-7)*
- WHEN step 1 opens at `2026-11-10T14:00`
- THEN it is refused, naming step 1's `opensAt`, with code `BEFORE_TODAY`
- AND IT MUST accept `2026-11-10T14:20`, the step then being `in_progress` at once

### FR-6: Edit locks by moment

The edit locks of *edit* FR-3 SHALL use the step state of FR-7 and the current Rome minute in place of today (S-4):

| State | Opening moment | Closing moment |
|---|---|---|
| `closed` | locked (`LOCKED`) | locked (`LOCKED`) |
| `in_progress` | locked (`LOCKED`) | the current minute or later (`BEFORE_TODAY`) |
| `upcoming` | the current minute or later (`BEFORE_TODAY`) | after its opening moment (FR-3) |

A moment sent equal to its stored value is not a change, and these locks SHALL NOT refuse it (*edit* FR-3).

#### Scenario: Close an in-progress step now
- GIVEN step 1 is in progress and now is 2026-11-10T14:20:30 Rome
- WHEN an ADMIN moves its closing moment to `2026-11-10T14:20`
- THEN it is accepted, and the step closes at 14:20:59
- BUT `2026-11-10T14:19` must NOT be accepted

#### Scenario: Unchanged past moment
- GIVEN the timeline is on hold and step 1's stored opening moment is in the past
- WHEN an ADMIN only renames the timeline
- THEN the rename succeeds

### FR-7: Step state, status and hold from now

Step state, timeline status, current and next step, the hold (`waiting_for_load`), and the scope lock (*edit* FR-4) SHALL be derived from **now** in Rome against each step's window (FR-2). This replaces today's date (*timelines* FR-12; *edit* FR-2, FR-4, FR-6). Nothing SHALL be stored or scheduled for this to happen.

| Status | When |
|---|---|
| `scheduled` | Now is before step 1's opening moment |
| `waiting_for_load` | Now is at or after step 1's opening moment, and there is no load |
| `live` | Not on hold, and now is at or before the end of the last step's closing minute |
| `finished` | Not on hold, and now is after the last step's closing minute |

#### Scenario: The hold starts at the hour
- GIVEN step 1 opens at `2026-11-10T14:00` and there is no load
- WHEN the timeline is read at 13:59 and then at 14:00 Rome on 10 Nov
- THEN its status is `scheduled`, then `waiting_for_load`
- BUT it must NOT be `waiting_for_load` at 00:00 that day

#### Scenario: Between two steps on the same day
- GIVEN step 1 closes at 12:00 and step 2 opens at 14:00 on the same day, and there is a load
- WHEN read at 13:00
- THEN there is no current step, and the next step is step 2

### FR-8: Field-configuration versions use the opening moment

A timeline SHALL **start**, for *fields* FR-9, at step 1's opening moment. It SHALL **finish** after its last step's closing minute. This replaces *fields* S-3 and S-5.

#### Scenario: Published the same morning
- GIVEN timeline A's step 1 opens at `2026-11-10T14:00` and timeline B's step 1 opened at `2026-11-10T08:00`
- WHEN version 3 is published at 09:00 Rome on 10 Nov
- THEN A resolves to version 3, and B keeps the version before 3

#### Scenario: Published in the opening minute
- WHEN version 3 is published at 14:00:10 Rome and A opens at `2026-11-10T14:00`
- THEN A keeps the version before 3, because the publish instant is not before the start

### FR-9: Day-only compatibility

Until the front moves to moments (P2-4021), the API SHALL keep the day-only form:

- **Read:** every step SHALL also return `opensOn` and `closesOn`, the date part of its moments.
- **Write:** a step MAY carry the day-only `opensOn` / `closesOn` in place of `opensAt` / `closesAt`. They mean 00:00 and 23:59 that day (S-6), and every rule of FR-3…FR-6 applies to the resulting moment.

#### Scenario: Old client creates a timeline
- WHEN a request sends step 1 `opensOn: 2026-11-10`, `closesOn: 2026-11-12`
- THEN the step is stored from `2026-11-10T00:00` to `2026-11-12T23:59`, and both forms are returned

#### Scenario: Both forms for the same moment
- WHEN one step carries both `opensAt` and `opensOn` (or both `closesAt` and `closesOn`)
- THEN it is refused with 400 naming the day-only field, with code `INVALID`
- BUT it must NOT pick one silently, even when they agree

#### Scenario: Day-only edit over a stored time
- GIVEN step 2 is stored from `…T14:00` to `…T17:30`
- WHEN an edit sends only `steps[1].name`
- THEN both moments keep their stored values
- BUT a day-only `closesOn` sent equal to the stored date must NOT be treated as unchanged when the stored time is not 23:59. It becomes `…T23:59`, and the locks of FR-6 judge that change

### FR-10: One time zone, stated in the response

The server SHALL define the platform time zone in exactly one place. Every timeline in a response SHALL carry `timeZone: "Europe/Rome"` (AC 5, S-5).

#### Scenario: Read
- WHEN an ADMIN reads a timeline or a cycle's timelines
- THEN each timeline carries `timeZone` equal to `Europe/Rome`
- AND IT MUST come from the same definition every rule of this spec uses

### FR-11: Stored steps keep their behavior

Migration SHALL convert every stored step to the opening moment `…T00:00` of its opening day and the closing moment `…T23:59` of its closing day (AC 6, S-6). It SHALL be reversible to day-only columns.

#### Scenario: Migrated timeline
- GIVEN a timeline stored before the migration, with step 1 from 2 Nov to 6 Nov
- WHEN it is read after the migration at any instant
- THEN its status, step states, current step, locks and field-configuration version are the same as before the migration at that instant

### FR-12: Audit records name moments

An edit that changes a moment SHALL record it in the timeline audit record under `steps.<position>.opensAt` / `closesAt`, with the `YYYY-MM-DDTHH:mm` values before and after (*edit* FR-10). Records written before this spec SHALL NOT be rewritten.

#### Scenario: Time-only change
- WHEN an ADMIN moves step 2's closing moment from `…T17:30` to `…T18:00`
- THEN the audit record holds `steps.2.closesAt` with both values
- BUT it must NOT also record `steps.2.closesOn`

### FR-13: Cycle span stays in days

The cycle's `startsOn` and `endsOn` SHALL remain Rome dates: the date part of the earliest opening moment and of the latest closing moment of its timelines.

#### Scenario: Unchanged shape
- WHEN a cycle is read
- THEN `startsOn` / `endsOn` are `YYYY-MM-DD` as before

### FR-14: Front contract

The spec SHALL publish `front-contract.md`. It covers:

- the new fields and `timeZone`;
- the new code `DST_HOUR` and the changed meaning of `BEFORE_TODAY`;
- the compatibility window (FR-9);
- the audit key change (FR-12);
- for P2-4021: the picker needs hour and minute (AC 1); the labels show the stored times (AC 2); "Reset to official timeline" keeps the official steps' times (AC 7).

#### Scenario: Contract matches the server
- WHEN the contract is compared with the OpenAPI document and the error catalog
- THEN every field and code it names exists there

## 7. Non-Functional Requirements

| ID | Attribute | Scenario (source → stimulus → response) | Measure | TRD ref |
|---|---|---|---|---|
| NFR-1 | Correctness across zones | Test runner → runs the timeline and field-config suites with the process zone at `UTC` and at `America/Bogota` → same results | 0 differences between the two runs | New |
| NFR-2 | Single source of truth | Reviewer → searches the server sources for the zone name → one definition | `grep -rn "Europe/Rome" server/src --include='*.ts' --exclude='*.spec.ts'` returns 1 code line (comments excluded) | New |
| NFR-3 | Safe migration | A human applies `0006` and then its down script on a local MySQL holding steps (agents never migrate `qadb`, `server/src/database/AGENTS.md:49-50`) → the data round-trips | Day-only values are identical after up + down; checked at the HITL pause | New |
| NFR-4 | No new read cost | ADMIN → lists a cycle's timelines → same database round-trips as today | Query count unchanged in the existing list test | New |

### Defect classes and their gates

| Defect class this spec can produce | Gate (command or check) | Substitute / accepted risk |
|---|---|---|
| Off-by-one at a boundary (minute :59, the same minute, overlap) | Unit tests on the rules and view with pinned instants (`cd server && npm test`) | — |
| A day compared with a moment (a string-length mix-up in a lexical compare) | Unit tests that put a day-only value and a moment through the same rule; the build's type check | — |
| Process zone leaking in | NFR-1 dual-zone run (`TZ=UTC npm test`, `TZ=America/Bogota npm test`) | — |
| DST mis-handling | FR-4 unit tests on 2026-10-25 and 2027-03-28 | — |
| Migration loses or shifts data | A unit test pins the statements of `0006` and of its down script (`npm test`) | The repo has no disposable MySQL (unit-of-work suites run over a stub driver). The real up + down is a human check at the HITL pause (NFR-3) |
| Contract drift (OpenAPI, catalog, front contract) | Existing OpenAPI pin tests and the error-catalog spec (`npm test`), plus FR-14 cross-check at review | — |
| Compiler-only defect (DTO and response types) | `cd server && npm run build` | — |
| Field-config version resolution changes for existing timelines | The *fields* version tests re-run unchanged, plus the FR-8 scenarios | — |
| Front reading the wrong field | No server gate | Accepted here; owned by P2-4021 and checked at the HITL pause through `front-contract.md` |

## 8. Requirement ID Index

| ID | Title | Scenarios | Owning task(s) |
|---|---|---|---|
| FR-1 | Step opening and closing moments | 2 | T-1, T-4, T-5, T-6 |
| FR-2 | A step's open window | 2 | T-3, T-6 |
| FR-3 | Order and overlap at minute level | 3 | T-4, T-6 |
| FR-4 | Hours that DST makes ambiguous | 2 | T-1, T-3, T-4 |
| FR-5 | Creating a timeline cannot start in the past | 1 | T-4, T-6 |
| FR-6 | Edit locks by moment | 2 | T-4 |
| FR-7 | Step state, status and hold from now | 2 | T-3, T-6 |
| FR-8 | Field-configuration versions use the opening moment | 2 | T-3, T-6 |
| FR-9 | Day-only compatibility | 3 | T-3, T-4, T-5, T-6 |
| FR-10 | One time zone, stated in the response | 1 | T-5, T-6 |
| FR-11 | Stored steps keep their behavior | 1 | T-3, T-8 |
| FR-12 | Audit records name moments | 1 | T-5 |
| FR-13 | Cycle span stays in days | 1 | T-3 |
| FR-14 | Front contract | 1 | T-7 |
| NFR-1…NFR-4 | See § 7 | — | T-1, T-3, T-6, T-8 |
