# Step 1 assessment: worklist and field-by-field review — Proposal

> **In one line:** assessors get a server-paged worklist of the results in their scope (P2-3909) and a focused review page where they validate fields, comment and finish a result in step 1 (P2-3910), so each result ends as **Quality Assessed** (released `qaed`) or **Returned to program** (released `not_qaed`). The admin sees every timeline. The model is keyed by role and step, so the Lead Assessor, TPB and PPU stories each add one configuration row.

## 1. Document Control

| Field | Value |
|---|---|
| Spec Path | `docs/specs/assessment/step-1-assessment/`. The brief set this literal path. `assessment` is a new domain: the spec organization table in `AGENTS.md` lists `evaluation` and `comments`, not `assessment` (see R-9) |
| Type | Change |
| Deliverable | software (server + client) |
| Jira | P2-3909 (worklist, 13 ACs) · P2-3910 (assessment, 23 ACs). Epic P2-3902. Both In Progress. Read from Jira on 2026-11-10; neither has comments |
| Approval Mode | gated |
| Branch / worktree | `feat/assessment-step-1` from `staging-center` @ `20696f9`, worktree `../onecgiar_qa-assessment`. Nothing is pushed until the back lead says so |
| Author | Claude Code (`claude-opus-5-5`) for the back lead (Juanda), 2026-11-10 |
| Requirement source | Jira MCP (ACs quoted in § 9) plus the back lead's brief. Visual source: the in-repo mockup (§ 8) |
| Depends on | `ingestion/timeline-sync` (archived: memberships per round, `changed_fields`, `endAsReturned`) · `admin-config/field-configuration` (archived: `FIELD_CONFIG_EFFECTIVE`) · `auth/user-management` (archived: scope, nickname) · Reporting `qa-value-labels` (optional, see DD-P6) |
| Parallel-safe | no. It adds migrations and touches `ingestion` (adapter, snapshot entity, `end()`) |

## 2. Intent

Step 1 of QA is the only step where results are assessed field by field. Results already arrive in QA: the admin syncs them and they become memberships with a snapshot. What is missing is somewhere to do the assessment. This change delivers that place:

1. A **worklist** that shows each reviewer only what concerns them and what is still pending.
2. An **assessment view** that leads a result to one of two end states and tells Reporting.

## 3. Problem / Current Behavior

| # | Today | Source |
|---|---|---|
| C-1 | Memberships exist with status `pending`, `auto_validated` or `not_in_qa`. No status says "assessed" or "returned" | `server/src/database/drizzle/schema/timeline-results.ts:25-29` |
| C-2 | `end_reason` `returned` exists, and `endAsReturned` is a store port with **no caller** | `timeline-results.ts:45`; `server/src/ingestion/loads.store.ts:300`; `server/src/ingestion/AGENTS.md` (*Return and re-entry*) |
| C-3 | A round-2 re-entry stores the changed field keys in `changed_fields`. The guide says that value is "never returned by a route" | `timeline-results.ts:116`; `ingestion/AGENTS.md` (*Return and re-entry*) |
| C-4 | The release port (`qaed` / `not_qaed`) is called only for KPs, after a load | `server/src/ingestion/results-feed.port.ts` (`release`); `load-runner.ts:264`, `:606` |
| C-5 | Field configuration has one export for the review stories, `effectiveFor(cycleId, timelineId, resultTypeKey)`. Its version is fixed once step 1 opens, and it throws when nothing resolves | `admin-config/field-config/field-config.module.ts:34-49`; `field-config.service.ts:774-799` |
| C-6 | Scope primitives exist: `coversResultType` and `coversProgram` (`effective-scope.ts`), `canReview`, the live-grant check, and active `timeline_users` rows. The admin guide says the P2-3909 visibility predicate "is **not built**" | `server/src/users/effective-scope.ts`; `users/AGENTS.md`; `admin-config/AGENTS.md` (*Reserved tables*) |
| C-7 | `users.nickname` exists (unique, nullable). `toPublicUser` is the only way another user may be rendered to a non-admin | `schema/users.ts:52`; `users/public-user.ts:5` |
| C-8 | The snapshot stores `values` and the hash of `canonicalJson(values)`. There is no `labels` attribute, and the adapter does not read `labels` | `database/dynamodb/entities/result-snapshot.entity.ts`; `ingestion/load-runner.ts:127-128`; `ingestion/fixtures/results-details.json` |
| C-9 | Every result in the catalog has a 2026 **Theory of Change**, but the catalog has no ToC section: the 4 `toc.*` fields live in `contributors_partners` (merged in v1.1) | `admin-config/field-config/fixtures/reporting-qa-catalog-2026.json` (sections list); `onecgiar_pr/.../qa-catalog.en.md:704` |
| C-10 | The front `results` and `review` pages are Juanpa's mockup running on mock data (`results.mock.ts`, `review.mock.ts`). Its vocabulary is `Pending · In review · Awaiting response · Answered · Quality assessed · Automatic` | `client/src/app/pages/workspace/results/results.mock.ts:11-17`; `client/src/app/app.routes.ts` (`results`, `results/:code`) |
| C-11 | The UX baseline names round-1 stages "Assessed by 1 assessor · Assessed by 2 assessors" and says automatic results "are not listed". Both contradict the Jira ACs (§ 9, *Conflicts*) | `docs/ux-ui/design.md:62`, `:131` |
| C-12 | Timelines have a `kind` (`official`, `additional`), with one official per cycle. Steps have one `audience` per timeline | `schema/timelines.ts:29`; `schema/timeline-steps.ts:61`, `:69` |
| C-13 | No table exists for assessments, validations, comments, quick comments or comment events. TRD § 5.1 sketches `field_reviews`, `comments` and `comment_events` against the superseded batch model | `docs/trd/trd.md` § 5.1 (superseded note), § 7.3 |

## 4. Proposed Outcome

| Who | What they can do |
|---|---|
| **Assessor** | Opens Results and sees the official timeline selected by default. The list holds only the results of their assigned timelines, result types and Science Programs, with Auto-validated hidden. A count of pending and finished results sits above the table, and they can filter, search, sort and page. While step 1 is open they open a result and work section by section: green/grey per Assessed field, Check all / Uncheck all, comments (quick comments included), and withdrawing their own comment. When every core field is green the result becomes Quality Assessed. Otherwise "Finish assessment" returns it to the program. Then the result locks for everyone. When step 1 closes, the list and every result are read-only |
| **Two assessors on the same result** | Both work on the same assessment. One finish wins. The other sees the result finished, and their next write is refused with a typed 409 |
| **QA Admin** | Sees every timeline and every result read-only, Auto-validated included on demand |
| **Reporting** | Gets `qaed` for Quality Assessed and `not_qaed` for Returned. The membership ends `released_qaed` or `returned`. *When* the release is sent is OQ-1 |
| **Later stories** | Lead (step 3), TPB (step 4) and PPU (step 5) add one row to the role-step table (DD-P2). They reuse the worklist, the status map and the comment model unchanged |

## 5. Scope

**Server (new module `server/src/assessment/`)**
- **Data model:** `result_assessments`, `assessment_field_validations`, `assessment_comments`, `comment_events`, `quick_comments` and `assessment_audit_events`. Unique keys carry the invariants (DD-P3).
- **Worklist API:** scope predicate, filters, status map, counters, sort on every column, and server-side cursor paging.
- **Assessment API:** open (header, sections and fields in catalog order, values with labels, effective configuration, validations, comments), validate / unvalidate / check-all / uncheck-all, comment add / withdraw, quick comments list / save, and finish.
- **Release:** both outcomes, through the existing `RESULTS_FEED.release`, with retry (DD-P7).
- **Ingestion follow-ups:**
  - `endAsReturned` gets its first caller.
  - `countReturnedNotResubmitted` moves into `end()`'s transaction (timeline-sync archive § 9).
  - `labels` is read as optional in the adapter and stored in the snapshot outside the hash (DD-P6).
  - The fixture gets synthetic `labels`.
  - The worklist reads `changed_fields` as one boolean (amends the ingestion rule in C-3).
- **Title for sort and search:** a MySQL copy of `general.title` per membership (DD-P5).
- **Docs:** `front-contract.md`, the `server/src/assessment/AGENTS.md` guide, and the new error codes in `common/error-codes.ts`.

**Client**
- Results (`results-view`) and Result review (`review-view`) move from mocks to the API, following `front-contract.md`. The mock files stay where other screens use them: `overview.mock.ts` reads `results.mock.ts`.

**Tests**
- Unit tests for the pure rules (status map, role-step table, auto-QA, lock rules).
- Service and unit-of-work tests over in-memory stores, e2e tests (routes, guards, envelopes, privacy log spy, OpenAPI), concurrency tests (parallel finishes, validation during a finish), and tests for clock-driven locking.

## 6. Non-Goals

- AI suggestion per field (P2-3918). The mockup's "AI match" stays hidden.
- Lead Assessor, TPB and PPU reviews (P2-3912 and later): only the empty configuration rows and status enum values are added.
- The Science Program's response and its screen (P2-3911). "Comments answered by SP" is always 0.
- Export of comments (P2-3914). The button is hidden until that story (OQ-4).
- Overview dashboard (P2-3913), assigning results to specific reviewers, and the chatbot.
- Editing or deleting quick comments. The AC asks only for listing and saving them.
- The **Action Area** column, dropped for good. It is a concept of the 2022–2024 portfolio and does not apply to the Science Programs (OQ-3, closed 2026-11-11).
- Two assessors per result ("Assessed by 2 assessors" in the UX baseline). AC21 says one finish wins (OQ-6).

## 7. Affected Users, Systems And Specs

| Area | Effect |
|---|---|
| `server/src/assessment/**` (new) | New module: controller(s), services, stores, rules, migrations `0009+` |
| `server/src/ingestion/` | `reporting-results-feed.client.ts` (optional `labels`), `results-feed.port.ts`, `snapshot-store.port.ts`, `dynamo-snapshot-store.ts`, `load-runner.ts` (title copy, labels), `loads.store.ts` (`end()` count), `fixtures/results-details.json`, `AGENTS.md` (amended rules) |
| `server/src/database/` | New Drizzle schemas, a `ResultSnapshot` attribute (`labels`), and `schema.spec.ts` assertions |
| `server/src/users/` | Read only: `canReview`, `coversResultType`, `coversProgram`, `isLiveAssignment`, `toPublicUser`. No new permission is expected, because `ASSESSOR_ACCESS` exists (to be confirmed at specify) |
| `server/src/admin-config/` | Read only: `FIELD_CONFIG_EFFECTIVE`, `ADMIN_CONFIG_CLOCK`, `viewTimeline`, `FIELD_CATALOG_SOURCE`. `admin-config/AGENTS.md` (*Reserved tables*) gets one line saying the visibility predicate is built here |
| `client/src/app/pages/workspace/results/**`, `review/**` | Mock → API. These are **Juanpa's and Yeck's files** (`git log`: Juanpa 13 days ago, Yeck `042464d`), see R-6 |
| Reporting (`onecgiar_pr`) | No change required. Reads `labels` when present (commit `448debd0f`, not pushed) |
| Specs | Amends ingestion rule C-3. Supersedes the UX vocabulary in C-11 (pending item for the design owner). TRD § 5.1 and § 7.3 are rebound (pending item on `staging`, shared-file discipline) |

## 8. Visual Reference

- **Source:** the in-repo mockup by Juanpa (design owner), on `staging-center`.
- **Location:** `client/src/app/pages/workspace/results/` (filter bar, table, paginator) and `client/src/app/pages/workspace/review/` (section navigator `review-aside`, `review-field-card`, `review-toc-section`, `review-comments-drawer`, `review-footer`). Rules are in `docs/ux-ui/design.md` § 2 and § 7.
- **Notes:** the mockup covers both screens, but its vocabulary differs from the ACs (C-10, C-11), and it shows elements that are out of scope (AI match, Assessor filter). **Open:** is there a newer Figma or Claude Design frame for these two screens? If so, `/akili-specify` should read it.

## 9. Requirement Delta Preview

### ADDED requirements

**P2-3909 — Worklist**

| AC | Requirement (as in Jira) | Design note |
|---|---|---|
| 1 | Only results of assigned timelines, within the reviewer's result types and SPs | All of these must hold: an active `timeline_users` row, a live grant of that role, `coversResultType`, `coversProgram`, and the timeline scope |
| 2 | Results in the role's step: Assessor step 1, Lead 3, TPB 4, PPU 5. In step 2, an Assessor also sees results where the SP requested clarification on their comment | Role-step table (DD-P2). The step-2 clarification predicate is built on a state P2-3911 will produce (OQ-5) |
| 3 | Open only while the step is open; otherwise read-only | Judged by `viewTimeline` on the step whose `audience` matches the role, at `ADMIN_CONFIG_CLOCK` |
| 4 | QA Admin sees everything | Read-only unless also assigned (DD-P2) |
| 5 | Timeline filter limited to the assigned timelines; the official one by default | `kind = 'official'` exists (C-12), so this needs no open question |
| 6 | Filters: status, SP, result type, search by code or title | Title search needs DD-P5 |
| 7 | Statuses: Pending, Returned to program, Clarification requested, Pending for TPB review, Pending PPU, Unresolved, Quality Assessed, Auto-validated | Status map (DD-P4). The last three non-final values are in the enum but nothing produces them yet |
| 8 | Auto-validated hidden by default | Default filter. Contradicts UX C-11 |
| 9 | The columns | Action Area is dropped (OQ-3, closed). Export is OQ-4. "Comments answered by SP" is 0 |
| 10 | "Updated" tag | `entry_round = 2` and non-empty `changed_fields`. Assessors in step 1 work round-1 memberships, so in this story only the admin sees the tag in practice (R-8) |
| 11-13 | Sort by any column, a click opens the result, pending and finished counters | Server-side sort and keyset paging. Counters are over the reviewer's in-scope results in the selected timeline |

**P2-3910 — Assessment**

| AC | Requirement | Design note |
|---|---|---|
| 1-3 | Catalog sections and field order per result type; section navigator; collapse the menu and the navigator together; header with code, title, SP, type, timeline, step, QA status | Structure from `FIELD_CATALOG_SOURCE` for the cycle year (R-5) |
| 4-7 | Hidden not shown; View only read-only; Assessed shows green/grey and comment; "Core" tag | From `effectiveFor`. `FieldConfigNoVersionError` → typed 409 at open |
| 8-9 | Undo a validation; Check all / Uncheck all on Assessed fields only | One audit row per bulk action, listing the keys |
| 10 | ToC always shown and complete, with all contributions | Overrides Hidden. Which keys count as "ToC", and whether they become assessable, is OQ-7 (C-9) |
| 11-13 | Comment on any Assessed field; insert a quick comment and edit it; save as a shared quick comment for the role | `quick_comments` keyed by role, deduplicated by a body hash |
| 14 | Comment records nickname, date-time, step and the field **value** at writing | The value and its labels are copied from the membership's snapshot (immutable) into the comment row (DD-P8) |
| 15 | Withdraw own comment while the SP has not answered | Window is OQ-8 |
| 16 | All core green → Quality Assessed automatically | In the same transaction as the validation that turned the last core field green. Edge cases in OQ-2 |
| 17-18 | Otherwise "Finish assessment" → Returned to program. All comments become visible to the SP in step 2, also on a QA'd result | `visible_to_program` is decided on finish. The SP view is P2-3911 |
| 19 | "Assessed by" nickname | The user who finished, or who turned the last core field green |
| 20 | Locked after finishing; nobody assesses after step 1 closes | Status check plus the clock, inside the write transaction |
| 21 | Any assessor of that type and SP may review; once one finishes, the others see it finished | One assessment row per (membership, step). The finish is a conditional `UPDATE … WHERE status = 'pending' AND version = ?` |
| 22-23 | During step 2 the assessor answers a clarification; the comment reopens for the SP | States modeled now. The answer API and UI are proposed to move to P2-3911 (OQ-5) |

### MODIFIED requirements

- `ingestion`:
  - The adapter accepts optional `results[].labels: { "<control_list>": { "<id>": "<label>" | null } }`.
  - The snapshot stores `labels` **outside** `snapshot_hash`, so a rename in CLARISA never marks a result "Updated" and never conflicts a retry.
  - The runner copies `general.title` to MySQL.
  - `countReturnedNotResubmitted` runs inside `end()`.
- `ingestion/AGENTS.md`: `changed_fields` stays unreturned **as keys**. Only its emptiness is exposed, as `updated: boolean`.
- `docs/ux-ui/design.md` § 7: the QA stage vocabulary for step 1 follows Jira AC7. This is a pending item for Juanpa and Yeck, not edited on this branch.
- Results and Review pages: mock data → API.

### REMOVED requirements

- None in code. "Automatic results are not listed" (UX C-11) is superseded by AC8.

### Conflicts found (Jira vs baseline)

| # | Baseline says | Jira says | Proposal |
|---|---|---|---|
| X-1 | Round 1: "Assessed by 1 assessor · Assessed by 2 assessors" (`design.md:131`) | One finish wins (AC21) | Jira wins. Confirm with Angel (OQ-6) |
| X-2 | Automatic results are not listed (`design.md:62`) | Hidden by default, selectable (AC8) | Jira wins |
| X-3 | Field states "Not reviewed · Commented · Answered · Approved · Highlighted" (`design.md:132`) | Green / grey plus comments | Step 1 uses green/grey plus a comment count. The rest belongs to later stories |
| X-4 | AC1 example names a "Theory of Change" section | The catalog has no such section (C-9) | OQ-7 |

## 10. Approach Options

| Option | What | For | Against |
|---|---|---|---|
| **A. One spec, one design, phased tasks** (the brief's order) | Model → worklist API → assessment API → labels + fixture → worklist UI → review UI → concurrency and clock tests. `front-contract.md` is the boundary, with a HITL gate after the API | One coherent model and status map. No duplicated design. Matches the brief | Large: roughly 5-6k production LOC (step-1-loads was about 4.3k and re-estimated twice). The budget tripwire is likely |
| **B. Family `assessment/` with 3 children** | `step-1-api` (all server work) → `step-1-worklist-ui` and `step-1-review-ui` (parallel-safe with each other, both depending on the API) | Smaller review units. The UI children can go to Yeck with their own gates | A `family.md` and three proposals. The design must still be written once in the API child, and the UI children mostly restate the contract |
| **C. Split by story** (3909, then 3910) | Worklist first, assessment second | Follows Jira | The worklist's status column depends on the assessment model, so the split is circular, or the worklist ships with fake statuses |

## 11. Recommended Approach

**Option A.** It is the smallest safe path because the hard parts all belong to one design that must be decided once: the data model, the status map, the role-step table, the release mapping and the concurrency keys. Two mitigations cover its size:

1. A hard HITL gate after the API tasks. `front-contract.md` is frozen there, so the UI tasks can be executed by Yeck or handed over (R-6).
2. A per-phase LOC budget in `tasks.md`.

Switch to B only if the team wants the UI owned and gated separately (question in the report).

**Design decisions to carry into `/akili-specify` (proposed, not final):**

| ID | Decision |
|---|---|
| DD-P1 | New module `server/src/assessment/`. It reads `ingestion` and `admin-config` through their ports and Drizzle tables, the way `DrizzleTimelineLoads` does, and does not import their modules (no module cycle) |
| DD-P2 | **Role-step table**, pure data: `{ role, permission, audience, round, opensResults, extraPredicates }`. Only the ASSESSOR row (audience `assessors`, round 1, plus the step-2 clarification predicate) and the ADMIN read-all row are active. Lead, TPB and PPU rows are declared and disabled. The timeline assignment role decides who can write, so an unassigned admin is read-only |
| DD-P3 | **Tables and keys:** `result_assessments` (unique `(timeline_result_id, step_position)`; `status` `pending` / `quality_assessed` / `returned`; `version`; `finished_by` and `finished_at`; pinned `field_config_version`), `assessment_field_validations` (PK `(assessment_id, field_key)`), `assessment_comments` (author, step, round, body, value copy, `state`, `withdrawn_at`), `comment_events` (append-only, ADR-006), `quick_comments` (unique `(role_code, body_hash)`), `assessment_audit_events` (append-only, no PII). Lock order: timeline `FOR SHARE` → assessment row `FOR UPDATE` → validations and comments |
| DD-P4 | **Status map**, computed on read and never stored: membership `auto_validated` → Auto-validated. `not_in_qa` → not listed. Assessment absent or `pending` → Pending. `returned` → Returned to program, or Clarification requested when a thread is `clarification_requested`. `quality_assessed` → Quality Assessed. Pending for TPB review, Pending PPU and Unresolved are in the enum but nothing produces them yet |
| DD-P5 | **Title in MySQL** for sort and search: a nullable `title` column on `timeline_results`. The runner writes it from `values['general.title']`, and an idempotent backfill reads DynamoDB for existing rows (no manual SQL) |
| DD-P6 | **Labels:** optional in the port. The snapshot attribute is `labels` (gz like `values`), excluded from the hash. Without labels, the front shows the id. The fixture is synthetic and is aligned with the contract example once Reporting closes its T-6 |
| DD-P7 | **Release:** an outbox row is written in the finish transaction, sent after commit, then retried on the next touch or by an admin action until Reporting acknowledges. Quality Assessed → `qaed` and end `released_qaed`. Returned → `not_qaed` and `endAsReturned` (end `returned`) |
| DD-P8 | **Comment value:** a JSON copy of `{ value, labels }` for that field from the membership's snapshot, taken at write time. The other option, a reference (`snapshot_sk` plus `field_key`), is exact because snapshots are immutable but is fragile for export |
| DD-P9 | **Concurrency:** one assessment per membership and step. Finish and auto-QA are conditional updates under the assessment row lock. A write after the finish is 409 `ASSESSMENT_FINISHED`, and a write outside the step is 409 `ASSESSMENT_STEP_CLOSED`. The clock is read once per request |

## 12. Risks, Dependencies And Open Questions

### Open questions (owner: Angel, PO, unless noted). By KZ-ingestion--step-1-loads-1, every task built on an OQ default stays blocked until it is answered or accepted by name

| ID | Question | Proposed default |
|---|---|---|
| OQ-1 | Release to Reporting **at once** (on finish or auto-QA) or **at step 1 close**? | At once. Release at close needs a trigger, and no scheduler exists (statuses are computed on read). Note: an immediate `not_qaed` lets the SP edit in Reporting before step 2 shows the comments |
| OQ-2 | Auto-QA fires the moment the last core field turns green, which locks the result before the assessor comments non-core fields. Is that wanted, or should Finish confirm it? And a result type with **zero** core fields? | Automatic, as AC16 says. With zero core fields, Finish → Quality Assessed |
| OQ-3 | Action Area: not in the Reporting feed. Source, or drop the column? | **Closed 2026-11-11 (back lead): dropped.** It is a concept of the 2022–2024 portfolio and does not apply to the Science Programs. The column is removed from P2-3909's scope, not hidden |
| OQ-4 | Export comments (P2-3914): hide the button or show it disabled? | Hidden |
| OQ-5 | Clarification answer (AC22-23, 3909 AC2): it cannot be exercised until the SP can request one (P2-3911). Move the answer API and UI to P2-3911? | Model the states and the worklist predicate now; move the answer action to P2-3911 |
| OQ-6 | Confirm one assessor per result (AC21) against the mockup's "Assessed by 2 assessors" | One finish wins |
| OQ-7 | Which fields make up "the ToC section" (the catalog has only `toc.*` inside `contributors_partners`)? Shown as its own section? If configured Hidden, does it become View only or Assessed? | `toc.*` plus `contributors.science_programs`, shown as a virtual "Theory of Change" section in catalog position. Hidden → View only |
| OQ-8 | Withdraw window: only before finish, or also in step 2 until the SP answers? | Until the SP answers, while step 1 or step 2 is open |
| OQ-9 | Must each grey core field carry a comment before "Finish assessment"? | Yes, otherwise 409 listing the fields |
| OQ-10 (front lead) | Are there newer design frames for Results and Review than the in-repo mockup? | Use the in-repo mockup |

### Risks

| ID | Risk | Mitigation |
|---|---|---|
| R-1 | Size, and a budget tripwire like step-1-loads (2 re-estimates) | Option A gates and a per-phase budget, or Option B |
| R-2 | Release fails (Reporting down) after a committed finish | Outbox with retry (DD-P7). The status shows "release pending" to the admin |
| R-3 | A key written by one module and read by another (snapshot `sk`, labels) is tested only with hand-built keys | KZ-ingestion--timeline-sync-1: tests read keys produced by the real writer |
| R-4 | Tasks change behavior that existing tests pin (`changed_fields` rule, `end()` count) | KZ-ingestion--timeline-sync-2: each such task owns those tests |
| R-5 | The current catalog revision differs from a snapshot's `catalog_version`: a key may be missing on either side | Structure from the current catalog. A value missing for a key reads "not applicable". A key in the snapshot that is not in the catalog is listed under "Other" |
| R-6 | The front files belong to Juanpa and Yeck (team `CLAUDE.md` § 3.4). Replacing mocks changes logic | Yeck owns or approves the UI tasks, and `front-contract.md` is the hand-off |
| R-7 | PII: a comment copies the value of an Assessed person-bearing field (e.g. `general.lead_contact_person`) into MySQL | Stored, never logged, and rendered only to users in scope. The log-spy e2e covers the new routes |
| R-8 | "Updated" never shows for assessors in step 1 (round-2 memberships start at step 3) | Accepted. The admin sees it, and the Lead story uses it |
| R-9 | New domain `assessment` is not in the `AGENTS.md` spec table | Pending item on `staging`, or rename to `evaluation/` before specify |
| R-10 | Worklist cost with hundreds of results: sort by SP or type label needs SQL ordering on catalog labels | Order by a `FIELD()` or `CASE` over the cached catalog. Fixed query count, pinned by a test (as in the admin-config NFR-5) |
| R-11 | Credentials through chat on the live checks (KZ-admin-config--cycle-timelines-3, recurred twice) | Live checks read tokens from a file and never from chat |

### Dependencies

- Reporting `labels` (commit `448debd0f`, not pushed): optional, not blocking.
- Release outcome `not_qaed` with end reason `returned`: the reason is already in the enum, and `released_not_qaed` stays reserved.

## 13. Success Criteria

1. An assessor assigned to one timeline, type and SP sees exactly those results, and the official timeline is selected by default. Another assessor's out-of-scope results never appear, by API or by URL (403 or 404).
2. Opening a result shows the catalog sections in order, the Hidden fields absent, View only read-only, Assessed with green/grey and Core tags, and the ToC complete.
3. All core green → Quality Assessed, `qaed` sent, "Assessed by" set. Finish with grey core → Returned, `not_qaed` sent, and the membership ended `returned`.
4. Five parallel finishes give one success and four 409s, one audit row and one release.
5. With the clock set one minute after step 1 closes, every write answers 409 `ASSESSMENT_STEP_CLOSED`, and the worklist shows the results read-only.
6. A comment shows the nickname, time, step and the field value (with labels when Reporting sent them, ids otherwise).
7. A CLARISA rename (new labels, same values) on a re-sync does not mark a result "Updated".
8. No title, name, email, comment body or value in any log line (privacy e2e). Every validation, comment and finish has an audit row.
9. Worklist pages of 50 over 1,000 memberships answer within a fixed query count.

## 14. Next Step

```text
/akili-specify assessment/step-1-assessment
```

Standard depth. Before tasks that depend on OQ-1, OQ-2, OQ-5, OQ-7 and OQ-9, their defaults need Angel's answer or the back lead's named acceptance (KZ-ingestion--step-1-loads-1).
