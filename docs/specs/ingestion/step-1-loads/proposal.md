# Proposal — Step-1 loads (P2-3905)

## 1. Document Control

| Field | Value |
|---|---|
| Spec Path | `ingestion/step-1-loads` |
| Slug | `step-1-loads`, derived from the free-text argument; the domain is `ingestion`, which covers "Reporting API integration, snapshots, sync" (`AGENTS.md`, *Spec organization*) |
| Type | Change |
| Deliverable | software |
| Approval Mode | gated. The proposal gate was passed by the back lead's brief of 2026-11-04: "Reescribe el proposal existente … con estas decisiones y luego sigue con specify" |
| Revision | 2 (2026-11-04). Rewritten with the back lead's decisions: membership rule, `result_code` identity, DynamoDB snapshot (Q6 → B), intake before details. Revision 1 (2026-10-28) is in this file's history |
| Jira | P2-3905 (User Story, epic P2-3902). Reporting sub-tasks: P2-4037 (results feed), P2-4040 (intake and release) |
| Requirement source | Jira P2-3905 (14 AC, read 2026-10-28) and the back lead's briefs (2026-10-28 and 2026-11-04) |
| Upstream contract | `onecgiar_pr` → `onecgiar-pr-server/docs/qa-catalog.en.md` **v1.29**: § *Results feed* (P2-4037) and § *Intake and release* (P2-4040). Read on 2026-11-04 from branch `JuanGuzman-io/p2-4040-qa-intake` at `654cbab4d` |
| Author / Date | Back lead (Juanda) with Claude, 2026-11-04 |
| Depends on | `admin-config/timeline-edit` (hold, scope lock, `TIMELINE_LOADS` port). The archived `admin-config/timeline-step-times` (Rome minutes) |
| Out of family | P2-3906 (step-3 load) and the normal use of release (closing a result after review) are other specs. This one leaves them room and does not build them |

## 2. Intent

The QA Admin brings Submitted W1/W2 results from Reporting into **step 1** of a timeline. Each load is a manual action, and the admin can repeat it while step 1 is open. Before confirming, the admin sees a preview. During the run there is a progress bar, and at the end a summary. With this, the coordinator stops emailing the tech team to "move the submitted results" each cycle (P2-3905, *Description*; PRD P1 and M1).

A result can come back to QA in a **later** timeline of the same cycle, or in a later year. Each load keeps its own snapshot, so QA can later show how a result changed between loads.

## 3. Problem / Current Behavior

| Today | Evidence |
|---|---|
| There is no load. The `TIMELINE_LOADS` port is bound to `NoTimelineLoads`, which always answers an empty set | `server/src/admin-config/timelines/timeline-loads.ts:11,23` |
| So every timeline whose step 1 has opened is on hold (`waiting_for_load`), and readiness lists `NO_RESULTS_LOADED` | `timeline-view.ts:64,107`; `server/src/admin-config/AGENTS.md` (*The hold*) |
| `timeline_loads` and `timeline_results` are reserved but do not exist. The latest migration is `0006` | `ls server/drizzle/*.sql` → `0006_timeline_step_times.sql`; archived `cycle-timelines/design.md:149` |
| The edit reads `hasLoad` **before** its transaction and does not re-check it under the lock | `timelines.service.ts:472` |
| QA already calls Reporting with `x-api-key` (`CLARISA_API_KEY`), but only for `GET /api/qa/catalog`. The shared HTTP helper only does GET | `reporting-qa-catalog.client.ts`; `config/catalogs.config.ts:12`; `users/catalogs/catalog-http.ts:25` (`getJson`) |
| The catalog client caches one entry per year (fresh 1 h, stale up to 24 h) and cannot force a reload | `reporting-qa-catalog.client.ts` |
| DynamoDB is wired (client and table name) and `electrodb` is a dependency, but no entity exists. `docs/infrastructure.md:29` still says the table is "to create per env" | `server/src/database/dynamodb/dynamodb.module.ts`; `server/package.json:43`. The back lead says the dev table exists: `UNVERIFIED — confirm at source before relying on it` (checked at specify) |
| No screen runs a load. Cycle shows a disabled "Load results into QA" button; the old mock `load-drawer.ts` is no longer rendered | `9c35941` (Juanpa, 2026-10-27); `cycle-view.html:1,17-19` |
| The archived rule **D-2** says a result can be in several timelines of a cycle, never in two at once. It was written as date overlap, and was left to P2-3905 | `archive/2026-10-21-admin-config--cycle-timelines/proposal.md:148`; D-6 at `:152` |
| In Reporting, the feed is on `origin/staging`; intake and release are only on `origin/performance-refactor` (not `dev`, `staging` or `master`) | `git ls-tree origin/<branch> -- onecgiar-pr-server/src/api/qa-catalog/dto` in `onecgiar_pr`, 2026-11-04 |
| Since v1.29 Reporting enforces a CLARISA grant per route on all five `/api/qa/*` routes. Whether the QA key holds them | Contract change log v1.29 (2026-11-03). Key grants: `UNVERIFIED — confirm at source before relying on it` (probe at specify) |

## 4. Proposed Outcome

1. An ADMIN opens a timeline and asks for a **preview** of step 1. QA pages the whole feed list for `phase_year = cycles.year` within the timeline's scope, and removes the results that are active in another timeline of the cycle. It shows counts by program and by type, the KP groups, and the skips with their reason.
2. The ADMIN **confirms**. QA writes a `timeline_loads` row (`running`) and answers at once. A background run in the same process works in lots of 50: **intake** in Reporting, then **details**, then a snapshot in DynamoDB, then the membership row in MySQL. It updates `processed / total` as it goes.
3. The front polls the load and shows "275 of 1,200". The run ends `completed` with a summary (loaded, skipped by reason, KP groups) or `failed`. Running it again never duplicates anything.
4. Once the timeline has a load (Q5), `TIMELINE_LOADS` answers true: the timeline leaves `waiting_for_load` and the scope locks, as timeline-edit already says.
5. After step 1 closes (Rome minute), or once the cycle is closed, a load is refused.

## 5. Scope

| In | Notes |
|---|---|
| Port `RESULTS_FEED` with four operations: `list`, `details`, `intake`, `release`. HTTP adapter and a fake for tests | `release` is built for the inactive KP port only (§ 12.1); its normal use belongs to another spec (P2-3906 or later) |
| A POST helper in `catalog-http.ts`, with the same bounds as `getJson` (timeout, size, JSON only) | The `x-api-key` never reaches a log line or a file (rule 13) |
| Migration `0007`: `timeline_loads` and `timeline_results` | Additive. Membership guard and "one running load per cycle" as generated `*_key` columns with unique indexes (the `0003` pattern) |
| Membership rule (§ 9.1): one **active** membership per `(cycle, result_code)`. An ended membership is kept, inactive | A collision is a skip, `ACTIVE_IN_OTHER_TIMELINE`, naming the other timeline |
| Snapshot in DynamoDB: the repo's first ElectroDB entity, behind a `SNAPSHOT_STORE` port, with a fake for tests and DynamoDB Local for development | Option B (§ 10). Insert-only content, deterministic key |
| `GET …/loads/preview`, `POST …/loads` (`@Idempotent()`, ADMIN), `GET …/loads`, `GET …/loads/:loadId` | Under `/timelines/:id`; paths fixed at specify |
| Load window: from timeline creation until step 1 `closesAt` (Rome minute); the cycle must not be closed | Rule 2, AC2 |
| Errors: 5xx or timeout → retry with backoff, then `failed`. 4xx → `failed` at once. `catalog_version` mismatch → one forced catalog reload, then `failed` if still different | Rules 6 and 8 |
| KP classification with the 2025 rule (§ 12.1), behind its own port | Unchanged from revision 1; Q7 still open |
| A real `TIMELINE_LOADS` adapter, and the edit judges `hasLoad` under the timeline lock. A running load counts toward the scope lock | Rule 11 |
| Audit: one `timeline_audit_events` row per load start and end, plus the `admin_config` log line with no PII | Rule 12 |
| `front-contract.md` for Yeck | Endpoints, states, error codes |
| PRD fix: US-4, P1 and § 5 item 2 ("automatically when a batch opens" becomes a manual load per timeline step) | Task deliverable |
| `docs/infrastructure.md:29`: the dev table exists; TEST/PROD as verified at specify | Task deliverable |

## 6. Non-Goals

- Step-3 loads (P2-3906), and the move of a KP into step 3.
- Releasing results after review (`qaed` / `not_qaed` as part of the QA flow): another spec.
- The **evolution screen** (comparing snapshots of one `result_code`): worklist or detail (P2-3909). This spec only stores snapshots so that history can be read.
- Migrating the history of the old QA (2025 and earlier). The feed serves 2026 only (contract *Known gaps* 4).
- Results in Editing, W3/Bilateral, and the exceptions the tech team handles.
- Automatic, scheduled or job-triggered loads.
- Re-checking eligibility in QA (Reporting decides), and validating values against the catalog beyond `catalog_version` (R-6).
- Email alerts; Overview counts and the assessor list (AC11/AC12 display: P2-3909).
- The front wiring (Yeck, from `front-contract.md`).

## 7. Affected Users, Systems, And Specs

| Who / what | Impact |
|---|---|
| ADMIN | New action on the cycle screen |
| Assessors / Lead | Results now exist in a timeline. What they see comes later (P2-3909) |
| Programs in Reporting | A loaded result is In QA: its program cannot unsubmit it until QA releases it (contract § *Unsubmit while In QA*) |
| `server/src/admin-config/timelines/` | Port swap, `hasLoad` under the lock, scope lock during a running load |
| New `server/src/ingestion/` | Feed adapter, load service, run engine, MySQL stores, ElectroDB snapshot entity |
| `server/src/users/catalogs/catalog-http.ts` | A POST helper |
| `field-config/reporting-qa-catalog.client.ts` | A forced refresh for one year |
| `docs/trd/trd.md` | ADR-005 deviation (run record in MySQL), reserved tables become real, first ElectroDB entity. Recorded as pending items (shared-file discipline) |
| Archived `admin-config/cycle-timelines` | **D-2 stays** and is made concrete: "at once" means an active membership (§ 9.1) instead of overlapping dates. **D-6 stays** |
| Reporting (P2-4037, P2-4040) | Intake and release must be deployed where QA calls them, and the QA key needs five route grants |

## 8. Visual Reference

- Source: **none**. A new design is needed for AC4–AC9 (scope filled in, preview, progress, summary, KP groups, error and "step 1 closed" states).
- Location: `docs/ux-ui/design.md:49,64` places the load on **Cycle**.
- Notes: this spec is back-end only. It hands Yeck and Juanpa `front-contract.md` early, so they design and build in parallel. The front and design sub-tasks of P2-3905 were promised to Yeck (Slack, 2026-10-29).

## 9. Requirement Delta Preview

### 9.1 Membership rule (replaces revision 1's "first load wins")

| Rule | Detail |
|---|---|
| Several times per cycle | A result **can** be in several timelines of one cycle, in succession. That is how QA sees what changed between loads |
| Never twice at once | A result **cannot** be active in two timelines of the same cycle |
| Start | The membership starts with the load |
| End | When QA releases the result in that timeline (`qaed` or `not_qaed`), **or** when the timeline's last step closes (Rome minute). Which one: **Q10** (Angel) |
| Kept | An ended membership is never deleted; it becomes inactive and keeps its history |
| Re-entry | A `not_qaed` result that the program unsubmits, edits and submits again can enter a **later** timeline, with a new snapshot |
| In the database | `timeline_results.active_key = IF(<active>, CONCAT(cycle_id, '#', result_code), NULL)` with a unique index |
| Collision | Not a lot failure: the result is `skipped / ACTIVE_IN_OTHER_TIMELINE`, and the summary names the other timeline |
| Jira | P2-3905 AC6/AC7 must say the same. Note for the PO |

Design note to settle at specify: a generated column cannot read the clock. So the "last step closed" end cannot live in `active_key` alone. One option: the load ends an expired membership lazily, under the lock, before inserting the new one.

### 9.2 Identity and evolution

- A result is identified by `result_code`, which stays the same across phases. `result_id` changes per phase and is the one the feed calls use. `timeline_results` stores both.
- **Premise to verify at specify:** within one `phase_year`, each `result_code` has a single eligible `result_id` (Reporting and IPSR count as the same year, feed OQ-4). Checked with a read-only query on Reporting's test database; the evidence goes into this proposal. If it does not hold, uniqueness uses `result_id`, and evolution still uses `result_code`.
- Snapshots are stored so that the history of one `result_code` can be read across years, cycles and timelines with one query.

### ADDED

- A preview of a step-1 load: counts by program and type, KP groups, skips by reason.
- A manual, asynchronous load with persisted status and progress, a summary, and idempotent re-runs.
- Intake in Reporting for every result loaded, before its details are read.
- An immutable snapshot per loaded result, in DynamoDB.
- The membership rule of § 9.1, enforced by a unique index.
- Audit and log of each load.

### MODIFIED

- `TIMELINE_LOADS` answers from real data (Q5).
- The timeline edit judges `hasLoad` under the timeline lock, and a running load counts toward the scope lock.
- PRD US-4: "open a batch and see its results arrive automatically" becomes "load step 1 of a timeline manually, as often as needed while it is open".
- D-2 is made concrete: active membership instead of overlapping dates.

### REMOVED

- ADR-005's `IngestionRun` in DynamoDB, for this flow. The run record is `timeline_loads` in MySQL.

## 10. Approach Options

**Q6 is answered: Option B** (back lead, 2026-11-04).

| Option | What | Verdict |
|---|---|---|
| A. MySQL only | Snapshot as a JSON table in MySQL behind a port | Not taken: it deviates from ADR-002, and the dev table exists |
| **B. ADR-002** | `timeline_loads` and `timeline_results` in MySQL. Snapshot as an ElectroDB entity in `cgiar-qa-{env}` (pk/sk, us-east-1) | **Chosen** |
| C. Full ADR-005 | B, plus `IngestionRun` in DynamoDB | Not taken: "one running load per cycle" and the membership guard need relational keys |

### 10.1 Snapshot item (proposed; fixed in design)

| Part | Proposal |
|---|---|
| pk | `RESULT#{result_code}` |
| sk | `SNAP#{phase_year}#{cycle_id}#{timeline_id}#{load_id}` (the history of one result is one Query) |
| Attributes | `result_id`, `result_type_key`, lead program `clarisa_id`, `catalog_version`, `hash` of the values, `loaded_at` |
| Values | Everything the feed returns, except what Q3 decides |
| Writes | Insert only, never updated. Written **before** the MySQL row, which stores the snapshot key |
| No cross-store transaction | The key is deterministic, so retrying a lot writes the same item instead of creating orphans. A snapshot with no MySQL row is ignored |

### 10.2 The run, per lot of 50

1. Drop, in QA, the results with an active membership in another timeline of the cycle.
2. `POST /api/qa/results/intake`. Continue only with `taken`. Each `not_taken` is a skip with its reason as given; `changed: false` is not an error.
3. `POST /api/qa/results/details`.
4. Write the snapshot to DynamoDB.
5. Insert in MySQL. A collision on the unique index is a skip.
6. Update `processed / total`.

Intake comes before details so the program cannot unsubmit the result between the read and the write. Reporting enforces that block, which answers **Q4**.

The engine runs in the same process after the start commits. It holds a **lease** (`heartbeat_at`): a `running` load whose heartbeat is old reads as `failed`, so a restart cannot lock the cycle. Only one load per cycle can be `running`, through a generated `*_key`. The load starts under the timeline lock and bumps `timelines.version`.

## 11. Recommended Approach

Option B with the run of § 10.2. Specify writes into `design.md`:
- the ADR-005 deviation,
- the snapshot key and size decision,
- how the time-based membership end is handled.

The TRD sweep is recorded as a pending item.

Depth: **Standard**, one spec. Preview, run and port swap share the same tables and contract. If the budget at specify goes over ≈ 900 production LOC, split the preview into its own child.

## 12. Risks, Dependencies, And Open Questions

### Risks

| ID | Risk | Mitigation |
|---|---|---|
| R-1 | Intake and release are only on Reporting `performance-refactor`; the feed is on `staging` | **Blocks the T-HITL**, not the build. The fake covers tests. The T-HITL waits until P2-4040 reaches the environment QA calls |
| R-2 | The QA key needs five CLARISA grants: `/api/qa/catalog`, `/api/qa/results`, `/api/qa/results/details`, `/api/qa/results/intake`, `/api/qa/results/release`. Since v1.29, a key without the route is a 401 on **every** route, so field configuration breaks too | Probe each route at specify with the dev key, without pasting it anywhere (KZ-admin-config--cycle-timelines-3; KZ-admin-config--timeline-step-times-1). CLARISA has no screen for grants; they are set by API |
| R-3 | A restart mid-run leaves a load `running` | Lease, and "stale `running` reads as `failed`". Re-runs are idempotent |
| R-4 | A load and a timeline edit race | Start under the timeline lock and bump `version`; a running load counts toward the scope lock; the edit re-reads `hasLoad` under the lock |
| R-5 | `catalog_version` still differs after the forced reload | One retry, then `failed` with a clear reason |
| R-6 | PRD US-4 asks to validate payloads against the catalog; the brief leaves it to Reporting | Out of scope; the PRD edit says so. Confirm with Angel |
| R-7 | Migration `0007` runs on the shared dev DB on push to `dev` | Additive only; the T-HITL plan states what the checks leave (KZ-admin-config--cycle-timelines-3) |
| R-8 | Unknown batch size (PRD OQ-6) | Preview pages at 200; progress per lot; time measured on dev |
| R-9 | The KP groups need `details`, but the preview only reads the list | The preview calls `details` for KPs only, narrowed to the 9 rule keys |
| R-10 | DynamoDB item limit: 400 KB | Measure the size of `values` on dev with a real lot at specify. If it gets close, gzip or split the item (design decision) |
| R-11 | The table or the IAM access is missing in TEST/PROD | Verify at specify. If missing, ask infrastructure; it blocks the T-HITL, not the build |
| R-12 | A lot can fail **after** intake. Those results are then In QA in Reporting, with no row in QA, and their programs cannot unsubmit them | A re-run picks them up (`changed: false`). Design decides whether a load that ends `failed` releases them, or leaves them for the re-run |
| R-13 | KPs that are "not in QA" or auto-checked are also intaken (§ 12.1). Until Q9 activates their release, they stay In QA in Reporting, and their programs cannot unsubmit them | Ask Angel before the T-HITL. Alternative: intake them only once the Q9 port is active |

### 12.1 KPs: the 2025 rule (classification unchanged)

The three groups stay behind their own port. Source: the old QA, `CGIAR/QA/server/sql/2025/QA_RESULTS_2025/6.kp.sql:1220-1236` and `QA_PROCCES_2025/5.INSERT_VIEW_TO_EVALUATION.sql:343-414`.

| Group | 2025 condition | Proposed in QA |
|---|---|---|
| **Not in QA** | Not MELIA **and** type ≠ `Journal Article` | Not reviewed. Kept as a light row, so totals stay stable. Shown as a total in the preview and the summary |
| **Auto-checked** | `Journal Article` **and** CGSpace year = WoS year **and** ISI = 1 in both **and** peer reviewed = 1 in both **and** accessibility equal in both. A MELIA journal article that meets this counts too | `auto_validated`, with a snapshot |
| **Review** | Any other KP | `pending`, not assessable in step 1, goes to the Lead in step 3 (AC13) |

What changes in this revision:
- `qaed` requires a prior intake. So "not in QA" and auto-checked KPs are intaken as well.
- QA closing them in Reporting with release `qaed` (Q9) sits behind an **inactive port** until Angel confirms (R-13).

Feed keys, all `knowledge_product.*` and none person-bearing:
- `is_melia`, `type`
- `issue_date_cg` / `issue_date_wos`
- `is_isi_cg` / `is_isi_wos`
- `peer_reviewed_cg` / `peer_reviewed_wos`
- `accessibility_cg.accessibility` / `accessibility_wos`

Porting details:
- A `NULL` on either side fails the check.
- The accessibility comparison ignores case and trailing spaces, as MySQL did.

### Open questions

| ID | Question | Owner | Blocks |
|---|---|---|---|
| Q2 | What the assessor sees on a KP waiting for step 3 | Angel | The status value name |
| Q3 | Does the snapshot keep person-bearing keys (`general.lead_contact_person`, `general.created_by`, `innovation_dev.developers` / `collaborators`, `ipsr_step_1.workshop_facilitators`, `knowledge_product.authors`)? | Angel + back lead | **The DynamoDB item design** (whether `details` sends `field_keys`) |
| Q5 | Proposal: a timeline "has a load" when it has at least one membership (active or inactive) or at least one `completed` load | Back lead + Angel | The `TIMELINE_LOADS` query |
| Q7 | Does the 2025 KP rule hold unchanged for 2026? | Angel | The classifier's adapter |
| Q9 | Should QA close "not in QA" and auto-checked KPs in Reporting with release `qaed`? | Angel | Activating the inactive port (R-13) |
| Q10 | Does an active membership end when QA releases the result, or when the timeline's last step closes? | Angel | The end condition of `active_key` (§ 9.1) |
| Q11 | Can a result whose membership in this timeline **ended** come back into the **same** timeline on a later load? Proposal: no, only into a later timeline | Back lead + Angel | The skip reason of a re-run |

Answered since revision 1:
- **Q1:** the 2025 rule.
- **Q4:** intake blocks the unsubmit (§ 10.2).
- **Q6:** Option B.
- **Q8:** intake sets `in_qa`.

### Premises checked at specify (evidence goes back into this proposal)

| # | Check | Result (2026-11-04; detail in `design.md` § 11) |
|---|---|---|
| P-1 | One eligible `result_id` per `result_code` within a `phase_year` | **Holds on TEST.** Every page of the feed (Reporting TEST, `phase_year=2026`): 33 results, 33 distinct `result_id`, 33 distinct `result_code`, 0 codes with more than one id. Used the feed rather than the database (the feed is the primary source of what QA receives; no DB credentials needed). PROD is unverified; `DUPLICATE_RESULT_CODE` guards it (DD-11) |
| P-2 | `values` size of a real lot | One `details` lot per type on TEST: largest item **9.5 KB** (a KP), far below 400 KB. No compression needed; gzip only above 256 KB (DD-12) |
| P-3 | `cgiar-qa-{env}` exists, and the host IAM role can reach it | `cgiar-qa-test` is `ACTIVE` (pk/sk, on demand, no GSI). The local credentials get `AccessDenied` on `cgiar-qa-dev` / `cgiar-qa-prod`. Host IAM: ask infrastructure |
| P-4 | The QA key holds the five route grants | All five routes pass auth on Reporting TEST (catalog and list 200; details, intake and release 400 on an empty body). Whether TEST already enforces v1.29's grant check is unverified (`design.md` P-5) |

## 13. Success Criteria

- An ADMIN loads step 1 of a timeline in its scope for `cycles.year`, sees the preview, progress and summary, and no tech-team step is needed (M1 for loads).
- Re-running a completed or failed load adds only new results and never duplicates anything (unique index and an e2e test).
- A result active in timeline X is skipped as `ACTIVE_IN_OTHER_TIMELINE` by any other timeline of the cycle. Once that membership ends, it can enter a later timeline with a new snapshot.
- Every loaded result has one snapshot, and the history of a `result_code` comes back with one query.
- After the first load, the timeline leaves `waiting_for_load` and the scope locks; the timeline-edit test suite passes unchanged.
- A load after step 1 `closesAt` is refused.
- The API key never appears in logs (a test asserts it); no PII in the `admin_config` log line.

## 14. Next Step

```text
/akili-specify ingestion/step-1-loads
```

Q3 must be answered before the DynamoDB item is designed. Premises P-1 to P-4 are checked during specify.
