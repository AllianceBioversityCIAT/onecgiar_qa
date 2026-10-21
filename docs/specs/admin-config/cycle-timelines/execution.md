# Cycles and QA timelines — Execution Log

## Document Control

| | |
|---|---|
| Spec path | `docs/specs/admin-config/cycle-timelines` |
| Branch | `feat/cycle-timelines` |
| Approval Mode | gated (from the proposal) |
| Started | 2026-10-21 |
| Leader | Claude Code, `opus` (T1) — operator: Juan D. Guzmán (back lead) |
| Workers | `akili-implementer` (T2 wrapper) · `akili-reviewer` (T3 wrapper) |
| Budget (design § 10) | 10 tasks · ~2,600 LOC · ~14 Reviewer passes |

Persona check: `akili doctor --agents` — no drift blocking (2026-10-21).

## Task Execution History

### T-1: Schema and migration `0003` for the six tables — PASS

- **Date:** 2026-10-21
- **Final status:** PASS (attempt 1)
- **Implementer attempts:** 1
- **Skills / effort:** nestjs-expert, nestjs-best-practices (as listed) · effort `high` (above the T2 `medium` default: a shared schema on a DB that is never reset; exact SQL matters).
- **Scheduling:** T-1 and T-2 were both eligible with disjoint source files, but they share `dist/` and the full test run. They ran serially (leader.md → *Disjoint source files are necessary but not sufficient*).

**Attempt 1**
- **Files changed:** `server/src/database/drizzle/schema/{cycles,timelines,timeline-steps,timeline-programs,timeline-result-types,timeline-users}.ts` (new), `server/src/database/drizzle/schema/index.ts`, `server/src/database/drizzle/schema/schema.spec.ts`, `server/drizzle/0003_cycle_timelines.sql` (new), `server/drizzle/meta/0003_snapshot.json` (new), `server/drizzle/meta/_journal.json`, `server/src/database/AGENTS.md`.
- **runtime events:** session death ×1 (the previous Claude Code session ended mid-spawn) → rung 1 tree probe (partial edits found: the six schema files, `0003` + snapshot, spec, index, journal, AGENTS.md) → rung 3 resume-by-message (worker context survived). The worker re-read its files from the tree and finished.
- **Red run:** the six re-exports were removed and `0003` + snapshot moved aside. First failure: `AssertionError: expected [ '0000_silent_risque.sql', …(2) ] to have a length of 4 but got 3`. Totals 43 failed / 38 passed. The table pins failed with `the table is exported by schema/index.ts: expected undefined to be defined`. Restored afterwards (journal identical).
- **Falsifiers** (each run as `pnpm exec vitest run src/database/drizzle/schema/schema.spec.ts`, then reverted):
  - F1, `official_key` as a plain column: `schema.spec.ts:680`, `AssertionError: official_key is stored: expected undefined to be 'stored'` (1 failed).
  - F2, `position <> 1 OR` dropped: `schema.spec.ts:815`, `AssertionError: expected '`requires_load`' to be '`position` <> 1 OR `requires_load`'`.
  - F3, `opens_on` in date mode: `schema.spec.ts:764`, `AssertionError: opens_on: expected 'date' to be 'string'`.
- **Implementer verification:** `pnpm lint` exit 0 · `pnpm build` exit 0 · `pnpm test --reporter=dot` 41 files / 1360 tests passed · `npx tsc --noEmit` 7 errors, all in `src/auth/token-verifier.service.spec.ts` (baseline). An extra tsc error from an `.autoIncrement` pin was replaced by an SQL pin after the falsifier runs; everything was re-run green afterwards.
- **Evidence re-run (Leader inline, non-author):** VERIFIED. Lint OK, build OK, 41 files / 1360 tests passed, and tsc reported 7 errors in `token-verifier.service.spec.ts` only.
- **Reviewer verdict:** PASS. T-1 matches design § 5 table by table. `0003` is strictly additive: 6 CREATE TABLE, 13 FK ADD CONSTRAINT, 2 CREATE INDEX, and no DROP, MODIFY, RENAME or data statements. The reserved load tables are absent. Pins are exact: full column maps, exact CHECK SQL and generated SQL, `toEqual` on unique and FK sets, and collation asserted in both schema and SQL. Each falsifier fails on its target behavior.
- **spawns:** implementer — not reported by host for the first (killed) segment; resumed segment 8 calls, 167,732 tokens, ended complete · reviewer 16 calls, 72,627 tokens, ended complete.

**ADVISORY (Reviewer, 4R — not gating)**
- RISK: `server/drizzle/meta/0003_snapshot.json` must be committed with the migration, or the next `drizzle-kit generate` re-emits the six tables. → Committed in the T-1 commit.
- RISK: the `timelines.ts` comment equates `utf8mb4_0900_ai_ci` with what `users.nickname` gets implicitly. That holds only if qadb's server default is `0900_ai_ci`, which is unverified. Confirm at T-10 (`SHOW FULL COLUMNS FROM users`).
- READABILITY: `ai` makes accents collide too ("Julio" = "Júlio"), which goes beyond FR-6's "regardless of letter case". Worth one line in the database AGENTS.md and a business question.
- RELIABILITY: NOT NULL on `created_by` / `assigned_by` rules out seeded or system-created rows. That is acceptable here; recorded below as deliberate.
- RESILIENCE: CHECK and generated-key behavior on real MySQL is still owed by T-10.

**Requirements covered:** FR-1 (unique year key), FR-3 (`active_key`), FR-5 (`official_key` backstop), FR-6 (unique per cycle, case-insensitive collation), FR-8 (`chk_timeline_steps_dates`, same day valid), FR-9 (`chk_timeline_steps_first_load`, no default), FR-14 / FR-15 (`timeline_users.active_key`, `chk_timeline_users_removed`, soft remove), NFR-3 (DB part), NFR-6 (reserved tables not created).

**Decisions made**
- **P-12 settled:** without `dateStrings`, mysql2 builds a local-zone `Date` for DATE. See `lib/parsers/text_parser.js:58-63`, `lib/packets/packet.js:731-747` (`localDate(...)` when timezone is unset or `'local'`), and `lib/parsers/local_date.js:6-7`. The defaults are `connection_config.js:123` (`dateStrings = false`) and `:142` (`timezone = 'local'`), and `drizzle.module.ts:18-21` sets neither. Drizzle's mysql2 session `typeCast` returns `field.string()` for DATE on reads (`drizzle-orm/mysql2/session.js:26-31, 36-41, 168-173`), so a default-mode `date` reads as UTC midnight with no shift. The shift risk is on writes: a default-mode `date` has no `mapToDriverValue`, and sql-escaper `dateToString` serializes with timezone `'local'` (`sql-escaper/lib/index.js:319-326`). **DD-5 (string mode) stays justified**, because it removes both paths. Nothing else changes. This finding comes from reading source only; the round-trip is confirmed at T-10.
- `timelines.name` collation is explicit `utf8mb4_0900_ai_ci`, which is case- and accent-insensitive. The Reviewer judged it within FR-6 / P-7 ("same collation approach as `users.nickname`"). Accent-insensitivity is surfaced to the back lead at the T-1 gate.
- `cycles.created_by`, `timelines.created_by` and `timeline_users.assigned_by` are NOT NULL, because every writer in this spec is an authenticated ADMIN route. Design § 5 is silent on this.
- `chk_cycles_lifecycle` follows design § 5 literally: `closed` requires `closed_*` and leaves `activated_*` unconstrained.
- Generated SQL was not hand-edited; drizzle `customType` expresses the generated columns, CHECKs and collation.

**Issues encountered:** the worker's first red-run attempt dropped two unrelated exports. It discarded that attempt and redid it correctly. Nothing was left in the tree.

**Final verification:** VERIFIED, as in the evidence re-run above. `pnpm db:migrate` was never run (T-10 is a human step).
