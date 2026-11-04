# Step-1 loads — Requirements

## 1. Document Control

| | |
|---|---|
| Spec path | `docs/specs/ingestion/step-1-loads` |
| Type | Change |
| Deliverable | software |
| Depth | **Full**. It adds a migration, writes to an external system (Reporting intake), adds the repo's first DynamoDB entity, and changes a rule shared with timeline-edit |
| Approval Mode | gated |
| Status | Draft |
| Source | `proposal.md` revision 2 (2026-11-04). Jira P2-3905 (14 AC). Reporting contract `qa-catalog.en.md` v1.29, § *Results feed* and § *Intake and release* |
| BA confirmation | Pending (Angel). S-4, S-5, S-8 and S-9 are business choices taken at their proposed defaults; an overrule reopens this spec |
| Builds on | *timelines* = `docs/specs/archive/2026-10-21-admin-config--cycle-timelines/`; *edit* = `docs/specs/admin-config/timeline-edit/`; *times* = `docs/specs/archive/2026-10-27-admin-config--timeline-step-times/`; *fields* = `docs/specs/archive/2026-10-27-admin-config--field-configuration/` |
| PRD stories | US-4 (corrected by this spec: manual load per step) |
| Scope | Server (`server/`). The front adapts through `front-contract.md` |
| Last updated | 2026-11-04 |

**Decisions:**

| # | Decision | From | Status |
|---|---|---|---|
| S-1 | The snapshot lives in DynamoDB; loads and memberships in MySQL | Q6 | Back lead, 2026-11-04 |
| S-2 | A result is identified by `result_code`; `result_id` is stored and used for feed calls | Brief § 2 | Back lead |
| S-3 | Intake in Reporting comes before details | Brief § 4 | Back lead; answers Q4 and Q8 |
| S-4 | An active membership ends at the **first** of: QA releases the result in that timeline, or the timeline's last step closes (Rome minute). In this spec only the second can happen, since release in the QA flow is another spec | Q10, default | **Angel to confirm** |
| S-5 | A result whose membership in a timeline ended does **not** re-enter that same timeline; it may enter a later one | Q11, default | **Angel to confirm** |
| S-6 | A timeline "has a load" when it has at least one membership (active or ended) or at least one `completed` load | Q5, default | Back lead to confirm at the requirements gate |
| S-7 | KPs are classified with the 2025 rule into three groups; every group is intaken | Brief § 5; proposal § 12.1 | Back lead; Q7 open for 2026 |
| S-8 | Releasing "not in QA" and auto-checked KPs as `qaed` exists but is **off** | Q9, default | **Angel to confirm** |
| S-9 | A KP waiting for step 3 has status `pending` and a separate `awaits_step: 3` marker | Q2, default | **Angel to confirm** |
| S-10 | Which feed keys the snapshot keeps (person-bearing keys in or out) | Q3 | **Open. Blocks the snapshot item in design** |

## 2. Executive Summary

Today no result reaches QA: every timeline whose step 1 has opened waits for a load that cannot happen (*edit* FR-6).

With this spec, the **ADMIN** loads step 1 of a timeline by hand, as often as needed while step 1 is open:
1. a preview shows what would come in;
2. the load runs in the background with progress;
3. a summary shows the outcome.

Each loaded result is marked In QA in Reporting, gets an immutable snapshot, and becomes an **active member** of that timeline. A result is never active in two timelines of one cycle, but it can come back in a later one, with a new snapshot. PRD problem P1, metric M1.

## 3. Glossary

| Term | Meaning |
|---|---|
| Feed | Reporting's `GET /api/qa/results` (list) and `POST /api/qa/results/details` (values) |
| Intake / release | Reporting's `POST /api/qa/results/intake` (marks a result In QA, blocks its unsubmit) and `POST /api/qa/results/release` (ends QA: `qaed` or `not_qaed`) |
| `result_code` | The public code of a result. It stays the same across phases |
| `result_id` | Reporting's id of a result in one phase. It changes per phase; the feed calls use it |
| Load | One run that brings results into step 1 of one timeline. States: `running`, `completed`, `failed` |
| Lot | Up to 50 results processed together inside a load |
| Membership | A result's presence in a timeline. **Active** from its load until it ends (S-4); then **ended**, and kept |
| Snapshot | The values the feed returned for one result in one load. Never changed after it is written |
| Skip | A result the load did not bring in, with a reason |
| KP groups | *Not in QA*, *auto-checked*, *review* (proposal § 12.1) |
| Load window | From timeline creation until step 1's closing minute (Rome), while the cycle is not closed |
| Timeline, step, scope, hold, Rome minute, version, audit record | As in *timelines* § 3, *edit* § 3 and *times* § 3 |

## 4. System Context & Scope

**In scope:**
- the preview, the start, the run and the reads of a load;
- the membership rule, enforced in the database;
- intake in Reporting; the snapshot in DynamoDB;
- KP classification;
- the real "has a load" source, judged under the timeline lock;
- audit and logs;
- OpenAPI, the module guide, `front-contract.md`, and the PRD US-4 and `docs/infrastructure.md` corrections.

**Out of scope:**
- step-3 loads (P2-3906);
- release in the normal QA flow;
- the evolution screen (P2-3909);
- migrating the old QA's history (2025 and earlier);
- automatic or scheduled loads;
- validating values against the catalog beyond `catalog_version`;
- e-mail alerts; the front.

**Current behavior** (evidence at `feat/step-1-loads` @ `7163227`, unless noted):

| # | Today | Evidence |
|---|---|---|
| C1 | "Has a load" is always false | `server/src/admin-config/timelines/timeline-loads.ts:23` (`NoTimelineLoads`) |
| C2 | A timeline whose step 1 opened is `waiting_for_load`, and readiness lists `NO_RESULTS_LOADED` | `timeline-view.ts:107`; *edit* FR-6 |
| C3 | The edit reads "has a load" before its transaction | `timelines.service.ts:472` |
| C4 | No `timeline_loads` / `timeline_results` table exists; latest migration `0006` | `ls server/drizzle/*.sql` |
| C5 | Timeline scope stores CLARISA program ids and catalog result-type keys, the same vocabulary as the feed filters | `database/drizzle/schema/timeline-programs.ts:6`; `timeline-result-types.ts`; contract § `GET /api/qa/results` |
| C6 | Cycles are `draft`, `active` or `closed`, one per `year` | `database/drizzle/schema/cycles.ts:15,33,56` |
| C7 | QA calls Reporting only with GET; the key is `CLARISA_API_KEY` | `users/catalogs/catalog-http.ts:25`; `config/catalogs.config.ts:12` |
| C8 | No DynamoDB entity exists; `electrodb` is a dependency | `database/dynamodb/`; `server/package.json:43` |
| C9 | The feed is on Reporting `staging`; intake and release only on `performance-refactor` | `onecgiar_pr`: `git ls-tree origin/<branch> -- onecgiar-pr-server/src/api/qa-catalog/dto`, 2026-11-04 |
| C10 | Reporting requires a CLARISA grant per route on all five `/api/qa/*` routes | Contract change log v1.29. Grants held by the QA key: `UNVERIFIED — confirm at source before relying on it` |

## 5. Stakeholders / Personas

| Role (PRD § 3) | Scope | What they need from this spec |
|---|---|---|
| ADMIN (QA Admin) | Global | Load step 1 without the tech team; see what comes in, how far the run is, and what was skipped and why |
| Assessors, Lead Assessor | Assigned timelines | Results exist in the timeline (what they see: P2-3909) |
| Programs (Reporting users) | Their results | Know that a result under QA cannot be unsubmitted (Reporting shows it) |
| Front (Yeck) | — | A stable contract: endpoints, states, codes |
| Later specs (P2-3906, P2-3909, release) | — | Memberships, snapshots and the feed port to build on |

## 6. Functional Requirements

### FR-1: Preview a step-1 load

The system SHALL let an ADMIN preview a step-1 load of a timeline without writing anything in QA or Reporting. The preview reads **every** page of the feed list for `phase_year = cycle.year`, filtered by the timeline's scope. It answers:
- the count to load, by program and by result type;
- the KP groups (FR-7);
- the skips, by reason: `ACTIVE_IN_OTHER_TIMELINE`, naming each other timeline with its count, and `ALREADY_IN_THIS_TIMELINE`.

#### Scenario: Preview counts
- GIVEN timeline T of the 2026 cycle has scope {SP05, SP07} × {policy_change, knowledge_product}
- AND the feed lists 120 eligible results for that scope, over 1 page of 200
- AND 10 of them are active in timeline U of the same cycle
- WHEN the ADMIN asks for the preview
- THEN it shows 110 to load, by program and type, and 10 skipped `ACTIVE_IN_OTHER_TIMELINE` (U: 10)
- AND the KPs among the 110 are split into the three groups
- BUT it must NOT call intake or release, nor write any row or snapshot
- AND IT MUST read every page until it has read `total` results

#### Scenario: Scope "all"
- GIVEN the timeline's scope is all programs and all types
- WHEN the ADMIN asks for the preview
- THEN the feed is called with no program and no type filter

#### Scenario: Nothing eligible
- GIVEN the feed answers `total: 0`
- WHEN the ADMIN asks for the preview
- THEN it answers 0 to load and no skips, with 200

### FR-2: Start a load

The system SHALL let an ADMIN start a step-1 load of a timeline. It records the load as `running` and answers at once, with the load id. The run continues in the background (FR-3).

| Refusal | Code | Status |
|---|---|---|
| Timeline does not exist | `TIMELINES_NOT_FOUND` | 404 |
| The cycle is closed | `CYCLES_CLOSED` | 409 |
| Now (Rome minute) is after step 1's closing minute | `LOADS_WINDOW_CLOSED` | 409 |
| Another load of the **same cycle** is `running` (and its lease is alive, FR-9) | `LOADS_ALREADY_RUNNING` | 409 |
| Reporting is unreachable at start | `SERVICE_UNAVAILABLE` | 503 |

#### Scenario: Start
- GIVEN step 1 of T closes on 2026-11-20T17:30 Rome and now is 2026-11-10T09:00
- AND no load of the cycle is running
- WHEN the ADMIN starts a load of T
- THEN the answer is 202 with the load id and status `running`
- AND the timeline's version goes up by one

#### Scenario: Window closed
- GIVEN now is 2026-11-20T17:31 Rome, one minute after step 1 closes
- WHEN the ADMIN starts a load
- THEN the answer is 409 `LOADS_WINDOW_CLOSED`
- BUT it must NOT create a load row
- AND IT MUST accept the same request at 17:30 (the closing minute is included, *times* S-2)

#### Scenario: One running load per cycle
- GIVEN a load of timeline U (same cycle as T) is running
- WHEN the ADMIN starts a load of T, or two starts for T arrive at the same moment
- THEN exactly one load is `running` and the others get 409 `LOADS_ALREADY_RUNNING`
- AND IT MUST hold under concurrent requests, enforced by the database and not only by a read before the write

#### Scenario: Safe retry
- GIVEN a start request with an `Idempotency-Key`
- WHEN it is sent twice
- THEN both answers carry the same load id, and only one load exists

### FR-3: The run

For each lot of up to 50 results, in feed order, the run SHALL:
1. skip the results with an active membership in another timeline of the cycle, and those already members of this timeline;
2. intake the rest in Reporting, and continue only with `taken` (a `changed: false` is a normal success);
3. read their details;
4. write one snapshot per result;
5. record the memberships;
6. advance `processed`.

Each `not_taken` result is a skip with Reporting's reason as given (`not_found`, `not_submitted`, `other_phase`, `not_w1w2`, `type_not_catalogued`, `no_lead_program`); so is each `not_eligible` result of details. When every lot is done, the load is `completed`.

#### Scenario: A lot
- GIVEN a lot of 50 where 2 are active in timeline U, intake refuses 1 as `not_submitted`, and details returns the other 47
- WHEN the lot runs
- THEN 47 memberships and 47 snapshots exist, 2 skips `ACTIVE_IN_OTHER_TIMELINE` (U) and 1 skip `not_submitted`
- AND `processed` goes up by 50
- BUT it must NOT call details for the 2 skipped or the 1 refused
- AND IT MUST call intake before details for the same results

#### Scenario: Re-run
- GIVEN load L1 of T completed with 47 members
- AND the feed now lists 5 more results for T's scope
- WHEN the ADMIN starts load L2 of T
- THEN only the 5 new results are taken in; the 47 are skipped `ALREADY_IN_THIS_TIMELINE`
- AND no membership or snapshot is duplicated

#### Scenario: The scope is read at start
- GIVEN a load is running
- WHEN the run reads the feed
- THEN it uses the scope and `phase_year` read when the load started

### FR-4: Membership rule

A result (`result_code`) SHALL have **at most one active membership per cycle**, enforced by the database. A result MAY have several memberships in one cycle over time, each in a different timeline (*timelines* D-2, made concrete: "at once" means an active membership). Nothing moves between timelines (*timelines* D-6).

| Event | Effect |
|---|---|
| A load takes the result in | Active membership in that timeline |
| The timeline's last step closes (Rome minute) | The membership ends (S-4). It is checked when a later load meets the result; no job runs |
| QA releases the result in that timeline | The membership ends (S-4); the release flow is another spec, so this spec only provides the end |
| Ended | Kept with its end reason and time, never deleted |

#### Scenario: Collision
- GIVEN result 5120 is active in timeline U of cycle 2026
- WHEN a load of timeline T (cycle 2026) meets 5120
- THEN 5120 is skipped `ACTIVE_IN_OTHER_TIMELINE` and the summary names U
- BUT it must NOT fail the lot
- AND IT MUST hold when two loads of different cycles' timelines meet 5120: each cycle has its own active membership

#### Scenario: Later timeline after U closed
- GIVEN 5120's membership in U is active and U's last step closed yesterday
- WHEN a load of T meets 5120
- THEN U's membership ends (reason `timeline_closed`) and 5120 becomes an active member of T, with a new snapshot

#### Scenario: Same timeline after the end (S-5)
- GIVEN 5120's membership in T ended
- WHEN a later load of T meets 5120
- THEN 5120 is skipped `ALREADY_IN_THIS_TIMELINE`

#### Scenario: Race
- GIVEN two loads try to make 5120 active in the same cycle at the same moment
- THEN exactly one succeeds; the other records a skip
- AND IT MUST be enforced by a unique index, not by a read before the write

### FR-5: Identity across phases

Each membership SHALL store `result_code`, `result_id`, the lead program, the result type and `phase_year`. Uniqueness is by `result_code` (FR-4), unless P-1 is refuted at specify: in that case uniqueness is by `result_id`, and history still groups by `result_code`.

#### Scenario: Two phases
- GIVEN result code 5120 had `result_id` 800 in 2026 and 900 in 2027
- WHEN both years are loaded into their cycles
- THEN both memberships carry `result_code` 5120 with their own `result_id`

### FR-6: Snapshot

Each membership SHALL have exactly one snapshot, written before the membership is recorded. A snapshot holds:
- the feed values of the result, limited to the keys S-10 allows;
- `result_id`, `result_type_key`, the lead program, `catalog_version`, a hash of the values, and the load time.

It is never changed after it is written. The history of one `result_code` (every snapshot, across years, cycles and timelines) SHALL be readable with one query.

#### Scenario: Retry of a lot
- GIVEN a lot wrote its snapshots and failed before recording the memberships
- WHEN the lot is retried in the same load
- THEN the same snapshot items are written again (same keys, same content), and no second item per result exists

#### Scenario: Orphan
- GIVEN a snapshot exists with no membership pointing to it
- THEN no QA read treats it as loaded, and a later load writes its own

#### Scenario: History
- GIVEN 5120 was loaded in T1 (2026), T3 (2026) and T7 (2027)
- WHEN the history of 5120 is read
- THEN three snapshots come back, in order of year, cycle, timeline and load

### FR-7: KP groups

Every knowledge product taken in SHALL be classified with the 2025 rule (proposal § 12.1), behind its own rule source:

| Group | Condition | Membership status |
|---|---|---|
| Not in QA | Not MELIA **and** type ≠ `Journal Article` | `not_in_qa`; not reviewed |
| Auto-checked | `Journal Article` **and** CGSpace year = WoS year **and** ISI = 1 in both **and** peer reviewed = 1 in both **and** accessibility equal in both (a MELIA journal article that meets it too) | `auto_validated` |
| Review | Any other KP | `pending`, marked `awaits_step: 3` (S-9) |

Every group is intaken and gets a snapshot.

#### Scenario: Auto-checked
- GIVEN a journal article with years 2025/2025, ISI 1/1, peer reviewed 1/1, accessibility "Open Access"/"open access "
- THEN it is `auto_validated`

#### Scenario: A null fails the check
- GIVEN a journal article whose WoS year is null
- THEN it is `pending` (review)

#### Scenario: Non-KP
- GIVEN a policy change
- THEN its status is `pending` and it carries no `awaits_step` marker

### FR-8: Errors

| Failure | Behavior |
|---|---|
| Feed, intake or details answer 5xx, or time out | Retry with backoff, a bounded number of times; then the load is `failed` |
| Any 4xx (401 included) | The load is `failed` at once |
| `catalog_version` of details differs from QA's catalog copy | Force one catalog reload; if it still differs, the load is `failed` |
| DynamoDB or MySQL write fails | Retry the lot as for a 5xx; then `failed` |

A failed load keeps what earlier lots recorded, and states its failure reason without secrets. A re-run picks up the rest (FR-3, re-run).

#### Scenario: 401
- GIVEN the QA key lacks the intake grant
- WHEN the first lot calls intake and gets 401
- THEN the load is `failed` with reason `REPORTING_UNAUTHORIZED` and no retry
- BUT it must NOT log or store the key

#### Scenario: Taken but failed later (R-12)
- GIVEN intake took 50 results and details then failed past its retries
- THEN the load is `failed` and the 50 stay In QA in Reporting
- AND a re-run takes them again (`changed: false`) and completes them

### FR-9: Lease

A running load SHALL renew a heartbeat at least once per lot and at least once a minute. A load whose heartbeat is older than the lease (proposed 5 minutes; fixed in design) SHALL read as `failed` (reason `ABANDONED`), and SHALL NOT block a new start.

#### Scenario: Restart
- GIVEN the API restarted during a load and the heartbeat is 6 minutes old
- WHEN the ADMIN reads the load, or starts a new one
- THEN the old load reads `failed` / `ABANDONED`, and the new start is accepted

### FR-10: Read loads

The system SHALL let an ADMIN list the loads of a timeline and read one load: status, `processed`, `total`, start and end, who started it, and the summary (loaded by program and type, KP groups, skips by reason with the other timelines named, failure reason).

#### Scenario: Progress
- GIVEN a load is running with 275 of 1,200 processed
- WHEN the ADMIN reads it
- THEN it answers `running`, `processed: 275`, `total: 1200`

### FR-11: "Has a load" and the timeline edit

The "has a load" source of *edit* (FR-4, FR-6) SHALL answer from real data, by S-6. The edit SHALL judge "has a load" under the timeline lock. A `running` load SHALL count as a load for the scope lock.

#### Scenario: Hold ends
- GIVEN T is `waiting_for_load`
- WHEN a load of T completes with at least one member
- THEN T is no longer on hold, and its scope is locked

#### Scenario: Edit during a load
- GIVEN a load of T is running and no membership exists yet
- WHEN the ADMIN changes T's scope
- THEN the edit is refused as a scope lock (*edit* FR-4)

#### Scenario: Load and edit race
- GIVEN an edit of T's scope and a load start of T arrive together
- THEN either the edit wins and the load starts with the new scope, or the load wins and the edit is refused (stale version or scope lock)
- BUT it must NOT happen that the edit changes the scope after the load read it

#### Scenario: Completed with zero
- GIVEN a load of T completes with 0 members
- THEN T has a load (S-6)

### FR-12: Audit and log

Each load start and each load end SHALL write one `timeline_audit_events` row: actor (start only), timeline, step, load id, and at the end the counts and the failure reason. Each request writes one `admin_config` log line with no PII.

### FR-13: Access

Every route of this spec SHALL require `ADMIN_ACCESS`. Any other role gets 403 `AUTH_PERMISSION_DENIED` and nothing is read from Reporting.

### FR-14: Release port off by default (S-8)

The system SHALL be able to release a batch of results as `qaed` or `not_qaed` through the feed port. In this spec nothing calls it unless the KP release setting is on, and it is **off**.

#### Scenario: Off
- GIVEN the setting is off
- WHEN a load completes with auto-checked KPs
- THEN no release call is made

### FR-15: Documents

The spec SHALL deliver:
- OpenAPI for every route, with its codes;
- `front-contract.md`;
- the `server/src/ingestion/AGENTS.md` module guide;
- PRD US-4 corrected to a manual load per timeline step;
- `docs/infrastructure.md` corrected with the DynamoDB table state verified at P-3;
- the TRD changes as a pending item (shared-file discipline).

## 7. Non-Functional Requirements

| ID | Attribute | Scenario (source → stimulus → response) | Measure | TRD ref |
|---|---|---|---|---|
| NFR-1 | Security | Any log line, error body, audit row or stored field → is inspected → holds no API key | 0 hits for the key value in a log spy over every route, a forced 5xx and a 401 | QAS security; KZ-admin-config--cycle-timelines-3 |
| NFR-2 | Privacy | Log lines of this module → hold no person data (names, emails) | Log spy test | admin-config NFR-7 |
| NFR-3 | Responsiveness | ADMIN starts a load → answer | ≤ 2 s at the server, excluding Reporting's start check | — |
| NFR-4 | Bounded calls | Every Reporting call | Timeout ≤ 10 s per call (as `catalog-http.ts`); response size bounded; page size 200; lot size 50 | — |
| NFR-5 | Throughput | A load of 1,200 results on dev | Measured and recorded (no target; PRD OQ-6) | M2 |
| NFR-6 | Integrity | Concurrency on membership and running load | Unique indexes in the migration; no code-only guard | — |
| NFR-7 | Snapshot size | Largest snapshot item of a real lot | Below 400 KB with a margin set in design (P-2) | — |

### Defect classes and their gates

| Defect class this spec can produce | Gate | Substitute / accepted risk |
|---|---|---|
| Wrong orchestration order (details before intake, skip not applied) | Unit tests over the run with a fake feed that records call order (`pnpm test`) | — |
| Duplicate membership or two running loads under concurrency | Static check of the generated migration SQL (generated columns, unique indexes) in a unit test + in-memory store emulating the unique keys | MySQL's own enforcement is only provable on dev MySQL: **human check at the T-HITL** |
| Wrong KP group (null, case, trailing space) | Table-driven unit tests from proposal § 12.1 | 2026 validity of the rule: Q7, accepted risk |
| Key or PII leak in logs | Log spy e2e (`pnpm test:e2e`) | — |
| Type errors the runner erases | `pnpm build` | — |
| Contract drift with Reporting (field names, reasons) | Adapter tests over fixtures copied from `qa-catalog.en.md` v1.29 | Live drift: T-HITL against Reporting's dev instance |
| DynamoDB key or item shape wrong | Entity tests against DynamoDB Local (opt-in) | Real table: T-HITL on dev |
| Hold / scope lock regression | The timeline-edit suites pass unchanged (`pnpm test`, `pnpm test:e2e`) | — |
| OpenAPI drift | `openapi.e2e-spec.ts` | — |

## 8. Requirement ID Index

| ID | Title | Scenarios | Owning task(s) |
|---|---|---|---|
| FR-1 | Preview | 3 | T-7 |
| FR-2 | Start | 4 | T-2, T-4, T-5, T-7, T-9, T-12 |
| FR-3 | Run | 3 | T-8 |
| FR-4 | Membership rule | 4 | T-2, T-4, T-5, T-8, T-12 |
| FR-5 | Identity | 1 | T-2, T-8 |
| FR-6 | Snapshot | 3 | T-3, T-8, T-12 |
| FR-7 | KP groups | 3 | T-4, T-8 |
| FR-8 | Errors | 2 | T-1, T-8 |
| FR-9 | Lease | 1 | T-4, T-5, T-8 |
| FR-10 | Read loads | 1 | T-7 |
| FR-11 | Has a load / edit | 4 | T-10 |
| FR-12 | Audit and log | — | T-5, T-8, T-9 |
| FR-13 | Access | — | T-9 |
| FR-14 | Release port off | 1 | T-8 |
| FR-15 | Documents | — | T-11 |
| NFR-1…7 | — | — | T-1, T-2, T-3, T-9, T-12 (see `tasks.md` § Coverage) |
