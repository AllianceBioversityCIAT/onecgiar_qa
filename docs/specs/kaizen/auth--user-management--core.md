# Kaizen Entry — auth/user-management/core

## Document Control

| Field | Value |
|---|---|
| Spec Path | `auth/user-management/core` |
| Date | 2026-10-19 |
| Branch | feat/auth-user-management |
| Archive Run | 1 |
| Approval Mode | gated |

## Metrics

| Signal | Value | Source |
|---|---|---|
| Tasks executed | 10 (+ 4 follow-ups: T-1 DD-12, T-1 type fix, T-6 DD-15, T-7 live-grant) | tasks.md, execution.md |
| Reviewer FAIL rework attempts | 6 (T-5 ×1 log-spy coverage; T-8 ×1 403 matrix; T-9 ×1 refusal test + false doc statements; DD-15 ×1 Leader spec wording; T-10 ×1 record; validation remediation ×1 doc statements) | execution.md |
| HALTs / FATAL_FAILs | 0 | execution.md |
| Pivots | 0 (4 user-approved design amendments DD-12…DD-15 instead) | design.md § 10 |
| PRODUCT_BUGs | n/a (no `test-report.md`) | — |
| Judgment-day severe findings | n/a | — |
| Validation FAIL / WARN | 0 / 29 (all R-A/R-B fixed; R-C residual) | validation-report.md |
| Tasks closed under `REVIEW_WAIVED` | 0 | execution.md |
| Tasks closed under `REVIEW_SKIPPED` | 0 | execution.md |
| Escaped defects (§3) | 0 against skipped tasks; 1 escaped from T-1 (spec-file type errors found in T-4) | execution.md — T-1 follow-up fix |
| Budget | ~16,200 LOC vs ~3,200 planned (×5); 23 Reviewer passes vs ~16 | design.md § 2, execution.md Summary |
| Drift attributable | none recorded (no audit report) | docs/specs/audits/ |

## Lessons

- **KZ-auth--user-management--core-1 — The server verification gate did not type-check spec files.** (Product, Medium)
  - Root cause: the AGENTS.md server command (`pnpm lint && pnpm build && pnpm test`) never type-checks `*.spec.ts` — vitest strips types and `tsconfig.build.json` excludes specs — so T-1 shipped two type errors in tests that no gate saw until a reviewer ran `tsc` by hand three tasks later.
  - Evidence: execution.md — T-1 follow-up fix ("Not caught because vitest does not type-check and `pnpm build` excludes specs"); T-4 entry, evidence re-run (9 `tsc` errors, 2 from T-1).
  - Standardization: → P1

- **KZ-auth--user-management--core-2 — The spec budget sized test code at one ratio while the defect-class gates demanded far more.** (Product + Methodology, Medium)
  - Root cause: design § 2 estimated ≈1,800 test LOC flat, but the § 7 defect-class table bound the spec to role × route 403 matrices, lock-emulating concurrency fakes, per-line log spies and fixture-based client tests — each gate is a test suite. The budget was not derived from the gates, so it tripped twice and closed ×5.
  - Evidence: design.md § 2 (original budget); requirements.md § 7 "Defect classes and their gates"; execution.md — budget tripwires after T-4 and T-8.
  - Standardization: → P2 (local template) and P3 (upstream)

- **KZ-auth--user-management--core-3 — Factual statements in docs were written without a check against the code they describe.** (Product + Methodology, Medium)
  - Root cause: guides, contract notes and spec amendments were authored from memory of the change, not re-read against `file:line`; the pre-review sweep in `.agents/leader.md` covers superseded *rules*, not claims *about code*. Four review FAILs were false or contradictory doc statements (resend condition, nullable `invitation`, DD-15 audit wording vs § 7, FR-10 history claim).
  - Evidence: execution.md — T-9 attempt 1 issues 2–3; T-6 amendment DD-15 Reviewer attempt 1; T-10 Review attempt 1 issue 2; validation remediation Review attempt 1 issue 1.
  - Standardization: → P4 (local persona) and P5 (upstream)

## Noted, not a lesson

- Credentials pasted in chat three times (an application password, an access token, temporary passwords in a screenshot); none reached the repo, but the HITL plan had no "how to hand over a token" step until the Leader added one mid-run.
- `utf8mb3` was discovered only at HITL: premise P-7 checked collation, not charset — a premise ledger row named one attribute of the same fact.
- The DD-3 falsifier could not run because `qadb` had a single admin — a HITL step depending on data no premise listed.
- An Implementer report contained a false environment claim (`CognitoAdminClient` "not provided in any module"); caught by the Leader's check, no cost.
- Reviewer-pass arithmetic in the summary over-counted twice before a stated counting rule fixed it.
- The resource guard refused `pnpm build` on low RAM in three tasks; the build stayed owed and was always run before close.

## Pending Items

### P1

| Field | Value |
|---|---|
| Kind | standardization |
| Target | `AGENTS.md` (root) — `## Verification commands` table, `server` row |
| Edit | `cd server && pnpm lint && pnpm build && pnpm test --reporter=dot && npx tsc --noEmit -p tsconfig.json` — and one line under the table: "`tsc -p tsconfig.json` type-checks spec files, which vitest and `pnpm build` skip; record any pre-existing errors as the baseline." |
| Severity | Medium |
| Status | pending |

### P2

| Field | Value |
|---|---|
| Kind | standardization |
| Target | `docs/specs/general-setup/design.md` — budget line guidance |
| Edit | "Derive the test-LOC estimate from the requirements' defect-class gates (one suite per gate: role × route matrices, concurrency fakes, log spies, contract fixtures), not from a production-to-test ratio." |
| Severity | Medium |
| Status | pending |

### P3

| Field | Value |
|---|---|
| Kind | upstream |
| Target | methodology |
| Edit | `/akili-specify` Step 2.4 (budget): size test effort from the defect-class gate table — each gate implies a suite — and show the per-gate estimate beside the total. (Source: KZ-auth--user-management--core-2.) |
| Severity | Medium |
| Status | pending |

### P4

| Field | Value |
|---|---|
| Kind | standardization |
| Target | `.agents/implementer.md` (append-only, under its reporting/verification rules) |
| Edit | "Before reporting any edit to a guide, contract note or spec document, re-read every factual statement you wrote (names, paths, codes, nullability, conditions) against the code at `file:line`; a statement you did not check is not written." |
| Severity | Medium |
| Status | pending |

### P5

| Field | Value |
|---|---|
| Kind | upstream |
| Target | methodology |
| Edit | Extend the Leader's pre-review restatement sweep (`.agents/leader.md`) and the Implementer persona with a **claims check**: every factual statement a task writes about code in a doc is verified at `file:line` before review. (Source: KZ-auth--user-management--core-3.) |
| Severity | Medium |
| Status | pending |

### P6

| Field | Value |
|---|---|
| Kind | guide-sync |
| Target | `AGENTS.md` (root) — `## Module Guides`, users and auth entries |
| Edit | `server/src/users/AGENTS.md` — users, roles, role assignments, program scope and exclusions, permission catalog, `can()`/`canReview`, current-user cache, the admin API (`/users`, `/catalogs`) and audit. · `server/src/auth/AGENTS.md` — Cognito client and admin client (`CognitoAdminModule`), token verification, admission, session cookies, guards and decorators. |
| Severity | Low |
| Status | pending |

### P7

| Field | Value |
|---|---|
| Kind | factual-sweep |
| Target | `server/src/users/AGENTS.md` line 3 |
| Edit | Replace "`docs/specs/auth/user-management/core/` (FR-1…FR-14, DD-1…DD-15)" with "`docs/specs/archive/2026-10-19-auth--user-management--core/` (FR-1…FR-14, DD-1…DD-15)" — the spec folder moved at archive. |
| Severity | Low |
| Status | pending |

### P8

| Field | Value |
|---|---|
| Kind | factual-sweep |
| Target | `docs/ideas.md` lines 38 and 45 |
| Edit | Replace `docs/specs/auth/user-management/core` with `docs/specs/archive/2026-10-19-auth--user-management--core` in both entries. |
| Severity | Low |
| Status | pending |

### P9

| Field | Value |
|---|---|
| Kind | trd-adr |
| Target | `docs/trd/trd.md` § 5.1 (data model) — section sync, supersedes no ADR |
| Edit | `users` gains `nickname` (nullable, unique, case-insensitive by collation), `invitation` (NOT NULL, default `none`), `invited_at`; new tables `user_programs` (no rows = all programs), `user_program_exclusions` (origin/status/history, stored `active_key`, CHECKs; `ended_by` NULL = system end of a reporting exclusion), `user_audit_events` (append-only); `role_assignments.result_type_key = '*'` = all result types. Migration `0001_user_management`. |
| Severity | Medium |
| Status | pending |

### P10

| Field | Value |
|---|---|
| Kind | trd-adr |
| Target | `docs/trd/trd.md` § 6 (API) and § 7 (integrations) — section sync, supersedes no ADR |
| Edit | § 6: 12 `/users` and 3 `/catalogs` routes behind `ADMIN_ACCESS`, `USERS_*` error codes, field-error paths with brackets for array items (`roles[0].role`), list paging in `meta.page.nextCursor`. § 7: Reporting `qa/catalog` with the shared CLARISA key in `x-api-key`; CLARISA `cgiar-entities/by-portfolio?portfolioId=2,3&version=2`; Cognito admin API through IAM (`AdminGetUser`, `AdminCreateUser`). |
| Severity | Medium |
| Status | pending |

### P11

| Field | Value |
|---|---|
| Kind | trd-adr |
| Target | `docs/trd/trd.md` — Architecture Overview & Decisions (new ADR, supersedes none; number allocated at apply time) |
| Edit | An active ADMIN is never blocked by a conflict-of-interest exclusion: `canReview` skips program scope and exclusions for a live ADMIN grant; exclusions stay stored and apply again if ADMIN is revoked. Source: user-management/core DD-13 (back lead, 2026-10-19). |
| Severity | Low |
| Status | pending |

### P12

| Field | Value |
|---|---|
| Kind | trd-adr |
| Target | `docs/trd/trd.md` — Architecture Overview & Decisions (new ADR, supersedes none; number allocated at apply time) |
| Edit | Admin mutations run in one READ COMMITTED transaction: lock the target `users` row, then the ADMIN `roles` row when admins can decrease, then a plain-read admin count (a locking count deadlocks); uniqueness pre-checks are plain reads with the unique index catching races. Source: user-management/core DD-14, DD-15 (3). |
| Severity | Low |
| Status | pending |
