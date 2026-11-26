# Round 2, step 5: the PPU (P2-3917) — Execution log

| Field | Value |
|---|---|
| Branch | `feature/P2-3917-ppu-close-cases` from `origin/staging-center` `eb2db04` |
| Executor | Claude (back), on the back lead's brief of 2026-11-26 |
| Gate per task | The task's own specs; `tsc --noEmit` held at the baseline count of pre-existing spec type errors |
| Gate at the push | `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm test:e2e` (§ Gate) |

## Decisions taken during the run

| When | Decision | Source |
|---|---|---|
| Before T-1 | AC6: read on open, store the first detection date (migration `0015`) | Back lead, 2026-11-26 (answer to OQ-1) |

## Tasks

| Task | Status | Commit | Checks |
|---|---|---|---|
| T-0 spec | [x] | `663e8b3` | — |
| T-1 rules, `ppu` transition, Unresolved / Pending PPU rows (TS + SQL) | [x] | `da9dd31` | `qa-status.spec.ts` (1,500 input combinations, TS = SQL), `comment-transitions.spec.ts`, `round-two-ppu-rules.spec.ts`: 128 passed |
| T-2 PPU row (no date window), scope, `tpbAssessment`, worklist `ppuStepClosed`, counters | [x] | `73de985` | `scope-ppu.spec.ts` (15), assessment unit 1052 passed; disabled-role pins reworked (no reviewer row is disabled any more); e2e assessment + AI + quick comments 290 passed |
| T-3 thread with the TPB decision, PPU view, step-5 green, own step | [x] | `63b97c2` | `assessment-view-ppu.spec.ts` + TPB view spec 19 passed; assessment unit 1076 passed |
| T-4 Done / undo, auto-end, `applyPpuDecisions`, DTO (`body` optional for `ppu_done`), refusals | [x] | `7f47122` | `assessment-round-two-ppu.e2e-spec.ts` 17 passed |
| T-5 migration `0015` + down + schema; AC6 read / compare / store; OpenAPI members (also the TPB's `round` / `leadDecision`, missed in P2-3916) | [x] | `31a404e` | `schema.spec.ts` (16 migrations, 0015 pinned), `assessment.store-ppu.spec.ts` (6), `assessment-round-two-ppu-reporting.e2e-spec.ts` (4), round-2 view OpenAPI pin |
| T-6 Admin as PPU, quick comments | [x] | `7f47122` | in the PPU e2e (FR-11, FR-12) |
| T-7 full-flow e2e | [x] | `7524a8d` | `assessment-round-two-ppu-flow.e2e-spec.ts` 2 passed |
| T-8 guide, front contract, contracts that called the PPU not built | [x] | (this commit) | docs |

## Findings during the run

| # | Finding | Action |
|---|---|---|
| F-1 | The OpenAPI thread-item model lacked the TPB members (`round`, `leadDecision`) and the TPB values in `choices` since P2-3916 | Added with the PPU's (`tpbDecision`, `changedInReporting`, `ppu_done`) in T-5 |
| F-2 | The Lead e2e "unknown decision" used `ppu_done` as its unknown value; it is a known value now (a Lead sending it gets 409) | The test uses `not_a_decision` |
| F-3 | Enabling the PPU leaves no disabled reviewer row: the "assigned to a disabled role" tests lost their case | Reworked as "assigned, no live grant" (the only roleless case left) |

## Gate (before the push, in `server/`, 2026-11-26)

| Command | Result |
|---|---|
| `pnpm lint` | exit 0, no findings |
| `pnpm build` | exit 0 |
| `pnpm test` | Test Files 132 passed, 1 skipped (133); Tests 4424 passed, 6 skipped (4430) |
| `pnpm test:e2e` | Test Files 45 passed (45); Tests 1379 passed (1379) |
| `client: npm run build` | OK (team rule) |
