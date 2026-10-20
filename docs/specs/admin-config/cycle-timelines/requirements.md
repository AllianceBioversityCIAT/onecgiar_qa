# Cycles and QA timelines — Requirements

## 1. Document Control

| | |
|---|---|
| Spec path | `docs/specs/admin-config/cycle-timelines` |
| Type | Change |
| Depth | Full (new module, API contract, new persisted data, migration, concurrency) |
| Approval Mode | gated |
| Status | Approved (back lead, 2026-10-20) |
| Source | `proposal.md` (approved 2026-10-20, decisions D-1…D-7); Jira P2-3903, sub-task P2-3933 |
| Builds on | `docs/specs/archive/2026-10-19-auth--user-management--core/` (cited as *core*); `docs/specs/changes/users-admin-write-safety/` (idempotency, cited as *write-safety*) |
| PRD stories | US-1 (create a cycle), US-3 (who sees what — timeline part) |
| Scope | Server only (`server/`) |
| Last updated | 2026-10-20 |

**Decisions taken at specify (Leader defaults; the back lead may overrule at this gate):**

| # | Decision | Why |
|---|---|---|
| S-1 | A step is open **from 00:00 of `opens on` to 23:59:59 of `closes on`**, both in `Europe/Rome` (D-1). The next step must open **after** the previous step's closing day — two steps never share a day. Gaps between steps are allowed | "Must not overlap" (AC 8) with whole-day dates leaves no other unambiguous reading |
| S-2 | Every step carries an **audience** from the fixed set of five (Assessors, Science Programs in Reporting, Lead Assessors, TPB, PPU). Audiences are unique in a timeline and keep the workflow order. Removing a step keeps the others' audiences | Lets an additional timeline cover only steps 1–2 (AC 7) without step 4 silently becoming "Lead Assessors" |
| S-3 | Default loads: the Assessors step and the Lead Assessors step require a load (the step-1 and step-3 loads of P2-3905 / P2-3906) | Matches the two load stories |
| S-4 | A new timeline's first step **cannot open before today** (Rome) | Prevents back-dated timelines that would start already live with nothing prepared (AC 16–17) |
| S-5 | Activating a cycle **closes** the previously active one in the same operation; a closed cycle takes no new timelines and is not reopened in this spec | One active cycle (proposal), read-only closed cycles (front "View all cycles") |
| S-6 | The proposal's `is_test` flag is **dropped** | P2-3903 does not ask for it; "prepare and test" (AC 17) is assigning users and loading results before step 1. "Clear test results" needs loads — later story |
| S-7 | Users assigned to a timeline must be active and hold the role they are assigned with; removal keeps the history row | AC 14; traceability story P2-3915 |

## 2. Executive Summary

Today the QA coordinator sends step dates to the tech team, and the Cycle screen runs on mock data. This spec gives the **ADMIN** a real API to create a **cycle** (just its year), then create the cycle's **timelines**: the first is official, the rest additional. Each timeline has 1–5 dated steps, rounds, which steps load results, and a scope of Science Programs and result types. The ADMIN assigns the users who work on each timeline. What step is open, and what a timeline still lacks before it can run, are computed from dates and data: no one opens or closes a step by hand. PRD problem P2.

## 3. Glossary

| Term | Meaning |
|---|---|
| Cycle | One reporting year (e.g. 2026). Holds timelines. Status `draft`, `active` or `closed`; at most one `active` |
| Timeline | A dated sequence of 1–5 steps for a chosen set of SPs and result types. The team also calls it a **batch** |
| Official timeline | The first timeline created in a cycle. Exactly one per cycle |
| Additional timeline | Any timeline created after the official one |
| Step | One dated stage of a timeline, with a name, an audience, an opening and a closing date, a round, and whether it requires a load |
| Audience | Who works in a step: Assessors, Science Programs (in Reporting — D-3), Lead Assessors, Third-Party Brokers, PPU |
| Round | A numbered group of consecutive steps (Round 1, Round 2…) |
| Load | Bringing submitted results from Reporting into a step (P2-3905 / P2-3906, not this spec) |
| Scope | The SPs and result types a timeline accepts loads for; "all" is an explicit choice (D-7). "Indicators" = result types |
| Readiness | The list of what a timeline still lacks before it can run (AC 16) |
| Rome date | A calendar date in the IANA zone `Europe/Rome` (CET / CEST) — D-1 |

## 4. System Context & Scope

**In scope:** cycles (create, list, activate); timelines (default steps, create, list per cycle, detail); timeline user assignment (add, remove, list); the computed status, current step and readiness; admin-only access; idempotent creates; OpenAPI; migration; module guides; TRD § 4 / § 5.1 / § 6 updated to this model (deliverable named by `tasks.md`, proposal R-1).

**Out of scope:** loads and the rules that act on them (D-2, D-6 — P2-3905 / P2-3906); editing a timeline's steps or dates (P2-3904); the visibility predicate on results and the timeline filter for non-admin users (AC 15, AC 19 — worklist P2-3909); pausing, closing early, extended access, manual advance or hold; email alerts; reopening a closed cycle; any front change (P2-3934).

**Current behavior:**

| # | Today | Evidence |
|---|---|---|
| C1 | The server has no cycle or timeline code | `git grep -n -iE "cycles\|timeline" -- server/src` → only `server/src/users/authorization.service.ts:42,82` (D9 seam comments) and `server/src/users/AGENTS.md:33` (`feat/cycle-timelines` @ `443a618`) |
| C2 | The front Cycle screen reads timelines, steps and cycles from a mock and stops saves at `TODO(api)` | `client/src/app/pages/workspace/cycle/cycle.mock.ts`; `client/src/app/pages/workspace/cycle/timeline-drawer.ts:300-316` |
| C3 | The TRD models `cycles → windows → batches`, with no timeline scope | `docs/trd/trd.md:174-176` |
| C4 | `canReview` accepts extra predicates reserved for a timeline rule | `server/src/users/authorization.service.ts:42-48,78-83` |
| C5 | Science Programs (CLARISA id) and result types (Reporting key) are served by `CatalogService`, exported by `UsersModule` | `server/src/users/catalogs/catalogs.ports.ts:2-13`; `server/src/users/users.module.ts:108-114` |
| C6 | An opt-in idempotency mechanism exists for admin writes | `server/src/common/idempotency/idempotent.decorator.ts:13`; *write-safety* FR-1…FR-6 |

## 5. Stakeholders / Personas

| Role (PRD § 3) | Scope | What they need from this spec |
|---|---|---|
| ADMIN (QA Admin — D-4) | Global | Create cycles and timelines, assign users, see what is open and what is missing — without the tech team |
| ASSESSOR, LEAD_ASSESSOR, TPB, PPU | Per role scope | To be assigned to the timelines they work on (the effect on their results arrives with P2-3909) |
| PROGRAM (SP users) | Per program | Nothing directly: they work in step 2 through Reporting (D-3) and are never assigned here |
| Front lead | — | A stable contract for the Cycle screen (P2-3934) and the rules the server now owns |

## 6. Functional Requirements

### FR-1: Create a cycle

An ADMIN SHALL be able to create a cycle by giving its year. The cycle starts as `draft`.

#### Scenario: New cycle
- GIVEN no cycle exists for 2027
- WHEN an ADMIN creates a cycle with year 2027
- THEN the cycle exists with status `draft` and the display name "2027 cycle"
- AND it records who created it and when
- BUT it must NOT become active by being created

#### Scenario: Duplicate year
- GIVEN a cycle for 2026 exists
- WHEN an ADMIN creates another cycle for 2026
- THEN the request is refused with 409 and nothing is written
- AND IT MUST hold when the two creates arrive at the same time

#### Scenario: Invalid year
- WHEN the year is missing, not an integer, or outside 2020–2100
- THEN the request is refused with 400 naming the `year` field

### FR-2: List cycles

An ADMIN SHALL be able to list all cycles, newest year first, each with its year, display name, status, number of timelines and the date range its timelines cover (empty when it has none).

### FR-3: Activate a cycle

An ADMIN SHALL be able to make a `draft` cycle the active one. The previously active cycle, if any, SHALL become `closed` in the same operation (S-5).

#### Scenario: Switch the active cycle
- GIVEN 2026 is `active` and 2027 is `draft`
- WHEN an ADMIN activates 2027
- THEN 2027 is `active` and 2026 is `closed`
- AND IT MUST never leave two active cycles, or none, visible to a reader, even with two activations at once

#### Scenario: Not a draft
- WHEN an ADMIN activates a cycle that is `active` or `closed`
- THEN the request is refused with 409 and nothing changes

### FR-4: Default steps

The system SHALL provide the default steps of a new timeline, so every client proposes the same ones (AC 6, AC 10, S-2, S-3):

| Position | Default name | Audience | Round | Requires load |
|---|---|---|---|---|
| 1 | QA Platform open for assessors | Assessors | 1 | yes |
| 2 | QA open for Science Programs | Science Programs (in Reporting) | 1 | no |
| 3 | QA open for Lead Assessors | Lead Assessors | 2 | yes |
| 4 | Third-Party Broker review | Third-Party Brokers | 2 | no |
| 5 | PPU review | PPU | 2 | no |

### FR-5: Create a timeline — official or additional

An ADMIN SHALL be able to create a timeline inside a `draft` or `active` cycle. The server SHALL make it the **official** timeline when the cycle has none, and **additional** otherwise; the client never chooses (AC 2, 3, 5).

#### Scenario: First timeline
- GIVEN the 2026 cycle has no timeline
- WHEN an ADMIN creates a valid timeline in it
- THEN the timeline is created as official
- AND the answer returns it as FR-12 describes

#### Scenario: Later timeline
- GIVEN the 2026 cycle has an official timeline
- WHEN an ADMIN creates another valid timeline
- THEN it is created as additional

#### Scenario: Two first timelines at once
- GIVEN the cycle has no timeline
- WHEN two ADMINs create a timeline in it at the same moment
- THEN exactly one is official
- AND IT MUST hold on any number of API instances — the other is additional or refused with 409, never a second official

#### Scenario: Closed or unknown cycle
- WHEN the cycle is `closed`
- THEN the request is refused with 409 and nothing is written
- WHEN the cycle does not exist
- THEN the request is refused with 404

#### Scenario: Kind sent by the client
- WHEN the request body says which kind the timeline is
- THEN the request is refused with 400 (unknown field)

### FR-6: Timeline name and scope

A timeline SHALL have a name and a scope of Science Programs and result types, for official and additional timelines alike (AC 4, D-7).

- The name is required, at most 120 characters after trimming, and unique within the cycle regardless of letter case.
- Programs: "all", or one or more CLARISA Science Program ids from the catalog. Result types: "all", or one or more result type keys from the catalog.

#### Scenario: Explicit scope
- WHEN an ADMIN creates a timeline for SP02 and SP05 and for "Innovation development"
- THEN the timeline's scope is exactly those programs and that result type

#### Scenario: All
- WHEN an ADMIN chooses "all" programs and "all" result types
- THEN the timeline accepts every program and every result type, including ones added to the catalog later

#### Scenario: Missing or unknown scope
- WHEN programs or result types are missing, an empty list, or contain an id or key the catalog does not have
- THEN the request is refused with 400 naming the field
- BUT an empty list must NOT be read as "all"

#### Scenario: Catalog unreachable
- WHEN a catalog needed to check the scope cannot be read
- THEN the request is refused with 503 and nothing is written

#### Scenario: Duplicate name
- GIVEN the cycle has a timeline named "July 2026"
- WHEN an ADMIN creates "july 2026" in the same cycle
- THEN the request is refused with 409
- BUT the same name in another cycle is allowed

### FR-7: Steps

A timeline SHALL have between 1 and 5 steps. Each step has a name (required, at most 120 characters after trimming) and an audience (AC 6, 7, S-2).

#### Scenario: Renamed and removed steps
- WHEN an ADMIN creates a timeline with only the Assessors and Science Programs steps, the first renamed "Assessment window"
- THEN the timeline has those two steps, in that order, with those names and audiences

#### Scenario: Too many or too few
- WHEN the request has 0 steps or more than 5
- THEN it is refused with 400 naming `steps`

#### Scenario: Audience rules
- WHEN two steps share an audience, or the audiences are out of workflow order (Assessors → Science Programs → Lead Assessors → TPB → PPU), or an audience is not one of the five
- THEN the request is refused with 400 naming the offending step

### FR-8: Step dates

Every step SHALL have an opening and a closing Rome date, chosen by the client from a date picker (AC 8, S-1, S-4, D-1).

#### Scenario: Valid dates
- GIVEN today in Rome is 20 Oct 2026
- WHEN step 1 runs 2–6 Nov and step 2 runs 9–13 Nov
- THEN the dates are stored as given

#### Scenario: Close before open
- WHEN a step closes before it opens
- THEN the request is refused with 400 naming that step's closing date
- BUT a step that opens and closes on the same day is valid

#### Scenario: Overlap or out of order
- WHEN a step opens on or before the closing day of the step before it
- THEN the request is refused with 400 naming that step's opening date

#### Scenario: Missing or malformed date
- WHEN any step lacks a date, or a date is not a real calendar date in `YYYY-MM-DD`
- THEN the request is refused with 400 naming that date
- BUT the step must NOT be dropped silently (front behavior C2 / `timeline-drawer.ts:313`)

#### Scenario: Back-dated start
- GIVEN today in Rome is 20 Oct 2026
- WHEN step 1 opens on 19 Oct 2026
- THEN the request is refused with 400 naming step 1's opening date
- AND IT MUST use the Rome date, not the server's or the client's

### FR-9: Steps that require a load

Each step SHALL say whether it requires a load. The first step SHALL always require one (AC 4, AC 9).

#### Scenario: First step without a load
- WHEN the first step says it does not require a load
- THEN the request is refused with 400 naming that field
- BUT the server must NOT silently switch it on

### FR-10: Rounds

Each step SHALL belong to a round. Rounds start at 1 on the first step, and each later step is in the same round as the step before it or the next one (AC 10).

#### Scenario: Regrouped rounds
- WHEN an ADMIN puts steps 1–3 in Round 1 and steps 4–5 in Round 2
- THEN the timeline stores that grouping

#### Scenario: Invalid rounds
- WHEN the first step is not in Round 1, a round number decreases, or a round is skipped (1, 1, 3)
- THEN the request is refused with 400 naming the offending step's round

### FR-11: All errors at once, nothing written

When a create request is invalid, the system SHALL refuse it with 400 and list **every** offending field with its path and a user-facing code, so the ADMIN learns everything missing in one round (AC 11). Nothing SHALL be written.

#### Scenario: Several problems
- WHEN the name is empty, programs are missing and step 3 has no closing date
- THEN one 400 lists `name`, `programs` and `steps[2].closesOn`
- BUT it must NOT stop at the first problem
- AND IT MUST use only codes from the error catalog — no free text, no database text (TRD § 6)

### FR-12: Timelines of a cycle and timeline detail

An ADMIN SHALL be able to list a cycle's timelines and read one timeline. Each timeline shows its name, kind, scope, steps (name, audience, dates, round, requires load), status, current step and readiness (AC 12, 13, 18).

- **Status**, from today's Rome date: `scheduled` before the first step opens, `live` from then until the last step closes, `finished` after.
- **Current step**: the step open today, or none (between steps, before the first, after the last), plus the next step to open when there is one.
- The list puts the official timeline first, then additional ones newest first.

#### Scenario: Two timelines live at once
- GIVEN the official timeline is in step 4 and an additional one is in step 1 on the same day
- WHEN an ADMIN lists the cycle's timelines
- THEN both are `live`, each with its own current step

#### Scenario: Steps open and close by date
- GIVEN step 1 closes on 6 Nov and step 2 opens on 9 Nov
- WHEN the list is read at 23:59 Rome on 6 Nov, then at 00:00 Rome on 7 Nov, then at 00:00 Rome on 9 Nov
- THEN the current step is step 1, then none (next: step 2), then step 2
- BUT no stored state may change for this to happen — nothing opens or closes a step by hand or by a job

#### Scenario: Daylight-saving change
- GIVEN a step closes on 25 Oct 2026 (the night Rome leaves summer time)
- WHEN the list is read at 23:30 Rome on 25 Oct
- THEN that step is still open

#### Scenario: Unknown cycle or timeline
- THEN the request is refused with 404

### FR-13: Readiness

Each timeline SHALL report what it still lacks to run (AC 16). In this spec the items are:

| Item | Present when |
|---|---|
| `NO_RESULTS_LOADED` | Always, until the load stories exist (no load can have happened) |
| `NO_<ROLE>_ASSIGNED` | A step's audience is an assignable role (Assessors, Lead Assessors, TPB, PPU) and no active user with that role is assigned |

#### Scenario: Missing assessor
- GIVEN a timeline with steps for Assessors and Science Programs and nobody assigned
- WHEN an ADMIN reads it
- THEN readiness lists `NO_RESULTS_LOADED` and `NO_ASSESSOR_ASSIGNED`
- BUT it must NOT list a Science Programs item — they are never assigned here (D-3)

#### Scenario: Not blocking
- WHEN a timeline has readiness items
- THEN it is still created, listed and dated as usual — readiness informs, it does not block

### FR-14: Assign users to a timeline

An ADMIN SHALL be able to assign users to a timeline as Assessor, Lead Assessor, TPB or PPU, at any time — before or after its steps open, in any cycle that is not `closed` (AC 14, AC 17, S-7).

#### Scenario: Assign
- GIVEN Ana is active and holds an ASSESSOR grant
- WHEN an ADMIN assigns Ana to the timeline as Assessor
- THEN Ana appears in the timeline's users with that role
- AND who assigned her and when are recorded

#### Scenario: Not eligible
- WHEN the user does not exist, is inactive, or does not hold an active grant of that role
- THEN the request is refused (404 for an unknown user, 409 otherwise) and nothing is written
- BUT a role outside the four (ADMIN, PROGRAM, …) must NOT be assignable — 400

#### Scenario: Already assigned
- WHEN Ana is already assigned to the timeline as Assessor
- THEN the request changes nothing and answers as the first assignment did
- BUT it must NOT create a second active row, even with two requests at once

#### Scenario: Several roles
- WHEN Ana also holds LEAD_ASSESSOR and is assigned as Lead Assessor too
- THEN she appears once per role

### FR-15: Remove users from a timeline

An ADMIN SHALL be able to remove a user's assignment from a timeline at any time. The assignment SHALL stop counting at once, and its history SHALL be kept (S-7).

#### Scenario: Remove
- WHEN an ADMIN removes Ana's Assessor assignment
- THEN Ana no longer appears among the timeline's active users and readiness is recomputed
- AND who removed her and when are recorded
- BUT the row must NOT be deleted

#### Scenario: Re-assign after removal
- WHEN Ana is assigned again as Assessor
- THEN she is active again — the removed row does not block it

### FR-16: Admin only

Every route of this spec SHALL require the ADMIN permission (D-4).

#### Scenario: Non-admin
- WHEN an authenticated ASSESSOR (or any non-admin) calls any route of this spec
- THEN the answer is 403 and nothing is read or written
- WHEN no or an invalid token is sent
- THEN the answer is 401

### FR-17: Safe retries on creates

Creating a cycle and creating a timeline SHALL accept an optional `Idempotency-Key` with the same guarantees as the users admin writes (*write-safety* FR-1…FR-6): a replay with the same key returns the first answer and creates nothing.

#### Scenario: Replayed timeline create
- GIVEN a timeline create completed with 201 under key K
- WHEN the same request is sent again with K
- THEN the same 201 and the same timeline are returned
- BUT no second timeline may exist, and the replay must NOT turn an official answer into an additional one

## 7. Non-Functional Requirements

| ID | Attribute | Scenario (source → stimulus → response) | Measure | TRD ref |
|---|---|---|---|---|
| NFR-1 | Security | Non-admin → any route of this spec → refused before any read | 100 % → 403, covered by e2e per route | QAS-SEC-2 |
| NFR-2 | Security | Any client → malformed or unknown body field → refused | 100 % of DTOs validated; unknown fields → 400 | QAS-SEC-3 |
| NFR-3 | Integrity | Two ADMINs → concurrent first-timeline creates, cycle activations, duplicate names or assignments → no invalid state | 0 cycles with two officials, 0 moments with two active cycles, 0 duplicate active assignments; enforced by the database, not only by a prior read | QAS-AVL-1 (no inconsistent state) |
| NFR-4 | Correctness | Clock → any instant, including the two daylight-saving changes → status and current step | Computed in `Europe/Rome` from one injectable clock; tested at midnight boundaries and both DST changes | new |
| NFR-5 | Performance | ADMIN → lists a cycle with up to 50 timelines and 200 assignments | A fixed number of database queries, independent of the number of timelines (no N+1) | QAS-PERF-1 (pattern) |
| NFR-6 | Modifiability | Load stories → add loads and results to a timeline | No breaking change to the tables of this spec; readiness gains items without changing existing ones | QAS-MOD-1 (pattern) |
| NFR-7 | Observability | ADMIN action → create, activate, assign, remove | Each logs one decision line with actor id, action and ids — no names, emails or bodies | QAS-OBS-1 (pattern) |

### Defect classes and their gates

| Defect class this spec can produce | Gate (command or check) | Substitute / accepted risk |
|---|---|---|
| Validation rule missing or wrong (dates, steps, rounds, scope) | Table-driven unit tests per rule — `pnpm test --reporter=dot` | — |
| Several errors collapsed into one, or free text leaking | Unit + e2e asserting the full `fields` list and catalog codes | — |
| Wrong official/active/duplicate outcome under concurrency | DDL assertions in `schema.spec.ts` (generated keys, unique indexes) + service tests over fakes that simulate the 1062 | **No disposable MySQL**: real concurrency is a HITL check on `qadb` after migration `0003` (back lead) |
| Date/time boundary error (midnight, DST, server zone ≠ Rome) | Unit tests with an injected clock; run once with `TZ=UTC` and once with `TZ=America/Bogota` | — |
| Route without the admin guard, or wrong status code | e2e 401/403 matrix per route — `pnpm test:e2e --reporter=dot` | — |
| OpenAPI out of step with the router | `test/openapi.e2e-spec.ts` | — |
| Type errors the test runner erases | `pnpm build` | — |
| Lint drift | `pnpm lint` (0 warnings) | — |
| Migration differs from the schema, or is not applied | `schema.spec.ts` pins the DDL; reviewer reads the generated SQL | Applying `0003` to `qadb` is a human step (proposal R-3) |
| TRD left describing windows/batches | Reviewer reads TRD § 4 / § 5.1 / § 6 against the migration | Human check at the spec's last review |

## 8. Requirement ID Index

| ID | Title | Scenarios | P2-3903 AC | Owning task(s) |
|---|---|---|---|---|
| FR-1 | Create a cycle | New cycle · Duplicate year · Invalid year | 2 (cycle exists) | T-1, T-5, T-10 |
| FR-2 | List cycles | — | 2 | T-5 |
| FR-3 | Activate a cycle | Switch · Not a draft | 2 | T-1, T-5, T-10 |
| FR-4 | Default steps | — | 6, 10 | T-2, T-6 |
| FR-5 | Create a timeline — official or additional | First · Later · Two at once · Closed/unknown cycle · Kind sent | 2, 3, 5 | T-1, T-6, T-10 |
| FR-6 | Timeline name and scope | Explicit · All · Missing/unknown · Catalog unreachable · Duplicate name | 4 | T-1, T-3, T-6 |
| FR-7 | Steps | Renamed/removed · Too many/few · Audience rules | 6, 7 | T-3 |
| FR-8 | Step dates | Valid · Close before open · Overlap · Missing · Back-dated | 8 | T-2, T-3 |
| FR-9 | Steps that require a load | First step without a load | 4, 9 | T-1, T-3 |
| FR-10 | Rounds | Regrouped · Invalid | 10 | T-3 |
| FR-11 | All errors at once | Several problems | 11 | T-2, T-3, T-6 |
| FR-12 | Timelines of a cycle and detail | Two live · Open/close by date · DST · Unknown | 12, 13, 18 | T-2, T-4, T-7 |
| FR-13 | Readiness | Missing assessor · Not blocking | 16 | T-4, T-7, T-8 |
| FR-14 | Assign users | Assign · Not eligible · Already assigned · Several roles | 14, 17 | T-1, T-8, T-10 |
| FR-15 | Remove users | Remove · Re-assign | 14 | T-1, T-8 |
| FR-16 | Admin only | Non-admin | 1 | T-5, T-6, T-7, T-8 |
| FR-17 | Safe retries on creates | Replayed timeline create | — | T-5, T-6 |
| NFR-1…7 | — | — | — | see tasks.md § Coverage |

**P2-3903 criteria not covered here:** AC 15 (results visible only to assigned users in scope) and AC 19 (timeline filter for every user) need results and a non-admin read → worklist P2-3909. AC 16's "results loaded" and AC 17's "load results" → P2-3905.
