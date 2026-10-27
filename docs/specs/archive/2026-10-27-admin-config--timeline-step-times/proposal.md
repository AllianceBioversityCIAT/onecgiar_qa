# Timeline step times — Proposal

## Document Control

| | |
|---|---|
| Spec path | `docs/specs/admin-config/timeline-step-times` |
| Slug | `timeline-step-times`, derived from the free-text argument and the branch name the back lead chose (`feat/timeline-step-times`) |
| Type | Change |
| Approval Mode | gated |
| Status | Accepted for specification (the back lead ran `/akili-specify`, 2026-10-27). Q-1…Q-7 taken at their proposed defaults (`requirements.md` S-1…S-7) |
| Branch | `feat/timeline-step-times` (from `origin/staging-center` @ `8ac4df7`) |
| Source | Jira **P2-4019** (story, reporter: front lead; AC 1–7), backend sub-task **P2-4020**, front sub-task **P2-4021**; epic P2-3902. Decisions by the back lead in this session (2026-10-27) |
| Builds on | `docs/specs/archive/2026-10-21-admin-config--cycle-timelines/` (D-1, S-1, S-4), `docs/specs/admin-config/timeline-edit/` (state rules, `LOCKED`, audit), `docs/specs/archive/2026-10-27-admin-config--field-configuration/` (S-3, S-5) |
| Depends on | `admin-config/timeline-edit` and `admin-config/field-configuration`, both merged in `staging-center` |
| Unblocks | P2-4021 (date and time picker in the create and edit drawers) |
| Parallel-safe | no. It adds migration `0006`, changes the shared timeline rules, the status logic and the field-config version rule |
| Scope | Server (`server/`), plus `front-contract.md` for P2-4021. Same split as the previous admin-config specs |
| Date | 2026-10-27 |

## Intent

Let the QA Admin choose the **hour and minute** at which each timeline step opens and closes, not only the day. Every rule that depends on a step's dates then works on that exact moment: status, the load hold, edit locks, and which field-configuration version a timeline uses. All times stay in **Europe/Rome** (one zone for the whole platform), and the zone is defined once on the server.

## Problem / Current Behavior

1. **Steps store days only.** `opens_on` and `closes_on` are MySQL `DATE`, read as `YYYY-MM-DD` Rome strings (`server/src/database/drizzle/schema/timeline-steps.ts:44-47`). The `chk_timeline_steps_dates` check allows the same day (`closes_on >= opens_on`, same file).
2. **A step is open for whole days.** It is open from 00:00 of `opens on` to 23:59:59 of `closes on`, and the next step must open on a later day (`docs/specs/archive/2026-10-21-admin-config--cycle-timelines/requirements.md:22`, S-1). The order and overlap check compares days: `opensOn <= previousClose` is refused (`server/src/admin-config/timelines/timeline-rules.ts:196-215`).
3. **Every rule receives "today", never "now".**
   - Validation takes `today: string` (`timeline-rules.ts:44-45`). Step 1 cannot open before today (`timeline-rules.ts:104-106`, S-4). Edits of started or closed steps are `LOCKED` or `BEFORE_TODAY` by day (`timeline-rules.ts:529-561`).
   - Status, step state and the `waiting_for_load` hold compare against `today` (`server/src/admin-config/timelines/timeline-view.ts:22-23`, `:66-105`).
4. **The time zone is hardcoded twice.** `'Europe/Rome'` is a literal in `server/src/admin-config/rome-date.ts:7` (`todayInRome`, `:16-21`) and again in the front, `client/src/app/core/domain/rome-date.ts:66`. The process `TZ` has no effect (`rome-date.ts:1-4`).
5. **Field configuration assumes midnight.** A timeline "has started" at 00:00 Rome on step 1's `opens_on`. A version published that day after 00:00 does not reach it (`server/src/admin-config/field-config/field-config-versions.ts:50-102`; field-configuration `requirements.md` S-3, S-5).
6. **The API speaks in days.**
   - DTOs: `opensOn` and `closesOn` (`server/src/admin-config/timelines/dto/create-timeline.dto.ts:55,66`).
   - Response: `timeline-response.ts:25-26,99-100`.
   - OpenAPI model: `models/timeline.model.ts:56,64`.
   - Audit diff keys: `steps.<n>.opensOn|closesOn` (`timeline-diff.ts:76-77`).
   - Cycle span: `min(opensOn)` and `max(closesOn)` (`server/src/admin-config/cycles/cycles.store.ts:128-129`).
7. **The front fixes the hours in its labels.** It prints `Opens <day>, 00:00 CEST (Rome)` and `Closes <day>, 23:59 … (Rome)` (`client/src/app/core/domain/rome-date.ts:55-62`).
   - The drawers use a day-only `qa-date-picker` (`client/src/app/pages/workspace/cycle/step-drawer.ts:112,120`).
   - The mapper sends days through `toApiDay` (`client/src/app/pages/workspace/cycle/cycle.mapper.ts:60,132-133,170-171`).
   - "Reset to official timeline" shifts whole days (`client/src/app/pages/workspace/cycle/cycle.logic.ts:172-182`).
8. **The latest migration is `0005_field_configuration`**, so the next one is `0006` (`server/drizzle/meta/_journal.json`).

## Proposed Outcome

- Each step has **`opensAt` and `closesAt`**, written `YYYY-MM-DDTHH:mm` as **Rome wall-clock time**, with minute precision.
- **A step is open from `opensAt` until the end of the `closesAt` minute** (proposed answer to Q-2). A step closing at `17:00` is open until 17:00:59, so `00:00`→`23:59` behaves exactly like today's S-1.
- **Order uses moments, not days.** A step must close after it opens, and the next step must open after the previous one closes. Two steps **may share a day** (Q-1).
- **Rules work on "now in Rome", not "today in Rome":**
  - status and step state;
  - the `waiting_for_load` hold;
  - `BEFORE_TODAY` and `LOCKED` on create and edit;
  - the field-configuration "timeline started" moment.
- **One time-zone constant** on the server, exposed by the API. The front stops hardcoding `'Europe/Rome'`.
- **API additive:**
  - **Read:** responses carry `opensAt` and `closesAt`. `opensOn` and `closesOn` stay, derived from them, until the front has moved.
  - **Write:** create and edit accept `opensAt`/`closesAt`. Day-only `opensOn`/`closesOn` remain accepted and mean 00:00 / 23:59. Sending both forms for the same step is a 400.
- **Migration `0006`:** existing rows become 00:00 to 23:59, so no timeline changes behavior (AC 6).

## Scope

- Migration `0006` and the `timeline_steps` schema: the columns become `DATETIME`, the check becomes strict, and the existing rows are backfilled.
- A Rome clock module that adds `nowInRome` and moment helpers next to `todayInRome`, plus the single zone constant.
- Timeline rules for create and edit (order, overlap, `BEFORE_TODAY`, `LOCKED`), status and step state, and the load hold.
- Field-configuration "started" and "finished" moments (`field-config-versions.ts`).
- DTOs, response, OpenAPI models, audit diff keys, the cycle span, and the error catalog if a new code is added.
- Unit, integration and e2e tests. The e2e clock override changes from pinning "today in Rome" to pinning "now".
- `front-contract.md` for P2-4021: the new fields, the zone, the picker needs, and that Reset to official must keep the times (AC 7).

## Non-Goals

- A configurable or per-cycle time zone (back lead, 2026-10-27).
- Storing UTC instants.
- Second-level precision.
- Changing the steps flow or the load rules themselves (P2-4019 *Out of scope*).
- Building the front picker and labels. That is P2-4021, owned by the front lead and described through `front-contract.md`.
- Removing `opensOn` and `closesOn` from the API. That is a later clean-up once P2-4021 has shipped.
- Changing the cycle span from days to moments (`startsOn`/`endsOn` stay as dates).

## Affected Users, Systems, And Specs

| Who / what | Effect |
|---|---|
| QA Admin | Picks hour and minute; sees them on cards, drawers and status labels |
| Assessors, Programs, Lead Assessors, TPB, PPU | Their step opens and closes at the exact moment |
| `server/src/admin-config/timelines/**` | Rules, view, DTOs, response, diff, store |
| `server/src/admin-config/field-config/field-config-versions.ts` | "Started" becomes a moment |
| `server/src/admin-config/cycles/cycles.store.ts` | Span derived from the date part |
| `client/` (P2-4021) | Picker, mapper, labels, Reset to official, zone from the API |
| Spec `cycle-timelines` (archived) | S-1 and S-4 are superseded |
| Spec `timeline-edit` | Step-state and lock rules move to moments |
| Spec `field-configuration` (archived) | S-3 and S-5 are superseded |

## Visual Reference

- Source: None
- Location: n/a
- Notes: server-only spec. The picker design belongs to P2-4021. It reuses the shared `qa-date-picker` (`client/src/app/ui`), which today picks days only.

## Requirement Delta Preview

### ADDED Requirements

- Each step carries an opening and a closing moment (`YYYY-MM-DDTHH:mm`, Rome). The API returns both for every step (AC 1, AC 2).
- The API states the platform time zone in a single place (AC 5).
- Times that do not exist in Rome on the spring DST change are refused (Q-3).

### MODIFIED Requirements

- **S-1:**
  - **Today:** a step is open on whole days, and steps never share a day.
  - **New:** a step is open from `opensAt` to the end of the `closesAt` minute. The next step opens after the previous one closes, and the same day is allowed (AC 3, AC 4).
- **FR-8 "same day is valid"** becomes "`closesAt` must be after `opensAt`". Same moment is refused (AC 4).
- **S-4 and the `timeline-edit` locks** (`BEFORE_TODAY`, `LOCKED`, in-progress or closed state) are decided against **now** in Rome, not today.
- **Status, step state and `waiting_for_load`** are derived from now in Rome (AC 3).
- **Field-configuration S-3 and S-5:**
  - A timeline starts at step 1's `opensAt`, not at 00:00 of its day.
  - A version published before that moment reaches the timeline, even on the same day.
- **Rows saved before this change** read as 00:00 / 23:59 (AC 6).

### REMOVED Requirements

- "Two steps never share a day" (part of S-1).

## Approach Options

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. Rome wall-clock `DATETIME`** (recommended) | Columns `opens_at` and `closes_at` are `DATETIME` in Drizzle string mode, holding Rome local time. Comparisons stay on strings, against `nowInRome` | Same model as today (strings, no zone conversion in the database). Lexical order is time order. Small migration | DST edges need an explicit rule (Q-3). Changing the zone later would need a data migration (accepted, non-goal) |
| B. UTC `TIMESTAMP` | Store instants; convert to Rome only at the API edge | Robust to a future configurable zone | Rejected by the back lead (2026-10-27). Every rule and test moves from strings to instants, so the change is much larger |
| C. Keep `DATE`, add `opens_time` / `closes_time` | Two extra `TIME` columns | Old columns untouched | Every comparison combines two columns. The check and the ordering logic get harder. Two sources for one fact |

## Recommended Approach

**Option A.** It keeps the existing "Rome strings, never a local `Date`" design (`rome-date.ts:1-4`), so the change is mostly a widening:

- `YYYY-MM-DD` becomes `YYYY-MM-DDTHH:mm`;
- `todayInRome` gains `nowInRome`;
- `compareDates` keeps working on the longer strings.

The steps:

1. Migration `0006`:
   - Rename `opens_on` to `opens_at` and `closes_on` to `closes_at`, and change both to `DATETIME`.
   - Backfill: opens keep 00:00, closes become 23:59.
   - The check becomes `closes_at > opens_at`.
2. Server code reads and writes `YYYY-MM-DDTHH:mm`. `opensOn` and `closesOn` survive only as derived and compatibility fields at the API edge.
3. The zone constant moves to one module and is returned in the timeline response (shape decided at specify, Q-5).

Effort estimate: 3 to 5 days on the server, including migration and tests. 1 to 2 days on the front for P2-4021.

## Risks, Dependencies, And Open Questions

### Open questions (each with a proposed default)

| # | Question | Proposed default | Decides |
|---|---|---|---|
| Q-1 | Can two steps share a day (step 1 closes 12:00, step 2 opens 14:00)? | **Yes.** The next step must open strictly after the previous `closesAt` minute | Order rule |
| Q-2 | Is the closing minute included? | **Yes.** Open until `closesAt:59`, so `23:59` means the end of the day, as today. Supersedes the half-open idea raised earlier in the session | Status, locks |
| Q-3 | DST: 02:00–02:59 does not exist on the last Sunday of March, and repeats on the last Sunday of October | Refuse times in **02:00–02:59 on both change days** with one field error | Validation |
| Q-4 | Does S-4 become "step 1 cannot open before now"? Keep the code `BEFORE_TODAY` or add `BEFORE_NOW`? | Moment-based; **keep `BEFORE_TODAY`** so the front's error mapping does not change | Error catalog |
| Q-5 | Where does the API expose the zone? | A `timeZone: "Europe/Rome"` field on each timeline response | Contract |
| Q-6 | Default times the drawer suggests for a new step | 00:00 open and 23:59 close, the same as migrated rows. To be confirmed with the BA | Front-contract |
| Q-7 | Rename the database columns (`*_on` → `*_at`)? | **Yes.** The name should say what it holds; the migration is reversible | Migration |

### Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | The rules for `field-configuration`, which was archived today, change | List S-3 and S-5 as superseded in this spec's requirements, and re-run its version tests |
| R-2 | The front breaks if it reads `opensAt` before P2-4021 | The API change is additive; `opensOn` and `closesOn` stay |
| R-3 | Audit history mixes `steps.n.opensOn` keys (old rows) with `opensAt` keys (new rows) | Document it in `front-contract.md`; old rows are not rewritten |
| R-4 | Many tests pin "today in Rome" through the clock override | Change the seam to a full instant; update the tests in one task |
| R-5 | Repeated autumn hour: `nowInRome` steps back for an hour, so a status could briefly flip | Q-3 refuses times in that hour, so no boundary falls inside it |

## Success Criteria

- A QA Admin can save a step that opens `2026-11-10T14:00` and closes `2026-11-12T17:30`. The API returns exactly those values, plus `timeZone`.
- With "now" pinned to `2026-11-10T13:59` Rome the step is upcoming; at `14:00` it is in progress; at `2026-11-12T17:31` it is closed.
- Same moment or a reversed range gives a 400. Overlapping steps give a 400. Two steps on the same day with no overlap are accepted.
- Every pre-existing timeline reads 00:00 / 23:59 and keeps its status, locks and field-configuration version after migration `0006`.
- A field-configuration version published at 09:00 on step 1's day reaches a timeline that opens at 14:00 that day, and does not reach one that opened at 08:00.
- `'Europe/Rome'` appears once in `server/src` as code (comments excluded, NFR-2). *Note at archive: a doc comment in `rome-date.ts` also holds the literal.*

## Next Step

```text
/akili-specify admin-config/timeline-step-times
```
