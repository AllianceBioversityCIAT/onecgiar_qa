# Archive Summary — Cycles and QA timelines

**Outcome:** delivered. The server backend for QA cycles and timelines is merged into `staging-center` (`f95851a`) and deployed to TEST via `dev`. 11 of 11 tasks are closed, and validation found no FAIL.

## 1. Document Control

| Field | Value |
|---|---|
| Spec | Cycles and QA timelines |
| Original spec path | `docs/specs/admin-config/cycle-timelines` |
| Archive date | 2026-10-21 |
| Archived to | `docs/specs/archive/2026-10-21-admin-config--cycle-timelines/` |
| Branch | `feat/cycle-timelines` (merged to `dev` `306ae32`, `staging-center` `f95851a`) |
| Jira | Story P2-3903 · back-end sub-task P2-3933 (implementation comment posted 2026-10-21) |
| Approval mode | gated |

## 2. Final Status

| Check | Result |
|---|---|
| Tasks | 11 / 11 `[x]` (T-11 was added after the T-10 finding) |
| Validation | **WARN**: 9 PASS, 3 WARN, 0 FAIL, 0 BLOCKED (`validation-report.md`). The two documentation WARNs were fixed after validation; the HITL WARN was accepted by the back lead |
| Test report | None (`/akili-test` was not run). Coverage was verified in `validation-report.md`, and the back lead accepted this |
| Back-lead acknowledgments | T-10 run on TEST with the back lead's token, by the back lead's decision: **confirmed 2026-10-21** |

## 3. Requirements Delivered

| Area | Requirements | Delivered as |
|---|---|---|
| Cycles | FR-1, FR-2, FR-3 | `POST /cycles`, `GET /cycles`, `POST /cycles/:id/activate`. One active cycle is enforced by `uq_cycles_active_key`; concurrent activations retry up to 10 times and end in 503, never 500 |
| Timelines | FR-4 to FR-11 | `GET /timeline-defaults`, `POST /cycles/:id/timelines`. Official or additional is decided under the cycle lock. Every rule problem comes back in one 400, and nothing is written on an error |
| Reads | FR-12, FR-13, NFR-5 | `GET /cycles/:id/timelines` and `GET /timelines/:id`. Status, current step and readiness are computed from the Europe/Rome date, with a fixed query count |
| Assignments | FR-14, FR-15 | `POST /timelines/:id/users` (live-grant eligibility; a repeat returns the same row) and `DELETE …/:assignmentId` (soft remove) |
| Cross-cutting | FR-16, FR-17, NFR-1 to NFR-7 | ADMIN-only routes, idempotent creates, a single error catalog, one decision log line per write |

## 4. Files Changed Summary

| Part | Files |
|---|---|
| Schema | `server/src/database/drizzle/schema/{cycles,timelines,timeline-steps,timeline-programs,timeline-result-types,timeline-users}.ts`, migration `server/drizzle/0003_cycle_timelines.sql` plus its snapshot |
| Module | `server/src/admin-config/**`: the cycles and timelines modules, controllers, services, stores, units of work, the pure rules and view, errors, the clock |
| Shared | `server/src/common/error-codes.ts` (8 codes, 7 field codes), `server/src/app.module.ts` |
| Tests | Unit specs per file, `server/test/admin-config-{cycles,timelines}.e2e-spec.ts`, and the lock-modelling fakes in `server/test/support/` |
| Docs | `docs/trd/trd.md` §§ 3–6, root `AGENTS.md`, `server/AGENTS.md`, `server/src/common/AGENTS.md`, `server/src/database/AGENTS.md`, new `server/src/admin-config/AGENTS.md`, `front-contract.md` |
| Size | ≈ 3,600 source LOC and ≈ 8,800 test LOC after T-8 (budget ≈ 1,100 / ≈ 1,300; overrun accepted at the tripwire) |

## 5. Test Evidence Summary

| Gate | Result |
|---|---|
| Unit | 49 files / 1,722 passed |
| e2e | 13 files / 715 passed |
| tsc | 7 errors, all in `src/auth/token-verifier.service.spec.ts` (pre-existing baseline) |
| Real MySQL (TEST) | 20 parallel first creates gave 1 official · 20 parallel identical assigns gave 1 active row · 20 parallel activations gave 1 active cycle · 10 parallel same-year creates gave one 201 and nine 409 · the date round-trip was unchanged · 5 and 10 parallel activations after T-11 gave no 500 |

## 6. Validation Summary

All tasks carry a closing record. Every FR and NFR scenario and every BUT / AND IT MUST clause has code and test evidence. Fixed after validation:
- R-1: the design § 6 activate row now lists 503.
- R-3: the root Module Guides index now lists `server/src/admin-config/AGENTS.md`.
- The `tasks.md` budget header now records the overrun.

## 7. Accepted Warnings and Follow-ups

| Item | Owner / where |
|---|---|
| Permanent test data on TEST: cycles 2077–2099; 2084 is the active cycle; 21 timelines; 1 assignment | Back lead; tell TEST users |
| Collation check (`SHOW FULL COLUMNS FROM users`): are timeline names accent-insensitive on qadb/TEST? | Back lead (needs DB access) |
| 16 validation advisories (A-1…A-16), e.g. two bare `Error` throws giving 500, no 1205 retry, duplicated `StepAudience`, `FieldIssue` still in `users/` | A future change spec |
| The "none active" activation case was not re-run on TEST after T-11 (it cannot be recreated there) | Covered by unit rows and falsifiers |
| Local branch `dev-merge-tmp` | Back lead may delete it |
| `staging-center` → `staging` | Needs the front lead's OK (team rule) |

## 8. Historical Notes

- Execute-time amendments, all approved by the back lead:
  - FR-11 paths (`programIds`).
  - § 7.2 steps 1–2 (absent lists reach the rules; catalogs are read only when needed).
  - § 6 `TimelineCreate`, plus the activate 503.
  - § 7.3 Activate (retry up to 10 attempts, then 503).
  - § 7.4 (six list queries).
  - § 8 wording.
- Reworks: T-6 (a misnamed race test), T-7 (claimed e2e edits that were not in the tree, caught by the evidence re-run), T-8 (pool starvation and a clock mismatch), T-11 (an unregistered error class).
- T-10 ran on TEST rather than `qadb`, by the back lead's choice. The pipeline applied migration `0003`; no agent ran it.
