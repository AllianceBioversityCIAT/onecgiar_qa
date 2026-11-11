# src/assessment — Agent Guide

Step-1 assessment: the worklist an assessor opens, the assessment view of one result, field validations, comments, the end of an assessment, quick comments, and the release outbox that tells Reporting a result left QA. **Spec:** `docs/specs/assessment/step-1-assessment/` (`design.md`, DD-1…DD-16; `front-contract.md` is what the front may rely on). Root and `server/AGENTS.md` rules apply.

## Model in one line

An assessor (or an ADMIN, read only) lists the memberships of a timeline (`GET /timelines/:id/worklist`), opens one, greens or comments Assessed fields, and finishes: `quality_assessed` when no core field is grey, `returned` when every grey core field has a comment. The end queues one `assessment_releases` row in the same transaction; `ReleaseService` sends it to Reporting after the commit and, on the answer, ends the membership.

## Files

| Path | Role |
|---|---|
| `assessment.module.ts` | Wires the module (see *Bindings*) |
| `worklist.controller.ts`, `worklist.service.ts`, `worklist.store.ts`, `worklist-cursor.ts` | 3 reads (`/worklist/timelines`, `/timelines/:id/worklist`, `…/worklist/options`); a fixed number of statements per read (timelines 2, page 4), none per row; the opaque cursor is valid only with the same `sort` and `dir` |
| `assessment.controller.ts`, `assessment.service.ts` | 5 routes (view, validations, comments `@Idempotent()`, finish, withdraw). The service owns scope, the 404 that tells nothing, and the removal of Hidden fields; nothing is filtered in the controller |
| `assessment-view.ts`, `comment-value-copy.ts` | Pure: the view over catalog + snapshot + configuration; the 64 KiB value copy (labels dropped first, then the value cut) |
| `assessment.store.ts`, `assessment.unit-of-work.ts` | Read and write ports with their Drizzle adapters; one READ COMMITTED transaction per write |
| `assessment-rules.ts`, `comment-transitions.ts`, `role-steps.ts`, `scope.ts`, `qa-status.ts` | Pure: the end rule; the comment state table (only `open` and `withdrawn` are `reachable` now); the role-step table (ASSESSOR is the only enabled writer); scope and the write decision; the status table, read by `statusOf` (TS) and `statusSqlCase` (SQL) so the two cannot drift |
| `quick-comments.controller.ts`, `quick-comments.service.ts` | `GET` and `POST /quick-comments` |
| `release.service.ts`, `release.store.ts`, `releases.controller.ts` | The release outbox and its two admin routes |
| `title-backfill.ts` | Bootstrap hook (not awaited): fills `timeline_results.title` for memberships written before the column existed |
| `assessment-log.ts` | The one decision log line of a write (*Logging*) |
| `assessment.errors.ts`, `dto/`, `models/` | The 8 typed refusals (`ASSESSMENT_*`, all in the front contract), pipe shapes, OpenAPI models |

## Bindings (read before changing credentials, tables or the clock)

DD-1. `AssessmentModule` imports `UsersModule` and `FieldConfigModule` **only among the feature modules**; "only" does not cover the infrastructure modules it also imports (`DrizzleModule`, `DynamoDbModule`, `ConfigModule.forFeature(catalogsConfig)`). It does not import `IngestionModule` (it exports nothing) or `TimelinesModule`. It binds its **own** copies, the way `IngestionModule` does:

- `TIMELINE_LOADS` = `DrizzleTimelineLoads` (the "has a load" probe of the step states). The ack builds `new DrizzleLoadsStore(tx)` itself on the transaction handle (`assessment.unit-of-work.ts:93`) for `endAsReleasedQaed` / `endAsReturned`. The `{ provide: LOADS_STORE, useClass: DrizzleLoadsStore }` provider at `assessment.module.ts:81` is not injected by anything in this module today; it is a leftover copy of ingestion's binding. Do not rely on it.
- `SNAPSHOT_STORE` = `DynamoSnapshotStore`. A change to the table or key schema in ingestion must be mirrored here.
- `RESULTS_FEED` = `ReportingResultsFeedClient`: a **second binding**. A change to its credential, URL or timeout in ingestion's binding must be mirrored here, or releases go out with different credentials than the loads.
- `FIELD_CATALOG_SOURCE` comes from `FieldConfigModule` (exported on purpose): one catalog cache shared with admin-config. Ingestion still has its own.
- Clock: `ADMIN_CONFIG_CLOCK` (the only time source of the services, NFR-4) and `IDEMPOTENCY_CLOCK`. The two clock factories at `assessment.module.ts:85` and `:88` are the **allowed clock binding**: the NFR-4 check (`tasks.md` T-10: a grep for the date constructor and the epoch-now call over non-spec files of this folder) must show only that file. Any other hit is a defect. This guide therefore never writes those two literals.
- `IDEMPOTENCY_REPLAY_READER` answers a comment create whose answer was not stored: it re-reads the comment from the stored id.

## Lock order and retries

Order of every write: **timeline row `FOR SHARE`** (`lockTimelineShared`; the lock a timeline edit waits on) → **`result_assessments` row `FOR UPDATE`** (`ensureAssessment`, then `lockAssessment`) → children (validations, comments, events, audit row, release row). READ COMMITTED. The service issues the calls in that order; the store never reorders them. A load's start takes the timeline `FOR UPDATE`; its lots and its end take it `FOR SHARE` (`loads.unit-of-work.ts`), the same as a write here; no load touches an assessment row. A withdraw takes the assessment row too, so a finish that counts non-withdrawn comments waits for it.

- **Deadlock (1213):** the whole unit of work is rerun, at most 3 attempts (`DEADLOCK_ATTEMPTS`). The victim is rolled back whole.
- **Pinned version:** a row that pins another field-configuration version than the one the request judged by sends the request round once more with the same clock; a second mismatch is 503 `SERVICE_UNAVAILABLE`, nothing committed.
- **`design.md` § 5 says "no cycle". That is too strong.** `ensureAssessment` (assessment row, then `timeline_results`) against the release ack (`timeline_results` through the membership end) can deadlock. The 1213 retry resolves it. Do not "fix" it by removing the retry.
- **Open gap (T-5):** a load's end takes the timeline `FOR SHARE`, as the ack does, so the ack's `endAsReturned` does **not** wait for `countReturnedNotResubmitted`. The two can interleave, so the count a load stores may not include a return the ack makes in the same instant. Not closed in this spec.

## Release outbox (FR-18)

- `ReleaseService` is the **sender**. An end only inserts the row; `dispatch()` runs after the commit and is never awaited by the request (NFR-6).
- **One claim = one send batch:** one phase year, at most 50 rows, no result id twice. `claimDue(clock, leaseMs, limit)` reads the clock **inside its own transaction**, so a wait for the pool is not taken from the lease. Rows are read `FOR UPDATE SKIP LOCKED`, then leased by one conditional `UPDATE … WHERE status = 'pending' AND (lease_until IS NULL OR lease_until < now)`; an affected-rows count different from the rows read throws `release_claim_mismatch` and rolls back.
- **Locked-year pass:** `buildDueYears` lists the phase years that have a due row, oldest first. If every row of the first year is held by another dispatcher, the claim tries the next year instead of ending the sweep.
- **Lease guard:** `WORST_CASE_SEND_MS` (3 attempts at the feed timeout plus the two waits with +20 % jitter) must stay below `RELEASE_LEASE_MS` (60 s); checked at module load and by a test. Before sending, if the clock is already past `leaseUntil − WORST_CASE_SEND_MS`, the batch is skipped (`lease_short` in the log) and left `pending`; the lease runs out and the next sweep takes it.
- **Retries:** only `FeedError` kind `unavailable` (5xx, timeout, network), 3 attempts, 1 s then 4 s. A 401 or 400 is not retried and the row stays `pending`.
- **Ack order (one transaction per batch):** timelines `FOR SHARE` (sorted) → assessments `FOR UPDATE` (sorted) → conditional settle (`id = ? AND status = 'pending'`) → membership end (`qaed` → `endAsReleasedQaed`; `not_qaed` → `endAsReturned`, round 1 only) → audit row. Reporting's `released` and `not_in_qa` settle as `sent`; any other reason settles as `refused` (reason trimmed to 32); an unanswered item stays `pending`.
- **Refused is final.** `/retry` picks `pending` rows only. A refused row is listed, never resent, and its membership stays active.
- `/retry` runs at most 3 batches (`RETRY_ROUNDS`); an automatic dispatch at most 50. `stillPending` counts only claimed rows. The list is capped at 500 with no truncation flag; a leased row counts as `pending`.

## Rules

- **Time only through `ADMIN_CONFIG_CLOCK`**, read once per request, judged in Rome minutes.
- **A write is checked with the caller's role row, not just `canReview`.** ADMIN holds every permission (P-35) and never writes through this module (`ASSESSMENT_READ_ONLY`).
- **Out of scope looks like missing:** the same 404 body. The bodies are byte-equal but not time-equal; this is accepted.
- **The status is computed on read, never stored.** Change the table in `qa-status.ts` only.
- **The database carries the invariants:** one assessment per membership and step, one release per assessment, one quick comment per role and text hash. A lost race is a typed 409 or a no-op, never a duplicate row.
- **Idempotency retention.** `idempotency_keys.response_body` keeps the comment body, the value copy and the author's nickname until the key's retention purge. A withdraw does not clear it. Do not add data to a keyed answer that the purge window should not hold.
- **Typed errors from the catalog.** A new `ASSESSMENT_*` code goes in `common/error-codes.ts` and in `front-contract.md` (section 9). A code in `assessment.errors.ts` missing from the contract is a review failure: `grep -o "ASSESSMENT_[A-Z_]*" assessment.errors.ts | sort -u` must equal the same extraction from the contract.
- **Comment replay differs by path.** A completed key replays the stored first answer (the comment as it was, `open`). The crash window (committed, answer not stored) replays through `replayComment`, which re-reads the comment now, so after a withdraw it shows `withdrawn`. `created_at` and `withdrawn_at` are cut to whole seconds so a replay equals the 201.
- **`ASSESSMENT_CORE_UNCOMMENTED` carries `fields` as a `string[]` of field keys**; the filter forwards it for that code only.

## Logging (FR-22, NFR-5)

- One `event: 'assessment'` JSON line per write request, success or refusal, written by a service-level wrapper (`loggedWrite`), not an interceptor: `action` (`validate`, `comment`, `withdraw`, `finish`, `quick_comment_save`), `timelineId`, `membershipId`, `outcome` (`ok`, `refused`, `error`), `reason?` (the error code, `http_<status>`, or `internal_error` for a non-HTTP failure), `requestId`, `actorId`.
- `event: 'assessment_release'` lines come from the dispatcher: ids, counts and fixed words (`claim_failed`, `lease_short`, `send_failed`, `unanswered`, `ack_failed`, and the ack decisions).
- A refusal raised before the service runs (the validation pipe, a guard, the idempotency interceptor) never reaches `loggedWrite` and writes no `assessment` line.
- **No title, value, label, comment body, nickname, name or email in any line.** `assessment-log.ts` has no way to receive one.
- **No `assessment` line on an idempotent replay** (the interceptor answers it) **and none on `POST /assessment-releases/retry`** (the dispatcher writes its own lines). Accepted gap: an admin retry is not tied to its caller in the logs.

## Testing

- Pure rules and services over in-memory stores: the `*.spec.ts` files beside the code (`qa-status`, `scope`, `role-steps`, `assessment-rules`, `comment-transitions`, `assessment-view`, the three service specs, `release.service.spec.ts`, `assessment.unit-of-work.deadlock.spec.ts`).
- HTTP suites in `server/test/assessment-*.e2e-spec.ts` and `quick-comments.e2e-spec.ts`, over the world in `server/test/support/in-memory-assessment.ts` built by `assessment-app.ts`. See `server/test/AGENTS.md`.
- **Never hand-build a `SNAP#…` key.** `snapshot_sk` is written by the loader; use `real-load-writer.ts` (`runRealLoad`), which runs a real `LoadRunner` over the in-memory loads world. A literal key without the prefix is the blindness that suite closes.
- Every builder that loads `AppModule` and calls `init()` wraps the builder in `withoutTitleBackfill` (the backfill would otherwise reach for a database the e2e apps do not have).
- The HTTP concurrency suites use the fake's `holdLockUntil` barrier, so only the conditional UPDATEs decide there. **Real row-lock order, `SKIP LOCKED`, `buildDueYears` under `ONLY_FULL_GROUP_BY` and the clock read after a pool wait are checks against real MySQL** (the API HITL, T-16).
