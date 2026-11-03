# Archive Summary — Field configuration per cycle

**Delivered.** An admin configures, per cycle, which Reporting fields QA shows, assesses, marks core or feeds to AI. The admin edits a draft, previews it and publishes immutable versions. Each timeline uses the version that was in force when its step 1 opened. All 11 tasks are done. Validation passed with 0 FAIL; R-1…R-5 are fixed, and R-6 and R-7 are follow-ups.

## 1. Document Control

| | |
|---|---|
| Spec | Field configuration per cycle (Jira P2-3907) |
| Original path | `docs/specs/admin-config/field-configuration/` |
| Archive path | `docs/specs/archive/2026-10-27-admin-config--field-configuration/` |
| Archive date | 2026-10-27 |
| Branch | `feat/field-configuration`, merged into `staging-center` and `dev`; `staging` waits for the front-lead's OK |
| Owner | Back lead |

## 2. Final Status

| Phase | Result |
|---|---|
| Execute | 11/11 `[x]`. T-5 closed `REVIEW_WAIVED` (degraded pair); T-11's Disqualifier waived (token through chat) |
| Test | PASS: unit 2304, e2e 865; 8 tests added; 0 PRODUCT_BUG |
| Validate | PASS with warnings: 0 FAIL, 10 WARN |
| After remediation | unit **2316**, e2e **870**, lint 0, server build and client `ng build` green |

## 3. Requirements Delivered

| Requirement | What shipped |
|---|---|
| FR-1, NFR-1 | Five admin-only routes under `/api/v1/cycles/:id/field-config` |
| FR-2, FR-3 | View built from the Reporting catalog of the cycle's year: types, sections, fields, requirement, `isNew`. Unclassified fields and fields no longer in the catalog are marked |
| FR-4 | Core and AI input only on an assessed field, enforced by the rules and a database CHECK |
| FR-5, FR-6 | Draft edit (one 400 lists every problem) and discard, both with a revision |
| FR-7, FR-8 | Preview and publish: version N+1, stale and nothing-to-publish refusals, idempotent replay |
| FR-9, FR-10 | Version per timeline by the Rome date of step 1; the effective-configuration port for later specs |
| FR-11, FR-12, NFR-8 | One audit record per publication; versions never change |
| FR-13 | Closed and unknown cycles |
| FR-14 | `front-contract.md` |
| NFR-2…NFR-7 | Unknown fields refused, concurrency, Rome clock, fixed statement counts, 10 s Reporting bound with a cache, decision logs |

## 4. Files Changed Summary

| Area | Files |
|---|---|
| Module | `server/src/admin-config/field-config/`: ports, catalog shaping, Reporting client, rules, diff, versions, store, unit of work, service, controller, module, DTOs, models, 2026 catalog fixture, specs |
| Shared | `catalog-http.ts` (typed "not found"); `error-codes.ts` (3 codes + `NOT_ASSESSED`); `configure-app.ts` (640 KB JSON limit on the draft edit only); `admin-config.errors.ts`, `.context.ts`, `.module.ts` |
| Data | 5 Drizzle tables, `server/drizzle/0005_field_configuration.sql` |
| Tests | e2e `admin-config-field-config.e2e-spec.ts` (90 cases), the OpenAPI pin, in-memory fakes |
| Docs | Module guide, `server/src/common/AGENTS.md`, `server/src/database/AGENTS.md`, `server/AGENTS.md`, root `AGENTS.md`, TRD § 4 / § 5.1 / § 6 / § 13 |

## 5. Test Evidence Summary

Every FR and NFR clause has a test or a recorded manual gap (`test-report.md` § 7). On real MySQL (TEST, T-11), five overlapping publishes gave one 201 and four 409, one version and one audit row.

## 6. Validation Summary

- 0 FAIL, 10 WARN.
- **Fixed after validation:**
  - R-1…R-4: spec and docs drift.
  - R-5: the 2,000-item contract was refused by the 100 KB body limit. The draft edit route now accepts up to 640 KB, with e2e tests on both sides of the limit.

## 7. Accepted Warnings Or Follow-Ups

| # | Follow-up | Owner |
|---|---|---|
| R-6 | Test the crash-window replay reader (`replayPublish` → `findPublication`) | Back lead |
| R-7 | NFR-6 on TEST: the first cold view hung for more than 45 s. Read the server logs for 2026-10-26 around 21:15 UTC. Confirm the Reporting key was rotated and the admin token revoked | Back lead |
| PI-3 | Reporting's per-field `is_new` flag, not sent yet | Back lead + Reporting |
| PI-4 | `VALUES()` is deprecated (MySQL 8.0.20+) | TRD § 13 |
| PI-7 | MySQL checks: driver timezone; concurrent first `ensureDraft`; 1213 in publish | Back lead |
| PI-8 | A comment covers a whole field, never one subfield | Comments spec |
| Advisory | Catalog drift between preview and publish is unguarded; a duplicate catalog key gives a 500 on publish; `effectiveFor` reads every timeline | Future spec |
| Data | TEST cycle 34 permanently holds year 2026 on TEST | Back lead |

## 8. Historical Notes

- The design's size check first counted 234 fields per year. The real count is 504, because the catalog's `"*"` fields apply to every type. Amended at T-2.
- Decisions taken during execution, with the back lead's approval:
  - S-14: an omitted flag is stored false.
  - DD-8a: "finished" is decided on dates only.
  - After the first publication, a discard never makes a field "unclassified" again.
- The budget ended above the estimate of about 7,000 LOC; the back lead lifted the tripwire at T-7.
- The full audit trail is in `execution.md`.
