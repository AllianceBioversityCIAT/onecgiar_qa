# Cycles and QA timelines — Front contract

For the front lead (P2-3934). The server side is built and documented in the OpenAPI document (`/api/v1/docs`); this note says what the screens can rely on, what the server owns, and what is not built yet. Source of truth for any disagreement: the controllers in `server/src/admin-config/` and the spec `design.md` § 6.

## 1. The one rule to show

**Every step date is a Central European calendar date (`Europe/Rome`, CET in winter, CEST in summer).** A date picker value is sent as `YYYY-MM-DD`, with no time and no zone, and means that day in Rome. The front must label it wherever it is picked or shown (D-1), for example:

> Opens 06 Jul 2026, 00:00 CET (Rome) · Closes 10 Jul 2026, 23:59 CET (Rome)

Use the label "CET" or "CEST" from the date (summer time applies roughly end of March to end of October), or write "Rome time". Never convert these dates to the viewer's local zone and never build a JavaScript `Date` from a bare `YYYY-MM-DD` (it parses as UTC and can shift a day). Keep them as strings. A step is open from 00:00 of `opensOn` to 23:59:59 of `closesOn`, both Rome time.

Instants (`createdAt`, `assignedAt`) are ISO 8601 UTC; show them in the viewer's zone.

## 2. Conventions

- Base path `/api/v1`. Every route is **ADMIN only**: a non-admin gets 403 `AUTH_PERMISSION_DENIED` on all of them, whatever the id.
- Envelope as everywhere: success `{ success: true, data, meta }`; error `{ success: false, error: { status, code, message, fields? }, meta }`. Branch on `error.code`; `message` is safe to show.
- Validation errors list `fields: [{ field, code, message }]`. `field` is the **request key**: `year`, `name`, `programIds`, `resultTypeKeys`, `steps` and `steps[i].<key>` (i from 0). Use it to mark the input.
- `POST /cycles` and `POST /cycles/:id/timelines` accept an optional `Idempotency-Key` header (1-128 characters of `A-Za-z0-9-_.:`). Send a fresh key per form submit and reuse it when retrying the same submit: a replay returns the first answer, marked by the response header `Idempotency-Replayed: true`, and creates nothing. Same key with a different body is 422 `IDEMPOTENCY_KEY_REUSED`; same key while the first call is still running is 409 `IDEMPOTENCY_IN_PROGRESS`.

## 3. Routes

| Method | Path | Body | Answer | Errors (besides 401/403) |
|---|---|---|---|---|
| POST | `/cycles` (key) | `{ year }` | 201 `Cycle`, status `draft` | 400 `VALIDATION_FAILED`; 409 `CYCLES_YEAR_TAKEN` |
| GET | `/cycles` | — | 200 `Cycle[]`, year descending | — |
| POST | `/cycles/:id/activate` | — | 200 `Cycle` | 404 `CYCLES_NOT_FOUND`; 409 `CYCLES_NOT_DRAFT` |
| GET | `/timeline-defaults` | — | 200 `DefaultStep[]` | — |
| POST | `/cycles/:id/timelines` (key) | `TimelineCreate` | 201 `Timeline` | 400 `VALIDATION_FAILED`; 404 `CYCLES_NOT_FOUND`; 409 `CYCLES_CLOSED`, `TIMELINES_NAME_TAKEN`; 503 `SERVICE_UNAVAILABLE` |
| GET | `/cycles/:id/timelines` | — | 200 `Timeline[]`, official first, then newest first | 404 `CYCLES_NOT_FOUND` |
| GET | `/timelines/:id` | — | 200 `TimelineDetail` | 404 `TIMELINES_NOT_FOUND` |
| POST | `/timelines/:id/users` | `{ userId, role }` | **201** `TimelineUser` (new) or **200** the same body shape (that user already holds that role in the timeline; nothing written) | 400 `VALIDATION_FAILED`; 404 `TIMELINES_NOT_FOUND`, `USERS_NOT_FOUND`; 409 `CYCLES_CLOSED`, `TIMELINES_USER_NOT_ELIGIBLE` |
| DELETE | `/timelines/:id/users/:assignmentId` | — | **204**, no body | 404 `TIMELINES_NOT_FOUND`, `TIMELINES_ASSIGNMENT_NOT_FOUND`; 409 `CYCLES_CLOSED` |

Treat 200 and 201 from the assign route as success; the 200 is not an error and needs no message. A malformed id in a path is 400 `VALIDATION_FAILED`.

Activating a cycle closes the previously active one in the same operation: show that consequence before confirming. A `closed` cycle takes no new timeline and no assignment change (409 `CYCLES_CLOSED`); reads still work.

## 4. Shapes

Dates are `YYYY-MM-DD` Rome days. All property names are camelCase.

| Shape | Fields |
|---|---|
| `Cycle` | `id`, `year`, `name` (e.g. "2027 cycle"), `status` (`draft` · `active` · `closed`), `timelineCount`, `startsOn` / `endsOn` (earliest opening and latest closing over its timelines' steps, or `null` without timelines), `createdAt` |
| `DefaultStep` | `position`, `name`, `audience`, `round`, `requiresLoad` |
| `TimelineCreate` | `name`; `allPrograms` + `programIds`; `allResultTypes` + `resultTypeKeys`; `steps[]` of `{ name, audience, opensOn, closesOn, round, requiresLoad }` |
| `Timeline` | `id`, `cycleId`, `name`, `kind` (`official` · `additional`), `allPrograms`, `programIds` (CLARISA ids; empty when all), `allResultTypes`, `resultTypeKeys` (empty when all), `steps[]` (as created plus `position`), `status` (`scheduled` · `live` · `finished`), `currentStep` (position or `null`), `nextStep` (position or `null`), `readiness[]` (codes, section 6), `assignedCount` (`{ ASSESSOR, LEAD_ASSESSOR, TPB, PPU }` numbers), `createdAt` |
| `TimelineDetail` | `Timeline` plus `users[]` of `TimelineUser` |
| `TimelineUser` | `assignmentId`, `userId`, `firstName` (may be `null`), `lastName` (may be `null`), `email`, `role` (`ASSESSOR` · `LEAD_ASSESSOR` · `TPB` · `PPU`), `assignedAt` (ISO UTC, **whole seconds**, no milliseconds) |
| Audiences | `assessors` · `programs` · `lead_assessors` · `tpb` · `ppu` |

Program names are not in the response: resolve `programIds` against `GET /catalogs/science-programs` and `resultTypeKeys` against `GET /catalogs/result-types`. `users[]` (names and emails) exists only on the detail and only for admins.

## 5. Rules the server owns

The front may pre-check these for comfort, but the server decides, and a request that breaks any of them is refused with every problem listed at once and nothing written (one 400, all `fields`).

| Rule | Detail |
|---|---|
| Cycle year | An integer from 2020 to 2100, one cycle per year; otherwise `year` `OUT_OF_RANGE` or 409 `CYCLES_YEAR_TAKEN` |
| Step count | 1 to 5 steps; otherwise `steps` `OUT_OF_RANGE`. Steps may be dropped, but never reordered |
| Audience | Each audience at most once, in workflow order: assessors, programs, lead_assessors, tpb, ppu (`AUDIENCE_ORDER`); an unknown value is `INVALID` |
| Step 1 loads | The first step must have `requiresLoad: true` (`FIRST_STEP_LOAD`) |
| Rounds | Round 1 on the first step, then the same as the previous step or one more (`ROUND_SEQUENCE`). Rounds are sent explicitly; the server never infers them |
| Dates | Both dates required (`REQUIRED`) and real calendar days (`INVALID`); `closesOn` on or after `opensOn` (`CLOSES_BEFORE_OPENS`); each `opensOn` strictly after the previous step's `closesOn`, so two steps never share a day (`OVERLAPS_PREVIOUS_STEP`); the first step cannot open before today in Rome (`BEFORE_TODAY`). Gaps between steps are allowed |
| Name | Required, at most 120 characters after trimming (`REQUIRED`, `TOO_LONG`); unique in the cycle ignoring letter case (409 `TIMELINES_NAME_TAKEN`). Step names follow the same text rule on `steps[i].name` |
| Scope is explicit | There is no "empty means all". `allPrograms: true` says every program, current and future, and then `programIds` must be empty or left out (a non-empty list is `INVALID`). `allPrograms: false` needs at least one id. Same for `allResultTypes` / `resultTypeKeys`. |
| Scope lists omitted | `programIds` and `resultTypeKeys` may be **omitted or empty**, and `null` is treated as absent. When the matching "all" flag is false, an omitted, `null` or empty list is reported `REQUIRED` on `programIds` / `resultTypeKeys`, in the same round as every other rule problem. Unknown ids are `INVALID` on that list |
| Catalogs | Catalogs are read only for explicit lists, so a create with both "all" flags works while CLARISA or Reporting is down. An explicit list while its catalog is unreachable is 503 `SERVICE_UNAVAILABLE` ("try again later") |
| Kind | `kind` is never sent (an unknown field is 400 `UNKNOWN_FIELD`). The first timeline of a cycle is `official`, every later one `additional`; two creates racing resolve to one of each, never a 409 |
| Shape errors first | Wrong types, a non-array list or an unknown key (`UNKNOWN_FIELD`, `INVALID_TYPE`, `REQUIRED` for missing booleans) are refused before the rules run, so such a request may need a second round once fixed |
| Assignment | Only `ASSESSOR`, `LEAD_ASSESSOR`, `TPB`, `PPU` can be assigned (another role is 400). The user must be active and hold a live grant of that role, else 409 `TIMELINES_USER_NOT_ELIGIBLE`. Allowed before or after a timeline's steps open, in any cycle that is not closed. Removing keeps the history; assigning again later creates a new assignment |
| Status | `scheduled`, `live`, `finished`, `currentStep`, `nextStep` and `readiness` are computed on every read from today in Rome. Nothing changes by itself: refetch to refresh |

Default steps (`GET /timeline-defaults`) are a proposal: pre-fill the form from them and let the admin rename, drop, re-date or regroup.

## 6. Error codes

### Error codes (`error.code`)

| Code | Status | Meaning for the screen |
|---|---|---|
| `CYCLES_NOT_FOUND` | 404 | The cycle does not exist |
| `CYCLES_YEAR_TAKEN` | 409 | A cycle for that year exists |
| `CYCLES_NOT_DRAFT` | 409 | Only a draft cycle can be activated |
| `CYCLES_CLOSED` | 409 | The cycle is closed: no new timeline, no assignment change |
| `TIMELINES_NOT_FOUND` | 404 | The timeline does not exist |
| `TIMELINES_NAME_TAKEN` | 409 | That name is used in this cycle |
| `TIMELINES_USER_NOT_ELIGIBLE` | 409 | The user is inactive or lacks a live grant of that role |
| `TIMELINES_ASSIGNMENT_NOT_FOUND` | 404 | No active assignment with that id (maybe already removed) |

Existing codes these routes also use: `VALIDATION_FAILED`, `MALFORMED_JSON`, `USERS_NOT_FOUND`, `SERVICE_UNAVAILABLE`, `AUTH_TOKEN_INVALID`, `AUTH_USER_NOT_ADMITTED`, `AUTH_PERMISSION_DENIED`, `IDEMPOTENCY_IN_PROGRESS`, `IDEMPOTENCY_KEY_REUSED`.

### Field codes (`fields[].code`)

Seven are new; the front's field-code union in `client/src/app/core/http/api-envelope.ts` (comment at line 29) must list them. This contract note is how that update is requested; the server spec does not edit `client/`.

| Code | Where | Meaning |
|---|---|---|
| `OUT_OF_RANGE` | `year`, `steps` | Year outside 2020-2100, or not 1 to 5 steps |
| `CLOSES_BEFORE_OPENS` | `steps[i].closesOn` | Closing day before the opening day |
| `OVERLAPS_PREVIOUS_STEP` | `steps[i].opensOn` | Opens on or before the previous step's closing day |
| `BEFORE_TODAY` | `steps[0].opensOn` | First step opens before today (Rome) |
| `AUDIENCE_ORDER` | `steps[i].audience` | Audience repeated or out of workflow order |
| `ROUND_SEQUENCE` | `steps[i].round` | Round does not start at 1 or jumps by more than one |
| `FIRST_STEP_LOAD` | `steps[0].requiresLoad` | First step must require a load |

Already existing codes the same routes use on fields: `REQUIRED`, `INVALID`, `INVALID_TYPE`, `TOO_LONG`, `UNKNOWN_FIELD`. Messages come from the catalog and can be shown as they are.

### Readiness codes (`Timeline.readiness[]`)

Informational: a timeline with readiness items is still created, listed and dated. Show them as "still missing", never as an error.

| Code | Present while |
|---|---|
| `NO_RESULTS_LOADED` | Always for now: loads are not built yet |
| `NO_ASSESSOR_ASSIGNED` | A step has audience `assessors` and no active user is assigned as ASSESSOR |
| `NO_LEAD_ASSESSOR_ASSIGNED` | A step has audience `lead_assessors` and nobody is assigned as LEAD_ASSESSOR |
| `NO_TPB_ASSIGNED` | A step has audience `tpb` and nobody is assigned as TPB |
| `NO_PPU_ASSIGNED` | A step has audience `ppu` and nobody is assigned as PPU |

There is no item for Science Programs: they are never assigned here. New items will be added later without changing these, so ignore (or show generically) a code you do not know.

## 7. Not built yet

| Missing | Spec |
|---|---|
| Loading results into a timeline, and the results of a timeline | P2-3905, P2-3906 (tables `timeline_loads` and `timeline_results` are reserved, not created) |
| Editing a timeline's steps or dates after creation | P2-3904 |
| Assessors seeing only the results of their timelines, and the timeline filter for non-admin users | P2-3909 |
| Pausing, closing early, extended access, manual advance or hold; email alerts | Out of scope of this spec |
| Reopening a closed cycle, or closing a cycle by hand (a cycle closes when another is activated) | Out of scope of this spec |
| Any front screen | P2-3934 |
