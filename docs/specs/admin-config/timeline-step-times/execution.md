# Timeline step times — Execution Log

## Document Control

| | |
|---|---|
| Spec path | `docs/specs/admin-config/timeline-step-times` |
| Branch | `feat/timeline-step-times` |
| Approval Mode | gated |
| Leader | Claude Code, `opus` (T1) |
| Implementer / Reviewer | `akili-implementer` (`sonnet`, T2) / `akili-reviewer` (`opus`, T3) |
| Budget (design § 12) | 8 tasks · ≈ 450 production LOC + ≈ 900 test LOC · ≈ 10 review rounds |
| Started | 2026-10-27 |

## Task Execution History

### T-1: Rome time helpers and the single zone constant — PASS

- **Date:** 2026-10-27
- **Attempts:** 1
- **Skills / effort:** nestjs-best-practices, tdd (as listed) · `medium`
- **Attempt 1**
  - files changed: `server/src/admin-config/rome-date.ts`, `server/src/admin-config/rome-date.spec.ts`
  - Implementer verification: `pnpm lint` clean · `pnpm build` pass · `pnpm test` 61 files / 2356 tests pass · `TZ=UTC pnpm test rome-date` 74/74 · `TZ=America/Bogota pnpm test rome-date` 74/74
  - Red run: helpers absent → 39 failed with `TypeError: <helper> is not a function` (the task's Red run wording: "functions are undefined")
  - Falsifier 1 (`nowInRome` formats with the process zone, `TZ=America/Bogota`): 9 failed, e.g. `expected '2026-11-09T18:30' to be '2026-11-10T00:30'`. Reverted
  - Falsifier 2 (`isDstHour` true for any 02:xx): 2 failed, `expected true to be false` on `2026-07-15T02:30` and `2026-01-15T02:30`. Reverted
  - `@ts-expect-error` proof: `tsconfig.build.json` excludes specs; `npx tsc --noEmit -p tsconfig.json` shows 0 `rome-date` errors; with the annotation changed to `string`, tsc reported `TS2578: Unused '@ts-expect-error' directive` (reverted)
  - Evidence re-run (Leader inline): **VERIFIED** — lint clean, build pass, 2356/2356, rome-date 74/74 in UTC and America/Bogota, 0 tsc errors in `rome-date`
  - Reviewer: **PASS** — every helper of design § 7.1 present; FR-1 shape table, FR-4 detector and span cases, DD-2/DD-3/DD-4 and both disqualifiers checked at source; one code line holds `Europe/Rome`
  - runtime events: none
- **spawns:** implementer not reported by host (worker: 11 tool calls, 82,646 tokens), ended complete; reviewer not reported by host, ended complete
- **Not Done / Assumptions (verbatim from the Implementer):**
  - Assumption: `dayStart` and `dayEnd` take a plain `string` day and do not validate it. Callers pass already-validated days.
  - Assumption: `compareMinutes` is the "typed variant" of the minute comparison that design § 7.1 mentions, so that is what I named it.
  - (Assumptions only, no owed item: not a continuation.)
- **ADVISORY (Reviewer, 4R — not gating):**
  - RISK: no build or CI step type-checks spec files, so DD-3's `@ts-expect-error` gate is proven by hand only; a weakened brand would go green silently.
  - RELIABILITY: `dayStart` / `dayEnd` cast any unchecked string to `RomeMinute`.
  - RELIABILITY: `romeOffsetMinutes` falls back to offset 0 on an unexpected `Intl` label; `isDstHour` would then silently return false.
  - READABILITY: `server/src/admin-config/AGENTS.md:17` still describes day-only helpers (scheduled in T-7).
  - READABILITY: `isDstHour` splits the date by hand where `dayOf` would do.
- **Requirements covered:** FR-1 (shape), FR-4 (detector, `nowInRome` span), FR-10 (constant), NFR-1 (helper tests in two zones)
- **Decisions made:** the Reviewer received the 267-line diff as a scratchpad file path instead of inline (Leader economy; the Reviewer read it with `Read`).
- **Issues encountered:** whole-project `tsc -p tsconfig.json` already fails in unrelated files (`src/common/configure-app.spec.ts` TS2352, a `kty` type mismatch) — pre-existing, untouched.
- **Final verification:** green.

### T-2: Rename step boundaries and "today" inside the server, with no change in behavior — PASS

- **Date:** 2026-10-27
- **Attempts:** 1
- **Skills / effort:** nestjs-best-practices (as listed) · `medium`
- **Attempt 1**
  - files changed (25): `server/src/admin-config/timelines/{timeline-rules,timeline-view,timelines.service,timelines.store,timeline-response,timeline-diff}.ts`, `timelines/dto/{create-timeline,update-timeline}.dto.ts`, `field-config/{field-config-versions,field-config.store,field-config.service}.ts`, `cycles/cycles.store.ts`, `database/drizzle/schema/timeline-steps.ts` (property names only); specs `timeline-rules`, `timeline-view`, `timeline-diff`, `timelines.service`, `timelines.unit-of-work`, `field-config-versions`, `field-config.service`, `field-config.unit-of-work`, `cycles.service`; `server/test/admin-config-field-config.e2e-spec.ts` (seeded row keys only), `server/test/support/in-memory-{admin-config,field-config}.ts`
  - Baseline at `f474d49`: unit 2356 (61 files), e2e 870 (14 files). After: identical
  - Implementer verification: lint 0 · build 0 · unit 2356/2356 · e2e 870/870
  - Falsifier (response mapper emits `opensAt`): `admin-config-timelines.e2e-spec.ts` 5 failed (`expected undefined to be '2026-11-03'`, deep-equal failures). Reverted
  - Red run: n/a (refactor)
  - Done-when grep: remaining hits are API-edge literals only — error paths in `timeline-rules.ts` (106, 196, 202, 208, 215, 550–561), audit keys in `timelines.service.ts:236,239` and `timeline-diff.ts:76-77` — plus an unrelated comment in `auth/session.controller.ts:144`
  - e2e diff-stat: 3 files, 12 +/12 −; `admin-config-timelines.e2e-spec.ts` untouched; no expected value edited
  - Evidence re-run (Leader inline): **VERIFIED** — lint and build clean, unit 2356/2356, e2e 870/870, same test diff-stat
  - Reviewer: **PASS** — clean rename; API keys, error paths, audit keys and SQL columns unchanged; values still `YYYY-MM-DD` fed by `todayInRome`; all three `timelineSteps` readers (P-7) updated; the three files outside the task's list are a necessary consequence (DTO `implements` targets, `field-config.service.ts` edge mapping), not scope creep
  - runtime events: none
- **spawns:** implementer not reported by host (worker: 65 tool calls, 157,416 tokens), ended complete; reviewer not reported by host, ended complete
- **Not Done / Assumptions (verbatim from the Implementer):**
  - I edited the two DTO files and `field-config.service.ts`, which your file list did not name. The command-type split needed the DTOs, and the service reads `TimelineStart`. DTO keys and OpenAPI metadata are unchanged.
  - In `field-config.service.spec.ts` the `addTimeline` fixture helper keeps its `opensOn` / `closesOn` input names. Only its row mapping changed, because the expected API bodies there are written with `opensOn`.
  - In the spec edits I kept the API-named `opensOn` / `closesOn` fixtures wherever they feed the service as commands, and renamed them only where they are internal rows or rules inputs.
  - I ran prettier on `timelines.service.ts` and its spec; the diff shows no unrelated reformatting.
  - `todayInRome` and `rome-date.ts` are untouched, and the new T-1 minute helpers are not used.
  - (Assumptions only, no owed item: not a continuation.)
- **ADVISORY (Reviewer, 4R — not gating):**
  - READABILITY: comments and test titles still say "today" (`timelines.service.ts:270,275`, `timeline-rules.spec.ts` "compares step 1 with the today it is given", fixture field `STATES[state].today`).
  - READABILITY: the local `romeNow` (a `YYYY-MM-DD` string) beside `now: Date` will be easy to confuse once T-3 makes `now` a minute.
  - RISK: `field-config.service.spec.ts` `addTimeline` keeps an API-to-internal mapping (`opensOn` → `opensAt`) that T-3 must keep in mind.
- **Forward pointers → T-3 (carry in its brief):** the `romeNow` local and the "today" wording above sit on T-3's own lines (`todayInRome` → `nowInRome`); the `addTimeline` mapping is a fixture site T-3 moves to minutes.
- **Requirements covered:** none directly (prepares T-3)
- **Decisions made:** the Reviewer received the 2,275-line diff as a scratchpad file (above the 300-line inline limit).
- **Issues encountered:** none.
- **Final verification:** green.

### T-3: Store minutes and judge by now (schema, migration `0006`, clock) — PASS (after Pivot)

- **Date:** 2026-10-27
- **Attempts:** 1 (implementation complete in the working tree, uncommitted; no Reviewer run — stopped on P-3 before review)
- **Skills / effort:** nestjs-expert, nestjs-best-practices, tdd (as listed) · `high` (permanent migration on a shared boundary)
- **Attempt 1**
  - files changed (31, uncommitted): `server/src/database/drizzle/schema/timeline-steps.ts`; `server/src/admin-config/rome-date.ts` (`todayInRome` removed); `timelines/{timeline-view,timeline-rules,timelines.service,timeline-response,timeline-diff}.ts`; `field-config/{field-config-versions,field-config.store,field-config.service}.ts`; `cycles/cycles.store.ts`; `server/drizzle/0006_timeline_step_times.sql`, `server/drizzle/rollback/0006_timeline_step_times.down.sql`, `server/drizzle/meta/_journal.json`, `server/drizzle/meta/0006_snapshot.json`; `server/src/database/AGENTS.md`; `server/test/support/in-memory-{admin-config,field-config}.ts`; specs `schema`, `timeline-view`, `field-config-versions`, `timeline-rules`, `timeline-diff`, `timelines.service`, `{timelines,cycles,field-config}.unit-of-work`, `field-config.service`, `rome-date`; e2e `admin-config-timelines`, `admin-config-field-config`
  - Implementer verification: lint 0 · build 0 · unit 2392/2392 and e2e 871/871 in the default zone (America/Bogota), `TZ=UTC` and `TZ=America/Bogota`; unit also under `TZ=Asia/Tokyo`
  - Red run: `field-config-versions.spec.ts` 26 failed (e.g. FR-8 same morning `expected { number: 3, provisional: true } to deeply equal { number: 2, provisional: false }`); `timelines.service.spec.ts` 3 failed (hold at the hour `expected 'scheduled' to be 'waiting_for_load'`); `schema.spec.ts` 8 failed (`0006` statements, 23:59 rewrite, down script, strict check). `timeline-view.spec.ts` had no red (lexical comparison already works after T-2)
  - Falsifiers: (1) `todayInRome` feeding `now` → 6 failed, `expected 'scheduled' to be 'waiting_for_load'`; (2) UPDATE dropped from `0006` → 3 failed in `schema.spec.ts`; (3) publish day instead of minute → 2 failed, "published the same morning". All reverted
  - `todayInRome` grep over `server/src` and `server/test`: no hit
  - NFR-4: no `toHaveLength` / statement-count expectation changed in the three unit-of-work suites; only column names and parameter values
  - Evidence re-run: not run (pivot before closure)
  - Reviewer: not run (pivot before closure)
  - runtime events: none
- **spawns:** implementer not reported by host (worker: 115 tool calls, 342,868 tokens), ended partial (Pivot-Detection flag)
- **Not Done / Assumptions (verbatim from the Implementer, condensed list of its items):**
  - Not applied or tested on a real MySQL: the up and down round trip, the P-4 `SELECT VERSION()` check, and CHECK enforcement are the HITL step (T-8). `0006` and its down script are pinned only by text.
  - Rules input keys: the rules inputs are the day-only `opensOn` / `closesOn` again, with `opensAt` / `closesAt` reserved for minutes (stored, merged, view), so a day and a minute never share a key. `toRulesStep*` is gone and `TimelineStepCommand = TimelineStepInput`.
  - `dayStart` / `dayEnd` are applied to the raw sent value, then `readMoment` runs `isRomeMinute` on the result, which refuses malformed days (pinned by a rules test).
  - Audit (FR-12): keys and values stay days until T-4/T-5; change detection already compares moments.
  - Behavior change from S-4, FR-5, FR-6: a day-only `opensOn` of today means 00:00, so it is `BEFORE_TODAY` once the Rome clock is past 00:00. Four tests adapted (service "judges today…", stale-mixed-read clock moved to 00:00, e2e "opening today is accepted" now at 00:00 plus a new e2e at 10:00 expecting `BEFORE_TODAY`).
  - `server/src/admin-config/AGENTS.md` still says dates are Rome days and names `todayInRome` (T-7).
  - The `0006` note in `server/src/database/AGENTS.md` says the snapshot is stale; it must change if the snapshot is fixed.

## Pivot Record: T-3

- **Trigger:** premise P-3 is false. `pnpm drizzle-kit generate --custom --name timeline_step_times` (exit 0) wrote an empty SQL file and journal entry 6, but `server/drizzle/meta/0006_snapshot.json` is a copy of the **previous** schema (`opens_on` / `closes_on` as `date`, check `closes_on >= opens_on`; only `id` / `prevId` differ from `0005_snapshot.json`). Leader confirmed: the snapshot holds `"opens_on"` only. Consequence: the next `pnpm db:generate` would propose the rename and retype again (a spurious `0007` behind an interactive rename prompt).
- **Spec rule hit:** `tasks.md` T-3 scope 1 — "If not, stop and use the Pivot Protocol (DD-6). Never edit the snapshot by hand." Design § 11 P-3 names the fallback: "add a generated migration and then a custom one, or edit the snapshot".
- **Implementer conduct:** flagged Pivot-Detection and continued to a complete implementation instead of stopping; the generated files are left as the tool wrote them (not hand-edited).
- **Alternatives:**
  1. A human runs the interactive `pnpm drizzle-kit generate --name timeline_step_times` once (answering "rename" for both columns) so the tool writes a true snapshot; the generated SQL body is then replaced by the reviewed four-step custom SQL. One migration, tool-written snapshot.
  2. Two migrations: the interactive generated one (schema + snapshot) as `0006`, and a custom `0007` for the 23:59 rewrite and the strict check.
  3. Accept the stale snapshot and document it (already drafted in `server/src/database/AGENTS.md`); every later `db:generate` must hand-discard the spurious diff.
  4. Edit the snapshot by hand — forbidden by T-3's scope text.
- **Also surfaced for the user (consequence of S-6 + FR-5, not a defect):** with day-only writes meaning 00:00, the current front (which sends days) can no longer create a timeline whose step 1 opens *today* once Rome is past midnight — `BEFORE_TODAY` — until P2-4021 ships the time picker.
- **State:** T-3 `[~]`; working tree holds the complete attempt-1 diff, uncommitted. Awaiting the user's decision before any further spawn.
- **User decision (2026-10-27, back lead):** alternative 1 — interactive generate, one migration, tool-written snapshot. The S-6 + FR-5 "today" side effect is **accepted as specified**; T-7's `front-contract.md` must state it for P2-4021.
- **Spec amended (two-direction sweep: `--custom` and P-3 across the spec folder):** `design.md` § 4 tree line, § 10 DD-6, § 11 P-3 (marked FALSE with evidence) and the `UNVERIFIED` summary line; `tasks.md` T-3 scope step 1. Carry these as named conformance checks into the T-3 Reviewer brief.
- **Leader prep (mechanical, tool-generated files only):** the reviewed custom SQL was saved to the session scratchpad; the empty-generated `drizzle/0006_timeline_step_times.sql`, the stale `drizzle/meta/0006_snapshot.json` and journal entry 6 were removed (journal restored to `HEAD`) so the interactive generate can write `0006` cleanly. The rest of the attempt-1 tree is kept.
- **Waiting on:** the back lead runs the interactive generate in a real terminal.

### T-3 closure (after the Pivot)

- **P-3 settled (tasks.md T-3 step 1 as amended):** the back lead ran `pnpm drizzle-kit generate --name timeline_step_times` interactively (`~ opens_on › opens_at`, `~ closes_on › closes_at`, both renames). `drizzle/meta/0006_snapshot.json`: `timeline_steps.opens_at` / `closes_at` are `datetime`, `opens_on` / `closes_on` absent, `chk_timeline_steps_dates` = `` `closes_at` > `opens_at` ``, `_meta.columns` records both renames, `prevId` chains to `0005_snapshot.json`. Journal entry `idx 6` / `0006_timeline_step_times`. Leader probe afterwards: `drizzle-kit generate --name probe` → "No schema changes, nothing to migrate".
- **Leader edits after the generate (mechanical, reviewed):** the generated SQL body (rename before dropping the check, no 23:59 rewrite) was replaced by the Implementer's reviewed four-statement SQL; the stale-snapshot sentence in `server/src/database/AGENTS.md` was replaced by the interactive-generate provenance and a warning against `--custom` for column changes. (The attempt-1 "Not Done" item about that sentence is therefore resolved.)
- **Evidence re-run (Leader inline):** **VERIFIED** — lint and build clean; unit 2392/2392 in America/Bogota (machine default) and `TZ=UTC`; e2e 871/871 in both zones; `todayInRome` grep over `server/src` and `server/test`: 0 hits.
- **Review mode:** parallel lens reviewers (migration / data-loss surface).
  - Reviewer A (risk + resilience, baseline conformance): **PASS** — `0006` holds the four § 5 steps in order (drop check first is required by MySQL); the strict check cannot fail on migrated rows; down script reverses § 5, lossy, outside the journal; named conformance checks for the amended DD-6, P-3, § 4 tree line and T-3 step 1 pass; custom column type and codec pin conform to DD-3 / P-2; NFR-4 counts unchanged.
  - Reviewer B (reliability + readability, baseline conformance): **PASS** — every T-3 scenario (FR-2, FR-4 span, FR-7, FR-8, FR-9 old-client create, FR-11, FR-13) is pinned with literal values; all six P-6 sites use `nowInRome`; red on behavioral assertions; rules-input key choice (`…On` days / `…At` minutes) conforms to design § 7.2–7.3; the adapted "today" tests state and assert their new scenarios (Disqualifier clean); T-2 forward pointers handled.
- **spawns:** reviewer A not reported by host (21 tool calls, 61,202 tokens), ended complete; reviewer B not reported by host, ended complete
- **ADVISORY (not gating):**
  - RESILIENCE (A): MySQL DDL is not transactional — a failure after statement 2 leaves a half-migrated table and a re-run fails at `DROP CHECK`; `sql_safe_updates` (Workbench default) refuses the unfiltered `UPDATE` (error 1175).
  - RISK (A): the lossy down path is tested only as text; T-8 should include one step moved to a non-00:00/23:59 time.
  - RELIABILITY (A): `fromDriver` throws if the driver ever returns a `Date` (P-2) — acceptable, guarded by the codec pin.
  - READABILITY (B): `timeline-rules.spec.ts` row "step 1 opens today" is valid only because `now` is 00:00; `checkLocks` local `beforeToday` could be `beforeNow`; `spanInDays` in `cycles.store.ts` could note that either driver form works.
  - READABILITY (B): the S-6 day→minute mapping runs twice on create (rules and insert) — one resolver both consume would keep T-4's "exactly one of `…At` / `…On`" choice in one place; `TimelineStepCommand` / `TimelineStepUpdateCommand` are now plain aliases.
  - RELIABILITY (B): interim audit for a same-day time-only change records `{before: day, after: day}` until T-5 — T-5 must land in the same PR.
  - RELIABILITY (B): the strict `closesAt <= opensAt` rule has no T-3 pin (day-only input cannot reach it); T-4's FR-3 "same moment" case is the pin.
- **Forward pointers:**
  - → T-4: one moment resolver shared by rules and insert (B); FR-3 "same moment" pins the strict close rule (B); `TimelineStepCommand` aliases are where the wire shape diverges.
  - → T-5: audit values move to moments in the same PR (B).
  - → T-7: state the accepted S-6 + FR-5 consequence (old front cannot open step 1 "today" after 00:00 Rome) in `front-contract.md` for P2-4021.
  - → T-8: recovery note for a half-applied `0006`; apply with `pnpm db:migrate` or a session without `sql_safe_updates`; include one step at a non-00:00/23:59 time in the down round-trip (A).
- **Requirements covered:** FR-2, FR-4 (span), FR-7, FR-8, FR-9 (Old client creates), FR-11 (SQL pin), FR-13, NFR-1, NFR-3 (statement pin), NFR-4
- **Final verification:** green.

### T-4: Minute-level write rules (moments, compatibility, DST, codes) — PASS

- **Date:** 2026-10-27
- **Attempts:** 1
- **Skills / effort:** nestjs-expert, api-design-principles, error-handling-patterns, tdd (as listed) · `high` (every user-facing write rule)
- **Attempt 1**
  - files changed (10): `server/src/admin-config/timelines/{timeline-rules,timelines.service}.ts`, `timelines/dto/{create-timeline,update-timeline}.dto.ts`, `timelines/dto/create-timeline.dto.spec.ts` (new), `timelines/dto/update-timeline.dto.spec.ts`, `server/src/common/error-codes.ts`, `common/error-codes.spec.ts`, `timeline-rules.spec.ts`, `timelines.service.spec.ts`
  - Implementer verification: lint 0 · build 0 · unit 2466/2466 (default, `TZ=UTC`, `TZ=America/Bogota`) · e2e 871/871 through the e2e vitest config with `--maxWorkers=2` (the `pnpm test:e2e` alias was refused by the local resource guard for RAM)
  - Red run: 48 new rules cases failed on their assertions before the reader (e.g. Valid moments received `REQUIRED steps[0].opensOn…`; DST expected `steps[0].opensAt DST_HOUR`); `error-codes.spec` exact-codes list red on `-  "DST_HOUR"`. Not assertion reds: the `DST_HOUR` message case (TypeError) and the `momentsOfStep` cases (written after)
  - Falsifiers: (1) `<=` → `<`: 1 failed, "Same moment or reversed: the same minute is CLOSES_BEFORE_OPENS on closesAt"; (2) errors always on `…At`: 8 failed (`- "field": "steps[1].opensOn"` / `+ "steps[1].opensAt"`); (3) prefer `…At` silently: 6 failed. All reverted
  - Resolver: one `readBoundary(edge, at, on, family)` feeds create validation, `mergeTimelineUpdate` / `validateTimelineUpdate`, and the insert via exported `momentsOfStep` (throws on an unvalidated step); `openingFrom` / `closingFrom` removed (T-3 forward pointer closed)
  - Evidence re-run (Leader inline): **VERIFIED** — lint and build clean; unit 2466/2466 (America/Bogota and `TZ=UTC`); the `pnpm test:e2e` alias itself 871/871; `git diff -- server/test` empty
  - Reviewer: **PASS** — every FR-1/3/4/5/6/9 scenario, BUT and AND IT MUST has a named test with pinned `now`, exact field and code; reader matches § 7.2; strict close; `DST_HOUR` in the catalog; DST cases on real change days; falsifiers traced
  - runtime events: none
- **spawns:** implementer not reported by host (worker: 54 tool calls, 221,794 tokens), ended complete; reviewer not reported by host, ended complete
- **Not Done / Assumptions (verbatim from the Implementer, condensed list of its items):**
  - The `pnpm test:e2e` alias was blocked by the resource guard (RAM 3766 MB under the 4500 MB required); the identical vitest config was run directly with `--maxWorkers=2`. (Resolved: the Leader ran the alias, 871/871.)
  - Both forms with a null value: any boundary where both an `…At` and an `…On` key are present (not `undefined`), even if one is null, is refused as `INVALID` on `…On`.
  - A boundary with a problem (REQUIRED, INVALID, DST_HOUR) skips the follow-on rules.
  - Create steps with no boundary key report REQUIRED on `…At` unless the request sent only day-only keys, then on `…On` (keeps e2e 656-706).
  - The `@ApiProperty` text of the day-only DTO keys was reworded (no "Required"), not deprecated (T-5).
  - No response-shape, audit-key or e2e change.
- **Spec tension (Reviewer verdict (b), carried to the user at this gate):** `design.md` § 7.2 says "Neither, on create → REQUIRED on `…At`", but T-4's own gate ("the e2e suite is unchanged and green") and DD-5 require an old client to get `steps[2].closesOn` (`server/test/admin-config-timelines.e2e-spec.ts:676,704`). § 7.2 is also silent on the key for an unsent boundary on edit. Proposed one-line amendment: *"A boundary the request did not send (missing on create, stored on edit) is named on `…On` when the request sent only day-only keys, else on `…At` (DD-5)."*
- **ADVISORY (Reviewer, not gating):**
  - RISK: the `…At` keys are `nullable: true` and a null key counts as sent, so `opensAt: '…', opensOn: null` is `INVALID` — T-5's OpenAPI text or T-7's contract must say "send one key per boundary; a null key counts as sent".
  - READABILITY: `Boundary.raw` holds the normalized moment, not what was sent (`mergedValue` would fit).
  - RELIABILITY: on an edit of a closed step, a null/malformed/DST boundary reports both `LOCKED` and its own code (old double report kept).
  - COVERAGE: FR-6 "the step closes at 14:20:59" is view behavior; a T-6 case should pin 14:20:59 `in_progress` and 14:21:00 `closed` for a step moved to 14:20.
- **Forward pointers:** → T-5: null-counts-as-sent wording in OpenAPI; deprecation of `…On`. → T-6: the FR-6 14:20:59 / 14:21:00 view pin; e2e cases follow § 7.2 as amended (if approved). → T-7: one key per boundary, null counts as sent.
- **Requirements covered:** FR-1, FR-3, FR-4 (rule), FR-5, FR-6, FR-9 (both forms, day-only edit)
- **Final verification:** green.
- **Gate decision (2026-10-27, back lead):** amendment approved. `design.md` § 7.2 reader table rows "Neither, on create / on edit" now point to the request's family, and the sentence above was added after the key-memory paragraph. Carry it as a named conformance check into the next Reviewer brief (T-5) and into T-6's brief.

### T-5: API surface (moments and time zone in responses, OpenAPI, audit keys) — PASS

- **Date:** 2026-10-27
- **Attempts:** 1
- **Skills / effort:** nestjs-expert, api-design-principles (as listed) · `medium`
- **Attempt 1**
  - files changed (13): `server/src/admin-config/timelines/{timeline-response,timeline-diff,timelines.service}.ts`, `timelines/models/timeline.model.ts`, `timelines/dto/{create-timeline,update-timeline}.dto.ts` (description text only), specs `timeline-diff`, `timeline-response` (new), `timelines.service`; `server/test/openapi.e2e-spec.ts`, `server/test/admin-config-timelines.e2e-spec.ts`
  - Implementer verification: lint 0 · build 0 · unit 2470/2470 (default and `TZ=UTC`) · e2e 872/872
  - Red run (implementation stashed): `timeline-diff.spec.ts` 4 failed on keys/values (`expected { 'steps.2.closesOn': … } to deeply equal { 'steps.2.closesAt': … }`); `timeline-response.spec.ts` (`expected undefined to be 'Europe/Rome'`); service 2 audit-key cases; OpenAPI pin (`opensAt` / `closesAt` missing)
  - Falsifier 1 (mapper hardcodes `'Europe/Rome'`): NFR-2 grep 2 → 3 hits (`timeline-response.ts:125`); the mapper spec stayed green (same value) — only the grep catches it, as the task says. Falsifier 2 (diff key `closesOn`): 2 failed incl. "FR-12 time-only change … recorded under closesAt with moment values, and no closesOn key exists". Both reverted
  - Expected-body edits: additions of `opensAt` / `closesAt` / `timeZone` and the audit key move to `…At` minute values only; no `…On` or error-path expectation changed or removed
  - Evidence re-run (Leader inline): **VERIFIED** — lint and build clean; unit 2470/2470 (America/Bogota and `TZ=UTC`); e2e 872/872; NFR-2 grep: 2 lines, both `rome-date.ts` (line 7 a `/** … */` doc comment holding the literal, line 8 the constant)
  - Reviewer: **PASS** — mapper, models (`…On` deprecated, examples, `timeZone` from `QA_TIME_ZONE`) and audit keys match § 6 / § 7.7, DD-7, DD-8; named check § 7.2 (amended 2026-10-27) not contradicted; `changedSteps` and DTO description edits are a necessary consequence; OpenAPI pin checks properties; pin placed in `openapi.e2e-spec.ts` satisfies the task's "`/`" alternative
  - runtime events: none
- **spawns:** implementer not reported by host (worker: 33 tool calls, 136,246 tokens), ended complete; reviewer not reported by host, ended complete
- **Not Done / Assumptions (verbatim from the Implementer, condensed list of its items):**
  - The field-config preview (`PreviewTimeline.opensOn`) is untouched. Design § 6 and § 7.7 do not name it.
  - I assumed the audit key change must reach `changedSteps` in the service. That is a consequence of the task's diff-key change, not a widening.
  - The repo-wide `tsc --noEmit` shows errors in two unrelated spec files (`token-verifier.service.spec.ts`, `configure-app.spec.ts`).
- **ADVISORY (Reviewer, not gating):**
  - READABILITY: the request DTOs' `opensOn` / `closesOn` descriptions lack the "a null key counts as sent" rule and are not deprecated on write (outside T-5's scope).
  - READABILITY: `timeZone` typed `string`; `typeof QA_TIME_ZONE` would carry the single source into the type.
  - RISK: audit history now holds `…On` keys (older records) and `…At` keys (from now on); readers must handle both.
- **Forward pointers:**
  - → T-6: its NFR-2 grep expects 1 code line but finds 2 — the `rome-date.ts:7` doc comment `/** … */` contains `'Europe/Rome'` and the grep's `grep -v '^\S*:\s*//'` filter only drops `//` comments. T-6 is "no production code", so this needs a decision at the T-6 gate.
  - → T-7: both audit key families; one key per boundary / null counts as sent also for the day-only request keys; the S-6 + FR-5 "today" consequence; P-8 readers.
- **Requirements covered:** FR-1 (returned exactly), FR-9 (Read), FR-10, FR-12
- **Final verification:** green.
- **Execute-time spec edit (2026-10-27, Leader, meaning unchanged):** `tasks.md` T-6 Verification — the NFR-2 grep filter now also drops `/** … */` doc-comment lines (`grep -vE '^\S*:[0-9]+:\s*(//|/\*|\*)'`), matching NFR-2's "1 code line (comments excluded)". The old filter (`grep -v '^\S*:\s*//'`) also never matched `grep -rn` output, whose prefix is `file:line:`. With the new filter the grep returns 1 line (`rome-date.ts:8`). Carry it as a named conformance check into T-6's Reviewer brief.

### T-6: End-to-end scenarios and the cross-cutting NFR checks — PASS (attempt 2)

- **Date:** 2026-10-27
- **Skills / effort:** nestjs-expert, tdd (as listed) · attempt 1 `medium`, attempt 2 `high` (bumped on FAIL)
- **Attempt 1**
  - files changed: `server/test/admin-config-timelines.e2e-spec.ts` (new `describe('step times (P2-4019)')`, 10 cases), `server/test/admin-config-field-config.e2e-spec.ts` (new block, 2 cases, type-only `RomeMinute` import)
  - Implementer verification: e2e 884/884 under `TZ=UTC` and `TZ=America/Bogota` · unit 2470/2470 · lint 0 · NFR-2 grep 1 line (`rome-date.ts:8`) · NFR-4: `expect(listMany).toHaveLength(7)` in the e2e NFR-5 list test unchanged since `8ac4df7`
  - Falsifiers: (1) hold read at 13:59:59 Rome → `FR-7 The hold starts at the hour`: `expected 'scheduled' to be 'waiting_for_load'`; (2) second literal → NFR-2 grep 2 lines. Both reverted
  - Evidence re-run (Leader inline): **VERIFIED** — lint clean; e2e 884/884 in both zones; unit 2470/2470; NFR-2 grep 1 line
  - Reviewer: **FAIL** (verbatim):

    > 1. **Discovered Issue:** The test `FR-9 Both forms for the same moment: refused on the day-only field even when they agree` never sends a pair that agrees. It sends `opensAt: '2026-11-10T14:00'` with `opensOn: '2026-11-10'` (the day-only value means 00:00), and `closesAt: '2026-11-12T17:30'` with `closesOn: '2026-11-12'` (means 23:59). Both pairs disagree as moments. If the server accepted pairs that match after normalizing, this test would stay green. Its title claims a guarantee it does not check over HTTP.
    >    * **Violated Rule:** `requirements.md` FR-9, scenario Both forms (`:243-246`): "BUT it must NOT pick one silently, even when they agree". `tasks.md` Coverage (`:348`) makes T-6 a co-owner of "FR-9 | Both forms; BUT never picked silently". T-4 covers it only in unit tests (`timeline-rules.spec.ts:1756,1771`).
    >    * **Remediation Suggestion:** Add the agreeing pairs to the e2e case and keep the current ones: `{ ...STEP_A, opensAt: '2026-11-10T00:00', opensOn: '2026-11-10' }` must give `[['steps[0].opensOn','INVALID']]`, and `{ ...STEP_A, closesAt: '2026-11-12T23:59', closesOn: '2026-11-12' }` must give `[['steps[0].closesOn','INVALID']]`, with `rows()` unchanged. Alternatively, rename the current case so it no longer claims "agree", but that leaves the BUT clause untested over HTTP.

  - Reviewer verdicts on the Leader's questions: FR-5 "in_progress at once" read after `markLoaded` is **conformant** (FR-7 puts a no-load timeline on hold; T-4's rules test used `hasLoad: true`), with a spec wording gap — FR-5's GIVEN omits the load that FR-2's GIVEN states; proposed amendment: add "and the timeline has a load" to FR-5's GIVEN (to the user at the T-6 gate). NFR-4 accepted: the only list-read count test is the e2e NFR-5 test; "unit-of-work list test" in `tasks.md` is a wording slip.
  - ADVISORY: NFR-4 wording slip in `tasks.md`; FR-6 14:20:59 / 14:21:00 pins correct; the NFR-2 filter would drop a code line starting with a block comment then carrying the literal (unlikely); the FR-8 seed changes only `opensAt` (a comment would help).
  - runtime events: none
- **spawns (attempt 1):** implementer not reported by host (worker: 32 tool calls, 131,760 tokens), ended complete; reviewer not reported by host, ended fail
- **Attempt 2** (effort `high`)
  - files changed: same two e2e files; the disagreeing "Both forms" pairs kept as their own case, retitled "FR-9 Both forms for the same moment: opensAt 14:00 with opensOn, and closesAt 17:30 with closesOn, are refused on the day-only field and nothing is written"; new case "FR-9 Both forms for the same moment, even when they agree: opensAt 00:00 with opensOn, and closesAt 23:59 with closesOn, are refused on the day-only field and nothing is written" (400 `VALIDATION_FAILED`, `steps[0].opensOn` / `steps[0].closesOn` `INVALID`, `rows()` unchanged); FR-8 seed comment ([advisory-grade])
  - Implementer verification: e2e 885/885 under `TZ=UTC` and `TZ=America/Bogota` · lint clean · NFR-2 grep 1 line
  - Falsifier: agreeing opens assertion changed to `[]` → `expected [ [ 'steps[0].opensOn', 'INVALID' ] ] to deeply equal []`; reverted (opens pair only)
  - Evidence re-run (Leader inline): **VERIFIED** — lint clean; e2e 885/885 in both zones; NFR-2 grep 1 line
  - Reviewer: **PASS** — attempt 1 issue resolved; both branches of the FR-9 BUT covered over HTTP; rest of the diff unchanged from attempt 1; attempt 1 verdicts (FR-5 conformant, NFR-4 accepted) stand
  - runtime events: none
- **spawns (attempt 2):** implementer not reported by host (worker: 17 tool calls, 86,759 tokens), ended complete; reviewer not reported by host, ended complete
- **Requirements covered:** over HTTP — FR-1, FR-2, FR-3 (same day, overlap), FR-5, FR-6 (14:20:59 / 14:21:00), FR-7, FR-8 (both), FR-9 (old client, both forms incl. BUT), FR-10; NFR-1, NFR-2, NFR-4
- **Spec wording gap for the user (T-6 gate):** FR-5's GIVEN omits the load that FR-2's GIVEN states; proposed: add "and the timeline has a load" to FR-5 "Earlier today". Also `tasks.md` T-6 says "unit-of-work list test" for NFR-4 where the pinned test is the e2e NFR-5 list test.
- **Final verification:** green.
- **Gate decision (2026-10-27, back lead):** amendments approved — `requirements.md` FR-5 "Earlier today" GIVEN adds "and the timeline has a load"; `tasks.md` T-6 NFR-4 wording now names the e2e list test. Text only; carried as named conformance checks into T-7's Reviewer brief.
