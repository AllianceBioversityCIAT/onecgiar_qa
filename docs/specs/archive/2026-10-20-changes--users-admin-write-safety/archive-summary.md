# Users admin write safety — Archive Summary

> **Outcome:** every users-admin write now runs at most once per `Idempotency-Key`, and `PUT /users/:id` saves a whole person in one transaction. All 8 tasks closed; confirmed on real MySQL (`qadb`) and on the running API. Archived without `test-report.md` / `validation-report.md` (accepted by the back lead).

## 1. Document Control

| | |
|---|---|
| Spec path | `docs/specs/changes/users-admin-write-safety` |
| Archived to | `docs/specs/archive/2026-10-20-changes--users-admin-write-safety/` |
| Archive date | 2026-10-20 |
| Archived by | Leader session for the back lead (Juan D. Guzmán) |
| Branch | `feat/users-admin-write-safety` — merged to `staging-center` and `dev` |
| Kaizen entry | `docs/specs/kaizen/changes--users-admin-write-safety.md` |

## 2. Original Spec Path

`docs/specs/changes/users-admin-write-safety/` — files: `proposal.md`, `requirements.md`, `design.md`, `tasks.md`, `execution.md`, `front-contract.md`, this summary.

## 3. Archive Date

2026-10-20.

## 4. Final Status

| Item | Status |
|---|---|
| Tasks | 8 / 8 `[x]` |
| Server suite at close | 1316 unit · 538 e2e green · `tsc` 7 baseline errors only |
| Real MySQL (P-12) | Confirmed on `qadb` (T-8) |
| Running API (FR-3/FR-5) | Confirmed on the local API against `qadb` (T-8) |
| `test-report.md` | Absent — accepted by the back lead at archive |
| `validation-report.md` | Absent — accepted by the back lead at archive |

## 5. Requirements Delivered

| Req | Delivered by | Evidence |
|---|---|---|
| FR-1 optional key | T-3, T-6 | unit decision table; e2e per route; T-8 |
| FR-2 first execution, mark in same commit | T-3, T-4, T-6 | fence spec (same tx); T-8 |
| FR-3 replay returns first answer | T-3, T-4, T-6, T-7 | e2e per route; T-8 (create/invitation replays, one service run) |
| FR-4 reuse → 422 | T-2, T-3, T-6 | e2e; T-8 |
| FR-5 in flight → 409, lease, take-over | T-2, T-3, T-4 | lock-emulating fake; T-8 races on `qadb` |
| FR-6 per admin, validated key | T-2, T-3, T-6 | cross-admin e2e; T-8 malformed key |
| FR-7 retention + purge | T-2 | store tests |
| FR-8 aggregate edit | T-5, T-6 | parity and refusal tables; PUT e2e |
| FR-9 answers stay private | T-2, T-6, T-7 | log spy over every logger |
| FR-10 contract docs | T-6, T-7 | exact OpenAPI e2e; `front-contract.md` |
| NFR-1 at most one execution | T-2, T-4, T-8 | confirmed on `qadb` |
| NFR-2 no PII in logs | T-7 | log spy + falsifier |
| NFR-3 overhead ≤ 20 ms p95 | T-7 | **partial** — in-memory p95 ≈ 5 ms; MySQL not measured (open) |
| NFR-4 store down → 503 | T-3 | unit + e2e |
| NFR-5 automatic removal | T-2 | purge tests |

## 6. Files Changed Summary

| Area | Files |
|---|---|
| Schema | `server/src/database/drizzle/schema/idempotency-keys.ts`, `server/drizzle/0002_idempotency_keys.sql` (+ meta) |
| Shared idempotency | `server/src/common/idempotency/` — fingerprint, store, errors, interceptor, decorator, context, OpenAPI helpers; `server/src/common/error-codes.ts`, `api-response.ts` |
| Users | `users-admin.controller.ts`, `users-admin.service.ts`, `users-admin.unit-of-work.ts`, `users.module.ts`, `dto/replace-user.dto.ts` |
| Tests | fence, replace, interceptor, store, fingerprint specs; `users-admin-idempotency(-privacy).e2e-spec.ts`; fakes `in-memory-idempotency.ts`, `idempotency-sql-driver.ts`, `log-spy.ts`; opt-in `test/perf/` measure |
| Guides | `server/src/{common,users,database}/AGENTS.md`, `server/test/AGENTS.md` |

Size: ≈ 8,200 LOC (≈ 75 % tests) against a planned ~3,600 — tripwire fired after T-3; the back lead re-baselined to ≈ 8,000.

## 7. Test Evidence Summary

- Every task: Implementer verification plus a non-author re-run (all `VERIFIED`), plus executed falsifiers recorded in `execution.md`.
- Concurrency: lock-emulating fake + SQL-executing driver (T-2, T-4); real MySQL races on `qadb` (T-8: 20/20 rounds, exactly one winner).
- No `/akili-test` run — no `test-report.md`.

## 8. Validation Summary

No `/akili-validate` run. Conformance came from 20 Reviewer verdicts (parallel lenses on T-2…T-6): 4 FAIL → reworked (T-2 ×1, T-7 ×1, T-8 ×2), 0 HALT, 0 Pivot, 0 waivers, 0 skips.

## 9. Accepted Warnings Or Follow-Ups

| # | Item | Owner | State |
|---|---|---|---|
| 1 | P-14: send `front-contract.md` to the front lead (409 `IDEMPOTENCY_IN_PROGRESS` is transient) | back lead | open |
| 2 | NFR-3 on MySQL unmeasured (proposed ≥ 200-pair check on `qadb`) | back lead | open |
| 3 | A resend after a take-over can send a second invitation email | back lead | undecided |
| 4 | Replayed `data` key order differs (MySQL `JSON` normalization); values equal | back lead | undecided |
| 5 | Invitations to `custom` CGIAR `+alias` addresses never arrived | back lead + pool owner | open |
| 6 | Two identical `isDuplicateKeyError` copies (`common/idempotency`, `users`) | dev | follow-up |
| 7 | Test user 1036 left in `qadb` and the Cognito pool | back lead | follow-up |
| 8 | TRD § 5.1 / § 6 / § 7 updates | `staging` apply pass | pending item |

## 10. Historical Notes

- The `ascii_bin` collation for `idem_key` was a user-approved design amendment at the T-1 gate (case-sensitive keys).
- T-7's NFR-3 FAIL was a spec tension: the task asked for the measurement on the e2e app, which cannot evaluate MySQL cost.
- T-8 ran against the local API, not TEST (`AGENTS.md`: agents never touch TEST/PROD). qatest shares `qadb` (P-13).
