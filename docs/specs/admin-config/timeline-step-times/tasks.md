# Timeline step times — Tasks

| | |
|---|---|
| Spec path | `docs/specs/admin-config/timeline-step-times` |
| Branch | `feat/timeline-step-times` (from `origin/staging-center` @ `8ac4df7`) |
| Commits | `[SPEC:admin-config/timeline-step-times] <emoji> <type>(timelines) P2-4020: …` |
| Budget (design § 12) | 8 tasks (7 build + 1 HITL) · ≈ 450 production LOC + ≈ 900 test LOC · ≈ 10 review rounds. Tripwire: stop and escalate when exceeded |
| Verification (server) | `cd server && pnpm lint && pnpm build && pnpm test --reporter=dot`, plus `pnpm test:e2e --reporter=dot` where stated |
| PRs | One PR (≈ 1,350 LOC, about two thirds of it fixture updates). Review it in commit order: T-1 → T-7. If a reviewer asks for a split: PR 1 = T-1…T-3 (helpers, rename, storage and clock), PR 2 = T-4…T-8 |

Status: `[ ]` pending · `[~]` in progress · `[x]` done (after a Reviewer PASS, a recorded `REVIEW_WAIVED`, or a `REVIEW_SKIPPED`).

## Dependency graph

```
T-1 ─▶ T-3 ─▶ T-4 ─▶ T-5 ─▶ T-6 ─▶ T-7 ─▶ T-8 (HITL)
T-2 ─▶ T-3
```

- **Each task leaves the build and every suite green.** That is why the rename (T-2) comes before the change in meaning (T-3): T-2 changes names only, and T-3 changes values only.
- **Serial boundaries:**
  - Only T-3 touches `server/src/database/**` and `server/drizzle/**`.
  - Only T-4 touches `server/src/common/error-codes.ts`.
  - T-2, T-3, T-4, T-5 and T-6 share the timeline suites and `test/support/in-memory-*.ts`, so they run one after another.

---

## T-1: Rome time helpers and the single zone constant
- **Status:** [ ]
- **Size:** M
- **Depends on:** none
- **Requirements:**
  - FR-1: Malformed or missing moment. The shape check rejects seconds, an offset, `2026-02-30T10:00` and `…T24:00`.
  - FR-4: Spring and autumn. The detector is true for `2027-03-28T02:30` and `2026-10-25T02:15`, and false for `2026-10-25T03:00` and `…T01:59` (the BUT clause).
  - FR-4: A step that spans the change. `nowInRome` gives `2026-10-25T02:30` for both UTC instants of that Rome time.
  - FR-10: the constant exists.
  - NFR-1: the helper tests run under both zones.
- **Design refs:** § 7.1; DD-1, DD-2, DD-3, DD-4; P-1
- **Scope:**
  - In `server/src/admin-config/rome-date.ts`, add:
    - `QA_TIME_ZONE`, with the day formatter now reading it;
    - the branded `RomeMinute` type;
    - `isRomeMinute`, `nowInRome`, `dayStart`, `dayEnd`, `dayOf`, `isDstHour`, and a minute comparison.
  - `todayInRome` stays for now; T-3 removes it.
  - Not touched: callers, `client/`.
- **Tests:** `server/src/admin-config/rome-date.spec.ts` (new, or extended if it exists):
  - the shape table;
  - `nowInRome` around midnight and across both DST changes;
  - `isDstHour` on 2026-10-25 and 2027-03-28 and on an ordinary day;
  - `dayStart`, `dayEnd` and `dayOf` round-trips;
  - assigning a `YYYY-MM-DD` string to a `RomeMinute` is a type error (`@ts-expect-error`).
- **Verification:** the server command, then `cd server && TZ=UTC pnpm test rome-date --reporter=dot && TZ=America/Bogota pnpm test rome-date --reporter=dot`.
- **Falsifier:**
  - Make `nowInRome` format with the process zone instead of `QA_TIME_ZONE`. The `America/Bogota` run goes red on the midnight case (`2026-11-09T23:30Z` is `2026-11-10T00:30` in Rome and `2026-11-09T18:30` in Bogotá).
  - Make `isDstHour` true for any 02:xx. The ordinary-day case goes red.
- **Red run:** the new cases fail on their assertions, because the functions are undefined, before the helpers exist.
- **Disqualifier:**
  - Tests that build their expected values with the same `Intl` call as the code (a tautology). Expected values are written out by hand.
  - A single-zone run.
- **Consumers:** none (only additions; `todayInRome` is unchanged).
- **Review:** checklist. Pure functions with written-out tables.
- **Done when:**
  - The table cases pass in both zones.
  - The `@ts-expect-error` case compiles, which proves the type error exists.
- **Skills:** nestjs-best-practices, tdd

## T-2: Rename step boundaries and "today" inside the server, with no change in behavior
- **Status:** [ ]
- **Size:** M
- **Depends on:** none
- **Requirements:** none directly. This task prepares T-3 so that T-3's diff carries only the change in meaning (design § 2).
- **Design refs:** § 7.2–7.6; P-6, P-7, P-9
- **Scope:**
  - Rename these in the server:
    - Drizzle properties `opensOn` / `closesOn` → `opensAt` / `closesAt`. The **columns stay `opens_on` / `closes_on`**.
    - Domain and port types: the rules inputs and contexts, `TimelineViewInput`, `TimelineStart`, the diff input.
    - Context and parameter `today` → `now`.
  - Values stay `YYYY-MM-DD`, and `todayInRome` still feeds `now`.
  - **API keys, error paths and audit keys stay `opensOn` / `closesOn`.** The response mapper, the DTO-to-rules mapping and the diff key names map explicitly.
  - Files:
    - `timelines/{timeline-rules,timeline-view,timelines.service,timelines.store,timeline-response,timeline-diff}.ts`
    - `field-config/{field-config-versions,field-config.store}.ts`
    - `cycles/cycles.store.ts`
    - `database/drizzle/schema/timeline-steps.ts` (property names only)
  - Not touched: SQL, migrations, DTO and OpenAPI keys.
- **Tests:** the 15 files of P-9 are updated for the renamed internals only. No expected API body, error path or audit key changes.
- **Verification:**
  - The server command plus `pnpm test:e2e --reporter=dot`.
  - The test count equals the count before the task.
  - `git diff --stat` on the e2e suites shows no change to expected response bodies.
- **Falsifier:** let the response mapper emit `opensAt` instead of `opensOn`. The e2e body assertions in `test/admin-config-timelines.e2e-spec.ts` go red, which proves the API is still pinned by name.
- **Red run:** n/a (a refactor; the gate is "still green").
- **Disqualifier:**
  - Any edited expected value in an e2e or API-level test: that means behavior moved.
  - A lower test count.
- **Consumers:**
  - The 15 files of P-9.
  - `server/src/database/drizzle/schema/schema.spec.ts`, which pins columns: the SQL names do not change, so the pins stay.
- **Review:** checklist. A mechanical rename. The Reviewer checks that no expected value changed.
- **Done when:**
  - The build and every suite are green with the same count.
  - `grep -rnE "\.opensOn|\.closesOn|today:" server/src --include='*.ts' | grep -v spec` returns only the API edge (DTOs, response, diff key literals).
- **Skills:** nestjs-best-practices

## T-3: Store minutes and judge by now (schema, migration `0006`, clock)
- **Status:** [ ]
- **Size:** M (the largest; if the budget trips, split the migration into its own task)
- **Depends on:** T-1, T-2
- **Requirements:**
  - FR-2: Boundaries (13:59:59 / 14:00:00 / 17:30:59 / 17:31:00); AND IT MUST, whatever the process zone; Whole-day window unchanged.
  - FR-4: A step that spans the change (view at 02:30 on 2026-10-25).
  - FR-7: The hold starts at the hour, with its BUT (not on hold at 00:00); Between two steps on the same day.
  - FR-8: Published the same morning; Published in the opening minute.
  - FR-9: Old client creates (the day-only write becomes 00:00 / 23:59; the response derives the days).
  - FR-11: Migrated timeline (SQL pin and reading old values as 00:00 / 23:59).
  - FR-13: Unchanged shape.
  - NFR-3: statement pin. NFR-4: statement counts unchanged in the unit-of-work suites.
- **Design refs:** § 5, § 7.1, § 7.3–7.6; DD-1, DD-2, DD-3, DD-6, DD-9; P-2, P-3, P-5, P-7, P-12
- **Scope:**
  1. **First step: settle P-3.**
     - Change `timeline-steps.ts` to `DATETIME` columns `opens_at` / `closes_at`, using a custom column type that maps to `RomeMinute`, and the strict check.
     - Run `cd server && pnpm drizzle-kit generate --custom --name timeline_step_times`.
     - Record in `execution.md` whether it produced an empty SQL file and a snapshot of the new schema.
     - If not, **stop and use the Pivot Protocol** (DD-6). Never edit the snapshot by hand.
  2. Write `server/drizzle/0006_timeline_step_times.sql` (design § 5, in order) and `server/drizzle/rollback/0006_timeline_step_times.down.sql`.
  3. Update `server/src/database/AGENTS.md`: the `0006` note. It is **not** additive: rename, type change, data rewrite of `closes_at`, applied by a human, with a lossy down script.
  4. Switch the meaning:
     - `timelines.service.ts` and `field-config-versions.ts` call `nowInRome` (the six sites of P-6), and `todayInRome` is removed.
     - In the rules reader, a day-only `opensOn` / `closesOn` becomes `dayStart` / `dayEnd`.
     - The response derives `opensOn` / `closesOn` with `dayOf`.
     - `cycles.store.ts` maps min/max to `dayOf`.
     - The field-config version counts when `nowInRome(publishedAt) < opensAt`.
  5. Fixtures in the P-9 files move from days to minutes (`…T00:00` / `…T23:59` wherever a test means the old whole day).
- **Tests:**
  - `schema.spec.ts`:
    - the migration count goes from 6 to 7 (`schema.spec.ts:303`);
    - `0006` holds exactly the four steps of design § 5, in order;
    - the down script reverses them.
  - `timeline-view.spec.ts`: the FR-2, FR-7 and FR-4 (span) scenarios with pinned minutes.
  - `field-config-versions.spec.ts`: both FR-8 scenarios.
  - Unit-of-work suites: the column names in statements, and statement counts unchanged (NFR-4).
  - Service spec: a day-only create stores `T00:00` / `T23:59`.
  - `cycles` store spec: `startsOn` / `endsOn` stay `YYYY-MM-DD`.
- **Verification:**
  - The server command plus `pnpm test:e2e --reporter=dot`.
  - `TZ=UTC pnpm test --reporter=dot` and `TZ=America/Bogota pnpm test --reporter=dot` (NFR-1).
  - Read `0006` and the down script line by line against design § 5.
- **Falsifier:**
  - Keep `todayInRome` feeding `now`. `2026-11-10` sorts before `2026-11-10T14:00` (it is a strict prefix), so at 14:00 the timeline stays `scheduled` all day. The "hold starts at the hour" case, which expects `waiting_for_load` at 14:00, goes red.
  - Make `closes_at` keep `00:00` in the migration (drop the UPDATE). The `0006` pin goes red.
  - Compare the publish **day** instead of the minute. "Published the same morning" goes red (A would not get version 3).
- **Red run:** the new view, version and schema cases fail on their assertions before step 4 and the SQL exist.
- **Disqualifier:**
  - A `0006` pin that only checks that the file exists.
  - Fixtures changed to make tests pass without the scenario stated in the test name.
  - A single-zone run.
  - A unit-of-work statement count that changed without a design reason.
- **Consumers:**
  - `schema.spec.ts:303` (the migration count).
  - `server/drizzle/meta/_journal.json`.
  - The P-9 files.
  - `server/test/support/in-memory-admin-config.ts` and `in-memory-field-config.ts` (they emulate the stores).
- **Review:** full. Shared boundary (database) and a permanent migration.
- **Done when:**
  - Every listed scenario is green in both zones.
  - `0006` and the down script match design § 5.
  - P-3 is settled and recorded in `execution.md`.
  - `todayInRome` has no caller.
- **Skills:** nestjs-expert, nestjs-best-practices, tdd

## T-4: Minute-level write rules (moments, compatibility, DST, codes)
- **Status:** [ ]
- **Size:** M
- **Depends on:** T-3
- **Requirements:**
  - FR-1: Valid moments; Malformed or missing moment, with its BUT (not dropped, not read in another zone).
  - FR-3: Same moment or reversed; Two steps on the same day; Overlap, with its AND IT MUST (`12:01` accepted).
  - FR-4: Spring and autumn, with its BUT (03:00 and 01:59 accepted).
  - FR-5: Earlier today, with its AND IT MUST (the current minute is accepted and the step is in progress at once).
  - FR-6: Close an in-progress step now, with its BUT (`14:19` refused); Unchanged past moment.
  - FR-9: Both forms for the same moment, with its BUT (never picked silently, even when they agree); Day-only edit over a stored time, with its BUT (counts as a change to 23:59).
- **Design refs:** § 6, § 7.2, § 7.8; DD-5, DD-7; P-10, P-11
- **Scope:**
  - `dto/create-timeline.dto.ts` and `dto/update-timeline.dto.ts`: optional `opensAt` / `closesAt`.
  - `timeline-rules.ts`: the boundary reader of design § 7.2 (both forms → `INVALID` on `…On`; `isRomeMinute`; `DST_HOUR`; key memory), strict `CLOSES_BEFORE_OPENS`, and errors on the key that was sent.
  - `common/error-codes.ts`: `DST_HOUR` and its message.
  - Not touched: the response shape (T-5).
- **Tests:**
  - `timeline-rules.spec.ts`: one case per scenario above, each written with pinned `now`, and the same rules run with both forms of input.
  - `dto` specs: the new keys are accepted.
  - `error-codes.spec.ts`: `DST_HOUR` is in the catalog with its message.
- **Verification:** the server command, plus `pnpm test:e2e --reporter=dot`. This last one must stay green: old clients send day-only values.
- **Falsifier:**
  - Change the close check back to `<` (not strict). "Same moment" goes red.
  - Report errors always on `…At`. A day-only overlap case expecting `steps[1].opensOn` goes red.
  - Prefer `…At` silently when both forms are sent. The "both forms" case goes red.
- **Red run:** the new rule cases fail on their assertions before the reader changes. For example, `DST_HOUR` is not reported, and a same-minute step is accepted.
- **Disqualifier:**
  - A case that asserts only the status 400 without the field and code.
  - DST cases on dates that are not real change days.
- **Consumers:**
  - `server/src/common/error-codes.spec.ts:220-255,315`.
  - Client `client/src/app/core/http/api-envelope.ts:30-32` (codes comment): changed only through `front-contract.md` (T-7).
- **Review:** full. Every user-facing rule of the spec is here.
- **Done when:**
  - Every listed scenario, BUT and AND IT MUST clause has a named test that is green.
  - The e2e suite is unchanged and green.
- **Skills:** nestjs-expert, api-design-principles, error-handling-patterns, tdd

## T-5: API surface (moments and time zone in responses, OpenAPI, audit keys)
- **Status:** [ ]
- **Size:** S
- **Depends on:** T-4
- **Requirements:**
  - FR-1: Valid moments (returned exactly).
  - FR-9: Read (both forms returned).
  - FR-10: Read, with its AND IT MUST (`timeZone` comes from the same constant).
  - FR-12: Time-only change, with its BUT (no `steps.2.closesOn` key).
- **Design refs:** § 6, § 7.7; DD-7, DD-8; P-8
- **Scope:**
  - `timeline-response.ts`: `opensAt` / `closesAt` and `timeZone`.
  - `models/timeline.model.ts`: the four keys plus `timeZone`, with `…On` deprecated and examples.
  - `timeline-diff.ts`: keys `opensAt` / `closesAt`.
- **Tests:**
  - Response mapper and diff specs.
  - `test/openapi.e2e-spec.ts` / `src/config/openapi.config.spec.ts`: pin the new properties and `deprecated: true` on `…On`.
  - E2e: a read carries `timeZone: "Europe/Rome"`.
- **Verification:** the server command, plus `pnpm test:e2e --reporter=dot`.
- **Falsifier:**
  - Hardcode `'Europe/Rome'` in the mapper instead of `QA_TIME_ZONE`. NFR-2's grep (T-6) finds two hits.
  - Write the diff key as `closesOn`. The FR-12 case goes red.
- **Red run:** the mapper, diff and OpenAPI cases fail on their assertions before the change.
- **Disqualifier:** an OpenAPI pin that checks only that the schema exists, not its properties.
- **Consumers:**
  - `test/openapi.e2e-spec.ts`, `src/config/openapi.config.spec.ts`, `timeline-diff.spec.ts`.
  - The front readers of P-8: additive change, so nothing breaks; they are listed in `front-contract.md`.
- **Review:** checklist. An additive contract change with pins.
- **Done when:** responses, OpenAPI and audit keys match design § 6 and § 7.7, and the pins are green.
- **Skills:** nestjs-expert, api-design-principles

## T-6: End-to-end scenarios and the cross-cutting NFR checks
- **Status:** [ ]
- **Size:** M
- **Depends on:** T-5
- **Requirements:**
  - Through HTTP with the pinned `ADMIN_CONFIG_CLOCK`: FR-1 Valid moments; FR-2 Boundaries; FR-3 Two steps on the same day; FR-5 Earlier today; FR-7 The hold starts at the hour; FR-8 Published the same morning; FR-9 Old client creates and Both forms.
  - NFR-1 (full suites in two zones); NFR-2 (single zone definition); NFR-4 (list read cost).
- **Design refs:** § 3, § 6; P-5, P-11
- **Scope:**
  - `server/test/admin-config-timelines.e2e-spec.ts` and `admin-config-field-config.e2e-spec.ts`: new `describe('step times (P2-4019)')` blocks.
  - No production code. A failure found here goes back to its owning task (T-3, T-4 or T-5) through the Pivot Protocol.
- **Tests:** as above.
- **Verification:**
  - `cd server && TZ=UTC pnpm test:e2e --reporter=dot && TZ=America/Bogota pnpm test:e2e --reporter=dot`.
  - `grep -rn "Europe/Rome" server/src --include='*.ts' --exclude='*.spec.ts' | grep -v '^\S*:\s*//'` returns 1 code line (`QA_TIME_ZONE`).
  - The unit-of-work list test's statement count is unchanged from `8ac4df7`.
- **Falsifier:**
  - Pin the clock at `2026-11-10T13:59:59` Rome instead of 14:00. The hold case expecting `waiting_for_load` goes red.
  - Add a second `'Europe/Rome'` literal. The grep returns 2.
- **Red run:** n/a. The behaviors are built in T-3…T-5. The e2e cases are written against them; a red here is a finding.
- **Disqualifier:**
  - E2e cases that pin the clock to midnight only, where days and minutes agree.
  - A grep whose pattern misses `"Europe/Rome"` in double quotes.
- **Consumers:** `server/test/support/admin-config-app.ts:188-189` (the clock override).
- **Review:** checklist. Tests only, against named scenarios.
- **Done when:**
  - All listed scenarios are green over HTTP in both zones.
  - The NFR-2 grep returns 1.
  - The NFR-4 count is unchanged.
- **Skills:** nestjs-expert, tdd

## T-7: Front contract and module guide
- **Status:** [ ]
- **Size:** S
- **Depends on:** T-6
- **Requirements:** FR-14: Contract matches the server.
- **Design refs:** § 8, § 9; DD-5, DD-7, DD-8; P-8
- **Scope:**
  - New `docs/specs/admin-config/timeline-step-times/front-contract.md`. It covers:
    - the fields, `timeZone`, `DST_HOUR`, the new meaning of `BEFORE_TODAY` and `CLOSES_BEFORE_OPENS`;
    - the error-key rule, the compatibility window, and the audit key change;
    - the P-8 files the front must update;
    - for P2-4021: AC 1 (hour and minute picker; `qa-date-picker` picks days only today), AC 2 (labels show the stored times; `client/src/app/core/domain/rome-date.ts:55-62` assumes 00:00 / 23:59), AC 7 (Reset to official keeps the times; `cycle.logic.ts:172-182` shifts whole days);
    - same-day steps (the reversion challenge in design § 10).
  - `server/src/admin-config/AGENTS.md`: step moments, now-based rules, `QA_TIME_ZONE`.
  - Not touched: `client/`.
- **Tests:** none (documentation).
- **Verification:** cross-check every field and code in `front-contract.md` against the OpenAPI document produced by `pnpm test:e2e` (openapi suite) and `error-codes.ts`. Every name exists there.
- **Falsifier:** a contract that names `opensAtUtc` or `DST_GAP` fails the cross-check.
- **Red run:** n/a (no test gate).
- **Disqualifier:** a cross-check done from memory instead of against the generated OpenAPI and the catalog file.
- **Consumers:** P2-4021 (front lead).
- **Review:** checklist. A documentation contract.
- **Done when:** the contract and the guide are written, and the cross-check finds 0 unknown names.
- **Skills:** cognitive-doc-design, api-design-principles

## T-8 (HITL): Apply `0006` and its down script on a local MySQL; back lead sign-off
- **Status:** [ ]
- **Size:** S
- **Depends on:** T-7
- **Requirements:**
  - FR-11: Migrated timeline (real database).
  - NFR-3: up + down round-trip.
  - P-4: MySQL version.
- **Design refs:** § 5; DD-6; P-4, P-12
- **Scope:**
  - The **back lead** (never an agent):
    1. Runs `SELECT VERSION()` on a **local** MySQL (8.0.16 or later).
    2. Loads a copy holding timeline steps and applies `0006`.
    3. Checks that every `closes_at` is `… 23:59:00` and every `opens_at` is `… 00:00:00`.
    4. Reads one timeline through the API and compares status and steps with the pre-migration read.
    5. Applies the down script and checks that the day values are identical to the copy.
  - `qadb` is migrated only after the PR is approved, as a separate human step.
- **Tests:** manual.
- **Verification:** the checklist above, recorded in `execution.md` with the MySQL version and the row counts.
- **Falsifier:** a copy with no steps would prove nothing. The checklist requires at least one timeline with two or more steps.
- **Red run:** n/a (manual).
- **Disqualifier:** a run against `qadb`, TEST or PROD; or against an empty table.
- **Consumers:** none.
- **Review:** n/a. A human gate.
- **Done when:** the back lead records PASS in `execution.md`.
- **Skills:** none

---

## Coverage (scenario and clause level)

| Requirement | Scenario / clause | Task(s) |
|---|---|---|
| FR-1 | Valid moments | T-4 (rule), T-5 (returned), T-6 (HTTP) |
| FR-1 | Malformed or missing; BUT not dropped, not another zone | T-1 (shape), T-4 |
| FR-2 | Boundaries; AND IT MUST whatever the process zone | T-3, T-6 |
| FR-2 | Whole-day window unchanged | T-3 |
| FR-3 | Same moment or reversed | T-4 |
| FR-3 | Two steps on the same day | T-4, T-6 |
| FR-3 | Overlap; AND IT MUST accept 12:01 | T-4 |
| FR-4 | Spring and autumn; BUT 03:00 / 01:59 accepted | T-1 (detector), T-4 (rule) |
| FR-4 | A step that spans the change | T-1 (`nowInRome`), T-3 (view) |
| FR-5 | Earlier today; AND IT MUST accept the current minute | T-4, T-6 |
| FR-6 | Close an in-progress step now; BUT 14:19 refused | T-4 |
| FR-6 | Unchanged past moment | T-4 |
| FR-7 | The hold starts at the hour; BUT not at 00:00 | T-3, T-6 |
| FR-7 | Between two steps on the same day | T-3 |
| FR-8 | Published the same morning | T-3, T-6 |
| FR-8 | Published in the opening minute | T-3 |
| FR-9 | Old client creates | T-3 (write and derive), T-5 (both returned), T-6 |
| FR-9 | Both forms; BUT never picked silently | T-4, T-6 |
| FR-9 | Day-only edit over a stored time; BUT counts as a change | T-4 |
| FR-10 | Read; AND IT MUST same definition | T-5, T-6 (NFR-2) |
| FR-11 | Migrated timeline | T-3 (pin), T-8 (real) |
| FR-12 | Time-only change; BUT no `closesOn` key | T-5 |
| FR-13 | Unchanged shape | T-3 |
| FR-14 | Contract matches the server | T-7 |
| NFR-1 | Two-zone runs | T-1, T-3, T-6 |
| NFR-2 | One zone definition | T-6 |
| NFR-3 | Up + down round-trip | T-3 (statement pin), T-8 |
| NFR-4 | Read cost unchanged | T-3, T-6 |

`skip-eligible` tasks: none.
