# Field configuration per cycle — Requirements

## 1. Document Control

| | |
|---|---|
| Spec path | `docs/specs/admin-config/field-configuration` |
| Type | Change |
| Depth | Full (new persisted data and migration, five routes, concurrency on publish, a date-based rule read by later review stories, an external catalog) |
| Approval Mode | gated |
| Status | Approved at the requirements gate (back lead: "Continue", 2026-10-26); S-13 not overruled, so a started timeline keeps its version (P2-3907 AC 14) |
| Source | `proposal.md` (2026-10-26). Q-1, Q-2, Q-6, Q-8, Q-12 answered by the back lead. Q-3…Q-5, Q-7, Q-9…Q-11 and **Q-14** taken at their proposed defaults when the back lead ran `/akili-specify` without answering them; **Q-14 (S-13) must be confirmed at this gate**. Jira P2-3907 (AC 1–16, reporter: BA) |
| Builds on | `admin-config/timeline-edit` (cited as *edit*: version pattern, audit pattern, FR-3 locks) and `docs/specs/archive/2026-10-21-admin-config--cycle-timelines/` (cited as *timelines*) |
| PRD stories | US-2 (configure fields per result type); PRD problem P2 |
| Scope | Server only (`server/`). The front adapts through `front-contract.md` (S-12) |
| Last updated | 2026-10-26 |

**Decisions:**

| # | Decision | From |
|---|---|---|
| S-1 | Only **top-level** catalog fields are configured. Subfields inherit their parent's configuration. The field is also the unit of review: a comment covers the field with all its sub-options, never one subfield (carried to the comments spec) | Q-1 |
| S-2 | Visibility is `hidden`, `view_only` or `assessed`. There is no "travels to TPB" state: a **core** field travels through the escalation chain to TPB and then PPU | Q-2 |
| S-3 | A timeline **starts** at 00:00 Europe/Rome on its step 1's `opens_on`, even while it is on hold (`waiting_for_load`) | Q-3 |
| S-4 | A timeline that has not started resolves to the newest version, so moving its step 1 later can give it a newer version | Q-4 |
| S-5 | A version published on a timeline's opening day, after 00:00 Rome, does **not** reach that timeline | Q-5 |
| S-6 | QA does not compute whether a field is "new". It passes through a per-field flag when Reporting sends one; today Reporting sends none | Q-6 |
| S-7 | A configured field that leaves the catalog keeps its draft row, is reported as no longer in the catalog, and is left out of the next published version | Q-7 |
| S-8 | Only **publications** are audited, with the timelines that received the version and those that kept theirs. Draft edits are not audited | Q-8 |
| S-9 | Publishing when the draft equals the latest version is refused; no empty version is created | Q-9 |
| S-10 | Draft edits: last write wins per (type, field). Publishing names the draft revision the ADMIN reviewed, and a different revision is refused | Q-10 |
| S-11 | `GET /catalogs/result-types` keeps its current year rule | Q-11 |
| S-12 | Back only; `front-contract.md` tells the front how to replace its mock | Q-12 |
| S-13 | **A timeline that has started keeps the version it started with until it finishes.** A later version reaches only timelines that have not started (P2-3907 AC 14). *Accepted at the requirements gate (2026-10-26) over the Q-8 wording "fields are removed or added on results when batches are on-going"* | Q-14 |
| S-14 | **An omitted flag is false.** Each draft-edit item describes the whole option set: `isCore` or `isAiInput` left out is stored `false`, also when `visibility` is `assessed`. *Back lead, 2026-10-26, during `/akili-execute` (T-3 gate, option A)* | T-3 Reviewer advisory |

## 2. Executive Summary

Today the QA coordinator classifies every Reporting field per result type in an Excel file, and the tech team applies it by hand. This spec gives the **ADMIN** the configuration per cycle. Every field of the Reporting catalog for the cycle's year is shown, and for each field the ADMIN chooses whether assessors see it, assess it, treat it as core, and get an AI suggestion for it. The ADMIN edits a draft and publishes it as an immutable version. Each timeline uses the version published before it started, so a review in progress never changes. Every publication is recorded. PRD problem P2.

## 3. Glossary

| Term | Meaning |
|---|---|
| Catalog | Reporting's `GET /qa/catalog?phase_year=<year>`: result types, sections and fields for one phase year (`docs/reporting-catalog.md`) |
| Field | A top-level catalog field, identified by its `key` (`general.title`). Its subfields are part of it (S-1) |
| Applicable field | A field whose catalog `result_types` contains the type, or `"*"` |
| Option set | `visibility` (`hidden` / `view_only` / `assessed`), `is_core`, `is_ai_input` for one (type, field) |
| Requirement | Read-only, from the catalog: `required`; `conditional` when the field has `required_when`; `optional` otherwise |
| Unclassified | An applicable field with no option set in the draft; it reads as `hidden` |
| Draft | The cycle's working option sets, with a `revision` that changes on every draft write |
| Version | An immutable, numbered snapshot of the cycle's option sets, created by a publication |
| Start of a timeline | 00:00 Europe/Rome on its step 1's `opens_on` (S-3) |
| Receive / keep | For a publication: timelines that will resolve to the new version / timelines that started and keep their version |
| Effective configuration | The option sets a timeline uses for one result type: its resolved version (FR-9) |

## 4. System Context & Scope

**In scope:** reading the catalog for `cycles.year`; the configuration view; draft edits, discard and publish; the publish preview; the version resolution rule; the effective-configuration query; the publication audit; admin-only access; OpenAPI; migration `0005`; module guide; `front-contract.md`.

**Out of scope:** the front (S-12); applying the configuration in review screens (P2-3907 AC 9–12, later stories — only the query is delivered); copying from a previous cycle; creating or changing Reporting fields; how AI suggestions are made; a per-field comments switch; auditing draft edits (S-8); a route listing the audit history; computing "new" (S-6); changing `/catalogs/result-types` (S-11); TRD edits beyond a pending item.

**Current behavior** (`feat/field-configuration` @ `0b62fd1`, from `origin/staging-center`):

| # | Today | Evidence |
|---|---|---|
| C1 | No field configuration exists on the server | `git grep -n "field_config\|fieldConfig\|is_core\|is_ai_input\|isCore\|isAiInput" -- server/` → 0 hits |
| C2 | The catalog client reads only `result_types[]`, for the current UTC year, with `x-api-key` | `server/src/users/catalogs/reporting-result-types.client.ts:25-50`, year at `:27` |
| C3 | A Reporting failure (any non-2xx, timeout, bad JSON) becomes 503 `SERVICE_UNAVAILABLE`; responses are cached per process 1 h, with a stale copy up to 24 h served on failure | `server/src/users/catalogs/catalog-http.ts:16-45`; `catalogs.errors.ts:9-12`; `catalog.service.ts:16-18,26-63` |
| C4 | The catalog answers 404 for a year with no catalog (2025, 2030) and carries `sections`, `fields`, `catalog_version`, `"*"` type lists, `required_when` and `subfields` | `docs/reporting-catalog.md` §§ 1–3 (observed on TEST 2026-10-26) |
| C5 | A cycle has one `year` (unique, 2020–2100) and a status `draft` / `active` / `closed` | `server/src/database/drizzle/schema/cycles.ts:15,33-34,56,58` |
| C6 | Writes on a closed cycle are refused with 409 `CYCLES_CLOSED`; reads work in any status | `server/src/admin-config/timelines/timelines.service.ts:751-758`; `server/src/admin-config/AGENTS.md:37` |
| C7 | Step 1 is the lowest position; today in Rome is a `YYYY-MM-DD` string; a timeline's status is derived on read | `server/src/admin-config/timelines/timeline-view.ts:65-107`; `server/src/admin-config/rome-date.ts:16-21` |
| C8 | A timeline's result-type scope is `all_result_types` or its `timeline_result_types` rows | `server/src/database/drizzle/schema/timelines.ts:58`; `timeline-result-types.ts:4-15` |
| C9 | A started step 1's `opens_on` cannot be edited | *edit* FR-3 (`docs/specs/admin-config/timeline-edit/requirements.md`, FR-3) |
| C10 | Admin-config controllers are admin-only at class level | `timelines.controller.ts:81`, `cycles.controller.ts:58` (`@RequirePermission(Permission.ADMIN_ACCESS)`) |

## 5. Stakeholders / Personas

| Role (PRD § 3) | Scope | What they need from this spec |
|---|---|---|
| ADMIN (QA Admin) | Global | Classify fields per cycle and type, see what a publication changes and which timelines it reaches, publish without the tech team |
| ASSESSOR, LEAD_ASSESSOR, TPB, PPU | Assigned timelines | A configuration that does not change during a review they are doing (applied in later stories) |
| Review stories (later) | — | One query: the option sets of a timeline for a type |
| Front lead | — | `front-contract.md` to replace `fields.mock.ts` |
| Reporting team | — | Requests: a per-field "new" flag (S-6) and the open catalog questions RC-1…RC-4 |

## 6. Functional Requirements

### FR-1: Admin-only access

Every route of this spec SHALL be available only to ADMIN.

#### Scenario: Non-admin

- GIVEN a user without ADMIN
- WHEN they call any route of this spec
- THEN the answer is 403 and nothing is read or written
- AND without a valid token the answer is 401
- BUT it must NOT reveal whether the cycle exists

### FR-2: Field list from the cycle's catalog

The configuration view SHALL list the fields of the Reporting catalog whose `phase_year` equals the cycle's `year`, grouped by result type and then by the catalog's sections, in catalog order.

#### Scenario: Grouping and order

- GIVEN cycle 2026 and the catalog for `phase_year=2026`
- WHEN the ADMIN opens the configuration
- THEN each catalog result type lists its sections in the catalog's section order, and each section lists its applicable fields in the catalog's field order
- AND a field with `"*"` is listed under every result type
- AND each field shows its requirement: `required`, `conditional` (it has `required_when`) or `optional`
- AND each field shows the Reporting "new" flag when the catalog sends one, else `false` (S-6)
- BUT it must NOT list subfields as configurable entries (S-1)
- AND IT MUST break ties of equal section order by the catalog's array position

#### Scenario: Year comes from the cycle

- GIVEN cycle 2027 and today in 2026
- WHEN the ADMIN opens cycle 2027's configuration
- THEN the catalog is read for `phase_year=2027`, not the current year

#### Scenario: Catalog missing or down

- GIVEN Reporting has no catalog for the cycle's year
- WHEN the ADMIN opens the configuration
- THEN the answer is a typed refusal that names the missing catalog, distinct from a 503
- AND when Reporting is down or answers an error other than "no catalog", the answer is 503 `SERVICE_UNAVAILABLE`
- BUT it must NOT return an empty field list in either case

### FR-3: Configuration values in the view

For each (type, field) the view SHALL show the draft option set, the option set in the latest version, and whether the field is unclassified.

#### Scenario: Unclassified field

- GIVEN an applicable field with no draft option set
- WHEN the ADMIN opens the configuration
- THEN it reads `visibility = hidden`, `is_core = false`, `is_ai_input = false` and is marked unclassified

#### Scenario: Field no longer in the catalog

- GIVEN a draft option set for a field the catalog no longer lists for that type
- WHEN the ADMIN opens the configuration
- THEN that option set is returned separately, marked "not in catalog" (S-7)

#### Scenario: Summary values

- WHEN the ADMIN opens the configuration
- THEN the answer also carries the draft `revision`, the latest version number (or none) and the catalog version read

### FR-4: Core and AI input only when assessed

An option set SHALL have `is_core` or `is_ai_input` true only when `visibility` is `assessed`.

#### Scenario: Explicit contradiction

- GIVEN a draft edit with `visibility = view_only` and `is_core = true`
- WHEN the ADMIN saves
- THEN the answer is 400 naming that item's `isCore`, and nothing is written

#### Scenario: Switching off

- GIVEN a field stored `assessed`, core and AI input
- WHEN the ADMIN sets it to `hidden` without sending the two flags
- THEN it is stored `hidden` with `is_core = false` and `is_ai_input = false`
- AND an `assessed` item sent without the flags is stored with both `false` (S-14)
- AND IT MUST be impossible to store the contradiction even by a direct database write (constraint)

### FR-5: Edit the draft

The ADMIN SHALL edit the draft for one or several (type, field) items in one request.

#### Scenario: Several items

- GIVEN cycle 2026 with draft revision 7
- WHEN the ADMIN sends three items
- THEN the three option sets are stored and the revision becomes 8
- AND items not sent are unchanged

#### Scenario: Several problems

- GIVEN a request with an unknown result type, a field not applicable to its type, and a core flag on a hidden field
- WHEN the ADMIN saves
- THEN one 400 lists every problem with its item path and a catalog code, and nothing is written
- BUT it must NOT stop at the first problem

#### Scenario: Two admins edit the same field

- GIVEN two ADMINs edit the same (type, field) one after the other
- THEN the later value is stored (S-10), and the revision moves on each write

#### Scenario: Same values

- GIVEN a request whose items equal the stored draft
- WHEN the ADMIN saves
- THEN the answer is 200 with the configuration as stored, and the revision does not change

### FR-6: Discard the draft

The ADMIN SHALL reset the draft to the latest version.

#### Scenario: Discard

- GIVEN a draft that differs from version 3
- WHEN the ADMIN discards
- THEN the draft equals version 3's option sets and the revision moves
- AND with no version yet, the draft becomes empty (every field unclassified)

### FR-7: Publish preview

The ADMIN SHALL see, before publishing, what would change and which timelines would receive or keep it.

#### Scenario: Changes and timelines

- GIVEN version 2, a draft changing `general.title` for `policy_change`, and three timelines of the cycle: A started, B not started, both covering `policy_change`, and C not started covering only `knowledge_product`
- WHEN the ADMIN asks for the preview
- THEN it lists, per type, each changed field with its before and after option set
- AND it lists B under "receive" and A under "keep its version"
- AND it lists C under neither, as not covering a changed type
- AND it carries the draft revision it was computed from
- BUT it must NOT write anything

#### Scenario: Nothing to publish

- GIVEN the draft equals the latest version
- WHEN the ADMIN asks for the preview
- THEN it reports no changes

### FR-8: Publish

The ADMIN SHALL publish the draft as a new immutable version of the cycle.

#### Scenario: Publish

- GIVEN version 2 and draft revision 9 with changes
- WHEN the ADMIN publishes with revision 9
- THEN version 3 is created with every classified option set of the draft whose field is still in the catalog (S-7), together with the publish instant, the publisher and the catalog version
- AND the answer names version 3

#### Scenario: Stale revision

- GIVEN the draft is at revision 10
- WHEN the ADMIN publishes with revision 9
- THEN the answer is 409 stale, and nothing is written

#### Scenario: Nothing to publish

- GIVEN the draft equals the latest version
- WHEN the ADMIN publishes
- THEN the answer is 409 "nothing to publish", and nothing is written (S-9)

#### Scenario: Two admins publish at once

- GIVEN two ADMINs publish with the same revision at the same time
- THEN exactly one creates the version
- AND the other gets 409, and no second version exists

#### Scenario: Replay after a lost answer

- GIVEN a publication succeeded and its answer was lost
- WHEN the client repeats it with the same idempotency key
- THEN it gets the first answer, and no second version or audit record is created

### FR-9: Version a timeline uses

A timeline SHALL use the latest version whose publish instant is before its start (S-3).

#### Scenario: Published before any timeline starts

- GIVEN version 1 published on 2026-10-30 and timelines A (step 1 opens 2026-11-01) and B (2026-11-10)
- THEN A and B both resolve to version 1

#### Scenario: Published while a timeline runs

- GIVEN version 1, timeline A started on 2026-11-01, timeline B starting 2026-11-10, and version 2 published on 2026-11-05
- THEN A resolves to version 1 until it finishes (S-13)
- AND B resolves to version 2

#### Scenario: Published on the opening day

- GIVEN timeline B opens 2026-11-10 and version 3 is published 2026-11-10 at 09:00 Rome
- THEN B resolves to the version before 3 (S-5)

#### Scenario: Not started

- GIVEN timeline C has not started
- THEN it resolves to the latest version, marked provisional (S-4)

#### Scenario: Started with no version

- GIVEN timeline D started and no version was published before its start
- THEN its resolution is an explicit "no configuration" error
- BUT it must NOT fall back to defaults or to a later version

#### Scenario: On hold

- GIVEN timeline E's step 1 date has passed and it is `waiting_for_load`
- THEN it counts as started (S-3)

### FR-10: Effective configuration query

The system SHALL answer, for a timeline and a result type, the option sets that apply, for use by later review stories.

#### Scenario: Effective configuration

- GIVEN timeline A resolves to version 1
- WHEN the effective configuration of A for `policy_change` is requested
- THEN it returns version 1's option sets for `policy_change`, every applicable field without an option set reading `hidden`
- AND subfields follow their field (S-1)

#### Scenario: Type outside the timeline

- GIVEN timeline C covers only `knowledge_product`
- WHEN the effective configuration of C for `policy_change` is requested
- THEN the answer is an explicit "type not in this timeline" error

### FR-11: Publication audit

Every publication SHALL leave one audit record.

#### Scenario: Audit record

- WHEN version 3 is published
- THEN one record stores the publisher, the instant, the request id, the version, for each changed (type, field) the option set before and after, and the timelines that received the version and those that kept theirs
- BUT it must NOT record unchanged items
- AND a refused publication leaves no record

### FR-12: Versions never change

A published version SHALL never be changed or deleted.

#### Scenario: Immutability

- GIVEN version 2
- WHEN any later draft edit, discard or publication happens
- THEN version 2's option sets, instant and publisher are unchanged

### FR-13: Cycle status

Reads SHALL work in any cycle status; draft edits, discard and publication SHALL be refused on a closed cycle.

#### Scenario: Closed cycle

- GIVEN a closed cycle
- WHEN the ADMIN edits, discards or publishes
- THEN the answer is 409 `CYCLES_CLOSED`, and nothing is written
- AND the configuration view and the preview still answer

#### Scenario: Unknown cycle

- WHEN any route names a cycle that does not exist
- THEN the answer is 404

### FR-14: Front contract

The spec SHALL deliver `front-contract.md`: the routes, request and answer shapes, the requirement values, the error codes, the preview's receive/keep lists, the replacement of the mock's `third` state by `assessed` + core (S-2), and the publish-dialog wording that follows FR-9 instead of "applies to results loaded from now on".

## 7. Non-Functional Requirements

| ID | Attribute | Scenario (source → stimulus → response) | Measure | TRD ref |
|---|---|---|---|---|
| NFR-1 | Security | Non-admin → any route → refused before any read | 403; e2e access matrix over every route | QAS-SEC-2 |
| NFR-2 | Security | Any client → unknown body field → refused | 100 % → 400 | QAS-SEC-3 |
| NFR-3 | Integrity | Two ADMINs → concurrent publications on one revision → one version | Exactly one; enforced by the database write, not only a prior read; HITL on MySQL (KZ-admin-config--cycle-timelines-1) | QAS-AVL-1 |
| NFR-4 | Correctness | Clock → any instant incl. midnight Rome and both DST changes → version resolution | Injectable clock; boundary tests; suites under `TZ=UTC` and `TZ=America/Bogota` | *timelines* NFR-4 |
| NFR-5 | Performance | ADMIN → view, preview, publish for a cycle with 9 types, 161 fields, 50 timelines | A fixed number of database statements whatever the number of fields, items or timelines; one catalog read per request at most (cached) | QAS-PERF-1 |
| NFR-6 | Availability | Reporting down → configuration view | 503 within the client timeout (10 s, C3); a cached catalog for the year is served when fresh enough (C3) | — |
| NFR-7 | Observability | Every write → one decision line | Actions `field_config_update`, `field_config_discard`, `field_config_publish`; ids, outcome, reason; no bodies | *timelines* NFR-7 |
| NFR-8 | Auditability | Any publication → retrievable record | 100 % of publications have exactly one audit record; 0 for refused ones | PRD P3 |

### Defect classes and their gates

| Defect class this spec can produce | Gate (command or check) | Substitute / accepted risk |
|---|---|---|
| Wrong version resolved at a boundary (midnight Rome, DST, opening day, hold) | Table-driven unit tests with an injected clock under `TZ=UTC` and `TZ=America/Bogota` — `pnpm test --reporter=dot` | — |
| Core/AI contradiction stored | Unit tests on the rules + `schema.spec.ts` pin of the CHECK | — |
| Wrong field list: year, `"*"` expansion, order ties, subfields listed | Unit tests over the real TEST catalog fixture (`server/src/users/catalogs/fixtures/`) | Catalog drift on TEST/PROD: RC-1…RC-4 open with Reporting |
| Several problems collapsed into one | Unit + e2e asserting the full `fields` list | — |
| Preview receive/keep wrong (scope, started, opening day) | Unit tests over timeline fixtures + e2e preview | — |
| Lost or duplicated version under concurrency | Unit-of-work tests over the fake | **Fakes cannot show InnoDB behavior** (KZ-admin-config--cycle-timelines-1): HITL concurrent publish on MySQL after `0005` |
| Audit missing, duplicated on replay, or written on refusal | Unit-of-work tests; e2e replay | — |
| Route without the admin guard, wrong status | e2e 401/403 matrix — `pnpm test:e2e --reporter=dot` | — |
| OpenAPI out of step | `test/openapi.e2e-spec.ts` | — |
| Type errors the runner erases | `pnpm build` | — |
| Migration differs from schema | `schema.spec.ts` | Applying `0005` to `qadb` is a human step; HITL plan names token handover and leftover data (KZ-admin-config--cycle-timelines-3) |
| Front breaks on the new API | `front-contract.md` reviewed against code | Front adaptation is the front lead's (S-12) |

## 8. Requirement ID Index

| ID | Title | Scenarios | Owning task(s) |
|---|---|---|---|
| FR-1 | Admin-only access | Non-admin | T-8, T-9 |
| FR-2 | Field list from the cycle's catalog | Grouping and order · Year comes from the cycle · Catalog missing or down | T-2, T-6, T-9 |
| FR-3 | Configuration values in the view | Unclassified · Not in catalog · Summary values | T-6, T-9 |
| FR-4 | Core and AI only when assessed | Explicit contradiction · Switching off | T-1, T-3, T-7, T-9 |
| FR-5 | Edit the draft | Several items · Several problems · Two admins · Same values | T-3, T-5, T-7, T-9 |
| FR-6 | Discard the draft | Discard | T-7, T-9 |
| FR-7 | Publish preview | Changes and timelines · Nothing to publish | T-4, T-6, T-9 |
| FR-8 | Publish | Publish · Stale revision · Nothing to publish · Two admins · Replay | T-1, T-5, T-7, T-8, T-9, T-11 |
| FR-9 | Version a timeline uses | Before any start · While running · Opening day · Not started · Started with none · On hold | T-4, T-6 |
| FR-10 | Effective configuration query | Effective configuration · Type outside the timeline | T-6 |
| FR-11 | Publication audit | Audit record | T-1, T-3, T-5, T-7, T-9, T-11 |
| FR-12 | Versions never change | Immutability | T-1, T-7 |
| FR-13 | Cycle status | Closed cycle · Unknown cycle | T-6, T-7, T-8, T-9 |
| FR-14 | Front contract | — | T-10 |
