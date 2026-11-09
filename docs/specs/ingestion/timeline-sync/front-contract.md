# Timeline sync — Front contract

For the front lead (P2-3906, front side). This note **supersedes** the step-1 copy (`docs/specs/archive/2026-11-04-ingestion--step-1-loads/front-contract.md`, left untouched there). The server side is built and documented in the OpenAPI document (`/api/v1/docs`, tag `loads`). Conventions shared with the other admin routes (envelope, `Idempotency-Key`, error format, Rome time) are in `docs/specs/archive/2026-10-21-admin-config--cycle-timelines/front-contract.md`: read that first. Source of truth for any disagreement: `server/src/ingestion/` (`loads.controller.ts`, `models/load.model.ts`, `load-rules.ts`, `loads.errors.ts`) and `server/src/common/error-codes.ts`.

**What changed since step 1, in one paragraph.** A load is now a **sync**: the ADMIN can start it at **any step**, as many times as needed, until the closing minute of the timeline's **last** step. Each sync has a **round** (1 or 2), taken from the step in force. The routes are the same four; every change is an added field, an added skip reason, or a different window. The old "step 1 only, once" rule is gone.

## 1. Quick path

1. `GET /timelines/:id/loads/preview` when the admin opens the sync screen. If `window` is `closed`, disable the start. Show `round` and `stepPosition` so the admin sees which round the sync will enter.
2. `POST /timelines/:id/loads` (body `{}`, one `Idempotency-Key` per click intent) answers **202** `{ id, status: "running" }` at once. The run continues on the server.
3. Poll `GET /timelines/:id/loads` every **2 seconds** while the newest load is `running`. Stop on `completed` or `failed`.
4. On `completed` or `failed`, read `GET /timelines/:id/loads/:loadId` once for the `summary`.

All four routes are ADMIN only. Any other role gets 403 `AUTH_PERMISSION_DENIED` before anything else is looked at.

## 2. The window and the round

**Window (FR-1).** A sync can start while the cycle is not closed **and** now (Rome minute) is at or before the closing minute of the timeline's **last** step. That closing minute is still open: at 23:59 the start is accepted, at 00:00 it is 409 `LOADS_WINDOW_CLOSED`. The preview's `window` follows the same rule (`closed` when the cycle is closed or the last step has closed). A closed cycle is judged first: 409 `CYCLES_CLOSED`. Before step 1 opens, a start is accepted (round 1, step position 1).

**Round (FR-2).** The round of a sync is the **stored round of the step in force** at the start: the last step whose opening minute has passed, or step 1 before any step opens. It is recorded on the load together with that step's position, and read once at the start (editing a step during the run does not change it). On the default 5-step timeline, steps 1-2 are round 1 and steps 3-5 are round 2, and a minute in the gap after a step closes still belongs to that step. A timeline has at most 2 QA rounds (section 6).

**What a round means for a result.**

| Situation | Outcome |
|---|---|
| New to the timeline, any round | Taken as **new** (classified as in step 1) |
| Taken in this round already, or held now by this timeline | Skip `ALREADY_IN_THIS_TIMELINE` |
| Held, or returned, in another timeline of the cycle whose last step has not closed | Skip `ACTIVE_IN_OTHER_TIMELINE` (names that timeline) |
| Round 2, returned here in round 1, Reporting's `submitted_at` later than the return | Taken as **re-submitted** (`pending`) |
| Round 2, returned here in round 1, `submitted_at` null or not later | Skip `RETURNED_NOT_RESUBMITTED` |
| Round 2, ended here in round 1 for another reason (released or timeline closed) | Skip `ALREADY_IN_THIS_TIMELINE` |
| Listed twice by the feed | Skip `DUPLICATE_RESULT_CODE` |

**A re-submitted result (S-9).** (a) Still a Knowledge Product: `pending`, KP group `review`, not re-classified and not released by the KP release. (b) Type changed from KP to another type: `pending`, no KP group; the round-1 row keeps the KP type as history. (c) Type changed to KP: classified as a KP new to the timeline and released like one. A result **new** to the timeline is classified as in step 1, whatever the round.

## 3. The four routes

| Method | Path | Request | Success | Codes (besides the shared ones, section 8) |
|---|---|---|---|---|
| GET | `/timelines/:id/loads/preview` | none | 200 `LoadPreview` | 404 `TIMELINES_NOT_FOUND`; 409 `LOADS_CATALOG_MISSING`; 503 `SERVICE_UNAVAILABLE` |
| POST | `/timelines/:id/loads` | `{}`; any key is 400 `VALIDATION_FAILED` | **202** `{ id, status: "running" }` | 404 `TIMELINES_NOT_FOUND`; 409 `LOADS_CATALOG_MISSING`, `CYCLES_CLOSED`, `LOADS_WINDOW_CLOSED`, `LOADS_ALREADY_RUNNING`; 503 `SERVICE_UNAVAILABLE`; the idempotency codes (section 7) |
| GET | `/timelines/:id/loads` | none | 200 `LoadItem[]`, newest first | 404 `TIMELINES_NOT_FOUND` |
| GET | `/timelines/:id/loads/:loadId` | none | 200 `LoadDetail` (a `LoadItem` plus `summary`) | 404 `TIMELINES_NOT_FOUND`, `LOADS_NOT_FOUND` |

`:id` and `:loadId` that are not positive integers are 400 `VALIDATION_FAILED`. A `:loadId` of another timeline is 404 `LOADS_NOT_FOUND`.

## 4. Shapes (new fields in **bold**)

**`LoadPreview`** (nothing is written, in QA or in Reporting):

| Field | Meaning |
|---|---|
| `phaseYear` | The cycle's year |
| `window` | `open` or `closed` (section 2) |
| **`round`** | `1` or `2`: the round a sync started now would be recorded with |
| **`stepPosition`** | The position of the step in force |
| `toLoad.total` | Results a sync would bring in |
| **`toLoad.new`**, **`toLoad.resubmitted`** | New to the timeline, and re-submitted after a return; `new + resubmitted = total` |
| `toLoad.byProgram[]` | `{ programId (CLARISA id), code, count }` |
| `toLoad.byResultType[]` | `{ key, count }` |
| **`returnedNotResubmitted`** | `{ total, byProgram[{ programId, code?, count }], byResultType[{ key, count }] }`: results this timeline returned in round 1 that have not entered round 2. Counted under the **round-1** program and type. `code` is optional and **only the preview fills it** (and only while the feed still lists a result of that program); a stored summary has none, so show `programId` when `code` is absent |
| `kpGroups` | `{ notInQa, autoChecked, review }` |
| `skipped[]` | `{ reason, count, timelines? }`; `timelines` (`[{ id, name, count }]`) only on `ACTIVE_IN_OTHER_TIMELINE` |

**`LoadItem`** (list row): `id`, `status`, `total` (`null` until the feed is listed), `processed`, `startedAt`, `finishedAt` (`null` while `running`), `startedBy { id, nickname }` (`nickname` may be `null`), `failureReason` (`null` unless `failed`), plus **`round`** (1 or 2) and **`stepPosition`**. **A load recorded before this spec reads `round` 1 and `stepPosition` 1.**

**`LoadDetail`** adds `summary`:

| Key | Meaning |
|---|---|
| `loaded` | Results taken in. `loaded = loadedNew + loadedResubmitted` |
| **`loadedNew`**, **`loadedResubmitted`** | The two parts of `loaded` |
| **`round`** | The load's round (the same value as on the item) |
| **`returnedNotResubmitted`** | As in the preview, without `code`. Counted **once when the run ends** from QA's own memberships, so it includes a returned result the feed no longer lists (a program that un-submitted it). It is not a sum of the lots |
| `byProgram[]` | `{ programId, count }` |
| `byResultType[]` | `{ key, count }` |
| `kpGroups` | `{ notInQa, autoChecked, review }` |
| `skipped[]` | As in the preview |

The stored summary (`load-rules.ts`) keeps the keys `byType` and `otherTimelines`; the API shows them as `byResultType` (a list of `{ key, count }`) and as `skipped[].timelines` on `ACTIVE_IN_OTHER_TIMELINE`. The front never sees the stored names.

A `failed` load keeps the summary of the lots it recorded before it failed. A summary stored before this spec reads: `loadedNew = loaded`, `loadedResubmitted = 0`, `round = 1`, `returnedNotResubmitted = { total: 0, byProgram: [], byResultType: [] }`.

`returnedNotResubmitted.total` and `skipped` may differ: only a returned result the feed **still lists** is a `RETURNED_NOT_RESUBMITTED` skip; one the feed no longer lists is counted in `returnedNotResubmitted` only.

Progress: show `processed` of `total`; while `total` is `null`, show an indeterminate state. Do not treat `processed > total` as an error to the user (known gap G-2, step-1 design section 10).

## 5. Statuses, skips and failures

**Statuses** are unchanged: `running` (disable the start, poll every 2 s), `completed` (show the summary), `failed` (show the reason; the admin may sync again). A `running` load whose heartbeat is older than 5 minutes reads `failed` with `ABANDONED` on every read. One sync runs per cycle: a second start is 409 `LOADS_ALREADY_RUNNING`.

**Skip reasons** (`skipped[].reason`) are strings. QA's four:

| Reason | Meaning |
|---|---|
| `ACTIVE_IN_OTHER_TIMELINE` | Another timeline of the cycle holds the result (active, or returned and its last step still open); `timelines[]` names it |
| `ALREADY_IN_THIS_TIMELINE` | This timeline already holds the result, or took it in this round |
| **`RETURNED_NOT_RESUBMITTED`** | Round 2: this timeline returned the result in round 1 and the program has not submitted it again since |
| `DUPLICATE_RESULT_CODE` | The feed listed the same `result_code` more than once |

Reporting's own reasons come through **as given**: `not_found`, `not_submitted`, `other_phase`, `not_w1w2`, `type_not_catalogued`, `no_lead_program`. The list grows additively, so **render an unknown reason as plain text, never fail on it**.

**`returned`** is a new end reason of a membership (the result went back to its program in round 1). It is **not reachable over HTTP yet**: no route and no job ends a membership as `returned`. The assessment spec will add the caller (FR-6). Until then the sync's `returned` handling is built and tested but sees no live data; do not build a screen that expects one.

**Failure reasons** (`failureReason`, closed list, never a secret): `REPORTING_UNAUTHORIZED`, `REPORTING_REJECTED`, `REPORTING_UNAVAILABLE`, `CATALOG_VERSION_MISMATCH`, `STORE_UNAVAILABLE`, `ABANDONED`, `INTERNAL`. Meanings are as in the step-1 contract; show one generic message per value.

**The preview is an estimate at intake level.** It reads the feed list and the details of the Knowledge Products and **never calls Reporting's intake** (FR-1). A result Reporting's intake refuses can show as taken in the preview and surface only in the sync, as a skip with Reporting's reason; so `loaded` can be lower than `toLoad.total`, and the run's `skipped` can hold reasons the preview did not show. Present the preview as an estimate.

## 6. Timeline create: `ROUND_ABOVE_MAX`

`POST /cycles/:id/timelines` refuses a step whose `round` is above 2: 400 `VALIDATION_FAILED` with the field issue code `ROUND_ABOVE_MAX` on `steps[n].round` (all issues at once; message "A timeline has at most 2 QA rounds."). It can fire together with `ROUND_SEQUENCE` on the same step. The edit route has no `round` field: sending one is 400 with the field issue `UNKNOWN_FIELD`. Round contiguity and the start at 1 are validated as before.

## 7. The start

`POST /timelines/:id/loads`, `Idempotency-Key` as in the shared contract: a repeat of the same key returns the **same load id** and starts no second load (`Idempotency-Replayed: true`). The idempotency codes are 409 `IDEMPOTENCY_IN_PROGRESS` and 422 `IDEMPOTENCY_KEY_REUSED`.

- The server first makes one cheap call to Reporting. If it is unreachable or answers 401, the start is 503 `SERVICE_UNAVAILABLE` and nothing is written. This check comes before the refusals below.
- Reporting has no QA catalog for the cycle's year: preview and start are 409 `LOADS_CATALOG_MISSING`, nothing written.
- Any other non-401 Reporting 4xx at preview or start surfaces as 500 `INTERNAL_ERROR` (a defect on our side).
- Then, in order: a closed cycle is 409 `CYCLES_CLOSED`, a passed window is 409 `LOADS_WINDOW_CLOSED`, a live sync in the cycle is 409 `LOADS_ALREADY_RUNNING`. A refusal writes nothing.
- The 202 means the sync is recorded, not that it finished.

A completed sync releases its "not in QA" and auto-checked Knowledge Products to Reporting as `qaed`, as in step 1. A re-submitted KP is `pending` and is **not** released.

## 8. Error codes

Messages are the catalog text (`server/src/common/error-codes.ts`); show your own copy and use the code. Codes reachable from the loads routes and the timeline create/edit/assign routes:

| Code | HTTP | Message |
|---|---|---|
| `LOADS_WINDOW_CLOSED` | 409 | The loading window of this timeline has closed, so no new load can start. |
| `LOADS_ALREADY_RUNNING` | 409 | Another load in this cycle is still running. Wait for it to finish, then try again. |
| `LOADS_NOT_FOUND` | 404 | This load does not exist. |
| `LOADS_CATALOG_MISSING` | 409 | Reporting has no QA catalog for this cycle's year, so there are no results to load. |
| `TIMELINES_NOT_FOUND` | 404 | This timeline does not exist. |
| `CYCLES_NOT_FOUND` | 404 | This cycle does not exist. |
| `CYCLES_CLOSED` | 409 | This cycle is closed, so its timelines and assignments can no longer change. |
| `TIMELINES_NAME_TAKEN` | 409 | Another timeline in this cycle already has this name. Choose a different name. |
| `TIMELINES_VERSION_STALE` | 409 | Someone else changed this timeline. Reload it and make your change again. |
| `TIMELINES_IN_PROGRESS_UNCONFIRMED` | 409 | This change affects a step that is in progress. Confirm it to save. |
| `TIMELINES_USER_NOT_ELIGIBLE` | 409 | This user is inactive or does not hold the role this step needs. Choose another user. |
| `TIMELINES_ASSIGNMENT_NOT_FOUND` | 404 | This assignment does not exist or was already removed. |
| `VALIDATION_FAILED` | 400 | Some fields are missing or invalid. Check them and try again. |
| `MALFORMED_JSON` | 400 | The request could not be read. Send a valid JSON body. |
| `SERVICE_UNAVAILABLE` | 503 | The service is temporarily unavailable. Try again in a few minutes. |
| `INTERNAL_ERROR` | 500 | Something went wrong on our side. Try again; if it keeps happening, contact support and share the reference code. |
| `IDEMPOTENCY_IN_PROGRESS` | 409 | This request is already being processed. Wait a moment and try again. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | This request identifier was already used for a different request. Start the change again. |
| `AUTH_TOKEN_INVALID` | 401 | Your session is not valid or has expired. Sign in again. |
| `AUTH_USER_NOT_ADMITTED` | 401 | Your access to QA is no longer active. Sign in again or contact an administrator. |
| `AUTH_PERMISSION_DENIED` | 403 | You do not have permission to do this. |

**Field issue codes** (`error.fields[].code` of a 400 `VALIDATION_FAILED`) the timeline create/edit can return: `REQUIRED`, `INVALID_TYPE`, `TOO_LONG`, `UNKNOWN_FIELD`, `INVALID`, `OUT_OF_RANGE`, `CLOSES_BEFORE_OPENS`, `OVERLAPS_PREVIOUS_STEP`, `BEFORE_TODAY`, `DST_HOUR`, `AUDIENCE_ORDER`, `ROUND_SEQUENCE`, **`ROUND_ABOVE_MAX`**, `FIRST_STEP_LOAD`, `LOCKED`. The only new code in this spec is `ROUND_ABOVE_MAX`; the rest are as in the cycle-timelines contract.

Catalog codes of other modules are **not** part of this contract (they have their own): the remaining `AUTH_*` codes (login, session, admission), `USERS_*`, `FIELD_CONFIG_*`, `CYCLES_YEAR_TAKEN`, `CYCLES_NOT_DRAFT`, and the field issue codes `INVALID_EMAIL` and `NOT_ASSESSED`. The generic transport codes any route may return (`BAD_REQUEST`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `TOO_MANY_REQUESTS`) keep the shared meaning from the cycle-timelines contract.

## 9. Stored, not exposed: changed fields

When a sync takes a result that already has a snapshot in the same cycle, the new membership records which fields changed, in `timeline_results.changed_fields` (MySQL, JSON array of catalog field keys), with `previous_membership_id` pointing at the membership it was compared with. **No HTTP route returns them in this spec**: they are stored for the results list of the worklist / assessment spec, which will read them without touching DynamoDB.

| Stored value | Meaning |
|---|---|
| `NULL` (and `previous_membership_id` `NULL`) | No earlier snapshot in the cycle: the result is new |
| `[]` | An earlier snapshot exists and nothing changed |
| `["title", ...]` | Sorted keys whose values differ (the "Updated" tag of the results list) |
| `["result_type_key"]` | The type changed (S-9 b, c): **only** that key is listed, whatever else differs |

Plan the "Updated" tag against this; it needs a read surface from the assessment spec first. Changed fields are never logged.

## 10. Clock-skew note

The re-submission test compares Reporting's `submitted_at` (Reporting's clock, UTC, whole seconds) with the return instant `ended_at` (QA's clock). Both are floored to whole seconds and the comparison is strictly "later"; a tie counts as not re-submitted. The two clocks can differ, so a program that re-submits **within seconds of a return** can be misjudged: shown as `RETURNED_NOT_RESUBMITTED` when it is a re-submission, or the reverse. This is an accepted risk (requirements section 7), with no automated remedy. Show the skip as the server reports it.

## 11. Logs

Only the runner's log lines (`lot`, `completed`, `failed`) carry the new `round`. The service lines (`preview`, `start`, `list`, `get`) do not. The `load_start` and `load_end` audit rows include the round.

## 12. Client files to follow (P-12)

The consumers that must follow this contract are Yeck's. This spec does not edit `client/`.

| File | What follows |
|---|---|
| `client/src/app/core/api/loads.models.ts` | The new fields, summary keys and the `RETURNED_NOT_RESUBMITTED` reason |
| `client/src/app/pages/workspace/cycle/load-drawer.ts` | Preview: round, `toLoad.new` / `resubmitted`, `returnedNotResubmitted`; the "step 1" wording |
| `client/src/app/pages/workspace/cycle/load-summary-drawer.ts` | The summary's new keys |
| `client/src/app/pages/workspace/cycle/load.copy.ts` | Copy for the new skip reason and the round |
| `client/src/app/pages/workspace/cycle/cycle.logic.ts` | `loadTargets` and the menu label (P-13 below) |
| `client/src/app/core/http/api-envelope.ts` | The field issue code `ROUND_ABOVE_MAX` if it maps issue codes to copy |
| `client/src/app/pages/workspace/cycle/cycle-view.ts` | Uses `loadTargets` (`:60`, `:109`) |

**P-13 finding (read at the source, `cycle.logic.ts`, not edited).** The premise "the front decides *can load* from the server's `window` only" is **false**. `loadTargets` (`cycle.logic.ts:128-135`) gates the load action on **step 1**: it keeps a timeline only when it is saved on the server and step 1 is not `closed` and step 1's own closing minute is still ahead (`:131` `first.state === 'closed'`, `:132-133` step 1's end day against `now`). `timelineVM` then shows the menu action only when `loadable` is true, and labels it "Load results into step 1" (`:315`). Effect: once step 1 closes, the front hides the sync that the server still allows until the last step closes (FR-1). Fix on the front: gate on the last step's closing minute (or on the preview's `window`), and rename the label. The server is unaffected, and its refusal (409 `LOADS_WINDOW_CLOSED`, the preview's `window`) stays the last word.

## 13. Not in this spec

- No route to cancel or retry a sync, and no per-result list: the summary is counts only.
- No route that returns a result's changed fields, and no route that returns a result (`returned` has no caller yet).
- The screens' design is Juanpa's; this note fixes behaviour, not layout.
