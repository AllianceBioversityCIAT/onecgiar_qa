# Timeline edit — Front contract

For the front lead (P2-3937). The server side is built and documented in the OpenAPI document (`/api/v1/docs`); this note says what the edit screen can rely on, what the server owns, and what is open. It adds to `docs/specs/archive/2026-10-21-admin-config--cycle-timelines/front-contract.md` (dates are Rome calendar days, envelope, `Idempotency-Key`, error format): read that first. Source of truth for any disagreement: `server/src/admin-config/timelines/` (controller, `dto/update-timeline.dto.ts`, `timeline-rules.ts`, `timelines.service.ts`).

## 1. Quick path

1. Read the timeline (`GET /timelines/:id`) and keep its `version`.
2. Send `PATCH /timelines/:id` with that `version` and only the fields the admin changed.
3. 200 returns the whole timeline with its new `version`: replace the screen state with it.
4. On 409 `TIMELINES_VERSION_STALE`: reload and ask the admin to redo the change. On 409 `TIMELINES_IN_PROGRESS_UNCONFIRMED`: ask, then resend with `confirmInProgress: true`. If you send an `Idempotency-Key`, both resends take a **fresh** one (section 8).

## 2. The request

`PATCH /timelines/:id`, ADMIN only, optional `Idempotency-Key` (same rules as the creates; section 8). Allowed in a `draft` or `active` cycle; a `closed` cycle is 409 `CYCLES_CLOSED`.

| Key | Type | Meaning |
|---|---|---|
| `version` | integer, at least 1, **required** | The `version` the admin read. Absent or not an integer is 400 |
| `name` | string | New name, at most 120 characters after trimming, unique in the cycle ignoring letter case (409 `TIMELINES_NAME_TAKEN`) |
| `allPrograms` / `allResultTypes` | boolean | The scope flags |
| `programIds` / `resultTypeKeys` | array | The scope lists (section 5) |
| `steps` | array of `{ position, name?, opensOn?, closesOn? }` | The steps to change, each by `position` (1 to 5). A step left out is untouched |
| `confirmInProgress` | boolean | Confirms a change that touches a step in progress (section 6) |

- **A key left out keeps its stored value.** Send only what changed; a partial body is the normal case.
- **The structure is fixed.** Any key outside the table, at any level, is 400 `UNKNOWN_FIELD`: `kind`, `audience`, `round`, `requiresLoad`, `id`, and a step's `state` are all refused. Steps cannot be added, dropped or reordered.
- **`null` is never "clear this".** It is tolerated only on `programIds`, `resultTypeKeys`, `opensOn` and `closesOn`. On the two lists it means "left out". On a date it is read as a missing date and answers `REQUIRED` on that date; when that date is locked (a `closed` step's two dates, an `in_progress` step's `opensOn`) the same field also gets `LOCKED`, because `null` differs from the stored day. On any other key (`version`, `name`, `allPrograms`, `allResultTypes`, `steps`, `confirmInProgress`, a step's `position` or `name`) `null` is a shape error from the pipe: 400 `VALIDATION_FAILED` with code `REQUIRED` on that key, not `INVALID_TYPE`, because the pipe reads any `null` as a missing value (`server/src/common/validation.ts:43-51`). To clear a scope list, set the flag instead (section 5).
- **No-op.** A request that changes nothing (every value equals the stored one) answers 200 with the timeline as stored, the same `version`, and writes nothing. It is not an error and needs no message.
- A value equal to the stored one is not a change: a drawer may resend a past date untouched without a lock error (section 4).

## 3. The answer and the new fields

The 200 body is a `Timeline` (the shape of the list, not `TimelineDetail`: no `users[]`). Three things are new on `Timeline`:

| Field | Values |
|---|---|
| `version` | Integer, starts at 1, **raised by one per applied edit**. Unchanged by a no-op, by assigning or removing users, and by reads. Send it back in the next PATCH |
| `steps[].state` | `closed` · `in_progress` · `upcoming`, from the step's dates and today in Rome, computed on every read. During a hold (below) every step is `upcoming` |
| `status` | `scheduled` · **`waiting_for_load`** · `live` · `finished` |

`waiting_for_load` (the hold): step 1 exists, its opening day has arrived (today in Rome is on or after `steps[0].opensOn`) and the timeline has no load. It wins over the dates: the status stays `waiting_for_load` even after every step's closing day; no step is `in_progress`, `currentStep` is `null` and `nextStep` is `1`. Show it as "waiting for results to be loaded", not as live or finished.

- **Every timeline of a TEST environment becomes `waiting_for_load` once its first step opens**, because loads are not built (P2-3905): at HEAD no timeline has a load, so a timeline whose step 1 has opened reads `waiting_for_load` and not `live`. This includes timelines that were `live` or `finished` before this spec was deployed. The `scheduled` ones are unchanged until their day arrives.
- `readiness` still lists `NO_RESULTS_LOADED` for every timeline.

**Client change requested.** These files exist on `origin/staging-center` (the front lead's P2-3934 work), not on the server branches, and must be updated there. `client/src/app/core/api/cycles.models.ts` line 69 is `export type TimelineStatus = 'scheduled' | 'live' | 'finished';`: add `waiting_for_load`. Its step type must add `state` (`closed` | `in_progress` | `upcoming`) and its timeline type `version` (neither exists there yet). `client/src/app/core/http/api-envelope.ts` lists the field codes in the comment on `ApiFieldError.code` (lines 30-31 on `staging-center`): add `LOCKED`, new here. This note is how the updates are requested; the server spec does not edit `client/`.

## 4. Paths of validation errors

A 400 `VALIDATION_FAILED` lists every problem at once in `fields: [{ field, code, message }]`, and nothing is written.

| Where | `field` |
|---|---|
| Timeline name | `name` |
| Scope | `programIds`, `resultTypeKeys` |
| A step | **`steps[position - 1].<key>`**: step 1 is `steps[0]`, step 3 is `steps[2]`, with `<key>` one of `name`, `opensOn`, `closesOn` |
| A bad `position` | `steps[requestIndex].position`, code `INVALID` |

**The step path is the step's place in the timeline, not its place in the request.** Sending `steps: [{ position: 3, closesOn: ... }]` and getting a problem on it gives `steps[2].closesOn`, not `steps[0].closesOn`. The one exception is a problem with the `position` itself: a position the timeline does not have, or the same position sent twice, is reported at the index of the offending entry in the request, `steps[i].position` (for a repeated position, the later entry). Such an entry is not judged further.

Rule codes on an edit (besides the shape codes `UNKNOWN_FIELD`, `INVALID_TYPE`, `REQUIRED`, `TOO_LONG`, `INVALID`):

| Code | Field | Meaning |
|---|---|---|
| `LOCKED` | `steps[p-1].opensOn` | The step is `closed` or `in_progress`: its opening day cannot change |
| `LOCKED` | `steps[p-1].closesOn` | The step is `closed`: its closing day cannot change |
| `LOCKED` | `programIds`, `resultTypeKeys` | The scope changed after step 1 started, or the timeline has a load |
| `BEFORE_TODAY` | `steps[p-1].closesOn` | An `in_progress` step's closing day moved before today. Extending it is allowed |
| `BEFORE_TODAY` | `steps[p-1].opensOn` | An `upcoming` step moved to open before today |
| `CLOSES_BEFORE_OPENS`, `OVERLAPS_PREVIOUS_STEP` | as in create | The merged dates must still be consistent: each `opensOn` strictly after the previous step's `closesOn` |
| `REQUIRED`, `INVALID`, `TOO_LONG` | as in create | Name text, dates, scope lists |

- **Locks judge changed fields only.** A value sent equal to the stored one is not a change and is never `LOCKED`.
- **`LOCKED` on the scope names the list** (`programIds` or `resultTypeKeys`), also when only the flag changed.
- **While the timeline is on hold** every step is `upcoming`, so the lock rules treat even a step whose closing day has passed as editable, and the scope is open. See OQ-TE-1 below.
- A first-step date is never checked against today unless it changed.

## 5. Scope edits

| Sent | Result |
|---|---|
| `allPrograms: true`, list left out, `null` or empty | The stored list is emptied: "all" holds no ids |
| `allPrograms: true` with a non-empty list | `programIds` `INVALID` |
| `allPrograms: false`, list left out | Judged against the **stored** list; when the timeline was "all" it holds none, so `programIds` `REQUIRED` |
| A list without the flag | Judged against the **stored flag**: with the flag stored true, a non-empty list is `INVALID`; with it false, the list replaces the stored one |
| `allPrograms: false` with an empty list | `programIds` `REQUIRED` |
| Unknown id | `INVALID` on that list, checked only when the scope changed |

Same for `allResultTypes` / `resultTypeKeys`. Rule of thumb: **a scope change sends its flag and its list together.** Never send `null` or `[]` to mean "all". Lists are compared as sets: the same ids in another order are not a change. Catalogs are read only when an explicit list changes, so a name or date edit works while CLARISA or Reporting is down; an explicit list while its catalog is unreachable is 503 `SERVICE_UNAVAILABLE`.

## 6. The two 409s and the confirmation flow

| Code | Status | When | Writes |
|---|---|---|---|
| `TIMELINES_VERSION_STALE` | 409 | `version` is not the stored one: someone else edited since the admin read, or two edits raced | Nothing |
| `TIMELINES_IN_PROGRESS_UNCONFIRMED` | 409 | The request is otherwise valid and changes a field of a step that is `in_progress`, and `confirmInProgress` is not `true` | Nothing |

Order of answers (the first that applies wins): 404 `TIMELINES_NOT_FOUND`, 409 `CYCLES_CLOSED`, **409 stale**, 503 catalog, 400 every rule problem, **409 unconfirmed**, then the no-op 200 or the write. So:

- **Stale beats everything below it.** An edit made on an old version is judged against nothing; it gets no 400 even if its values are wrong. After a reload the same values may now produce a 400.
- **The confirmation is a question, not an error.** It is asked only when everything else is valid, and it is never mixed into a 400. Do not show it as an error.

Flow:

1. The admin saves. The screen sends the PATCH without `confirmInProgress`.
2. `TIMELINES_IN_PROGRESS_UNCONFIRMED`: show the confirmation ("This step is in progress. Change it anyway?"), keeping the same body and the same `version`.
3. On confirm, **resend the same body plus `confirmInProgress: true`** with the same `version`, under a **fresh `Idempotency-Key`**. The first 409 is remembered under the first key and the body now differs, so reusing that key answers 422 `IDEMPOTENCY_KEY_REUSED` (section 8). If something moved meanwhile, step 3 of the order answers stale first: reload.
4. On stale at any point: reload the timeline (`GET /timelines/:id`), tell the admin it changed, and let them redo the change from the new values under a **fresh `Idempotency-Key`**. Do not auto-resend with the new version: the admin has not seen what changed. The old key would replay the stored stale 409 for the old body, or answer 422 for the new one.

`confirmInProgress: true` may be sent **up front**, when the drawer has already asked the admin in its own pop-up: the first PATCH is then the confirmed one and no 409 round trip happens. On a request that touches no in-progress step it is accepted and changes nothing. During a hold no step is `in_progress`, so no confirmation is asked.

## 7. Errors of this route

| Status | Code | Meaning for the screen |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Rule or shape problems; mark each `fields[]` entry (section 4) |
| 400 | `MALFORMED_JSON` | The body is not JSON |
| 404 | `TIMELINES_NOT_FOUND` | The timeline does not exist |
| 409 | `CYCLES_CLOSED` | The cycle is closed: no edit |
| 409 | `TIMELINES_NAME_TAKEN` | The name is used in this cycle |
| 409 | `TIMELINES_VERSION_STALE` | Reload (section 6) |
| 409 | `TIMELINES_IN_PROGRESS_UNCONFIRMED` | Confirm and resend (section 6) |
| 409 / 422 | `IDEMPOTENCY_IN_PROGRESS` / `IDEMPOTENCY_KEY_REUSED` | As for the creates |
| 503 | `SERVICE_UNAVAILABLE` | A catalog is unreachable; try again |

Known limit (pending T-9): a database deadlock or lock wait during the write (MySQL 1213 / 1205) is **not** mapped yet and surfaces as a plain 500 `INTERNAL_ERROR`. It is rare and nothing is written; a retry with the same body and the same `Idempotency-Key` is safe.

## 8. Retries and the crash window

Send a fresh `Idempotency-Key` per save (same header rules as the creates). The server fingerprints the method, the path and the body, not the header: a same-key request with the same fingerprint gets the **first answer** back, marked `Idempotency-Replayed: true`, and nothing runs again; with another body it is 422 `IDEMPOTENCY_KEY_REUSED`.

| Situation | Key |
|---|---|
| Lost answer, timeout or 5xx, same body | **Same key.** A 5xx is not remembered: the key is freed and the retry runs |
| Resend with `confirmInProgress: true` after `TIMELINES_IN_PROGRESS_UNCONFIRMED` | **Fresh key** (the body changed: 422 otherwise) |
| Redo after `TIMELINES_VERSION_STALE` and a reload | **Fresh key** (new `version`, so another body) |
| Admin fixes the body after a 400 or `TIMELINES_NAME_TAKEN` | **Fresh key** |
| Same body again after any 4xx | The same refusal is replayed, even if its cause is gone: do not do this |

- **A replay of an applied edit never answers 409 stale.** This covers the stored 200 and the crash window below. A retry after a lost answer carries the old `version`, and with the same key it still gets the first 200. Do not tell the admin such a retry can fail as "stale"; and do not rebuild the retry with a new `version` (another body is 422). A replay writes no second audit record.
- **A refusal is remembered and replayed as it was.** Every 4xx answer is stored under its key (`server/src/common/idempotency/idempotency.interceptor.ts:103-112, 309-322`): the same status, code and `fields`, with the replay header. A first 409 `TIMELINES_VERSION_STALE` replays as that 409, not as a 200. A no-op 200 is stored the same way. Only 5xx and unknown failures free the key.
- **Crash-window deviation (DD-9).** If the server crashed after committing the edit and before storing the answer, the replay re-reads the timeline **as it is now**, not the stored first answer. That is the same body unless another edit committed in between. Visible only after such a crash; treat the 200 as the current state of the timeline.
- A new key with the old `version` after the edit was applied is a different request: it answers 409 stale (the version moved).

## 9. What the server writes (for reference)

One audit row per applied edit (table `timeline_audit_events`, action `update`, the changed fields as `{ before, after }`). Refusals and no-ops write none. There is no screen or endpoint to read the history yet.

## 10. Open question

OQ-TE-1 (`requirements.md` § 9, for the business owner, Angel Jarrín): while a timeline is on hold, step 1 reads `upcoming` and its closing day can be moved into the past (for example to 3 Nov when today is 5 Nov). The current behavior follows FR-3 and the server allows it. Do not rely on the server refusing it; the front may pre-check it for comfort until the question is answered.

## 11. Not built yet

| Missing | Spec |
|---|---|
| Loads, and therefore leaving `waiting_for_load` | P2-3905, P2-3906 |
| Reading the audit history | Out of scope of this spec |
| Adding, dropping, reordering steps; changing audience, round or load requirement | Fixed by design (S-4) |
| Pause, close early, manual advance; email alerts | Out of scope |
