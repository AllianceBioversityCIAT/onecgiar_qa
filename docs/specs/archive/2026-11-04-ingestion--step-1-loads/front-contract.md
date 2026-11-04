# Step-1 loads — Front contract

For the front lead (P2-3905 front side). The server side is built and documented in the OpenAPI document (`/api/v1/docs`, tag `loads`); this note says what the load screens can rely on and what to expect when Reporting or the store misbehaves. Conventions shared with the other admin routes (envelope, `Idempotency-Key`, error format, Rome time) are in `docs/specs/archive/2026-10-21-admin-config--cycle-timelines/front-contract.md`: read that first. Source of truth for any disagreement: `server/src/ingestion/` (`loads.controller.ts`, `models/load.model.ts`, `loads.errors.ts`, `load-rules.ts`, `load-runner.ts`) and `server/src/common/error-codes.ts`.

## 1. Quick path

1. `GET /timelines/:id/loads/preview` when the admin opens the load screen. If `window` is `closed`, disable the start.
2. `POST /timelines/:id/loads` (body `{}`, one `Idempotency-Key` per click intent) answers **202** `{ id, status: "running" }` at once. The run continues on the server.
3. Poll `GET /timelines/:id/loads` every **2 seconds** while the newest load is `running`. Stop on `completed` or `failed`.
4. On `completed` or `failed`, read `GET /timelines/:id/loads/:loadId` once for the `summary`.

All four routes are ADMIN only. Any other role gets 403 `AUTH_PERMISSION_DENIED` before anything else is looked at, whatever the timeline.

## 2. The four routes

| Method | Path | Request | Success | Codes (besides the shared ones, section 7) |
|---|---|---|---|---|
| GET | `/timelines/:id/loads/preview` | none | 200 `LoadPreview` | 404 `TIMELINES_NOT_FOUND`; 503 `SERVICE_UNAVAILABLE` |
| POST | `/timelines/:id/loads` | `{}`; any key is 400 `VALIDATION_FAILED` | **202** `{ id, status: "running" }` | 404 `TIMELINES_NOT_FOUND`; 409 `CYCLES_CLOSED`, `LOADS_WINDOW_CLOSED`, `LOADS_ALREADY_RUNNING`; 503 `SERVICE_UNAVAILABLE`; the idempotency codes (section 6) |
| GET | `/timelines/:id/loads` | none | 200 `LoadItem[]`, newest first | 404 `TIMELINES_NOT_FOUND` |
| GET | `/timelines/:id/loads/:loadId` | none | 200 `LoadDetail` (a `LoadItem` plus `summary`) | 404 `TIMELINES_NOT_FOUND`, `LOADS_NOT_FOUND` |

`:id` and `:loadId` that are not positive integers are 400 `VALIDATION_FAILED`. A `:loadId` of another timeline is 404 `LOADS_NOT_FOUND`, the same as one that does not exist.

## 3. Shapes

**`LoadPreview`** (nothing is written, in QA or in Reporting):

| Field | Meaning |
|---|---|
| `phaseYear` | The cycle's year |
| `window` | `open` or `closed`. `closed` when the cycle is closed or step 1's closing minute has passed: the start would be refused |
| `toLoad.total` | Results a load would bring in |
| `toLoad.byProgram[]` | `{ programId (CLARISA id), code, count }`, by `programId` |
| `toLoad.byResultType[]` | `{ key, count }`, by `key` |
| `kpGroups` | `{ notInQa, autoChecked, review }`: the Knowledge Products to load, by group |
| `skipped[]` | `{ reason, count, timelines? }`. `timelines` (`[{ id, name, count }]`) only on `ACTIVE_IN_OTHER_TIMELINE` |

**`LoadItem`** (list row):

| Field | Meaning |
|---|---|
| `id` | Load id |
| `status` | `running`, `completed` or `failed` (section 4) |
| `total` | Results the run found, **`null` until it has listed the whole feed** |
| `processed` | Results handled so far (loaded or skipped) |
| `startedAt`, `finishedAt` | ISO 8601 instants; `finishedAt` is `null` while `running` |
| `startedBy` | `{ id, nickname }`; `nickname` may be `null` |
| `failureReason` | `null` unless `failed` (section 5) |

**`LoadDetail`** adds `summary`: `{ loaded, byProgram[{ programId, count }], byResultType[{ key, count }], kpGroups{ notInQa, autoChecked, review }, skipped[] }` with `skipped[]` as in the preview. A `failed` load keeps the summary of the lots it recorded before it failed.

Progress: show `processed` of `total`; while `total` is `null`, show an indeterminate state. Do not treat `processed > total` as an error to the user (known gap G-2, design section 10).

## 4. The three statuses

| `status` | Meaning | Screen |
|---|---|---|
| `running` | The run is in progress | Disable the start, poll every 2 s |
| `completed` | Every lot is done | Show the summary |
| `failed` | The run ended without finishing; `failureReason` says why. What earlier lots recorded **stays** in QA | Show the reason; the admin may start a new load (it resumes nothing: already loaded results come back as `ALREADY_IN_THIS_TIMELINE` skips) |

A `running` load whose heartbeat is older than 5 minutes reads **`failed` with `ABANDONED`** on every read, so a stalled run never blocks the screen for ever. One load runs per cycle: a second start is 409 `LOADS_ALREADY_RUNNING` until the first ends.

## 5. Skip reasons and failure reasons

**Skip reasons** (`skipped[].reason`) are strings. QA's three:

| Reason | Meaning |
|---|---|
| `ACTIVE_IN_OTHER_TIMELINE` | Another timeline of the cycle holds the result; `timelines[]` names it and how many |
| `ALREADY_IN_THIS_TIMELINE` | This timeline already holds the result (an earlier load, or a retry) |
| `DUPLICATE_RESULT_CODE` | The feed listed the same `result_code` more than once |

Reporting's own reasons come through **as given**, from its intake (`not_taken`) and details (`not_eligible`): `not_found`, `not_submitted`, `other_phase`, `not_w1w2`, `type_not_catalogued`, `no_lead_program`. Reporting's list grows additively, so **render an unknown reason as plain text, never fail on it**. Map the known ones to copy; fall back to the raw string.

**Preview and run can differ.** The preview reads the feed list and details of the Knowledge Products only. A non-KP result Reporting finds ineligible, and any result its intake refuses, surfaces **only in the run**, as a skip (`not_eligible` reasons and intake reasons). So the run's `skipped` can hold reasons and counts the preview did not show, and `loaded` can be lower than `toLoad.total`. Present the preview as an estimate.

**Failure reasons** (`failureReason`, closed list, never a secret):

| Value | Meaning |
|---|---|
| `REPORTING_UNAUTHORIZED` | Reporting answered 401 (also when its catalog answers 401) |
| `REPORTING_REJECTED` | Reporting refused the call with another 4xx, or has no catalog for the year |
| `REPORTING_UNAVAILABLE` | Reporting stayed down after 3 attempts (5xx, timeout, network) |
| `CATALOG_VERSION_MISMATCH` | Reporting's catalog version still differs from QA's after one forced refresh |
| `STORE_UNAVAILABLE` | A QA store (MySQL or DynamoDB) stayed down after 3 attempts |
| `ABANDONED` | The run stopped beating (section 4) |
| `INTERNAL` | Anything else, including a snapshot whose content conflicts with the stored one |

Show one generic message per value; the admin cannot fix any of them except by retrying or asking support.

## 6. The start

`POST /timelines/:id/loads`, `Idempotency-Key` as in the shared contract: a repeat of the same key returns the **same load id** and starts no second load (`Idempotency-Replayed: true`). The idempotency codes are 409 `IDEMPOTENCY_IN_PROGRESS` and 422 `IDEMPOTENCY_KEY_REUSED`.

- The server first makes one cheap call to Reporting. If Reporting is unreachable or answers 401, the start is 503 `SERVICE_UNAVAILABLE` and **nothing was written**: safe to retry with the same key. This check comes before the refusals below, so a closed window with Reporting down reads 503.
- Then, in order: a closed cycle is 409 `CYCLES_CLOSED`, a passed window is 409 `LOADS_WINDOW_CLOSED`, a live load in the cycle is 409 `LOADS_ALREADY_RUNNING`.
- The 202 means the load is recorded, not that it finished.

**Two behaviours to know.**

- **A non-401 Reporting 4xx at preview or start surfaces as 500** (`INTERNAL_ERROR`), not 503: it means QA sent Reporting a call it refuses, a defect on our side. In the run the same condition is the failure reason `REPORTING_REJECTED`.
- **A catalog 401 surfaces as failure reason `REPORTING_UNAUTHORIZED`** on the load, not as an HTTP error: the catalog is read inside the run.

**A completed load releases its "not in QA" and auto-checked Knowledge Products to Reporting as `qaed`** (on since 2026-11-04). KPs to review are assessed in step 1 like any result. The three `kpGroups` are counts only.

## 7. Error codes

Messages are the catalog text (`server/src/common/error-codes.ts`); show your own copy and use the code.

| Code | HTTP | Message |
|---|---|---|
| `LOADS_WINDOW_CLOSED` | 409 | The loading window of this timeline has closed, so no new load can start. |
| `LOADS_ALREADY_RUNNING` | 409 | Another load in this cycle is still running. Wait for it to finish, then try again. |
| `LOADS_NOT_FOUND` | 404 | This load does not exist. |
| `TIMELINES_NOT_FOUND` | 404 | This timeline does not exist. |
| `CYCLES_CLOSED` | 409 | This cycle is closed, so its timelines and assignments can no longer change. |
| `VALIDATION_FAILED` | 400 | Some fields are missing or invalid. Check them and try again. |
| `MALFORMED_JSON` | 400 | The request could not be read. Send a valid JSON body. |
| `SERVICE_UNAVAILABLE` | 503 | The service is temporarily unavailable. Try again in a few minutes. |
| `IDEMPOTENCY_IN_PROGRESS` | 409 | This request is already being processed. Wait a moment and try again. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | This request identifier was already used for a different request. Start the change again. |
| `AUTH_TOKEN_INVALID` | 401 | Your session is not valid or has expired. Sign in again. |
| `AUTH_USER_NOT_ADMITTED` | 401 | Your access to QA is no longer active. Sign in again or contact an administrator. |
| `AUTH_PERMISSION_DENIED` | 403 | You do not have permission to do this. |

The first three are new in this spec; the rest are shared.

## 8. Not in this spec

- No route to cancel or retry a load, and no per-result list: the summary is counts only.
- The screens' design is Juanpa's (proposal section 8); this note fixes behaviour, not layout.
- Rendering the results of a load is the review stories' work.
