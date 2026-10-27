# Archive Summary — Timeline step times

> **Outcome:** delivered. Timeline steps open and close at a Rome hour and minute, and every rule judges by the current Rome minute. Migration `0006` is live on the dev database. T-8 is only partly done and was accepted as a follow-up.

## 1. Document Control

| | |
|---|---|
| Spec | Timeline step times (Jira P2-4019 story; P2-4020 back, P2-4021 front) |
| Archived by | The back lead, through `/akili-archive` |
| Branch | `feat/timeline-step-times`, merged to `staging-center` and `dev` |
| Final status | **Delivered with accepted follow-ups** |

## 2. Original Spec Path

`docs/specs/admin-config/timeline-step-times/`

## 3. Archive Date

2026-10-27

## 4. Final Status

| Item | Result |
|---|---|
| Build tasks T-1…T-7 | `[x]`, each closed by a Reviewer PASS |
| Follow-up F-1 (OpenAPI `required`) | PASS |
| T-8 (HITL migration check) | `[~]`, accepted as a follow-up (§ 9) |
| Validation | 66 PASS · 9 WARN · 0 FAIL · 0 BLOCKED |
| `test-report.md` | Not produced (`/akili-test` was not run). `/akili-validate` checked coverage directly, scenario by scenario |

## 5. Requirements Delivered

| Requirement | Delivered |
|---|---|
| FR-1…FR-10, FR-12…FR-14 | Yes. Every scenario and every BUT / AND IT MUST clause has a named green test (`validation-report.md` § 6) |
| FR-11 Stored steps keep their behavior | Yes in code and on the dev database (121 rows at 00:00 / 23:59). The local round-trip is pending |
| NFR-1 two zones · NFR-2 one zone definition · NFR-4 read cost | Yes |
| NFR-3 safe migration (up + down) | The up migration is verified on dev; the down round-trip is pending (T-8) |

## 6. Files Changed Summary

| Area | Files |
|---|---|
| Time helpers | `server/src/admin-config/rome-date.ts` (`QA_TIME_ZONE`, `RomeMinute`, `nowInRome`, `isDstHour`, …; `todayInRome` removed) |
| Rules, view and service | `timelines/{timeline-rules,timeline-view,timelines.service,timelines.store,timeline-response,timeline-diff}.ts`, `timelines/dto/*`, `timelines/models/timeline.model.ts` |
| Field configuration | `field-config/{field-config-versions,field-config.store,field-config.service}.ts` |
| Cycles | `cycles/cycles.store.ts` (span stays in days) |
| Error catalog | `server/src/common/error-codes.ts` (`DST_HOUR`) |
| Schema and migration | `database/drizzle/schema/timeline-steps.ts`, `server/drizzle/0006_timeline_step_times.sql`, `drizzle/rollback/0006_timeline_step_times.down.sql`, `drizzle/meta/{_journal.json,0006_snapshot.json}` |
| Guides | `server/src/database/AGENTS.md`, `server/src/admin-config/AGENTS.md` |
| Tests | Rules, view, version, diff, response, DTO, unit-of-work and schema specs; `server/test/admin-config-{timelines,field-config}.e2e-spec.ts`, `server/test/openapi.e2e-spec.ts`, the in-memory support files |
| Front contract | `front-contract.md` (for P2-4021) |

Size: about 704 production LOC and about 2,370 test LOC, against a budget of about 450 and about 900. Review rounds: 11 against about 10; the 11th, for F-1, was approved by the back lead.

## 7. Test Evidence Summary

| Run on the final HEAD | Result |
|---|---|
| `pnpm lint`, `pnpm build` | Clean |
| Unit (`TZ=UTC`, `TZ=America/Bogota`) | 2,470 / 2,470 |
| e2e (`TZ=UTC`, `TZ=America/Bogota`) | 885 / 885 |
| NFR-2 grep | 1 code line (`QA_TIME_ZONE`) |
| Dev database (pipeline-applied `0006`) | Migration id 7 matches the journal; the columns are `datetime NOT NULL`; all 121 rows at 00:00 / 23:59; the CHECK is strict; MySQL 8.0.46 |

## 8. Validation Summary

`validation-report.md`: **PASS with warnings**. No FAIL. The 9 WARNs are in § 9 below; the archive closes the stale-document WARNs.

## 9. Accepted Warnings Or Follow-Ups

| # | Follow-up | Owner |
|---|---|---|
| 1 | **T-8 remainder:** apply `0006` and then the down script on a **local** MySQL, using a copy that holds a step at a time other than 00:00 / 23:59; also compare one API read on dev before and after. This closes the FR-11 and NFR-3 WARNs. Never run the down script on dev | Back lead |
| 2 | Type-check spec files: DD-3's `@ts-expect-error` is proven by hand only, and two existing `tsc` errors block a typecheck command (recurs from `auth--user-management--core`) | Back lead |
| 3 | Business confirmation of S-1, S-2 and S-6 is pending; ask the QA business owner | Back lead |
| 4 | The front adopts the contract (P2-4021) | Front lead |
| 5 | Promote `staging-center` to `staging` | Front lead's OK |

Closed at archive: P-4 marked confirmed and the `UNVERIFIED` summary line updated; requirements and design status set to Delivered; the proposal's `'Europe/Rome'` claim annotated; the budget overrun recorded in § 6.

## 10. Historical Notes

- **Pivot (T-3):** `drizzle-kit generate --custom` wrote a snapshot that copied the previous schema (P-3 was false). The back lead ran an interactive generate instead, and DD-6 was amended.
- **Spec amendments approved at gates:** design § 7.2 (the key that names an unsent boundary); requirements FR-5's GIVEN ("and the timeline has a load"); T-6's NFR-2 grep filter and its NFR-4 wording.
- **Accepted consequence:** until P2-4021 ships, the current front cannot open step 1 "today" after 00:00 Rome (`BEFORE_TODAY`).
- **Order deviation:** at the back lead's decision, the branch was merged to `staging-center` and `dev`, so `0006` ran on the dev database before the local T-8 run.
- Full audit trail: `execution.md`. Jira P2-4020 is in "To Be Reviewed", with a technical comment.
