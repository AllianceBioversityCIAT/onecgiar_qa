# Kaizen Entry — admin-config/field-configuration

## Document Control

| Field | Value |
|---|---|
| Spec Path | `admin-config/field-configuration` |
| Date | 2026-10-27 |
| Branch | feat/field-configuration (spec branch; the apply-capable branch is `staging`) |
| Archive Run | 1 |
| Approval Mode | gated |

## Metrics

| Signal | Value | Source |
|---|---|---|
| Tasks executed | 11 | tasks.md |
| Reviewer FAIL / implicit FAIL rework attempts | 5: T-5 ×1 (a publish overwrote `updated_*`); T-9 ×2 (lint MISMATCH, then a missing FR-7 HTTP case and an overclaiming title); T-10 ×1 (false branch and 5xx-replay claims); R-5 ×1 (false limit math, a test weaker than its claim) | execution.md |
| Checkpoints | 2 (T-8, the resource guard blocked e2e) | execution.md — T-8 |
| HALTs / FATAL_FAILs | 0 | execution.md |
| Pivots | 0. Approved spec amendments: the catalog counts (234 → 504), S-14, DD-8a | execution.md, design.md |
| PRODUCT_BUGs | 0 | test-report.md |
| Escaped defects | 1: the draft edit promised 2,000 items, but the 100 KB body limit refused about 770 or more. Found at `/akili-validate` | validation-report.md — R-5 |
| Validation FAIL / WARN | 0 / 10 (R-1…R-5 fixed, R-6 and R-7 follow-ups) | validation-report.md |
| Tasks closed under `REVIEW_WAIVED` | 1 (T-5, `degraded-pair`, plus an extra Opus review) | execution.md — REVIEW_WAIVED: T-5 |
| Tasks closed under `REVIEW_SKIPPED` | 0 | execution.md |
| Disqualifier waivers | 1 (T-11, an admin token pasted in chat) | execution.md — T-11 Closing |
| Budget | 8,538 non-JSON LOC at T-7 against about 7,000 planned; tripwire lifted | execution.md |
| Drift attributable | none (no audit report) | docs/specs/audits/ |

## Lessons

- **KZ-admin-config--field-configuration-1 — A DTO size bound was promised without checking the transport limit in front of it.** (Product + Methodology, Medium)
  - Root cause: design § 6 set `items` to 1..2,000 from the domain (one year's catalog) and never compared the bound with the 100 KB body parser in `configure-app.ts`. No test sent the maximum over HTTP: the pipe-level 2,001 check ran on a small body, and T-9 recorded "no 2,000 / 2,001 HTTP pair" only as an advisory. The contract went to the front at T-10 and was falsified at `/akili-validate`.
  - Evidence: validation-report.md — § 8 and R-5; execution.md — T-9 advisories and "Remediation after validation".
  - Standardization: → P1 (local), P2 (upstream).
- **KZ-admin-config--field-configuration-2 — Size figures were derived from the catalog without expanding its wildcards.** (Product, Low)
  - Root cause: the design § 5 size check and the T-2 counts summed the per-type fields but left out the `"*"` fields, which apply to every type. That gave 234 rows instead of 504, and T-2 needed a spec amendment.
  - Evidence: execution.md — T-2 (counts amended with the back lead's approval); design.md § 5.
  - Standardization: → P3.

## Noted, not a lesson

- **Recurrence of KZ-admin-config--cycle-timelines-3** (credentials through chat): a Reporting key was pasted at T-2 and an admin token at T-11. T-11 was planned per KZ-3, but the back lead overrode the plan and asked the Leader to run the test. → P4.
- **Recurrence of KZ-admin-config--cycle-timelines-2** (report vs tree): an Implementer's prettier run reformatted the 2026 fixture (5,448 lines, same data) and the report did not list it. The Leader caught it in `git diff --stat`. T-9 attempt 1 linted one file instead of the project. → P5.
- **Recurrence of KZ-auth--user-management--core-3** (doc claims not checked against code): T-10 attempt 1 made a wrong branch claim and said a 5xx replays; R-5 attempt 1 had a limit comment whose math was false. → P6.
- The resource guard blocked e2e twice (T-8, `/akili-test`). Friction only; the guard worked as designed.
- NFR-6 was bounded only with a mocked abort; TEST showed a hang of more than 45 s. Open as R-7. Not a lesson until the cause is known.

## Pending Items

### P1

| Field | Value |
|---|---|
| Kind | standardization |
| Target | `server/test/AGENTS.md` |
| Edit | A DTO that bounds an array or a body (`ArrayMaxSize`, `MaxLength` on a large field) gets one e2e at the maximum over HTTP. The body then crosses the JSON parser limit in `src/common/configure-app.ts`, so the test proves that the transport and the DTO agree. |
| Severity | Medium |
| Status | pending |

### P2

| Field | Value |
|---|---|
| Kind | upstream |
| Target | methodology |
| Edit | `general-setup/design.md` API section: for every declared size bound (array max, body size), state the transport limit it must fit (body parser, gateway, proxy) and add a task that tests the maximum end to end. A domain bound with no transport check is an unverified contract. |
| Severity | Medium |
| Status | pending |

### P3

| Field | Value |
|---|---|
| Kind | standardization |
| Target | `server/src/admin-config/AGENTS.md` |
| Edit | Reporting catalog counts: a field with `result_types: ["*"]` applies to every type; expand it before counting rows (2026: 504 applicable fields over 9 types, not the per-type sum of 234). |
| Severity | Low |
| Status | pending |

### P4

| Field | Value |
|---|---|
| Kind | digest-update |
| Target | KZ-admin-config--cycle-timelines-3 |
| Edit | Add source `admin-config/field-configuration` (a Reporting key at T-2, an admin token at T-11, both through chat despite the plan). Raise severity Low → Medium: a second recurrence ended in a Disqualifier waiver. |
| Severity | Medium |
| Status | pending |

### P5

| Field | Value |
|---|---|
| Kind | digest-update |
| Target | KZ-admin-config--cycle-timelines-2 |
| Edit | Add source `admin-config/field-configuration`: an unreported fixture reformat, and a lint run on one file at T-9. Recurrence noted; severity stays Medium. |
| Severity | Medium |
| Status | pending |

### P6

| Field | Value |
|---|---|
| Kind | digest-update |
| Target | KZ-auth--user-management--core-3 |
| Edit | Add source `admin-config/field-configuration`: T-10 attempt 1 (branch claim, 5xx replay claim) and R-5 attempt 1 (false limit math in a comment). Recurrence noted; severity stays Medium. |
| Severity | Medium |
| Status | pending |

### P7

| Field | Value |
|---|---|
| Kind | factual-sweep |
| Target | `AGENTS.md` (root), line 32 |
| Edit | "field configuration per result type" → "field configuration per cycle (draft, preview and published versions per result type)". |
| Severity | Low |
| Status | pending |

## Archive-time notes

- `server/src/admin-config/AGENTS.md`: the spec link was repointed to the archive path in this run, on the spec branch. The archive move itself broke the link, and the back lead had asked for the guides to be kept current in this spec. This is a deliberate exception to the spec-branch write gate.
