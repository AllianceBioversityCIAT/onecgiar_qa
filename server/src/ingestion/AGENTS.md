# src/ingestion — Agent Guide

Timeline sync: the ADMIN brings the eligible results of Reporting into one timeline with a manual sync, at **any step**, as many times as needed, until the closing minute of the timeline's last step. **Current spec:** none active; the latest is `docs/specs/archive/2026-11-09-ingestion--timeline-sync/` (`design.md`; what the front may rely on: `front-contract.md` there). It builds on the step-1 spec, now archived: `docs/specs/archive/2026-11-04-ingestion--step-1-loads/` (`design.md`, DD-1…DD-11; known gaps in § 10; its `front-contract.md` is superseded). Root and `server/AGENTS.md` rules apply.

## Model in one line

`POST /timelines/:id/loads` records a `timeline_loads` row as `running`, with the sync's `round` and `step_position`, and answers 202; an in-process `LoadRunner` then reads the Reporting feed, filters, takes the results into QA through Reporting's intake, fetches their details, and per lot of 50 writes memberships (`timeline_results`, MySQL, one per result per round) and immutable snapshots (`ResultSnapshot`, DynamoDB). At the end it counts the results this timeline returned and that have not come back. Reporting is reached only through its HTTP API.

## Files

| Path | Role |
|---|---|
| `ingestion.module.ts` | Wires the module (see *Bindings* below) |
| `loads.controller.ts` | 4 routes (`GET .../loads/preview`, `POST .../loads` `@Idempotent()` 202, `GET .../loads`, `GET .../loads/:loadId`). `ADMIN_ACCESS` at class level; `preview` is declared before `:loadId` so the literal wins |
| `loads.service.ts` | `preview`, `start`, `list`, `get`; one `ingestion` log line per request; the `LOAD_RUNNER` port the start fires after the commit |
| `load-runner.ts` | The run: lots of 50, 3 attempts with 1 s then 4 s waits (±20 %), heartbeat every 60 s, catalog-version check with one forced refresh, the KP release port (`KP_RELEASE_ENABLED = true`) |
| `load-rules.ts` | Pure: `LOAD_LEASE_MS` (5 min), `syncWindow`, `stepInForce`, `entryRound`, `effectiveLoadStatus`, `membershipEnds`, `skipVerdict`, `isResubmitted`, `canonicalJson`, `changedFields`, `mergeSummary` (the 0008 summary keys) |
| `kp-classifier.ts` | `KP_RULES` port and `DEFAULT_KP_RULES` (the 2025 Knowledge Product rule, three groups) |
| `loads.store.ts`, `loads.unit-of-work.ts` | Port and Drizzle adapter; one READ COMMITTED transaction per write (start, lot, end). The store also has `endAsReturned` (port only: no route and no job calls it yet) and `countReturnedNotResubmitted` |
| `results-feed.port.ts`, `reporting-results-feed.client.ts`, `feed-paging.ts` | `RESULTS_FEED` (`list`, `details`, `intake`, `release`); the HTTP adapter (one `FeedError` of kind `unauthorized`, `rejected` or `unavailable`); paging at 200 |
| `snapshot-store.port.ts`, `dynamo-snapshot-store.ts` | `SNAPSHOT_STORE` and the repo's first ElectroDB entity |
| `loads.errors.ts` | `LoadWindowClosedError` (409 `LOADS_WINDOW_CLOSED`), `LoadAlreadyRunningError` (409 `LOADS_ALREADY_RUNNING`), `LoadNotFoundError` (404 `LOADS_NOT_FOUND`), `LoadCatalogMissingError` (409 `LOADS_CATALOG_MISSING`); the other refusals are reused from admin-config |
| `dto/`, `models/` | Pipe shape (`StartLoadDto` is empty: any key is 400) and OpenAPI models |
| `fixtures/` | Reporting contract examples (`qa-catalog.en.md` v1.29) for the adapter tests |

## Bindings (read before changing admin-config's catalog or timelines store)

`IngestionModule` does not import the admin-config modules. It binds its **own** collaborators:

- Its own `TIMELINES_STORE` (`DrizzleTimelinesStore`, stateless over `DRIZZLE`).
- Its own `FIELD_CATALOG_SOURCE` (`ReportingQaCatalogClient`). **There are therefore two catalog caches**, one here and one in admin-config. A change to the key, the credential or the URL in admin-config's binding must be mirrored here, or the run reads with different credentials than the field configuration.
- The idempotency replay reader of the start, which answers 202 `{ id, status: 'running' }` from the stored load id.

The other direction: `admin-config/timelines` reads the ingestion tables through its own `DrizzleTimelineLoads` and imports only the pure constant `LOAD_LEASE_MS` from `load-rules.ts`. It never imports `IngestionModule` (DD-9), so there is no module cycle. Keep it that way.

## Rules

- **ADMIN only (FR-13).** A new route inherits `@RequirePermission(Permission.ADMIN_ACCESS)` from the class; a route without it is a review failure. Reporting is never called for another role.
- **The database carries the invariants** (generated keys with unique indexes): one running load per cycle (`running_key`), one active membership per `(cycle, result_code)`, one membership per `(timeline, result_code, entry_round)`. A lost race is a skip or a typed 409, never a retry loop.
- **Time only through `ADMIN_CONFIG_CLOCK`**, as admin-config. The window is judged in Rome minutes.
- **Window (FR-1):** a sync starts while the cycle is not closed and now is at or before the closing minute of the timeline's **last** step (that minute is still open). A closed cycle is `CYCLES_CLOSED` first, then `LOADS_WINDOW_CLOSED`. Before step 1 opens a start is accepted as round 1. A refusal writes nothing.
- **Round (FR-2):** the stored `timeline_steps.round` of the step in force at the start (the last step whose opening minute has passed; step 1 before any opens), read once under the timeline lock. It is recorded on the load with `step_position` and is the `entry_round` of every membership the load writes. A timeline has at most 2 rounds: create refuses a higher one with `ROUND_ABOVE_MAX`; the edit cannot change a round.
- **Membership per round (FR-5):** one membership per `(timeline, result_code, entry_round)` (`uq_timeline_results_timeline_code_round`) and still one **active** membership per `(cycle, result_code)`. A lost race on either key is a skip, never a failed lot.
- **Skip order (FR-4):** another timeline of the cycle (active, or `returned` with its last step still open) → this timeline holds it or took it this round → round 2 and returned here → `RETURNED_NOT_RESUBMITTED` unless the feed's `submitted_at` is strictly later than `ended_at` (UTC, whole seconds) → listed twice → take. Reporting order is unchanged and skipped results never reach intake or details.
- **Return and re-entry (FR-6, S-9):** `endAsReturned` ends an active round-1 membership as `returned`; it has **no caller** and must not be reachable over HTTP in this spec. A re-submitted result enters round 2 as `pending` (same type: keeps its KP group, no classifier, never released; type changed from KP: no KP group; type changed to KP: classified as new). `changed_fields` is `NULL` when the result has no earlier snapshot in the cycle, `[]` when nothing changed, `["result_type_key"]` alone on a type change; it is stored, never returned by a route and never logged.
- **Summary (FR-9):** `loadedNew + loadedResubmitted = loaded`; `returnedNotResubmitted` is counted once at the end of the run from QA's memberships, never merged per lot. A summary stored before `0008` is read with the defaults (`round` 1).
- **Stale loads read as `failed`/`ABANDONED`** on every read when `heartbeat_at` is older than `LOAD_LEASE_MS`; the next start persists that state. The 60 s heartbeat is renewed by a timer while the run is alive.
- **Reporting order is fixed:** list, then intake, then details of the taken results only (S-3). Never ask details of a skipped or refused result.
- **Retries:** only a 5xx, a timeout, a network or store error is retried (3 attempts). A 401 is `REPORTING_UNAUTHORIZED`, any other 4xx `REPORTING_REJECTED`, immediately. Failure reasons are the closed list `REPORTING_UNAUTHORIZED`, `REPORTING_REJECTED`, `REPORTING_UNAVAILABLE`, `CATALOG_VERSION_MISMATCH`, `STORE_UNAVAILABLE`, `ABANDONED`, `INTERNAL`.
- **At preview and start, a Reporting 404 (no QA catalog for the cycle's year) is 409 `LOADS_CATALOG_MISSING`**; any other non-401 4xx is left to surface as 500 (our defect, not an outage), and the `ingestion` log line names it `reporting_rejected_<status>`. 5xx, timeout, network and 401 are 503. In the run any 4xx is `REPORTING_REJECTED`.
- **Snapshots are written once** with `attribute_not_exists(pk)`: the same hash on a retry is success, a different hash fails the load as `INTERNAL`. `loadedAt` is the load's `started_at`, so a retry writes identical content.
- **KP release is on** (`KP_RELEASE_ENABLED = true`, FR-14, S-8, since 2026-11-04): after the lots, a completed load releases its `not_in_qa` and `auto_validated` KPs as `qaed`. A test turns it off through `KP_RELEASE_SETTING`.
- **A KP to review is assessed in step 1** (S-9 corrected 2026-11-04): `pending`, `awaits_step` always null. The column stays in `0007`, unused.
- **No PII in logs (NFR-7).** One `event: 'ingestion'` line per request (`route`, `timelineId` or `loadId`, `outcome`, `reason?`): ids and fixed words only; only the runner's lines carry `round`, never a result title, name, body, URL or header. `FeedError` messages are fixed text.
- **Audit:** `timeline_audit_events` gets a `load_start` row in the start's transaction and a `load_end` row when the load ends, both with the round; append-only, no PII.
- **Typed errors from the catalog.** New codes go in `common/error-codes.ts` and, for the front, in `docs/specs/archive/2026-11-09-ingestion--timeline-sync/front-contract.md` (section 8). A code in `loads.errors.ts` missing from the contract is a review failure.

## Known gaps

G-1 (lease revival), G-2 (lost commit acknowledgement on a lot) and G-3 (heartbeat without progress) are recorded in `docs/specs/archive/2026-11-04-ingestion--step-1-loads/design.md` § 10 with their effects and candidate fixes. They are not tasks of this spec; read them before touching `recordLot`, `renewHeartbeat` or the heartbeat timer.

## Testing

- Pure rules: `load-rules.spec.ts`, `kp-classifier.spec.ts`.
- Services and units of work over in-memory stores and a fake feed: `loads.service.spec.ts`, `load-runner.spec.ts`, `loads.unit-of-work.spec.ts`.
- Adapters: `reporting-results-feed.client.spec.ts` (fixtures), `dynamo-snapshot-store.spec.ts`; `dynamo-snapshot-store.dynamo-local.spec.ts` needs DynamoDB Local (`DYNAMODB_ENDPOINT`).
- HTTP and privacy suites: `server/test/ingestion-loads.e2e-spec.ts` (routes, guards, idempotent start, OpenAPI) and `server/test/ingestion-loads-privacy.e2e-spec.ts`.
