# Edit a QA timeline — Tasks

| | |
|---|---|
| Spec path | `docs/specs/admin-config/timeline-edit` |
| Branch | `feat/timeline-edit` (from `origin/feat/cycle-timelines` @ `c2cab59`) |
| Commits | `[SPEC:admin-config/timeline-edit] <emoji> <type>(cycle) P2-3936: …` |
| Budget (design § 2) | 9 tasks (8 build + 1 HITL) · ≈ 3,900 LOC incl. tests · ≈ 13 review rounds. Tripwire: stop and escalate when exceeded |
| Verification (server) | `cd server && pnpm lint && pnpm build && pnpm test --reporter=dot`, plus `pnpm test:e2e --reporter=dot` where stated |
| PRs | PR 1 = T-1…T-4 (schema, read model, rules, store) · PR 2 = T-5…T-9 (service, route, e2e, docs, HITL) |

Status: `[ ]` pending · `[~]` in progress · `[x]` done (after a Reviewer PASS, a recorded `REVIEW_WAIVED`, or a `REVIEW_SKIPPED`).

## Dependency graph

```
T-1 ──────────────▶ T-4 ─┐
T-2 ─────────────────────┼─▶ T-5 ─▶ T-6 ─▶ T-7 ─▶ T-8 ─▶ T-9 (HITL)
T-3 ─────────────────────┘
```

- T-4 depends on T-1. T-5 depends on T-2, T-3 and T-4. Each later task depends on the one before it.
- **Serial boundaries:**
  - Only T-1 touches `server/src/database/**`.
  - Only T-3 touches `server/src/common/error-codes.ts` and `admin-config.errors.ts`.
  - T-2, T-4, T-5 and T-7 share `test/support/in-memory-admin-config.ts`. T-2 and T-7 share `test/admin-config-timelines.e2e-spec.ts`. These tasks run one after another, never in parallel.

---

## T-1: Schema and migration `0004` (version, last edit, audit table)
- **Status:** [x]
- **Size:** M
- **Depends on:** none
- **Requirements:** FR-9 (Two admins — the version column the conditional write relies on), FR-10 (Append-only — no update columns; One record per edit — the table), NFR-8 (storage)
- **Design refs:** § 5; DD-6, DD-10; P-9
- **Scope:**
  - `server/src/database/drizzle/schema/timelines.ts`: add `version` (default 1), `updated_at`, `updated_by`, and the CHECK that the last two are both set or both null.
  - New `schema/timeline-audit-events.ts`, exported from `schema/index.ts`.
  - Generated `server/drizzle/0004_timeline_edit.sql` and its meta.
  - `schema.spec.ts`: migration count 4 → 5, `0004` additive and exact.
  - `server/src/database/AGENTS.md`: schema guarantees.
  - Not touched: `0000`–`0003`, other tables.
- **Tests:** `schema.spec`:
  - `version` is int unsigned, NOT NULL, DEFAULT 1.
  - `updated_by` has an FK to `users`, and the CHECK is named.
  - `timeline_audit_events`: columns, enum (`update`), JSON `changes`, both FKs, the index (`timeline_id`, `created_at`), and no update columns.
  - `0004` contains only `ALTER TABLE … ADD` and `CREATE TABLE`. The forbidden-statement regex of the 0003 pin applies.
- **Verification:** the server command. Read the generated SQL line by line against design § 5.
- **Falsifier:**
  - Drop `DEFAULT 1` from `version` → the default pin goes red.
  - Add an `updated_at` column to `timeline_audit_events` → the "no update columns" pin goes red.
  - Hand-add a `MODIFY` to `0004` → the additive pin goes red.
- **Red run:** the new cases fail on their assertions before the schema changes. The migration-count case fails at 4.
- **Disqualifier:**
  - A pin that only asserts that the table exists.
  - An additive check that does not run on `0004`.
  - A migration that was not read line by line.
- **Consumers:**
  - `schema/index.ts` re-exports (`pnpm build`).
  - `server/drizzle/meta/_journal.json`.
  - The `schema.spec.ts` migration count at `schema.spec.ts:298-305`.
  - The journal check at `schema.spec.ts:899-907`.
- **Review:** full. It is a shared boundary, and the migration is permanent once applied to `qadb`.
- **Done when:**
  - The DDL pins are green.
  - `0004` is additive.
  - `server/src/database/AGENTS.md` lists the new guarantees.
- **Skills:** nestjs-expert, nestjs-best-practices

## T-2: Read model — hold, step state, `waiting_for_load`, loads port
- **Status:** [x]
- **Size:** M
- **Depends on:** none
- **Requirements:**
  - FR-2: Midnight boundary; On hold, with its BUT (step 2 not `in_progress`).
  - FR-6: Step 1 date arrives without a load, with its BUT (not `live`); All dates passed while on hold; Admin moves the dates (the read side); Load present.
  - FR-7: Extend an in-progress step, the BUT on the read side (no stored status).
  - FR-14: Detail, including AND IT MUST keep every *timelines* FR-12 field. `version` is passed through once T-1's column exists in the bundle.
  - NFR-4, NFR-5 (list count unchanged), NFR-6.
- **Design refs:** § 7.1 (`timeline-view.ts`), § 7.4, § 6 (response additions); DD-2, DD-3, DD-8; P-5, P-8, P-10
- **Scope:**
  - `timeline-view.ts`: the `hasLoad` input, the hold, the step state, the status union.
  - New `timeline-loads.ts`: the `TIMELINE_LOADS` port and `NoTimelineLoads`, which makes no query.
  - `timelines.module.ts`: the binding.
  - `timelines.service.ts` `respond()`: one batched `withLoad` call.
  - `timeline-response.ts`: `state` per step, `version`.
  - `models/timeline.model.ts`: the status enum gains `waiting_for_load`, plus `state` and `version`.
  - The fake loads port in `test/support/in-memory-admin-config.ts` and its binding in `test/support/admin-config-app.ts`.
  - **DD-8:** existing tests that expect `live` / `finished` / `currentStep` mark their timeline as loaded.
- **Tests:** `timeline-view.spec.ts`, table-driven:
  - Every status × hold × date position.
  - Midnight before and after step 1's day, with and without a load.
  - Both DST changes.
  - All dates past while on hold → `waiting_for_load`.
  - `currentStep` null and `nextStep` 1 during a hold.
  - Each step state at its boundaries.
  - The service spec asserts that the NFR-5 list count stays 6 with `NoTimelineLoads` and stays fixed when the fake loads port is queried.
  - Run the unit suite once with `TZ=UTC` and once with `TZ=America/Bogota`.
- **Verification:**
  - The server command plus `pnpm test:e2e --reporter=dot`.
  - `TZ=UTC pnpm exec vitest run src/admin-config/timelines/timeline-view.spec.ts` and the same with `TZ=America/Bogota`.
- **Falsifier:**
  - Drop the hold check from the status (fall through to dates) → "step 1 date arrives without a load" goes red.
  - Let `finished` win over the hold → "all dates passed while on hold" goes red.
  - Compute step states from dates during a hold → "On hold" goes red, because step 2 is `in_progress`.
  - Each needs a fixture with no load, step 1's day ≤ today, and step 2's day ≤ today.
- **Red run:** the new view cases fail on the status and state assertions, not on a type error, before the change.
- **Disqualifier:**
  - Status tests that pass only because every fixture is loaded, so the hold is never exercised.
  - A query count asserted with the fake loads port bypassed.
- **Consumers:** from P-10, as run:
  - `server/test/admin-config-timelines.e2e-spec.ts` (386, 911, 982-995, 1034, 1039, 1068-1069, 1135).
  - `server/src/admin-config/timelines/timelines.service.spec.ts` (1098, 1333-1361, 1456-1462).
  - `timeline-view.spec.ts`.
  - `models/timeline.model.ts:130-136`.
  - `test/openapi.e2e-spec.ts`.
  - Outside the repo branch: `client/src/app/core/api/cycles.models.ts:69` on `staging-center` (P-11), carried by T-8's front contract.
- **Review:** full. It changes delivered behavior, and this is the reversion of design § 10.
- **Done when:**
  - The hold and state cases are green under both `TZ` values.
  - Every pre-existing status test is green, with a loaded fixture where it expects `live` / `finished`.
  - The list count is unchanged.
  - OpenAPI shows the new enum value and fields.
- **Skills:** nestjs-expert, api-design-principles

## T-3: Update rules, diff and catalog codes
- **Status:** [x]
- **Size:** M
- **Depends on:** none
- **Requirements:**
  - FR-1: Structure is fixed, including AND IT MUST refuse an unknown or duplicate position, and BUT no add/remove/reorder at the rules level.
  - FR-3: Closed step, with its BUT (rename allowed); In-progress step, with its AND IT MUST (today accepted); Upcoming step, with its AND IT MUST; Unchanged past date on hold, with its BUT.
  - FR-4: Before step 1; After step 1 started; Load done, step 1 not started, with its AND IT MUST (same "has a load" input).
  - FR-5: Overlap introduced by an edit, with its AND IT MUST (issue on the unsent step); Several problems, with its BUT (no stop at first, catalog codes only).
  - FR-11 (empty diff); FR-10 (the `changes` content, only changed fields).
  - NFR-4.
- **Design refs:** § 7.1 (`timeline-rules.ts`, `timeline-diff.ts`), § 7.5, § 6 (field paths, codes); DD-4, DD-5, DD-7, DD-11; P-6
- **Scope:**
  - `timeline-rules.ts`: `validateTimelineUpdate`, and the extraction of the merged-state checks into one function that create also calls. Create's output must be byte-identical.
  - New `timeline-diff.ts`.
  - `server/src/common/error-codes.ts`: the field code `LOCKED` and the top-level codes `TIMELINES_VERSION_STALE` and `TIMELINES_IN_PROGRESS_UNCONFIRMED`.
  - `admin-config.errors.ts`: `TimelineVersionStaleError` and `TimelineInProgressUnconfirmedError`.
  - `error-codes.spec.ts`: the pinned field-code set goes from 13 to 14, and the class list is extended.
- **Tests:**
  - `timeline-rules.spec.ts`, table-driven over state (`closed`, `in_progress`, `upcoming`, on hold) × field (`opensOn`, `closesOn`, `name`, scope) × changed/unchanged.
  - An edit to step 1's close that reports on `steps[1].opensOn`.
  - Several issues returned together.
  - An unknown position and a duplicate position.
  - Scope with `hasLoad` true and step 1 upcoming → `LOCKED`.
  - Every existing create case still green, unchanged.
  - `timeline-diff.spec.ts`: no-op, list order ignored, step keys by position, only changed keys.
- **Verification:** the server command.
- **Falsifier:**
  - Apply the locks to sent fields instead of changed ones → "Unchanged past date on hold" goes red. The fixture is on hold with step 1's day in the past and the request renames only.
  - Use the request index for paths → "Overlap introduced" goes red. The request sends only step 1, and the issue is expected at `steps[1]`.
  - Drop `hasLoad` from the scope lock → "Load done, step 1 not started" goes red.
  - Revert create to its own copy of the merged checks and change one → the create tests catch the divergence.
- **Red run:** the new rule cases fail on their `FieldIssue` assertions before the change.
- **Disqualifier:**
  - A state fixture built by hand that disagrees with `viewTimeline`. The rules must take the state from the view.
  - Create tests edited to pass.
- **Consumers:**
  - `server/src/common/error-codes.spec.ts:102-145,219-237`.
  - `server/test/openapi.e2e-spec.ts:224-245` (catalog ↔ documented codes).
  - `server/src/common/api-response.ts:137` (the enum derived from `ERROR_CODES`).
  - `FIELD_ERRORS` readers in `server/src/users/` (shared `FieldIssue`, P-6).
- **Review:** full. These are the core business rules, and the catalog is shared with users.
- **Done when:**
  - Every rule scenario of FR-1, FR-3, FR-4 and FR-5 has a passing case.
  - The create suite is unchanged and green.
  - The catalog pins are updated.
- **Skills:** nestjs-best-practices, error-handling-patterns, api-design-principles

## T-4: Store and unit of work — lock, conditional update, scope replace, audit insert
- **Status:** [ ]
- **Size:** M
- **Depends on:** T-1
- **Requirements:**
  - FR-9: Two admins, with its BUT (no merge) and AND IT MUST (simultaneous), on the database side.
  - FR-10: One record per edit and Failed edit, on the storage side.
  - FR-5: Name taken (1062 on update).
  - NFR-3, NFR-5 (edit statement count fixed).
- **Design refs:** § 7.3, § 5; DD-6, DD-10; P-3, P-4, P-12
- **Scope:**
  - `timelines.store.ts` port and Drizzle adapter: `findBundle`, `findForUpdate`, `updateTimeline` (`updated` / `stale` / `name_taken`), `updateStep`, `replacePrograms`, `replaceResultTypes`, `insertAuditEvent`.
  - `timelines.unit-of-work.ts`.
  - The fake in `test/support/in-memory-admin-config.ts`: an X lock on `timelines:<id>`, the version checked under the lock, `duplicateEntry` on rename, and an audit log.
- **Tests:**
  - `timelines.unit-of-work.spec.ts`: a rollback leaves no step, scope or audit change.
  - Two transactions on the same version: one `updated`, one `stale`.
  - A rename into a taken name → `name_taken` and a rollback.
  - The edit's statement count is independent of the step count.
- **Verification:** the server command.
- **Falsifier:**
  - Remove `AND version = ?` from the conditional update and drop the lock → the two-transaction case applies both.
  - Insert the audit row outside the transaction → the rollback case finds an orphan audit row.
- **Red run:** the new unit-of-work cases fail on outcome assertions before the methods exist. A compile error is not a red run: stub the methods first.
- **Disqualifier:**
  - A fake whose conditional update ignores the version.
  - A concurrency case run serially. It must interleave through the fake's round trips.
  - **This gate cannot see InnoDB re-reads** (KZ-admin-config--cycle-timelines-1). T-9 covers them.
- **Consumers:**
  - `server/src/admin-config/timelines/timelines.service.ts` (the store's only client).
  - `test/support/in-memory-admin-config.ts`.
  - `test/support/admin-config-app.ts:112-114`.
- **Review:** lenses (concurrency, transaction scope). This is a race-prone write path.
- **Done when:**
  - The two-transaction case gives exactly one `updated`.
  - Rollbacks leave nothing behind.
  - The adapter maps 1062 on `uq_timelines_cycle_name` through `duplicateKeyText`.
- **Skills:** nestjs-expert, nestjs-best-practices

## T-5: Service `update` flow
- **Status:** [ ]
- **Size:** M
- **Depends on:** T-2, T-3, T-4
- **Requirements:**
  - FR-1: Extend a step (fields left out are kept; the answer has the new version).
  - FR-4 and FR-5 through the service: catalogs read only for a changed explicit list.
  - FR-7: Extend an in-progress step.
  - FR-8: Not confirmed; Confirmed; Confirmation not needed; and the answer order (rules before confirmation).
  - FR-9: Two admins; Version missing is T-6.
  - FR-10: One record per edit, with its BUT (only changed fields); Failed edit.
  - FR-11: Same values.
  - FR-12: Closed cycle; Unknown timeline.
  - NFR-7.
- **Design refs:** § 7.2 (all steps), § 6 (answer order), § 7.5 (log); DD-6, DD-11; P-2
- **Scope:**
  - `timelines.service.ts` `update`.
  - `admin-config.context.ts` (`timeline_update`).
  - The `logged()` wiring.
  - Not touched: create, assign and remove behavior.
- **Tests:** `timelines.service.spec.ts`:
  - Each answer in design § 6 order, one case per step, with a request that would also fail later steps.
  - A no-op makes no write, no version change and no audit row.
  - An in-progress change without and then with confirmation.
  - Confirmation not needed for an upcoming-only change.
  - A catalog read only when an explicit list changes, and a catalog that cannot be read → 503.
  - Stale before validation; a lost race inside the transaction → 409 stale.
  - The decision line has action `timeline_update` and no body fields.
  - The clock is read once.
- **Verification:** the server command.
- **Falsifier:**
  - Swap steps 5 and 6 (confirmation before validation) → the order case sends an invalid in-progress change and expects 400, but gets 409.
  - Skip the no-op shortcut → the no-op case sees the version raised.
  - Read catalogs on every edit → the "catalog down, no list change" case expects 200 and gets 503.
- **Red run:** the service cases fail on their status and code assertions before `update` exists (stubbed to throw).
- **Disqualifier:**
  - Cases that assert only the status code, not "nothing written". Each refusal must also assert no write and no audit row.
- **Consumers:**
  - `server/src/admin-config/timelines/timelines.controller.ts` (T-6).
  - The log-line e2e at `server/test/admin-config-timelines.e2e-spec.ts:1324` (T-7).
- **Review:** full. It orchestrates every rule and the order of answers.
- **Done when:**
  - Every case is green.
  - Refusals write nothing.
  - One decision line per request.
- **Skills:** nestjs-expert, error-handling-patterns

## T-6: Controller route, DTO, OpenAPI, idempotency
- **Status:** [ ]
- **Size:** S
- **Depends on:** T-5
- **Requirements:**
  - FR-1: Structure is fixed (unknown fields → 400 at the pipe).
  - FR-9: Version missing.
  - FR-12: Non-admin, inherited from the class guard.
  - FR-13: Replay after a lost answer (wiring).
  - NFR-1, NFR-2.
- **Design refs:** § 6, § 7.6; DD-1, DD-9; P-7
- **Scope:**
  - `timelines.controller.ts` `@Patch('timelines/:id')` with `@Idempotent()`, `@ApiOperation`, `@ApiOkEnvelope(TimelineModel)` and `@ApiErrorResponses` listing every design § 6 code.
  - New `dto/update-timeline.dto.ts`. Optional fields stay optional at the pipe, so the rules name them (the *timelines* FR-11 rule in `server/src/admin-config/AGENTS.md`).
  - `models/` request model.
  - `markExecuted` with the timeline id.
- **Tests:** covered over HTTP in T-7. The DTO is unit-checked for `version` required and `steps[].position` required.
- **Verification:** the server command plus `pnpm test:e2e --reporter=dot` (OpenAPI e2e).
- **Falsifier:**
  - Remove `@Idempotent()` → T-7's replay case writes a second audit row.
  - Make `opensOn` required in the step DTO → the "rename only" request is refused at the pipe.
- **Red run:** `test/openapi.e2e-spec.ts` fails on the undocumented route until the decorators exist.
- **Disqualifier:** an OpenAPI pass with the route not mounted (check that the router lists `PATCH /api/v1/timelines/{id}`).
- **Consumers:** `server/test/openapi.e2e-spec.ts`; the front contract (T-8).
- **Review:** checklist. It is wiring over T-5, following existing patterns.
- **Done when:**
  - The route is mounted, admin-only, idempotent and documented.
  - The OpenAPI e2e is green.
- **Skills:** nestjs-expert, api-design-principles

## T-7: e2e — the edit over HTTP
- **Status:** [ ]
- **Size:** M
- **Depends on:** T-6
- **Requirements:**
  - The HTTP side of FR-1, FR-3, FR-4, FR-5, FR-6 (Admin moves the dates: a PATCH followed by a GET shows `scheduled`), FR-7, FR-8, FR-9, FR-10, FR-11, FR-12 (Non-admin 403/401; Closed cycle 409; 404), FR-13 (Replay after a lost answer, with its BUT: not 409 stale, no second audit row), FR-14.
  - NFR-1, NFR-2, NFR-3 (the fake part), NFR-7.
- **Design refs:** § 6, § 7.2, § 7.6
- **Scope:** `server/test/admin-config-timelines.e2e-spec.ts` new `PATCH` sections, using the clock override and the fake loads port. Not touched: the existing sections, beyond T-2's DD-8 edits.
- **Tests:**
  - The 401/403 matrix.
  - The answer order with full envelopes (`fields` list, catalog codes, no free text).
  - Extend an in-progress step with confirmation, then GET → still in progress past the old close.
  - A replay with the same key and version → the first 200, with the `Idempotency-Replayed` header and one audit row.
  - Stale versions.
  - The log line.
  - Unknown fields `audience` / `round` / `requiresLoad` / `kind` → 400.
- **Verification:** `cd server && pnpm test:e2e --reporter=dot`.
- **Falsifier:**
  - Make the replay reader serve the stored version check → the replay case gets 409.
  - Drop `forbidNonWhitelisted` for the DTO → the `audience` case gets 200.
- **Red run:** the new sections fail on their status and body assertions before T-6's route exists (404 from the router is the expected red only for the mount check, not for the rule cases).
- **Disqualifier:** a case that checks the status only; every refusal also GETs the timeline and asserts it is unchanged.
- **Consumers:** none (no shared symbol changed).
- **Review:** checklist. These are tests over the finished flow.
- **Done when:**
  - Every FR scenario listed has an HTTP case.
  - The e2e suite is green.
- **Skills:** nestjs-expert

## T-8: Docs — module guide, front contract, TRD pending item
- **Status:** [ ]
- **Size:** S
- **Depends on:** T-7
- **Requirements:** FR-14 (contract for the front), NFR-6 (the load seam documented for P2-3905)
- **Design refs:** § 8, § 9; DD-3, DD-7, DD-9; P-11
- **Scope:**
  - `server/src/admin-config/AGENTS.md`: the routes count, the edit flow, the hold, the loads port, the audit table, the new log action, and the reserved-tables note.
  - New `docs/specs/admin-config/timeline-edit/front-contract.md`:
    - the request;
    - paths `steps[position − 1]`;
    - `state`, `version` and `waiting_for_load`;
    - the two 409s and the confirmation flow;
    - the crash-window replay note;
    - TEST timelines turning `waiting_for_load`;
    - `client/src/app/core/api/cycles.models.ts` must add the value.
  - `execution.md`: the pending item for TRD § 5.1 / § 6 (applied on `staging`).
  - These files are named deliverables.
- **Tests:** n/a (docs).
- **Verification:** the Reviewer reads each claim against the code at HEAD; `grep -n "waiting_for_load\|TIMELINES_VERSION_STALE\|TIMELINES_IN_PROGRESS_UNCONFIRMED\|LOCKED" docs/specs/admin-config/timeline-edit/front-contract.md` finds all four.
- **Falsifier:** a contract that says paths use the request index → contradicts `validateTimelineUpdate` (Reviewer check against T-3's tests).
- **Red run:** n/a (no test gate).
- **Disqualifier:** a guide written from the design instead of the merged code.
- **Consumers:** the front lead (P2-3937), via the contract.
- **Review:** checklist. These are docs checked against code.
- **Done when:** the guide and the contract match HEAD, and the TRD item is recorded as pending.
- **Skills:** none beyond the module guides

## T-9: HITL on MySQL — migration, concurrent edits, hold
- **Status:** [ ]
- **Size:** S
- **Depends on:** T-8
- **Requirements:** NFR-3 (the real-database part), FR-9 (AND IT MUST hold simultaneously, on InnoDB), FR-6 (Step 1 date arrives without a load, on a real read), FR-10 (one audit row per applied edit, on MySQL)
- **Design refs:** § 5, § 7.2 step 8; DD-6; P-12
- **Scope:** a human step by the back lead (agents never run migrations on `qadb`, `server/AGENTS.md`).
  - **First step (settles P-12):** apply `0004` to `qadb`. Fire 5 concurrent PATCHes on the same timeline with the same version, then confirm exactly one 200, four 409 `TIMELINES_VERSION_STALE`, `version` + 1 and one audit row.
  - A timeline whose step 1 is today with no load reads `waiting_for_load`.
  - **Plan (KZ-admin-config--cycle-timelines-3):**
    - The admin token comes from the back lead's own login, kept in a shell variable. It is never pasted in chat or written to a file in the repo.
    - The checks use one disposable timeline in a `draft` cycle.
    - Its audit rows and the timeline stay. Record their ids in `execution.md`.
- **Tests:** n/a (manual).
- **Verification:** the counts above, recorded in `execution.md` with the request ids.
- **Falsifier:** run the 5 requests serially → all but the first are 409 trivially; the check is valid only if the requests overlap (record their timestamps).
- **Red run:** n/a (no test gate).
- **Disqualifier:**
  - Requests that did not overlap.
  - A check against a cycle other than the disposable one.
  - A token that passed through chat.
- **Consumers:** none (no shared symbol changed).
- **Review:** checklist. The Leader checks the recorded evidence.
- **Done when:** P-12 is verified (or refuted → Pivot Protocol), and the evidence and leftover data are recorded.
- **Skills:** none

---

## Coverage (scenario and clause level)

| Requirement | Scenario / clause | Task |
|---|---|---|
| FR-1 | Extend a step; fields kept; new version | T-5, T-7 |
| FR-1 | Structure is fixed: unknown fields 400 | T-6, T-7 |
| FR-1 | BUT no add/remove/reorder · AND IT MUST unknown or duplicate position | T-3 |
| FR-2 | Midnight boundary · On hold · BUT step 2 not `in_progress` | T-2 |
| FR-3 | Closed step · BUT rename allowed | T-3, T-7 |
| FR-3 | In-progress step · AND IT MUST today accepted | T-3, T-7 |
| FR-3 | Upcoming step · AND IT MUST today accepted | T-3 |
| FR-3 | Unchanged past date on hold · BUT not before today | T-3 |
| FR-4 | Before step 1 · After step 1 started | T-3, T-7 |
| FR-4 | Load done, step 1 not started · AND IT MUST same source | T-3 (rules), T-2 (port) |
| FR-5 | Overlap introduced · AND IT MUST issue on the named step | T-3, T-7 |
| FR-5 | Several problems · BUT no stop at first, no free text | T-3, T-7 |
| FR-5 | Name taken (409) | T-4, T-7 |
| FR-6 | Step 1 date without a load · BUT not `live` | T-2, T-9 |
| FR-6 | All dates passed while on hold | T-2 |
| FR-6 | Admin moves the dates | T-2 (read), T-7 (PATCH then GET) |
| FR-6 | Load present (seam) | T-2 |
| FR-7 | Extend an in-progress step · BUT no stored status | T-2, T-5, T-7 |
| FR-8 | Not confirmed · Confirmed · Confirmation not needed · rules answer first | T-5, T-7 |
| FR-9 | Two admins · BUT no merge · AND IT MUST simultaneous | T-4, T-5, T-7, T-9 |
| FR-9 | Version missing | T-6, T-7 |
| FR-10 | One record per edit · BUT only changed fields | T-3 (diff), T-4, T-5 |
| FR-10 | Failed edit | T-4, T-5 |
| FR-10 | Append-only | T-1 |
| FR-11 | Same values | T-3 (diff), T-5, T-7 |
| FR-12 | Non-admin 403/401 | T-6, T-7 |
| FR-12 | Closed cycle · 404 | T-5, T-7 |
| FR-13 | Replay after a lost answer · BUT not 409 stale, no second audit row | T-6, T-7 |
| FR-14 | Detail · AND IT MUST keep FR-12 fields | T-2, T-7 |
| NFR-1, NFR-2 | Access, unknown fields | T-6, T-7 |
| NFR-3 | Lost update | T-4 (fake), T-9 (MySQL) |
| NFR-4 | DST and midnight, two `TZ` | T-2, T-3 |
| NFR-5 | Fixed statement counts | T-2 (list), T-4 (edit) |
| NFR-6 | Loads seam | T-2, T-8 |
| NFR-7 | Decision line | T-5, T-7 |
| NFR-8 | One audit row per applied edit | T-1, T-4, T-5, T-9 |
