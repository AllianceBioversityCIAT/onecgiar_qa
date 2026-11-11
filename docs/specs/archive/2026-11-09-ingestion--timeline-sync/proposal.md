# Timeline sync at any step — Proposal

## 1. Document Control

| Field | Value |
|---|---|
| Spec Path | `ingestion/timeline-sync` |
| Type | Change |
| Deliverable | software |
| Approval Mode | gated |
| Jira | P2-3906 (epic P2-3902). This spec replaces AC4, AC5, AC6 and AC8 (§ 9.4) |
| Branch | `feat/ingestion-timeline-sync`, from `staging-center` @ `01a5404` (holds step 1) |
| Builds on | `docs/specs/archive/2026-11-04-ingestion--step-1-loads/` (design DD-1…DD-13, `front-contract.md`, known gaps G-1…G-3) and `server/src/ingestion/AGENTS.md` |
| Decision owner | Back lead (Juanda), brief of 2026-11-06. It supersedes P2-3906 AC4, AC5, AC6 and AC8. The membership rule and the return rule are decided and are not reopened here |
| BA confirmation | **Pending (Angel)** for the replacement AC text in § 9.4. Per KZ-ingestion--step-1-loads-1, no task that builds on a row marked "to confirm" runs before the row carries Angel's answer, or the back lead's named acceptance |
| Source questions | Requirements: Jira P2-3906 plus the back-lead brief. Visual: none, back end only (§ 8) |
| Date | 2026-11-06 |

## 2. Intent

The ADMIN can **sync** a timeline with Reporting at **any step**, as often as needed, while the timeline is open. This replaces the step-3-only "re-load" of P2-3906. The sync uses the same button and routes as step 1.

A result can come back into the same timeline once per round. This is how QA sees what the program changed between Round 1 and Round 2. A result is never in two parallel timelines at once.

## 3. Problem / Current Behavior

| # | Today | Citation |
|---|---|---|
| C-1 | A load is allowed only until step 1 closes. After that, the start answers 409 `LOADS_WINDOW_CLOSED`, and the preview says `window: 'closed'` | `load-rules.ts:18` (`loadWindow(cycleStatus, step1ClosesAt, now)`); `loads.unit-of-work.ts:300-306` (`findStepOne`, then `loadWindow`); `loads.service.ts:355` |
| C-2 | A result enters a timeline **once, ever**. Unique `(timeline_id, result_code)` over every membership, active or ended (DD-3, S-5) | `schema/timeline-results.ts:99` (`uq_timeline_results_timeline_code`) |
| C-3 | Any membership in this timeline, ended or not, skips the result as `ALREADY_IN_THIS_TIMELINE` | `load-rules.ts:85-100` (`skipVerdict`) |
| C-4 | Only an **active** membership in another timeline whose last step has not closed blocks the result (`ACTIVE_IN_OTHER_TIMELINE`). Ended memberships elsewhere do not block | `load-rules.ts:86-94` |
| C-5 | Loads and memberships carry no round. `timeline_loads.timeline_step_id` always points to step 1 | `schema/timeline-loads.ts:62` (comment: "Step 1 today; room for step 3"); `loads.store.ts:166` |
| C-6 | `end_reason` is `timeline_closed`, `released_qaed` or `released_not_qaed`. The code never writes `released_not_qaed` | `schema/timeline-results.ts:35-39`; `git grep -n "released_not_qaed" -- server/src` (excluding specs) → schema only |
| C-7 | Snapshots are immutable and one per `(result_code, load)`. Nothing compares one snapshot with the one before it | design § 5.4 (step 1) |
| C-8 | `LoadSummary` holds `loaded`, `byProgram`, `byType`, `kpGroups`, `skipped` and `otherTimelines`, merged associatively | `load-rules.ts:103-150` |
| C-9 | **Each step already stores its round.** `timeline_steps.round` and `requires_load` exist. The front derives the round from the "Loads results" switches: step 1 starts round 1, and every later step with the switch on starts the next round. The server checks only that rounds are contiguous | `schema/timeline-steps.ts:60-61,73,77-79`; `admin-config/timelines/timeline-rules.ts:137-141` (`ROUND_SEQUENCE`); `client/.../cycle/cycle.mapper.ts:134-137` (`roundsOf`); commit `8cc9d2e` (editor round labels, 2026-11-05) |
| C-10 | The PRD calls ingestion "automatic" | `docs/prd.md:10` |

## 4. Proposed Outcome

1. **Sync at any step.** The window becomes: the cycle is not closed, **and** now is at or before the closing minute of the timeline's **last** step (that minute stays open). The 409 codes stay the same.
2. **Every sync brings eligible results.** A result is eligible when both hold:
   - it is in the timeline's scope (phase year and scope, as step 1 reads them);
   - it is not active in another parallel timeline of the cycle. Today's `ACTIVE_IN_OTHER_TIMELINE` rule is kept.
3. **Round of entry.** The step in force when the sync starts decides the round (§ 10, Q-1 for the source of the round).
4. **One membership per round.** A result can be in the same timeline once in round 1 and once in round 2, never twice in the same round (AC12). It is never active in two timelines.
5. **Returned results.**
   - A round-1 membership can end as `returned`. The store gives this a method; this spec adds no route or job for it.
   - A round-2 sync re-admits a returned result only when the program submitted it again after the return.
6. **"Updated" fields.** When a result has an earlier snapshot in this cycle, the new membership records which fields changed (AC10).
7. **Summary.**
   - `loaded` is split into new and re-submitted.
   - Returned results not submitted again are counted by program and by result type.
   - The summary includes the round.
8. **Documents.** `front-contract.md`, `ingestion/AGENTS.md`, and the PRD wording are updated.

## 5. Scope

| In | Detail |
|---|---|
| `load-rules.ts` | `syncWindow` (replaces `loadWindow`), `entryRound(steps, now) → 1 \| 2`, the new `skipVerdict` with a round and the return rule, the extended `LoadSummary` and `mergeSummary`, and a pure `changedFields(previous, current)` |
| Migration `0008` | Detailed below |
| Store | `endAsReturned(membershipId, at)`: it ends an **active round-1** membership as `returned` and sets `ended_at`, conditionally (it is a no-op on an ended row). It is used by tests now and by the future assessment flow |
| Service and runner | The preview and the start use the new window and round, the step in force, the new skip rules, the changed-fields step, the summary, and the audit rows (`load_start` / `load_end` gain the round) |
| Routes | The same 4 routes. The preview, progress, history and detail expose `round`, `stepPosition` and the new summary keys |
| Docs | `front-contract.md` (round fields, summary keys, `returned`, new skip reasons in § 5 and § 7); `server/src/ingestion/AGENTS.md`; `docs/prd.md` (wording at :10 and :62); `server/src/database/AGENTS.md` (migration `0008`) |

Migration `0008`:
- **Drops** `uq_timeline_results_timeline_code`.
- **Adds** `timeline_results.entry_round` (tinyint, not null; existing rows get 1), with unique `(timeline_id, result_code, entry_round)`.
- **Adds** `end_reason` `returned`.
- **Adds** `timeline_loads.round` and `timeline_loads.step_position` (existing rows get 1 and 1).
- **Adds** the changed-fields columns (§ 11, DD candidate).
- Keeps `uq_timeline_results_active_key` unchanged.

## 6. Non-Goals

- Any **automatic** sync, whether per step, on timeline start, or on a schedule. Also any per-step on/off setting for sync.
- The assessment flow:
  - step-1 comments;
  - step-2 program review;
  - **who** returns a result and **when**;
  - the call to Reporting's `release`.

  This spec defines the `returned` state and its store method only, with no route and no job.
- Changing the Reporting contract. The return reuses the existing release `not_qaed`.
- Showing "Updated" in the front: that is Yeck's, from the contract. The step-1 comments link (AC11) is also out of scope beyond keeping membership and snapshot ids stable: the assessment module will store only those ids.
- A third round. Round 2 is the last (§ 9.3).
- Fixing G-1…G-3 of step 1. They are unchanged; they are read before touching `recordLot`.

## 7. Affected Users, Systems, And Specs

| Who / what | Effect |
|---|---|
| ADMIN | Can sync at any step until the last step closes. Sees the round in the preview, progress and history |
| Front (Yeck) | Shows the new contract fields. The load drawer must stop assuming "step 1 only". The timeline editor's round labels (`8cc9d2e`) must agree with the server's round (Q-1) |
| `admin-config/timelines` | `DrizzleTimelineLoads` ("has a load") and the scope lock are unchanged. They read `timeline_results` rows, whatever their count |
| Reporting | No contract change. The feed's `submitted_at` drives the re-entry rule (P-A, § 12) |
| DynamoDB `ResultSnapshot` | One more snapshot per re-entry. The key is unchanged: the sk already includes `load_id`, so a second snapshot in the same timeline cannot collide |
| Specs | Amends the archived step-1 rules DD-3 and S-5 (sequential re-entry) and design § 7.2.2 (the window). Archived files are not edited: this spec supersedes them, and the AGENTS guide points here |

## 8. Visual Reference

- Source: None.
- Notes: back end only. The front contract is the interface. The drawer design is Juanpa's and Yeck's.

## 9. Requirement Delta Preview

### 9.1 MODIFIED Requirements

| Was (step 1) | Becomes |
|---|---|
| FR-2 window: until step 1 closes | Until the **last** step of the timeline closes (closing minute open). The cycle is not closed. Same 409 codes |
| S-5 / DD-3: one membership per `(timeline, result_code)`, ever | One per `(timeline, result_code, entry_round)`. Still one active per `(cycle, result_code)` |
| `ALREADY_IN_THIS_TIMELINE` = any membership here | = an **active** membership here, **or** a membership here that entered in **this sync's round** |
| `timeline_loads.timeline_step_id` = step 1 | = the step in force at start (step 1 before step 1 opens), plus `round` and `step_position` |
| `LoadSummary` | Gains `loadedNew`, `loadedResubmitted`, `returnedNotResubmitted: {total, byProgram, byType}` and `round`. Existing keys are kept; `mergeSummary` stays associative |

### 9.2 ADDED Requirements

- `entryRound(steps, now)`: a pure function with unit tests at every boundary minute (opening and closing of each step, and the gaps between steps).
- Round-2 eligibility for a result already known to this timeline:

  | Case | Round-2 sync |
  |---|---|
  | Never in this timeline | Enters, round 2 |
  | Round-1 membership here ended `returned`, and feed `submitted_at` > that `ended_at` | Enters, round 2 (re-submitted) |
  | Round-1 membership here ended `returned`, `submitted_at` ≤ `ended_at` or null | Skipped, `RETURNED_NOT_RESUBMITTED`; counted by program and type |
  | Round-1 membership here still active | `ALREADY_IN_THIS_TIMELINE` |
  | QAed or auto-validated: ended `released_qaed`, or no longer listed by the feed | Never enters |
  | KPs | No separate group. Same rules (KP correction of 2026-11-04) |

- `returnedNotResubmitted` also counts returned results that the feed **no longer lists** (the program unsubmitted them and left them in Editing). It is computed from QA's own memberships, using the program and type of the round-1 membership, not from the feed.
- The `returned` end reason and the `endAsReturned` store method.
- Every new membership:
  - status `pending` (AC2);
  - a new snapshot;
  - when an earlier snapshot of the same `result_code` exists in this cycle, the list of changed field keys (AC10).

### 9.3 REMOVED Requirements

- P2-3906 AC4 "only for timelines that include step 3", AC5 "not before step 2 closes", the step-3-only load (AC6), and AC8 "a new timeline is required".

### 9.4 Replacement AC text for the PO (Angel)

> **AC4.** Only users with the QA Admin role can sync a timeline. The sync is the same action at every step.
>
> **AC5.** The QA Admin can sync a timeline at any step, as many times as needed, from its creation until the last minute of its last step, while the cycle is not closed.
>
> **AC6.** A sync brings every Submitted result that matches the timeline (phase year and scope) and is not under review in another timeline of the same cycle. A sync made in steps 1–2 enters results into Round 1; a sync made in step 3 or later enters them into Round 2 *(wording follows Q-1)*. In Round 2, a result returned to its program in Round 1 is brought only when the program submitted it again after the return. Knowledge Products follow the same rules.
>
> **AC8.** New submitted results are brought at any step. They enter the round in force.

## 10. Approach Options

### Q-1: where does the round come from? (decision needed before specify)

The brief fixes the round by step position: step 3 or later → round 2. The timeline, however, **already stores a round per step** (C-9), and since 2026-11-05 the editor shows "QA round 1 / QA round 2" from the "Loads results" switches. On "P2-3903 QA test timeline" both rules give the same answer, round 2 from step 3. They disagree on a timeline where the admin set the switch on step 2 or step 4, or on more than one later step (a round 3).

| Option | Rule | For | Against |
|---|---|---|---|
| **A — position (brief as written)** | Steps 1–2 → 1, step ≥ 3 → 2 | Simple, matches the brief and the Jira story | The editor's "QA round N" labels can say something different from what the sync does. `requires_load` and `round` on the steps become decoration |
| **B — stored round (recommended)** | The step in force's `timeline_steps.round`, or round 1 before step 1 opens. The timeline edit refuses a round above 2 (a new 400 on `ROUND_SEQUENCE` or a new code) | One source of truth with the editor. Same result on today's timelines. "Round 2 is the last" is enforced where it is set | Touches `timeline-rules.ts` (one rule) and its tests. Existing timelines with a round 3 need a check (a read-only query before migrating) |
| C — stored round, capped | As B, but a stored round > 2 reads as 2 | No admin-config change | Hides a misconfiguration. The label says "round 3" while the sync says 2 |

**Recommendation: B.** The round the ADMIN sees in the editor is the round the sync records. `entryRound(steps, now)` stays a pure function in `load-rules.ts`, with boundary tests either way.

### Changed fields: where to store them

| Option | Where | For | Against |
|---|---|---|---|
| **1 — MySQL (recommended)** | `timeline_results.changed_fields` JSON (null = no earlier snapshot in the cycle; `[]` = none changed) and `previous_membership_id` | The results list shows the "Updated" tag with no DynamoDB read. Bounded: at most the catalog's top-level key count. Specify measures the count and sets a CHECK on `JSON_LENGTH` | One more JSON column |
| 2 — the snapshot item | An attribute on `ResultSnapshot` | Immutable with the values | The list would need one DynamoDB read per row to show the tag |

Computing the list:
1. Compare hashes first; equal hashes mean `[]`.
2. When they differ, read the previous snapshot (pk plus the stored `snapshot_sk`, one GetItem).
3. Compare the values key by key, through the same canonical JSON as the hash.

## 11. Recommended Approach

One spec in **3 PRs**, following the step-1 pattern:

1. **Rules and persistence:**
   - `entryRound`, `syncWindow`, `skipVerdict` v2, `changedFields`, the summary;
   - migration `0008`, the schema, and `endAsReturned`.
2. **Service and runner:**
   - the preview and start on the new window and round;
   - the runner's re-entry, changed fields and summary;
   - the audit rows; the e2e suites.
3. **Documents:**
   - the front contract, the AGENTS guides and the PRD wording;
   - Q-1 option B's edit rule, if chosen.

Kept unchanged, as the brief requires:
- ADMIN only;
- idempotent start, one running sync per cycle, lease and heartbeat;
- the Reporting order (list → intake → details) and the retry rules;
- the KP release;
- no PII in logs;
- the audit rows;
- the two-catalog-cache binding note.

Budget signal: per KZ-auth--user-management--core-2 (recurrence, raised to High in the step-1 kaizen entry P4), size tests from the gates, not flat. The step-1 actuals ran ×1.9 on production and ×4.9 on test LOC. First guess: production ≈ 900–1,200 LOC, tests ≈ 3,000–4,000 LOC. Specify re-estimates.

## 12. Risks, Dependencies, And Open Questions

| ID | Item | Owner | Blocks |
|---|---|---|---|
| Q-1 | Round source: position (A) or stored step round (B/C). § 10 | Back lead | Specify |
| Q-2 | **Returned in timeline A, then a parallel timeline B syncs first.** The returned membership is ended, so under C-4 it no longer blocks. If B's scope also covers the result, B takes it as **new** (round of B) before A's round 2 sees it. The brief keeps C-4 ("ended does not block"). Confirm that this is intended, or let a `returned` membership in an open timeline block other timelines as `ACTIVE_IN_OTHER_TIMELINE` | Back lead | Specify |
| Q-3 | `released_not_qaed` (never written, C-6) and the new `returned` overlap. Keep both, with `released_not_qaed` reserved for a final not-QAed in round 2, or drop it from the enum in `0008`? | Back lead | Specify (migration) |
| Q-4 | Round-1 syncs at step 2: a result returned during step 2 and re-submitted before step 3 is skipped (`ALREADY_IN_THIS_TIMELINE`, same round). It enters at the first sync in step 3. Confirm | Back lead | — (matches the brief) |
| Q-5 | Angel's confirmation of the replacement AC (§ 9.4) and of the KP correction (P2-3906 comment 44592) | Angel | `/akili-execute` of the tasks that build on them (KZ-ingestion--step-1-loads-1) |
| P-A | Reporting's `submitted_at` is the **last** submission, so it moves when a program submits again. The port documents "ISO-8601 UTC, or null for a Submitted result with no submission history" (`results-feed.port.ts:22-23`). `UNVERIFIED — confirm at source before relying on it` (Reporting `qa-results.repository.ts` or a TEST probe at specify). If it is the first submission, the re-entry rule never fires | Back lead + Reporting | Design of the re-entry rule |
| P-B | After a `not_qaed` release (`in_qa = 0`), the feed keeps listing the result while it stays Submitted, and stops listing it when the program unsubmits it. `UNVERIFIED — confirm at source before relying on it` | Back lead + Reporting | `returnedNotResubmitted` counts (they are computed from QA rows, so only the wording depends on it) |
| R-1 | Clock skew: `submitted_at` comes from Reporting's clock (UTC) and `ended_at` from QA's. A resubmission within seconds of the return could be misjudged | — | Design: compare at second precision and document the edge |
| R-2 | Migration on a table with rows (qatest has step-1 memberships). Dropping and adding a unique key runs online for small tables; the rollback script must recreate the old key only when no `(timeline, code)` has two rows | — | T-migration |
| R-3 | Archived step-1 docs state S-5/DD-3 and the step-1 window. Readers could follow the old rule | — | The AGENTS guide points to this spec as the current rule |
| R-4 | Known gaps G-1…G-3 also apply to every sync, which now runs more often | — | Unchanged. Listed in the AGENTS guide |

## 13. Success Criteria

- A sync at each step boundary minute records the expected round (unit tests on `entryRound`) and is refused one minute after the last step closes (409 `LOADS_WINDOW_CLOSED`).
- The same result can hold a round-1 membership ended `returned` and a round-2 membership in the same timeline. A second round-2 insert hits the unique key and becomes a skip, not a 500.
- A returned result with `submitted_at` after the return enters round 2 with a new snapshot and its changed field keys. One without a new submission is skipped and counted in `returnedNotResubmitted` by program and type.
- A result active in a parallel timeline is still skipped `ACTIVE_IN_OTHER_TIMELINE`.
- Every existing step-1 test passes, except those that pin the old window or DD-3. Those are changed on purpose, each named in tasks.
- `front-contract.md` lists every new field, summary key, `end_reason` value and skip reason. A code missing from it is a review failure (AGENTS rule).

## 14. Next Step

After Q-1…Q-3 are answered:

```text
/akili-specify ingestion/timeline-sync
```
