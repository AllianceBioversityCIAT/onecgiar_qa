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

### T-5: Store and unit of work — draft lock, conditional revision, version insert, audit — PASS (attempt 2, degraded-pair: opus/fable)

**Decisions made (recorded as they happen)**
- **Execute-time spec edit (2026-10-26), approved by the back lead ("A"):** `design.md` § 10 gains **DD-8a** ("finished" for receive / keep is dates only; the load hold is ignored; revisit when loads land). This closes the T-4 Reviewer spec-gap advisory. `TimelineStart` needs no load signal, so T-5's `listTimelineStarts` stays at dates and scope. Carried to the T-5 Reviewer as a named check, together with the § 7.1 `versionFor` signature edit.
- Skills: nestjs-expert, nestjs-best-practices (as listed). Effort `xhigh` (Effort dial: concurrency on a race-prone write path). Review: parallel lens reviewers (concurrency/transaction scope, per tasks.md + xhigh).

**Attempt 1 — FAIL (parallel lens reviewers)**
- Files changed: new `server/src/admin-config/field-config/field-config.store.ts` (443), `field-config.unit-of-work.ts` (82), `field-config.unit-of-work.spec.ts` (1338), `server/test/support/in-memory-field-config.ts` (676).
- Red run: `26 failed | 1 passed (27)`, on outcome assertions (e.g. `expected [ 'updated', 'updated' ] to deeply equal [ 'updated', 'stale' ]`).
- Falsifiers: fake F1, F1a, F2, F3, F4 and adapter/UoW A1–A5, each red against the post-change code and then restored. Statement counts: adapter publish 20 for 13 and 40 fields (fake 16); draft edit 8 (adapter) / 5 (fake) for 3 and 2,000 items; `listTimelineStarts` 3 for 0 / 1 / 50.
- Implementer verification: lint clean, build 0, `Tests 2201 passed (2201)`.
- Evidence re-run (Leader-inline): **VERIFIED**: `2201 passed`, e2e `779 passed`.
- Reviewer A (concurrency / transaction scope): **PASS**. No wait cycle (P-11); a 1062 inside the transaction rolls back cleanly; the conditional-alone case keeps DD-6 pinned.
- Reviewer B (conformance / readability / risk): **FAIL**, verbatim issue:
  > 1. Discovered Issue: `bumpRevision(cycleId, change: DraftWrite, expectedRevision?)` and the added `lockCycleShared` in the `FieldConfigStore` port differ from the port list in § 7.3, and no amendment was written. The new required `change` argument also makes every bump, including a publish, overwrite `updated_at`/`updated_by`. § 7.2 Publish step 3 shows only `SET revision = revision + 1`, and the in-memory test asserts that a publish leaves `updatedBy: 9`. So the spec now encodes a "publisher becomes last writer" behavior that T-7 never decided. The stated reason ("needed by the both-or-none CHECK") does not force this: leaving both columns untouched also satisfies `chk_field_config_drafts_updated`. T-6 and T-7 implement from § 7.3, so the drift will spread.
  > Violated Rule: design.md § 7.3 Ports; § 7.2 Publish step 3; TRD § 2.3.
  > Remediation Suggestion: amend the § 7.3 ports row the way the § 7.1 `versionFor` row was amended ("amended 2026-10-26 at T-5"), with the actual signature `bumpRevision(cycleId, { updatedAt, updatedBy }, expected?)` and `lockCycleShared` added to the write list, and state in one clause whether a publish's bump sets `updated_*` (on § 7.2 Publish step 3 as well). If the answer is "no", make `change` optional and have the publish path omit it; the CHECK holds either way.
- Leader adjudication: in scope. The port is T-5's deliverable, and § 7.2 *Publish* step 3 already answers "no". **Execute-time spec edit (Leader, clarification of § 7.2):** § 7.3 ports row amended with `lockCycleShared` and `bumpRevision(cycleId, change?, expected?)`: the edit and the discard pass `change`, and the publish does not. Carried to the attempt-2 Reviewer as a named check.
- runtime events: none.
- Note: the implementer ran 86 tool calls, past the persona's 60-call checkpoint bound, without reporting a checkpoint.

spawns: implementer 86 calls, 380220 tokens, ended complete; reviewer A 12 calls, 71896 tokens, ended complete; reviewer B 20 calls, 89972 tokens, ended complete.

**ADVISORY (attempt 1, recorded, not tasks)**
- A RELIABILITY (forward pointer to T-7): `datetime` rounds to the second, so 23:59:59.6 Rome can store as the opening day. T-7 must truncate `now` to the second once and use that value for both the lists and the insert.
- A RESILIENCE (forward pointer to T-7): keep the conditional UPDATE as the deciding guard in the service, with its own conditional-alone falsifier; the locked re-check is defence in depth.
- A RELIABILITY (forward pointer to T-7): with no draft row, publish matches 0 rows and is always stale. Confirm this, or call `ensureDraft` first (DD-10).
- A READABILITY: the fake locks absent draft keys, which InnoDB under RC does not. Say so in its comment.
- A RISK: `isDuplicateKeyError` is imported from `users/users.errors.ts` (cross-module).
- B READABILITY: the `listTimelineStarts` comment says the reads do not wait on each other, but they are awaited serially (`respond()` uses `Promise.all`).
- B RISK: `VALUES()` is deprecated since MySQL 8.0.20 → TRD pending item at T-10; T-11 runs the upsert on MySQL.
- B RISK: no driver `timezone` is set, so `published_at` round-trips in the process's zone → T-11 check.
- B READABILITY: the adapter cases pin drizzle SQL text with regexes; the "fake refuses what the schema refuses" case tests the fake; `publishWork` must stay in sync with T-7's service.
- B READABILITY: the `listTimelineStarts` mapping is duplicated between the adapter and the fake.
- Attempt 2: effort xhigh → max is not allowed on T2 (registry *Effort dial*), so the tier is escalated instead: Implementer on `opus` (T1/T3 model), effort `xhigh`. Reason: rework after a lens FAIL; the fix is small but sits on the race-prone write path.

**Attempt 2 — PASS (degraded-pair: opus/fable)**
- Files changed: `field-config.store.ts` (443 → 449), `field-config.unit-of-work.spec.ts` (1338 → 1371), `in-memory-field-config.ts` (676 → 679); `field-config.unit-of-work.ts` unchanged. `change` is optional in the port, the adapter and the fake, and the publish omits it.
- Red run (test edits only): `2 failed | 26 passed (28)`. The publish SET still carried `updated_at = ?, updated_by = ?`, and the publication case got `updatedBy: 9` instead of the seeded `1`.
- Falsifiers (final code, restored with `cmp`): fix falsifier (the publish passes `change` again) → the same 2 red; F1 → 4 red (`[ 'updated', 'updated' ]`); A1 → 2 red.
- Implementer verification: lint clean, build 0, `Tests 2202 passed (2202)`. Statement counts are unchanged (adapter publish 20, fake 16, draft edit 8). Four attempt-1 assertions that encoded the old behavior were removed and replaced by the exact-SET case.
- Evidence re-run (Leader-inline, non-author): **VERIFIED**: lint clean, build 0, `2202 passed (2202)`.
- Reviewer (`fable`, all four lenses, effort high): **PASS**. Quote: "Attempt 2 fixes the attempt-1 FAIL exactly as the amended `design.md` § 7.3 ports row reads… Concurrency guards from attempt 1 are intact." The three named checks passed (§ 7.3 row, DD-8a, § 7.1 `publishedAt`).
- runtime events: none.

spawns: implementer (`opus`) 41 calls, 142043 tokens, ended complete; reviewer (`fable`) 29 calls, 127310 tokens, ended complete.

**ADVISORY (attempt 2, recorded)**
- RISK: § 7.2 *Discard* step 4 did not match the amended § 7.3 → **amended**: the Leader edited § 7.2 step 4 to "Revision + 1, with `updated_at/by`", a clarification. Carried to the T-6 Reviewer as a named check.
- READABILITY: the positional `bumpRevision(cycleId, undefined, expected)`; an options object would read better if the row is revisited.
- RELIABILITY: `copyVersionToDraft` must follow `deleteDraftItems`. **Forward pointer to T-7** (discard order).
- Extra review requested by the back lead (T-5 gate, "Revisión extra con Opus"): reviewer (`opus`, same model as the attempt-2 Implementer) **PASS**, `ISSUES: 0`. Quote: "It conforms to the spec." All four named checks passed (§ 7.3 row, § 7.2 *Discard* step 4, DD-8a, § 7.1 `publishedAt`). It also traced the two falsifiers that attempt 1 executed (audit outside the transaction; draft lock dropped only) against the attempt-2 code. Both stay red as the task's list requires.
  - ADVISORY RELIABILITY: no T-5 case runs two edits of the same (type, field) (FR-5 *Two admins edit*); its Tests list does not ask for one. **Forward pointer to T-7 / T-9:** run it explicitly.
  - ADVISORY RESILIENCE: three or more concurrent first-ever draft edits, and a 1213 inside publish, are the deadlock-prone paths the fake cannot show. **Forward pointer to T-11** (HITL) and **T-7** (answer a 1213 by rethrowing, no retry, never an unmapped 500).
  - ADVISORY RELIABILITY: the fake computes item lock keys before the refresh; harmless under the draft X lock. A comment is suggested.
  - ADVISORY READABILITY: without `expectedRevision`, a 0-row bump returns `stale` ("row gone"). **Forward pointer to T-7:** assert that the edit and discard paths never see `stale`.
  - spawns: reviewer (`opus`) 17 calls, 105435 tokens, ended complete.

## REVIEW_WAIVED: T-5

| Field | Content |
|---|---|
| flag | `degraded-pair` |
| cause | Attempt 2 is a rework after a lens FAIL. The effort bump xhigh → max is not allowed on T2 (registry *Effort dial*), so the Implementer tier was escalated to `opus`, the T3 Reviewer model. To keep author ≠ auditor, the gate Reviewer ran on `fable`, a different model outside the registry's T3 entry. The back lead then asked for an additional `opus` review (same model), which also returned PASS. |
| approved by | the back lead, 2026-10-26, at the T-5 gate ("Revisión extra con Opus": close after an extra Opus review). The Opus review passed. |
| verification that stood in | `cd server && pnpm lint && pnpm build && pnpm test --reporter=dot` → exit 0, `2202 passed (2202)`, re-run by the Leader (non-author) |
| models | Implementer attempt 1 `sonnet`, attempt 2 `opus` / auditors: attempt 1 `opus` (lens A PASS, lens B FAIL); attempt 2 `fable` PASS (gate), `opus` PASS (extra, same-model) |

Task entry Reviewer field: **PASS (degraded-pair: opus/fable)**.

**Requirements covered (T-5):** FR-5 (Two admins edit: last write wins at the store level), FR-8 (Stale revision; Two admins publish at once, database side), FR-11 (audit in the transaction; a refused publication leaves none), NFR-3 (fake part), NFR-5.

**Final verification:** VERIFIED.

### T-6: Service read flows — view, preview, effective query — PASS

| | |
|---|---|
| Date | 2026-10-26 |
| Final status | PASS (attempt 1, 1 continuation) |
| Attempts | 1 |
| Skills | nestjs-expert, api-design-principles (as listed) |
| Effort | `medium` |
| Requirements covered | FR-2 (through the service), FR-3, FR-7, FR-10, FR-13 (reads), NFR-5 (view/preview/effective statement counts) |

**Attempt 1**
- Files changed: new `server/src/admin-config/field-config/field-config.service.ts` + spec, `field-config.module.ts` + spec (DI, the only export is `FIELD_CONFIG_EFFECTIVE`). Edited: `field-config.store.ts` (`NamedTimelineStart` adds `name`, read in the same first select, still 3 statements), `field-config.unit-of-work.spec.ts` (3 `toEqual` gain `name`), `server/test/support/in-memory-field-config.ts`. Continuation: `field-config-catalog.ts` + spec (`description` pass-through).
- Red run (methods stubbed to throw): `26 failed`. 7 failed on their own assertions; 19 failed on the stub's throw. The Reviewer accepted this as the predicted red. Continuation red: `3 failed`.
- Falsifiers (post-change, restored): F1 catalog read for the clock's year → 3 red (`expected "vi.fn()" to be called with arguments: [ 2027 ]`); F2 unclassified read as null → 1 red; F3 every type treated as changed → 4 red (C in receive; 50 vs 25); description pass-through dropped → 1 red.
- Statement counts: view 5; preview 8 for 1 and 50 timelines (scope alternates, 25 receive); effective 5, with 0 catalog reads.
- Implementer verification: lint clean, build OK, `Tests 2231 passed (2231)`; the field-config folder also passes under `TZ=America/Bogota`.
- Evidence re-run (Leader-inline, non-author): **VERIFIED**: lint clean, build 0, `2231 passed`, Bogota `215 passed`, e2e `779 passed`.
- Reviewer (lens checklist, effort high): **PASS**. Quote: "`view`, `preview` and `effectiveFor` cover every scenario in FR-2, FR-3, FR-7, FR-10 and FR-13 through the service… The view shape, including `description?`, matches design § 6 field by field." Named checks: the § 7.2 *Discard* amendment is not contradicted; the § 7.3 row needs no amendment for `name` (the row does not list returned fields).
- runtime events: none.

spawns: implementer 52 calls, 194164 tokens, ended complete (after continuation 1; the first report ended partial); reviewer 15 calls, 71795 tokens, ended complete.

**Not Done / Assumptions (Implementer; owed item #3 closed by the continuation; the rest ruled conformant)**
1. `NamedTimelineStart` (T-5 store edit, a demonstrated need).
2. `effectiveFor(cycleId, timelineId, resultTypeKey)` → `{ timelineId, resultTypeKey, version, provisional, items }`. An unknown timeline or one in another cycle gives `TimelineNotFoundError`.
3. ~~Field `description` missing~~ → done in continuation 1.
4. Sections with no applicable fields are left out.
5. Preview `keep[].version` is `number | null`. **Forward pointer to T-10:** document the null in `front-contract.md`.
6. `latestVersion.publishedAt` is a `Date`, which T-8 serializes.
7. The unit of work is not injected yet. **Forward pointer to T-7.** The module binds `IDEMPOTENCY_CLOCK`.

**ADVISORY (Reviewer — recorded, not tasks)**
- RISK: `description: null` makes the whole catalog malformed (503); treating it as absent would be more tolerant (RC-1…RC-4 drift).
- READABILITY: the effective-port types live in `field-config.module.ts` and the service imports them back; a `field-config.ports.ts` would remove the cycle.
- READABILITY: the effective test's version fixture holds one item, against DD-2; the `items` docstring describes a guarantee that the publish path provides.
- RELIABILITY: `effectiveFor` loads every timeline of the cycle to pick one (count fixed, but § 7.2 step 1 reads one).
- RELIABILITY: "one catalog read per request" is not asserted for the preview. **Forward pointer to T-9.**

**Final verification:** VERIFIED.

**Decisions made (recorded as they happen)**
- Integration (2026-10-26, back lead's request): T-1…T-5 merged with `--no-ff` into `staging-center` (`ac16b01`) and into `dev` (`7a82c27`, pushed; Jenkins trigger run 40356052489 succeeded). Before the `dev` push, the Leader verified the merged `dev`: server lint clean, build 0, `2202` unit and `779` e2e passed, client `ng build` 0. Migration `0005` is **not** applied to `qadb`; that stays a human step (T-11). There is no HTTP route yet (T-8).
- Forward pointers carried: from T-2, the cache uses `ADMIN_CONFIG_CLOCK`, so the module must provide it. From T-4, a not-started timeline with no versions resolves to `'none'`; the Leader narrowed that the effective query answers `FieldConfigNoVersionError` for it, as for a started timeline with none (no version exists to resolve to). From T-5, § 7.2 *Discard* step 4 and the § 7.3 ports row amendments are carried as named checks.
- Skills: nestjs-expert, api-design-principles (as listed). Effort `medium`.
- continuations: 1 (field `description` in the view, design § 6: Implementer Not Done #3 was an owed item, with no blocker; gated mode → re-spawn for the remainder, the same worker resumed by message).

### T-7: Service write flows — draft edit, discard, publish — PASS

| | |
|---|---|
| Date | 2026-10-26 |
| Final status | PASS (attempt 1) |
| Attempts | 1 |
| Skills | nestjs-expert, error-handling-patterns (as listed) |
| Effort | `high` |
| Requirements covered | FR-4 (Switching off, stored; S-14), FR-5 (all four scenarios), FR-6, FR-8 (Publish, Stale, Nothing to publish, Two admins on the service side), FR-11, FR-12, FR-13 (writes), NFR-7 |

**Attempt 1**
- Files changed: `server/src/admin-config/field-config/field-config.service.ts` (+496: `updateDraft`, `discardDraft`, `publish`, `logged()`, `FieldConfigBusyError` 503 for 1213/1205; the view was refactored into `viewOf`, and the lists into `describeLists`), `field-config.service.spec.ts` (+1234), `server/src/admin-config/admin-config.context.ts` (+3 actions), `server/src/database/drizzle/schema/field-config-audit-events.ts` (type only: `keep[].version: number | null`).
- Red run (methods stubbed to reject): `50 failed | 26 passed (76)`, on `{ status, code }` deep-equal assertions. The 26 passing cases are the T-6 cases.
- Falsifiers (post-change, restored): no-op shortcut skipped → 1 red (`expected 8 to be 7`); only classified fields published → 3 red (504 vs 3); "nothing to publish" checked before stale → 3 red; conditional UPDATE dropped → 2 red (`[ 'fulfilled', 'fulfilled' ]`).
- Refusals: every refusal asserts `expectNothingWritten` (snapshot, `writeLog` empty, no transaction begun) or `expectRolledBack`. The spec lines are in the Implementer's table; the Reviewer spot-checked nine.
- Implementer verification: unit `2281 passed`, e2e `779 passed`, `admin-config` under Bogota `817 passed`, field-config under UTC `265 passed`.
- Evidence re-run (Leader-inline, non-author): **VERIFIED**. Lint clean, build 0, `2281 passed`, e2e `779 passed`, Bogota `817 passed`.
- Reviewer (lens checklist, effort high): **PASS**, `ISSUES: none`. Quote: "The race test's `[committed, rolledBack] = [1,1]` shows the loser got past the pre-check and lost to the conditional UPDATE." All seven Leader points were ruled conformant, and S-14 was re-confirmed (`isCore ?? false`).
- runtime events: none.

spawns: implementer 44 calls, 253620 tokens, ended complete; reviewer 19 calls, 91766 tokens, ended complete.

**Decisions / spec edits**
- The T-1 schema type was widened (`keep[].version: number | null`). It is a demonstrated defect, accepted by the Reviewer: DD-7 requires the audit to hold what the ADMIN saw. No migration.
- **Execute-time spec edit (Leader, at the Reviewer's request):** the `design.md` § 6 DELETE row now lists 409 `FIELD_CONFIG_CATALOG_MISSING` and 503, because discard answers with the view. Carried to the T-8 Reviewer as a named check, and T-8's OpenAPI must list both.

**ADVISORY (Reviewer — recorded, not tasks)**
- RISK: 1213/1205 → 503 with no retry rests on fakes only. A concurrent first `ensureDraft` is the likeliest real deadlock. **Forward pointer to T-11.**
- READABILITY: `server/src/admin-config/AGENTS.md` still says six logged writes, and its error list lacks `FieldConfigBusyError`. **Forward pointer to T-8** (move the class into `admin-config.errors.ts`) and **T-10** (guide).
- READABILITY: `(current?.number ?? 0) + 1` is computed twice in `publish`.
- RELIABILITY: publish skips `ensureDraft`; a non-empty diff with no draft row cannot occur today. A comment is suggested.
- RESILIENCE: the edit's no-op check reads the items unlocked, so a 200 may show a slightly stale draft. **Forward pointer to T-10** (`front-contract.md`).

**Budget:** 8,538 non-JSON LOC added under `server/` since `0b62fd1`, after 7 of 10 build tasks. That is 1.22× the ≈ 7,000 LOC budget, driven by tests (the T-5 and T-7 specs alone are about 2,600 lines). Review rounds: 12 of ≈ 18. Over the ≈ 7,000 LOC budget; the back lead lifted the tripwire for the rest of the run.

**Final verification:** VERIFIED.

**Decisions made (recorded as they happen)**
- Gate answer "Si" (2026-10-26): continue with T-7. No new budget was given, so the Budget Tripwire stands: stop when actual work passes about 7,000 LOC (about 6,830 non-JSON LOC at the T-6 close).
- Forward pointers carried into the brief: S-14 (an omitted flag is stored false; *Same values* compares after normalising); truncate `now` to the second once, for both the lists and the insert (T-5 A); the conditional UPDATE stays the deciding guard, with a service-level conditional-alone falsifier (T-5 A); publishing a cycle with no draft row answers `NOTHING_TO_PUBLISH`, not stale (T-5 A, DD-10); a 1213 or 1205 is never an unmapped 500 [advisory-grade] (T-5 Opus); the edit and discard paths never see `stale` (T-5 Opus); discard deletes the items before copying the version (T-5 fable); two admins editing the same field are tested explicitly (T-5 Opus); the unit of work is injected (T-6).
- Skills: nestjs-expert, error-handling-patterns (as listed). Effort `high`, above the T2 default: it orchestrates every write rule, the answer order and the concurrency guard.
- **Back lead, 2026-10-26 ("Adelante no pares, termina todo"):** the budget tripwire and the per-task continue gates are lifted for the rest of the run. They had already been told the overrun would come at T-7 (about 6,830 of about 7,000 LOC). The overrun is still recorded at each task close. A HALT, a Pivot, a FATAL_FAIL or a waiver still stops the run. T-11 is a human step (applying `0005` to `qadb` and the concurrent publish on MySQL), so the run stops before it.

### T-8: Controller, DTOs, OpenAPI, module wiring, idempotency — PASS

| | |
|---|---|
| Date | 2026-10-26 |
| Final status | PASS (attempt 1, 2 checkpoints) |
| Attempts | 1 |
| Skills | nestjs-expert, api-design-principles (as listed) |
| Effort | `medium`, then `low` for the two verification-only respawns |
| Requirements covered | FR-1 (class guard), FR-8 *Replay* (wiring), FR-13 *Unknown cycle*, NFR-1, NFR-2 |

**Attempt 1**
- Files changed:
  - New: `server/src/admin-config/field-config/field-config.controller.ts` (5 routes, class-level `ADMIN_ACCESS`, full OpenAPI, `@Idempotent()` on publish), `dto/` (+ spec, 18 cases), `models/field-config.model.ts`.
  - Modified: `field-config.module.ts` (controller, `IDEMPOTENCY_STORE`, `IDEMPOTENCY_REPLAY_READER`), `admin-config.module.ts` (imports `FieldConfigModule`), `server/test/support/admin-config-app.ts` (store, UoW and catalog fake with `missingYears` / `down`; `send('patch')`).
  - Gap edits for DD-9: `field-config.store.ts` `findPublication`, the matching fake method, and `field-config.service.ts` `replayPublish`.
- Red run: `test/openapi.e2e-spec.ts` `3 failed | 10 passed` (`DELETE …/draft: expected [] to include 'access-token'`; summary undefined; 200 response undefined).
- Falsifiers: `isCore` made required → 9 red at the pipe, restored. `@Idempotent()` removed → **owed to T-9**.
- Router listing (temporary spec, deleted): `GET /api/v1/cycles/:id/field-config`, `PATCH …/draft`, `DELETE …/draft`, `GET …/publish-preview`, `POST …/publish`, matching `toHaveLength(5)`.
- Implementer verification: e2e `779 passed` (13 files), unit `2299 passed`, lint and build clean.
- Evidence re-run (Leader-inline, non-author): **VERIFIED**. Lint clean, build 0, unit `2299 passed`, e2e `779 passed`.
- Reviewer (lens checklist, effort high): **PASS**. Quote: "All five routes are mounted under a class-level `ADMIN_ACCESS` guard… Publish has `@Idempotent()`, `withIdempotencyErrors` and `IDEMPOTENCY_REPLAYED_HEADERS`." Named check (the § 6 DELETE row): both codes are documented. Rulings:
  - The DD-9 gap edits are a demonstrated need and conformant.
  - 201 on publish conforms (FR-8 says "the first answer").
  - The plain `Error` in `replayPublish` is unreachable.
  - DTOs and `admin-config-app.ts` conform.
- runtime events: none.

spawns: implementer 50 calls, 164755 tokens, ended checkpoint; implementer (respawn 1) 6 calls, 62568 tokens, ended checkpoint; implementer (respawn 2) 8 calls, 65850 tokens, ended complete; reviewer not reported by host, ended complete.

**Decisions / spec edits**
- **Execute-time spec edit (Leader, at the Reviewer's request):** `tasks.md` T-9 *Tests* replay line "the first 200" becomes "the first answer (201, the publish route's status)". FR-8 says "the first answer", and the interceptor replays the route status. Carried to the T-9 brief and Reviewer.

**ADVISORY (Reviewer — recorded, not tasks)**
- RELIABILITY: no test reaches `replayPublish` / Drizzle `findPublication`, because the T-9 replay case uses the `completed` path, which replays the stored body. A crash-window case (`executed` with no stored answer) would exercise the reader. Recorded; T-11 checks the join on MySQL.
- RELIABILITY: in the replay, a timeline deleted since the publication shows `name: ''` and `opensOn: null`. **Forward pointer to T-10** (`front-contract.md`).
- READABILITY: the `replayPublish` JSDoc says "One read", but it runs two statements.
- RISK/DOCS: `server/src/common/AGENTS.md:28` says admin-config has two replay readers storing cycle or timeline ids; there is now a third, whose target is a **version id**. T-10 names only `server/src/admin-config/AGENTS.md`, so this shared-guide line is a **pending item for `staging`** (shared-file write discipline).
- RISK (known gap, for T-11): replay names and `opensOn` reflect timelines as they are at replay time, not at publication time (DD-9 trade-off against FR-8 "the first answer").

**Final verification:** VERIFIED.

**Decisions made (recorded as they happen)**
- Forward pointers carried: the § 6 DELETE row as amended at T-7 (OpenAPI lists 409 `FIELD_CONFIG_CATALOG_MISSING` and 503); 503 `SERVICE_UNAVAILABLE` (busy) on PATCH, DELETE and publish; `latestVersion.publishedAt` serialised as an ISO string (T-6); the e2e fake clock is fixed, so the per-year catalog cache never expires within a run (T-2, also T-9); the preview `keep[].version` is nullable in the response model (T-6). Moving `FieldConfigBusyError` into `admin-config.errors.ts` is not in T-8's scope (narrow-never-widen) and stays an advisory for T-10's guide.
- Skills: nestjs-expert, api-design-principles (as listed). Effort `medium`.
- checkpoints: 1 (resource-guard blocked `pnpm test:e2e` five times; about 48 calls). The remaining work was the full e2e run and the router listing. The Leader started a fresh Implementer with the checkpoint report verbatim. The attempt counter did not change.
- checkpoints: 2 (the respawn was blocked by resource-guard on 3 e2e attempts: 3.3–4.1 GB free against 4.5 GB required, swap 2.2 GB). No code change and no failure. One checkpoint is left before the cap HALTs the task; the Leader asked the back lead about RAM / `RG_FORCE` before respawning.
