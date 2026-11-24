# Kaizen Entry — admin-config/timeline-step-times

## Document Control

| Field | Value |
|---|---|
| Spec Path | `admin-config/timeline-step-times` |
| Date | 2026-10-27 |
| Branch | feat/timeline-step-times |
| Archive Run | 1 |
| Approval Mode | gated |

## Metrics

| Signal | Value | Source |
|---|---|---|
| Tasks executed | 7 build tasks + 1 follow-up (F-1); T-8 (HITL) partly done | tasks.md, execution.md |
| Reviewer FAIL rework attempts | 2 (T-6 ×1: the "agree" test sent pairs that disagree; T-7 ×1: the contract left out the load hold) | execution.md — T-6, T-7 |
| HALTs / FATAL_FAILs | 0 | execution.md |
| Pivots | 1 (T-3: P-3 false, `drizzle-kit --custom` snapshot) | execution.md — Pivot Record: T-3 |
| Spec amendments at gates | 4 (design § 7.2 key family; FR-5 GIVEN; T-6 NFR-2 grep filter; T-6 NFR-4 wording) | execution.md — T-4, T-5, T-6 |
| Checkpoints | 1 (F-1: the local resource guard refused e2e for lack of RAM) | execution.md — F-1 |
| PRODUCT_BUGs | n/a (no `test-report.md`) | — |
| Validation FAIL / WARN | 0 / 9 | validation-report.md |
| Tasks closed under `REVIEW_WAIVED` | 0 | execution.md |
| Tasks closed under `REVIEW_SKIPPED` | 0 | execution.md |
| Escaped defects (§3) | 0 against skipped tasks. 1 escaped from reviewed T-4/T-5: OpenAPI `required` still listed `opensOn` / `closesOn` (found by T-7's cross-check, fixed in F-1) | execution.md — T-7, F-1 |
| Budget | ≈ 704 production / ≈ 2,370 test LOC vs ≈ 450 / ≈ 900; 11 review rounds vs ≈ 10 | validation-report.md, execution.md |
| Drift attributable | none recorded (no audit report) | docs/specs/audits/ |

## Lessons

- **KZ-admin-config--timeline-step-times-1 — A High-impact `UNVERIFIED` tooling premise was left for an execute task to settle.** (Methodology, High)
  - Root cause: design § 11 marked P-3 ("`drizzle-kit generate --custom` writes a snapshot of the current schema") `UNVERIFIED`, High impact, and scheduled the check as T-3's first step. It took one command to settle, but it was not run at specify time. When it failed, a whole implementation attempt already sat in the tree, and the pivot needed a human interactive step in the middle of the task. (The product half is already standardized: `server/src/database/AGENTS.md` now warns against `--custom` for column changes.)
  - Evidence: design.md § 11 P-3 (original row, amended); execution.md — Pivot Record: T-3.
  - Standardization: → P1 (upstream)

- **KZ-admin-config--timeline-step-times-2 — Verification commands and scenario preconditions in the spec were never run against HEAD at specify time.** (Product + Methodology, Medium)
  - Root cause: tasks.md wrote T-6's NFR-2 grep with a filter (`grep -v '^\S*:\s*//'`) that cannot match `grep -rn` output (`file:line:` prefix), so it would have counted two lines where NFR-2 wants one. FR-5's GIVEN left out the load that FR-7's hold requires. Design § 7.2 ("Neither, on create → `…At`") contradicted e2e expectations that already existed. Each needed a gate amendment, and the FR-5 gap caused T-7's rework.
  - Evidence: execution.md — T-5 forward pointer and T-6 spec edit (grep filter); T-4 spec tension (§ 7.2); T-6 attempt 1 verdict and T-7 attempt 1 FAIL (FR-5 load).
  - Standardization: → P2 (local template) and P3 (upstream)

- **KZ-admin-config--timeline-step-times-3 — The OpenAPI pins for request DTOs checked properties but not the `required` list.** (Product, Medium)
  - Root cause: T-4 made `opensAt` / `closesAt` optional, but `opensOn` / `closesOn` kept the default `required` of `@ApiProperty`. T-5's pin checked types, examples and `deprecated`, never `required`, so the generated contract forced day-only keys that the server does not need. A cross-check found it two tasks later, and it cost an extra round (F-1).
  - Evidence: execution.md — T-7 attempt 1 (finding classified (b)); F-1 red run (`TimelineStepDto.required … to not include 'opensOn'`).
  - Standardization: → P4

## Noted, not a lesson

- The dev pipeline applies migrations on push (`docs/infrastructure.md:39`), while the spec treated migration as a human step only (P-12, `server/src/database/AGENTS.md:49-50`). Merging to `dev` therefore ran `0006` on the shared dev database before T-8's local round-trip. Below the lesson bar here; related to KZ-admin-config--cycle-timelines-3 (no data-impact plan for HITL against shared environments). Watch for a recurrence.
- The local resource guard (RAM) blocked e2e runs and caused one checkpoint (F-1). It was environmental and fixed by freeing memory.
- The NFR-2 grep's own filter (`^\S*:[0-9]+:\s*(//|/\*|\*)`) would drop a code line that starts with a block comment and then carries the literal. Unlikely; noted by the T-6 Reviewer.

## Pending Items

### P1

| Field | Value |
|---|---|
| Kind | upstream |
| Target | methodology |
| Edit | `/akili-specify` premise ledger: a premise marked `UNVERIFIED` with **High** impact whose check is a single command (tool behavior, a CLI flag, a generator's output) is probed during specify, and its row records the command and result. Only premises that need a human, credentials or a shared environment may be deferred to a task. |
| Severity | High |
| Status | pending |

### P2

| Field | Value |
|---|---|
| Kind | standardization |
| Target | `docs/specs/general-setup/task.md` |
| Edit | Add to the task template's Verification notes: "Every grep or command written here was run once against HEAD while specifying, and its current output is quoted (expected count included)." |
| Severity | Medium |
| Status | pending |

### P3

| Field | Value |
|---|---|
| Kind | upstream |
| Target | methodology |
| Edit | `/akili-specify` tasks gate: dry-run each task's verification command against HEAD and quote its output. A scenario whose THEN states a status lists every precondition the status rules use (e.g. "the timeline has a load"). |
| Severity | Medium |
| Status | pending |

### P4

| Field | Value |
|---|---|
| Kind | standardization |
| Target | `server/test/AGENTS.md` |
| Edit | Add: "An OpenAPI pin for a request DTO asserts its `required` list as well as its properties; `@ApiProperty` defaults to required, so every `@IsOptional()` property sets `required: false`." |
| Severity | Medium |
| Status | pending |

### P5

| Field | Value |
|---|---|
| Kind | digest-update |
| Target | KZ-auth--user-management--core-1 |
| Edit | Recurrence: `admin-config/timeline-step-times` — DD-3's `@ts-expect-error` gate (`rome-date.spec.ts`) was proven only by a hand-run `tsc`, because no gate type-checks spec files and two existing `tsc` errors still block a typecheck command. Add this spec as a source; raise to High (second recurrence of an unfixed gate). |
| Severity | High |
| Status | pending |

### P6

| Field | Value |
|---|---|
| Kind | digest-update |
| Target | KZ-auth--user-management--core-2 |
| Edit | Recurrence: `admin-config/timeline-step-times` — test LOC ≈ 2,370 vs ≈ 900 planned (×2.6), driven by the two-zone and per-clause gates. Add this spec as a source. |
| Severity | Medium |
| Status | pending |

### P7

| Field | Value |
|---|---|
| Kind | factual-sweep |
| Target | `docs/trd/trd.md` (module table, `admin-config` row, line ~149) |
| Edit | Replace "dates are `Europe/Rome` calendar days" with "step boundaries are `Europe/Rome` wall-clock minutes (`QA_TIME_ZONE`); cycle spans stay calendar days (spec `admin-config/timeline-step-times`)". |
| Severity | Medium |
| Status | pending |

### P8

| Field | Value |
|---|---|
| Kind | factual-sweep |
| Target | `docs/trd/trd.md` (data model, `timeline_steps` row, line ~178) |
| Edit | Replace "opens_on, closes_on (`date`, Rome calendar days) … CHECKs: closes_on ≥ opens_on" with "opens_at, closes_at (`datetime`, Rome wall-clock minute, migration `0006`) … CHECKs: closes_at > opens_at". |
| Severity | Medium |
| Status | pending |
