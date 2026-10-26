# Field configuration per cycle — Tasks

| | |
|---|---|
| Spec path | `docs/specs/admin-config/field-configuration` |
| Branch | `feat/field-configuration` (from `origin/staging-center` @ `0b62fd1`) |
| Commits | `[SPEC:admin-config/field-configuration] <emoji> <type>(fields) P2-3907: …` |
| Budget (design § 2) | 11 tasks (10 build + 1 HITL) · ≈ 7,000 LOC incl. tests · ≈ 18 review rounds. Tripwire: stop and escalate when exceeded |
| Verification (server) | `cd server && pnpm lint && pnpm build && pnpm test --reporter=dot`, plus `pnpm test:e2e --reporter=dot` where stated. If the host RAM guard blocks `pnpm test:e2e`, the accepted substitute is `pnpm exec vitest run --config ./vitest.config.e2e.ts --reporter=dot --maxWorkers=2` (*edit* T-2) |
| PRs | PR 1 = T-1…T-5 (schema, catalog, pure rules, store) · PR 2 = T-6…T-11 (service, route, e2e, docs, HITL) |

Status: `[ ]` pending · `[~]` in progress · `[x]` done (after a Reviewer PASS, a recorded `REVIEW_WAIVED`, or a `REVIEW_SKIPPED`).

## Dependency graph

```
T-1 ─────────────────────▶ T-5 ─┐
T-2 ────────────────────────────┤
T-3 ────────────────────────────┼─▶ T-6 ─▶ T-7 ─▶ T-8 ─▶ T-9 ─▶ T-10 ─▶ T-11 (HITL)
T-4 ────────────────────────────┘
```

- T-5 depends on T-1. T-6 depends on T-2, T-3, T-4 and T-5. Each later task depends on the one before it.
- **Serial boundaries:**
  - Only T-1 touches `server/src/database/**`.
  - Only T-2 touches `server/src/users/catalogs/**`.
  - Only T-3 touches `server/src/common/error-codes.ts`, `admin-config.errors.ts`.
  - T-1…T-4 share `server/dist/` and the vitest runner. Run them serially (*edit* run note).

---

## T-1: Schema and migration `0005` (five tables)
- **Status:** [x]
- **Size:** M
- **Depends on:** none
- **Requirements:**
  - FR-4: Switching off, the AND IT MUST clause (impossible by a direct database write).
  - FR-8: Two admins publish at once (the UNIQUE backstop).
  - FR-11: one record per publication (UNIQUE `version_id`).
  - FR-12: immutability (no update columns on versions, items or audit).
  - NFR-8.
- **Design refs:** § 5; DD-2, DD-3, DD-6, DD-10
- **Scope:**
  - New `schema/field-config-drafts.ts`, `field-config-draft-items.ts`, `field-config-versions.ts`, `field-config-version-items.ts`, `field-config-audit-events.ts`, exported from `schema/index.ts`.
  - Generated `server/drizzle/0005_field_configuration.sql` and its meta (`pnpm db:generate`).
  - `schema.spec.ts`: migration count 5 → 6, `0005` additive and exact.
  - `server/src/database/AGENTS.md`: schema guarantees.
  - Not touched: `0000`–`0004`, existing tables.
- **Tests:** `schema.spec`:
  - Each table's columns and types, keys, FKs (all `no action`) and indexes.
  - The two named CHECKs (draft items, version items) with the exact expression, and the `updated_*` both-or-none CHECK.
  - UNIQUE (`cycle_id`, `number`) and UNIQUE (`version_id`) on audit.
  - No update columns on `field_config_versions`, `field_config_version_items` and `field_config_audit_events`.
  - `0005` contains only `CREATE TABLE`, `CREATE INDEX` and `ALTER TABLE … ADD CONSTRAINT` for its own new tables; the forbidden-statement regex of the `0003`/`0004` pins applies.
- **Verification:** the server command. Read the generated SQL line by line against design § 5.
- **Falsifier:**
  - Drop the `OR visibility = 'assessed'` arm of the CHECK → the CHECK pin goes red.
  - Remove UNIQUE (`cycle_id`, `number`) → the backstop pin goes red.
  - Hand-add an `ALTER TABLE \`timelines\`` to `0005` → the additive pin goes red.
- **Red run:** the new pins fail on their assertions before the schema exists; the migration count case fails at 5.
- **Disqualifier:** a pin that only asserts a table exists; an additive check not run on `0005`; SQL not read line by line.
- **Consumers:** `schema/index.ts` re-exports (`pnpm build`); `server/drizzle/meta/_journal.json`; `schema.spec.ts:303-305` (count); the journal check in `schema.spec.ts`.
- **Review:** full. The migration is permanent once applied to `qadb`.
- **Done when:** the DDL pins are green; `0005` is additive; `server/src/database/AGENTS.md` lists the guarantees.
- **Skills:** nestjs-expert, nestjs-best-practices

## T-2: Catalog reader per year — client, keyed cache, shaping
- **Status:** [x]
- **Size:** M
- **Depends on:** none
- **Requirements:**
  - FR-2: Grouping and order (shaping, `"*"` expansion, ties by array position, requirement, `isNew` pass-through, no subfields); Year comes from the cycle (the client takes a year); Catalog missing or down, with its BUT (no empty list).
  - NFR-6.
- **Design refs:** § 7.1 (`shapeCatalog`, `applicableFields`), § 7.4; DD-4; P-1…P-7
- **Scope:**
  - `server/src/users/catalogs/catalog-http.ts`: an opt-in "not found" outcome. Its three importers keep every non-2xx → 503 (P-7).
  - New `admin-config/field-config/reporting-qa-catalog.client.ts`: the `FIELD_CATALOG_SOURCE` port `forYear(year)`, 404 → `FieldCatalogMissingError`, and a keyed per-year cache with the policy of `catalog.service.ts`.
  - New `field-config-catalog.ts`: `shapeCatalog`, `applicableFields`.
  - New fixture `field-config/fixtures/reporting-qa-catalog-2026.json`: the TEST catalog `2026.30`, with the body only and no key or headers (the existing fixture has 1 field, P-5).
- **Tests:**
  - `field-config-catalog.spec.ts` over the full fixture:
    - per-type counts of applicable fields, `"*"` expanded (`policy_change` 50, `innovation_use` 70, `other_outcome` 43, `capacity_sharing` 51, `knowledge_product` 69, `innovation_development` 70, `other_output` 43, `impact_contribution` 43, `innovation_package` 65; *edit* 2026-10-26: each is the `docs/reporting-catalog.md` § 2.3 count plus the 30 `"*"` fields, which that table leaves out);
    - `"*"` expanded;
    - the five order-50 sections ordered by array position;
    - fields grouped by section although interleaved in the payload;
    - requirement from `required` / `required_when`;
    - `isNew` false with no flag and true when a row carries one;
    - no subfield listed;
    - a malformed row → typed error.
  - `reporting-qa-catalog.client.spec.ts`:
    - `phase_year` taken from the argument;
    - 404 → `FieldCatalogMissingError`;
    - 500, timeout or bad JSON → `UpstreamUnavailableError`;
    - cache per year (2026 and 2027 do not overwrite each other);
    - a stale copy served on failure;
    - a 404 not cached.
  - `catalog-http.spec.ts`: the existing cases are unchanged and green; one case for the opt-in outcome.
- **Verification:** the server command.
- **Falsifier:**
  - Read the year from the clock → the "2027 cycle in 2026" case goes red.
  - Map 404 to 503 → the missing-catalog case goes red.
  - Sort section ties by key → the order-50 case goes red.
  - Skip `"*"` expansion → the per-type counts go red.
- **Red run:** the new cases fail on their assertions (counts, error type), not on an import error. Stub the functions first.
- **Disqualifier:**
  - Counts asserted on a hand-made fixture instead of the TEST catalog.
  - A cache test with a single year.
  - Any change to `ReportingResultTypesClient` or `RESULT_TYPE_SOURCE` (S-11).
- **Consumers:** `catalog-http.ts` importers `clarisa-science-programs.client.ts`, `reporting-result-types.client.ts`, `catalog-http.spec.ts` (P-7).
- **Review:** full. It touches a shared HTTP helper and is the source of every field the spec shows.
- **Done when:** the per-type counts match the fixture with `"*"` expanded (§ 2.3 count + 30 per type); the three importers' tests are unchanged and green.
- **Skills:** nestjs-expert, error-handling-patterns, tdd

## T-3: Draft rules, diff and catalog codes
- **Status:** [x]
- **Size:** M
- **Depends on:** none
- **Requirements:**
  - FR-4: Explicit contradiction; Switching off (service side).
  - FR-5: Several problems, with its BUT (no stop at the first).
  - FR-7 / FR-8: Nothing to publish (empty diff).
  - FR-11: the BUT (only changed items).
  - S-7 (not-in-catalog fields left out of the diff).
- **Design refs:** § 6 (field issues, codes), § 7.1 (`validateDraftEdit`, `diffConfig`), § 7.5; DD-11, DD-12; P-8
- **Scope:**
  - New `field-config-rules.ts` (`validateDraftEdit`) and `field-config-diff.ts` (`diffConfig`).
  - `server/src/common/error-codes.ts`: the top-level `FIELD_CONFIG_CATALOG_MISSING`, `FIELD_CONFIG_REVISION_STALE` and `FIELD_CONFIG_NOTHING_TO_PUBLISH`, and the field code `NOT_ASSESSED`.
  - `admin-config.errors.ts`: their error classes, plus `FieldConfigTypeNotInTimelineError` and `FieldConfigNoVersionError`.
  - `error-codes.spec.ts`: the field-code pin 14 → 15; the class lists extended.
- **Tests:**
  - `field-config-rules.spec.ts`, table-driven over visibility × `isCore` × `isAiInput` × sent/omitted.
  - An unknown type, a field not applicable to its type, and a repeated (type, field): each gives `INVALID` at `items[i].<field>`.
  - Several issues returned together, in item order.
  - `field-config-diff.spec.ts`:
    - unclassified reads hidden;
    - no-op → empty;
    - only changed (type, field) entries;
    - a draft field no longer in the catalog left out;
    - the first publication (no version) diffs against hidden.
- **Verification:** the server command.
- **Falsifier:**
  - Accept `isCore` true with `view_only` → the contradiction case goes red.
  - Stop at the first issue → the several-issues case goes red.
  - Diff unclassified as `null` instead of hidden → the first-publication case lists every field as changed and goes red.
- **Red run:** the new cases fail on their `FieldIssue` / diff assertions before the functions exist (stubbed).
- **Disqualifier:** fixtures built by hand that disagree with `applicableFields` over the T-2 fixture; existing error-code cases edited to pass.
- **Consumers:**
  - `server/src/common/error-codes.spec.ts:261-276` and the class lists.
  - `server/test/openapi.e2e-spec.ts:224-245`.
  - `server/src/common/api-response.ts` (the enum derived from `ERROR_CODES`).
  - `FIELD_ERRORS` readers in `server/src/users/` and `common/validation.ts` (P-8).
- **Review:** full. These are the core rules, and the catalog is shared.
- **Done when:** every FR-4 / FR-5 issue case is green; the pins are updated; the existing error-code tests are unchanged.
- **Skills:** nestjs-best-practices, error-handling-patterns, api-design-principles, tdd

## T-4: Version resolution and receive / keep
- **Status:** [x]
- **Size:** M
- **Depends on:** none
- **Requirements:**
  - FR-9: every scenario (before any start; while running, S-13; opening day, S-5; not started, provisional, S-4; started with none, with its BUT (no fallback); on hold, S-3).
  - FR-7: Changes and timelines (the receive / keep / neither split, with the DD-8 rule).
  - NFR-4.
- **Design refs:** § 7.1 (`versionFor`, `receiveAndKeep`); DD-5, DD-8; P-13
- **Scope:** new `field-config-versions.ts`, using `rome-date.ts`; no I/O.
- **Tests:** `field-config-versions.spec.ts`, table-driven:
  - Publish instants at 23:59 and 00:00 Rome on the day before and on the opening day.
  - Both DST changes (29 Mar 2026, 25 Oct 2026), driven by real instants through `todayInRome`.
  - A timeline with no steps.
  - A finished timeline (in neither list).
  - A timeline not covering a changed type (in neither list).
  - `allResultTypes` vs scope rows.
  - Started with no version → `none`.
  - Run the suite once with `TZ=UTC` and once with `TZ=America/Bogota`.
- **Verification:**
  - The server command.
  - `TZ=UTC pnpm exec vitest run src/admin-config/field-config/field-config-versions.spec.ts` and the same with `TZ=America/Bogota`.
- **Falsifier:**
  - Compare `<=` instead of `<` → the opening-day case goes red.
  - Compare UTC dates instead of Rome dates → the 23:30 UTC (00:30 Rome) case goes red.
  - Fall back to the latest version when none precedes the start → the "started with none" case goes red.
- **Red run:** the cases fail on their resolved-version / list assertions before the functions exist (stubbed).
- **Disqualifier:** boundary cases written as date strings only (no instant crossing midnight Rome); a suite run under one `TZ` only.
- **Consumers:** none (new module, no shared symbol).
- **Review:** full. This is the rule AC 13–14 depend on.
- **Done when:** every FR-9 scenario has a passing case under both `TZ` values.
- **Skills:** nestjs-best-practices, tdd

## T-5: Store and unit of work — draft lock, conditional revision, version insert, audit
- **Status:** [x]
- **Size:** M
- **Depends on:** T-1
- **Requirements:**
  - FR-5: Two admins edit the same field (last write wins, revision moves).
  - FR-8: Stale revision; Two admins publish at once — database side.
  - FR-11: Audit record (written in the transaction); a refused publication leaves none.
  - NFR-3 (fake part), NFR-5 (fixed statements).
- **Design refs:** § 7.3, § 5; DD-6, DD-10; P-11, P-12
- **Scope:**
  - `field-config.store.ts`: the port and the Drizzle adapter, with the methods of design § 7.3; `listTimelineStarts` uses three queries.
  - `field-config.unit-of-work.ts` (READ COMMITTED, stores on `tx`, `idempotency.markExecuted`).
  - The fake `server/test/support/in-memory-field-config.ts`: cycle S lock, draft X lock, the revision checked under the lock, UNIQUE (`cycle_id`, `number`), the audit row in the transaction, a round trip per statement.
- **Tests:** `field-config.unit-of-work.spec.ts`:
  - A rollback leaves no draft, version, item or audit change.
  - Two publish transactions on one revision: one `updated`, one `stale`.
  - The conditional UPDATE alone refuses the second (no `FOR UPDATE` read).
  - A draft upsert racing a publish: the publish's revision check sees the edit.
  - The statement count of a publish is the same for 13 and for 40 applicable fields.
  - `listTimelineStarts` is 3 queries for 1 and for 50 timelines.
- **Verification:** the server command.
- **Falsifier:**
  - Remove `AND revision = ?` and the draft lock → the two-transaction case applies both.
  - Insert the audit row outside the transaction → the rollback case finds an orphan audit row.
  - Drop the draft lock only → the conditional-alone case still holds, and the race case with an open transaction goes red.
- **Red run:** the new cases fail on outcome assertions before the methods exist (stub first; a compile error is not a red run).
- **Disqualifier:**
  - A fake whose conditional update ignores the revision.
  - A concurrency case whose transactions run one statement each, so they never interleave — every concurrency case keeps both transactions open past their first write (*edit* T-4 attempt-1 FAIL).
  - **This gate cannot see InnoDB behavior** (KZ-admin-config--cycle-timelines-1); T-11 covers it.
- **Consumers:** `field-config.service.ts` (the store's only client); `test/support/in-memory-field-config.ts`.
- **Review:** lenses (concurrency, transaction scope). This is a race-prone write path.
- **Done when:** the two-transaction case gives exactly one `updated`; rollbacks leave nothing behind; the statement counts are fixed.
- **Skills:** nestjs-expert, nestjs-best-practices

## T-6: Service read flows — view, preview, effective query
- **Status:** [x]
- **Size:** M
- **Depends on:** T-2, T-3, T-4, T-5
- **Requirements:**
  - FR-2: every scenario through the service.
  - FR-3: every scenario (unclassified; not in catalog; summary values).
  - FR-7: every scenario, with its BUT (nothing written).
  - FR-10: every scenario.
  - FR-13: reads in a closed cycle; unknown cycle 404.
  - NFR-5 (view and preview: fixed statements).
- **Design refs:** § 7.2 (view, preview, effective), § 6 (view shape); DD-1, DD-2, DD-7, DD-8, DD-12
- **Scope:**
  - `field-config.service.ts`: `view`, `preview` and `effectiveFor`.
  - The `FIELD_CONFIG_EFFECTIVE` port exported from `field-config.module.ts`.
  - Module providers (store, unit of work, catalog source, `ConfigModule.forFeature(catalogsConfig)` per P-6, clock).
- **Tests:** `field-config.service.spec.ts`:
  - The view over the T-2 fixture: grouping, unclassified hidden, `notInCatalog`, revision and latest version.
  - Catalog missing → 409; catalog down → 503; neither returns an empty list.
  - The preview for the FR-7 scenario (A keeps, B receives, C neither), with the publish clock injected.
  - Effective: the resolved version's items for the type; type not in the timeline → error; started with none → error; subfields absent.
  - Statement counts fixed for 1 and 50 timelines.
  - A closed cycle still reads.
- **Verification:** the server command.
- **Falsifier:**
  - Read the catalog with the current year → the "cycle 2027" case goes red.
  - Fill unclassified as `null` → the unclassified case goes red.
  - List timelines not covering a changed type under "receive" → the C case goes red.
- **Red run:** the service cases fail on their answer assertions before the methods exist (stubbed to throw).
- **Disqualifier:** a preview case whose timelines all cover every type (the scope filter is never exercised); a count asserted with the fake store bypassed.
- **Consumers:** `field-config.controller.ts` (T-8); later review stories through `FIELD_CONFIG_EFFECTIVE`.
- **Review:** full. It shapes every answer and the effective query.
- **Done when:** every FR-2, FR-3, FR-7 and FR-10 scenario has a passing case.
- **Skills:** nestjs-expert, api-design-principles

## T-7: Service write flows — draft edit, discard, publish
- **Status:** [x]
- **Size:** M
- **Depends on:** T-6
- **Requirements:**
  - FR-4: Switching off (stored).
  - FR-5: Several items; Several problems; Two admins; Same values.
  - FR-6: Discard (with and without a version).
  - FR-8: Publish; Stale revision; Nothing to publish; Two admins (service side).
  - FR-11: Audit record, with its BUT and the refused case.
  - FR-12: Immutability.
  - FR-13: Closed cycle (writes refused).
  - NFR-7.
- **Design refs:** § 6 (answer order), § 7.2 (draft edit, discard, publish), § 7.5; DD-2, DD-6, DD-7, DD-12
- **Scope:**
  - `field-config.service.ts`: `updateDraft`, `discardDraft` and `publish`, with `logged()` lines.
  - `admin-config.context.ts`: the three new actions.
  - Not touched: the cycles and timelines services.
- **Tests:** `field-config.service.spec.ts`:
  - Each answer of design § 6 in order, one case per step, with a request that would also fail later steps.
  - Same values → no write and no revision change.
  - Last write wins.
  - Discard to version 3, and to empty.
  - Publish writes one version holding every applicable field (unclassified as hidden), and one audit row with only changed items and the receive / keep lists.
  - A later draft edit leaves version 2 unchanged.
  - Stale before the transaction; a lost race inside it → 409 stale.
  - Nothing to publish → 409.
  - A closed cycle refuses edit, discard and publish.
  - One decision line per request, with no body fields.
  - The clock is read once per request.
- **Verification:** the server command.
- **Falsifier:**
  - Skip the no-op shortcut on the draft edit → the same-values case sees the revision raised.
  - Publish only classified fields → the version-items count case goes red.
  - Check "nothing to publish" before "stale" → the order case expects 409 stale and gets the other 409.
- **Red run:** the service cases fail on status/code assertions before the methods exist (stubbed to throw).
- **Disqualifier:** a refusal case that asserts only the error. **Every refusal also asserts nothing written:** draft, versions, items, audit and revision unchanged. The task report lists every refusal case with its no-write assertion line (*edit* T-7 lesson).
- **Consumers:** `field-config.controller.ts` (T-8); the log e2e (T-9); the `AdminConfigAction` union at `admin-config.context.ts:4-10` and its readers, the private `logged()` of `cycles.service.ts:217` and `timelines.service.ts:810` (design P-9) — grep the union's name over `server/src` and `server/test` and list every hit.
- **Review:** full. It orchestrates every write rule and the answer order.
- **Done when:** every case is green; refusals write nothing; one decision line per request.
- **Skills:** nestjs-expert, error-handling-patterns

## T-8: Controller, DTOs, OpenAPI, module wiring, idempotency
- **Status:** [x]
- **Size:** S
- **Depends on:** T-7
- **Requirements:**
  - FR-1 (class guard).
  - FR-8: Replay after a lost answer (wiring).
  - FR-13: Unknown cycle 404 (`CycleIdParams`).
  - NFR-1, NFR-2.
- **Design refs:** § 6, § 7.6; DD-9; P-9, P-10
- **Scope:**
  - `field-config.controller.ts`: `@Controller('cycles')`, class-level `ADMIN_ACCESS`, the five routes, `@ApiOkEnvelope` / `@ApiErrorResponses` listing every design § 6 code, and `@Idempotent()` on publish.
  - DTOs (`items` 1–2,000 entries, enum visibility, optional flags, `revision` an integer ≥ 0) and response models.
  - The `IDEMPOTENCY_REPLAY_READER` re-reads the version and its audit row.
  - `AdminConfigModule` imports `FieldConfigModule`.
  - `test/support/admin-config-app.ts` overrides the new store, unit of work and catalog source (P-10).
- **Tests:** DTO unit checks (`items` required, empty refused, unknown key refused, `revision` required). The route surface is covered over HTTP in T-9.
- **Verification:** the server command plus `pnpm test:e2e --reporter=dot` (OpenAPI e2e).
- **Falsifier:**
  - Remove `@Idempotent()` → T-9's replay case writes a second version.
  - Make `isCore` required → a visibility-only item is refused at the pipe.
- **Red run:** `test/openapi.e2e-spec.ts` fails on the undocumented routes until the decorators exist.
- **Disqualifier:** an OpenAPI pass with the routes not mounted (check that the router lists all five).
- **Consumers:** `server/test/openapi.e2e-spec.ts`; `test/support/admin-config-app.ts` and every e2e suite built on it; `admin-config.module.ts`.
- **Review:** checklist. It is wiring over T-7, following existing patterns.
- **Done when:** the routes are mounted, admin-only and documented; publish is idempotent; the existing e2e suites are green.
- **Skills:** nestjs-expert, api-design-principles

## T-9: e2e — field configuration over HTTP
- **Status:** [ ]
- **Size:** M
- **Depends on:** T-8
- **Requirements:** the HTTP side of FR-1…FR-13 and NFR-1, NFR-2, NFR-3 (fake), NFR-7, NFR-8.
- **Design refs:** § 6, § 7.2, § 7.6
- **Scope:** new `server/test/admin-config-field-config.e2e-spec.ts`, using the clock override, the timelines fake and a Reporting catalog fake serving the T-2 fixture. Not touched: the existing suites.
- **Tests:**
  - The 401/403 matrix on all five routes.
  - The view for cycle 2026, and for a cycle whose year has no catalog (409).
  - Reporting down (503).
  - A multi-item PATCH with every issue in one 400.
  - The switch-off rule.
  - Discard.
  - The preview for the FR-7 timelines.
  - Publish, then a GET showing the version.
  - Stale revision; nothing to publish; two concurrent publishes (one 200, one 409, one version).
  - Replay with the same key → the first answer (201, the publish route's status; *edit* 2026-10-26 at T-8, was "200") with `Idempotency-Replayed` and one version and audit row.
  - A closed cycle refuses writes and allows reads.
  - The log lines.
- **Verification:** `cd server && pnpm test:e2e --reporter=dot`.
- **Falsifier:**
  - Remove `@Idempotent()` → the replay case gets a second version.
  - Drop `forbidNonWhitelisted` → an unknown-field case gets 200.
- **Red run:** the new cases fail on status and body assertions before T-8's routes exist (temporarily unmount, record, restore byte-identical).
- **Disqualifier:** a refusal that checks the status only. **Every refusal also GETs the configuration and asserts the whole view unchanged, plus the stored state.** The task report carries a sweep table of **every** non-2xx request in the suite, with the line numbers of its whole-view and state assertions; the Leader greps them (*edit* T-7 lesson: two FAILs on a partial list).
- **Consumers:** none (no shared symbol changed).
- **Review:** checklist. These are tests over the finished flow.
- **Done when:** every FR scenario listed has an HTTP case; the sweep table has no row without both assertions; the e2e suite is green.
- **Skills:** nestjs-expert

## T-10: Docs — module guide, front contract, TRD pending item
- **Status:** [ ]
- **Size:** S
- **Depends on:** T-9
- **Requirements:** FR-14; S-1 (comment unit, noted for the comments spec); S-6 (Reporting "new" flag request)
- **Design refs:** § 8, § 9
- **Scope:**
  - `server/src/admin-config/AGENTS.md`: the new module, files, routes, lock order, version rule, audit table, log actions.
  - New `docs/specs/admin-config/field-configuration/front-contract.md`:
    - routes, shapes and codes;
    - `third` → `assessed` + core;
    - `conditional`;
    - the revision round trip and recovery from the two 409s;
    - receive / keep;
    - the dialog wording replacing "Applies to results loaded from now on" (`fields-publish-confirm.ts:11` on `staging-center`);
    - catalog-missing and 503 states.
  - `execution.md`: the pending items for TRD § 5.1 / § 6 and for the Reporting requests (RC-5 "new" flag).
  - Every claim is written from the code at HEAD, citing lines.
- **Tests:** n/a (docs).
- **Verification:** the Reviewer reads each claim against the code at HEAD; `grep -n "FIELD_CONFIG_REVISION_STALE\|FIELD_CONFIG_NOTHING_TO_PUBLISH\|FIELD_CONFIG_CATALOG_MISSING\|NOT_ASSESSED\|conditional" docs/specs/admin-config/field-configuration/front-contract.md` finds all five.
- **Falsifier:** a contract saying a publication reaches running timelines → contradicts `versionFor` (T-4 tests).
- **Red run:** n/a (no test gate).
- **Disqualifier:** a doc written from the design instead of the merged code; a client file cited without naming the branch it lives on (*edit* T-8 lesson).
- **Consumers:** the front lead, via the contract.
- **Review:** checklist. These are docs checked against code.
- **Done when:** the guide and the contract match HEAD; the TRD and Reporting items are recorded as pending.
- **Skills:** cognitive-doc-design

## T-11: HITL on MySQL — migration, concurrent publish, version resolution
- **Status:** [ ]
- **Size:** S
- **Depends on:** T-10
- **Requirements:** NFR-3 (real-database part); FR-8 (two admins publish at once, on InnoDB); FR-11 (one audit row per publication, on MySQL); FR-2 (the real catalog for the cycle's year)
- **Design refs:** § 5, § 7.2 (publish); DD-6
- **Scope:** a human step by the back lead (agents never run migrations on `qadb`).
  - Apply `0005` to `qadb`.
  - On one disposable `draft` cycle: GET the configuration (the real TEST catalog for its year), PATCH a few items, then fire 5 concurrent publishes with the same `revision` and **distinct** idempotency keys. Expect one 200, four 409, one version, one audit row.
  - **Plan (KZ-admin-config--cycle-timelines-3):**
    - The admin token and the Reporting key stay in shell variables from the back lead's own session, never in chat or in a repo file.
    - The checks use one disposable cycle. Its version and audit ids are recorded in `execution.md`.
- **Tests:** n/a (manual).
- **Verification:** the counts above, recorded in `execution.md` with request ids and timestamps.
- **Falsifier:** run the 5 publishes serially → all but the first are 409 trivially; the check is valid only if they overlap (record start/end times).
- **Red run:** n/a.
- **Disqualifier:** requests that did not overlap; a cycle other than the disposable one; a token or key that passed through chat.
- **Consumers:** none.
- **Review:** checklist. The Leader checks the recorded evidence.
- **Done when:** NFR-3 is verified on MySQL (or refuted → Pivot Protocol), with evidence and leftover data recorded.
- **Skills:** none

---

## Coverage (scenario and clause level)

| Requirement | Scenario / clause | Task |
|---|---|---|
| FR-1 | Non-admin 403 · 401 · BUT not revealing the cycle | T-8, T-9 |
| FR-2 | Grouping and order · `"*"` · requirement · `isNew` · BUT no subfields · AND IT MUST ties by array position | T-2, T-6, T-9 |
| FR-2 | Year comes from the cycle | T-2, T-6 |
| FR-2 | Catalog missing (typed) / down (503) · BUT no empty list | T-2, T-6, T-9 |
| FR-3 | Unclassified · Not in catalog · Summary values | T-6, T-9 |
| FR-4 | Explicit contradiction | T-3, T-9 |
| FR-4 | Switching off · AND IT MUST constraint | T-3, T-7 (service), T-1 (CHECK), T-9 |
| FR-5 | Several items · Several problems (BUT no stop at first) · Two admins · Same values | T-3, T-5, T-7, T-9 |
| FR-6 | Discard (with / without version) | T-7, T-9 |
| FR-7 | Changes and timelines (receive / keep / neither) · BUT no write · Nothing to publish | T-4, T-6, T-9 |
| FR-8 | Publish · Stale revision · Nothing to publish | T-7, T-9 |
| FR-8 | Two admins publish at once | T-1 (UNIQUE), T-5, T-7, T-9, T-11 |
| FR-8 | Replay after a lost answer | T-8, T-9 |
| FR-9 | Before any start · While running · Opening day · Not started · Started with none (BUT no fallback) · On hold | T-4, T-6 |
| FR-10 | Effective configuration · Type outside the timeline | T-6 |
| FR-11 | Audit record · BUT only changed items · refused leaves none | T-1, T-3, T-5, T-7, T-9, T-11 |
| FR-12 | Immutability | T-1, T-7 |
| FR-13 | Closed cycle (writes 409, reads work) · Unknown cycle 404 | T-6, T-7, T-8, T-9 |
| FR-14 | Front contract | T-10 |
| NFR-1, NFR-2 | Access, unknown fields | T-8, T-9 |
| NFR-3 | Concurrent publish | T-5 (fake), T-9 (fake), T-11 (MySQL) |
| NFR-4 | Rome midnight and DST, two `TZ` | T-4 |
| NFR-5 | Fixed statements | T-5, T-6 |
| NFR-6 | Catalog availability and cache | T-2 |
| NFR-7 | Decision lines | T-7, T-9 |
| NFR-8 | One audit row per publication | T-1, T-5, T-7, T-11 |
