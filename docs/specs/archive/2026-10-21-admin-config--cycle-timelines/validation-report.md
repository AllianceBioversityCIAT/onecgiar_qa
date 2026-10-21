# Validation Report — Cycles and QA timelines

**Verdict: WARN, ready to archive with 3 small items to close first.** All 11 tasks are closed with a recorded verdict. Every gate is green: lint, build, unit 1722, e2e 715, and tsc at its baseline. Every FR-1…FR-17 scenario and clause, and NFR-1…NFR-7, has evidence in code and in a test or a HITL record. No FAIL and no BLOCKED. There are 3 WARN sections: design drift on the activate route (§ 8), owed and limited HITL evidence on TEST (§ 9), and the root guide index missing the new module guide (§ 10).

## 1. Document Control

| | |
|---|---|
| Spec path | `docs/specs/admin-config/cycle-timelines` |
| Command | `/akili-validate admin-config/cycle-timelines` |
| Branch / HEAD | `feat/cycle-timelines` @ `3d8182f` (clean tree, 23 commits ahead of `origin/staging-center`) |
| Auditor | T3 Auditor (independent; not the Implementer or the Reviewer) |
| Date | 2026-10-21 |
| Inputs | Root `AGENTS.md` / `CLAUDE.md`, `docs/trd/trd.md` §§ 4–6, `server/AGENTS.md`, `server/src/{admin-config,database,common}/AGENTS.md`; `proposal.md`, `requirements.md`, `design.md`, `tasks.md`, `front-contract.md`, `execution.md`; code under `server/src/admin-config/**`, the six schema files, `server/drizzle/0003_cycle_timelines.sql`, `server/test/admin-config-*.e2e-spec.ts`, `server/test/support/{in-memory-admin-config,admin-config-app}.ts`, `server/src/common/error-codes.ts` |
| Skills applied | cognitive-doc-design, nestjs-best-practices, api-design-principles, error-handling-patterns |
| Not applicable | `docs/ux-ui/design.md` (server-only spec) |
| Safety | No `db:migrate`, no database, TEST or PROD access, no remote API calls. The e2e run went through the resource guard normally (slot granted, no `RG_FORCE`) |

## 2. Summary

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Task completion (§ 3) | PASS | T-1…T-11 `[x]`, each with a closing record |
| 2 | File existence (§ 4) | PASS | 28 of 28 design § 4 paths present; 3 extra files (drift, advisory) |
| 3 | Lint | PASS | `oxlint --type-aware` exit 0 |
| 4 | Build | PASS | `nest build` exit 0 |
| 5 | Unit tests | PASS | 49 files / 1722 passed |
| 6 | Type check | PASS | 7 errors, all in `src/auth/token-verifier.service.spec.ts`, which is the baseline |
| 7 | e2e tests | PASS | 13 files / 715 passed (`pnpm test:e2e`, guard slot granted) |
| 8 | Requirement coverage (§ 6) | PASS | All scenarios and clauses evidenced; real-MySQL clauses by T-10/T-11 HITL |
| 9 | Code quality (§ 7) | PASS | ADMIN on every route, catalog-only errors, no PII in logs, locks per § 7.3; advisories only |
| 10 | Design conformance (§ 8) | **WARN** | Design § 6 activate row lacks the amended 503; minor count and date drift |
| 11 | Test evidence (§ 9) | **WARN** | Back-lead acknowledgment of the TEST run is owed; the T-11 "none active" case was not re-run after the fix; synthetic data is left on TEST |
| 12 | Guides (§ 10) | **WARN** | Root `## Module Guides` does not list `server/src/admin-config/AGENTS.md` |

**Counts:** PASS 9 · WARN 3 · FAIL 0 · BLOCKED 0.

## 3. Task Completion

| Task | `tasks.md` | Closing record in `execution.md` | Attempts | Result |
|---|---|---|---|---|
| T-1 Schema and `0003` | `[x]` | Reviewer PASS (line 37) | 1 | PASS |
| T-2 Codes, Rome dates, defaults, clock | `[x]` | Reviewer PASS (line 76) | 1 | PASS |
| T-3 Create rules | `[x]` | Reviewer PASS (line 113) | 1 | PASS |
| T-4 View and readiness | `[x]` | Reviewer PASS (line 165) | 1 | PASS |
| T-5 Cycles module | `[x]` | Reviewer A + B PASS (lines 205–206) | 1 | PASS |
| T-6 Timeline create | `[x]` | Attempt 1 FAIL (lens A) → attempt 2 Reviewer PASS (line 295) | 2 | PASS |
| T-7 List and detail | `[x]` | Implicit FAIL (evidence MISMATCH) → Reviewer PASS (line 349) | 2 | PASS |
| T-8 Timeline users | `[x]` | Both lenses FAIL → Reviewer PASS (line 429) | 2 | PASS |
| T-9 Guides, TRD, contract | `[x]` | Reviewer PASS (line 490), then back-lead contract approval (line 512) | 1 | PASS |
| T-10 HITL on TEST | `[x]` | Checklist Reviewer PASS (line 624). It was first flipped without a record in `6c311e4`, then corrected and reopened (line 621) | — | PASS |
| T-11 Activation retry (added) | `[x]` | Attempt 1 FAIL → attempt 2 Reviewer PASS (line 567) plus the TEST re-check (line 571) | 2 | PASS |

No task was closed without a closing record at HEAD. The T-10 process slip was caught and corrected in the log itself.

## 4. File Existence

| Design § 4 item | Present | Note |
|---|---|---|
| `server/drizzle/0003_cycle_timelines.sql` + `meta/0003_snapshot.json` + journal tag | Yes | 6 CREATE TABLE, no DROP / MODIFY / RENAME |
| Six schema files + `schema/index.ts` re-exports | Yes | `index.ts:10-15` |
| `app.module.ts` + `AdminConfigModule` | Yes | `app.module.ts:4,29` |
| `common/error-codes.ts` additions | Yes | 8 codes (`:231-260`), 7 field codes (`:320-330`) |
| `admin-config/{AGENTS.md, admin-config.module, admin-config.errors, rome-date, admin-config.clock}.ts` | Yes | |
| `cycles/{module, controller, service, store, unit-of-work}.ts`, `dto/`, `models/` | Yes | |
| `timelines/{module, controller, service, default-steps, timeline-rules, timeline-view, store, unit-of-work}.ts`, `dto/`, `models/` | Yes | |
| `test/support/{in-memory-admin-config, admin-config-app}.ts`, both e2e specs | Yes | |
| `docs/trd/trd.md`, `front-contract.md` | Yes | |

**Drift (files present but not in design § 4; advisory):**

| File | Purpose | Recorded |
|---|---|---|
| `admin-config/admin-config.context.ts` | `AdminConfigContext` + `AdminConfigAction` | T-5 decision; listed in the module guide |
| `cycles/cycle-view.ts` | Cycle read model | T-5 advisory (B); listed in the module guide |
| `timelines/timeline-response.ts` | Timeline read model + `ASSIGNABLE_ROLES` | Listed in the module guide |

`timelines.unit-of-work.ts` **is** in the design § 4 tree, so it is not drift.

## 5. Build Integrity

All commands were run from `server/` by the Auditor at `3d8182f`.

| Command | Result | Numbers |
|---|---|---|
| `pnpm lint` | PASS | exit 0, no findings |
| `pnpm build` | PASS | exit 0 |
| `pnpm test --reporter=dot` | PASS | 49 files / **1722** tests passed |
| `npx tsc --noEmit -p tsconfig.json` | PASS (baseline) | 7 errors, all in `src/auth/token-verifier.service.spec.ts` (baseline at `443a618`); none new |
| `pnpm test:e2e --reporter=dot` | PASS | 13 files / **715** tests passed (including the OpenAPI suite); the guard granted a slot at 4184 MB, so the fallback was not needed |

These numbers match the execution Summary ("unit 49 / 1722 · e2e 13 / 715 · tsc 7 baseline").

## 6. Requirement Coverage

Paths are relative to `server/`. `svc.spec` = `src/admin-config/<module>/<module>.service.spec.ts`; `e2e-c` / `e2e-t` = `test/admin-config-{cycles,timelines}.e2e-spec.ts`; `rules.spec` / `view.spec` = the pure-rule specs.

### FR-1 … FR-4: cycles and defaults

| Requirement · clause | Owner | Code evidence | Test evidence | Result |
|---|---|---|---|---|
| FR-1 New cycle → `draft`, "2027 cycle", who and when | T-5 | `cycles.service.ts:126-151`; `cycle-view.ts` | svc.spec "creates a draft with the display name, who created it and when"; e2e-c "creates a draft cycle: 201…" | PASS |
| FR-1 "BUT it must NOT become active by being created" | T-5 | `cycles.service.ts:140` (`status: 'draft'`) | svc.spec "never becomes active by being created…"; e2e-c "does not make it active…" | PASS |
| FR-1 Duplicate year → 409, nothing written | T-1, T-5 | `0003:13` `uq_cycles_year`; `cycles.service.ts:144` | svc.spec "refuses a second cycle for the same year with 409…"; e2e-c "refuses a duplicate year…" | PASS |
| FR-1 "AND IT MUST hold when the two creates arrive at the same time" | T-1, T-5, T-10 | unique key (as above) | svc.spec / e2e-c "two creates of one year at the same time…"; **HITL** execution.md:627 (10 concurrent on TEST → 1 × 201, 9 × 409) | PASS |
| FR-1 Invalid year → 400 `year` | T-5 | `create-cycle.dto.ts`; `cycles.service.ts:83-94` | e2e-c rows `'2026'` / 2019 / 2101 (`:259-262`); svc.spec `:251-254` | PASS |
| FR-2 List: newest first, count, date range (null when empty) | T-5 | `cycles.store.ts` `listSummaries` (one grouped query) | e2e-c "lists every cycle, newest year first…", "is an empty list…"; svc.spec "is one store call whatever the number of cycles" | PASS |
| FR-3 Switch: target active, old closed | T-5 | `cycles.service.ts:180-195` (close before activate) | svc.spec "makes the draft active and closes the previous one in one transaction, closing first"; e2e-c `:348` | PASS |
| FR-3 "AND IT MUST never leave two active cycles, or none, visible to a reader, even with two activations at once" | T-1, T-5, T-10, T-11 | `0003:5,14` `active_key` + `uq_cycles_active_key`; `cycles.service.ts:50,61-80,162-177` (retry ≤ 10 → 503) | svc.spec "two activations at once never leave two active cycles, or none…", the T-11 block (`:453-596`); e2e-c `:416,432`; **HITL** execution.md:532 (20 concurrent → one active), :578-579 (5 and 10 concurrent → one active, no 500) | PASS |
| FR-3 Not a draft → 409, nothing changes | T-5 | `cycles.service.ts:187` | svc.spec `it.each(['active','closed'])`; e2e-c `:377` | PASS |
| FR-4 Default steps (FR-4 table) | T-2, T-6 | `timelines/default-steps.ts`; route `timelines.controller.ts:107` | `default-steps.spec.ts`; e2e-t "answers the five default steps of the FR-4 table" | PASS |

### FR-5 … FR-11: timeline create

| Requirement · clause | Owner | Code evidence | Test evidence | Result |
|---|---|---|---|---|
| FR-5 First → official; Later → additional | T-6 | `timelines.service.ts:242-244` (under the cycle lock) | svc.spec "makes the first timeline of a cycle official…", "makes a later timeline additional…"; e2e-t `:366,400` | PASS |
| FR-5 Two at once: "AND IT MUST hold on any number of API instances — … never a second official" | T-1, T-6, T-10 | `0003:24,31` `official_key` backstop; `timelines.service.ts:233,257-264` | svc.spec "two creates on an empty cycle…", "holds on any number of instances: five API instances…", "the unique key is the backstop…"; e2e-t `:433`; **HITL** execution.md:530 (20 concurrent → official 1, additional 19) | PASS |
| FR-5 Closed → 409; unknown → 404 | T-6 | `timelines.service.ts:234-235` | svc.spec `:520,536`; e2e-t `:453,466` | PASS |
| FR-5 Kind sent → 400 unknown field | T-6 | `configure-app.ts:34-35` (`forbidNonWhitelisted`); `create-timeline.dto.ts` | e2e-t "a body that says which kind it is (%s) is 400 on `kind` (UNKNOWN_FIELD)…" (`:478-490`), and inside a step (`:495-503`) | PASS |
| FR-6 Name required, ≤ 120 after trim | T-3 | `timeline-rules.ts:132-137` | rules.spec `name (FR-6)`; svc.spec "trims the name…" | PASS |
| FR-6 Explicit scope stored exactly | T-3, T-6 | `timelines.service.ts:273-281` | svc.spec "stores exactly the programs and result types asked for, each once"; e2e-t `:529` | PASS |
| FR-6 All, including later catalog entries | T-1, T-6 | flags `all_programs` / `all_result_types` (DD-6); no rows | svc.spec "'all' stores the flag and no rows…"; e2e-t `:545` | PASS |
| FR-6 Missing/empty/unknown → 400; "BUT an empty list must NOT be read as 'all'" | T-3, T-6 | `timeline-rules.ts:145-162` (`checkScope`) | rules.spec scope blocks (falsifier F3); svc.spec "an empty list is not 'all'…", "a list that is absent is not 'all'…" | PASS |
| FR-6 Catalog unreachable → 503, nothing written | T-6 | `timelines.service.ts:444-466` (catalog read before any transaction) | svc.spec `:894` "when %s cannot be read: 503…, no transaction, nothing written"; e2e-t `:629` | PASS |
| FR-6 Duplicate name (any case) → 409; "BUT the same name in another cycle is allowed" | T-1, T-6 | `0003:22` `COLLATE utf8mb4_0900_ai_ci` + `uq_timelines_cycle_name`; `timelines.service.ts:265-266` | svc.spec `:670,689,716`; e2e-t `:510` | PASS |
| FR-7 Renamed and removed steps | T-3 | `timeline-rules.ts:49-130` | rules.spec `:262` ("Assessment window"), two-step fixtures; e2e-t FR-13 two-step timeline (`:1121`) | PASS |
| FR-7 0 or > 5 steps → 400 `steps` | T-3 | `timeline-rules.ts:73` | rules.spec `step count and names (FR-7)` | PASS |
| FR-7 Audience: duplicate, out of order, unknown | T-3 | `timeline-rules.ts:85-88` | rules.spec `audiences (FR-7, S-2)` | PASS |
| FR-8 Valid; close before open → `closesOn`; "BUT … same day is valid" | T-1, T-3 | `timeline-rules.ts:113`; `0003` `chk_timeline_steps_dates` | rules.spec `step dates (FR-8, S-1)` same-day row | PASS |
| FR-8 Overlap or out of order → `opensOn` | T-3 | `timeline-rules.ts:102` | rules.spec boundary rows (F2: `<=` → `<` turns red) | PASS |
| FR-8 Missing or malformed; "BUT the step must NOT be dropped silently" | T-3 | `timeline-rules.ts:165-181` | rules.spec "keeps the index of every later step when a date is missing"; e2e-t FR-11 `steps[2].closesOn` | PASS |
| FR-8 Back-dated; "AND IT MUST use the Rome date, not the server's or the client's" | T-2, T-3 | `timeline-rules.ts:96`; `rome-date.ts:7,16` | rome-date.spec (run under `TZ=UTC` and `TZ=America/Bogota` per T-2); svc.spec `:1045,1058` (10:00Z / 22:30Z on 20 Oct) | PASS |
| FR-9 First step without a load → 400; "BUT the server must NOT silently switch it on" | T-1, T-3 | `timeline-rules.ts:117`; `0003:62` CHECK `position <> 1 OR requires_load` (no default) | rules.spec `first step load (FR-9)`, "does not change the request it is given"; schema.spec exact-SQL pin | PASS |
| FR-10 Regrouped and invalid rounds | T-3 | `timeline-rules.ts:124` | rules.spec `rounds (FR-10)`: `1,1,2,2,2`, `1,2,3,3,3` valid; `2…`, `0`, `1,2,1…`, `1,1,3` invalid | PASS (advisory A-6) |
| FR-11 Several problems, one 400 with `name`, `programIds`, `steps[2].closesOn` (amended) | T-3, T-6 | `timeline-rules.ts:49` (collects all); `admin-config.errors.ts:79-90` | rules.spec `all issues at once (FR-11)`; svc.spec `:936,977,1011`; e2e-t `:650,678,706,725` | PASS |
| FR-11 "BUT it must NOT stop at the first problem" | T-3, T-6 | as above | rules.spec F1 (`slice(0,1)` turns red); e2e-t `:725` | PASS |
| FR-11 "AND IT MUST use only codes from the error catalog — no free text, no database text" | T-2, T-6 | messages only from `FIELD_ERRORS` (`admin-config.errors.ts:86`); `error-codes.ts:320-330` | `error-codes.spec.ts` hand-listed classes; e2e-t "…each with the message of the catalog" | PASS |

### FR-12 … FR-17: reads, users, access, idempotency

| Requirement · clause | Owner | Code evidence | Test evidence | Result |
|---|---|---|---|---|
| FR-12 Status, current step, next step; order official first, then newest | T-4, T-7 | `timeline-view.ts:51-89`; `timelines.service.ts:160-173` | view.spec status / current-step tables; e2e-t `:889,1073` | PASS |
| FR-12 Two timelines live at once | T-4, T-7 | as above | e2e-t `:1045` (official in step 4, additional in step 1) | PASS |
| FR-12 Open and close by date; "BUT no stored state may change for this to happen" | T-4, T-7 | computed on read (DD-2); clock only (`timelines.service.ts:178`) | e2e-t `:949` (23:59 6 Nov / 00:00 7 Nov / 00:00 9 Nov, write counter unchanged); svc.spec `:1443` | PASS |
| FR-12 DST: still open at 23:30 Rome on 25 Oct | T-2, T-4, T-7 | `rome-date.ts:16` (`Intl`, `Europe/Rome`) | e2e-t `:1015`; rome-date.spec 21:30Z / 23:30Z rows | PASS |
| FR-12 Unknown cycle or timeline → 404 | T-7 | `timelines.service.ts:137,161-163` | e2e-t `:1096` | PASS |
| FR-13 Missing assessor; "BUT it must NOT list a Science Programs item" | T-4, T-7 | `timeline-view.ts:75-80` (`programs` → null) | view.spec "lists the missing assessor and no Science Programs item" (strong F2); e2e-t `:1121` | PASS |
| FR-13 Not blocking; recomputed after assign and remove | T-4, T-7, T-8 | readiness is informational only | e2e-t `:1121` ("…it is created…"), `:1141,1453`; svc.spec `:1927` | PASS |
| FR-14 Assign; who and when recorded | T-8 | `timelines.service.ts:317-394` | svc.spec `:1522`; e2e-t `:1425,1453` | PASS |
| FR-14 Not eligible: 404 unknown, 409 inactive / no live grant; "BUT a role outside the four … must NOT be assignable — 400" | T-8 | `timelines.service.ts:335-348`; `assign-timeline-user.dto.ts` (`@IsIn(ASSIGNABLE_ROLES)`) | svc.spec `:1568-1665`; e2e-t `:1519` (ADMIN / PROGRAM / GUEST / lower case → 400 `role`), `:1581,1597` | PASS |
| FR-14 Already assigned → same answer; "BUT it must NOT create a second active row, even with two requests at once" | T-1, T-8, T-10 | `0003:74,76` `active_key` + unique; `timelines.service.ts:358-389` (DD-10) | svc.spec `:1696,1771,1826`; e2e-t `:1425,1700`; **HITL** execution.md:531 (20 concurrent → 1 × 201, 19 × 200, one row) | PASS |
| FR-14 Several roles → once per role | T-8 | key includes `role_id` | svc.spec `:1745`; e2e-t `:1496` | PASS |
| FR-15 Remove: inactive, readiness recomputed, who and when; "BUT the row must NOT be deleted" | T-1, T-8 | `timelines.service.ts:403-427`; `timelines.store.ts:394-401` (`UPDATE`, no `DELETE` in the store); `chk_timeline_users_removed` | svc.spec `:1927`; e2e-t `:1453` ("…the row is kept") | PASS |
| FR-15 Re-assign after removal | T-1, T-8 | `active_key` NULL once removed | svc.spec `:2054`; e2e-t `:1685` | PASS |
| FR-16 Non-admin → 403, no token → 401, every route | T-5…T-8 | `cycles.controller.ts:58`, `timelines.controller.ts:79` (class-level `ADMIN_ACCESS`) | e2e-c and e2e-t `FR-16: access` matrices (every grantable role) plus reflection tests "declares ADMIN_ACCESS on each of its 3 / 6 routes and none as public" | PASS |
| FR-17 Replayed create → same 201, one row | T-5, T-6 | `@Idempotent()` `cycles.controller.ts:93`, `timelines.controller.ts:130`; tx-bound `markExecuted` | e2e-c `:466`; e2e-t `:1235` | PASS |
| FR-17 "BUT no second timeline may exist, and the replay must NOT turn an official answer into an additional one" | T-6 | replay reader re-reads the stored kind | e2e-t `:1235` (replay after another timeline exists), `:1295`; svc.spec `:1107` | PASS |

### NFR-1 … NFR-7

| NFR | Owner | Evidence | Result |
|---|---|---|---|
| NFR-1 Non-admin refused before any read | T-5…T-8 | Global Auth → Permission guards plus class-level decorator; 403 matrices assert nothing read or written | PASS |
| NFR-2 All DTOs validated; unknown fields → 400 | T-5…T-8 | `whitelist` + `forbidNonWhitelisted` (`configure-app.ts:34-35`); e2e `UNKNOWN_FIELD` on cycles and timelines (`kind`). The assign body's unknown-field case is covered by the global pipe only (advisory A-11) | PASS |
| NFR-3 No invalid state under concurrency, enforced by the DB | T-1, T-5, T-6, T-8, T-10, T-11 | Generated keys + unique indexes (`0003:5,14,24,31,74,76`); lock order DD-9; HITL counts are all exactly one (execution.md:529-532, 578-579, 627) | PASS |
| NFR-4 Rome time from one injectable clock; midnight and DST tested | T-2, T-4, T-7, T-10 | `ADMIN_CONFIG_CLOCK` is the only time source (no `new Date()` in services or rules; only in module bindings `cycles.module.ts:35`, `timelines.module.ts:37`); DATE round-trip `2026-11-02` on TEST (execution.md:529) | PASS |
| NFR-5 Fixed number of queries (50 timelines / 200 assignments) | T-7 | `timelines.service.ts:176-208` (one statement per table by ids) | e2e-t `:1182`; svc.spec `:1333` | PASS |
| NFR-6 No breaking change needed for loads | T-1, T-9 | `timeline_loads` / `timeline_results` not created; documented in TRD § 5.1, `front-contract.md` § 7, the module guide | PASS |
| NFR-7 One decision line per write, ids only | T-5, T-6, T-8 | `cycles.service.ts:217-273`, `timelines.service.ts:489-544` (fixed fields; reason = catalog code; never name, email or body) | svc.spec and e2e "decision line" blocks (one line per activation whatever the retries; no name or email in any log) | PASS |

## 7. Linting & Code Quality

### 7.1 Audit results

| Area (skill) | Check | Result |
|---|---|---|
| Authorization (nestjs `security-use-guards`) | `@RequirePermission(Permission.ADMIN_ACCESS)` at class level on both controllers; no `@Public`; 9 operations / 7 paths all covered by reflection tests | PASS |
| Input validation (`security-validate-all-input`) | class-validator DTOs; global whitelist; the role is checked at the pipe | PASS |
| Error envelope (error-handling, api-design) | Typed errors extend Nest HTTP exceptions with `errorBody(<catalog code>)` only; validation messages come only from `FIELD_ERRORS`; `TimelineUserNotEligibleError.detail` never reaches the answer or the log | PASS |
| Retry design (error-handling: retry) | Activation retries only on 1062 `uq_cycles_active_key` or 1213, at most 10 attempts, then a typed 503 with `cause`; other errors propagate | PASS |
| Transactions and locks (design § 7.3, `db-use-transactions`) | READ COMMITTED units of work; activate: target `FOR UPDATE` → active `FOR UPDATE` → close → activate; create: cycle `FOR UPDATE` before the kind decision; assign/remove: cycle `FOR SHARE`; rules and catalogs run **before** the transaction | PASS |
| N+1 (`db-avoid-n-plus-one`) | List and detail batch by ids | PASS |
| Logging privacy (NFR-7, `devops-use-logging`) | Structured JSON line; `reason` limited to `[A-Z_]{1,64}`; no body fields | PASS |
| REST semantics (api-design) | Resource nouns, `POST …/activate` as a sub-resource action, 201 / 200 for assign (DD-10), 204 for delete, `/api/v1` versioning, OpenAPI per route | PASS |
| Lint | 0 findings | PASS |

### 7.2 4R advisory findings (Auditor, advisory, not gating)

| # | 4R | Finding | Where |
|---|---|---|---|
| A-1 | RESILIENCE | An assign whose duplicate row vanishes twice ends in a bare `Error` → 500 (carried from T-8, unresolved) | `timelines.service.ts:390` |
| A-2 | READABILITY | Unreachable `Error('An additional timeline was refused as official')` has no named class (carried from T-6) | `timelines.service.ts:268` |
| A-3 | RESILIENCE | Lock-wait timeout 1205 is not retried on activate or create and surfaces as 500 (carried from T-5) | `cycles.service.ts:61-80` |
| A-4 | READABILITY | Stale docstrings: "never fires on the way" (the amended § 7.3 says "while an active row exists"); "over both catalogs" (amended § 7.2 step 2 reads only what is needed) | `cycles.service.ts:159`; `timelines.service.ts:214` |
| A-5 | READABILITY | Cycles reuse the users `FieldValidationError` for `year`, while DD-7 has admin-config own its validation error (carried from T-5) | `cycles.service.ts:3,85-91` |
| A-6 | RELIABILITY | No rule row uses the FR-10 "Regrouped" fixture `1,1,1,2,2` literally; the generic rows cover the rule (carried from T-3) | `timeline-rules.spec.ts:435-436` |

### 7.3 Unresolved ADVISORY findings carried from `execution.md`

| # | From | Finding | Status at HEAD |
|---|---|---|---|
| A-7 | T-2, T-4 | `StepAudience` is declared twice (`default-steps.ts:2` and `schema/timeline-steps.ts`) | Open |
| A-8 | T-2, T-3 | `FieldIssue` is still imported from `users/` | Open (`admin-config.errors.ts:8`) |
| A-9 | T-3 | The overlap check is skipped when the previous step's closing date is missing, so a real overlap only shows in a second round | Open |
| A-10 | T-4 | Readiness codes are typed `string[]`, not a union | Open (`timeline-view.ts:26`) |
| A-11 | T-8 | NFR-2 is not asserted for the assign body (unknown field) | Open (global pipe covers it) |
| A-12 | T-6 | A `null` scope list is treated as absent | Documented in `front-contract.md` § 5, not in design § 6 |
| A-13 | T-7 | `TimelinesStore.cycleExists` is a second owner of cycle reads | Open |
| A-14 | T-1, T-9 | `utf8mb4_0900_ai_ci` also ignores accents ("Julio" = "Júlio"), beyond FR-6's "letter case"; TRD and contract say "case" only | Open: a business question |
| A-15 | T-9 | `front-contract.md` § 6 nests `### Error codes` under `## 6. Error codes`; the § 5 "Cycle year" row omits `REQUIRED`; the module guide Files table omits `*.module.ts` | Open |
| A-16 | T-6, T-8 | Test-quality items: a 403-matrix catalog assertion that checks switches only; fake-timing-dependent interleave test; no remove-vs-remove concurrency test | Open |

## 8. Design Conformance

**Result: WARN.** The code matches the approved design and all six execute-time amendments. One amendment did not reach design § 6.

### 8.1 Execute-time amendments (all back-lead approved)

| Amendment | Spec text at HEAD | Code | Result |
|---|---|---|---|
| FR-11 field path `programIds` | `requirements.md` FR-11 THEN line | `timeline-rules.ts` uses `programIds` / `resultTypeKeys` | PASS |
| § 7.2 step 1 (lists and dates optional at the pipe) | `design.md:195` | `create-timeline.dto.ts`; `timelines.service.ts:87-95` | PASS |
| § 7.2 step 2 (read only the catalogs needed) | `design.md:196` | `timelines.service.ts:448-459` | PASS |
| § 6 `TimelineCreate` lists optional | `design.md:175` | DTO | PASS |
| § 7.3 Activate: up to 10 attempts → 503 | `design.md:206` | `cycles.service.ts:50,162-177`; `admin-config.errors.ts:37-41` | PASS |
| § 7.4 six list queries | `design.md:216` | `timelines.service.ts:160-185` (`cycleExists` + timelines + 4 by ids) | PASS |
| § 8 "no step silently dropped…" wording | `design.md:248` | n/a (docs) | PASS |

### 8.2 Drift and cross-document figures

| Item | Documents | Finding | Result |
|---|---|---|---|
| Activate route errors | `design.md:159` (§ 6) vs `cycles.controller.ts:130`, `front-contract.md` § 3, the module guide | § 6 lists only 404 / 409. The § 7.3 amendment added 503 `SERVICE_UNAVAILABLE`, which is shipped and documented everywhere else. **§ 6 was not updated** | **WARN** |
| "8 codes, 7 field codes" | design § 7.5 / § 9, tasks T-2, front-contract § 6, `error-codes.ts:231-260,320-330` | Consistent | PASS |
| "six tables" | requirements, design § 5, TRD § 5.1, `0003` (6 CREATE TABLE), the module guide | Consistent | PASS |
| "1–5 steps" / five defaults | FR-4, FR-7, `default-steps.ts`, contract | Consistent | PASS |
| "six queries" | design § 7.4, the module guide | Consistent; the detail is 5 + 1 users statements | PASS |
| Routes "3 + 6" (9 operations, 7 paths) | the module guide, TRD § 6, contract § 3, reflection tests | Consistent | PASS |
| Task count | `tasks.md` header and graph say "10 tasks (9 build + 1 HITL)"; 11 exist (T-11 added) | The header and graph were not refreshed (the execution Summary records 11 and the overrun was accepted) | Advisory |
| Budget | design § 10: ~2,600 LOC / 14 rounds; actual ~14k insertions / 18 verdicts | Overrun accepted by the back lead at the tripwire (execution.md:475) | Advisory |
| "Last updated" | `requirements.md` and `design.md` say 2026-10-20 | Amended on 2026-10-21 | Advisory |

### 8.3 Proposal intent and non-goals

| Proposal item | Still holds | Note |
|---|---|---|
| Intent: ADMIN creates cycles and timelines, assigns users, sees computed status and readiness | Yes | |
| Non-goals: loads, edit steps, visibility, pause / extend / advance, reopen, front | Yes | No such route or table; reserved tables not created |
| D-1 Rome dates, labeled by the front | Yes | `front-contract.md` § 1 |
| D-3 Science Programs never assigned | Yes | `programs` → no role; no readiness item |
| D-4 ADMIN only | Yes | |
| D-7 explicit scope for every timeline | Yes | |
| R-1 TRD edited as a named deliverable | Yes | T-9 |
| R-3 "`qadb` gets migration `0003` by a human step" | Changed | The back lead moved the HITL to TEST (pipeline-applied). Whether `qadb` itself has `0003` is not recorded (§ 9, § 11) |

## 9. Test Evidence Summary

**Result: WARN.** Automated evidence is complete and green. Real-MySQL evidence exists for every concurrency clause, with three gaps.

| Layer | Evidence | Result |
|---|---|---|
| Schema pins | `schema.spec.ts`: migration count 4, every `chk_*` / `uq_*`, generated `active_key` / `official_key`, collation, exact SQL; 3 falsifiers executed (T-1) | PASS |
| Pure rules | rules / view / rome-date / default-steps specs; boundary rows; falsifiers executed (T-2…T-4); two-`TZ` runs recorded (T-2) | PASS |
| Services over lock-modelling fakes | cycles / timelines service and unit-of-work specs, concurrency sweeps, 1062 / 1213 emulation | PASS |
| HTTP | 2 e2e suites: 401/403 matrices, envelopes, idempotency, OpenAPI | PASS |
| Real MySQL (HITL, TEST) | DATE round-trip; 20 concurrent creates → 1 official; 20 assigns → 1 row; 20 activations → 1 active; 10 duplicate-year creates → 1 × 201; T-11 re-check 5 and 10 → no 500, 1 active | PASS (with gaps below) |

| Gap | Evidence | Result |
|---|---|---|
| G-1 Back-lead acknowledgment of the TEST run (agent-run with the back lead's token) is "Owed" | execution.md:628; no later entry | WARN |
| G-2 The T-11 "none active" scenario (the one that produced the 500) was not re-run after the fix; the re-check used distinct drafts with an active cycle present. The 2-vs-10 proof is unit-level (k = 1, 2, 5, exhaustion + F1) | execution.md:577, 581 | WARN (accepted limit) |
| G-3 Permanent synthetic data on TEST: cycles 2077–2099 (one of them, 2084, is the **active** cycle), 21+ timelines, 1 assignment. No delete route exists | execution.md:522, 580, 627 | WARN: front integration on TEST will see these |
| G-4 `SHOW FULL COLUMNS FROM users` collation check is not run; `qadb` migration status is not recorded | execution.md:587 | Advisory (follow-up) |

No `test-report.md` exists. Coverage was verified directly (§ 6).

## 10. Agent Guide / Constitution Impact

**Result: WARN.**

| Guide | State | Result |
|---|---|---|
| `server/src/admin-config/AGENTS.md` | Present and current: model, files, ADMIN rule, Rome dates, clock, FR-11 one round, DD-6, DD-3, DD-9 lock order, activation retry (10 → 503), assignments, no PII, six queries, idempotency target id, reserved tables, testing | PASS (Files-table nit A-15) |
| `server/AGENTS.md` layout row | `server/AGENTS.md:23` points to the module guide | PASS |
| `server/src/common/AGENTS.md` idempotency target id | `:28` documents the cycle and timeline ids | PASS |
| `server/src/database/AGENTS.md` schema guarantees | Updated in T-1 | PASS |
| `docs/trd/trd.md` §§ 4 / 5.1 / 6 | Six tables, reserved two, resource map; `windows` appears only in the superseded note (line 188) | PASS |
| Root `AGENTS.md` domain row | `:30` reads "Cycles and QA timelines …" (synced by explicit user instruction) | PASS |
| Root `AGENTS.md` `## Module Guides` index | Lines 78–85 list the server child guides but **not** `server/src/admin-config/AGENTS.md` | **WARN** |
| Constitution rules (branching, English, commits) | Branch `feat/…`; English docs and code; semantic `[SPEC:…]` commits | PASS |

## 11. Remediation

| # | Severity | Action | Owner | When |
|---|---|---|---|---|
| R-1 | WARN | Add 503 `SERVICE_UNAVAILABLE` to the activate row of `design.md` § 6 (line 159), as a one-line erratum matching the approved § 7.3 amendment | Leader (docs) | Before archive |
| R-2 | WARN | Record the back lead's one-line acknowledgment of the TEST run in `execution.md` (G-1) | Back lead | Before archive |
| R-3 | WARN | Add `server/src/admin-config/AGENTS.md — cycles, timelines, Rome-date rules, activation retry` under `server/AGENTS.md` in the root `## Module Guides`. Per the shared-file write discipline, apply it at `/akili-archive` on the apply-capable branch, or on this branch only by explicit user instruction | Leader / back lead | At archive |
| R-4 | WARN | Decide what to do with the synthetic TEST data (active cycle 2084 and cycles 2077–2099) before P2-3934 integrates against TEST (G-3) | Back lead | Before front integration |
| R-5 | Advisory | Re-run the none-active concurrent activation on a fresh environment when one exists, e.g. `qadb` after `0003` (G-2). Record `qadb` migration status and the collation check (G-4) | Back lead | Follow-up |
| R-6 | Advisory | Refresh the `tasks.md` header and graph (11 tasks) and the "Last updated" dates in requirements and design | Leader (docs) | At archive |
| R-7 | Advisory | Backlog: A-1…A-16 (named errors for the two bare `Error`s, 1205 retry, `StepAudience` / `FieldIssue` / readiness typing, overlap fallback, accent-insensitive collation business question, contract nits) | Back lead | Kaizen / next spec |

## 12. Archive Readiness Recommendation

**Ready to archive: YES, once R-1 and R-2 are closed. R-3 is applied as part of the archive guide sync.**

| Criterion | Status |
|---|---|
| All tasks closed with a recorded verdict | Yes |
| All gates green at HEAD (lint, build, unit 1722, tsc baseline 7, e2e 715) | Yes |
| Every FR and NFR scenario and clause evidenced | Yes |
| No FAIL, no BLOCKED | Yes |
| Open WARNs | 3 sections (design § 6 drift, owed and limited HITL evidence, root guide index), all closable with docs or a human one-liner; no code change required |

Next: close R-1 and R-2, then run `/akili-archive admin-config/cycle-timelines` (apply R-3 and R-6 there), then open the PRs to `staging-center` (PR 1 = T-1…T-5, PR 2 = T-6…T-11).
