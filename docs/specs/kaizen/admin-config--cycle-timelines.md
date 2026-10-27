# Kaizen Entry — admin-config/cycle-timelines

## Document Control

| Field | Value |
|---|---|
| Spec Path | `admin-config/cycle-timelines` |
| Date | 2026-10-21 |
| Branch | feat/cycle-timelines (spec branch; apply-capable branch is `staging`) |
| Archive Run | 1 |
| Approval Mode | gated |

## Metrics

| Signal | Value | Source |
|---|---|---|
| Tasks executed | 11 (10 planned + T-11 added from the T-10 finding) | tasks.md |
| Reviewer FAIL / implicit FAIL rework attempts | 4: T-6 ×1 (misnamed race test), T-7 ×1 (implicit FAIL: claimed e2e edits not in tree), T-8 ×1 (pool starvation, clock mismatch, disqualified fixture), T-11 ×1 (unregistered error class) | execution.md |
| Checkpoints | 1 (T-8, calls bound) | execution.md |
| HALTs / FATAL_FAILs | 0 | execution.md |
| Pivots | 1 light (T-10 finding → § 7.3 amended, T-11 added) plus 6 user-approved execute-time amendments | execution.md, design.md |
| PRODUCT_BUGs | n/a (no `test-report.md`) | — |
| Escaped defects | 1: a concurrent activation answered 500 on real MySQL (T-10, HITL) after T-5 passed every fake-based gate | execution.md — T-10 |
| Validation FAIL / WARN | 0 / 3 (2 fixed, 1 accepted) | validation-report.md |
| Tasks closed under `REVIEW_WAIVED` | 0 | execution.md |
| Tasks closed under `REVIEW_SKIPPED` | 0 | execution.md |
| Budget | ≈ 14,000 LOC vs ≈ 2,600 planned (×5.4); 18 Reviewer verdicts vs 14 | execution.md — Budget Tripwire, Summary |
| Drift attributable | none (no audit report) | docs/specs/audits/ |

## Lessons

- **KZ-admin-config--cycle-timelines-1 — A "retry once" on a unique-key race was designed and accepted on fakes, and failed on real InnoDB.** (Product + Methodology, High)
  - Root cause: design § 7.3 claimed that "two activations serialize on the active row" and later amended it to one retry. The in-memory fake re-checks under its own lock model, so it can never produce the InnoDB case where a waiter's locking read finds the row already closed and races the unique key again. Every unit and e2e gate passed, the T-5 Reviewer flagged "one retry may not be enough" as advisory only, and the defect escaped to HITL (one 500 in five concurrent activations).
  - Evidence: execution.md — T-5 Reviewer A advisory (RESILIENCE); T-10 table, row "Added at T-5"; T-11 entry.
  - Standardization: → P1 (local), P2 (upstream)

- **KZ-admin-config--cycle-timelines-2 — Implementer reports listed changes and coverage that the tree did not hold.** (Product + Methodology, Medium)
  - Root cause: the report contract asks for "files changed" and test coverage in prose. Nothing requires the literal `git diff --stat`, or a test name that matches what the test exercises. T-7 attempt 1 reported e2e edits to a file whose diff was empty, and T-6 shipped a test named "a create racing an activation" that ran no activation. Both were caught only by the Leader's re-run or a Reviewer, each costing an attempt.
  - Evidence: execution.md — "T-7 … in progress" (MISMATCH); T-6 Attempt 1 Reviewer A FAIL.
  - Standardization: → P3 (local), P4 (upstream)

- **KZ-admin-config--cycle-timelines-3 — HITL steps against a shared environment had no credential-handover or data-impact plan.** (Product, Low)
  - Root cause: T-10's scope named the checks but not who holds the admin token, how it reaches the script, or what permanent data the checks leave. On TEST the token was pasted into chat. The checks left 23 permanent cycles and changed TEST's active cycle. The same signal was noted in the previous spec (a token pasted in chat), so this is now a recurrence.
  - Evidence: execution.md — T-10 "Who ran the checks"; kaizen/auth--user-management--core.md — `## Noted, not a lesson` (credentials pasted in chat).
  - Standardization: → P5

## Noted, not a lesson

- No `## Constitution Impact` block was written when T-5 created the `admin-config` module. The guides were created in T-9 instead, so nothing went stale, but the archive had to infer the impact.
- The Leader flipped T-10 to `[x]` without a closing record and reverted it in the next commit. The Step 3 rule held only because it was noticed.
- Two LOC tripwire signals were visible at T-5 (a 2,896-line diff) but the tripwire was raised only after T-8.
- The resource guard blocked `pnpm test:e2e` for Implementers four times; the `--maxWorkers=2` fallback or the Leader re-run covered it every time.
- Falsifiers as worded in tasks.md were equivalent mutants twice (T-4 F2; T-6 F1 masked by the backstop). Each time the observable was rescued by a stronger mutant or a different assertion.

## Pending Items

### P1

| Field | Value |
|---|---|
| Kind | standardization |
| Target | `server/src/database/AGENTS.md` — schema guarantees / transaction rules |
| Edit | "A path that retries on a unique-key (1062) or deadlock (1213) race uses a bounded loop with a defined non-500 terminal answer (e.g. 503 retryable), never a single retry; fakes cannot reproduce InnoDB re-reads, so the race also needs a real-MySQL check in the spec's HITL task." |
| Severity | High |
| Status | pending |

### P2

| Field | Value |
|---|---|
| Kind | upstream |
| Target | methodology |
| Edit | Reviewer persona / execute Step 2.3: a RESILIENCE advisory that names a concrete failure under concurrency on the real datastore (not reproducible by the fakes) is escalated by the Leader to the spec's HITL task as an added check, recorded in that task's brief — not left as an advisory that dies in execution.md. |
| Severity | High |
| Status | pending |

### P3

| Field | Value |
|---|---|
| Kind | standardization |
| Target | `.agents/implementer.md` (append-only, under its reporting rules) |
| Edit | "The report's files-changed list is the literal `git diff --stat` plus `git status --porcelain` output taken after your last edit; a test's name states only what its body exercises." |
| Severity | Medium |
| Status | pending |

### P4

| Field | Value |
|---|---|
| Kind | upstream |
| Target | methodology |
| Edit | Implementer report contract: require pasted `git diff --stat` / `git status --porcelain` evidence for the files-changed field (a claim without it is an implicit FAIL at the Leader's evidence re-run). |
| Severity | Medium |
| Status | pending |

### P5

| Field | Value |
|---|---|
| Kind | standardization |
| Target | `docs/specs/general-setup/task.md` — HITL task fields |
| Edit | Add a HITL line: "Access & impact: who holds the credential and how it reaches the check (env var in the human's own shell, never chat); the permanent data the check leaves on a shared environment, and whether that is acceptable." |
| Severity | Low |
| Status | pending |

### P6

| Field | Value |
|---|---|
| Kind | digest-update |
| Target | KZ-auth--user-management--core-2 |
| Edit | Add source spec `admin-config/cycle-timelines` (≈ 14,000 LOC vs ≈ 2,600; tests ≈ 6.8× their estimate, again driven by concurrency fakes, 401/403 matrices and SQL pins). Recurrence 2, so raise the standardization priority of its pending budget-template item (auth entry P2). |
| Severity | Medium |
| Status | pending |

### Archive Step 3 (constitution sync) — no pending items

- **Guide sync and factual sweep:** already written on this spec branch by explicit back-lead instruction (2026-10-21). Root `AGENTS.md`: the `admin-config` domain row and the Module Guides entry. Plus `server/src/admin-config/AGENTS.md` and `server/AGENTS.md`. Sweep of root `CLAUDE.md` / `AGENTS.md`: no other claim falsified (the CodeGraph "not initialized" line is still true).
- **TRD & ADR:** no ADR overturned. DD-1 replaced the § 5.1 data-model rows (done in T-9 as the spec's own deliverable), not an ADR.
- **CodeGraph:** `.codegraph/` is absent, so no re-index applies.
