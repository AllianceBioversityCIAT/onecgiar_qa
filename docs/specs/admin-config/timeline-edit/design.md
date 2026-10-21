# Edit a QA timeline — Design

## 1. Document Control

| | |
|---|---|
| Spec path | `docs/specs/admin-config/timeline-edit` |
| Requirements | `requirements.md` (FR-1…FR-14, NFR-1…NFR-8, S-1…S-8) |
| Depth | Full |
| Approval Mode | gated |
| Status | Draft |
| Extends | `docs/specs/archive/2026-10-21-admin-config--cycle-timelines/design.md` (cited as *timelines* DD-n, § n) and TRD § 4 / § 5.1 / § 6 |
| Exploration | Delegated to a scout (read-only), citations as run at `c2cab59`; consumer rows re-run inline |
| Last updated | 2026-10-21 |

## 2. Executive Summary

One new route, `PATCH /timelines/:id`, in the existing `TimelinesController`. A pure function `validateTimelineUpdate` judges the request against the stored timeline and today in Rome. It returns every issue: structure, step-state locks and scope lock on the fields that change, then the creation rules on the merged result. The service reads first, checks the version, validates, asks for the in-progress confirmation, and only then opens one transaction. That transaction locks cycle → timeline, re-checks the version, writes the changes and one audit row. The read model gains the **hold**: step 1's day has arrived with no load, so status is `waiting_for_load` and every step is `upcoming`. The hold reads "has a load" through a new port that answers "no" until P2-3905. Migration `0004` adds `timelines.version` / `updated_at` / `updated_by` and the append-only `timeline_audit_events`.

**Budget (tripwire for `/akili-execute`):** 9 tasks · ≈ 3,900 LOC including tests (≈ 1,300 source, ≈ 2,400 tests, ≈ 200 docs) · ≈ 13 review rounds. The previous spec ran ×5.4 over its LOC plan (*kaizen* `admin-config--cycle-timelines`, Budget), so this plan counts tests explicitly.

## 3. Architecture Overview

No new module and no new container. Everything sits in `admin-config/timelines` (TRD § 4), behind the class-level `ADMIN_ACCESS` guard (*timelines* FR-16).

| Layer | Change |
|---|---|
| Controller | New `update` handler, `@Idempotent()`, OpenAPI |
| Service | `update` flow (§ 7.2); read path passes "has a load" into the view |
| Pure rules | `timeline-rules.ts`: `validateTimelineUpdate` and a shared merged-state check reused by create; `timeline-view.ts`: hold, step state, new status |
| Diff | `timeline-diff.ts` (new, pure): stored vs merged → changed fields, used for the no-op test, the in-progress check and the audit row |
| Ports | `TimelinesStore` gains lock-and-read, update and scope-replace methods; new `TIMELINE_LOADS` port (§ 7.4); new audit write on the store |
| Data | Migration `0004` (§ 5) |

## 4. Extended Directory Structure

```text
server/
├── drizzle/0004_timeline_edit.sql                         (new, generated)
├── src/admin-config/
│   ├── admin-config.context.ts                            (+ 'timeline_update')
│   ├── admin-config.errors.ts                             (+ 2 errors)
│   ├── AGENTS.md                                          (updated — deliverable)
│   └── timelines/
│       ├── timelines.controller.ts                        (+ PATCH)
│       ├── timelines.service.ts                           (+ update; read path passes loads)
│       ├── timelines.store.ts                             (+ lock/update/replace/audit)
│       ├── timelines.unit-of-work.ts                      (binds loads + audit in tx)
│       ├── timeline-rules.ts                              (+ validateTimelineUpdate, shared merged check)
│       ├── timeline-diff.ts                               (new)
│       ├── timeline-view.ts                               (+ hold, step state, waiting_for_load)
│       ├── timeline-loads.ts                              (new: port + "no loads" adapter)
│       ├── timeline-response.ts                           (+ version, step state)
│       ├── dto/update-timeline.dto.ts                     (new)
│       └── models/timeline.model.ts                       (+ version, state, status enum)
├── src/common/error-codes.ts                              (+ 2 codes, + 1 field code)
├── src/database/drizzle/schema/
│   ├── timelines.ts                                       (+ version, updated_at, updated_by)
│   ├── timeline-audit-events.ts                           (new)
│   └── index.ts, schema.spec.ts                           (export; pins 0004)
└── test/
    ├── admin-config-timelines.e2e-spec.ts                 (+ edit sections; status tests pinned with a load)
    └── support/in-memory-admin-config.ts                  (+ update, locks, audit, loads fake)
docs/specs/admin-config/timeline-edit/front-contract.md    (new — deliverable)
```

## 5. Data Model

Migration `0004_timeline_edit` is **additive**: two `ALTER TABLE … ADD COLUMN` and one `CREATE TABLE`. No drop, no rename, no data rewrite (`schema.spec.ts` additive check, pattern of 0001–0003).

| Table | Column / key | Rule | Requirements |
|---|---|---|---|
| `timelines` | `version` int unsigned NOT NULL DEFAULT 1 | Existing rows start at 1. Raised by exactly 1 on each applied edit, only by the conditional update | FR-9 |
| `timelines` | `updated_at` datetime NULL, `updated_by` int unsigned NULL → `users.id` | Both set on each applied edit, or both null (CHECK). Last edit only; the history is in the audit table | FR-10 |
| `timeline_audit_events` (new) | `id` bigint unsigned PK · `timeline_id` → `timelines.id` · `actor_id` → `users.id` · `action` enum(`update`) · `changes` json · `request_id` varchar(64) NULL · `created_at` datetime default now | Append-only: no update columns, no update or delete in code. Index (`timeline_id`, `created_at`). Same shape as `user_audit_events` (P-9) | FR-10, NFR-8 |

**`changes` shape:** `{ "<field>": { "before": …, "after": … } }`, only changed fields. Keys: `name`, `allPrograms`, `programIds`, `allResultTypes`, `resultTypeKeys`, `steps.<position>.name`, `steps.<position>.opensOn`, `steps.<position>.closesOn`. Lists are sorted, so the same set never shows as a change.

**Step rows** are updated in place by (`timeline_id`, `position`): name, `opens_on`, `closes_on`. Scope rows are replaced: delete the timeline's rows, then insert the new list, inside the transaction. Rows exist only while the "all" flag is false (*timelines* DD-6).

## 6. API Design

| Method | Path | Roles | Request | Response | Errors |
|---|---|---|---|---|---|
| PATCH | `/api/v1/timelines/:id` | ADMIN (`ADMIN_ACCESS`) | `TimelineUpdate` (below); optional `Idempotency-Key` | 200 `Timeline` as read after the change (no-op: as stored) | 400 `VALIDATION_FAILED` / `MALFORMED_JSON`; 401; 403; 404 `TIMELINES_NOT_FOUND`; 409 `CYCLES_CLOSED`, `TIMELINES_NAME_TAKEN`, `TIMELINES_VERSION_STALE`, `TIMELINES_IN_PROGRESS_UNCONFIRMED`; 422 `IDEMPOTENCY_KEY_REUSED`; 503 `SERVICE_UNAVAILABLE` (catalog unreachable) + idempotency codes |

**`TimelineUpdate`**: `version` (int ≥ 1, required) · `name?` · `allPrograms?` · `programIds?` · `allResultTypes?` · `resultTypeKeys?` · `steps?` = list of `{ position (1–5, required), name?, opensOn?, closesOn? }` · `confirmInProgress?` (boolean). Any other key, at any level, is 400 `UNKNOWN_FIELD` from the global pipe (NFR-2). That covers `audience`, `round`, `requiresLoad` and `kind`.

**Scope pairs:** a scope change sends its flag. With the flag false it also sends the list; with the flag true the list is absent or empty, as in create. A list sent without its flag is judged against the stored flag.

**Field paths in a 400** are `name`, `programIds`, `resultTypeKeys`, `version`, `steps[i].<key>`. **On update, `i` is the step's index in the timeline (position − 1), not its index in the request.** That way a rule can name a step the request did not send (FR-5 "Overlap introduced by an edit"). New field code: `LOCKED` ("This can no longer be changed."). `BEFORE_TODAY`, `INVALID`, `REQUIRED`, `TOO_LONG`, `OVERLAPS_PREVIOUS_STEP` and `CLOSES_BEFORE_OPENS` are reused.

**`Timeline` response additions:** `version` (int); `status` gains `waiting_for_load`; each step gains `state` (`closed` / `in_progress` / `upcoming`). All other fields keep their *timelines* FR-12 meaning (FR-14).

**New top-level codes:**

| Code | Status | Message (user-facing) |
|---|---|---|
| `TIMELINES_VERSION_STALE` | 409 | Someone else changed this timeline. Reload it and make your change again. |
| `TIMELINES_IN_PROGRESS_UNCONFIRMED` | 409 | This change affects a step that is in progress. Confirm it to save. |

**Answer order** (first that applies wins): 401/403 (guard) → 400 shape (pipe) → 404 → 409 `CYCLES_CLOSED` → 409 `TIMELINES_VERSION_STALE` → 503 catalog → 400 `VALIDATION_FAILED` (every rule issue) → 409 `TIMELINES_IN_PROGRESS_UNCONFIRMED` → no-op 200 → write → 409 `TIMELINES_NAME_TAKEN` (1062) or 409 stale (lost race) → 200.

## 7. Backend Module Design

### 7.1 Pure functions

**`timeline-view.ts`**
- `viewTimeline` gains the input `hasLoad: boolean`.
- **Hold** = step 1 exists, today ≥ step 1's `opensOn`, and `hasLoad` is false.
- **Step state:**
  - With a hold, every step is `upcoming`.
  - Without one, a step is `closed` if `closesOn` < today, `in_progress` if `opensOn` ≤ today ≤ `closesOn`, and `upcoming` otherwise.
- **Status:** the FR-6 table. The hold wins over dates; that is how `waiting_for_load` survives every date passing.
- `currentStep` is null during a hold, and `nextStep` is 1.
- Readiness is unchanged.

**`timeline-rules.ts`** — `validateTimelineUpdate(stored, request, context)`. `context` = today, the known catalogs and `hasLoad`. The function returns every `FieldIssue`, in a fixed order:
1. **Structure:**
   - A step position the timeline lacks, or the same position twice → `steps[k].position INVALID`, where `k` is the request index, since the step does not exist.
   - Text checks (`REQUIRED`, `TOO_LONG`) on every sent name.
2. **Merge.** Stored values overlaid with the sent ones. Text is trimmed and lists are deduped, as `normalized()` does in create.
3. **Locks, on changed fields only.** A changed field is one whose merged value differs from the stored one. The state comes from `viewTimeline` over the **stored** steps.
   - `closed` step: changed `opensOn` or `closesOn` → `LOCKED`.
   - `in_progress` step: changed `opensOn` → `LOCKED`; changed `closesOn` before today → `BEFORE_TODAY`.
   - `upcoming` step: changed `opensOn` before today → `BEFORE_TODAY`.
   - Scope changed while step 1 is not `upcoming`, or while `hasLoad` is true → `LOCKED` on `programIds` / `resultTypeKeys`.
4. **Merged-state rules.** The create checks extracted into one shared function, used by both create and update: scope pairs and catalog membership, dates real, `CLOSES_BEFORE_OPENS`, `OVERLAPS_PREVIOUS_STEP`.
   - Audience order, round sequence, step count and the first-step load are not re-checked: they cannot change (S-4).
   - Create keeps its own step-1 `BEFORE_TODAY`. Update replaces it with step 3 above (DD-5).

**`timeline-diff.ts`** — `diffTimeline(stored, merged)` → the changed fields as the audit `changes` map (§ 5). It is used in three places:
- An empty diff is a no-op (FR-11).
- A changed key under an `in_progress` step's position needs `confirmInProgress` (FR-8).
- It is the audit payload (FR-10).

### 7.2 `TimelinesService.update` flow

Wrapped in `logged('timeline_update', …)`, so there is one decision line (NFR-7).

| # | Step | Outcome |
|---|---|---|
| 1 | Read `now` once from `ADMIN_CONFIG_CLOCK`; `today = todayInRome(now)` | — |
| 2 | Read the timeline bundle (row, steps, scope), its cycle status and `hasLoad` (§ 7.4), without locks | 404 / 409 `CYCLES_CLOSED` |
| 3 | `request.version ≠ stored.version` | 409 `TIMELINES_VERSION_STALE` |
| 4 | Read the catalogs only for an explicit list that changes | 503 if unreachable |
| 5 | `validateTimelineUpdate` | 400 with every issue |
| 6 | `diffTimeline`; an in-progress key without `confirmInProgress` | 409 `TIMELINES_IN_PROGRESS_UNCONFIRMED` |
| 7 | Empty diff | 200 with the stored timeline, nothing written |
| 8 | Transaction (read committed, *timelines* DD-9 order): cycle `FOR SHARE` (closed → 409) → timeline `FOR UPDATE` (gone → 404; version moved → 409 stale) → conditional `UPDATE timelines … SET version = version + 1, updated_at, updated_by [, name, flags] WHERE id AND version` (0 rows → 409 stale; 1062 on `uq_timelines_cycle_name` → 409 name taken) → step updates → scope replace → audit insert → `markExecuted(reservation, id)` | Rollback on any error |
| 9 | `get(id)` after the commit | 200 |

Validating outside the transaction is safe because step 8 re-checks the version under the row lock: the state that was validated is the state being written (DD-6). The state is judged with the `today` of step 1. A request that straddles midnight in Rome is judged by the instant it arrived; that is accepted, and the next read shows the new day.

### 7.3 Store and unit of work

**`TimelinesStore` additions:**
- `findForUpdate(id)` — the timeline row `FOR UPDATE`, with its version.
- `updateTimeline(id, expectedVersion, values)` — returns `updated`, `stale` or `name_taken`, through `duplicateKeyText` (P-4).
- `updateStep(timelineId, position, values)`.
- `replacePrograms(timelineId, ids)` and `replaceResultTypes(timelineId, keys)`.
- `insertAuditEvent(values)`.
- `findBundle(id)` — the row plus steps, programs and result types in a fixed 4 statements. This reuses the list methods by id.

**Unit of work:** the unit of work binds the same store over `tx`, as today. The in-memory fake gains:
- the same methods;
- an X lock on `timelines:<id>` for `findForUpdate` and `updateTimeline`, with the conditional update checking the version under that lock;
- an audit log array;
- a settable loads set.

### 7.4 Loads port

| Item | Design |
|---|---|
| Port | `TIMELINE_LOADS` → `TimelineLoads.withLoad(timelineIds): Promise<ReadonlySet<number>>` (batched, one statement at most) |
| Adapter now | `NoTimelineLoads`: returns an empty set **without a query** (S-1). NFR-5 counts stay at 6 for the list |
| P2-3905 | Swaps the adapter for a query over `timeline_loads`; the list becomes 7 statements, still fixed. Rules and view stay as they are (NFR-6) |
| Consumers | `respond()` (list/get/detail) for the hold; `update` step 2 for the hold and the scope lock |
| Tests | The fake can mark timelines as loaded; status tests that need `live` / `finished` mark the timeline loaded (DD-8) |

### 7.5 Errors, catalog, log

- **New errors:** `TimelineVersionStaleError` (409) and `TimelineInProgressUnconfirmedError` (409) in `admin-config.errors.ts`, registered in `error-codes.spec.ts`'s class list (P-6).
- **Field codes:** the field-code set gains `LOCKED`, and the pinned set test goes from 13 to 14 (P-6).
- **Log:** `AdminConfigAction` gains `timeline_update`; `targetId` is the timeline id. No body, name or date is logged.

### 7.6 Idempotency

`@Idempotent()` on the route. The interceptor already serves `PATCH` (P-7). The stored target id is the timeline id, and the existing timelines replay reader is reused.

- A **completed** replay returns the stored first answer, so a replay never answers 409 stale and never writes a second audit row (FR-13).
- In the **crash window** (executed, answer not stored) the reader re-reads the timeline as it is now. That is the first answer unless another edit committed in between. This is accepted and documented in the front contract (DD-9).

## 8. Frontend / UX Component Architecture

Not built here (P2-3937). The contract the front relies on goes in `front-contract.md`, a deliverable of this spec:
- the request shape;
- step paths by position − 1;
- `state` to lock date inputs;
- `waiting_for_load` to show the step-1 warning (P2-3972);
- the two 409 codes and the confirmation flow: on `TIMELINES_IN_PROGRESS_UNCONFIRMED`, ask the user, then resend with `confirmInProgress: true`, or send it up front after the drawer's own pop-up;
- on stale, reload;
- the zone note: dates are Rome days (*timelines* D-1).

## 9. Shared Contracts or Package Extensions

- **Front model** (`client/src/app/core/api/cycles.models.ts` on `staging-center`, P-11): `TimelineStatus` must add `waiting_for_load`. The timeline type gains `version` and the step type gains `state`. The front lead makes that change in P2-3937; this spec does not edit `client/`.
- No new env vars.
- **TRD § 5.1 / § 6** (new table, columns, route): recorded as a pending item for `staging` in `execution.md` (proposal R-5); not edited on this branch.

## 10. Design Decisions

| ID | Decision | Alternatives rejected | Consequence | Requirements |
|---|---|---|---|---|
| DD-1 | One `PATCH /timelines/:id` with a partial body; steps addressed by position | Split routes per step (two calls per save, partial failures, no single 400); `PUT` with the create body (exposes fields S-4 fixes) | Smallest surface; one transaction and one audit row per save | FR-1, FR-5 |
| DD-2 | The hold is computed in `viewTimeline` from a `hasLoad` input; status gains `waiting_for_load`; every step is `upcoming` during a hold | A stored status flag (breaks *timelines* DD-2, needs a job); a readiness item only (AC 6 asks for a timeline state) | Edits need no extra rule for "on hold": `upcoming` already allows date moves and scope changes | FR-2, FR-6, FR-7 |
| DD-3 | "Has a load" behind a `TIMELINE_LOADS` port, batched, answering "none" without a query until P2-3905 | Hard-coding `false` in the view (P2-3905 would have to touch the rules); querying the reserved table (does not exist, P-8) | NFR-5 count unchanged now; one adapter swap later | FR-4, FR-6, NFR-5, NFR-6 |
| DD-4 | Locks apply to **changed** fields only, a change being merged ≠ stored | Validate every sent field (a drawer resending a past date would fail; FR-3 "Unchanged past date on hold") | The front can send the whole drawer | FR-3, FR-4 |
| DD-5 | Update replaces create's step-1 `BEFORE_TODAY` with state-based rules; the merged-state rules are one shared function | Run `validateTimelineCreate` on the merged state (refuses every started timeline: step 1 in the past) | Create behavior unchanged; one source for date order and overlap | FR-3, FR-5 |
| DD-6 | Optimistic version: checked early, re-checked under the timeline's `FOR UPDATE`, and backed by a conditional `UPDATE … WHERE version = ?` | Pessimistic lock across the validation (catalog calls inside a transaction, *timelines* design 7.2 avoids it); last-write-wins (lost updates) | Two same-version edits: exactly one applies; the database decides (KZ-admin-config--cycle-timelines-1); HITL on MySQL in T-9 | FR-9, NFR-3 |
| DD-7 | Step field paths on update are `steps[position − 1]` | Request index (cannot name an unsent neighbour); `steps.<position>` (a new path style for the front) | Same path style as create; the front maps steps by position | FR-5 |
| DD-8 | Existing status tests that expect `live` / `finished` mark their timeline as loaded through the fake loads port | Leave them unloaded (they would turn `waiting_for_load`) | Delivered `live` / `finished` behavior stays covered; new tests cover the hold. See reversion challenge | FR-6, FR-14 |
| DD-9 | Crash-window idempotent replay re-reads the timeline (existing reader), not the first answer | Store the first answer at `markExecuted` time (changes the shared idempotency mechanism for one route) | Documented deviation, visible only after a server crash between commit and answer | FR-13 |
| DD-10 | Audit in a dedicated `timeline_audit_events`, same shape as `user_audit_events`, written in the edit's transaction | A generic `audit_events` (the history story is not specified, Q-7); log lines only (not durable, AC 8) | The history story reads one table; a later generic table can absorb it by migration | FR-10, NFR-8 |
| DD-11 | The in-progress confirmation is checked after rule validation and before the no-op test, over the diff | Before validation (the admin confirms, then learns of errors); as a field issue (it is a question, not an error) | One extra round only when everything else is valid | FR-8 |

### Reversion challenge (Step 2.3)

**Reverted behavior:** DD-2 and DD-8 change what *timelines* FR-12 delivered. A timeline whose step-1 day has arrived used to be `live` (or `finished`) with a current step; with no load it is now `waiting_for_load` with none. **Question: what does removing that break?** The check was run inline: one question, no panel.

| Breaks | Addressed by |
|---|---|
| Server tests asserting `live` / `finished` / `currentStep` on unloaded timelines: `test/admin-config-timelines.e2e-spec.ts` (lines 386, 911, 982-995, 1034, 1039, 1068-1069, 1135), `timelines.service.spec.ts` (1098, 1456-1462), `timeline-view.spec.ts` | DD-8; T-2 and T-7 own them (P-10) |
| The front model `TimelineStatus = 'scheduled' \| 'live' \| 'finished'` (P-11): an exhaustive switch or a lookup by status gets an unknown value | Front contract + P2-3937 (R-2); the value is additive in JSON |
| Timelines already on TEST (created in the previous spec's HITL) turn `waiting_for_load` after deploy | Expected and truthful (S-1); stated in the front contract and the HITL notes |
| Readiness, assignments, list order | Not touched |

No breakage is left unaddressed.

## 11. Premise Ledger

Count: 12 rows. 11 verified, 1 `UNVERIFIED` (Impact: 0 High, 1 Low).
Blast-radius triggers: **consumer** (response shape, status enum, field-code set), **shared-state** (`viewTimeline` serves list, get and detail; the field-code catalog is shared with users), **live-path** (the user action "read a timeline" reaches the changed view).

| # | Claim | Class | Citation (as run) | Verified at | If false | Settled by |
|---|---|---|---|---|---|---|
| P-1 | No route, store method or adapter updates a timeline or step today | existence | `grep -rn "update(timelines)\|update(timelineSteps)\|\.delete(" server/src/admin-config/timelines` → only `timelines.service.spec.ts:1667` (unrelated map delete); `grep -rn "@Patch" server/src/admin-config` → no hits | `c2cab59` | An existing edit path would be extended instead of added (DD-1, Low) | — |
| P-2 | Create validates before the transaction (catalogs read only for explicit lists), then locks the cycle `FOR UPDATE` | location | `server/src/admin-config/timelines/timelines.service.ts:228-235,444-466`; `cycles/cycles.store.ts:87` | `c2cab59` | DD-6's "validate outside, re-check inside" would not mirror create (Low) | — |
| P-3 | No method locks a timeline row; only `lockCycleShared` locks (`FOR SHARE`) | existence | `grep -n "for('update')\|for('share')\|forUpdate" server/src/admin-config/timelines/timelines.store.ts` → line 347 only | `c2cab59` | `findForUpdate` would already exist (§ 7.3, Low) | — |
| P-4 | Duplicate keys are recognized by `duplicateKeyText` (1062 / `ER_DUP_ENTRY`, up to 3 causes) and matched to the key name | location | `server/src/admin-config/timelines/timelines.store.ts:173-189,198-210` | `c2cab59` | `updateTimeline`'s `name_taken` outcome needs another detector (Low) | — |
| P-5 | Status is computed only in `viewTimeline`, called only from `toTimelineResponse`, used by `get` / `detail` / `listByCycle` through `respond()` | live-path | Chain: `GET timelines/:id` → `TimelinesController.detail` (`timelines.controller.ts`, `@Get('timelines/:id')`) → `TimelinesService.detail` (`timelines.service.ts:147-153`) → `get` (135-140) → `respond` (176-208, `today` at 178) → `toTimelineResponse` (`timeline-response.ts:90-94`) → `viewTimeline` (`timeline-view.ts:51-89`). List: `listByCycle` (160-173) → `respond` | `c2cab59` | The hold would not reach every read (DD-2, High) | — |
| P-6 | The field-code set is pinned at 13 and each domain error class must be registered | shared-state | `server/src/common/error-codes.ts:310-331`; `server/src/common/error-codes.spec.ts:219-237` (exact sorted set), 102-145 (class list), 147-153. Shared with users: `FieldIssue` at `server/src/users/users.errors.ts:152-156` | `c2cab59` | T-5 would not need to touch the pinned tests (Low) | — |
| P-7 | `@Idempotent()` serves `PATCH`; the fingerprint is method + path + canonical body; a completed key replays the stored answer; the crash window re-reads through the module's reader | location | `server/src/common/idempotency/idempotent.decorator.ts:13-17`; `server/src/users/users-admin.controller.ts:188-189` (`@Patch` + `@Idempotent`); `fingerprint.ts:40-50`; `idempotency.interceptor.ts:228-244`; reader `server/src/admin-config/timelines/timelines.module.ts:42-51` | `c2cab59` | FR-13 would need changes to the shared mechanism (DD-9, High) | — |
| P-8 | `timeline_loads` does not exist; nothing can record a load | existence | `grep -rn "timeline_loads\|timelineLoads" server/src server/drizzle` → 3 hits, none a table: `server/src/database/AGENTS.md:14` (doc), `server/src/admin-config/AGENTS.md:43` ("not created"), `server/src/database/drizzle/schema/schema.spec.ts:934` (asserts 0003 does **not** contain it); `ls server/drizzle` → `0000`…`0003` + `meta` | `c2cab59` | The loads port could query real data now (DD-3, Low) | — |
| P-9 | `user_audit_events` is written inside the change's transaction, by its repository over `tx` | other | `server/src/users/user-audit.repository.ts:48-63,82`; `server/src/users/users-admin.unit-of-work.ts:173`; `server/src/users/users-admin.service.ts:562` | `c2cab59` | DD-10's "same pattern" claim falls (Low) | — |
| P-10 | Server consumers of the status / response that the hold changes | consumer | `grep -rn "TimelineStatus\|viewTimeline\|TimelineResponse" server/src server/test` → `timeline-response.ts:4,28,40,61,70,74,90`, `timeline-view.ts:5,23,68`, `models/timeline.model.ts:15,19,89,136` (status enum hard-coded at 130-136), `timelines.controller.ts:52,137,158`, `timelines.service.ts:34,38,135,160,176,193`, `timeline-view.spec.ts`; status literals in `server/test/admin-config-timelines.e2e-spec.ts` (386, 911, 982-995, 1034, 1039, 1068-1069, 1135) and `timelines.service.spec.ts` (1098, 1456-1462) | `c2cab59` | A missed reader keeps the old enum or breaks (T-2, T-6, T-7 Consumers, High) | — |
| P-11 | The front's API model types status as `'scheduled' \| 'live' \| 'finished'`, on `staging-center` only; no client code calls the timeline routes on this branch | consumer | `git grep -n -E "scheduled\|finished\|currentStep\|nextStep\|readiness" origin/staging-center -- client/src/app/core/api/cycles.models.ts` → `:69` `TimelineStatus`, `:93-95`; on `feat/timeline-edit`: `grep -rlE "/timelines\|timeline-defaults" client/src` → no hits | `c2cab59` / `origin/staging-center` @ `bcfbc27` | The contract note would target the wrong file (R-2, Low) | — |
| P-12 | Real InnoDB serializes two conditional updates on the same row so that exactly one sees the old version | data-env | `UNVERIFIED — confirm at source before relying on it` | — | DD-6 needs a stronger guard (Low: the `FOR UPDATE` re-check already serializes; the conditional update is the backstop) | T-9 HITL concurrent-edit check on MySQL (back lead) |
