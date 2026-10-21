# Cycles and QA timelines — Tasks

| | |
|---|---|
| Spec path | `docs/specs/admin-config/cycle-timelines` |
| Branch | `feat/cycle-timelines` (from `origin/staging-center` @ `204312e`) |
| Commits | `[SPEC:admin-config/cycle-timelines] <emoji> <type>(cycle) P2-3933: …` |
| Budget (design § 10) | 10 tasks (9 build + 1 HITL) · ~2,600 LOC · ~14 Reviewer passes |
| Verification (server) | `cd server && pnpm lint && pnpm build && pnpm test --reporter=dot && npx tsc --noEmit -p tsconfig.json` (baseline: 7 pre-existing errors, all in `src/auth/token-verifier.service.spec.ts`, measured at `443a618`) — plus `pnpm test:e2e --reporter=dot` where stated |
| PRs | PR 1 = T-1…T-5 (schema, rules, cycles) · PR 2 = T-6…T-10 (timelines, users, docs, HITL) |

Status: `[ ]` pending · `[~]` in progress · `[x]` done (after a Reviewer PASS, a recorded `REVIEW_WAIVED`, or a `REVIEW_SKIPPED`).

## Dependency graph

```
T-1 ─┬─────────────────────────▶ T-5 ─▶ T-6 ─▶ T-7 ─▶ T-8 ─▶ T-9 ─▶ T-10 (HITL)
T-2 ─┼─▶ T-3 ──────────────────────────▲
     └─▶ T-4 ──────────────────────────────────▲ (T-7)
```

- T-5 depends on T-1, T-2. T-6 on T-3, T-5. T-7 on T-4, T-6. T-8 on T-7.
- Serial boundaries: T-1 alone touches `server/src/database/**`. T-2 alone touches `server/src/common/error-codes.ts`. T-5…T-8 share `test/support/in-memory-admin-config.ts` and `admin-config-app.ts` and run one after the other.

---

## T-1: Schema and migration `0003` for the six tables
- **Status:** [x]
- **Size:** M
- **Depends on:** none
- **Requirements:** FR-1 (Duplicate year — the unique key; AND IT MUST hold concurrently — DB part), FR-3 (AND IT MUST never two active — DB part), FR-5 (Two at once — `official_key` backstop), FR-6 (Duplicate name — unique per cycle, case-insensitive; BUT the same name in another cycle is allowed), FR-8 (Close before open — `chk_timeline_steps_dates`; BUT same day valid), FR-9 (BUT not silently switched on — CHECK refuses, never defaults), FR-14 (Already assigned — BUT no second active row), FR-15 (BUT the row is not deleted; Re-assign — the removed row does not block), NFR-3 (DB part), NFR-6
- **Design refs:** § 5; DD-2, DD-5, DD-6, DD-9; P-6, P-7, P-12
- **Scope:** `server/src/database/drizzle/schema/{cycles,timelines,timeline-steps,timeline-programs,timeline-result-types,timeline-users}.ts`, `schema/index.ts`, generated `server/drizzle/0003_cycle_timelines.sql` + meta, `schema.spec.ts` (new table pins, migration count 3 → 4, `0003` additive and exact), `server/src/database/AGENTS.md` (schema guarantees). Not touched: existing tables, `0000`–`0002`.
- **Tests:** `schema.spec`: per table, columns and types (`date` in string mode for `opens_on` / `closes_on`), enums (`status`, `kind`, `audience`), generated stored `active_key` / `official_key` with their unique indexes, every named CHECK (`chk_cycles_year`, `chk_cycles_lifecycle`, `chk_timeline_steps_position`, `_dates`, `_round`, `_first_load`, `chk_timeline_users_removed`), unique sets (`uq_cycles_year`, `uq_timelines_cycle_name`, `uq_timeline_steps_position`, `uq_timeline_steps_audience`), FKs, case-insensitive collation on `timelines.name`; `0003` is CREATE TABLE only.
- **First step (settles P-12):** read mysql2's DATE parsing in `server/node_modules/mysql2` and record in `execution.md` whether it builds a local-zone `Date` without `dateStrings`. If it does not, DD-5 stays as a preference and nothing else changes.
- **Verification:** server command; generated SQL read line by line against design § 5.
- **Falsifier:** make `official_key` a plain column (not generated, or `cycle_id` always) → the "official key is NULL for additional" pin goes red; drop `position <> 1 OR` from `chk_timeline_steps_first_load` → its exact-SQL pin goes red; switch `opens_on` to date mode → the string-mode pin goes red.
- **Red run:** new `schema.spec` cases fail on assertions before the tables exist; the migration-count case fails at 3.
- **Disqualifier:** a pin that only asserts the table exists; a migration not read line by line; a case-insensitivity claim with no collation assertion.
- **Consumers:** `schema/index.ts` re-exports (`pnpm build`); `server/drizzle/meta/_journal.json`; `schema.spec.ts` migration count (`schema.spec.ts:303-304`).
- **Review:** full — shared schema on a DB that is never reset.
- **Done when:** all pins green with falsifiers executed; `0003` contains only the six new tables; P-12 outcome recorded.
- **Skills:** nestjs-expert, nestjs-best-practices

## T-2: Error codes, field codes, Rome dates, default steps, clock
- **Status:** [x]
- **Size:** S
- **Depends on:** none
- **Requirements:** FR-4 (table), FR-8 (Back-dated — AND IT MUST use the Rome date, not the server's or the client's), FR-11 (AND IT MUST use only catalog codes), FR-12 (DST scenario — date part), NFR-4
- **Design refs:** § 7.1 (`rome-date.ts`, `default-steps.ts`), § 7.5, § 7.7; DD-2, DD-8; P-4, P-5, P-11
- **Scope:** `server/src/common/error-codes.ts` (8 codes, 7 field codes), `server/src/admin-config/{rome-date,admin-config.clock,admin-config.errors}.ts`, `server/src/admin-config/timelines/default-steps.ts`, `error-codes.spec.ts` (new classes added to its hand-listed array). Not touched: existing codes, `validation.ts`.
- **Tests:** `rome-date.spec`: today-in-Rome at 22:59Z / 23:00Z in winter and 21:59Z / 22:00Z in summer; 25 Oct 2026 21:30Z → `2026-10-25`, 23:30Z → `2026-10-26`; 29 Mar 2026 switch; invalid strings (`2026-02-30`, `2026-2-3`, `26-02-03`, empty) refused; run the file with `TZ=UTC` and with `TZ=America/Bogota` and get the same results. `default-steps.spec` pins the FR-4 table. `error-codes.spec` passes for the new entries.
- **Verification:** server command; `TZ=UTC pnpm exec vitest run src/admin-config/rome-date.spec.ts` and `TZ=America/Bogota pnpm exec vitest run src/admin-config/rome-date.spec.ts`.
- **Falsifier:** compute today with `new Date().toISOString().slice(0,10)` (UTC) → the 23:30Z-on-25-Oct case goes red; compute with local getters → the Bogotá run goes red.
- **Red run:** `rome-date.spec` fails on its assertions against a stub returning UTC dates.
- **Disqualifier:** a test that builds the expected value with the same function it tests; a single `TZ` run.
- **Consumers:** `server/src/common/error-codes.ts` is read by `api-response.ts:13-14,122` (OpenAPI field-code enum), `validation.ts`, `idempotency.interceptor.ts`, `users.errors.ts` (P-11) — run `pnpm test:e2e --reporter=dot` (OpenAPI suite); `client/src/app/core/http/api-envelope.ts:29` (comment only; updated through T-9's contract note).
- **Review:** full — shared error catalog.
- **Done when:** codes and field codes in the catalog with messages that pass `error-codes.spec`; Rome-date tests green in both `TZ`s; falsifiers executed.
- **Skills:** nestjs-best-practices, error-handling-patterns, tdd

## T-3: Timeline create rules (pure)
- **Status:** [x]
- **Size:** M
- **Depends on:** T-2
- **Requirements:** FR-6 (Explicit scope, All, Missing or unknown scope — BUT an empty list must NOT be read as "all"), FR-7 (Renamed and removed, Too many or too few, Audience rules), FR-8 (Valid, Close before open — BUT same day valid, Overlap or out of order, Missing or malformed — BUT not dropped silently, Back-dated), FR-9 (First step without a load — BUT not switched on), FR-10 (Regrouped, Invalid rounds), FR-11 (Several problems — BUT not stop at the first)
- **Design refs:** § 7.1 (`timeline-rules.ts`), § 7.2; DD-6, DD-8; S-1, S-2, S-4
- **Scope:** `server/src/admin-config/timelines/timeline-rules.ts` + spec. Input: the request (shape already valid), today's Rome date, catalog ids and keys. Output: every `{ field, code }` issue. No I/O.
- **Tests:** table-driven, one row per rule and per boundary: name empty / 121 chars; `allPrograms` true with ids, false with `[]`, unknown id; same for result types; 0 and 6 steps; duplicate audience; `ppu` before `tpb`; unknown audience; same-day step valid; closes before opens; next opens on previous close day (overlap) and the day after (valid); missing date kept as an issue on `steps[i].closesOn` (the step stays in the output count); `2026-02-30`; step 1 opens yesterday / today; first step `requiresLoad: false`; rounds `1,1,2,2,2` valid, `2,…`, `1,2,1`, `1,1,3` invalid; one request with name + programs + `steps[2].closesOn` problems → exactly those three issues.
- **Verification:** server command.
- **Falsifier:** return after the first issue → the three-issue row goes red; compare `opensOn > previous closesOn` with `>=` → the overlap row goes red; treat `[]` as all → the empty-list row goes red.
- **Red run:** the rule table fails on assertions against a rules stub that returns `[]`.
- **Disqualifier:** expected issues derived by calling the rules; a fixture where the mutated comparison yields the same issues (each boundary row must sit exactly on the boundary).
- **Consumers:** none (new symbol).
- **Review:** full — every AC 4–11 rule lives here.
- **Done when:** every row green; three falsifiers executed and observed red.
- **Skills:** tdd, nestjs-best-practices

## T-4: Timeline view — status, current step, readiness (pure)
- **Status:** [x]
- **Size:** S
- **Depends on:** T-2
- **Requirements:** FR-12 (Two live at once — computation; Open and close by date — BUT no stored state may change; DST), FR-13 (Missing assessor — BUT no Science Programs item; Not blocking)
- **Design refs:** § 7.1 (`timeline-view.ts`); DD-2; S-1; D-3
- **Scope:** `server/src/admin-config/timelines/timeline-view.ts` + spec. Pure: steps + active assignment roles + today's Rome date → status, current step, next step, readiness codes.
- **Tests:** status `scheduled` / `live` / `finished` at the day before, first day, last day, day after; current step at the last day of step 1 (6 Nov), the gap day (7 Nov → none, next 2), the first day of step 2 (9 Nov); the function reads only its arguments (pass frozen inputs); readiness: Assessors + Programs steps, no users → `NO_RESULTS_LOADED`, `NO_ASSESSOR_ASSIGNED` and no programs item; all four roles assigned → only `NO_RESULTS_LOADED`; a role assigned that no step needs adds nothing.
- **Verification:** server command.
- **Falsifier:** treat `closesOn` as exclusive → the 6 Nov row goes red; map `programs` to a role → the "no programs item" row goes red.
- **Red run:** view tests fail on assertions against a stub.
- **Disqualifier:** a test that passes the current step in as input.
- **Consumers:** none (new symbol).
- **Review:** checklist — small pure function, fully table-tested.
- **Done when:** all rows green; falsifiers executed.
- **Skills:** tdd

## T-5: Cycles module — create, list, activate
- **Status:** [x]
- **Size:** M
- **Depends on:** T-1, T-2
- **Requirements:** FR-1 (New cycle — BUT not active; Duplicate year — AND IT MUST hold concurrently; Invalid year), FR-2, FR-3 (Switch — AND IT MUST never two or none; Not a draft), FR-16 (cycles routes), FR-17 (cycle create), NFR-1, NFR-2, NFR-3, NFR-7 (cycle actions)
- **Design refs:** § 3, § 6 (cycles rows), § 7.3 (create, activate), § 7.5, § 7.6, § 7.7; DD-4, DD-9; P-1, P-2, P-10, P-14
- **Scope:** `server/src/admin-config/admin-config.module.ts`, `cycles/` (module, controller, service, store port + Drizzle adapter, unit of work with tx-bound idempotency store, DTOs, response models, replay reader returning a `Cycle`), `server/src/app.module.ts` (+ `AdminConfigModule`), `test/support/in-memory-admin-config.ts` (cycles store, unit of work, 1062 emulation for `uq_cycles_year` and `uq_cycles_active_key`), `test/support/admin-config-app.ts`, `test/admin-config-cycles.e2e-spec.ts`.
- **Tests:** unit (service over fakes): create → `draft`, name "2027 cycle", `created_by`; duplicate → 409; year 2019 / 2101 / "2026" → 400 `year`; activate draft with an active one → old `closed`, new `active`, one transaction; activate active / closed → 409, nothing changes; two concurrent activations (fake row locks) → never two active; list order and `timelineCount` / `startsOn` / `endsOn` from seeded steps. e2e: every route 401 without a token, 403 for an ASSESSOR; create replay with the same key → same 201 and `Idempotency-Replayed: true`, one row; OpenAPI suite green.
- **Verification:** server command + `pnpm test:e2e --reporter=dot`.
- **Falsifier:** activate the target before closing the old one → the fake's `uq_cycles_active_key` emulation raises 1062 and the switch test goes red; remove `@RequirePermission` from the controller → the 403 e2e goes red.
- **Red run:** service and e2e cases fail on assertions against an empty controller (404 route).
- **Disqualifier:** a concurrency test whose fake runs calls one after the other with no lock model; an e2e that seeds through the service instead of the route.
- **Consumers:** `server/src/app.module.ts` (all e2e suites boot it — run `pnpm test:e2e`); `test/openapi.e2e-spec.ts`.
- **Review:** full — first module, concurrency, idempotency wiring.
- **Done when:** all green with falsifiers executed; one decision line per write, no names or bodies.
- **Skills:** nestjs-expert, nestjs-best-practices, api-design-principles, error-handling-patterns

## T-6: Timelines — defaults and create
- **Status:** [x]
- **Size:** M
- **Depends on:** T-3, T-5
- **Requirements:** FR-4 (route), FR-5 (First, Later, Two at once — AND IT MUST hold on any number of instances (fake part), Closed or unknown cycle, Kind sent), FR-6 (Catalog unreachable; Duplicate name — BUT another cycle allowed), FR-11 (Several problems — end to end; AND IT MUST use catalog codes, no free text), FR-16 (these routes), FR-17 (Replayed timeline create — BUT no second timeline and no official → additional), NFR-1, NFR-2, NFR-3, NFR-7 (timeline create)
- **Design refs:** § 6 (defaults, create), § 7.2, § 7.3 (create), § 7.5, § 7.6; DD-3, DD-4, DD-7; P-1, P-3, P-8
- **Scope:** `server/src/admin-config/timelines/` (module, controller, service create path, store port + Drizzle adapter for timelines/steps/scope, unit of work locking the cycle, DTOs, models, replay reader returning a `Timeline`), `TimelineValidationError` use, fakes and app support extended, `test/admin-config-timelines.e2e-spec.ts` (create part).
- **Tests:** unit: first create → official; second → additional; two concurrent creates on an empty cycle (fake row lock on the cycle) → one official, one additional; closed cycle → 409; unknown → 404; name taken (case-insensitive) → 409, same name in another cycle → 201; catalog source throws → 503, nothing written; rules issues → 400 with the full `fields` list, nothing written. e2e: `GET /timeline-defaults` equals FR-4; body with `kind` → 400 `UNKNOWN_FIELD`; three-problem request → one 400 listing three fields with catalog messages; replay of an official create after another timeline exists → the same official answer, two rows total; 401 / 403 per route.
- **Verification:** server command + `pnpm test:e2e --reporter=dot`.
- **Falsifier:** decide the kind before taking the cycle lock → the concurrent-create test yields two officials (fake raises 1062 on `official_key`) and goes red; call the rules after opening the transaction and write partial rows → the "nothing written" assertion goes red.
- **Red run:** create tests fail on assertions against a controller returning 501.
- **Disqualifier:** a replay test where no other timeline is created between the two calls (cannot tell a replay from a new official); catalog fakes that never fail.
- **Consumers:** `test/support/admin-config-app.ts`, `in-memory-admin-config.ts` (shared with T-5, T-7, T-8); `test/openapi.e2e-spec.ts`.
- **Review:** full — the AC 5 race and the validation contract.
- **Done when:** all green with falsifiers executed.
- **Skills:** nestjs-expert, nestjs-best-practices, api-design-principles, error-handling-patterns

## T-7: Timelines — list and detail
- **Status:** [x]
- **Size:** S
- **Depends on:** T-4, T-6
- **Requirements:** FR-12 (Two live at once; Open and close by date — end to end with an overridden clock, BUT no stored state changes; DST; Unknown cycle or timeline → 404; ordering), FR-13 (in responses; Not blocking), FR-16 (these routes), NFR-1, NFR-5
- **Design refs:** § 6 (list, detail shapes), § 7.4; DD-2
- **Scope:** list and detail paths of `timelines.service.ts` / controller / store; query-count instrumentation in the fake.
- **Tests:** unit: list with 1 and with 50 timelines → the same number of store calls; official first then newest; detail of unknown → 404. e2e with `ADMIN_CONFIG_CLOCK` overridden: 23:59 Rome 6 Nov → current 1; 00:00 Rome 7 Nov → none, next 2; 00:00 Rome 9 Nov → 2; the fake's write counter is unchanged across the three reads; two timelines live at once each with its own current step; readiness present on a created timeline; 401 / 403.
- **Verification:** server command + `pnpm test:e2e --reporter=dot`.
- **Falsifier:** load steps per timeline in a loop → the 50-timeline call count grows and the test goes red; read the time with `new Date()` instead of the clock token → the overridden-clock e2e goes red.
- **Red run:** list e2e fails on assertions against a 501 route.
- **Disqualifier:** a query-count test with one timeline only; a clock test that never crosses a boundary.
- **Consumers:** none beyond T-6's.
- **Review:** checklist — reads over already-reviewed pure logic.
- **Done when:** all green with falsifiers executed.
- **Skills:** nestjs-expert, api-design-principles

## T-8: Timeline users — assign and remove
- **Status:** [x]
- **Size:** M
- **Depends on:** T-7
- **Requirements:** FR-14 (Assign; Not eligible — BUT a role outside the four is 400; Already assigned — BUT no second active row, even concurrently; Several roles), FR-15 (Remove — BUT not deleted; Re-assign), FR-13 (readiness recomputed after assign / remove), FR-16 (these routes), NFR-1, NFR-3, NFR-7 (assign, remove)
- **Design refs:** § 6 (users routes, `TimelineDetail.users`), § 7.3 (assign, remove); DD-9, DD-10; S-7; P-9
- **Scope:** assign / remove / detail-users paths in `timelines/`; eligibility through `UsersRepository.findById` and `RoleAssignmentsRepository.findActiveViewsByUserId` + `isLiveAssignment` (read-only use of `UsersModule` exports); fakes extended (`uq_timeline_users_active_key` emulation).
- **Tests:** unit: assign live ASSESSOR → 201, detail lists her; unknown user → 404 `USERS_NOT_FOUND`; inactive → 409; revoked grant → 409; `role: ADMIN` / `PROGRAM` → 400; repeat → 200 same assignment id; two concurrent identical assigns → one active row; same user as Lead too → two entries; closed cycle → 409; remove → 204, row kept with `removed_at`, readiness gains `NO_ASSESSOR_ASSIGNED`; remove again → 404; re-assign after removal → 201 active. e2e: 401 / 403 per route; DELETE then GET detail.
- **Verification:** server command + `pnpm test:e2e --reporter=dot`.
- **Falsifier:** check eligibility with `isActive` only (ignore `revokedAt` / role active) → the revoked-grant test goes red; delete the row on remove → the history assertion goes red.
- **Red run:** assign tests fail on assertions against a 501 route.
- **Disqualifier:** an eligibility fixture where the user holds no other role (cannot distinguish "has role R" from "has any role").
- **Consumers:** `server/src/users/current-user.cache.ts` `isLiveAssignment` and `role-assignments.repository.ts` are read, not changed — none modified.
- **Review:** full — authorization-adjacent rule and concurrency.
- **Done when:** all green with falsifiers executed.
- **Skills:** nestjs-expert, nestjs-best-practices, api-design-principles

## T-9: Guides, TRD and front contract
- **Status:** [~]
- **Size:** S
- **Depends on:** T-8
- **Requirements:** proposal R-1 / DD-1 (TRD as a named deliverable), NFR-6 (reserved tables documented), D-1 (front must label the zone), FR-17 (idempotency reuse documented)
- **Design refs:** § 8, § 9; DD-1, DD-4
- **Scope:** `server/src/admin-config/AGENTS.md` (new), `server/AGENTS.md` layout row, `server/src/common/AGENTS.md` (idempotency target id may be a cycle or timeline id), `docs/trd/trd.md` § 4 (`admin-config` row), § 5.1 (replace `cycles` / `windows` / `batches` rows; add the six tables and the reserved two), § 6 (resource map); `docs/specs/admin-config/cycle-timelines/front-contract.md` (routes, shapes, rules the server owns, field codes, the `Europe/Rome` labeling rule, what is not built). This task is the one place where the TRD is edited on this branch.
- **Tests:** none (docs).
- **Verification:** manual: TRD § 5.1 lists exactly the tables `0003` creates (compare with `server/drizzle/0003_cycle_timelines.sql`); `grep -n -iE "windows|window_id" docs/trd/trd.md` → no hit outside a superseded note.
- **Falsifier:** leave the `windows` row in § 5.1 → the grep returns a hit.
- **Red run:** n/a (no test gate).
- **Disqualifier:** a TRD table written from the design instead of the generated SQL.
- **Consumers:** none (docs).
- **Review:** checklist — documentation against the shipped schema.
- **Done when:** grep clean; contract note reviewed by the back lead.
- **Skills:** api-design-principles

## T-10: HITL — migration on `qadb` and real-MySQL checks
- **Status:** [ ]
- **Size:** S
- **Depends on:** T-9
- **Requirements:** FR-1 / FR-3 / FR-5 / FR-14 (the AND IT MUST concurrency clauses on real MySQL), NFR-3, NFR-4 (DATE round-trip)
- **Design refs:** § 5, § 7.3; P-12
- **Scope:** **Human step (back lead):** apply `0003` to `qadb` (`pnpm db:migrate`). Agents never run it. Then, against the local API: 20 concurrent first-timeline creates on a fresh cycle → exactly one official; 20 concurrent activations → exactly one active cycle; 20 concurrent identical assigns → one active row; a step saved with `2026-11-02` reads back `2026-11-02`. Results recorded in `execution.md`.
- **Tests:** manual (scripted requests).
- **Verification:** the four counts above, read from MySQL.
- **Falsifier:** any count other than one; any date read back shifted.
- **Red run:** n/a (no test gate).
- **Disqualifier:** requests sent one after the other (no real concurrency); a check against a DB where `0003` was not applied.
- **Consumers:** none.
- **Review:** checklist — evidence recorded by a human.
- **Done when:** four checks recorded; spec ready for `/akili-validate`.
- **Skills:** nestjs-expert

---

## Coverage (scenario and clause level)

| Requirement · scenario / clause | Owner(s) |
|---|---|
| FR-1 New cycle · BUT not active | T-5 |
| FR-1 Duplicate year · AND IT MUST concurrent | T-1 (key), T-5 (fake), T-10 (MySQL) |
| FR-1 Invalid year | T-5 |
| FR-2 List | T-5 |
| FR-3 Switch · AND IT MUST never two / none | T-1, T-5, T-10 |
| FR-3 Not a draft | T-5 |
| FR-4 Default steps | T-2 (table), T-6 (route) |
| FR-5 First · Later · Closed/unknown · Kind sent | T-6 |
| FR-5 Two at once · AND IT MUST any instances | T-1 (backstop), T-6 (lock), T-10 (MySQL) |
| FR-6 Explicit · All · Missing/unknown · BUT empty ≠ all | T-3 |
| FR-6 Catalog unreachable | T-6 |
| FR-6 Duplicate name · BUT other cycle allowed | T-1, T-6 |
| FR-7 all scenarios | T-3 |
| FR-8 Valid · Close before open · BUT same day · Overlap · Missing · BUT not dropped | T-3 |
| FR-8 Back-dated · AND IT MUST Rome date | T-2 (date), T-3 (rule) |
| FR-9 First step without load · BUT not switched on | T-1 (CHECK), T-3 (rule) |
| FR-10 Regrouped · Invalid | T-3 |
| FR-11 Several problems · BUT not first only | T-3, T-6 |
| FR-11 AND IT MUST catalog codes | T-2, T-6 |
| FR-12 Two live · Open/close by date · BUT no stored change · DST · Unknown | T-4, T-7 (DST date part: T-2) |
| FR-13 Missing assessor · BUT no SP item · Not blocking | T-4, T-7, T-8 (recompute) |
| FR-14 Assign · Not eligible · BUT outside four → 400 · Already assigned · BUT no second row · Several roles | T-8 (T-1 key, T-10 MySQL) |
| FR-15 Remove · BUT not deleted · Re-assign | T-8 (T-1 key) |
| FR-16 Non-admin / no token | T-5, T-6, T-7, T-8 |
| FR-17 Replayed create · BUT no second · BUT no official → additional | T-5 (cycle), T-6 (timeline) |
| NFR-1 · NFR-2 | T-5…T-8 |
| NFR-3 | T-1, T-5, T-6, T-8, T-10 |
| NFR-4 | T-2, T-4, T-7, T-10 |
| NFR-5 | T-7 |
| NFR-6 | T-1, T-9 |
| NFR-7 | T-5, T-6, T-8 |
