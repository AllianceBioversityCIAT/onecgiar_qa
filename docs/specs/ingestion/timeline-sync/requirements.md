# Timeline sync at any step — Requirements

## 1. Document Control

| | |
|---|---|
| Spec path | `docs/specs/ingestion/timeline-sync` |
| Type | Change |
| Deliverable | software |
| Depth | **Full**: a migration that drops a unique key, a changed invariant (one membership per timeline → one per round), a new rule in the timeline edit, and a new read of DynamoDB in the run |
| Approval Mode | gated |
| Status | Approved by the back lead, 2026-11-06 (gated: requirements, design and tasks gates each answered "Continue") |
| Source | `proposal.md` (2026-11-06) and the back-lead brief of 2026-11-06. Jira P2-3906 (13 AC; this spec replaces AC4, AC5, AC6 and AC8) |
| Decisions at the proposal gate | Q-1 → **B** (the round is the stored round of the step in force; the edit refuses a round above 2). Q-2 → **block** (a `returned` membership in an open timeline blocks other timelines). Q-3 → **keep** `released_not_qaed` reserved. Back lead, 2026-11-06 |
| BA confirmation | **Pending (Angel)**: the replacement AC text (proposal § 9.4). **S-9 accepted as default by Juanda (back lead), 2026-11-09**, widened to a type change; Angel to ratify (non-blocking). Under KZ-ingestion--step-1-loads-1, the tasks that build on a "to confirm" row wait for Angel's answer or for the back lead's named acceptance |
| Builds on | *loads* = `docs/specs/archive/2026-11-04-ingestion--step-1-loads/` (FR-1…FR-15, DD-1…DD-13); *timelines* = `docs/specs/archive/2026-10-21-admin-config--cycle-timelines/` (FR-10 rounds); *edit* = `docs/specs/admin-config/timeline-edit/` |
| Scope | Server (`server/`). The front adapts through `front-contract.md` |
| Last updated | 2026-11-06 |

**Decisions:**

| # | Decision | Source | Status |
|---|---|---|---|
| S-1 | A sync is manual, by an ADMIN, at any step. There is no automatic sync and no per-step setting | Brief | Back lead |
| S-2 | The round of a sync is the stored `round` of the step in force when the sync starts; before step 1 opens it is round 1 | Q-1 = B | Back lead, 2026-11-06 |
| S-3 | Round 2 is the last. The timeline edit refuses a step round above 2 | Brief + Q-1 = B | Back lead |
| S-4 | A result can be in the same timeline once per round, and never active in two timelines of a cycle | Brief ("decided — do not reopen") | Back lead |
| S-5 | A round-1 membership can end as `returned`. This means QA released it in Reporting with the existing `not_qaed`. Who returns it and when belongs to the future assessment flow | Brief | Back lead |
| S-6 | A `returned` membership in a timeline whose last step has not closed blocks the result in every **other** timeline of the cycle | Q-2 = block | Back lead, 2026-11-06 |
| S-7 | `released_not_qaed` stays in the enum, reserved and unwritten | Q-3 = keep | Back lead, 2026-11-06 |
| S-8 | A returned result re-enters round 2 only when Reporting's `submitted_at` is later than the membership's `ended_at` | Brief | Back lead |
| S-9 | A **re-submitted** result enters round 2. Only an assessed result can be returned, so a round-1 KP was `review`. (a) Still a KP → `pending`, KP group `review`, **not** re-classified. (b) Its type changed from KP to another type (the assessor's finding) → `pending`, no KP group; the round-1 row keeps the KP type as history. (c) Its type changed to KP → classified as a KP new to the timeline, released by the KP release when `not_in_qa` or `auto_validated`. A result **new** to the timeline is classified as in step 1, whatever the round | Derived from AC2 and "KPs follow the same rules"; type change from the back lead | **Accepted as default by Juanda (back lead), 2026-11-09**; Angel to ratify |

## 2. Executive Summary

Today the ADMIN can load a timeline only until step 1 closes, and a result enters a timeline once, ever. After this spec:
- The ADMIN can **sync** a timeline at any step until its last step closes, as often as needed.
- Each sync records the **round** of the step in force: round 1 or round 2.
- A result can come back into the same timeline in round 2, with a new snapshot and the list of fields that changed, but only when QA returned it to its program in round 1 and the program submitted it again.
- The summary separates new results from re-submitted ones, and counts returned results that were not submitted again.

This serves P2-3906 and the PRD's P1 (manual SQL each cycle).

## 3. Glossary

| Term | Meaning |
|---|---|
| Sync | A load started by the ADMIN on a timeline (`POST /timelines/:id/loads`). Same routes and engine as the step-1 load |
| Step in force | The last step of the timeline whose opening minute (Rome) has passed. Before step 1 opens, the step in force is step 1 |
| Round | 1 or 2. The stored `round` of the step in force when a sync starts. Every membership the sync writes has this entry round |
| Membership | A `timeline_results` row: one result in one timeline, entered in one round. It is active until it ends |
| Returned | A round-1 membership ended because QA sent the result back to its program (Reporting release `not_qaed`) |
| Re-submitted | A returned result whose Reporting `submitted_at` is later than the return's `ended_at` |
| New (to the timeline) | A result with no membership of any round in this timeline |
| Changed fields | The catalog field keys whose values differ between a result's new snapshot and its previous snapshot in the same cycle |

## 4. System Context & Scope

**In scope:**
- The sync window.
- The round of a sync.
- The edit rule that caps the round at 2.
- The skip and re-entry rules.
- The `returned` state and its store method.
- Changed fields.
- The summary.
- Read surfaces, audit, migration `0008`, and the documents.

**Out of scope:**
- Any automatic sync.
- The assessment flow: comments, the program review, who returns a result and when, and the Reporting release call.
- Showing "Updated" in the front.
- A round 3.
- The step-1 known gaps G-1…G-3.

**Current behavior (cited at `staging-center` @ `01a5404`):**

| # | Today | Citation |
|---|---|---|
| CB-1 | The window closes after step 1's closing minute | `server/src/ingestion/load-rules.ts:18-26`; `loads.unit-of-work.ts:300-312` |
| CB-2 | One membership per `(timeline, result_code)`, active or ended | `server/src/database/drizzle/schema/timeline-results.ts:99` |
| CB-3 | Any membership in this timeline → `ALREADY_IN_THIS_TIMELINE`; only an active, unexpired one in another timeline → `ACTIVE_IN_OTHER_TIMELINE` | `load-rules.ts:85-100` |
| CB-4 | A load always records step 1 | `loads.unit-of-work.ts:300`; `schema/timeline-loads.ts:61-64` |
| CB-5 | Each step stores `round` (≥ 1, contiguous); the edit checks only the sequence | `schema/timeline-steps.ts:60,73`; `admin-config/timelines/timeline-rules.ts:137-141` |
| CB-6 | Today every stored step round is 1 or 2, and round 2 starts at step 3 on every timeline (30 timelines, 144 steps) | Read-only query on `qadb` (qatest), 2026-11-06: `SELECT MAX(round), COUNT(*) FROM timeline_steps` → `2, 144`; the per-timeline step listing shows `3:2:1` on every 5-step timeline |
| CB-7 | Reporting's `submitted_at` is the **latest** active submit | `onecgiar_pr` @ `3f88c9c2b`, `onecgiar-pr-server/src/api/qa-catalog/qa-results.repository.ts:122-125` (`MAX(s.created_date)` over `submission` with `is_active = 1 AND status = 1`) |
| CB-8 | The feed lists only results in Submitted status, whatever their `in_qa` | same file `:293` (`r.status_id = SUBMITTED`); no `in_qa` filter in `buildEligibility` |
| CB-9 | A `not_qaed` release writes only `result.in_qa`; the result stays Submitted until its program unsubmits it. `qaed` moves it to Quality Assessed | `onecgiar_pr` `qa-intake.service.ts:63` ("Writes only `result.in_qa`"); `qa-intake.repository.ts:8` (`QUALITY_ASSESSED_STATUS_ID`) |

## 5. Stakeholders / Personas

| Role | Scope | What they need |
|---|---|---|
| ADMIN | Every timeline | Sync at any step; see the round, new vs re-submitted counts, and who did not resubmit |
| Front (Yeck) | Load drawer, results list | A stable contract: round fields, summary keys, `returned`, the new skip reason, and changed fields |
| Future assessment flow | Comments, return, round-2 review | A store method that ends a round-1 membership as `returned`, and stable membership and snapshot ids |
| Angel (BA) | P2-3906 | Replacement AC text; S-9 |

## 6. Functional Requirements

### FR-1: Sync window

The ADMIN SHALL be able to start a sync while the cycle is not closed **and** now (Rome minute) is at or before the closing minute of the timeline's **last** step. The preview's `window` SHALL follow the same rule. The refusal codes are unchanged.

#### Scenario: Sync in step 4
- GIVEN an active cycle and a timeline whose step 4 is open
- WHEN the ADMIN starts a sync
- THEN the answer is 202 `{id, status: 'running'}`

#### Scenario: Last closing minute
- GIVEN the last step closes at 2026-12-03 23:59 (Rome)
- WHEN the ADMIN starts a sync at 23:59 → 202; at 2026-12-04 00:00 → 409 `LOADS_WINDOW_CLOSED`
- AND the preview at 00:00 says `window: 'closed'`

#### Scenario: Before step 1 opens
- GIVEN step 1 opens tomorrow
- WHEN the ADMIN starts a sync
- THEN it is accepted (round 1, step position 1)

#### Scenario: Closed cycle
- WHEN the cycle is closed
- THEN the start is 409 `CYCLES_CLOSED`, before the window is judged
- BUT it must NOT write a load row, an audit row, or an idempotency mark on any refusal

### FR-2: Round of a sync

The round of a sync SHALL be the stored round of the step in force at the sync's start (Rome minute). The sync SHALL record that round and the step's position on the load. Every membership it writes SHALL carry that round as its entry round.

#### Scenario: Boundaries (default 5-step timeline: steps 1–2 round 1, steps 3–5 round 2)
- WHEN a sync starts one minute before step 1 opens → round 1, position 1
- AND at step 1's opening minute → round 1, position 1
- AND at step 2's closing minute → round 1, position 2
- AND in the gap after step 2 closes and before step 3 opens → round 1, position 2
- AND at step 3's opening minute → round 2, position 3
- AND at the last step's closing minute → round 2, position 5

#### Scenario: Round set by the admin
- GIVEN a timeline whose stored rounds are 1, 1, 1, 2, 2
- WHEN a sync starts in step 3
- THEN its round is 1

- AND IT MUST read the round as stored at the start. A step edit during the run does not change the run's round.

### FR-3: Round limit in the timeline edit

Creating a timeline SHALL refuse any step whose round is above 2, with the existing all-errors 400 shape, naming the step's `round` field. Editing cannot change a round: the edit body has no `round` field and answers 400 `UNKNOWN_FIELD` when one is sent (amended 2026-11-06, back lead).

#### Scenario: Round 3
- WHEN an ADMIN sends steps with rounds 1, 1, 2, 2, 3
- THEN the answer is 400 and the issues name `steps[4].round`
- AND nothing is written
- BUT it must NOT change how rounds 1 and 2 are validated today (contiguity, start at 1)

### FR-4: Who is skipped

For each result the feed lists for the timeline's scope, a sync SHALL decide in this order:
1. **Another timeline holds it**: the result has, in another timeline of the cycle whose last step has not closed:
   - an active membership; or
   - a membership ended as `returned`.

   Skip as `ACTIVE_IN_OTHER_TIMELINE`, and name that timeline.
2. **This timeline holds it in this round**: the result has an active membership in this timeline, or a membership in this timeline entered in this sync's round. Skip as `ALREADY_IN_THIS_TIMELINE`.
3. **Round 2, returned here, not resubmitted**: the result has a round-1 membership in this timeline ended as `returned`, and `submitted_at` is null or not later than that membership's `ended_at`. Skip as `RETURNED_NOT_RESUBMITTED`.
4. **Round 2, ended here for any other reason**: the result has a round-1 membership here ended `released_qaed`, `released_not_qaed` or `timeline_closed`. Skip as `ALREADY_IN_THIS_TIMELINE`.
5. **Listed twice** by the feed: `DUPLICATE_RESULT_CODE`.
6. Otherwise, the result is taken. It is **re-submitted** when case 3's membership exists and `submitted_at` is later; otherwise it is **new**.

#### Scenario: Round 1 at step 2, result returned during step 2
- GIVEN a result entered round 1 here and was returned, then resubmitted
- WHEN a sync runs in step 2 (round 1)
- THEN it is skipped `ALREADY_IN_THIS_TIMELINE`

#### Scenario: Round 2, re-submitted
- GIVEN a round-1 membership here ended `returned` at 10:00:00 UTC, and the feed's `submitted_at` is 10:00:01 UTC
- WHEN a sync runs in round 2
- THEN the result is taken as re-submitted

#### Scenario: Round 2, not resubmitted
- GIVEN the same membership and `submitted_at` 10:00:00 UTC, or earlier, or null
- WHEN a sync runs in round 2
- THEN the result is skipped `RETURNED_NOT_RESUBMITTED`

#### Scenario: Returned in A, B syncs first (S-6)
- GIVEN a result returned in timeline A, whose last step has not closed, and resubmitted
- WHEN parallel timeline B, whose scope covers it, syncs
- THEN B skips it `ACTIVE_IN_OTHER_TIMELINE`, naming A
- AND once A's last step has closed, B can take it as new

#### Scenario: Parallel scope without a membership
- GIVEN timeline C's scope covers the result but C holds no membership of it
- WHEN this timeline syncs
- THEN C does not block

#### Scenario: Round 2, new result
- GIVEN a result never in this timeline and not held elsewhere
- WHEN a sync runs in round 2
- THEN it is taken as new, with entry round 2

- BUT it must NOT ask Reporting for intake or details of a skipped result. The order list → intake → details is unchanged.
- AND IT MUST compare `submitted_at` and `ended_at` as UTC instants at second precision, with "later" strict.

### FR-5: One membership per round

The database SHALL refuse a second membership of one result in one timeline with the same entry round. It SHALL keep refusing a second **active** membership of one result in a cycle. A lost race on either key SHALL become a skip (`ALREADY_IN_THIS_TIMELINE` or `ACTIVE_IN_OTHER_TIMELINE`) and SHALL NOT fail the lot.

#### Scenario: Two rounds in one timeline
- GIVEN a round-1 membership ended `returned`
- WHEN the round-2 membership is inserted
- THEN both rows exist

#### Scenario: Duplicate insert in the same round
- GIVEN the round-2 membership of a result already exists in this timeline. A sync judged it before another writer committed it; only one sync runs per cycle, so this comes from a lost commit acknowledgement (G-2) or a later writer
- WHEN the sync inserts it again
- THEN exactly one row exists, and the insert becomes the skip `ALREADY_IN_THIS_TIMELINE`, not a failed lot

### FR-6: The `returned` state

The store SHALL offer one operation that ends an **active round-1** membership as `returned`, setting `ended_at` to the given instant. It SHALL be a no-op on a membership that is already ended or is not round 1, and say so. No route and no job SHALL call it in this spec.

#### Scenario: Return
- GIVEN an active round-1 membership
- WHEN the operation runs at T
- THEN the row has `end_reason = 'returned'` and `ended_at = T`, and the result is no longer active in the cycle

#### Scenario: Already ended
- WHEN the operation runs on an ended membership, or on a round-2 one
- THEN nothing changes, and the result says so

- BUT it must NOT be reachable over HTTP. The route inventory test is unchanged.

### FR-7: New membership

Every membership a sync writes SHALL have:
- a new immutable snapshot (earlier snapshots are never touched);
- status `pending` for a re-submitted result whose type is unchanged, or changed away from KP; KP group `review` when it is still a KP, none otherwise;
- the step-1 status and KP group for a new result, and for a re-submitted result whose type changed to KP (S-9).

#### Scenario: Re-submitted KP
- GIVEN a KP whose round-1 membership was `review` and was returned, and that is resubmitted
- WHEN round 2 takes it
- THEN its membership is `pending`, KP group `review`
- BUT it must NOT be re-classified, and it must NOT be released by the KP release

#### Scenario: Re-submitted as another type
- GIVEN a KP whose round-1 membership was `review` and was returned because it is not a KP, and that is resubmitted as an output
- WHEN round 2 takes it
- THEN its membership is `pending`, with no KP group
- AND the round-1 membership still reads type `knowledge_product`

#### Scenario: Re-submitted as a KP
- GIVEN a result returned in round 1 as another type, and resubmitted as a KP whose details classify it as `auto_validated`
- WHEN round 2 takes it
- THEN it is `auto_validated`, KP group `auto_checked`, and is released as `qaed` at the end, as a new KP

#### Scenario: New KP in round 2
- GIVEN a KP new to the timeline, whose details classify it as `not_in_qa`
- WHEN round 2 takes it
- THEN it is `not_in_qa` and is released as `qaed` at the end, as in step 1

### FR-8: Changed fields

When the result has an earlier snapshot in the same cycle, the new membership SHALL record the list of changed field keys (an empty list when nothing changed). When there is no earlier snapshot in the cycle, it SHALL record that there is none (distinct from empty). The list SHALL be readable without reading DynamoDB.

#### Scenario: Corrected title
- GIVEN the round-1 snapshot and a round-2 snapshot that differ only in `title`
- THEN the round-2 membership lists `["title"]`

#### Scenario: Nothing changed
- WHEN the hashes are equal
- THEN the list is empty and no snapshot is read

#### Scenario: First time in the cycle
- THEN the membership records "no earlier snapshot"

- AND IT MUST compare values through the same canonical form as the snapshot hash. Key order and whitespace never count as changes.

### FR-9: Summary

The load summary SHALL keep every existing key and SHALL add:
- `round`;
- `loadedNew` and `loadedResubmitted`, whose sum is `loaded`;
- `returnedNotResubmitted` as `{total, byProgram, byType}`.

The preview SHALL show the same counts. `returnedNotResubmitted` SHALL count every round-1 membership of this timeline ended `returned` that has no round-2 membership, whether or not the feed still lists it. Each is counted under its round-1 program and type.

#### Scenario: Unsubmitted program
- GIVEN 3 returned results; 1 resubmitted, 1 still Submitted with the old date, 1 unsubmitted (not listed)
- WHEN a round-2 sync completes
- THEN `loadedResubmitted = 1`, `returnedNotResubmitted.total = 2`, split by program and type
- AND `skipped.RETURNED_NOT_RESUBMITTED = 1` (only the listed one is a skip)

- AND IT MUST keep the lot-by-lot merge associative and order-independent.

### FR-10: Read surfaces

The preview SHALL return `round` and `stepPosition` for a sync started now. The list, the detail and the progress SHALL return each load's `round` and `stepPosition`. Loads recorded before this spec SHALL read as round 1, position 1.

### FR-11: Audit and log

The `load_start` and `load_end` audit rows SHALL include the round. Logs SHALL stay ids, counts and fixed words only (step-1 NFR-7).

### FR-12: Unchanged guarantees

ADMIN only; idempotent start; one running sync per cycle; the lease and heartbeat; Reporting order and retry rules; the KP release; "has a load" and the scope lock; the two-catalog-cache binding. Every step-1 suite SHALL pass, except the tests that pin the step-1 window or the once-per-timeline rule. Those are changed on purpose and named in `tasks.md`.

### FR-13: Documents

- `front-contract.md` (step-1 archive copy superseded by a new one in this spec folder) SHALL list the round fields, the summary keys, `returned`, `RETURNED_NOT_RESUBMITTED`, and the changed-fields field.
- `server/src/ingestion/AGENTS.md` and `server/src/database/AGENTS.md` SHALL state the new rules and migration `0008`.
- `docs/prd.md` SHALL say ingestion is a manual ADMIN sync at any step (lines 10 and 62).

## 7. Non-Functional Requirements

| ID | Attribute | Scenario | Measure | TRD ref |
|---|---|---|---|---|
| NFR-1 | Correctness under concurrency | Two inserts of the same `(timeline, result, round)` | Exactly one row; the other is a skip. Enforced by a unique key, not by code | step-1 NFR-6 |
| NFR-2 | Performance | Round-2 sync of 1,200 results, 300 re-submitted with changed hashes | At most 1 extra DynamoDB GetItem per re-submitted result with a changed hash; 1 extra MySQL query per lot for the returned memberships; 1 query per sync for `returnedNotResubmitted` | step-1 NFR-5 |
| NFR-3 | Bounded storage | Changed-fields list | At most the catalog's top-level key count for the result type; enforced by a check | — |
| NFR-4 | Privacy | Logs and errors | No titles, values or field contents in logs; changed fields are keys only | step-1 NFR-7 |
| NFR-5 | Safe migration | `0008` on a table with rows | The forward migration keeps every row (`entry_round = 1`); the rollback refuses when any `(timeline, result_code)` has two rows | — |

### Defect classes and their gates

| Defect class | Gate | Substitute / accepted risk |
|---|---|---|
| Wrong round at a boundary minute | `load-rules.spec.ts` boundary table (`npx vitest run`) | — |
| Wrong skip or re-entry verdict | `load-rules.spec.ts` verdict table; `load-runner.spec.ts` | — |
| A unique key that does not match the rule (migration) | `schema.spec.ts` on the generated SQL; `pnpm db:migrate` on `qadb` at T-9 (the e2e suites run on in-memory stores; amended 2026-11-06, back lead) | — |
| A lost race becomes a 500 or a failed lot | `loads.unit-of-work.spec.ts` duplicate-key cases | — |
| A non-associative summary merge | Property test on `mergeSummary` | — |
| Type drift in the contract (Drizzle, DTO) | `npm run build` (tsc stricter than Vitest) | — |
| Front contract out of date | Reviewer check of `front-contract.md` against `error-codes.ts` and DTOs | Human (Yeck) at handoff |
| Clock skew between Reporting and QA (`submitted_at` vs `ended_at`) | none automated | **Accepted risk**: a resubmission within seconds of a return can be misjudged; documented in the contract |
| Live behavior against Reporting TEST | none automated | HITL task: a real round-2 sync on qatest once a result can be returned |

## 8. Requirement ID Index

| ID | Title | Scenarios | Owning task(s) |
|---|---|---|---|
| FR-1 | Sync window | Step 4 · Last closing minute · Before step 1 · Closed cycle | T-3, T-4, T-7 |
| FR-2 | Round of a sync | Boundaries · Round set by the admin | T-1, T-3, T-4 |
| FR-3 | Round limit | Round 3 | T-2, T-7 |
| FR-4 | Who is skipped | 6 scenarios | T-3, T-6 |
| FR-5 | One membership per round | Two rounds · Race | T-1, T-4 |
| FR-6 | `returned` | Return · Already ended | T-1, T-4, T-7 |
| FR-7 | New membership | Re-submitted KP · New KP | T-6 |
| FR-8 | Changed fields | Title · Nothing · First time | T-1, T-3, T-5, T-6 |
| FR-9 | Summary | Unsubmitted program | T-3, T-4, T-6, T-7 |
| FR-10 | Read surfaces | — | T-1, T-4, T-7 |
| FR-11 | Audit and log | — | T-4, T-6 |
| FR-12 | Unchanged guarantees | — | T-6, T-7 |
| FR-13 | Documents | — | T-8 |
