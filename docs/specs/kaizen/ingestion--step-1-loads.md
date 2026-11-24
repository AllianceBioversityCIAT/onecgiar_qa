# Kaizen Entry — ingestion/step-1-loads

## Document Control

| Field | Value |
|---|---|
| Spec Path | `ingestion/step-1-loads` |
| Date | 2026-11-04 |
| Branch | fix/ingestion-kp-rules (spec branch; apply-capable branch: `staging`) |
| Archive Run | 1 |
| Approval Mode | gated |

## Metrics

| Signal | Value | Source |
|---|---|---|
| Tasks executed | 11 build tasks + T-12 HITL, plus one follow-up outside the triad (KP rule) | tasks.md, execution.md |
| Reviewer FAIL rework attempts | 2 (T-5 ×1: lock-order / concurrency lens; T-8 ×1: a catalog 4xx retried as 5xx) | execution.md — T-5, T-8 attempt 1 |
| HALTs / FATAL_FAILs | 0 | execution.md |
| Pivots | 0 | execution.md |
| Spec amendments at gates | 2 (T-4 KP key count 9 → 10; T-5 FR-12 tension, `load_end` gains `id`) | execution.md — Gate after T-4, Gate during T-5 |
| Budget tripwires | 2 fired (T-5, T-8), 1 pre-empted (T-4). Test LOC 1,800 → 9,000; production 1,450 → 4,500; review rounds 14 → 20 | execution.md — T-5, T-8 tripwire blocks |
| Implementer spawns past the 60-call bound without a checkpoint | 2 (T-5: 88 calls; T-9: 78 calls) | execution.md — T-5 / T-9 spawns lines |
| PRODUCT_BUGs | n/a (no `test-report.md`, accepted) | — |
| Validation FAIL / WARN | n/a (no `validation-report.md`, accepted) | — |
| Tasks closed under `REVIEW_WAIVED` | 0 | execution.md |
| Tasks closed under `REVIEW_SKIPPED` | 0 | execution.md |
| Escaped defects (§3) | 2 after closure, both in reviewed tasks: (a) the KP rule (FR-7 / S-9) built from P2-3905 AC13 was wrong — found at archive; (b) with the release switched on, a failed release left KPs locked on a re-run (T-8 path, dormant while off) | execution.md — Follow-up after T-12 |
| Credentials pasted in chat | 1 (admin access token, T-12) | execution.md — T-12 back lead decisions |
| Drift attributable | none recorded (no drift report) | docs/specs/audits/ |

## Lessons

- **KZ-ingestion--step-1-loads-1 — Business choices marked "BA to confirm" passed every gate and were built unconfirmed; one was wrong.** (Product + Methodology, Medium)
  - Root cause: requirements Document Control said "BA confirmation: Pending (Angel)" for S-4, S-5, S-8 and S-9, and S-9 copied P2-3905 AC13 ("a KP to review waits for step 3") verbatim. Nothing in specify, the requirements gate, execute or the HITL plan required those rows to be confirmed, or explicitly accepted by name, before code was written on them. The back lead read them for the first time at archive and corrected S-9 and S-8, which reopened code, tests, four spec documents and two Jira tickets.
  - Evidence: requirements.md — Document Control "BA confirmation" and the S-table (original rows); execution.md — Follow-up after T-12 (decisions); Jira P2-3905 comment 44591, P2-3906 comment 44592.
  - Standardization: → P1 (local template) and P2 (upstream)

- **KZ-ingestion--step-1-loads-2 — The Implementer treated the 60-call checkpoint bound as optional when it finished green.** (Methodology, Low)
  - Root cause: `implementer.md` was reported CURRENT by `akili doctor --agents`, and still two spawns ran past the bound (88 and 78 calls) without a checkpoint. The T-5 report says why: "I exceeded the 60-tool-call bound but finished verified, so no checkpoint." The persona states the bound but not that finishing green does not waive it, so the bound reads as a stall guard, not a context budget.
  - Evidence: execution.md — T-5 attempt 1 spawns line and Not Done quote; T-9 spawns line ("recurrence of the T-2 signal").
  - Standardization: → P3 (upstream)

## Noted, not a lesson

- The KP release gap (b above) was found by the Leader while switching the release on, not by a Reviewer: the code path was dormant behind `KP_RELEASE_ENABLED = false`, so no review exercised a failed release followed by a re-run. A dormant path switched on later deserves its own failure-mode check. Recorded once; a recurrence makes it a lesson.
- `npx tsc --noEmit -p tsconfig.json` reports pre-existing type errors in `server/src/auth/token-verifier.service.spec.ts` (`aws-jwt-verify/jwk` types). The suites pass because Vitest does not type-check. This touches KZ-auth--user-management--core-1 (the gate does not type-check spec files) — check at apply whether its standardization landed.
- Escaped defect after archive (2026-11-05): design § 7.1 treated every non-401 Reporting 4xx at preview/start as our defect (500), but Reporting answers 404 for a year with no QA catalog — a data case the same repo already maps to 409 in field-config (`FIELD_CONFIG_CATALOG_MISSING`). Found on qatest with a test cycle of year 2084; fixed as 409 `LOADS_CATALOG_MISSING` (execution.md — Follow-up 2026-11-05). Recurrence feed: an upstream status a sibling module already types should be checked when a new adapter maps the same API.
- Persona drift at start (`leader.md`, `reviewer.md`, `tester.md` OUTDATED) was not fixed on the branch; `akili doctor --agents --fix` is listed as a follow-up for `staging`.

## Pending Items

### P1

| Field | Value |
|---|---|
| Kind | standardization |
| Target | `docs/specs/general-setup/requirements.md` — Document Control / assumptions table guidance |
| Edit | "A business choice marked 'BA to confirm' blocks `/akili-execute` of the tasks that build on it: before the first such task, record the BA's answer in the row, or the back lead's explicit acceptance by row ID ('S-9 accepted as default by <name>, <date>')." |
| Severity | Medium |
| Status | pending |

### P2

| Field | Value |
|---|---|
| Kind | upstream |
| Target | methodology |
| Edit | `/akili-specify` requirements gate and `/akili-execute` Step 1: a requirement row whose owner column reads "to confirm" makes every task that covers it ineligible until the row carries a confirmation or a named acceptance; the gate lists those rows at approval instead of approving them silently. |
| Severity | Medium |
| Status | pending |

### P3

| Field | Value |
|---|---|
| Kind | upstream |
| Target | methodology |
| Edit | `implementer.md` spawn budget: "Reaching 60 tool calls is a checkpoint even when the work is green: report `STATUS: CHECKPOINT` (or the completion report, if you are done at that call). Finishing verified after the bound does not waive it." |
| Severity | Low |
| Status | pending |

### P4

| Field | Value |
|---|---|
| Kind | digest-update |
| Target | KZ-auth--user-management--core-2 |
| Edit | Add source `ingestion/step-1-loads`: the budget again sized test code flat (1,800) against a spec whose gates were a 6-role × 4-route 403 matrix, a lock-emulating in-memory world and a 29-test retry/lease matrix; two tripwires fired (T-5, T-8) and test LOC closed at ≈ 8,800 (×4.9). Recurrence 2 — raise severity to High. |
| Severity | High |
| Status | pending |

### P5

| Field | Value |
|---|---|
| Kind | digest-update |
| Target | KZ-admin-config--cycle-timelines-3 |
| Edit | Add source `ingestion/step-1-loads`: the T-12 plan named the handover (a file outside the repo), but the user pasted the access token into the free-text answer of the question that asked how to hand it over. Third occurrence. Proposed sharpening: ask for the token file to exist before the question, and offer no free-text path. Raise severity to Medium. |
| Severity | Medium |
| Status | pending |

### P6

| Field | Value |
|---|---|
| Kind | guide-sync |
| Target | root `AGENTS.md` § Module Guides (after the `server/src/admin-config/AGENTS.md` line) |
| Edit | "  - `server/src/ingestion/AGENTS.md` — step-1 loads from Reporting: routes, the load runner (lots, retries, lease), memberships and snapshots, KP rule and release." |
| Severity | Medium |
| Status | pending |

### P7

| Field | Value |
|---|---|
| Kind | guide-sync |
| Target | `server/AGENTS.md` — Overview stack line (line 7) and § Layout / `src/app.module.ts` row |
| Edit | Stack: "ElectroDB + DynamoDB (snapshots, not used yet)" → "ElectroDB + DynamoDB (result snapshots, `ResultSnapshot`)". Layout: add the row "`src/ingestion/` — step-1 loads (`IngestionModule`), see its `AGENTS.md`", and name `IngestionModule` in the `app.module.ts` row. |
| Severity | Medium |
| Status | pending |

### P8

| Field | Value |
|---|---|
| Kind | guide-sync |
| Target | `server/src/database/AGENTS.md` — lines 14, 58 and the `0003` / `timeline_audit_events` notes |
| Edit | Add `0007_timeline_loads.sql` to the migration list. Replace the `0003` note that says `timeline_loads` / `timeline_results` are not created (they exist since `0007`, with the unique keys `running_key`, `active_key` and `(timeline_id, result_code)`). `timeline_audit_events.action` adds `load_start`, `load_end`. Line 58 → "DynamoDB entities live in `dynamodb/entities/` (first: `ResultSnapshot`), built from the exported client and table name." |
| Severity | Medium |
| Status | pending |

### P9

| Field | Value |
|---|---|
| Kind | trd-adr |
| Target | `docs/trd/trd.md` — supersedes **ADR-005** ("Ingestion as in-process background runs, recorded in DynamoDB") |
| Edit | Decision: step-1 loads are manual, per timeline step, and run in-process in the background. The run record is `timeline_loads` in MySQL (one running load per cycle by a unique key, heartbeat lease of 5 min), not an `IngestionRun` item in DynamoDB. DynamoDB keeps only `ResultSnapshot` (pk `RESULT#{result_code}`, sk `SNAP#{phase_year}#{cycle:06}#{timeline:08}#{load:010}`, no GSI). No automatic load when a batch opens. Evidence: step-1-loads design DD-1, § 5; TRD rows to refresh at the same time: § 5.1 (`timeline_loads`, `timeline_results` real since `0007`; audit actions `load_start` / `load_end`), § 5.2 (`IngestionRun` row), module table (`ingestion` stores), § 6 flow step 1 ("Admin opens batch → IngestionRun"). Also D-2 made concrete: at most one active membership per `(cycle, result_code)`. |
| Severity | Medium |
| Status | pending |
