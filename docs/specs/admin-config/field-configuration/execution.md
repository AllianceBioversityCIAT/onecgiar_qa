# Field configuration per cycle — Execution Log

## 1. Document Control

| | |
|---|---|
| Spec path | `docs/specs/admin-config/field-configuration` |
| Branch | `feat/field-configuration` (from `origin/staging-center` @ `0b62fd1`) |
| Approval Mode | gated |
| Leader | Claude Code, `claude-opus-5-5` (T1) |
| Implementer / Reviewer | `akili-implementer` (`sonnet`, T2) / `akili-reviewer` (`opus`, T3) — Step 8E wrappers |
| Started | 2026-10-26 |
| Persona check | `akili doctor --agents`: no drift |

**Run notes**
- Run in the same session as `/akili-specify` (constitution, spec and `leader.md` already in context).
- `docs/specs/kaizen-log.md` does not exist; the brief carries the lessons the spec cites (KZ-admin-config--cycle-timelines-1, -2, -3) and the timeline-edit execution signals recorded in `tasks.md`.
- T-1…T-4 are file-disjoint but share `server/dist/` and the vitest runner, so they run serially (`tasks.md` serial boundaries).

## 2. Task Execution History

### T-1: Schema and migration `0005` (five tables) — PASS

| | |
|---|---|
| Date | 2026-10-26 |
| Final status | PASS (attempt 1) |
| Attempts | 1 |
| Skills | nestjs-expert, nestjs-best-practices (as listed) |
| Effort | `high` (above the T2 default: the migration is permanent once applied to `qadb`) |
| Requirements covered | FR-4 (AND IT MUST: the CHECK), FR-8 (UNIQUE backstop), FR-11 (UNIQUE `version_id`), FR-12, NFR-8 |

**Attempt 1**
- Files changed: `server/src/database/drizzle/schema/field-config-drafts.ts`, `field-config-draft-items.ts`, `field-config-versions.ts`, `field-config-version-items.ts`, `field-config-audit-events.ts` (new); `schema/index.ts`; `schema/schema.spec.ts` (+483); `server/drizzle/0005_field_configuration.sql`, `server/drizzle/meta/0005_snapshot.json` (new), `meta/_journal.json`; `server/src/database/AGENTS.md`.
- Red run (pins first): `Tests 41 failed | 97 passed (138)` on assertions, e.g. `committed migrations > are exactly six SQL files: expected [ '0000_silent_risque.sql', …(4) ] to have a length of 6 but got 5`.
- Falsifiers (each observed red, reverted, `cmp` identical):
  - F1 drop `OR visibility = 'assessed'` → `field_config_draft_items schema > CHECK: core and AI input are possible only when assessed…` and the version-items CHECK pin red; in SQL → `committed migration 0005 > carries the two flag CHECKs and the draft last-edit CHECK verbatim` red.
  - F2 remove UNIQUE (`cycle_id`, `number`) → `field_config_versions schema > backstops the publish race: one version number per cycle` red.
  - F3 append ``ALTER TABLE `timelines` ADD `note` varchar(10);`` → `committed migration 0005 > is additive only…` red.
  - F4 remove UNIQUE (`version_id`) → `field_config_audit_events schema > allows exactly one record per publication` red.
  - F5 65-character FK name → `committed migration 0005 > keeps every identifier within MySQL's 64-character limit` red.
- SQL read line by line: 5 `CREATE TABLE`, 9 `ADD CONSTRAINT … FOREIGN KEY` (all `no action`), 2 `CREATE INDEX`; no DROP/INSERT/UPDATE/DELETE/MODIFY/RENAME; no `ALTER` on an existing table. `0005_snapshot.json` `prevId` equals the `0004` id; journal idx 5.
- Implementer verification: `pnpm lint && pnpm build && pnpm test --reporter=dot` exit 0, `Tests 2005 passed (2005)`; tsc only the 7 `token-verifier.service.spec.ts` errors.
- Evidence re-run (Leader-inline, non-author): **VERIFIED** — lint OK, build OK, `Tests 2005 passed (2005)`, tsc 7 in `token-verifier.service.spec.ts`.
- Reviewer (lens checklist, effort high): **PASS** — "The five tables match design § 5 column by column… Migration `0005` is additive only… These are behavioural pins on the generated DDL, not checks that a table merely exists."
- runtime events: none.

spawns: implementer 38 calls, 156736 tokens, ended partial (Not Done / Assumptions — judgment calls only, no owed item); reviewer 10 calls, 59888 tokens, ended complete.

**Not Done / Assumptions (Implementer, in substance)**
1. Hand-named constraints: `field_config_version_items_version_fk` (the generated name is 65 characters, over MySQL's 64), PKs `field_config_draft_items_pk`, `field_config_version_items_pk`; a new pin keeps every identifier in `0005` ≤ 64.
2. An FK `field_config_audit_events.cycle_id → cycles.id` (`no action`) that design § 5 did not draw.
3. Every column NOT NULL except `request_id` and `updated_*`.
4. The existing `0004` journal pin narrowed to `.slice(0, 5)` (forced by the sixth entry).
5. No "no update columns" pin on draft items (mutable by design, FR-6).
6. `fieldConfigFlagsCheck` exported once and reused by both item tables.

Leader adjudication: no blocker, no owed item; Reviewer accepted all six.

**ADVISORY (Reviewer — recorded, not tasks)**
- RISK: the audit `cycle_id` FK goes beyond design § 5 → amended (below).
- READABILITY: `fieldConfigFlagsCheck` / `fieldConfigVisibilities` live in `field-config-draft-items.ts` and are reused by version items; a shared file would make the dependency clearer.
- RELIABILITY: the drafts PK pin proves the key by the SQL pin, not by `primaryKeyOf`.

**Decisions made**
- Effort `high`.
- **Execute-time spec edit (2026-10-26):** `design.md` § 5, `field_config_audit_events` row — `cycle_id` now drawn as `→ cycles.id`, matching the migration. Clarification only; no requirement changes. Carried to the T-2 Reviewer as a named conformance check.

**Final verification:** VERIFIED.

### T-2: Catalog reader per year — client, keyed cache, shaping — PASS

| | |
|---|---|
| Date | 2026-10-26 |
| Final status | PASS (attempt 1) |
| Attempts | 1 |
| Skills | nestjs-expert, error-handling-patterns, tdd (as listed) |
| Effort | `medium` |
| Requirements covered | FR-2 (Grouping and order; Year comes from the cycle; Catalog missing or down), NFR-6 |

**Attempt 1**
- Files changed: `server/src/users/catalogs/catalog-http.ts` (+16 -1: opt-in `notFound: 'outcome'` → `CATALOG_NOT_FOUND`), `catalog-http.spec.ts` (+33 -1, one `describe` added); new `server/src/admin-config/field-config/field-catalog.ports.ts` (`FIELD_CATALOG_SOURCE`, `FieldCatalogSource`, `FieldCatalogMissingError`), `field-config-catalog.ts` + spec, `reporting-qa-catalog.client.ts` + spec, `fixtures/reporting-qa-catalog-2026.json` (Leader-fetched, byte-unchanged).
- Red run (stubs first): `42 failed | 7 passed (49)`, all on assertions, e.g. `expected [] to have a length of 70 but got +0`, `expected { catalogVersion: '', …(3) } to be an instance of FieldCatalogMissingError`.
- Falsifiers (each red against the finished code, then restored, `diff` identical):
  - F1 year from the clock → 3 red (`…phase_year=2027` URL; `expected '2026.30' to be '2027.1'`).
  - F2 404 → 503 → 3 red (`expected UpstreamUnavailableError … to be an instance of FieldCatalogMissingError`).
  - F3 section ties by key → `expected [ 'capacity_sharing', …(4) ] to deeply equal [ 'knowledge_product', …(4) ]`.
  - F4 skip `"*"` → 10 red (`have a length of 50 but got 20`, …).
- Implementer verification: lint clean, build 0, `Tests 2053 passed (2053)`. Consumer suites (catalog-http, clarisa-science-programs, reporting-result-types) 30 passed, importer sources unmodified.
- Evidence re-run (Leader-inline, non-author): **VERIFIED**: lint OK, build OK, `Tests 2053 passed (2053)`, `src/users/catalogs` `46 passed`.
- Reviewer (lens checklist, effort high): **PASS**. Quote: "`catalog-http.ts` only gains an opt-in branch placed before `!res.ok`, so the three importers keep 'every non-2xx → 503' (P-7)… The count amendment is internally consistent… F3 genuinely goes red." Both named checks passed.
- runtime events: none.

spawns: implementer 24 calls, 132690 tokens, ended partial (Not Done / Assumptions: judgment calls only, no owed item); reviewer 20 calls, 64639 tokens, ended complete.

**Not Done / Assumptions (Implementer, in substance; Reviewer ruled each conformant)**
1. Per-field flag name `is_new` (boolean); a non-boolean value → malformed → 503.
2. Strict shaping: unknown type or section, or a missing `order` / `required` / `catalog_version` → typed 503, never skipped.
3. The "no subfield" test counts 249 nested subfields (the doc's 217 are direct children).
4. The cache reads `ADMIN_CONFIG_CLOCK`, not `CATALOG_CLOCK`. **Forward pointer to T-6/T-8:** provide it when wiring.
5. `getJson` logs `upstream_not_found source=reporting` on an opted-in 404 (no URL or key).

Leader adjudication: no blocker, no owed item.

**ADVISORY (Reviewer — recorded, not tasks)**
- RISK: a future non-boolean `is_new` or new Reporting field shape turns the whole catalog into 503; confirm the flag name/type with Reporting (S-6 request, T-10 pending item).
- RELIABILITY: `expandTypes` accepts `["*", "bogus"]` as all types; duplicate section/field keys are not detected (would collide on the (type, field) PK at publish).
- RELIABILITY: requirement uses truthiness of `required_when` (`{}` → conditional, `null` → optional); harmless on the fixture.
- READABILITY: `malformed()` builds a `new Logger` per call.
- RESILIENCE: the e2e fake clock is fixed (P-10), so the per-year cache never expires in an e2e run. **Forward pointer to T-8/T-9 briefs.**


**Decisions made (recorded as they happen)**
- **Fixture source (2026-10-26):** the back lead authorized the fetch and gave the TEST URL and key in chat. The Leader downloaded `GET https://prtest-back.ciat.cgiar.org/api/qa/catalog?phase_year=2026` into `server/src/admin-config/field-config/fixtures/reporting-qa-catalog-2026.json`: response body only, no key or headers (`grep -c cl_test` → 0). Checked: `catalog_version` `2026.30`, 9 result types, 25 sections, 161 fields, 30 fields with `"*"`.
- **Execute-time spec edit (2026-10-26), approved by the back lead ("Sí, corrige"):** the `docs/reporting-catalog.md` § 2.3 per-type counts leave out the 30 `"*"` fields. With `"*"` expanded as FR-2 requires, the counts on the fixture are policy_change 50, innovation_use 70, other_outcome 43, capacity_sharing 51, knowledge_product 69, innovation_development 70, other_output 43, impact_contribution 43, innovation_package 65. Edited: `tasks.md` T-2 *Tests* and *Done when*; `design.md` § 5 *Size check* and DD-2 (234 → 504 rows per version). This corrects a number and does not change any requirement. Without the edit, T-2's falsifier (skip `"*"` expansion) would have turned the counts green instead of red. It is carried to the T-2 Reviewer as a named conformance check.
- **Brief narrowing (2026-10-26):** `FieldCatalogMissingError` is defined in `admin-config/field-config/` as a plain typed error with no HTTP status and no catalog code, because `error-codes.ts` and `admin-config.errors.ts` belong to T-3 (serial boundary). **Forward pointer to T-3:** bind `FieldCatalogMissingError` to 409 `FIELD_CONFIG_CATALOG_MISSING`. Module wiring stays with T-6/T-8.
- Skills as listed (nestjs-expert, error-handling-patterns, tdd). Effort `medium` (T2 default).

**Final verification:** VERIFIED.

### T-3: Draft rules, diff and catalog codes — PASS

| | |
|---|---|
| Date | 2026-10-26 |
| Final status | PASS (attempt 1) |
| Attempts | 1 |
| Skills | nestjs-best-practices, error-handling-patterns, api-design-principles, tdd (as listed) |
| Effort | `medium` |
| Requirements covered | FR-4 (Explicit contradiction; Switching off, rules side), FR-5 (Several problems), FR-7/FR-8 (Nothing to publish = empty diff), FR-11 (BUT only changed items), S-7 |

**Attempt 1**
- Files changed: new `server/src/admin-config/field-config/field-config-rules.ts` + spec, `field-config-diff.ts` + spec; edited `server/src/common/error-codes.ts` (+16), `error-codes.spec.ts` (+47: pin 14 → 15, title "eight" → "nine", appended class entries), `server/src/admin-config/admin-config.errors.ts` (+49: `FieldConfigCatalogMissingError` 409, `FieldConfigRevisionStaleError`, `FieldConfigNothingToPublishError`, plain-`Error` `FieldConfigTypeNotInTimelineError`, `FieldConfigNoVersionError`), `field-config/field-catalog.ports.ts` (re-exports `FieldCatalogMissingError`).
- Red run (stubs returning `[]`): `25 failed | 27 passed`, on assertions (`expected [] to deeply equal [ { field: 'items[0].isCore', …} ]`). The error-code spec additions had no separate red: they were written with the classes, and a missing export is not a red.
- Falsifiers (post-change, restored, `cmp` identical): isCore check disabled → 11 red; stop at the first issue → 3 red; unclassified as `null` → 13 red (`expected [ Array(504) ] to deeply equal []`).
- Implementer verification: lint clean, build OK, unit `2114 passed`, e2e `779 passed` (13 files). Consumers green: error-codes.spec, openapi e2e, `src/common src/users src/admin-config` 1667 passed.
- Evidence re-run (Leader-inline, non-author): **VERIFIED**: lint clean, build 0, unit `2114 passed (2114)`, e2e `779 passed (779)`.
- Reviewer (lens checklist, effort high): **PASS**. Quote: "The three top-level codes match § 7.5 word for word… `NOT_ASSESSED` is added, the field-code pin moves 14 → 15 and new entries are only appended." It ruled all five Leader questions conformant; FR-4 storing omitted flags as false is a T-7 obligation (tasks.md T-7 "Switching off (stored)"). The named check (504 amendment) passed.
- runtime events: none.

spawns: implementer 25 calls, 136364 tokens, ended partial (Not Done / Assumptions: judgment calls only, no owed item); reviewer 19 calls, 65343 tokens, ended complete.

**Not Done / Assumptions (Implementer, in substance)**
1. Fixtures derive from the T-2 JSON via `shapeCatalog` / `applicableFields`; non-applicable fields are found by search.
2. Normalising omitted flags is the service's job (it cited T-5; the owner is T-7); `validateDraftEdit` only reports contradictions.
3. An unknown type reports `resultTypeKey` only (its field cannot be judged); flags are still judged. Repeats are flagged on later occurrences only.
4. The effective-query errors are plain `Error` subclasses (§ 7.5, "no HTTP route yet"), and the spec asserts they are not `HttpException`.

Leader adjudication: no blocker, no owed item.

**ADVISORY (Reviewer — recorded, not tasks)**
- RELIABILITY: FR-4 *Switching off* does not say what to store for an `assessed` item sent with the flags omitted: false, or the stored flags? The comment at `field-config-rules.ts:460` assumes false. **Forward pointer to T-7:** settle and pin it (it also decides FR-5 *Same values*). The Leader raised it to the back lead at the T-3 gate.
- READABILITY: the comment at `field-config-rules.ts:448-449` ("no second code") is inexact for a repeated unknown-type pair.
- READABILITY: `server/src/admin-config/AGENTS.md` does not list the new error classes yet. That is T-10's deliverable (the Reviewer cited T-11).
- RISK: `FieldCatalogMissingError.message` is now the HttpException text; logs that need the year should use `.year`.

**Final verification:** VERIFIED.

**Decisions made (recorded as they happen)**
- Forward pointer from T-2 carried in the brief: bind `FieldCatalogMissingError` to 409 `FIELD_CONFIG_CATALOG_MISSING`. The Leader narrowed how: the class moves to `admin-config.errors.ts` (keeping `.year`), and `field-catalog.ports.ts` re-exports it, so T-2's client and tests stay unchanged and green.

### T-4: Version resolution and receive / keep — PASS

| | |
|---|---|
| Date | 2026-10-26 |
| Final status | PASS (attempt 1) |
| Attempts | 1 |
| Skills | nestjs-best-practices, tdd (as listed) |
| Effort | `high` (see decisions) |
| Requirements covered | FR-9 (all six scenarios), FR-7 *Changes and timelines* (receive / keep / neither, DD-8), NFR-4 |

**Attempt 1**
- Files changed: new `server/src/admin-config/field-config/field-config-versions.ts` (`versionFor`, `receiveAndKeep`; exported `TimelineStart`, `PublishedVersion`, `VersionResolution`, `ReceiveAndKeep`), `field-config-versions.spec.ts` (60 table-driven cases).
- Red run (stubs with the final types): `53 failed | 7 passed (60)`, all `AssertionError` (e.g. `expected 'none' to deeply equal { number: 1, provisional: false }`). The 7 passing cases expect the stub's own answer.
- Falsifiers (post-change, `TZ=UTC`, restored, `diff` identical): `<` → `<=` 13 red (opening day 09:00 Rome; 00:00 winter/summer; 00:30 Rome = 23:30Z); UTC dates 22 red; fall back to latest 2 red (`expected { number: 1, provisional: false } to be 'none'`); start `<= 0` → `< 0` 10 red; finished `> 0` → `>= 0` 3 red.
- Implementer verification: lint 0 warnings, build 0, `Tests 2174 passed (2174)`; the spec under `TZ=UTC` and `TZ=America/Bogota` gives `60 passed` each.
- Evidence re-run (Leader-inline, non-author): **VERIFIED**: lint clean, build 0, `2174 passed (2174)`, `60 passed (60)` under both TZ.
- Reviewer (lens checklist, effort high): **PASS**. Quote: "Every Tests bullet and Falsifier in tasks.md § T-4 is covered by an instant that crosses midnight in Rome, and the suite runs under both `TZ` values." The named checks passed: S-14 is consistent with FR-4, FR-5 and `field-config-rules.ts:60-64`, and the 504 amendment is untouched. All four Leader points were ruled conformant: finished is dates-only per the § 7.3 input; the `now` parameter is required by the design's own rule; not started with no versions gives `none`; empty `changedTypes` gives empty lists.
- runtime events: none.

spawns: implementer 24 calls, 125113 tokens, ended partial (Not Done / Assumptions: judgment calls only, no owed item); reviewer 13 calls, 51111 tokens, ended complete.

**Not Done / Assumptions (Implementer, in substance)**
1. "Finished" is dates-only (today in Rome after the last `closes_on`). `viewTimeline` lets the load hold win, so the timelines screen shows a held timeline past its close as `waiting_for_load`.
2. The signature adds `now: Date`, and `publishedAt` is an instant (Rome day derived inside).
3. `'none'` is a string literal; `receive` holds ids only (T-6 joins names). *On hold* is covered by the rule that `opensOn` alone decides.

Leader adjudication: no blocker, no owed item.

**ADVISORY (Reviewer — recorded, not tasks)**
- RISK (spec gap): a started timeline on load hold past its last `closes_on` is left out of the preview/audit lists while the timelines screen still shows it as `waiting_for_load`. Until loads exist, every started timeline is held in the view. **Raised to the back lead at the T-4 gate as a one-line amendment proposal (DD-8a).**
- READABILITY: design § 7.1 `versionFor` signature outdated → **amended** (below).
- RELIABILITY: a not-started timeline with no versions resolves to `'none'` without a provisional marker. **Forward pointer to T-6:** decide whether the effective query (FR-10) treats it as the same "no configuration" error.
- RELIABILITY (S-14): **forward pointer to T-7:** FR-5 *Same values* must compare items after normalising omitted flags to false.


**Decisions made (recorded as they happen)**
- **Execute-time spec edit (2026-10-26), approved by the back lead ("La A"):** this resolves the T-3 Reviewer advisory on FR-4. `requirements.md` gains decision **S-14** ("an omitted flag is false", also for `assessed`) and an AND line in FR-4 *Switching off*. It fills a gap and does not reverse an approved clause. Carried to the T-4 Reviewer as a named conformance check and **forward pointer to T-7** (store and pin it; FR-5 *Same values* compares against the normalised item) and T-10 (`front-contract.md`: send both flags to keep them on).
- **Execute-time spec edit (2026-10-26, Leader, clarification):** `design.md` § 7.1 `versionFor` row now reads `(timeline, versions, now)` with `publishedAt` an instant. It matches the code and does not change the rule. Carried to the T-5 Reviewer as a named check.
- Skills: nestjs-best-practices, tdd (as listed). Effort `high`, above the T2 default: the date-boundary rule is what P2-3907 AC 13–14 depend on (Rome midnight, DST, two TZ).

**Final verification:** VERIFIED.
