# Archive Summary — User management (core)

## Document Control

| | |
|---|---|
| Spec | User management for QA admins — core (child 1 of 2 of `auth/user-management`) |
| Jira | P2-3908 (epic P2-3902) |
| Archived by | `/akili-archive` on branch `feat/auth-user-management` (spec branch; apply-capable branch is `staging`) |

## Original Spec Path

`docs/specs/auth/user-management/core/`

## Archive Date

2026-10-19 → `docs/specs/archive/2026-10-19-auth--user-management--core/`

## Final Status

**Done.** 10/10 tasks `[x]`; validation **PASS — archive-ready** (R-A and R-B fixed); merged into `staging-center` (`51c6c4e`) and pushed. Not yet in `dev`/qatest, `staging` or `main`.

## Requirements Delivered

| Requirement | Delivered |
|---|---|
| FR-1, NFR-1 | Every `/users` and `/catalogs` route behind `ADMIN_ACCESS`; 403 for every non-admin role with no existence leak |
| FR-2, FR-8 | Create SSO and custom users (Cognito account + invitation; existing account reused, untouched); resend invitation (active, invited, never signed in) |
| FR-3, FR-14 | Roles per result type or **all**; Assessor/Lead exclusivity; ADMIN holds every permission |
| FR-4 | Program scope and conflict-of-interest exclusions with history; active ADMIN exempt (DD-13) |
| FR-5, FR-7 | Edit nickname (and names before first sign-in); deactivate/reactivate; last-admin rule under concurrency |
| FR-6, FR-13 | Cache invalidated after commit; every change audited (DD-15 granularity) |
| FR-9, FR-10, NFR-4 | Searchable, filtered, keyset-paged list (p95 167 ms at 550 users); detail with exclusion history |
| FR-11 | Catalogs from Reporting (result types) and CLARISA (Science Programs), cached |
| FR-12 | `/auth/me` nickname; public-user mapper for later non-admin views |
| NFR-2, NFR-3, NFR-5 | No PII in logs; 503 bounds per upstream call; DB-level uniqueness and constraints |

## Files Changed Summary

| Area | Main files |
|---|---|
| Schema | `server/src/database/drizzle/schema/{users,user-programs,user-program-exclusions,user-audit-events}.ts`, `server/drizzle/0001_user_management.sql` (applied on `qadb`) |
| Users module | `users-admin.{controller,service,unit-of-work}.ts`, `users-query.repository.ts`, `user-programs.repository.ts`, `user-audit.repository.ts`, `effective-scope.ts`, `permissions.ts`, `authorization.service.ts`, `current-user.cache.ts`, `public-user.ts`, `catalogs/*`, `dto/*` |
| Auth | `cognito-admin.{client,module}.ts`, `me.controller.ts`, `admission.service.ts` (`AdmittedUser`) |
| Common / config | `error-codes.ts`, `validation.ts`, `api-response.ts`, envelope interceptor; `catalogs.config.ts`, `cognito-admin.config.ts`, `env.validation.ts` |
| Tests | unit specs beside the code; `test/{users-admin,users-admin-privacy,catalogs}.e2e-spec.ts`; fakes in `test/support/*` |
| Docs | module guides (`server/AGENTS.md`, `server/src/{users,auth,common,config,database}/AGENTS.md`, `server/test/AGENTS.md`), `docs/infrastructure.md` § 6, `front-contract.md` |

Size: ~16,200 LOC (mostly tests) across 25 commits on the branch.

## Test Evidence Summary

| Kind | Result |
|---|---|
| Unit | 1,016 passed |
| e2e | 414 passed |
| Type check | baseline — only 7 pre-existing errors in `token-verifier.service.spec.ts` |
| Falsifiers | executed per task and recorded in `execution.md` |
| HITL (T-10) | real MySQL constraints and lock serialization; real Cognito create / existing / resend + emails; real catalogs; NFR-4 measured |

No `test-report.md`: coverage was verified clause by clause in `validation-report.md` (accepted).

## Validation Summary

`validation-report.md`: 0 FAIL. 29 WARN at first pass (14 requirement clauses, 15 tasks/files/design/guides) — documentation drift and small gaps fixed as R-A/R-B; residual risks R-C carried.

## Accepted Warnings Or Follow-Ups

| Item | Owner / trigger |
|---|---|
| DD-3 committed two-admin race on real MySQL | Back lead — once a second ADMIN exists on `qadb` |
| Resend after confirmation; `UsernameExists` race on the real pool | Next real invite |
| Mixed-case `q` search on real data | Low risk (`_ci` confirmed) |
| `utf8mb3`: 4-byte characters in names/nicknames | Decision: DTO validation or `utf8mb4` (infrastructure) — known limitation in requirements § 4 |
| `+qatest` pool account deletion | Pool owner (requested 2026-10-19) |
| Promotion to `dev`/qatest: env vars, QA App Client, IAM role | Pool/infra owner + back lead |
| TRD, ADR and root-guide updates | Pending items for `staging` — `docs/specs/kaizen/auth--user-management--core.md` |
| Front-end sub-tasks | Front lead (from P2-3908) |
| Ideas: role-change email; QA-branded invitation | `docs/ideas.md` |
| Child spec `user-management/reporting-sync` | Pending (external Reporting endpoint) |

## Historical Notes

- Approved amendments during execution: DD-12 (system-ended reporting exclusions), DD-13 (active ADMIN exempt from conflict of interest), DD-14 (READ COMMITTED admin unit of work, recorded from review), DD-15 (audit granularity; no resend to deactivated users; plain uniqueness reads); § 7 Logging rule for pipe refusals.
- Back-lead decisions: Reporting auth = shared CLARISA key (`x-api-key`); Science Programs from CLARISA `cgiar-entities/by-portfolio?portfolioId=2,3&version=2`; budget re-baselined (~3,200 → ~12,500 LOC) and later overrun accepted.
- Reviewer gate: 23 passes; FAILs on T-5, T-8, T-9, DD-15 wording, T-10 record, validation remediation — all closed.
- The Leader ran one rollback-only lock probe on `qadb` at the back lead's request (T-10 step 4).
