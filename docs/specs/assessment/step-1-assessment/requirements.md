# Step 1 assessment: worklist and field-by-field review — Requirements

## 1. Document Control

| Spec path | Status | PRD stories | Last updated |
|---|---|---|---|
| docs/specs/assessment/step-1-assessment | Draft (Phase 1) | US-5, US-3 (scope), US-11 (value at comment time) | 2026-11-10 |

| Field | Value |
|---|---|
| Type | Change |
| Deliverable | software |
| Depth | **Full**: a new module, migrations, a public API, concurrency, and a write to Reporting |
| Approval Mode | gated |
| Jira | P2-3909 (worklist, AC1–AC13) · P2-3910 (assessment, AC1–AC23) |
| Proposal | `proposal.md`, Option A (one spec). It was taken as approved when the back lead ran `/akili-specify` on 2026-11-10 without changes |
| Open-question defaults | Rows marked **[OQ-n default]** carry the proposal's default answer. Each one blocks the tasks built on it until Angel answers or the back lead accepts it by name (KZ-ingestion--step-1-loads-1) |

## 2. Executive Summary

Assessors get a worklist of the step-1 results in their scope. They also get a review page where they validate each Assessed field green or grey, comment (quick comments included), and finish. A result whose core fields are all green becomes **Quality Assessed** and is released to Reporting as `qaed`. Any other finished result becomes **Returned to program** and is released as `not_qaed`. The QA Admin sees everything, read-only. Lock, scope and state rules are keyed by role and step, so Lead, TPB and PPU only add configuration later.

This closes PRD § 5 item 3 (Evaluation) for step 1.

## 3. Glossary

| Term | Meaning |
|---|---|
| Membership | A `timeline_results` row: one result in one timeline in one round (ingestion/timeline-sync FR-5) |
| Reviewer | A user with an active assignment to a timeline under a reviewing role (ASSESSOR in this spec) |
| Step of a role | The timeline step whose `audience` matches the role: ASSESSOR → `assessors`. In the default timeline that is step 1 |
| Assessment | The review of one membership in one step. It is `pending` until it ends as `quality_assessed` or `returned` |
| Validation | The green (validated) or grey (not validated) mark of one Assessed field in one assessment |
| Core field | An Assessed field flagged `isCore` in the effective field configuration |
| Quick comment | A saved comment text, shared by every user of one role |
| QA status | The status word shown to users (FR-5). It is computed, never stored |
| Release | The call that tells Reporting a result left QA (`qaed` or `not_qaed`) |
| Labels | The text Reporting sends for control-list ids, per list (`labels[list][id]`) |
| Clock | `ADMIN_CONFIG_CLOCK`, the only time source. Step moments are Rome wall-clock minutes |

## 4. System Context & Scope

**In scope:** P2-3909 AC1–AC13 for the ASSESSOR and ADMIN views, and P2-3910 AC1–AC21. AC22–AC23 (and P2-3909 AC2, the step-2 part) are covered as state model and worklist predicate only (FR-19). Also in scope:
- the release to Reporting,
- labels in the feed and the snapshot,
- the two ingestion follow-ups that the timeline-sync archive assigned to this spec (§ 9 there).

**Out of scope:** AI suggestion (P2-3918). Lead, TPB and PPU reviews (P2-3912 and later). SP response (P2-3911). Export (P2-3914). Overview (P2-3913). Assigning results to individual reviewers. Editing or deleting quick comments. Chatbot.

**Current behavior**

| # | Today | Evidence |
|---|---|---|
| CB-1 | Memberships carry `status` `pending`, `auto_validated` or `not_in_qa`, and an optional `end_reason` that includes `returned` and `released_qaed` | `server/src/database/drizzle/schema/timeline-results.ts:25-46` |
| CB-2 | `endAsReturned` exists on the loads store and has no caller | `server/src/ingestion/loads.store.ts:300`, `:708`; `server/src/ingestion/AGENTS.md` (*Return and re-entry*) |
| CB-3 | `changed_fields` is stored on round-2 re-entries and is returned by no route | `timeline-results.ts:116`; `ingestion/AGENTS.md` |
| CB-4 | The feed port has `release` (`qaed`, `not_qaed`). Only the KP release after a load calls it | `server/src/ingestion/results-feed.port.ts`; `load-runner.ts:264`, `:606` |
| CB-5 | `effectiveFor(cycleId, timelineId, resultTypeKey)` returns the field configuration that holds for a timeline, or throws `FieldConfigNoVersionError` / `FieldConfigTypeNotInTimelineError` | `server/src/admin-config/field-config/field-config.module.ts:34-49`; `field-config.service.ts:774-799` |
| CB-6 | Scope helpers exist: `coversResultType`, `coversProgram`, `canReview`, `isLiveAssignment`. Nobody builds the visibility predicate for reviewers yet | `server/src/users/effective-scope.ts`; `server/src/users/AGENTS.md`; `server/src/admin-config/AGENTS.md` (*Reserved tables*) |
| CB-7 | `users.nickname` is unique and nullable. `toPublicUser` (id + nickname) is the only way a non-admin endpoint may render another user | `schema/users.ts:52`; `server/src/users/public-user.ts:5` |
| CB-8 | A snapshot holds `values` and a hash of their canonical JSON. There is no `labels` attribute, and the adapter ignores `labels` | `server/src/database/dynamodb/entities/result-snapshot.entity.ts`; `ingestion/load-runner.ts:127-128` |
| CB-9 | The 2026 catalog has no "Theory of Change" section: `toc.planned_result`, `toc.entries`, `toc.program_invested_financial_resources` and `toc.narrative` sit in `contributors_partners` at orders 2–5 | `server/src/admin-config/field-config/fixtures/reporting-qa-catalog-2026.json` (read with a script in this session) |
| CB-10 | Each cycle has at most one official timeline (`kind = 'official'`). Each timeline has at most one step per audience | `schema/timelines.ts:29`; `schema/timeline-steps.ts:61`, `:69` |
| CB-11 | The `results` and `results/:code` pages render mock data | `client/src/app/app.routes.ts` (`results`, `results/:code`); `client/src/app/pages/workspace/results/results.mock.ts:11-17` |

## 5. Stakeholders / Personas

| Role (PRD § 3) | Scope | What they need from this spec |
|---|---|---|
| ASSESSOR | Per result type, plus program scope, plus timeline assignment | Their worklist. Assess while step 1 is open. Read-only otherwise |
| ADMIN (QA coordination) | Global | Every timeline and result, read-only. Release status visible |
| LEAD_ASSESSOR, TPB, PPU | Per their step | Nothing new now. Their rows exist disabled (FR-1). Until their stories land they see an empty worklist |
| PROGRAM (SP) | Per program | Nothing in this spec. Comments are marked visible to them for P2-3911 (FR-15) |
| Reporting Tool | — | Exactly one release per finished result, with the right outcome |

## 6. Functional Requirements

### FR-1: Worklist scope by role and step (3909 AC1, AC2, AC4)

The worklist SHALL list a membership for a user only when one role row applies to it:

- **Reviewer row** (ASSESSOR in this spec). All of these must hold: the user has an active assignment to the membership's timeline under that role; a **live** grant of that role covers the membership's result type and program (exclusions applied); the membership's round is the row's round (ASSESSOR: round 1); and the membership's status is `pending` or `auto_validated`.
- **Admin row.** The user holds `ADMIN_ACCESS`. Every membership of every timeline of the active cycle is listed, except `not_in_qa` ones.

Roles are configured as data. LEAD_ASSESSOR (step 3, round 2), TPB (step 4) and PPU (step 5) are declared and **disabled** until their stories enable them.

#### Scenario: Assessor sees only their scope
- GIVEN assessor A, assigned to timeline T as ASSESSOR, with a live ASSESSOR grant for `policy_change` and program scope {SP01}
- AND T holds round-1 memberships for (`policy_change`, SP01), (`policy_change`, SP02) and (`innovation_use`, SP01)
- WHEN A reads the worklist of T
- THEN only the (`policy_change`, SP01) membership is listed
- BUT it must NOT list a membership of a timeline A is not assigned to, even if the grant covers it
- AND IT MUST drop the membership once the grant is revoked or the assignment removed: a removed assignment is visible on the next request, a revoked grant within the user cache TTL (60 s)

#### Scenario: Revoked grant with a stale assignment
- GIVEN A's assignment to T is active, but A's ASSESSOR grant was revoked
- WHEN A reads the worklist
- THEN nothing of T is listed (the assignment alone grants nothing, `admin-config/AGENTS.md` *Assignments*)

#### Scenario: Admin sees all
- GIVEN an ADMIN with no timeline assignment
- WHEN they read any timeline's worklist
- THEN every `pending` and `auto_validated` membership of it is listed
- BUT it must NOT list `not_in_qa` memberships

#### Scenario: A role with no active row
- GIVEN a user whose only assignment is LEAD_ASSESSOR
- WHEN they read the worklist
- THEN it is empty (200) and says no role of theirs has a worklist yet
- BUT it must NOT answer 403, and must NOT list step-1 results

#### Scenario: Out-of-scope result by URL
- GIVEN assessor A and a membership outside A's scope
- WHEN A opens it by URL
- THEN the answer is 404 `ASSESSMENT_NOT_FOUND`, the same as for a code that does not exist (no existence leak)

### FR-2: Open, read-only and locked by the clock (3909 AC3; 3910 AC20)

A reviewer SHALL be able to write on an assessment only while their role's step of the membership's timeline is open at the clock's current Rome minute, the step-state rule of `admin-config` (open from :00 of the opening minute to :59 of the closing minute). Outside that window the worklist and the assessment view SHALL be read-only: rows still open the view. An ADMIN is always read-only, unless they also hold an active reviewer assignment to that timeline, in which case FR-1's reviewer row applies to them.

#### Scenario: Step 1 not yet open, then closed
- GIVEN step 1 of T opens at 2026-11-12T09:00 Rome and closes at 2026-11-20T17:30 Rome
- WHEN A writes a validation at 08:59 or at 17:31 on 2026-11-20
- THEN the answer is 409 `ASSESSMENT_STEP_CLOSED` and nothing is stored
- AND at 09:00 and at 17:30 the same write succeeds
- AND IT MUST judge the moment with `ADMIN_CONFIG_CLOCK`, never the host clock

#### Scenario: Timeline on hold
- GIVEN step 1 opened but T has no load (status `waiting_for_load`)
- WHEN A reads the worklist
- THEN it is empty, because there are no memberships

### FR-3: Timeline filter and default (3909 AC5)

The worklist SHALL offer a timeline choice listing only the active cycle's timelines the user is assigned to under an enabled reviewer role. For an ADMIN it lists every timeline of the active cycle. The default SHALL be the official timeline when it is among them, otherwise the first one by step-1 opening time. With no timeline, the worklist is empty with an explanatory state.

#### Scenario: Default is official
- GIVEN A is assigned to the official timeline O and the additional timeline B
- WHEN A opens Results with no timeline in the URL
- THEN O is selected and only O and B are offered
- BUT a `?timeline=<id>` the user is not assigned to answers 404 `TIMELINES_NOT_FOUND`, never another timeline's data

### FR-4: Filters and search (3909 AC6, AC8)

The worklist SHALL filter by QA status (several values allowed), Science Program, result type, and a search over result code (exact or prefix) or title (case-insensitive substring). Auto-validated memberships SHALL be excluded unless the status filter names Auto-validated. Filter options SHALL list only values inside the user's scope.

#### Scenario: Auto-validated hidden by default
- GIVEN T holds 10 pending and 3 auto-validated memberships in A's scope
- WHEN A reads with no status filter
- THEN 10 rows are listed and the total says 10
- WHEN A filters by status Auto-validated
- THEN the 3 appear
- AND IT MUST apply the same hiding to the counters (FR-7)

#### Scenario: Search by title
- GIVEN a membership titled "Seed systems for maize"
- WHEN A searches `seed sys`
- THEN it is listed
- AND a search that matches nothing shows the empty-results state, never an error

### FR-5: QA status vocabulary and mapping (3909 AC7)

The system SHALL expose exactly these QA statuses: `pending`, `returned_to_program`, `clarification_requested`, `pending_tpb_review`, `pending_ppu`, `unresolved`, `quality_assessed`, `auto_validated`. Labels: Pending, Returned to program, Clarification requested, Pending for TPB review, Pending PPU, Unresolved, Quality Assessed, Auto-validated. In this spec:

| Membership | Assessment of the role's step | Comment threads | QA status |
|---|---|---|---|
| `auto_validated` | — | — | `auto_validated` |
| `pending` | none, or `pending` | — | `pending` |
| `pending` or ended `returned` | `returned` | any thread in `clarification_requested` | `clarification_requested` |
| `pending` or ended `returned` | `returned` | otherwise | `returned_to_program` |
| any | `quality_assessed` | — | `quality_assessed` |

`pending_tpb_review`, `pending_ppu` and `unresolved` SHALL be accepted as filter values and SHALL NOT be produced by this spec.

#### Scenario: Status after each end
- GIVEN three pending memberships
- WHEN one is auto-QA'd (FR-14), one finished with a grey core field (FR-15), and one left alone
- THEN their statuses read `quality_assessed`, `returned_to_program` and `pending`
- BUT the status must NOT be stored in a column. A test changes the inputs and the status follows

### FR-6: Columns and the "Updated" tag (3909 AC9, AC10)

Each row SHALL show: result code, title, Science Program (code and name), result type (label), Assessors' comments (count of non-withdrawn comments), Comments answered by SP (always 0 until P2-3911), Assessed by (nickname of the finishing user, or none), and QA status.

- **Updated.** The title SHALL carry an "Updated" tag when the membership is a round-2 re-entry whose `changed_fields` is non-empty. Only the boolean is exposed, never the keys.
- **Action Area** SHALL NOT be shown until OQ-3 is answered **[OQ-3 default]**.
- **Export comments** SHALL NOT be shown until P2-3914 **[OQ-4 default]**.

#### Scenario: Updated
- GIVEN a round-2 membership with `changed_fields = ["general.title"]`, and another with `[]`
- WHEN the admin lists them
- THEN only the first shows Updated
- AND a round-1 membership (`changed_fields` NULL) never shows it
- BUT the response must NOT contain the changed keys

#### Scenario: Assessed by with no nickname
- GIVEN the finishing user has no nickname
- THEN Assessed by shows "—", never their name or email

### FR-7: Sort, paging, counters, open (3909 AC11–AC13)

The worklist SHALL sort by any listed column, ascending or descending, with result code as the tiebreaker. It SHALL be paged on the server (25 per page by default, at most 100) with an opaque cursor. Above the table it SHALL show, for the selected timeline and the user's scope: **pending** (QA status `pending`) and **finished** (`quality_assessed`, `returned_to_program`, `clarification_requested`). Counters SHALL follow the same Auto-validated hiding, and they SHALL ignore the other filters. Clicking a row SHALL open the assessment view (FR-8).

#### Scenario: Sort by Science Program
- GIVEN 120 memberships across 5 programs
- WHEN A sorts by Science Program descending and pages through
- THEN every row appears once, in program-name order then code order
- AND IT MUST answer each page with a fixed number of database queries, whatever the page or total (NFR-1)

#### Scenario: Bad cursor
- GIVEN a cursor from another sort or a tampered value
- WHEN it is sent
- THEN the answer is 400 `VALIDATION_FAILED` on `cursor`

### FR-8: Assessment view: structure and header (3910 AC1–AC3)

Opening a membership SHALL return:

- its header: code, title, Science Program, result type, timeline name, the role's step name and position, and QA status;
- its sections and fields in the order of the QA catalog of the cycle's year (section `order`, then field `order`), keeping only those that apply to the result type;
- each field's value from the membership's snapshot, with labels when the snapshot has them (FR-20);
- the effective configuration per field;
- the current validations and comments;
- whether the caller may write (FR-2, FR-16) and why not.

A field in the snapshot but not in the current catalog SHALL be listed at the end under "Other fields", read-only. A catalog field missing from the snapshot SHALL read "Not applicable". The client SHALL provide a section navigator, and one control that collapses the main side menu and the navigator together.

#### Scenario: Structure follows the catalog
- GIVEN a `policy_change` membership and the 2026 catalog
- WHEN A opens it
- THEN sections appear in ascending `order`, with fields ordered within them, and no section without an applicable non-hidden field appears
- AND IT MUST answer 409 `ASSESSMENT_NO_FIELD_CONFIG` when `effectiveFor` resolves to no version, and 503 `SERVICE_UNAVAILABLE` when the catalog cannot be read, never a page with guessed structure

### FR-9: Field configuration and the ToC (3910 AC4–AC7, AC10)

Each field SHALL follow the effective configuration:

- **Hidden:** not returned.
- **View only:** value only, with no validation mark and no comment action.
- **Assessed:** value, validation mark (green or grey), comment action, and a "Core" tag when `isCore`.

The **Theory of Change** group SHALL always be returned complete, with every element of every contribution, whatever its configuration: the `toc.*` fields plus `contributors.science_programs`, shown as a "Theory of Change" section at the catalog position of its first field. A ToC field configured Hidden SHALL be shown as View only **[OQ-7 default]**.

#### Scenario: Hidden ToC
- GIVEN `toc.entries` is configured Hidden for `policy_change`
- WHEN A opens a `policy_change` result with 3 ToC contributions
- THEN `toc.entries` is shown read-only with all 3 contributions
- BUT another Hidden field must NOT appear in the response at all, not just be hidden by the client

### FR-10: Validate, undo, check all (3910 AC6, AC8, AC9)

On an Assessed field a reviewer with write rights (FR-2) SHALL be able to set it green or set it back to grey. "Check all" SHALL set every Assessed field green, and "Uncheck all" every Assessed field grey, in one request each. Setting a field to the state it already has SHALL succeed and change nothing.

#### Scenario: Check all skips other fields
- GIVEN 12 Assessed, 5 View only and 0 Hidden fields
- WHEN A runs Check all
- THEN exactly the 12 Assessed fields are green
- BUT a validation request naming a View only, Hidden or unknown field must answer 400 `VALIDATION_FAILED` naming the field

### FR-11: Comments (3910 AC11, AC12, AC14)

A reviewer with write rights SHALL be able to add a comment of 1–2,000 characters (trimmed) to an Assessed field. The comment SHALL record:

- the author (rendered by nickname only);
- the time;
- the step position and round;
- a copy of the field's value, and of its labels when present, as the membership's snapshot holds it at writing.

The client SHALL let the reviewer pick a quick comment, which fills the editor so they can change it before saving. Adding a comment SHALL be safe to retry with the same idempotency key.

#### Scenario: Value at the time of writing
- GIVEN `general.title` holds "Old title" in the membership's snapshot
- WHEN A comments on it, and a later re-sync brings a round-2 membership with "New title"
- THEN A's comment still shows "Old title"
- AND IT MUST show its labels when the snapshot had them, and ids otherwise

#### Scenario: Comment on a non-assessed field
- WHEN A comments on a View only field
- THEN 400 `VALIDATION_FAILED` on `fieldKey`

### FR-12: Quick comments shared by role (3910 AC13)

A reviewer SHALL be able to save any comment text as a quick comment of their role. Every user of that role SHALL see it in the role's list, newest first. Saving the same text twice (after trimming, case-sensitive) SHALL keep one entry and return it.

#### Scenario: Shared by role
- GIVEN assessor A saves "Please add the evidence link"
- WHEN assessor B opens the quick comment list
- THEN B sees it
- BUT a TPB user must NOT see it in the ASSESSOR list

### FR-13: Withdraw own comment (3910 AC15)

The author SHALL be able to withdraw their own comment while it has no SP answer and while step 1 or step 2 of the timeline is open **[OQ-8 default]**. A withdrawn comment SHALL disappear from the counts and from the SP's future view. It SHALL be kept in the audit and the comment events.

#### Scenario: Not someone else's comment
- WHEN B tries to withdraw A's comment
- THEN 403 `ASSESSMENT_NOT_COMMENT_AUTHOR`
- AND a second withdraw by A answers 409 `ASSESSMENT_COMMENT_NOT_OPEN`

### FR-14: Automatic Quality Assessed (3910 AC16, AC19)

When a validation write leaves every core field of the assessment green, the assessment SHALL become `quality_assessed` in the same transaction, with "Assessed by" = the user whose write did it. Comments on non-core fields SHALL stay, and SHALL be marked visible to the program (AC18). An assessment whose configuration has no core field SHALL NOT end automatically: Finish ends it as `quality_assessed` **[OQ-2 default]**.

#### Scenario: Last core goes green
- GIVEN 3 core fields, 2 green, and a comment on a non-core field
- WHEN A sets the third core field green
- THEN the response says the assessment ended `quality_assessed`, Assessed by A
- AND the release `qaed` is queued (FR-18)
- AND the non-core comment is visible to the program

### FR-15: Finish assessment → Returned to program (3910 AC17–AC19)

"Finish assessment" SHALL be offered while the assessment is `pending` and the caller has write rights.

- If any core field is grey, every grey core field must carry a non-withdrawn comment **[OQ-9 default]**, else 409 `ASSESSMENT_CORE_UNCOMMENTED` with the field keys. With that met, the assessment SHALL become `returned`, with Assessed by = the caller.
- If no core field is grey, FR-14 applies.

On finish, every non-withdrawn comment SHALL become visible to the program from step 2.

#### Scenario: Return
- GIVEN core field `general.title` is grey and commented
- WHEN A finishes
- THEN status `returned_to_program`, Assessed by A, and the release `not_qaed` is queued
- AND until then the status was `pending`

### FR-16: Locked after the end (3910 AC20)

Once an assessment is `quality_assessed` or `returned`, no validation, comment or finish SHALL be accepted on it (409 `ASSESSMENT_FINISHED`). Withdraws follow FR-13. When the step closes, every write on every assessment of that step SHALL be refused (FR-2), whatever the state.

### FR-17: Several assessors, one end (3910 AC21)

Every reviewer whose scope covers a membership SHALL work on the **same** assessment: they see each other's validations and comments. Exactly one end (automatic or finish) SHALL succeed. Every concurrent or later write SHALL get 409 `ASSESSMENT_FINISHED`, and their next read SHALL show the end and who did it.

#### Scenario: Five concurrent finishes
- GIVEN five assessors finishing the same pending assessment at once
- THEN one gets 200 and four get 409 `ASSESSMENT_FINISHED`
- AND there is one end audit row and one queued release
- BUT a validation that commits before the finish is kept, and one arriving after it is refused

### FR-18: Release to Reporting (brief; 3910 AC16, AC17)

Each end SHALL produce exactly one release of the membership's result:

| End | Release | Membership afterwards |
|---|---|---|
| `quality_assessed` | `qaed` | ended `released_qaed` |
| `returned` | `not_qaed` | ended `returned` (through the existing `endAsReturned`) |

The release SHALL be sent right after the end commits **[OQ-1 default]**. A `not_in_qa` answer SHALL count as released, because Reporting answers it to a repeated release (contract *Idempotency and failure*). The result is already out of QA, so the membership is ended and the reason recorded. `not_found`, `other_phase` and `not_submitted` SHALL be recorded as refused. A failure (5xx, timeout, network) SHALL be retried until Reporting acknowledges it, and SHALL NOT undo the end. The admin SHALL be able to see which releases are pending or refused, and to retry them.

#### Scenario: Reporting down
- GIVEN Reporting answers 503
- WHEN A finishes
- THEN A gets 200 and the status reads `returned_to_program`
- AND the release stays pending and is sent on the next retry
- AND the membership is ended only once the release is acknowledged
- AND IT MUST NOT send two releases for one end, even under concurrent retries

### FR-19: Clarification states (3910 AC22–AC23; 3909 AC2, step-2 part)

Each comment SHALL carry a thread state from the TRD § 7.3 machine. The transitions written by this spec are `open` and `withdrawn`. `clarification_requested` (by the SP) and the assessor's answer back to `open` SHALL be defined in the transition table, but **no route of this spec writes them**. The answer action moves to P2-3911 **[OQ-5 default]**.

The worklist predicate SHALL already include, during step 2, a membership where a comment written by the user is `clarification_requested`, so P2-3911 only adds the writer.

#### Scenario: Predicate ready
- GIVEN a test that sets one of A's comments to `clarification_requested` through the store, and step 2 is open
- WHEN A reads the worklist
- THEN the membership is listed with status `clarification_requested`, read-only in this spec

### FR-20: Labels from Reporting (brief)

The details adapter SHALL accept an optional `results[].labels` object (`{ "<control_list>": { "<id>": "<label>" | null } }`). When present, the labels SHALL be stored with the snapshot **outside** the snapshot hash. When absent or malformed, the snapshot SHALL be stored with no labels, the load SHALL NOT fail, and the view SHALL show ids. A `null` label (a deleted row) SHALL show the id.

#### Scenario: Rename is not an update
- GIVEN a result first synced with `labels.countries["170"] = "Colombia"`
- WHEN it re-enters with the same values and label "Republic of Colombia"
- THEN `changed_fields` is `[]` and the result is not "Updated"
- AND IT MUST keep one snapshot hash for equal values, whatever the labels

### FR-21: Audit (repo rule)

Every applied validation change, check all, uncheck all, comment add, comment withdraw, quick-comment save, end, and release outcome SHALL write one append-only audit row. A row holds the actor id, assessment id, action, field keys where relevant, request id and time. It SHALL NOT hold a comment body, a value, or a name. Refused or no-op requests SHALL write none.

### FR-22: Authorization and privacy

- Every route SHALL require authentication. Write routes SHALL additionally require FR-1's reviewer row and FR-2's open step.
- Another user SHALL only be rendered as id and nickname.
- A log line SHALL never contain a title, value, label, comment body, nickname, name or email.

### FR-23: Client states (3909, 3910 UI)

Results and Result review SHALL use the API (not mocks) and show:
- **loading:** a skeleton;
- **empty:** no timeline assigned, no results, or no match;
- **error:** a retry action and the catalog error message;
- **read-only:** a banner saying why ("Step 1 closed on …", "Finished by …", "View only for admins").

They SHALL work from 360 px to desktop: the table scrolls horizontally inside its card, and the navigator becomes a drawer on small screens. They SHALL meet WCAG AA: a visible focus ring, a keyboard path through fields, and green/grey marks that also differ by icon and accessible name, not by color alone.

### FR-24: Ingestion follow-ups (timeline-sync archive § 9)

- The load SHALL store each membership's title (the `general.title` value) in a searchable form. Memberships loaded earlier SHALL get their title without manual SQL.
- `returnedNotResubmitted` SHALL be counted inside the load's end transaction, now that `endAsReturned` has a caller.

### FR-25: Documents

The spec SHALL leave:
- a `front-contract.md`: routes, shapes, status words, and error codes;
- a module guide `server/src/assessment/AGENTS.md`;
- the new error codes in the catalog;
- pending items for `AGENTS.md` (the `assessment` domain row), `docs/ux-ui/design.md` § 7 (vocabulary), TRD § 5.1 / § 7.3, and `ingestion/AGENTS.md` (the `changed_fields` rule). Each item is applied on `staging` or by its owner, following the shared-file discipline.

## 7. Non-Functional Requirements

| ID | Attribute | Scenario (source → stimulus → response) | Measure | TRD ref |
|---|---|---|---|---|
| NFR-1 | Performance | Assessor → worklist page over 1,000 memberships → page returned | ≤ 8 SQL statements per page whatever the size, pinned by a counting fake. p95 ≤ 500 ms on TEST with 1,000 rows | § 3 (new) |
| NFR-2 | Performance | Open a result → view returned | 1 snapshot GetItem, catalog from cache, ≤ 8 SQL statements. p95 ≤ 800 ms on TEST | § 3 (new) |
| NFR-3 | Integrity | Concurrent ends, double-clicked comments, concurrent release retries → invariants hold | Unique keys and conditional updates. A lost race is a typed 409 or a no-op, never a duplicate row or a second release | ADR-002, admin-config NFR-6 style |
| NFR-4 | Correctness of time | Any write → open/closed judged | Clock read once per request, Rome minute, `ADMIN_CONFIG_CLOCK` only. `new Date()` absent from `server/src/assessment` (grep) | admin-config NFR-4 |
| NFR-5 | Privacy | Every new route under a log spy | 0 log lines with a title, value, label, body, nickname, name or email | ingestion NFR-7 |
| NFR-6 | Resilience | Reporting down at end time → user unaffected | The end answers within 1 s without waiting on Reporting. The release is retried with backoff; pending count visible | § 7.4 (retry until acknowledged) |
| NFR-7 | Size | A comment's value copy | ≤ 64 KB stored per comment. Larger values are stored truncated with a flag, and the snapshot stays the full source | new |
| NFR-8 | Accessibility | Results and Review screens | Component tests assert the accessible name and role of every validation mark, comment action, sort header and navigator item, plus a keyboard-only path through one review. The client has no axe (`grep -rn "axe" client/src --include=*.spec.ts` → 0; `grep -c axe client/package.json` → 0) and adding it is a dependency change outside this spec. Contrast and focus order are checked by hand at the UI HITL pause | § 12 |

### Defect classes and their gates

| Defect class this spec can produce | Gate (command or check) | Substitute / accepted risk |
|---|---|---|
| Scope leak (out-of-scope membership listed or opened) | Unit tests over a role × scope × assignment matrix, plus e2e 404 by URL | — |
| Wrong status mapping | Table test over FR-5 | — |
| Clock boundary (:00 / :59, DST) | Unit tests with a pinned clock at both boundaries | — |
| Race: double end, double release, double comment | Concurrency tests over the unit of work, with interleavings forced through deferred stores | Real MySQL behavior: a HITL run of 5 parallel finishes on dev (no disposable MySQL, `server/AGENTS.md`) |
| Key mismatch between writer and reader (snapshot sk, labels attribute) | Tests that read keys produced by the real writer (KZ-ingestion--timeline-sync-1) | DynamoDB Local suite when `DYNAMODB_ENDPOINT` is set |
| Labels change the hash | Unit test: same values, different labels → same hash | — |
| Type error in a contract (DTO, port) | `pnpm build` (stricter than Vitest) | — |
| Migration / generated-SQL defect | `schema.spec.ts` assertions over generated SQL | Applying the migration on dev is a human step |
| PII in logs | Privacy e2e log spy | — |
| Worklist query count growth | Counting fake pins the count | Real latency: measured on TEST at HITL |
| Front renders the wrong state / no state | `ng test` component tests per state | — |
| Layout (table overflow, navigator collapse, 360 px) | No automated geometry gate in the repo | **Substitute:** T6 visual check against the mockup at the UI HITL pause, at 360 px, 768 px and 1440 px |
| Color-only meaning (green/grey) | Accessible name and icon asserted in component tests | Contrast and focus: no automated checker in the client (NFR-8). A manual check at the UI HITL pause |

## 8. Requirement ID Index

| ID | Title | Scenarios | Owning task(s) |
|---|---|---|---|
| FR-1 | Worklist scope by role and step | 5 | see `tasks.md` § Coverage (by scenario and clause) |
| FR-2 | Open, read-only and locked by the clock | 2 | |
| FR-3 | Timeline filter and default | 1 | |
| FR-4 | Filters and search | 2 | |
| FR-5 | QA status vocabulary and mapping | 1 | |
| FR-6 | Columns and "Updated" | 2 | |
| FR-7 | Sort, paging, counters, open | 2 | |
| FR-8 | Assessment view: structure and header | 1 | |
| FR-9 | Field configuration and ToC | 1 | |
| FR-10 | Validate, undo, check all | 1 | |
| FR-11 | Comments | 2 | |
| FR-12 | Quick comments | 1 | |
| FR-13 | Withdraw | 1 | |
| FR-14 | Automatic Quality Assessed | 1 | |
| FR-15 | Finish → Returned | 1 | |
| FR-16 | Locked after the end | — | |
| FR-17 | Several assessors, one end | 1 | |
| FR-18 | Release to Reporting | 1 | |
| FR-19 | Clarification states | 1 | |
| FR-20 | Labels | 1 | |
| FR-21 | Audit | — | |
| FR-22 | Authorization and privacy | — | |
| FR-23 | Client states | — | |
| FR-24 | Ingestion follow-ups | — | |
| FR-25 | Documents | — | |
| NFR-1…NFR-8 | See § 7 | — | |
