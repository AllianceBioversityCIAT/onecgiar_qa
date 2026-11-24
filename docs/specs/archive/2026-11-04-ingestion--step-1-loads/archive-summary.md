# Archive Summary — ingestion/step-1-loads

**Outcome:** delivered. An ADMIN loads Reporting results into step 1 of a timeline on demand (preview, start, progress, history), with one running load per cycle and one active membership per result per cycle enforced by MySQL unique keys, and a DynamoDB snapshot per membership. Proven live on dev (T-12). A follow-up corrected the KP rule after the build.

## Document Control

| Field | Value |
|---|---|
| Original spec path | `docs/specs/ingestion/step-1-loads` |
| Archive date | 2026-11-04 |
| Final status | **Complete** — 12 / 12 tasks `[x]` (11 build tasks with a Reviewer PASS, T-12 with the back lead's human PASS), plus the KP-rule follow-up |
| Jira | P2-3905 (step 1 loads); comments on P2-3905 / P2-3906 for the KP correction |
| Branches | `feat/step-1-loads` and `fix/ingestion-kp-rules`, both merged `--no-ff` into `staging-center` and `dev`. `staging-center → staging` waits for Yeck's OK |
| Approval mode | gated |
| Archived without | `test-report.md` and `validation-report.md` — absence **accepted by the back lead on 2026-11-04**. The evidence that stands in is below |

## Requirements Delivered

| Requirement | Delivered | Evidence |
|---|---|---|
| FR-1 Preview (no writes, every page, scope) | ✅ | T-7; HITL #2 (counts unchanged) |
| FR-2 Start, window, one running load per cycle, safe retry | ✅ | T-4, T-5, T-7, T-9; HITL #3 (202 + 409, 1 `running` row) and #10 (`ER_DUP_ENTRY`) |
| FR-3 Lots, intake before details, re-run | ✅ | T-8; HITL #7 (re-run loads 0) |
| FR-4 One active membership per `(cycle, result_code)`, collision named | ✅ | T-2, T-4, T-5, T-8; HITL #8 and #10 |
| FR-5 Two phases (intake, then details) | ✅ | T-2, T-8 |
| FR-6 Snapshots, retry of a lot, history | ✅ | T-3, T-8; HITL #6 (33 items, keys match) |
| FR-7 KP groups | ✅ **amended** — a KP to review is assessed in step 1 (S-9 corrected 2026-11-04) | T-4; follow-up `abe5e6e` |
| FR-8 Error kinds (4xx at once, 5xx retried) | ✅ | T-1, T-8 (rework on catalog 4xx) |
| FR-9 Lease and restart | ✅ | T-4, T-5, T-8 |
| FR-10 Progress and history reads | ✅ | T-7, T-9; HITL #4 |
| FR-11 Edit hold and the edit/load race | ✅ | T-10 |
| FR-12 Audit rows with the load id, log line | ✅ (design § 5.3 amended at the T-5 gate) | T-5, T-8, T-9; HITL #5 |
| FR-13 ADMIN only | ✅ | T-9 (6 roles × 4 routes → 403) |
| FR-14 KP release | ✅ **amended** — on, plus re-release on a re-run (2026-11-04) | T-8; follow-up `abe5e6e`, `2e2d2e9` |
| FR-15 Documents | ✅ | T-11 |
| NFR-1 / NFR-2 Key and PII never logged | ✅ | T-1, T-9 privacy suite; HITL log scan (0 hits) |
| NFR-3 Start answers at once | ✅ | T-9 |
| NFR-4 Bounded calls | ✅ | T-1 |
| NFR-5 Throughput | ⚠️ measured on 33 results only (≈ 3.4 results/s); 1,200 not available on TEST (OQ-6) | HITL #4 |
| NFR-6 Integrity by unique keys | ✅ | T-2; HITL #10 |
| NFR-7 Snapshot size | ✅ largest ≈ 10.7 KB | HITL #6 |

## Files Changed Summary

| Area | Files |
|---|---|
| New module | `server/src/ingestion/**` — controller, DTOs, `LoadsService`, `LoadRunner`, store, unit of work, rules, KP classifier, Reporting feed adapter, module guide `AGENTS.md` |
| Persistence | `server/drizzle/0007_timeline_loads.sql` (+ snapshot), Drizzle schemas `timeline-loads.ts` / `timeline-results.ts`, audit actions `load_start` / `load_end`; DynamoDB `ResultSnapshot` entity (`server/src/database/dynamodb/entities/`) |
| Shared | `server/src/users/catalogs/catalog-http.ts` (`postJson`, `UpstreamStatusError`), field-catalog forced refresh, `server/src/common/error-codes.ts` (3 `LOADS_*` codes), `server/src/admin-config/timelines/**` (real "has a load") |
| Tests | Unit and e2e suites under `server/src/ingestion/*.spec.ts`, `server/test/ingestion-*.e2e-spec.ts`, fakes in `server/test/support/` |
| Docs | `front-contract.md`, `docs/prd.md` (US-4, P1, § 5 item 2), `docs/infrastructure.md:29`, `docs/qa-context.md` (KP rule, translated to English) |
| Size | ≈ 4,300 production LOC, ≈ 8,800 test LOC (budget ≈ 4,500 / ≈ 9,000 after two re-estimates) |

## Test Evidence Summary

| Gate | Result |
|---|---|
| Unit (`pnpm test`) | 2,828 passed, 3 skipped (after the follow-up) |
| E2E (`pnpm test:e2e`) | 955 passed |
| Lint / build | clean / green |
| Falsifiers | run red per task in `execution.md`; follow-up falsifiers red, then restored |
| HITL on dev (T-12) | 10 checks, all ✅ — preview, forced double start, completion, counts, audit, DynamoDB, re-run, collision, P-1, MySQL keys |

## Validation Summary

No `/akili-validate` run (accepted). Standing in for it: 17 Reviewer rounds (2 FAILs reworked to PASS: T-5, T-8), the T-11 docs-against-code review, and the T-12 human gate.

## Accepted Warnings Or Follow-Ups

| # | Follow-up | Owner |
|---|---|---|
| 1 | `staging-center → staging` | Yeck (OK) |
| 2 | Confirm on Jira: P2-3905 AC13 and P2-3906 AC6 corrections, S-4, and `qaed` vs `not_qaed` for "Not in QA" KPs | Angel |
| 3 | Live check of the KP release on dev (needs a new admin token, kept in a file, never in chat) | Back lead |
| 4 | NFR-5 at 1,200 results (OQ-6); P-1 on PROD | Back lead |
| 5 | Guide, TRD and ADR edits — recorded as pending items in `docs/specs/kaizen/ingestion--step-1-loads.md` | Apply phase on `staging` |
| 6 | `akili doctor --agents --fix` (persona drift at start) | `staging` |
| 7 | PRD wording: line 10 "automatic ingestion" and "batch" wording in P2, P3, M2, US-1, US-11 (T-11 advisory) | Next PRD pass |
| 8 | The `awaits_step` column stays in `0007`, always null | Accepted |

## Historical Notes

- **Two budget re-estimates** (T-5, T-8): test LOC grew from 1,800 to 9,000. Both were escalated and approved.
- **Two spec amendments at gates**: the KP key count is 10 (T-4), and `load_end` carries the load `id` (T-5, FR-12).
- **KP rule correction after T-12**: the build followed P2-3905 AC13 ("a KP to review waits for step 3"). The back lead corrected it: it is assessed in step 1. The release of "Not in QA" and auto-validated KPs was switched on. A gap found then (a failed release left KPs locked on a re-run) was fixed in the same branch.
- The admin token was pasted into the chat during T-12 (recurrence of KZ-admin-config--cycle-timelines-3). It never reached the repo.

## Diagrams

None (the spec has no `diagrams/` folder and no diagram slot).
