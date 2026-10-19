# User management (core) — Execution Log

## Document Control

| | |
|---|---|
| Spec path | `docs/specs/auth/user-management/core` |
| Branch | `feat/auth-user-management` (worktree `onecgiar_qa-users`) |
| Approval Mode | gated |
| Leader | Claude Code `opus` (T1) · Implementer `sonnet` (T2, `akili-implementer`) · Reviewer `opus` (T3, `akili-reviewer`) |
| Started | 2026-10-19 |
| Budget (design § 2) | 10 tasks · ~3,200 LOC · ~16 Reviewer passes |

Note: `requirements.md` and `design.md` read `Status: Draft`; execution started on the back lead's `/akili-execute` invocation (2026-10-19).

## Task Execution History

### T-1: Schema and migration for nickname, program scope, exclusions and audit

- **Final status:** PASS (Reviewer)
- **Date:** 2026-10-19
- **Attempts:** 1
- **Skills:** nestjs-expert, nestjs-best-practices (task list) + `tdd` (Leader: constraint-heavy schema, red-first pays). Effort `high` (shared schema on a DB that is never reset).

#### Attempt 1

- **Files changed:** `server/src/database/drizzle/schema/{users,index,schema.spec}.ts`; new `server/src/database/drizzle/schema/{user-programs,user-program-exclusions,user-audit-events}.ts`; new `server/drizzle/0001_user_management.sql`, `server/drizzle/meta/0001_snapshot.json`; `server/drizzle/meta/_journal.json`; `server/src/auth/admission.service.spec.ts` (fixture `userRow` + `null, 'none', null` — stub driver maps users rows by position; new columns declared last to match the migration's append order).
- **Implementer verification:** `pnpm lint` exit 0; `pnpm test --reporter=dot --maxWorkers=2` 22 files, 602 passed (baseline 586); `pnpm build` refused by the resource guard (RAM), `tsc --noEmit -p tsconfig.build.json` exit 0 in its place.
- **Red run:** 17/29 new `schema.spec` cases failed at assertion level before schema code (e.g. `expected undefined to be 'varchar(50)'`; `expected [ '0000_silent_risque.sql' ] to have a length of 2 but got 1`; `expected '' to contain 'CREATE TABLE \`user_programs\`'`). Two non-assertion TypeErrors were not counted as red.
- **Falsifiers executed:** (1) removed `origin = 'reporting'` from the dismissed CHECK → `CHECK: dismissed requires origin reporting…` red (and the 0001 migration test); (2) `active_key` as `IF(1, …)` → the `active_key … depends on status` test red (and the exact migration string test). Reverted; 29/29 green.
- **Evidence re-run (Leader-inline, non-author):** `pnpm lint` exit 0; `pnpm test --reporter=dot --maxWorkers=2` 22 files / 602 passed; `npx tsc --noEmit -p tsconfig.build.json` exit 0 → **VERIFIED** for these three. `pnpm build` blocked twice by the resource guard, then run by the Leader: exit 0 → **VERIFIED**.
- **Reviewer verdict:** PASS — schema and `0001_user_management.sql` match design § 5 row by row; additive only; CHECKs emitted with unqualified identifiers per `server/src/database/AGENTS.md`; tests assert constraint content, not table existence; the admission fixture edit is a necessary consumer adjustment (fixture only, no assertion touched).
- **runtime events:** none
- **spawns:** implementer not reported by host calls, 156017 tokens (65 tool uses), ended complete; reviewer not reported by host calls, 49936 tokens (10 tool uses), ended complete

#### ADVISORY (Reviewer, 4R — non-gating)

- RISK — `chk_user_program_exclusions_ended` requires `ended_by IS NOT NULL` when status ≠ `active`; § 5 says `created_by NULL = system` but has no matching rule for ending. If child 2's sync ends a `reporting` exclusion itself, the CHECK blocks it — in tension with DD-5's "child 2 writes `reporting` rows without schema change". **Raised to the user as a spec tension (below).**
- READABILITY — § 5 "ended fields set iff status ≠ active" is implemented as `ended_at`/`ended_by` iff non-active, `end_reason` required only for `dismissed` (matches FR-4). Suggest rewording § 5.
- RELIABILITY — P-7's `information_schema` query on `users.nickname` works only after 0001 is applied; `SHOW CREATE TABLE users` (table default collation) works before. Order the T-10 steps that way.
- RISK — "append-only" audit is not DB-enforced; T-4's repository should expose insert + read only.
- READABILITY — test "has a unique index on active_key only" uses `toContainEqual`, which does not prove "only".
- READABILITY (docs drift) — `server/src/database/AGENTS.md` § Files / § Schema guarantees still list only users/roles/role-assignments and `0000_*.sql`; T-9 docs scope.

#### Requirements covered

FR-2 (nickname unique — schema), FR-4 (exclusion origin/status/history — schema), FR-8 (invitation state), FR-13 (audit storage), NFR-5 (unique email/nickname; one active exclusion per user/program).

#### Decisions made

- Audit `action` enum values taken from the FR-13 list; `request_id varchar(64)`; audit `id` bigint.
- New `users` columns appended last (migration order) so positional test stubs need only trailing values.

#### Issues encountered

- Resource guard blocked `pnpm build` (RAM); stale guard slot from the Implementer's own run released by it.
- Implementer lookup note: read only the named sections; TRD § 5.1 not read separately.

#### Read-only queries for T-10 (not run — `qadb` is never touched by agents)

P-7 (run `SHOW CREATE TABLE` before 0001; the column query after):

```sql
SHOW CREATE TABLE users;
SELECT table_name, table_collation FROM information_schema.tables
 WHERE table_schema = DATABASE() AND table_name = 'users';
SELECT column_name, collation_name FROM information_schema.columns
 WHERE table_schema = DATABASE() AND table_name = 'users'
   AND column_name IN ('email','nickname');   -- nickname exists only after 0001
```

A collation ending in `_ci` confirms P-7.

P-13 (zero rows confirms; no `'*'` grants exist before T-3):

```sql
SELECT a.user_id, a.result_type_key
FROM role_assignments a
JOIN roles ra ON ra.id = a.role_id AND ra.code = 'ASSESSOR'
JOIN role_assignments b ON b.user_id = a.user_id AND b.is_active = 1
 AND b.result_type_key = a.result_type_key
JOIN roles rb ON rb.id = b.role_id AND rb.code = 'LEAD_ASSESSOR'
WHERE a.is_active = 1 AND a.result_type_key IS NOT NULL;
```

Known gap: live-DB behavior of `active_key` uniqueness, the CHECKs and the nickname collation has no disposable MySQL to prove it — HITL at T-10.

#### Final verification

lint ✅ · tests 602/602 ✅ · tsc ✅ · `pnpm build` ✅ exit 0 (Leader re-run, 2026-10-19, third try after two resource-guard refusals).

- **Gate:** closed under `gated` mode; spec tension (exclusion `ended_by` vs system-ended `reporting` exclusions) presented to the user as amendment options (a) admin-only ending / (b) `ended_by` nullable = system — answer pending, recorded here when given.
