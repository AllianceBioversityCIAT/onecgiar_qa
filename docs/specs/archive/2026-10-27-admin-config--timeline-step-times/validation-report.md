# Validation Report — Timeline step times

## 1. Document Control

| | |
|---|---|
| Spec path | `docs/specs/admin-config/timeline-step-times` |
| Jira | P2-4019 (story, AC 1–7) · P2-4020 (back, validated here) · P2-4021 (front, contract only) |
| Branch / HEAD | `feat/timeline-step-times` @ `38f7bc8` · spec base `8ac4df7` |
| Validated diff | `git diff 8ac4df7..HEAD -- server`: 43 files, +5,256 / −470 (2,182 of them the generated `0006_snapshot.json`) |
| Auditor | T3 Auditor (`opus`), independent of the `sonnet` Implementers and the per-task Reviewers |
| Inputs | `proposal.md`, `requirements.md`, `design.md`, `tasks.md`, `front-contract.md`, `execution.md`; no `test-report.md` (`/akili-test` not run), so coverage was verified directly against test titles |
| Date | 2026-10-27 |

## 2. Summary

**Verdict: PASS WITH WARNINGS — not archive-ready yet.** The server change is complete, conformant and well tested: every FR scenario and every `BUT` / `AND IT MUST` clause has a named, green test. The only material gap is the open human gate **T-8**: the down-script round-trip (NFR-3) and the before/after API read (FR-11) have not been recorded.

| Result | Count |
|---|---|
| PASS | 66 (32 of them requirement clause rows in § 6) |
| WARN | 9 |
| FAIL | 0 |
| BLOCKED | 0 |

**WARNs at a glance** (detail in § 11):

1. T-8 open: NFR-3 down round-trip and FR-11 API read not recorded.
2. FR-11 (real database part) pending T-8.
3. NFR-3 pending T-8.
4. DD-3 compile gate (`@ts-expect-error`) proven by hand only; spec files are not type-checked.
5. Budget tripwire: LOC far above design § 12, not recorded as a tripwire event.
6. Design § 11 Premise Ledger stale (summary line; P-4 still `UNVERIFIED`); requirements and design still `Status: Draft`.
7. Proposal success criterion "`'Europe/Rome'` appears once" is literally false (2 occurrences, one a doc comment); NFR-2 as amended passes.
8. T-8 order deviation: `0006` ran on the shared dev database (and the branch reached `staging-center` / `dev`) before the local down round-trip.
9. BA confirmation of S-1, S-2, S-6 still pending (requirements Document Control).

## 3. Task Completion

| Task | Status | Evidence in `execution.md` | Result |
|---|---|---|---|
| T-1 Rome helpers, zone constant | `[x]` | Red run, 2 falsifiers, dual-zone 74/74, Leader re-run VERIFIED, Reviewer PASS | PASS |
| T-2 Rename, no behavior change | `[x]` | Same counts before/after (2356 / 870), falsifier, e2e expected bodies untouched, Reviewer PASS | PASS |
| T-3 Storage, `0006`, clock | `[x]` | Pivot Record (P-3 false) with user decision; interactive generate; red run; 3 falsifiers; dual zone; two lens Reviewers PASS | PASS |
| T-4 Write rules | `[x]` | 48-case red run, 3 falsifiers, Reviewer PASS; § 7.2 amendment approved at the gate | PASS |
| T-5 API surface | `[x]` | Red run, 2 falsifiers, OpenAPI pin, Reviewer PASS | PASS |
| T-6 E2E + NFR checks | `[x]` | Attempt 1 FAIL (FR-9 "agree" untested over HTTP) fixed in attempt 2; Reviewer PASS; FR-5 and NFR-4 wording amendments approved | PASS |
| T-7 Front contract, guide | `[x]` | Attempt 1 FAIL (hold missing in contract) fixed; cross-check `CHECKED 34 UNKNOWN 0`; Reviewer PASS | PASS |
| F-1 OpenAPI `required` on create DTO | done | Red run, falsifier, `CHECKED 33 UNKNOWN 0`, Reviewer PASS; 11th review round approved | PASS |
| T-8 (HITL) `0006` up + down, sign-off | `[ ]` | Partial: dev DB has migration id 7, `datetime NOT NULL`, 121 rows all 00:00:00 / 23:59:00, strict CHECK, MySQL 8.0.46. Missing: API read before/after, local down-script round-trip | **WARN** |

## 4. File Existence

| Check | Result |
|---|---|
| Every entry of design § 4 exists and is in the diff: `drizzle/0006_timeline_step_times.sql`, `meta/_journal.json` (idx 6), `meta/0006_snapshot.json`, `rollback/0006_timeline_step_times.down.sql`, `rome-date.ts`, both `AGENTS.md`, the 9 `timelines/**` files, `field-config-versions.ts`, `field-config.store.ts`, `cycles.store.ts`, `error-codes.ts`, `schema/timeline-steps.ts`, `front-contract.md`. `client/` untouched. One production file outside the tree, `field-config/field-config.service.ts` (15 lines), is explained in T-2 (edge mapping of `TimelineStart`) and accepted by its Reviewer | PASS |

## 5. Build Integrity

Run by the Leader on HEAD just before this audit; recorded, not re-run.

| Command | Result | |
|---|---|---|
| `pnpm lint` (oxlint `--type-aware src/ test/`) | clean | PASS |
| `pnpm build` | clean | PASS |
| `TZ=UTC pnpm test` / `TZ=America/Bogota pnpm test` | 63 files, 2470 passed in both | PASS |
| `TZ=UTC pnpm test:e2e` / `TZ=America/Bogota pnpm test:e2e` | 14 files, 885 passed in both | PASS |
| NFR-2 grep (T-6 amended filter) | 1 line: `src/admin-config/rome-date.ts:8:export const QA_TIME_ZONE = 'Europe/Rome';` | PASS |
| Whole-project `tsc --noEmit -p tsconfig.json` | Fails in `src/common/configure-app.spec.ts` and `src/auth/token-verifier.service.spec.ts` (pre-existing, out of scope). Consequence: no automated gate type-checks spec files, so DD-3's `@ts-expect-error` proof (`rome-date.spec.ts:236`) was shown by hand in T-1 only | WARN |

## 6. Requirement Coverage

Scenario- and clause-level. Claim = `tasks.md` Coverage table; each row was checked against the actual test titles. Paths are under `server/`. Abbreviations: **rules** = `src/admin-config/timelines/timeline-rules.spec.ts`, **view** = `…/timeline-view.spec.ts`, **svc** = `…/timelines.service.spec.ts`, **e2e** = `test/admin-config-timelines.e2e-spec.ts` › `step times (P2-4019)` (`:1385`), **fc-e2e** = `test/admin-config-field-config.e2e-spec.ts` › `step times (P2-4019)` (`:1610`).

| Req | Scenario / clause | Named test(s) | Result |
|---|---|---|---|
| FR-1 | Valid moments | rules `FR-1 Valid moments` (`:1372`); `src/admin-config/timelines/timeline-response.spec.ts` "returns each stored moment exactly"; e2e "FR-1 Valid moments: step 1 from 2026-11-10T14:00 to 2026-11-12T17:30 is stored and returned…" (`:1434`) | PASS |
| FR-1 | Malformed or missing (seconds, offset, `02-30`, `T24:00`, absent/null/empty) | rules `FR-1 Malformed or missing moment` (`:1383`) `it.each` "an opening/closing moment with %s is INVALID…", "a %s closing moment is REQUIRED…", "neither form … REQUIRED on opensAt"; `rome-date.spec.ts` `isRomeMinute` (`:143`) | PASS |
| FR-1 | BUT not dropped; not read in another zone | rules "the step is not dropped: a bad moment on step 2 keeps the index…"; "a moment with an offset is refused, not read in another zone" | PASS |
| FR-2 | Boundaries 13:59:59 / 14:00:00 / 17:30:59 / 17:31:00 | view `FR-2: boundaries…` (`:531`); svc "with a load, a step 14:00-17:30 is upcoming at 13:59:59…" (`:1363`); e2e "FR-2 Boundaries…" (`:1457`) | PASS |
| FR-2 | AND IT MUST: same whatever the process zone | Full unit + e2e suites green under `TZ=UTC` and `TZ=America/Bogota` (§ 5) | PASS |
| FR-2 | Whole-day window unchanged | view `FR-2: a whole-day window is open exactly on 2-6 Nov` (`:544`) | PASS |
| FR-3 | Same moment or reversed → `CLOSES_BEFORE_OPENS` | rules "Same moment or reversed: the same minute…", "…a closing minute before the opening one…" | PASS |
| FR-3 | Two steps on the same day | rules "Two steps on the same day…is valid"; e2e "FR-3 Two steps on the same day…" (`:1478`) | PASS |
| FR-3 | Overlap; AND IT MUST accept 12:01 | rules `Overlap: step 1 closes at 2026-11-10T12:00` (same minute, earlier, before step 1) + "AND IT MUST accept 2026-11-10T12:01"; e2e "FR-3 Overlap…12:01 is accepted" (`:1501`) | PASS |
| FR-4 | Spring and autumn → `DST_HOUR` | rules `FR-4 Spring and autumn` (`:1546`) 2027-03-28T02:30, 2026-10-25T02:15; `rome-date.spec.ts` `isDstHour` (`:204`); `error-codes.spec.ts:246` | PASS |
| FR-4 | BUT 03:00 and 01:59 not refused | rules `it.each` `2026-10-25T03:00`, `2026-10-25T01:59` → `[]`; "02:30 on an ordinary day is not refused" | PASS |
| FR-4 | Step spanning the change, 02:30 both occurrences | `rome-date.spec.ts` `nowInRome` (`:172`); view "is in progress at 02:30 Rome on 25 Oct, in both occurrences of that hour" (`:557`) | PASS |
| FR-5 | Earlier today → `BEFORE_TODAY` (GIVEN amended: with a load) | rules "step 1 opening at 2026-11-10T14:00 is BEFORE_TODAY on opensAt at 14:20"; e2e "FR-5 Earlier today…" (`:1537`) | PASS |
| FR-5 | AND IT MUST accept the current minute, in progress at once | rules "AND IT MUST accept 2026-11-10T14:20…in progress at once"; e2e same case (after `markLoaded`, per amended GIVEN) | PASS |
| FR-6 | Close an in-progress step now; BUT 14:19 refused | rules `FR-6 Close an in-progress step now` (`:1826`) "moving the closing moment to …14:20 is accepted", "BUT 2026-11-10T14:19 is BEFORE_TODAY on closesAt"; e2e "FR-6 … in progress at 14:20:59 and closed at 14:21:00" (`:1657`) | PASS |
| FR-6 | Unchanged past moment | rules `FR-6 Unchanged past moment` (`:1871`) "only renaming the timeline succeeds", "sending the stored opening moment again is not a change" | PASS |
| FR-7 | Hold starts at the hour; BUT not at 00:00 | view "is scheduled at 13:59 and waiting for load at 14:00 on 10 Nov" (`:573`), "is not waiting for load at 00:00 that day" (`:582`); svc and e2e "FR-7 The hold starts at the hour…" (`:1574`) | PASS |
| FR-7 | Between two steps on the same day | view "has no current step and step 2 next at 13:00" (`:601`); e2e FR-3 same-day case asserts it at 13:00 | PASS |
| FR-8 | Published the same morning | `field-config-versions.spec.ts` "published the same morning…" (`:641`); fc-e2e "FR-8 Published the same morning…" (`:1634`) | PASS |
| FR-8 | Published in the opening minute (14:00:10) | `field-config-versions.spec.ts` "published in the opening minute (14:00:10)…" (`:671`); fc-e2e (`:1658`); finish rule `receiveAndKeep: finish after the last closing minute` (`:697`) | PASS |
| FR-9 | Read: both forms returned | `timeline-response.spec.ts` "keeps opensOn and closesOn as the day part of the moment" | PASS |
| FR-9 | Old client creates | svc "an old client create (day-only) is stored from 00:00…to 23:59…" (`:1327`); e2e "FR-9 Old client creates a timeline…" (`:1588`) | PASS |
| FR-9 | Both forms; BUT never picked, even when they agree | rules `FR-9 Both forms` (`:1751`) `it.each` "they differ" / "they agree" for both boundaries + edit case; e2e "…even when they agree: opensAt 00:00 with opensOn, and closesAt 23:59 with closesOn…" (`:1631`) | PASS |
| FR-9 | Day-only edit over a stored time; BUT a change to 23:59 | rules `FR-9 Day-only edit over a stored time` (`:1902`) "…keeps both moments of step 2", "BUT a closesOn equal to the stored date is a change to 23:59" | PASS |
| FR-10 | Read carries `timeZone` | `timeline-response.spec.ts:75` "carries the QA time zone"; e2e "FR-10 Read: a timeline in the list and in the detail carries the zone" (`:1684`) | PASS |
| FR-10 | AND IT MUST same definition | `timeline-response.ts:125` reads `QA_TIME_ZONE`; NFR-2 grep = 1 | PASS |
| FR-11 | Migrated timeline behaves the same | svc "a migrated timeline (00:00 / 23:59) answers as the day timeline did…" (`:1382`); rules "on an edit, a day equal to a stored 00:00 / 23:59 is not a change" (`:1315`); `schema.spec.ts` `committed migration 0006` (`:1716`) "sets every stored closing time to 23:59…"; dev DB: 121 rows all 00:00 / 23:59. **Missing:** T-8 API read before/after on a real database | WARN |
| FR-12 | Time-only change; BUT no `closesOn` key | `timeline-diff.spec.ts:85` "FR-12 time-only change…no `closesOn` key exists"; `:111` opening under `opensAt`; `schema.spec.ts` "touches only timeline_steps and stays out of the audit table" | PASS |
| FR-13 | Span stays in days | `cycles.unit-of-work.spec.ts:179` "the span stays in days…" | PASS |
| FR-14 | Contract matches the server | T-7 / F-1 cross-check against the generated OpenAPI and `error-codes.ts`: `CHECKED 33 UNKNOWN 0`; falsifier `UNKNOWN 2`; spot-checked `DST_HOUR` (`error-codes.ts:351`) and `timeZone` | PASS |
| NFR-1 | Two-zone runs, 0 differences | § 5: 2470 / 885 in both zones | PASS |
| NFR-2 | One zone definition | § 5 grep = 1 code line | PASS |
| NFR-3 | Up + down round-trip on local MySQL | Statement pins only (`schema.spec.ts` "has a down script that reverses…", "documents that the down script is lossy"). Real round-trip **not done** (T-8) | WARN |
| NFR-4 | List read cost unchanged | `admin-config-timelines.e2e-spec.ts:1737` `expect(listMany).toHaveLength(7)` absent from the diff; unit-of-work statement counts unchanged (T-3) | PASS |

No `PRODUCT_BUG`, no automation deferral. No negative constraint or strict validation is uncovered.

## 7. Linting & Code Quality

Lint: clean (§ 5). Architecture: change stays inside `admin-config` and `timeline_steps`; pure rules receive `RomeMinute` and never read a clock (`timeline-view.ts:22`, `timeline-rules.ts` `context.now`); time enters only through `ADMIN_CONFIG_CLOCK` → `nowInRome` (the six P-6 sites, `field-config-versions.ts:107,116,138`, `timelines.service.ts:302,358,461`). One reader (`readBoundary`, `timeline-rules.ts:341`) feeds create, edit and the insert (`momentsOfStep`).

### 4R advisory findings (not gating)

New in this audit:

| Lens | Finding |
|---|---|
| RISK | Down script `CHANGE COLUMN … date` truncates every `… 23:59:00` value. Whether the server's `sql_mode` turns that truncation into an error was never tested; T-8's local round-trip must run under the same `sql_mode` as dev/prod |
| RESILIENCE | `0006` already ran on the shared dev DB; the rollback path is the only untested half, and the dev DB must never be the place it is tried first |
| RELIABILITY | `requestFamily` (`timeline-rules.ts:310`) is request-wide: in a request that mixes families across steps, an unsent boundary is named on `…At`. Matches amended § 7.2, but the front contract could say it |
| RELIABILITY | `momentsOfStep` throws a plain `Error` (→ 500) when called before validation. Guarded by the call order today |
| READABILITY | `timeline-view.spec.ts:37` helper `at(today: string…)` and the `:233` title "moved after today" still say "today" |

Carried forward from `execution.md`, still unresolved:

| From | Lens | Finding |
|---|---|---|
| T-1 | RISK | DD-3's `@ts-expect-error` is not in any automated gate (see § 5 WARN) |
| T-1 | RELIABILITY | `romeOffsetMinutes` falls back to offset 0 on an unexpected `Intl` label, so `isDstHour` would silently return false |
| T-1 | RELIABILITY | `dayStart` / `dayEnd` cast unchecked strings (mitigated: `readBoundary` runs `isRomeMinute` on the result) |
| T-1 | READABILITY | `isDstHour` splits the date by hand where `dayOf` would do |
| T-3 | RESILIENCE | MySQL DDL is not transactional: a failure after statement 2 leaves a half-migrated table and a re-run fails at `DROP CHECK`; `sql_safe_updates` refuses the unfiltered `UPDATE` (1175) |
| T-3 | RISK | Lossy down path tested only as text; T-8 should include one step at a non-00:00/23:59 time |
| T-3 | RELIABILITY | `fromDriver` throws if the driver ever returns a `Date` (guarded by the codec pin, P-2) |
| T-4 | READABILITY | `Boundary.raw` holds the normalized moment, not what was sent |
| T-4 | RELIABILITY | Edit of a closed step with a null/malformed/DST boundary reports both `LOCKED` and its own code |
| T-5 | READABILITY | `timeZone` typed `string`; `typeof QA_TIME_ZONE` would carry the single source into the type |
| T-5 | RISK | Audit history holds both `…On` (old) and `…At` (new) keys; readers must handle both (documented in the contract and guide) |
| T-6 | RISK | The NFR-2 filter would drop a code line that starts with a block comment and then carries the literal |
| F-1 | COVERAGE | The OpenAPI pin does not assert that `name` / `audience` / `round` / `requiresLoad` stay required |

Resolved since recorded (not carried): AGENTS.md day-only wording (T-7), `romeNow` local, S-6 mapping duplicated (T-4 `momentsOfStep`), interim audit values (T-5), strict-close pin (T-4), FR-6 14:20:59 view pin (T-6), null-counts-as-sent wording (contract § 4), `beforeToday` → `beforeNow`.

## 8. Design Conformance

| Item | Evidence | Result |
|---|---|---|
| DD-1 Rome wall-clock strings, lexical compare | `compareMinutes`, `viewTimeline` decision table | PASS |
| DD-2 Minute granularity | `nowInRome` drops seconds (`rome-date.ts:79`) | PASS |
| DD-3 Branded `RomeMinute` + custom column | `rome-date.ts:27`; `timeline-steps.ts` `customType` `fromDriver` / `toDriver` | PASS |
| DD-4 DST via `Intl` | `isDstHour` compares offsets at both ends of the day | PASS |
| DD-5 Error on the key sent | `readBoundary` key memory; rules `errors name the key that was sent (DD-5)` (`:1941`) | PASS |
| DD-6 (amended) Interactive generate, reviewed 4-step SQL, manual down | Snapshot holds `opens_at` / `closes_at` `datetime`, no `opens_on`; journal idx 6; SQL = drop check → `CHANGE COLUMN` ×2 → `UPDATE … 23:59:00` → strict check; down script outside the journal | PASS |
| DD-7 Additive API | Both forms read and written; `…On` deprecated in the response model | PASS |
| DD-8 `timeZone` from the one constant | `timeline-response.ts:125` | PASS |
| DD-9 Span in days | `cycles.store.ts` `dayOf`; FR-13 test | PASS |
| Amendment § 7.2 (unsent-boundary key family) | `requestFamily` + `storedBoundary` match the amended sentence | PASS |
| Amendment FR-5 GIVEN "and the timeline has a load" | e2e FR-5 case loads first; contract `BEFORE_TODAY` row states the hold | PASS |
| Amendment DD-6 / P-3 | P-3 marked FALSE with evidence; `database/AGENTS.md` warns against `--custom` | PASS |
| Amendment T-6 NFR-2 filter and NFR-4 wording | Filter returns 1 line; NFR-4 names the e2e list test | PASS |

**Cross-document figure check.**

| Figure | Claimed | Actual | Result |
|---|---|---|---|
| P-9 "15 files" (13 suites + 2 support) | design § 11, tasks T-2 | `git grep -c` at `8ac4df7`: 15 (13 specs + `in-memory-admin-config.ts`, `in-memory-field-config.ts`) | PASS |
| P-6 "six sites" of `todayInRome` | design § 11, tasks T-3 | 6 at `8ac4df7`; 0 now; 6 `nowInRome(` call sites | PASS |
| "four steps" of `0006` | design § 5, tasks T-3 | 4 statements; down script 3 (no data reverse, as designed) | PASS |
| Migration count 6 → 7 | tasks T-3 | `schema.spec.ts` "are exactly seven SQL files"; dev `__drizzle_migrations` id 7 | PASS |
| Budget (design § 12) | 8 tasks · ≈450 prod LOC · ≈900 test LOC · ≈10 rounds | 8 tasks (+F-1) · ≈704 prod lines added (excl. snapshot, incl. SQL and guides) · ≈2,370 test lines added · 11 rounds (11th approved). LOC overrun never logged as a tripwire event; tasks.md "≈1,350 LOC" PR estimate also stale | WARN |
| Premise Ledger summary | design § 11 "10 verified, 2 `UNVERIFIED` (1 High, 1 Low)" | P-3 is now FALSE (settled), P-4 confirmed (MySQL 8.0.46, `execution.md` T-8) but still `UNVERIFIED` in its row; requirements and design still `Status: Draft` | WARN |
| Proposal success criterion "`'Europe/Rome'` appears once in `server/src`" | proposal | 2 occurrences (`rome-date.ts:7` doc comment, `:8` constant); NFR-2 ("comments excluded") passes | WARN |

**Proposal alignment (P2-4020 backend part of AC 1–7).**

| AC | Delivered by | Result |
|---|---|---|
| AC 1 hour and minute | FR-1 write path (front picker is P2-4021, in contract) | PASS (row counts once with AC 2–7) |
| AC 2 stored times shown | FR-1 read, FR-9 read; labels in contract | |
| AC 3 open window | FR-2, FR-7 | |
| AC 4 order / overlap | FR-3 | |
| AC 5 one zone | FR-10, NFR-2 | |
| AC 6 existing rows | FR-11 (pin + dev evidence; T-8 open) | |
| AC 7 Reset keeps times | Contract only (front) | |

Non-goals respected: no per-cycle zone, no UTC, no second precision, `…On` not removed, span still in days, `client/` untouched.

**Process deviations.**

| Item | Result |
|---|---|
| T-8 scope says local MySQL before any shared DB. The branch was merged to `staging-center` (`eb34bfe`) and `dev` (`50f3579`) and `0006` was applied to the dev DB by the pipeline before the local round-trip, by the back lead's decision (recorded). Up migration succeeded on 121 rows; rollback still unproven | WARN |
| BA confirmation of S-1, S-2, S-6 is still "Pending" (requirements Document Control: "an overrule reopens this spec"). The accepted S-6 + FR-5 consequence (current front cannot open step 1 "today" after 00:00 Rome) sits on this | WARN |

## 9. Test Evidence Summary

| Layer | Suites touched | Counts (HEAD) |
|---|---|---|
| Unit | `rome-date`, `timeline-rules`, `timeline-view`, `timeline-response` (new), `timeline-diff`, `timelines.service`, `field-config-versions`, `field-config.service`, three unit-of-work suites, DTO specs (`create-timeline.dto.spec.ts` new), `error-codes`, `schema` | 2470 passed, UTC and America/Bogota |
| E2E | `admin-config-timelines` (`step times (P2-4019)`, 11 cases), `admin-config-field-config` (2 cases), `openapi` (moments, deprecation, `required` pin) | 885 passed, UTC and America/Bogota |
| Red runs / falsifiers | Recorded per task in `execution.md` (T-1, T-3, T-4, T-5, T-6, F-1), each reverted | — |
| Manual (HITL) | T-8: dev DB up-migration evidence only | Partial |

## 10. Agent Guide / Constitution Impact

`execution.md` has no `## Constitution Impact` section; no module was created or moved.

| Guide | Check | Result |
|---|---|---|
| `server/src/admin-config/AGENTS.md` | `rome-date.ts` row names `QA_TIME_ZONE`, `RomeMinute`, `nowInRome`, `isDstHour`; step-time, key-family, null-counts-as-sent, edit-lock, audit-key and FR-8 version rules present; no `todayInRome` | PASS |
| `server/src/database/AGENTS.md` | `0006` listed as **not additive**, human-applied, lossy down script, interactive-generate provenance, "do not use `--custom`"; `timeline_steps` row describes `datetime` + strict CHECK. Note: "the migrated rows round-trip identical" is a claim T-8 has not yet proven | PASS |

Pending for `/akili-archive`: the database guide's round-trip sentence once T-8 confirms it.

## 11. Remediation

| # | Finding | Remediation | Owner | Blocks archive |
|---|---|---|---|---|
| R-1 | T-8 open (WARN rows: T-8, FR-11, NFR-3) | Back lead, on a **local** MySQL copy with ≥ 1 timeline of ≥ 2 steps (one step moved to a non-00:00/23:59 time): apply `0006`, compare one timeline's API read before/after, apply the down script under the dev/prod `sql_mode`, confirm day values identical; record in `execution.md`, set T-8 `[x]` | Back lead | **Yes** |
| R-2 | Process deviation: rollback unproven while `0006` is live on dev | Same as R-1; until then treat the down script as unproven and do not run it on dev | Back lead | Covered by R-1 |
| R-3 | DD-3 gate by hand only | Follow-up (outside this spec): fix the two pre-existing `tsc` errors and add `tsc --noEmit -p tsconfig.json` (or a `typecheck` script) to the verification commands | Back | No |
| R-4 | Budget LOC overrun not logged | Add one line to `execution.md` (or the Kaizen step) recording actual ≈704 prod / ≈2,370 test lines vs ≈450 / ≈900, and the cause (fixture migration of 15 files) | Leader at archive | No |
| R-5 | Stale Premise Ledger / Draft status | design § 11: summary line → "10 verified, 1 FALSE (P-3), P-4 confirmed (8.0.46)"; P-4 row cite T-8 evidence; set requirements/design Status to Approved. Run correction closure (grep `UNVERIFIED` and `Draft` across the spec folder) | Leader at archive | No |
| R-6 | Proposal "appears once" | Note in the archive summary that NFR-2 (comments excluded) supersedes the proposal wording; no code change | Leader at archive | No |
| R-7 | BA confirmation pending | Get the BA's confirmation of S-1, S-2, S-6 (and the accepted FR-5 consequence) and record it in requirements Document Control | Back lead / BA | No, unless overruled |

## 12. Archive Readiness Recommendation

**Not ready.** All build tasks (T-1…T-7, F-1) pass with evidence, with no FAIL and full clause-level coverage. Archive needs **R-1**: T-8 recorded as PASS, which closes the FR-11 and NFR-3 WARNs. R-3…R-7 can be accepted as follow-ups during the archive. After R-1:

```text
/akili-archive admin-config/timeline-step-times
```
