# Field configuration per cycle — Proposal

## Document Control

| | |
|---|---|
| Spec path | `docs/specs/admin-config/field-configuration` |
| Slug | `field-configuration`, derived from the free-text argument ("Configuración de campos por ciclo") |
| Type | Change |
| Approval Mode | gated |
| Status | Accepted for specification (back lead ran `/akili-specify`, 2026-10-26). Q-1, Q-2, Q-6, Q-8, Q-12 answered; Q-3…Q-5, Q-7, Q-9…Q-11, Q-14 at proposed defaults (`requirements.md` S-1…S-13). Q-14 to be confirmed at the requirements gate |
| Branch | `feat/field-configuration` (from `origin/staging-center` @ `0b62fd1`; `origin/staging` has no `server/src/users/catalogs/` and only migration `0000`, scout `git show origin/staging:…`) |
| Source | Jira **P2-3907** (epic, reporter: BA; AC 1–16), parent P2-3902; the back lead's decisions in the `/akili-propose` argument (2026-10-26) |
| Builds on | `admin-config/cycle-timelines` (archived), `admin-config/timeline-edit` (version + audit pattern), `docs/reporting-catalog.md` (catalog observed on TEST, branch `docs/reporting-catalog`) |
| Depends on | `admin-config/timeline-edit` (merged in `staging-center`) |
| Unblocks | The review stories (AC 9–12 apply the configuration), the AI-suggestion story (`is_ai_input`) |
| Parallel-safe | no — adds migration `0005`, extends the shared catalog adapter (`server/src/users/catalogs/`) and the error catalog |
| Scope | Server only (`server/`). The front (prototype on `fields.mock.ts`) adapts to the API through `front-contract.md` (Q-12, back lead 2026-10-26) |
| Date | 2026-10-26 |

## Intent

Let the QA Admin decide, **per cycle and per result type**, how each Reporting field is assessed: hidden, view only, or assessed (and, if assessed, core and/or AI input). The admin works on a draft and publishes. Each timeline uses the configuration that was published before it started, so reviews in progress never change under the assessors. This replaces the coordinator's Excel and the manual step by the tech team (P2-3907 *Description*).

## Problem / Current Behavior

1. **No field configuration exists on the server.** `git grep -n "field_config\|fieldConfig\|is_core\|is_ai_input\|isCore\|isAiInput" origin/staging-center -- server/` → no hits.
2. **The catalog adapter reads only result types, and for the wrong year.** `ReportingResultTypesClient.list()` calls `GET ${REPORTING_API_URL}/qa/catalog?phase_year=<year>` with `x-api-key`, where year is `new Date().getUTCFullYear()`, not the cycle's year, and parses only `result_types[]` (`server/src/users/catalogs/reporting-result-types.client.ts:25-50`, `27`). The key is `CLARISA_API_KEY`, shared with CLARISA (`server/src/config/catalogs.config.ts:8-13`).
3. **The catalog already carries what this needs.** `sections[25]` and `fields[161]` with `section`, `order`, `result_types` (or `["*"]`), `required`, `required_when`, `visible_when` and recursive `subfields`; `catalog_version` `2026.30` (`docs/reporting-catalog.md` §§ 2–3, observed on TEST 2026-10-26).
4. **A cycle has one year, and it is the catalog's `phase_year`.** `cycles.year` smallint, unique, CHECK 2020–2100 (`server/src/database/drizzle/schema/cycles.ts:33,56,58`).
5. **"When a timeline starts" is already computable.** Step 1 is the lowest position. Today in Rome is a `YYYY-MM-DD` string (`server/src/admin-config/rome-date.ts:16-21`), and status is derived on read, never stored (`server/src/admin-config/timelines/timeline-view.ts:65-107`). A timeline's result-type scope is `all_result_types` plus `timeline_result_types` rows (`schema/timelines.ts:58`, `schema/timeline-result-types.ts:4-15`).
6. **Audit and optimistic-concurrency patterns exist.** `timeline_audit_events` holds `changes` JSON `{field:{before,after}}` (`schema/timeline-audit-events.ts:28-54`). `UPDATE … WHERE id=? AND version=?` with 0 rows gives 409 `TIMELINES_VERSION_STALE` (`timelines.store.ts:530-550`, `error-codes.ts:255-259`).
7. **The front runs on mock data, and the mock does not match the story:**
   - Visibility has **four** states: `'hidden'|'view'|'assessed'|'third'` (`client/src/app/pages/workspace/fields/fields.mock.ts:7-11`).
   - Result types are 7 names with no keys (`:70-78`), and there are 32 hand-written fields in 5 sections (`:62-68`, `:93-126`).
   - `required` is a boolean, so there is no "conditional" (`:26-36`).
   - The publish dialog says "Applies to results loaded from now on. Results already under assessment are not affected", and does not list timelines (`fields-publish-confirm.ts:11`).
   - Save points are `TODO(api)` (`fields-view.ts`).
8. **Admin-only is a class-level guard** on the admin-config controllers (`@RequirePermission(Permission.ADMIN_ACCESS)`, `timelines.controller.ts:81`, `cycles.controller.ts:58`). A closed cycle refuses writes with 409 `CYCLES_CLOSED` (`timelines.service.ts:751-758`).
9. **Latest migration is `0004_timeline_edit`**, so the next one is `0005` (`server/drizzle/meta/_journal.json`, idx 0–4).

## Proposed Outcome

- **The field list is the Reporting catalog for `cycles.year`.** It is grouped by result type and by the catalog's sections, in catalog order. QA stores only its own choices, never a copy of a Reporting field.
- **One configuration row per (cycle, `result_type_key`, `field_key`):**
  - `visibility`: `hidden`, `view_only` or `assessed`.
  - `is_core` and `is_ai_input`: may be `true` only when `assessed`. Moving to `hidden` or `view_only` turns both off, guaranteed by the service and by a CHECK.
- **Read-only requirement per field:** `required`, `optional`, or `conditional` (the field has `required_when`).
- **Unclassified fields:** a catalog field with no configuration is treated as **Hidden** until the admin classifies it.
- **"New" flag comes from Reporting (Q-6):** QA does not compute it. The GET passes through a Reporting-provided flag when the catalog carries one; the 2026.30 catalog has none (`docs/reporting-catalog.md` § 2.3), so today it reads `false`.
- **Draft, then publish:**
  - Each cycle has one draft. Admins edit it field by field, or several fields at once.
  - **Publishing** creates an immutable, numbered version of the whole cycle's configuration, all result types together.
  - **Discarding** resets the draft to the last published version.
- **Which version a timeline uses**, resolved by date with no job:
  - A timeline uses the **latest version published before it started**. "Started" means 00:00 Europe/Rome on step 1's `opens_on`.
  - So a version published before the first timeline starts applies to all of them. A later version reaches only timelines that have not started. A started timeline keeps its version until it finishes.
  - A started timeline with **no** published version is reported as an explicit error, never as defaults.
- **Publish preview (AC 15):** the changes per result type, and the timelines that will **receive** them and those that will **keep** their version.
- **Audit (Q-8):** every **publish** records who, when, the request id, for each changed (type, field) the value before and after, and **which timelines received the version and which kept theirs** ("added to / removed from a batch"). Draft edits are not recorded. It follows `timeline_audit_events`.
- **Concurrency:** two admins publishing at once — one wins, the other gets 409.
- **Front contract:** `front-contract.md` tells the front how to replace `fields.mock.ts`: routes, shapes, the `conditional` requirement, the preview's receive/keep timelines, and that its `third` state maps to `assessed` + core (Q-2). The front adapts to the services; this spec does not edit `client/`.

## Scope

1. **Catalog adapter:**
   - Read the full catalog (`sections`, `fields`, `catalog_version`) for a given `phase_year` = `cycles.year`.
   - Expand `"*"` to the type keys.
   - Keep top-level fields; subfields follow their parent (Q-1).
   - Handle errors:
     - catalog down → 503, as today (`catalog-http.ts:16-45`);
     - no catalog for that year (404) → a typed error.
   - Cache per year and `catalog_version`.
2. **Migration `0005`** (drizzle-kit, additive):

   | Table | Holds | Key rules |
   |---|---|---|
   | `field_config_drafts` | One row per cycle: `cycle_id` PK, `revision`, `updated_at/by` | `revision` +1 on every draft write. Publish checks it (409 if stale) |
   | `field_config_draft_items` | `(cycle_id, result_type_key, field_key)`, `visibility`, `is_core`, `is_ai_input` | CHECK: `is_core`/`is_ai_input` true ⇒ `visibility = 'assessed'` |
   | `field_config_versions` | `id`, `cycle_id`, `number` (1, 2, …), `catalog_version`, `published_at/by`, `request_id` | Unique `(cycle_id, number)`. Immutable |
   | `field_config_version_items` | `(version_id, result_type_key, field_key)` + the three options | Full snapshot of every classified (type, field). Same CHECK. Immutable |
   | `field_config_audit_events` | `cycle_id`, `version_id`, `actor_id`, `action` (`publish`), `changes` JSON `{ "<type>.<field>": { before, after } }`, `timelines` JSON `{ receive: [ids], keep: [ids] }`, `request_id`, `created_at` | Append-only, written in the publish transaction |
3. **API** (`/api/v1`, admin-only, OpenAPI documented):
   - `GET /cycles/:id/field-config`: catalog fields by type and section, with the requirement, the draft value, the current published value, the Reporting "new" flag (pass-through), the draft `revision` and the latest version number.
   - `PATCH /cycles/:id/field-config/draft`: one or several `{ resultTypeKey, fieldKey, visibility, isCore?, isAiInput? }`. Every rule problem is returned in one 400. Unknown type or field (not in the catalog) is a 400.
   - `GET /cycles/:id/field-config/publish-preview`: the draft against the latest version. It returns the changes per type, plus the timelines that **receive** and those that **keep**, only for timelines whose scope covers a changed type.
   - `POST /cycles/:id/field-config/publish` with `{ revision }`: `@Idempotent()`. A stale revision or a lost race gives 409. No changes gives the documented answer in Q-9.
   - `DELETE /cycles/:id/field-config/draft`: discard.
   - Closed cycle: every write is 409 `CYCLES_CLOSED`. Reads still work.
4. **Effective configuration query** (in-process service port, no route): `(timelineId, resultTypeKey)` returns the version and its rows. A started timeline with no version gets a typed error. Delivered for the review stories, not used yet.
5. **Docs:**
   - `front-contract.md`;
   - `server/src/admin-config/AGENTS.md`, as a named deliverable;
   - a TRD § 5.1 / § 6 pending item for `staging`.

## Non-Goals

- **Applying** the configuration in the review screens (AC 9–12). This spec delivers the query, not its use.
- Copying the configuration from a previous cycle (P2-3907 *Out of Scope*). Copying between types inside the draft is a front convenience that already exists (`fields-view.ts:260`) and stays.
- Creating or changing Reporting fields. How the AI suggestion is produced. A per-field comments switch.
- **Front changes** (`client/`): the front lead adapts the Fields page to the API using `front-contract.md` (Q-12).
- Auditing draft edits. Only publications are recorded (Q-8).
- A route that lists the audit history (the history story reads the table, as in timeline-edit Q-7).
- Fixing the shared `CLARISA_API_KEY` naming (R-3).

## Affected Users, Systems, And Specs

| Affected | How |
|---|---|
| QA Admin | Classifies fields per cycle and type, previews and publishes |
| Assessors, Leads (later stories) | Their review follows the timeline's version (AC 9–12) |
| `server/src/users/catalogs/` | The adapter reads the full catalog per `phase_year`; the result-types consumers stay unchanged |
| `server/src/admin-config/` | New `field-config` module (controller, service, store, unit of work, pure rules, diff) |
| `server/src/database/drizzle/schema/`, `server/drizzle/0005_*` | Five tables; `schema.spec.ts` pins the DDL |
| `server/src/common/error-codes.ts` | New `FIELD_CONFIG_*` codes (stale revision, no catalog for year, no version for a started timeline) |
| `client/src/app/pages/workspace/fields/` (front lead, outside this spec) | Adapts to the API via `front-contract.md`: mock replaced, `third` read as assessed + core, conditional shown, publish dialog lists timelines |
| `docs/trd/trd.md` § 5.1 / § 6 | Pending item for `staging` (write discipline) |

## Visual Reference

- **Source:** the existing prototype (Angular port of the mockup), on mock data.
- **Location:** `client/src/app/pages/workspace/fields/` (`fields-view.html`, `fields-row.html`, `fields-publish-confirm.ts`).
- **Gaps against this proposal:**
  - the `third` state;
  - no "conditional" marker;
  - the publish dialog lists types but not timelines.
- **Designer input:** the timeline list in the dialog needs a small design (Q-13). No new mockup is generated.

## Requirement Delta Preview

### ADDED Requirements

- Field list per cycle from the Reporting catalog of `cycles.year`, grouped by type and section; new fields flagged and Hidden.
- Per (type, field): visibility, plus core and AI input only when assessed (service + CHECK).
- Read-only requirement: required / optional / conditional.
- One draft per cycle, multi-field edits, discard, and publish into an immutable version.
- Version resolution per timeline, by publish instant against step 1's start in Rome. Started timelines keep their version, and a started timeline with no version is an explicit error.
- Publish preview: the timelines that receive the changes and those that keep their version.
- One audit event per publish, with before/after per (type, field).
- Optimistic concurrency on publish (409).
- Effective-configuration query for later review stories.

### MODIFIED Requirements

- The catalog adapter's year changes from the current UTC year to the cycle's `year`, for field configuration. The `/catalogs/result-types` behavior stays unless Q-11 says otherwise.
- The front's publish copy, "Applies to results loaded from now on", must become the timeline rule (AC 13–14); `front-contract.md` states it for the front lead.

### REMOVED Requirements

- The front's fourth state `third` (Q-2): "the field travels up to TPB" is implied by `is_core`. A core field travels through the escalation chain to TPB and PPU, so the server has no separate state.

## Approach Options

| | **A. Draft table + versions as full snapshots (recommended)** | B. Versions as deltas over the previous version | C. One JSON document per draft and per version |
|---|---|---|---|
| Effective query | One indexed read: `version_items WHERE version_id = ? AND result_type_key = ?` | Fold every delta up to the version: cost grows with history | One row, but filtering by type happens in code |
| Immutability and CHECK | Row CHECK enforces core/ai ⇒ assessed | Same | No row CHECK; the rule lives only in code |
| Audit diff | Diff two snapshots | The delta *is* the diff | Diff two JSON blobs |
| Size | ~234 rows per version (2026 catalog: sum of fields per type), small | Smallest | Smallest |
| Risk | More rows, but simple and immutable | A wrong fold silently changes a past version | Weak schema guarantees; harder `schema.spec` pins |

## Recommended Approach

**Option A.** A version is a complete, immutable answer to "how is field F of type T assessed in this cycle". The effective query is one indexed read, and the CHECK enforces the core/AI rule in the database too, as the decision requires. It reuses the patterns the team already reviewed: `timeline_audit_events` for audit, `version`-style optimistic concurrency, `@Idempotent()` on the write, and the cycle `FOR SHARE` lock order.

**How a timeline's version is resolved:**
- `start = 00:00 Europe/Rome of step 1's opens_on`.
- `version = max(number) WHERE published_at < start`.
- If today ≥ step 1's `opens_on` and no version exists, the result is a typed error.
- If the timeline has not started, the result is the latest version, marked provisional.
- Published versions are immutable, and timeline-edit locks a started step 1's `opens_on` (timeline-edit FR-3), so the answer for a started timeline never changes.

**Kaizen.** KZ-admin-config--cycle-timelines-1 says a concurrency guard proven only on fakes can fail on InnoDB. So the publish race gets a HITL check on MySQL, like timeline-edit T-9. KZ-admin-config--cycle-timelines-3 adds a token-handling and data-impact plan for that HITL.

## Risks, Dependencies, And Open Questions

### Open questions (BA unless noted)

| ID | Question | Proposed default | Blocks |
|---|---|---|---|
| Q-1 | AC 3 says "every field". Are subfields (217) configured separately, or do they follow their parent field? | **Decided (back lead, 2026-10-26):** top-level fields only (161); subfields inherit their parent's configuration. The field is also the unit of review: a comment covers the field and all its sub-options, never a single subfield (carried to the comments spec) | Data model |
| Q-2 | The front has a fourth state, `third`, that the story and your decisions do not have. What is it? | **Decided (back lead, 2026-10-26):** `third` meant "the field travels up to TPB (third-party broker)". That is implied by `is_core`: a core field travels through the escalation chain to TPB and on to PPU. Visibility stays hidden / view_only / assessed; the front maps `third` to assessed + core | Model, front contract |
| Q-3 | "Started" for the version: step 1's date (00:00 Rome), even if the timeline is on hold (`waiting_for_load`)? | Yes: step 1's `opens_on`, as you decided. A held timeline whose step-1 date has passed keeps its version | Resolution rule |
| Q-4 | If an admin moves an upcoming timeline's step 1 later (timeline-edit), it can pick up a newer version. OK? | Yes: it has not started (AC 14) | Resolution rule |
| Q-5 | Publishing on a timeline's opening day after 00:00 Rome: that timeline already started, so it keeps the previous version. OK? | Yes. The preview shows it under "keeps" | Resolution, preview |
| Q-6 | What counts as "new"? | **Decided (back lead, 2026-10-26):** not computed by QA in this stage. Reporting owns the flag; QA passes it through when the catalog sends it (request to Reporting: RC-5) | GET shape |
| Q-7 | The catalog changes inside the year (`catalog_version`): a configured field disappears | Keep its rows. The GET flags it `not_in_catalog`, and publishing drops it from the new version | Adapter, publish |
| Q-8 | AC 16 says "every change is recorded". Is a record per **publish** enough, or must draft edits be audited too? | **Decided (back lead, 2026-10-26):** per publish only. The record also names the timelines (batches) that received the change and those that kept their version | Audit |
| Q-9 *(back lead)* | Publishing with no changes? | 409 `FIELD_CONFIG_NOTHING_TO_PUBLISH`, nothing written. A new version needs a change | API |
| Q-10 *(back lead)* | Two admins editing the same draft: last write wins per field? | Yes, per field. Each write bumps `revision`; publish requires the `revision` the admin previewed, else 409 | Concurrency |
| Q-11 *(back lead)* | Should `/catalogs/result-types` also switch to the active cycle's year? | No, out of scope. Note it for the users-admin owner | Scope |
| Q-12 *(back lead)* | Front: build it in this spec, or leave it to the front lead? | **Decided (back lead, 2026-10-26):** back only. The front already has the mock; it adapts to the services via `front-contract.md` | Scope |
| Q-14 *(back lead — blocks the spec)* | Q-8's answer says fields "are removed from or added to the results when there are on-going batches". AC 14 and your decision say a started timeline **keeps** its version until it finishes. Which one holds? | AC 14: a started timeline keeps its version; the change reaches it only in the next timeline. To be confirmed | Version resolution — the core rule |
| Q-13 *(designer, front lead)* | The publish dialog must list receiving and keeping timelines. Design? | Reuse the dialog: under each type, two short lists, "Receive" and "Keep their version". Outside this spec | Front (not this spec) |

### Risks and dependencies

| ID | Item | Owner | Blocks |
|---|---|---|---|
| R-1 | Built on `staging-center` code, which `staging` does not have (cycles, timelines, catalogs). Merge order matters | Back lead | Merge |
| R-2 | Catalog availability: the GET depends on Reporting. Down gives 503, and the per-process cache serves a copy up to 24 h old (`catalog.service.ts:16-18`). A missing year gives a typed 404, not 503 | Back lead | — |
| R-3 | The Reporting call uses `CLARISA_API_KEY` (`catalogs.config.ts:8-13`), while TEST accepted a separate Reporting key (`x-api-key`, 2026-10-26). Confirm which key PROD uses (RC-1 in `docs/reporting-catalog.md`) | Back lead + Reporting | Deploy |
| R-4 | KZ-admin-config--cycle-timelines-1: the publish race must be proven on real MySQL (HITL), not only on the fake | Back lead | Done |
| R-5 | Migration `0005` on `qadb` is a human step; agents never run it. The dev pipeline applies migrations (`docs/infrastructure.md` § 3) | Back lead | Deploy |
| R-6 | Budget: timeline-edit ran ×1.7 over its LOC plan, driven by tests. This spec is wider (5 tables, 5 routes), so plan tests explicitly in `/akili-specify` | Back lead | Budget |
| R-7 | TRD § 5.1 / § 6 edits are a pending item for `staging` (write discipline) | Back lead | — |
| R-8 | RC-5: ask Reporting to add a per-field "new" flag to `/qa/catalog` (Q-6). Until then the GET always reports `false` | Back lead + Reporting | — |

## Success Criteria

- **Traceability:** every P2-3907 AC 1–8 and 13–16 maps to a requirement and a passing test. AC 9–12 map to the effective query only.
- **Access:** a non-admin gets 403, and no token gets 401, on every route.
- **Catalog:** the field list equals the catalog of `cycles.year`, by type and section, in catalog order. A cycle whose year has no catalog gets the typed error, not 503.
- **Core/AI rule:** saving core or AI input with hidden or view_only is impossible. Switching to those states turns both off, in the service and by CHECK.
- **Version resolution:**
  - Published before the first timeline starts → every timeline resolves to it.
  - Published while one timeline is live → that timeline keeps its version, and those not started receive the new one.
  - The preview lists exactly those sets.
- **Audit:** each publish writes one audit event with user, time, and before/after per changed (type, field).
- **Concurrency:** two concurrent publishes give one 201 and one 409 (*edit* at validation 2026-10-27, was "200"), proven on the fake and in HITL on MySQL.
- **Gates:** `pnpm lint && pnpm build && pnpm test && pnpm test:e2e` green.

## Next Step

```text
/akili-specify admin-config/field-configuration
```
