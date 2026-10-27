# Field configuration per cycle — Design

## 1. Document Control

| | |
|---|---|
| Spec path | `docs/specs/admin-config/field-configuration` |
| Requirements | `requirements.md` (FR-1…FR-14, NFR-1…NFR-8, S-1…S-13), approved 2026-10-26 |
| Depth | Full |
| Approval Mode | gated |
| Status | Approved at the design gate (back lead: "Continue", 2026-10-26; Review Design not chosen) |
| Extends | TRD § 4 (`admin-config` module), § 5.1, § 6; `admin-config/timeline-edit` (*edit*: DD-6 conditional write, DD-10 audit, DD-9 replay); *timelines* DD-2 (computed on read) |
| Exploration | Two read-only scouts at `0b62fd1`; citations below as run |
| Last updated | 2026-10-26 |

## 2. Executive Summary

The design adds a new module, `admin-config/field-config`, with five tables (migration `0005`), five admin routes and one exported query.

- **Field list:** it comes from a new Reporting catalog reader, called with `phase_year = cycles.year` and cached per year. QA stores only its own option sets.
- **Draft:** one per cycle, edited with last-write-wins, plus a `revision` counter.
- **Publishing:** writes an immutable version that holds an option set for **every applicable field**, so a version answers alone, without the catalog.
- **Version per timeline:** a pure function compares the Rome date of each version's publish instant with step 1's `opens_on`. Nothing is stored and no job runs.
- **Concurrency on publish:** reuses *edit* DD-6, a conditional `UPDATE … WHERE revision = ?` under the lock order cycle `FOR SHARE` → draft `FOR UPDATE`.
- **Audit:** every publication writes one append-only row.

**Budget (tripwire for `/akili-execute`):** 11 tasks (10 build + 1 HITL) · ≈ 7,000 LOC including tests (≈ 2,000 source, ≈ 4,600 tests, ≈ 400 docs) · ≈ 18 review rounds. timeline-edit ran ×1.7 over its LOC plan, driven by tests (*edit* `execution.md` Summary), so tests are counted explicitly here.

## 3. Architecture Overview

No new container. The new module sits beside `cycles` and `timelines` in `admin-config` (TRD § 4). It is imported by `AdminConfigModule`, which today is `@Module({ imports: [CyclesModule, TimelinesModule] })` (`server/src/admin-config/admin-config.module.ts:9`).

| Layer | Change |
|---|---|
| HTTP | `FieldConfigController`, `@Controller('cycles')` with `:id/field-config…` paths, class-level `ADMIN_ACCESS` (FR-1) |
| Service | `FieldConfigService`: view, draft edit, discard, preview, publish, effective query |
| Pure functions | `field-config-catalog.ts` (shape the catalog per type and section), `field-config-rules.ts` (validate a draft edit), `field-config-versions.ts` (version per timeline, receive and keep), `field-config-diff.ts` (draft vs. version) |
| Ports | `FIELD_CONFIG_STORE`, `FIELD_CONFIG_UNIT_OF_WORK`, `FIELD_CATALOG_SOURCE` (new Reporting reader), `ADMIN_CONFIG_CLOCK` (existing) |
| Persistence | Migration `0005_field_configuration`: five tables |
| Export | `FIELD_CONFIG_EFFECTIVE` port for later review stories (FR-10). It is the module's only export |

## 4. Extended Directory Structure

```
server/src/admin-config/
├── admin-config.module.ts                  (imports FieldConfigModule)
├── admin-config.context.ts                 (+3 actions)
├── admin-config.errors.ts                  (+ field-config errors)
├── AGENTS.md                               (named deliverable)
└── field-config/                           (new)
    ├── field-config.module.ts
    ├── field-config.controller.ts
    ├── field-config.service.ts
    ├── field-config.store.ts               (port + Drizzle adapter)
    ├── field-config.unit-of-work.ts
    ├── field-config-catalog.ts             (+ spec)
    ├── field-config-rules.ts               (+ spec)
    ├── field-config-versions.ts            (+ spec)
    ├── field-config-diff.ts                (+ spec)
    ├── reporting-qa-catalog.client.ts      (+ spec; FIELD_CATALOG_SOURCE adapter)
    ├── fixtures/reporting-qa-catalog-2026.json   (TEST catalog, 2026.30, key-free)
    ├── dto/ (cycle-field-config-params, update-draft, publish)
    └── models/ (field-config.model, preview.model, publish.model)
server/src/users/catalogs/catalog-http.ts   (optional "not found" outcome, DD-4)
server/src/common/error-codes.ts            (+3 top-level codes, +1 field code)
server/src/database/drizzle/schema/field-config-*.ts (5 files), schema/index.ts
server/drizzle/0005_field_configuration.sql (+ meta)
server/test/support/in-memory-field-config.ts, admin-config-app.ts (bindings)
server/test/admin-config-field-config.e2e-spec.ts
docs/specs/admin-config/field-configuration/front-contract.md
```

## 5. Data Model

Migration `0005_field_configuration` is **additive**: five `CREATE TABLE` and their indexes, with no change to existing tables (the same additive pin as `0003`/`0004`, `schema.spec.ts:350,482,1019,1150`).

| Table | Columns | Keys and rules | Requirements |
|---|---|---|---|
| `field_config_drafts` | `cycle_id` int unsigned PK → `cycles.id`; `revision` int unsigned NOT NULL DEFAULT 0; `updated_at` datetime NULL; `updated_by` int unsigned NULL → `users.id` | CHECK both-or-none on `updated_*` (pattern of `chk_timelines_updated`). Created on the first draft write | FR-5, FR-8 |
| `field_config_draft_items` | `cycle_id` → `cycles.id`; `result_type_key` varchar(64); `field_key` varchar(128); `visibility` enum(`hidden`,`view_only`,`assessed`); `is_core` bool NOT NULL; `is_ai_input` bool NOT NULL | PK (`cycle_id`, `result_type_key`, `field_key`). CHECK `chk_field_config_draft_items_flags`: `(is_core = 0 AND is_ai_input = 0) OR visibility = 'assessed'` | FR-4, FR-5 |
| `field_config_versions` | `id` int unsigned AI PK; `cycle_id` → `cycles.id`; `number` smallint unsigned; `catalog_version` varchar(32); `published_at` datetime NOT NULL; `published_by` → `users.id`; `request_id` varchar(64) NULL | UNIQUE (`cycle_id`, `number`) as a backstop for DD-6. INDEX (`cycle_id`, `published_at`). Append-only | FR-8, FR-9, FR-12 |
| `field_config_version_items` | `version_id` → `field_config_versions.id`; `result_type_key`; `field_key`; `visibility`; `is_core`; `is_ai_input` | PK (`version_id`, `result_type_key`, `field_key`). Same CHECK. One row per **applicable** field at publish (DD-2). Append-only | FR-8, FR-10, FR-12 |
| `field_config_audit_events` | `id` bigint unsigned AI PK; `cycle_id` → `cycles.id` (amended 2026-10-26 at T-1: the FK was added by the migration); `version_id` → `field_config_versions.id`; `actor_id` → `users.id`; `action` enum(`publish`); `changes` json NOT NULL; `timelines` json NOT NULL; `request_id` varchar(64) NULL; `created_at` datetime DEFAULT now | UNIQUE (`version_id`), so there is one record per publication. INDEX (`cycle_id`, `created_at`). No update columns (pattern of `timeline_audit_events`) | FR-11, NFR-8 |

- **JSON shapes:**
  - `changes` is `{ "<resultTypeKey>.<fieldKey>": { before: OptionSet | null, after: OptionSet } }`.
  - `timelines` is `{ receive: [id], keep: [{ id, version }] }`.
- **No delete paths.** Every FK uses `ON DELETE no action`, as in `0004`. Nothing deletes cycles, versions or users.
- **Size check:** a version of the 2026 catalog has 504 rows: the sum of applicable fields per type, `"*"` expanded (the `docs/reporting-catalog.md` § 2.3 per-type counts, 234, plus the 30 `"*"` fields under each of the 9 types). *Amended 2026-10-26 at T-2: the earlier 234 left out the `"*"` fields; measured on the TEST catalog fixture.*

## 6. API Design

All routes are under `/api/v1`, admin-only, documented in OpenAPI and wrapped in the `{ success, data, meta }` envelope. The cycle id uses the `CycleIdParams` DTO (`server/src/admin-config/cycles/dto/cycle-params.ts:9-20`).

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| GET | `/cycles/:id/field-config` | — | View (below) | 401, 403, 400 id, 404 `CYCLES_NOT_FOUND`, 409 `FIELD_CONFIG_CATALOG_MISSING`, 503 `SERVICE_UNAVAILABLE` |
| PATCH | `/cycles/:id/field-config/draft` | `{ items: [{ resultTypeKey, fieldKey, visibility, isCore?, isAiInput? }] }`, 1–2,000 items | View | 400 `VALIDATION_FAILED` (all issues), 404, 409 `CYCLES_CLOSED`, 409 `FIELD_CONFIG_CATALOG_MISSING`, 503 |
| DELETE | `/cycles/:id/field-config/draft` | — | View | 404, 409 `CYCLES_CLOSED`, 409 `FIELD_CONFIG_CATALOG_MISSING`, 503 *(amended 2026-10-26 at T-7: the answer is the view, so answer-order step 3 applies)* |
| GET | `/cycles/:id/field-config/publish-preview` | — | `{ revision, basedOn: number \| null, changes: [{ resultTypeKey, fieldKey, before, after }], timelines: { receive: [{ id, name, opensOn }], keep: [{ id, name, opensOn, version }] } }` | 404, 409 `FIELD_CONFIG_CATALOG_MISSING`, 503 |
| POST | `/cycles/:id/field-config/publish` | `{ revision }`, `@Idempotent()` | `{ version: { number, publishedAt, catalogVersion }, timelines: { receive, keep } }` | 400, 404, 409 `CYCLES_CLOSED`, 409 `FIELD_CONFIG_REVISION_STALE`, 409 `FIELD_CONFIG_NOTHING_TO_PUBLISH`, 409 `FIELD_CONFIG_CATALOG_MISSING`, 503, idempotency codes |

**View shape:**
- Top level: `{ cycleId, year, catalogVersion, revision, latestVersion: { number, publishedAt } | null, resultTypes: [...], notInCatalog: [{ resultTypeKey, fieldKey, draft }] }`.
- Each result type: `{ key, label, level, sections: [{ key, label, fields: [...] }] }`.
- Each field: `{ key, label, description?, requirement: required | conditional | optional, isNew, unclassified, draft: OptionSet, published: OptionSet | null }`.
- Field order is FR-2's. `OptionSet` is `{ visibility, isCore, isAiInput }`.

**Answer order on writes** (each step refuses before the next one runs, and nothing is written before the transaction):
1. 404 for an unknown cycle.
2. 409 `CYCLES_CLOSED`.
3. The catalog read (409 `FIELD_CONFIG_CATALOG_MISSING` or 503).
4. 400 with every rule issue.
5. For publish only: 409 `FIELD_CONFIG_REVISION_STALE`, then 409 `FIELD_CONFIG_NOTHING_TO_PUBLISH`.
6. The transaction. A lost race inside it answers 409 stale.

**Field issues** use `items[i].<field>` paths and catalog codes only:
- `INVALID` for an unknown type or a field that does not apply to the type;
- `INVALID` also for a repeated (type, field) in one request, because no `DUPLICATE` field code exists (`error-codes.ts:320-342`: `REQUIRED`, `INVALID_TYPE`, `INVALID_EMAIL`, `TOO_LONG`, `UNKNOWN_FIELD`, `INVALID`, `OUT_OF_RANGE`, `CLOSES_BEFORE_OPENS`, `OVERLAPS_PREVIOUS_STEP`, `BEFORE_TODAY`, `AUDIENCE_ORDER`, `ROUND_SEQUENCE`, `FIRST_STEP_LOAD`, `LOCKED`) (DD-11);
- a new field code `NOT_ASSESSED` for `isCore` or `isAiInput` true when visibility is not `assessed`.

## 7. Backend Module Design

### 7.1 Pure functions

| Function | Input → output | Rules |
|---|---|---|
| `shapeCatalog(raw)` | Reporting JSON → `FieldCatalog { catalogVersion, resultTypes, sections, fields }`, fields top-level only | Expands `"*"` to the type keys. Section ties are broken by array position (FR-2). Requirement is `required`, else `conditional` when `required_when` exists, else `optional`. `isNew` comes from a per-field flag if present, else `false` (S-6). Malformed rows → a typed upstream error, never a silent skip |
| `applicableFields(catalog, type)` | → fields in section order, then field order | The single definition of "applicable" (glossary) |
| `validateDraftEdit(catalog, items)` | → `FieldIssue[]` | Every issue, never stopping at the first (FR-5). The flags-off rule (FR-4) is applied when the flags are omitted, and is an issue when they are sent true |
| `diffConfig(draft, latest, catalog)` | → changes per (type, field) | Compares the effective draft (unclassified = hidden) with the latest version, over fields still in the catalog. An empty diff means "nothing to publish" (S-9) |
| `versionFor(timeline, versions, now)` | `{ opensOn, … }`, versions with `publishedAt` (an instant; its Rome date is derived inside), `now` from the clock → `{ number, provisional } \| none` *(signature amended 2026-10-26 at T-4: the not-started rule needs today)* | A version counts if `romeDate(publishedAt) < opensOn` (S-3, S-5). Not started (today < `opensOn`) → the latest version, provisional (S-4). Started with none → `none`. A timeline with no steps has not started |
| `receiveAndKeep(timelines, versions, changedTypes, now)` | → `{ receive, keep }` | Covers = `allResultTypes` or a scope row of a changed type. Receive = covers and not started. Keep = covers, started, not finished, with its resolved version. Finished timelines and timelines not covering a changed type are in neither list (DD-8) |

All dates are Rome `YYYY-MM-DD` strings from `rome-date.ts` (`server/src/admin-config/rome-date.ts:16-21`), compared as strings. `now` comes from `ADMIN_CONFIG_CLOCK` (`admin-config.clock.ts:5`).

### 7.2 Service flows

**View** (FR-2, FR-3):
- read the cycle;
- read the catalog for `cycles.year` (DD-4);
- read the draft and its items, and the latest version and its items;
- shape the answer. Draft items whose field is not applicable go to `notInCatalog` (S-7).

**Draft edit** (FR-4, FR-5):
1. Run the answer order up to rules (§ 6).
2. If every item equals the stored draft, return the view with no write and no revision change (FR-5 *Same values*).
3. In one transaction: cycle `FOR SHARE`, then upsert the draft row and lock it `FOR UPDATE`.
4. Multi-row upsert of the items: last write wins (S-10).
5. `revision = revision + 1`, `updated_at/by`.
6. Return the view.

**Discard** (FR-6):
1. In one transaction: cycle `FOR SHARE`, then lock the draft.
2. Delete the draft items.
3. Copy the latest version's items as draft items (an empty draft if there is no version).
4. Revision + 1, with `updated_at/by` (the discard is a draft write, § 7.3; amended 2026-10-26 at T-5).

**Preview** (FR-7):
- read the catalog, the draft, the latest version and the cycle's timelines (DD-7);
- `diffConfig`, then `receiveAndKeep`;
- nothing is written.

**Publish** (FR-8, FR-11):
1. Run the answer order (§ 6).
2. **Before** the transaction, check the revision against the unlocked draft and fail early. Compute the diff, then the receive and keep lists.
3. In one transaction:
   - cycle `FOR SHARE`, then lock the draft `FOR UPDATE`;
   - conditional `UPDATE field_config_drafts SET revision = revision + 1 WHERE cycle_id = ? AND revision = ?`. Zero rows means 409 stale (DD-6);
   - `number = max + 1` for the cycle, read under the lock;
   - insert the version row;
   - multi-row insert of the version items, one per applicable field, unclassified ones as hidden;
   - insert the audit row;
   - `markExecuted` with the version id.
4. Answer the version and the lists.

**Effective** (FR-10):
1. Read the timeline's step 1 and scope.
2. Refuse when the type is not covered.
3. Read the cycle's versions (number and `published_at`) and run `versionFor`.
4. Read that version's items for the type, ordered by catalog order as stored.

Subfields are not stored, so they follow their field (S-1).

### 7.3 Store and unit of work

- **Ports:**
  - `FieldConfigStore`: reads `findCycle`, `findDraft`, `listDraftItems`, `latestVersion`, `listVersions(cycleId)`, `listVersionItems(versionId, type?)`, `listTimelineStarts(cycleId)`; writes `lockCycleShared`, `ensureDraft`, `lockDraft`, `upsertDraftItems`, `bumpRevision(cycleId, change?, expected?)` (`updated` / `stale`; `change` is `{ updatedAt, updatedBy }`: the draft edit and the discard pass it, and the publish does not, so a publish leaves `updated_*` as the last draft write set them, § 7.2 *Publish* step 3) *(amended 2026-10-26 at T-5)*, `deleteDraftItems`, `copyVersionToDraft`, `insertVersion`, `insertVersionItems`, `insertAuditEvent`.
  - `listTimelineStarts` composes a fixed set of three queries: timelines of the cycle, their steps (min position and max `closes_on`), and their scope rows. It mirrors `TimelinesService.respond()` (`timelines.service.ts:272-285`).
- **Unit of work:** follows `timelines.unit-of-work.ts:90-105`, with READ COMMITTED and stores built on `tx`, plus `idempotency` (`Pick<IdempotencyStore,'markExecuted'>`).
- **Cycle lock:** `lockCycleShared` is `FOR SHARE`, the same as `timelines.store.ts:429-435`.
- **Fake:** `test/support/in-memory-field-config.ts` emulates the cycle S lock, a draft X lock, a version check under that lock, the unique `(cycle_id, number)`, the audit row in the transaction, and a round trip per statement (`setImmediate`, `in-memory-idempotency.ts:27`).

### 7.4 Catalog reader

- **Port:** `FIELD_CATALOG_SOURCE.forYear(year): Promise<FieldCatalog>`.
- **Adapter:** `ReportingQaCatalogClient`. It calls `GET ${REPORTING_API_URL}/qa/catalog?phase_year=${year}` with `x-api-key`, the same base URL and key as `reporting-result-types.client.ts:25-50`, through `catalog-http.ts`.
- **404:** maps to `FieldCatalogMissingError` (409 `FIELD_CONFIG_CATALOG_MISSING`). Every other failure stays 503 (DD-4).
- **Cache:** one in-process map, year → entry, with the same freshness and stale-on-failure policy as `catalog.service.ts:16-18,26-63`. A cached 404 is not stored.
- **Untouched:** `ResultTypeSource` stays as it is (S-11).

### 7.5 Errors, catalog, log

- **Top-level codes:**
  - `FIELD_CONFIG_CATALOG_MISSING` 409 "No Reporting catalog exists for this cycle's year."
  - `FIELD_CONFIG_REVISION_STALE` 409 "The draft changed after you reviewed it. Reload and review the changes again."
  - `FIELD_CONFIG_NOTHING_TO_PUBLISH` 409 "There are no changes to publish."
- **Field code:** `NOT_ASSESSED`, bringing the pin at `error-codes.spec.ts:261-276` from 14 to 15 codes.
- **Effective-query errors:** `FieldConfigTypeNotInTimelineError` and `FieldConfigNoVersionError`. They are thrown to in-process callers and have no HTTP route yet.
- **Log:** `AdminConfigAction` gains `field_config_update`, `field_config_discard` and `field_config_publish` (`admin-config.context.ts:4-10`). One decision line per request, through a private `logged()` like `timelines.service.ts:810`.

### 7.6 Idempotency

`@Idempotent()` on publish only. `markExecuted` stores the **version id** in the reservation's target column (`idempotency.store.ts:104,223`). The replay reader re-reads that version and recomputes its receive and keep lists **as stored in its audit row** (DD-9). The other writes are not idempotent: the draft edit and discard are naturally repeatable, since repeating them gives the same result.

## 8. Frontend / UX Component Architecture

No `client/` change (S-12). `front-contract.md` (FR-14) covers:
- the routes and shapes;
- `third` → `assessed` + core (S-2);
- `conditional`;
- the `revision` round trip (preview → publish);
- the two 409s and their recovery (reload, then preview again);
- the dialog's receive and keep lists, replacing "Applies to results loaded from now on" (`client/src/app/pages/workspace/fields/fields-publish-confirm.ts:11`);
- the 503 and the catalog-missing state.

## 9. Shared Contracts or Package Extensions

- **Environment:** no new variable. The reader uses `REPORTING_API_URL` and the key `CLARISA_API_KEY` (`server/src/config/catalogs.config.ts:8-13`); proposal R-3 tracks which key PROD uses.
- **TRD:** § 5.1 (five tables) and § 6 (five routes, three codes) are recorded as a pending item for `staging`.

## 10. Design Decisions

| ID | Decision | Alternatives rejected | Consequence | Requirements |
|---|---|---|---|---|
| DD-1 | New module `admin-config/field-config` with its own store, reading the timelines tables through its own three-query read | Export `TimelinesStore` from `TimelinesModule` (it has no `exports`; this would couple field-config to timelines internals) | Small, duplicated read SQL for timeline starts; the timelines module is untouched | FR-7, FR-9 |
| DD-2 | A version stores an option set for **every applicable field** at publish, unclassified as hidden | Store classified fields only and fill hidden from the catalog at read time | The effective query needs no catalog call, and a later catalog change cannot alter a published version (FR-12). About 504 rows per version (amended 2026-10-26 at T-2) | FR-8, FR-10, FR-12 |
| DD-3 | Full snapshot per version (proposal option A) | Deltas, or one JSON document | One indexed read for the effective query; the CHECK enforces FR-4 on every row | FR-4, FR-10 |
| DD-4 | A new catalog port and client per year, with a keyed cache. `catalog-http.ts` gains an optional "not found" outcome; existing callers keep "every non-2xx → 503" | Change `ReportingResultTypesClient` to take a year (its consumers rely on the current-year rule, S-11); widen `CachedCatalog` (one slot, `catalog.service.ts:27`) | The 404 for a missing year becomes a typed 409 instead of 503 (FR-2). Every `catalog-http` caller is a consumer (P-7) | FR-2, NFR-6 |
| DD-5 | Version per timeline compares the **Rome date** of `published_at` with step 1's `opens_on` (`romeDate(publishedAt) < opensOn`) | Store the version on the timeline at its start (needs a job, or a write on read); compare UTC instants | No job and no write, and the answer for a started timeline never changes (published versions are immutable; *edit* FR-3 locks a started step 1). The opening day falls to the old version (S-5) | FR-9, NFR-4 |
| DD-6 | Publish concurrency: lock order cycle `FOR SHARE` → draft `FOR UPDATE`, conditional `UPDATE … WHERE revision = ?` decides by affected rows; UNIQUE (`cycle_id`, `number`) as a backstop | A pre-read check only; serializing on cycle `FOR UPDATE` (would block timeline edits, assign and remove) | Same guard as *edit* DD-6, not a retry loop (KZ-admin-config--cycle-timelines-1); HITL on MySQL proves it | FR-8, NFR-3 |
| DD-7 | The preview and the publish compute receive and keep with the same pure function, from data read before the transaction | Recompute under the lock | The lists in the audit row are what the ADMIN saw. A timeline starting between preview and publish is caught by the clock read at publish, not the preview's | FR-7, FR-11 |
| DD-8 | Finished timelines and timelines not covering a changed type are in neither list | List every timeline | The dialog shows only timelines the change could matter to | FR-7 |
| DD-8a | "Finished" for receive / keep is dates only: today in Rome after the last step's `closes_on`. The load hold is ignored, by the § 7.3 `listTimelineStarts` input (dates and scope, no load) | Follow `viewTimeline`, where a held timeline never reads finished (needs a load signal in `TimelineStart`) | A started timeline on load hold past its last close is in neither list while the timelines screen shows `waiting_for_load`. Only the lists change, never a resolved version. **Revisit when timeline loads land (P2-3905 / P2-3906).** *Back lead, 2026-10-26, T-4 gate (option A)* | FR-7, FR-11 |
| DD-9 | Idempotent publish; the replay re-reads the version and its audit row | Store the full answer | A replay cannot report a different receive/keep than the publication did | FR-8 *Replay* |
| DD-10 | The draft row is created on the first write (upsert), not with the cycle | Create it in the cycle-create flow | `cycles` is untouched. A cycle with no draft reads as an empty draft | FR-3, FR-5 |
| DD-11 | One new field code, `NOT_ASSESSED`; unknown or non-applicable keys reuse `INVALID` | One code per case | The pin moves 14 → 15; the shared `FieldIssue` readers are unchanged (P-8) | FR-4, FR-5 |
| DD-12 | The view returns `notInCatalog` separately, and publish drops those fields | Fail the view when a draft field left the catalog | The ADMIN sees what will drop before publishing (S-7) | FR-3, FR-8 |

**Reversion challenge (Step 2.3):** no decision removes, disables or inverts delivered behavior. `catalog-http.ts` only gains an opt-in outcome (DD-4), and every existing caller keeps its mapping. `/catalogs/result-types` is unchanged (S-11). Challenge not triggered.

## 11. Premise Ledger

Count: 13 rows — 13 verified, 0 `UNVERIFIED`.
Blast-radius triggers: `shared-state` (the cycle row lock is shared with the timelines and cycles flows), `consumer` (`catalog-http.ts`, `ERROR_CATALOG` / `FIELD_ERRORS`, the `AdminConfigAction` union, the e2e app bindings). `live-path`: none apply — every route is new and the routes are its only entry points.

| # | Claim | Class | Citation (as run) | Verified at | If false | Settled by |
|---|---|---|---|---|---|---|
| P-1 | The catalog client fixes the year to the current UTC year and parses only `result_types` | location | `server/src/users/catalogs/reporting-result-types.client.ts:27,30,34-49` | `0b62fd1` | DD-4 could reuse it (High) | — |
| P-2 | Any non-2xx, timeout or bad body from Reporting becomes `UpstreamUnavailableError` → 503 | location | `server/src/users/catalogs/catalog-http.ts:16-45`; `catalogs.errors.ts:9-12` | `0b62fd1` | No 404 outcome needed in DD-4 (Low) | — |
| P-3 | Reporting answers 404 for a year without a catalog | data-env | `curl` to TEST with `x-api-key`, `phase_year=2025` and `2030` → 404 "No QA catalog available for phase_year …" (`docs/reporting-catalog.md` § 1, 2026-10-26) | `0b62fd1` | FR-2 *Catalog missing* needs another signal (High) | — |
| P-4 | The catalog cache holds a single slot, not one per year | location | `server/src/users/catalogs/catalog.service.ts:27` (`private entry?: Entry<T>`), `:72-81` | `0b62fd1` | DD-4's keyed cache is unnecessary (Low) | — |
| P-5 | The repo's catalog fixture has 1 section and 1 field, so a full fixture is needed | data-env | `server/src/users/catalogs/fixtures/reporting-qa-catalog.json` (50 lines; `sections` and `fields` arrays of 1); used only at `reporting-result-types.client.spec.ts:10` (`grep -rn "reporting-qa-catalog" src test` → 1 hit) | `0b62fd1` | T-2's fixture task shrinks (Low) | — |
| P-6 | The catalog key and URL come from `REPORTING_API_URL` and `CLARISA_API_KEY`; the config is registered per module with `ConfigModule.forFeature(catalogsConfig)` and `ConfigModule` is global | other | `server/src/config/catalogs.config.ts:8-13`; `server/src/users/users.module.ts:63`; `server/src/app.module.ts:18-19` (`isGlobal: true`); clients inject `catalogsConfig.KEY` (`reporting-result-types.client.ts:21-22`) | `0b62fd1` | DD-4 binds the client in `UsersModule` and exports it instead (Low) | — |
| P-7 | `catalog-http.ts` (export `getJson`, `:16`) has exactly three importers, which must keep "every non-2xx → 503" | consumer | `grep -rln "catalog-http" server/src server/test` → 3 files: `src/users/catalogs/clarisa-science-programs.client.ts`, `src/users/catalogs/reporting-result-types.client.ts`, `src/users/catalogs/catalog-http.spec.ts` | `0b62fd1` | A caller relying on the old mapping changes behavior (High) | — |
| P-8 | `FIELD_ERRORS` has 14 codes pinned in `error-codes.spec.ts:261-276`; `openapi.e2e-spec.ts:224-245` checks documented codes against the catalog | consumer | `server/src/common/error-codes.ts:320-342`; `error-codes.spec.ts:261-276`; `test/openapi.e2e-spec.ts:224-245` | `0b62fd1` | DD-11's pin edit differs (Low) | — |
| P-9 | `AdminConfigAction` is a six-value union in `admin-config.context.ts:4-10`; `logged()` is per service | consumer | `server/src/admin-config/admin-config.context.ts:4-10`; `cycles.service.ts:217`; `timelines.service.ts:810` | `0b62fd1` | § 7.5 log wiring changes (Low) | — |
| P-10 | The e2e app overrides every admin-config store, unit of work and catalog source, and sets `ADMIN_CONFIG_CLOCK` to a fake clock at `2026-10-20T10:00Z` | consumer | `server/test/support/admin-config-app.ts:65-67,73,102-139` | `0b62fd1` | New providers left on Drizzle in e2e (High) | — |
| P-11 | Timeline edit, assign and remove take cycle `FOR SHARE`; timeline create and cycle activate take cycle `FOR UPDATE` | shared-state | `timelines.store.ts:429-435` (`for('share')`); `timelines.service.ts:533,631,717` (share); `:336` (update); `cycles.service.ts:185,190` (update); `cycles.store.ts:87,101` | `0b62fd1` | DD-6's lock order could deadlock with a sibling (High) | — |
| P-12 | A timeline's step 1 opening and scope can be read in a fixed set of queries (`listByCycle`, `listSteps`, `listResultTypes`) | location | `server/src/admin-config/timelines/timelines.store.ts:164,166,168,355,362,378`; composed at `timelines.service.ts:272-285` | `0b62fd1` | `listTimelineStarts` needs another shape (Low) | — |
| P-13 | Rome dates are `YYYY-MM-DD` strings from `todayInRome(now)`, compared as strings | location | `server/src/admin-config/rome-date.ts:16-21,42-44` | `0b62fd1` | DD-5 needs an instant conversion (Low) | — |
