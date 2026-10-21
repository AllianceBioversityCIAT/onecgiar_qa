# Cycles and QA timelines — Design

## 1. Document Control

| | |
|---|---|
| Spec path | `docs/specs/admin-config/cycle-timelines` |
| Requirements | `requirements.md` (FR-1…FR-17, NFR-1…NFR-7, S-1…S-7) |
| Depth | Full |
| Approval Mode | gated |
| Status | Approved (back lead, 2026-10-20) |
| Exploration | Scout pass over `server/` (13 questions) + direct checks, all at `443a618` |
| Last updated | 2026-10-20 |

## 2. Executive Summary

A new `server/src/admin-config/` folder holds two Nest modules, **Cycles** and **Timelines**, behind one `AdminConfigModule`. They follow the users module's shape: ports with Drizzle adapters, a unit of work per write, typed errors from the shared catalog, and per-route idempotency. Migration `0003` adds six tables. Every rule that must survive concurrency is a database key: one active cycle, one official timeline per cycle, unique names, no duplicate active assignment. Step dates are calendar dates. Status, current step and readiness are computed on read from one injectable clock in `Europe/Rome`, so no job opens or closes anything. The TRD's windows/batches model is replaced by this one (DD-1).

## 3. Architecture Overview

```
                  ┌──────────── AdminConfigModule (server/src/admin-config/) ────────────┐
 ADMIN ──HTTPS──▶ │ CyclesModule                         TimelinesModule                  │
 (global guards:  │  CyclesController  /cycles            TimelinesController             │
  Auth → Permission)│  CyclesService                         /cycles/:id/timelines          │
                  │  CyclesUnitOfWork ─┐                   /timelines/:id[/users]         │
                  │  replay reader:    │                   /timeline-defaults             │
                  │   cycle summary    │                  TimelinesService (rules, read)  │
                  │                    │                  TimelinesUnitOfWork ─┐          │
                  │                    │                  replay reader: timeline         │
                  └────────────────────┼───────────────────────────────────────┼──────────┘
                                       ▼                                       ▼
                         MySQL (Drizzle): cycles · timelines · timeline_steps · timeline_programs
                                          timeline_result_types · timeline_users · idempotency_keys
                  UsersModule exports used read-only: CatalogService (SP ids, result type keys),
                  UsersRepository (user by id), RoleAssignmentsRepository (live grants)
```

Legend: boxes = Nest modules inside the API container (TRD § 2.2); arrows = calls; the cylinders of TRD § 2.2 are the MySQL tables listed. No DynamoDB, no Reporting call (the catalogs are served cached by `CatalogService`).

**Why two Nest modules (DD-4).** The idempotency interceptor resolves one `IDEMPOTENCY_REPLAY_READER` from the module of the controller (P-1). A replay of a cycle create must return a cycle, and a replay of a timeline create must return a timeline. With two modules, each binds its own reader, and `common/idempotency` stays untouched.

## 4. Extended Directory Structure

```
server/
├── drizzle/0003_cycle_timelines.sql                 # generated (drizzle-kit), additive only
├── src/
│   ├── app.module.ts                                # + AdminConfigModule
│   ├── common/error-codes.ts                        # + CYCLES_*, TIMELINES_* codes; + field codes (DD-8)
│   ├── database/
│   │   ├── AGENTS.md                                # + schema guarantees of the six tables
│   │   └── drizzle/schema/
│   │       ├── cycles.ts · timelines.ts · timeline-steps.ts
│   │       ├── timeline-programs.ts · timeline-result-types.ts · timeline-users.ts
│   │       ├── index.ts                             # + six re-exports
│   │       └── schema.spec.ts                       # + DDL pins, migration count 3 → 4
│   └── admin-config/
│       ├── AGENTS.md
│       ├── admin-config.module.ts                   # imports CyclesModule, TimelinesModule
│       ├── admin-config.errors.ts                   # typed errors + TimelineValidationError
│       ├── rome-date.ts                             # today-in-Rome, date-string helpers (pure)
│       ├── admin-config.clock.ts                    # ADMIN_CONFIG_CLOCK token
│       ├── cycles/
│       │   ├── cycles.module.ts · cycles.controller.ts · cycles.service.ts
│       │   ├── cycles.store.ts (port + Drizzle adapter) · cycles.unit-of-work.ts
│       │   └── dto/ · models/                       # request DTOs, OpenAPI response classes
│       └── timelines/
│           ├── timelines.module.ts · timelines.controller.ts · timelines.service.ts
│           ├── default-steps.ts                     # FR-4 table (pure)
│           ├── timeline-rules.ts                    # all create rules → list of field issues (pure)
│           ├── timeline-view.ts                     # status, current step, readiness (pure)
│           ├── timelines.store.ts (port + Drizzle adapter) · timelines.unit-of-work.ts
│           └── dto/ · models/
└── test/
    ├── support/in-memory-admin-config.ts            # fakes: stores, unit of work, duplicate-key emulation
    ├── support/admin-config-app.ts                  # app boot with fakes (pattern of users-admin-app.ts)
    ├── admin-config-cycles.e2e-spec.ts
    └── admin-config-timelines.e2e-spec.ts
docs/trd/trd.md                                      # § 4, § 5.1, § 6 (DD-1)
docs/specs/admin-config/cycle-timelines/front-contract.md   # for P2-3934
```

## 5. Data Model

Migration `0003_cycle_timelines` creates six tables and changes none (the "additive only" rule of `schema.spec.ts`, P-6). Names follow `server/drizzle`: plural snake_case, `<parent>_<children>`, `uq_` / `chk_` / `idx_`, generated `*_key` columns for partial uniqueness, `int unsigned` ids, `created_at` / `created_by` audit columns referencing `users`.

### `cycles`

| Column | Type | Notes |
|---|---|---|
| `id` | int unsigned AI PK | |
| `year` | smallint unsigned NOT NULL | `uq_cycles_year`; `chk_cycles_year` 2020–2100 (FR-1) |
| `status` | enum `draft` · `active` · `closed`, default `draft` | |
| `active_key` | tinyint, generated stored: 1 when `active`, else NULL | `uq_cycles_active_key` → at most one active cycle (FR-3, NFR-3) |
| `created_at`, `created_by` | datetime default now; int unsigned FK `users` | |
| `activated_at`, `activated_by`, `closed_at`, `closed_by` | nullable | `chk_cycles_lifecycle`: `draft` ⇒ none set; `active` ⇒ activated set, closed not; `closed` ⇒ closed set |

### `timelines`

| Column | Type | Notes |
|---|---|---|
| `id` | int unsigned AI PK | |
| `cycle_id` | int unsigned NOT NULL FK `cycles` | `idx_timelines_cycle` |
| `name` | varchar(120) NOT NULL, case-insensitive collation | `uq_timelines_cycle_name` (`cycle_id`, `name`) — FR-6 (same collation approach as `users.nickname`, P-7) |
| `kind` | enum `official` · `additional` | Set by the service (DD-3) |
| `official_key` | int unsigned, generated stored: `cycle_id` when `official`, else NULL | `uq_timelines_official_key` → one official per cycle |
| `all_programs`, `all_result_types` | boolean NOT NULL | Explicit "all" (DD-6) |
| `created_at`, `created_by` | | |

### `timeline_programs` · `timeline_result_types`

| Table | Columns | Keys |
|---|---|---|
| `timeline_programs` | `timeline_id` FK, `program_id` int unsigned (CLARISA id, as `user_programs`) | PK (`timeline_id`, `program_id`) |
| `timeline_result_types` | `timeline_id` FK, `result_type_key` varchar(64) (as `role_assignments`) | PK (`timeline_id`, `result_type_key`) |

Rows exist only when the matching `all_*` flag is false. The service enforces "flag false ⇒ at least one row, flag true ⇒ none" in the same transaction. A CHECK cannot span tables, so the fakes and a unit test pin this rule.

### `timeline_steps`

| Column | Type | Notes |
|---|---|---|
| `id` | int unsigned AI PK | |
| `timeline_id` | FK `timelines` | `uq_timeline_steps_position` (`timeline_id`, `position`); `uq_timeline_steps_audience` (`timeline_id`, `audience`) |
| `position` | tinyint unsigned | `chk_timeline_steps_position` 1–5 |
| `name` | varchar(120) NOT NULL | |
| `audience` | enum `assessors` · `programs` · `lead_assessors` · `tpb` · `ppu` | S-2, D-3 |
| `opens_on`, `closes_on` | `date`, read and written as `YYYY-MM-DD` strings (DD-5) | `chk_timeline_steps_dates`: `closes_on >= opens_on` |
| `round` | tinyint unsigned | `chk_timeline_steps_round` ≥ 1 |
| `requires_load` | boolean NOT NULL | `chk_timeline_steps_first_load`: `position <> 1 OR requires_load` (FR-9) |

Cross-step rules are checked by `timeline-rules.ts` before the insert: order, no overlap, contiguous rounds, audience order. They span rows, so a CHECK cannot express them, and the steps are written once at create time (editing is P2-3904).

### `timeline_users`

| Column | Type | Notes |
|---|---|---|
| `id` | int unsigned AI PK | |
| `timeline_id` | FK `timelines` | `idx_timeline_users_timeline` |
| `user_id` | FK `users` | |
| `role_id` | smallint unsigned FK `roles` | Only ASSESSOR, LEAD_ASSESSOR, TPB, PPU (service, FR-14) |
| `assigned_at`, `assigned_by` | | |
| `removed_at`, `removed_by` | nullable | `chk_timeline_users_removed`: both set or both NULL |
| `active_key` | varchar(64), generated stored: `timeline:user:role` while not removed, else NULL | `uq_timeline_users_active_key` (FR-14 "never a second active row", FR-15 re-assign allowed) |

### Reserved for P2-3905 / P2-3906 (not created here)

`timeline_loads` (`timeline_id`, `timeline_step_id`, status, counts, `requested_by`) and `timeline_results` (`timeline_id`, `result_id`, `load_id`). Nothing in `0003` needs to change for them (NFR-6). D-2 and D-6 are load-time rules over these tables.

## 6. API Design

All routes are under `/api/v1`. The class-level guard is `@RequirePermission(Permission.ADMIN_ACCESS)` (FR-16, P-2). Errors use the envelope and the catalog (TRD § 6). `ACCESS` = 401 `AUTH_TOKEN_INVALID` / `AUTH_USER_NOT_ADMITTED`, 403 `AUTH_PERMISSION_DENIED`.

| Method | Path | Request | Response | Errors (besides `ACCESS`) |
|---|---|---|---|---|
| POST | `/cycles` 🔑 | `{ year }` | 201 `Cycle` | 400 `VALIDATION_FAILED`; 409 `CYCLES_YEAR_TAKEN` |
| GET | `/cycles` | — | 200 `Cycle[]` (year desc) | — |
| POST | `/cycles/:id/activate` | — | 200 `Cycle` | 404 `CYCLES_NOT_FOUND`; 409 `CYCLES_NOT_DRAFT` |
| GET | `/timeline-defaults` | — | 200 `DefaultStep[]` (FR-4) | — |
| POST | `/cycles/:id/timelines` 🔑 | `TimelineCreate` | 201 `Timeline` | 400 `VALIDATION_FAILED`; 404 `CYCLES_NOT_FOUND`; 409 `CYCLES_CLOSED`, `TIMELINES_NAME_TAKEN`; 503 `SERVICE_UNAVAILABLE` |
| GET | `/cycles/:id/timelines` | — | 200 `Timeline[]` (official first, then newest) | 404 `CYCLES_NOT_FOUND` |
| GET | `/timelines/:id` | — | 200 `TimelineDetail` | 404 `TIMELINES_NOT_FOUND` |
| POST | `/timelines/:id/users` | `{ userId, role }` | 201 new · 200 already assigned — `TimelineUser` | 400; 404 `TIMELINES_NOT_FOUND`, `USERS_NOT_FOUND`; 409 `CYCLES_CLOSED`, `TIMELINES_USER_NOT_ELIGIBLE` |
| DELETE | `/timelines/:id/users/:assignmentId` | — | 204 | 404 `TIMELINES_NOT_FOUND`, `TIMELINES_ASSIGNMENT_NOT_FOUND`; 409 `CYCLES_CLOSED` |

🔑 = `@Idempotent()`: an optional `Idempotency-Key`; replays are marked by the `Idempotency-Replayed` header, and 409 `IDEMPOTENCY_IN_PROGRESS` / 422 `IDEMPOTENCY_KEY_REUSED` are possible (FR-17, *write-safety*).

**Shapes** (response classes for OpenAPI; dates are `YYYY-MM-DD` Rome dates, instants are ISO UTC):

| Shape | Fields |
|---|---|
| `Cycle` | `id`, `year`, `name` ("2026 cycle"), `status`, `timelineCount`, `startsOn` / `endsOn` (min opening / max closing over its steps, or null), `createdAt` |
| `DefaultStep` | `position`, `name`, `audience`, `round`, `requiresLoad` |
| `TimelineCreate` | `name`; `allPrograms` + `programIds[]` (optional at the pipe, § 7.2); `allResultTypes` + `resultTypeKeys[]` (optional at the pipe, § 7.2); `steps[]` of `{ name, audience, opensOn, closesOn, round, requiresLoad }`. Unknown fields → 400, so `kind` is refused (FR-5) |
| `Timeline` | `id`, `cycleId`, `name`, `kind`, `allPrograms`, `programIds`, `allResultTypes`, `resultTypeKeys`, `steps[]` (as created, plus `position`), `status` (`scheduled` · `live` · `finished`), `currentStep` (position or null), `nextStep` (position or null), `readiness[]`, `assignedCount` per role, `createdAt` |
| `TimelineDetail` | `Timeline` + `users[]` of `TimelineUser` |
| `TimelineUser` | `assignmentId`, `userId`, `firstName`, `lastName`, `email`, `role`, `assignedAt` |

`programIds` holds CLARISA ids, as `user_programs` does, and the response adds no program names; the front already has the catalog from `/catalogs` (P-8). The detail returns user names because the admin screen needs them. Only ADMINs can read it.

## 7. Backend Module Design

### 7.1 Pure rules (no I/O, fully unit-tested)

| File | Responsibility | Requirements |
|---|---|---|
| `rome-date.ts` | Today's date in `Europe/Rome` from an instant; validate a `YYYY-MM-DD` string as a real calendar date; compare and add days to date strings. Uses `Intl.DateTimeFormat` with `timeZone: 'Europe/Rome'` (P-5). No library | FR-8, FR-12, NFR-4 |
| `default-steps.ts` | The FR-4 table | FR-4 |
| `timeline-rules.ts` | Given a create request (shape already valid), today's Rome date and the two catalogs, returns **every** issue as `{ field, code }`: name present and ≤ 120; `allPrograms` xor non-empty `programIds`, each id in the catalog; same for result types; steps 1–5; audience in the enum, unique, in workflow order; dates real; `closesOn ≥ opensOn`; each `opensOn` after the previous `closesOn`; step 1 `opensOn ≥ today`; first step `requiresLoad`; rounds start at 1 and step by 0 or +1 | FR-6…FR-11 |
| `timeline-view.ts` | From steps, assignments and today's Rome date: `status`, `currentStep`, `nextStep`, `readiness` (FR-13 table; audience → role: `assessors` → ASSESSOR, `lead_assessors` → LEAD_ASSESSOR, `tpb` → TPB, `ppu` → PPU, `programs` → none) | FR-12, FR-13 |

### 7.2 Validation flow (FR-11)

1. The global `ValidationPipe` checks the shape: types, required keys, max lengths, unknown fields. A shape error returns 400 at once, as everywhere else (P-3). Shape problems and rule problems therefore come back in two rounds at most. One round is guaranteed for every **rule** problem, which covers everything AC 11 lists. The scope lists (`programIds`, `resultTypeKeys`) and step dates are optional at the pipe, so a list that is absent reaches the rules and is reported as `REQUIRED` in the same round as the other rule problems (FR-6 "missing", FR-11).
2. The service reads each catalog an explicit list needs (none when the request says "all" or the list is empty). A failure becomes 503 `SERVICE_UNAVAILABLE` (P-8). It then runs `timeline-rules.ts`. With one or more issues it throws `TimelineValidationError(issues)`: 400 `VALIDATION_FAILED` with `fields[]`, built the same way as users' `FieldValidationError` (P-4, DD-7).
3. Only then does the transaction open.

### 7.3 Writes and concurrency

Every write runs in its module's unit of work. The pattern is `DrizzleUsersAdminUnitOfWork`: READ COMMITTED, tx-bound stores, the tx-bound idempotency store whose `markExecuted` commits with the change (P-1).

| Operation | Inside one transaction | Race outcome (NFR-3) |
|---|---|---|
| Create cycle | Insert; on 1062 → `CYCLES_YEAR_TAKEN` | Duplicate year: one 201, one 409 |
| Activate cycle | Lock the target `FOR UPDATE` (missing → 404, not `draft` → 409); lock the current active row `FOR UPDATE`; set it `closed`; set the target `active` (in that order, so `uq_cycles_active_key` never fires while an active row exists). With no active cycle there is no row to lock: the second activation gets 1062 on `uq_cycles_active_key`, rolls back fully and retries once | Two activations serialize on the active row. The second sees the first's result and either closes it (a different target) or gets 409 (the same target, no longer `draft`). With none active, the retry gives the same outcome. Never two active, never none to a reader |
| Create timeline | Lock the cycle `FOR UPDATE` (missing → 404, `closed` → 409); read whether an official exists; insert with `official` or `additional`; insert scope rows and steps; 1062 on name → `TIMELINES_NAME_TAKEN`; 1062 on `official_key` (should not happen while locked) → retry once as `additional` | Creates in one cycle serialize on the cycle row: the first is official, the second additional — deterministic, never 409 |
| Assign user | Lock the timeline's cycle `FOR SHARE` (`closed` → 409); user by id (missing → `USERS_NOT_FOUND`, inactive → `TIMELINES_USER_NOT_ELIGIBLE`); live grants of the user (`findActiveViewsByUserId` + `isLiveAssignment`, P-9) contain the role, else `TIMELINES_USER_NOT_ELIGIBLE`; insert; on 1062 → read and return the existing active row (200) | Two identical assigns: one row, both answer it (FR-14) |
| Remove user | Lock the cycle `FOR SHARE`; set `removed_at` / `removed_by` where id matches and not removed; 0 rows → `TIMELINES_ASSIGNMENT_NOT_FOUND` | Two removes: one 204, one 404 |

A grant revoked at the same moment as an assignment can leave a row whose user lost the role. This is accepted: the visibility predicate (P2-3909) checks the live grant again, so such a row grants nothing (S-7).

### 7.4 Reads (NFR-5)

- The cycle list is one grouped query over `cycles` left-joined with `timelines` and `timeline_steps` (count, min, max).
- The timeline list runs six queries for a cycle: the cycle exists (FR-12 404), the timelines by `cycle_id`, then steps, programs, result types, and active assignment counts per role, each by the listed timeline ids. They are assembled in memory and passed to `timeline-view.ts`.
- The detail runs the same queries for one id, plus the active assignments joined with `users`.
- The query count does not depend on the number of timelines. The fake store counts calls, so a test pins this.

### 7.5 Errors (catalog additions, DD-8)

| Code | Status | Raised when |
|---|---|---|
| `CYCLES_NOT_FOUND` | 404 | Unknown cycle id |
| `CYCLES_YEAR_TAKEN` | 409 | Duplicate year |
| `CYCLES_NOT_DRAFT` | 409 | Activate a non-draft cycle |
| `CYCLES_CLOSED` | 409 | Write a timeline or an assignment in a closed cycle |
| `TIMELINES_NOT_FOUND` | 404 | Unknown timeline id |
| `TIMELINES_NAME_TAKEN` | 409 | Duplicate name in the cycle |
| `TIMELINES_USER_NOT_ELIGIBLE` | 409 | User inactive or without a live grant of the role |
| `TIMELINES_ASSIGNMENT_NOT_FOUND` | 404 | No active assignment with that id in the timeline |

New **field** codes in `FIELD_ERRORS`: `OUT_OF_RANGE` (year, step count), `CLOSES_BEFORE_OPENS`, `OVERLAPS_PREVIOUS_STEP`, `BEFORE_TODAY`, `AUDIENCE_ORDER` (duplicate or out of order), `ROUND_SEQUENCE`, `FIRST_STEP_LOAD`. An unknown catalog id reuses `INVALID`, as users does (P-8). Each error class joins the hand-listed array of `error-codes.spec.ts` (P-4).

### 7.6 Logging (NFR-7)

The services log one decision line per write, shaped like users' `logged()`: `{ event: 'admin_config', action, targetId, actorId, outcome, reason?, requestId, idempotency }`. `action` is one of `cycle_create`, `cycle_activate`, `timeline_create`, `timeline_user_assign`, `timeline_user_remove`. No names, emails or bodies are logged.

### 7.7 Clock

`ADMIN_CONFIG_CLOCK` (`() => Date`) is bound to `() => new Date()`. Services read the time **only** through it (NFR-4); the e2e suites override it, as the idempotency suite overrides its own clock (P-10). The tx-bound idempotency store keeps using `IDEMPOTENCY_CLOCK`.

## 8. Frontend / UX Component Architecture

No front change in this spec (P2-3934). `front-contract.md` gives the front lead:

- the routes and shapes of § 6;
- the rules the server now owns: max 5 steps, step 1 load, explicit rounds, explicit "all" for every timeline (D-7), no step silently dropped for a missing or malformed date, no back-dated start;
- the **timezone note (D-1)**: every displayed or picked step date is a Central European date (`Europe/Rome`, CET/CEST) and must be labeled as such, e.g. "Opens 06 Jul 2026, 00:00 CET (Rome)";
- the field codes and their meaning;
- what is not built yet (loads, edit, visibility, filter).

## 9. Shared Contracts or Package Extensions

- `server/src/common/error-codes.ts`: eight codes and seven field codes are added. The front's `api-envelope.ts:29` comment lists the field codes (P-11) and is updated through the contract note, not in this spec.
- The idempotency mechanism is reused unchanged. The stored target id is a cycle or timeline id in the column named `target_user_id` (P-1). It has no foreign key, and the replay reader of each module knows what the id means. This is recorded in `common/AGENTS.md`.
- No new environment variables. No new dependencies.

## 10. Design Decisions

| ID | Decision | Alternatives rejected | Consequence | Requirements |
|---|---|---|---|---|
| DD-1 | **Supersedes the TRD § 5.1 `cycles → windows → batches` model** with `cycles → timelines → timeline_steps` (loads reserved under a step). `windows` and window-level `batches` are dropped from the TRD; TRD § 4 `admin-config` and § 6 resource map are updated | Keep windows and map timeline = window (no scope; proposal option B); batch = timeline 1:1 (proposal option C) | TRD edited as a named deliverable (proposal R-1) | All |
| DD-2 | Step dates are `date` columns read as strings; "open" is computed on read from today's Rome date (S-1) | Store instants; a scheduler that flips a status | No job, no stored status to drift; DST handled by `Intl` | FR-8, FR-12, NFR-4 |
| DD-3 | The official/additional kind is decided under a `FOR UPDATE` lock on the cycle row; the generated `official_key` unique index is the backstop | Unique index alone (the second create would 409 instead of becoming additional); application check alone (races) | Deterministic first-wins; per-cycle create serialization (negligible volume) | FR-5, NFR-3 |
| DD-4 | Two Nest modules (Cycles, Timelines) under one folder, so each binds its own idempotency replay reader | Generalize the reader port in `common/` (shared change, re-review of users idempotency); drop idempotency (front replays would see 409 on a create that succeeded) | Zero change to `common/idempotency`; a misnamed column is reused (§ 9) | FR-17 |
| DD-5 | Drizzle `date` columns in string mode | Default `Date` mode (mysql2 builds a `Date` in the server's local zone — a 2 Nov date can shift a day with a non-UTC server, P-12) | Dates never pass through a timezone | FR-8, NFR-4 |
| DD-6 | Explicit `all_programs` / `all_result_types` flags | "No rows = all", as `user_programs` does | An empty list can never silently mean "all" (FR-6 BUT clause); a stored row set is unambiguous on read | FR-6 |
| DD-7 | Admin-config owns `TimelineValidationError`, built like users' `FieldValidationError` | Move `FieldValidationError` to `common/` (touches the users module and its tests) | One small duplicate class; a later cleanup can merge them | FR-11 |
| DD-8 | Seven new field codes instead of reusing `INVALID` for every rule | `INVALID` everywhere — the admin learns *which* field but not *what* is wrong (AC 11 "which information is missing") | The front can show a precise message; the field-code enum in OpenAPI grows | FR-8…FR-11 |
| DD-9 | The unit of work lock order is cycle → timeline → assignment rows (writes), and readers never lock | Ad hoc order per operation | No deadlock between activate, create and assign | NFR-3 |
| DD-10 | A 1062 on `uq_timeline_users_active_key` returns the existing row with 200, not 409 | 409 on a repeat assign | Assign is naturally idempotent without a key (FR-14) | FR-14 |

**Reversion challenge (Step 2.3):** no decision removes, disables or inverts shipped behavior. DD-1 replaces TRD text that no code implements (P-13), so the challenge does not apply.

**Budget (tripwire for `/akili-execute`):**

| Expected tasks | Expected LOC | Expected review rounds |
|---|---|---|
| 10 (9 build + 1 HITL) | ~2,600 (≈ 1,100 source, ≈ 1,300 tests and fakes, ≈ 200 docs) | 14 |

This sits at the top of Full depth. A two-PR split is recommended at `tasks.md`.

## 11. Premise Ledger

Count: 13 verified · 1 UNVERIFIED (High: 0 · Low: 1)
Blast-radius triggers: `live-path` (new routes reached through the global Auth → Permission guards and the per-route idempotency interceptor), `shared-state` (`common/error-codes.ts` field-code set, the `idempotency_keys` table, `schema.spec.ts` migration count), `consumer` (field codes read by OpenAPI and the front's envelope type) — all three fired.

| # | Claim | Class | Citation (as run) | Verified at | If false | Settled by |
|---|---|---|---|---|---|---|
| P-1 | `@Idempotent()` is per route and resolves `IDEMPOTENCY_STORE`, `IDEMPOTENCY_CLOCK`, `IDEMPOTENCY_REPLAY_READER` from the controller's module; the reader receives only a numeric id (port named `targetUserId`, column `target_user_id`, no FK); `markExecuted` is tx-bound through the unit of work | live-path | `server/src/common/idempotency/idempotent.decorator.ts:9-17`; `idempotency.interceptor.ts:46,56-58,133-138,237-243`; `server/src/users/users.module.ts:92-106`; `server/src/users/users-admin.unit-of-work.ts:77-82,175,181`; `server/src/database/drizzle/schema/idempotency-keys.ts:55`; `grep -rn "APP_INTERCEPTOR" src` → no hits | `443a618` | DD-4 (two modules) unnecessary or insufficient — High | — |
| P-2 | Global guards run Auth then Permission; `@RequirePermission(Permission.ADMIN_ACCESS)` at class level gates every route | live-path | `server/src/app.module.ts:30-34`; `server/src/auth/guards/permission.guard.ts:57-62`; `server/src/users/users-admin.controller.ts:86-89` | `443a618` | FR-16 needs another guard — Low | — |
| P-3 | Shape validation is the global pipe: 400 `VALIDATION_FAILED` with `fields`; class-validator constraints map only to `UNKNOWN_FIELD`, `REQUIRED`, `INVALID_TYPE`, `INVALID_EMAIL`, `TOO_LONG` | live-path | `server/src/common/validation.ts:13-23,66-70`; `server/src/common/configure-app.ts:32-40` | `443a618` | § 7.2 order and the rule/shape split — Low | — |
| P-4 | A service can throw one 400 with several fields (`FieldValidationError(issues)`), field codes are the closed `FIELD_ERRORS` set, and `error-codes.spec.ts` hand-lists domain error classes | location | `server/src/users/users.errors.ts:152-175`; `server/src/common/error-codes.ts:275-287`; `server/src/common/error-codes.spec.ts:48-55,88-128` | `443a618` | DD-7 / DD-8 shape — Low | — |
| P-5 | No timezone handling or date library exists; Node's `Intl` resolves `Europe/Rome` across the 25 Oct 2026 DST change | existence | `grep -rnE "Intl\.\|timeZone\|Europe/\|date-fns\|luxon\|Temporal\|dayjs\|from 'moment'" src test package.json` → no hits; `node -e` with `Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome'})` on `2026-10-25T21:30Z` → `2026-10-25`, on `2026-10-25T23:30Z` → `2026-10-26` | `443a618` | `rome-date.ts` needs a library or a fixed offset table — High | — |
| P-6 | Only `datetime` columns exist; `schema.spec.ts` pins migration count (3), exact SQL per migration and an "additive only" check | existence | `grep -rnE "\b(date\|timestamp\|datetime)\(" src/database/drizzle/schema` → `datetime(` only; `server/src/database/drizzle/schema/schema.spec.ts:303-304,322-326,474-486` | `443a618` | T-1 scope of `schema.spec.ts` edits — Low | — |
| P-7 | Generated `active_key` + unique index + CHECK, `mysqlEnum` over an exported tuple, and one file per table re-exported by `index.ts` are the schema patterns | location | `server/src/database/drizzle/schema/role-assignments.ts:16-24,47-65`; `roles.ts:9-17`; `index.ts:1-9`; `server/src/database/AGENTS.md` (nickname case-insensitive collation) | `443a618` | § 5 table definitions — Low | — |
| P-8 | `CatalogService` (exported by `UsersModule`) lists result type keys and CLARISA program ids; users reports an unknown id as field code `INVALID`; an unreachable catalog is 503 `SERVICE_UNAVAILABLE` | location | `server/src/users/catalogs/catalog.service.ts:71-100`; `server/src/users/users-admin.service.ts:1194-1233`; `server/src/users/catalogs/catalogs.errors.ts:9-13`; `server/src/users/users.module.ts:108-114` | `443a618` | FR-6 catalog checks and the 503 path — Low | — |
| P-9 | No "user holds role R" method exists; `findActiveViewsByUserId` + exported `isLiveAssignment` answer it; `UsersRepository.findById` gives `isActive` | existence | `grep -rnE 'hasRole\|holdsRole\|hasActiveGrant\|holdsActive\|hasGrant' src` → no hits; `server/src/users/role-assignments.repository.ts:154-163`; `server/src/users/current-user.cache.ts:48` (`export function isLiveAssignment`); `server/src/users/users.repository.ts:129-131` | `443a618` | FR-14 eligibility needs a new users method — Low | — |
| P-10 | e2e suites boot `AppModule` and override store tokens with in-memory fakes that emulate unique keys and 1062; the idempotency suite overrides its clock | location | `server/test/support/users-admin-app.ts:85-107`; `server/test/support/in-memory-stores.ts:55-57,168-179,338-341`; `server/test/users-admin-idempotency.e2e-spec.ts:150-153` | `443a618` | Test strategy of T-3…T-6 — Low | — |
| P-11 | Outside `server/src`, the field codes are named only in a front doc comment and its test fixture | consumer | `git grep -n -E "TOO_LONG\|UNKNOWN_FIELD\|INVALID_EMAIL" -- client/src` → `client/src/app/core/http/api-envelope.ts:29` (comment), `api-envelope.spec.ts:45` (fixture); `git grep -n -E "FIELD_ERRORS\|FieldErrorCode" -- server/src server/test` → `api-response.ts:13,14,55,122,125`, `idempotency.interceptor.ts:23,24,95,159`, `validation.ts:5,13,49,58`, `users.errors.ts:8,9,96,110,154,171,186`, `common/AGENTS.md:10` | `443a618` | Front or OpenAPI breakage from new codes — Low | — |
| P-12 | mysql2 returns MySQL `DATE` as a JS `Date` in the process's local zone unless told otherwise; Drizzle's `date` column has a `string` mode | data-env | `node_modules/drizzle-orm/mysql-core/columns/date.d.ts:46` (`MySqlDateConfig<TMode extends 'date' \| 'string'>`); `server/src/database/drizzle/drizzle.module.ts:18-21` (pool sets no `timezone` / `dateStrings`); mysql2 local-zone parsing: UNVERIFIED — confirm at source before relying on it | `443a618` | DD-5 would be a preference, not a fix — Low | T-1 (reads mysql2's date parsing in `node_modules/mysql2` and records it) |
| P-13 | No code implements windows or batches; the TRD rows are the only trace | existence | `git grep -n -iE "windows\|batches\|window_id\|batch_id" -- server/src` → 1 hit, `server/src/database/AGENTS.md:24` ("purged in batches of 50" — idempotency purge, not a model); no code hit | `443a618` | DD-1 would revert shipped behavior — High | — |
| P-14 | `UsersModule` exports `UsersRepository`, `RoleAssignmentsRepository`, `CatalogService`; feature modules join through `AppModule.imports` | location | `server/src/users/users.module.ts:108-114`; `server/src/app.module.ts:15-28` | `443a618` | Module wiring — Low | — |
