# src/admin-config — Agent Guide

Cycles and QA timelines: the admin API that says *when* QA runs, *for which* Science Programs and result types, and *who* works in each timeline. Spec: `docs/specs/admin-config/cycle-timelines/` (`design.md`, DD-1…DD-10). What the front may rely on: `front-contract.md` in the same folder. Root and `server/AGENTS.md` rules apply.

## Model in one line

`cycles` → `timelines` (one official + any number of additional per cycle) → `timeline_steps` (1-5, one per audience), plus scope rows (`timeline_programs`, `timeline_result_types`) and assignments (`timeline_users`). This replaces the old `cycles → windows → batches` text of the TRD (DD-1); there is no window and no batch here.

## Files

| Path | Role |
|---|---|
| `admin-config.module.ts` | Imports `CyclesModule` and `TimelinesModule` (two modules, so each binds its own idempotency replay reader, DD-4) |
| `admin-config.clock.ts` | `ADMIN_CONFIG_CLOCK` (`() => Date`): the **only** time source of the services (NFR-4). e2e suites override it to pin "today in Rome" |
| `admin-config.context.ts` | `AdminConfigContext` (`actorId`, `requestId`, optional idempotency reservation) and `AdminConfigAction` (the five logged writes) |
| `admin-config.errors.ts` | Typed refusals: 404 `CycleNotFoundError`, `TimelineNotFoundError`, `TimelineAssignmentNotFoundError`; 409 `CycleYearTakenError`, `CycleNotDraftError`, `CycleClosedError`, `TimelineNameTakenError`, `TimelineUserNotEligibleError`; 400 `TimelineValidationError(issues)` (every rule problem in one `VALIDATION_FAILED`); 503 `CycleActivationBusyError` (activation refused on every retry, retryable) |
| `rome-date.ts` | Pure: today's date in `Europe/Rome` from an instant, calendar-date validation, compare, add days. `Intl` only, no date library |
| `cycles/` | `CyclesController` (3 routes), `CyclesService`, `cycles.store.ts` (port + Drizzle adapter), `cycles.unit-of-work.ts`, `cycle-view.ts`, `dto/`, `models/` (OpenAPI) |
| `timelines/` | `TimelinesController` (6 routes), `TimelinesService`, `timelines.store.ts`, `timelines.unit-of-work.ts`, `timeline-rules.ts` (create validation), `timeline-view.ts` (status, current step, readiness), `default-steps.ts`, `timeline-response.ts`, `dto/`, `models/` |

## Rules

- **ADMIN only (FR-16).** Both controllers carry `@RequirePermission(Permission.ADMIN_ACCESS)` at class level; a new route inherits it. Adding a route without it is a review failure.
- **Dates are Rome calendar days, never instants.** `opens_on` / `closes_on` are `date` columns in string mode (DD-5) and travel as `YYYY-MM-DD`. A step is open from 00:00 of `opensOn` to 23:59:59 of `closesOn`, Rome time (S-1). Do not build a `Date` from a step date; use `rome-date.ts`.
- **Time only through `ADMIN_CONFIG_CLOCK`.** Never `new Date()` or `Date.now()` in a service or rule.
- **Status is computed on read, never stored** (DD-2): `scheduled`, `live`, `finished`, `currentStep`, `nextStep` and `readiness` come from `timeline-view.ts`. No job and no column flips a timeline.
- **Every rule problem in one 400 (FR-11).** The pipe checks shape only (types, unknown fields, max lengths). The scope lists and the step dates are optional at the pipe on purpose, so an absent one reaches `timeline-rules.ts` and is reported `REQUIRED` next to the other problems. Do not tighten those DTO fields: it splits the answer into two rounds. Field paths are the request keys (`name`, `programIds`, `resultTypeKeys`, `steps[i].<key>`).
- **Explicit "all" (DD-6).** `allPrograms` / `allResultTypes` are flags; an empty or absent list never means "all". Flag false needs at least one id; flag true needs none (a non-empty list with the flag true is `INVALID`). Catalogs are read (through `CatalogService` from `UsersModule`) only for explicit lists, so an "all" create works while CLARISA or Reporting is down; an unreachable catalog is 503 `SERVICE_UNAVAILABLE`.
- **Kind is the server's call (DD-3).** `kind` is not in the body (an unknown field is 400). Official vs additional is decided under `FOR UPDATE` on the cycle row; `uq_timelines_official_key` is only the backstop.
- **Lock order (DD-9):** cycle row → timeline → assignment rows for writes; readers never lock. Create/assign/remove lock the cycle (`FOR UPDATE` to create, `FOR SHARE` to assign or remove). Activation locks the target `FOR UPDATE`, then the active row `FOR UPDATE`, closes it, then activates the target.
- **Activation retry (design 7.3 as amended 2026-10-21).** With no active cycle there is no row to lock, so concurrent activations race on `uq_cycles_active_key`: a loser gets MySQL 1062 on that key (named in the driver message) or 1213 deadlock, rolls back fully and starts over, up to 10 attempts in total (`ACTIVATION_ATTEMPTS = 10` in `cycles.service.ts`; one retry was not enough on TEST with 5 concurrent activations). A retry closes the winner's cycle (different target) or answers 409 `CYCLES_NOT_DRAFT` (same target). If every attempt is refused it answers 503 `SERVICE_UNAVAILABLE` (`CycleActivationBusyError`, retryable, nothing committed), never 500. A 1062 on another key or any other error is not retried. One decision line per request, whatever the attempts. Never two active cycles; never a reader that sees none while one exists.
- **Assignments (FR-14, FR-15).** Only ASSESSOR, LEAD_ASSESSOR, TPB, PPU are assignable (a pipe check). The user must be active and hold a **live** grant of that role (`isLiveAssignment`, the same condition as `src/users/AGENTS.md`), else 409 `TIMELINES_USER_NOT_ELIGIBLE`. A repeat assign hits `uq_timeline_users_active_key` and answers the existing row with 200, not 409 (DD-10). Remove keeps the row (`removed_at` / `removed_by`); re-assigning later makes a new row. A revoked grant does **not** delete assignments: the visibility rule (P2-3909) re-checks the live grant, so a stale row grants nothing.
- **Closed cycle:** timelines and assignments cannot be written in a `closed` cycle (409 `CYCLES_CLOSED`). Reads work in any status.
- **No PII in logs (NFR-7).** One `event: 'admin_config'` line per write: `action` (`cycle_create`, `cycle_activate`, `timeline_create`, `timeline_user_assign`, `timeline_user_remove`), `targetId`, `actorId`, `outcome`, `reason?`, `requestId`, `idempotency`. Never a name, email or body. A user's email appears only in the `TimelineDetail` response, which is ADMIN-only; do not copy `TimelineUserResponse` into another endpoint (FR-12 of *user-management*: other endpoints use `toPublicUser`).
- **Reads cost a fixed number of queries (NFR-5):** the timeline list runs six queries whatever the number of timelines (cycle, timelines, then steps, programs, result types and assignment counts by the listed ids). Do not add a per-timeline query; the fake store counts calls and a test pins it.

## Idempotency

`POST /cycles` and `POST /cycles/:id/timelines` are `@Idempotent()` (FR-17). The mechanism is `src/common/idempotency/` unchanged; each module binds `IDEMPOTENCY_STORE`, `IDEMPOTENCY_CLOCK` and its own `IDEMPOTENCY_REPLAY_READER`. The stored target id sits in the column named `idempotency_keys.target_user_id` (a historical name; no foreign key): it holds a **cycle id** for `POST /cycles` and a **timeline id** for `POST /cycles/:id/timelines`. Each replay reader knows which one it has and re-reads the cycle or the timeline. Assign, remove and activate take no key: they are naturally repeat-safe (assign answers 200 for an existing row; activate answers 409 for an already active cycle; remove answers 404 the second time).

## Reserved tables (NFR-6)

`timeline_loads` and `timeline_results` are **not created** by migration `0003`. They are reserved for the load stories (P2-3905, P2-3906): `timeline_loads` hangs from `timeline_id` + `timeline_step_id`, `timeline_results` from `timeline_id` + `result_id` + `load_id`. Nothing in the six tables needs to change for them. Readiness already lists `NO_RESULTS_LOADED` for every timeline until they exist; later work adds items without changing the existing ones. The visibility predicate for assessors (P2-3909), editing steps (P2-3904) and the result filter are **not built** here.

## Testing

- Pure rules: `rome-date.spec.ts`, `timelines/default-steps.spec.ts`, `timeline-rules.spec.ts`, `timeline-view.spec.ts` (midnight boundaries and both daylight-saving changes).
- Services and units of work over in-memory stores: `cycles.service.spec.ts`, `cycles.unit-of-work.spec.ts`, `timelines.service.spec.ts`, `timelines.unit-of-work.spec.ts`.
- HTTP: `test/admin-config-cycles.e2e-spec.ts`, `test/admin-config-timelines.e2e-spec.ts` (routes, envelopes, guards, idempotency replay, OpenAPI).
- Schema guarantees (unique keys, CHECKs, generated columns) are asserted over the generated SQL in `src/database/drizzle/schema/schema.spec.ts`; there is no disposable MySQL (the shared `qadb` is never reset).
