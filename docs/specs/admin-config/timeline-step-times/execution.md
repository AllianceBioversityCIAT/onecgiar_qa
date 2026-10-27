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
