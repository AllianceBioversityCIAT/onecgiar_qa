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
