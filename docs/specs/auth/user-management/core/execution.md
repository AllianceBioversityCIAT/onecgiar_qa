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

- **Gate:** closed under `gated` mode; spec tension (exclusion `ended_by` vs system-ended `reporting` exclusions) presented to the user as amendment options (a) admin-only ending / (b) `ended_by` nullable = system — **answered 2026-10-19: option (b)**, applied as the T-1 amendment DD-12 below.

### T-1 amendment: DD-12 — `ended_by` NULL means "ended by the system"

- **Final status:** PASS (Reviewer)
- **Date:** 2026-10-19
- **Trigger:** spec tension raised by the T-1 Reviewer (advisory RISK): `chk_user_program_exclusions_ended` required `ended_by` on every ended exclusion, so child 2's Reporting sync could never end a `reporting` exclusion on its own — against DD-5's "child 2 writes `reporting` rows without schema change".
- **User decision:** the back lead asked for the Leader's recommendation and approved option (b) on 2026-10-19 ("adelante y quede documentado todo"). Option (a) — only admins end exclusions, schema unchanged — was rejected because a later change would need a second migration on the shared `qadb`.
- **Attempts:** 1 · Skills: nestjs-expert, tdd · Effort: medium

#### Decisions made (execute-time spec edits, recorded when made)

- `design.md` § 5, row `user_program_exclusions`: `ended_by` NULL (= system); CHECK split into `ended_at` iff status ≠ `active`; `ended_by`/`end_reason` NULL while `active`; `ended_by` NULL only for origin `reporting` + status `removed`; a `manual` removal and every `dismissed` row require `ended_by`. Also closes the T-1 READABILITY advisory on the "ended fields" wording.
- `design.md` § 10: new row **DD-12** (decision, rejected alternative, consequence).
- `design.md` Document Control: `Last updated | 2026-10-19 (DD-12 amendment)`.
- `tasks.md` T-1 Tests line aligned with DD-12.
- Correction sweep: `grep -rn "ended fields\|ended_by" docs/specs/auth/user-management/` → only the amended sites remained; no other stale text.
- These § 5 / DD-12 edits are carried as a named conformance check into the next task's Reviewer brief (T-2), then drop.

#### Attempt 1

- **Files changed:** `server/src/database/drizzle/schema/user-program-exclusions.ts` (ended CHECK + two comments); `server/src/database/drizzle/schema/schema.spec.ts` (ended-CHECK case); `server/drizzle/0001_user_management.sql`, `server/drizzle/meta/0001_snapshot.json`, `server/drizzle/meta/_journal.json` (0001 regenerated in place with `pnpm db:generate --name user_management` — never applied anywhere; SQL differs from `f0d02bd` in exactly one line, the ended CHECK; journal diff is only the `when` timestamp).
- **Red run:** ended-CHECK case failed at assertion (expected the new branch text, received the old one), 1 failed / 28 passed.
- **Falsifiers executed:** (1) `status <> 'active'` instead of `removed` (NULL `ended_by` for `dismissed`) → red; (2) dropping `origin = 'reporting'` (NULL `ended_by` for `manual` + `removed`) → red. Reverted; 29/29.
- **Implementer verification:** `pnpm lint` clean; `pnpm build` ok; `pnpm test --reporter=dot` 22 files, 602 passed.
- **Evidence re-run (Leader-inline, non-author):** `pnpm lint` exit 0; `pnpm build` exit 0; `pnpm test --reporter=dot --maxWorkers=2` 602/602 → **VERIFIED**.
- **Reviewer verdict:** PASS — the CHECK traced by hand against every § 5 clause (`manual`+`removed` and `dismissed` with NULL `ended_by` both rejected; no new UNKNOWN case); DD-12 followed exactly; FR-4 meaning unchanged (manual removal keeps who/when, dismissal keeps who/when/why) — no Pivot evidence; conventions held.
- **runtime events:** none
- **spawns:** implementer not reported by host calls, 75369 tokens (11 tool uses), ended complete; reviewer not reported by host calls, 29094 tokens (6 tool uses), ended complete

#### ADVISORY (Reviewer, 4R — non-gating)

- RISK — a `reporting` + `removed` row with NULL `ended_by` passes the DB whether a person or the system ended it; recording the admin id on human ends relies on the service (DD-12 says so). **Forward pointer → T-4 and T-6 briefs:** the admin-facing end paths must always set `ended_by`, with a test.
- READABILITY — `not.toMatch(/`ended_by` IS NOT NULL OR `origin`/)` can never fail against the current wording; redundant beside the `toContain`.

#### Requirements covered

FR-4 (exclusion end history — schema part), FR-13 (actor on human ends), NFR-5.

#### Final verification

lint ✅ · build ✅ · tests 602/602 ✅

### T-2: Catalogs — result types (Reporting) and Science Programs (CLARISA)

- **Final status:** PASS (Reviewer) — blockers P-5 and P-6 cleared by the back lead the same day
- **Date:** 2026-10-19
- **Setup:** back lead added `REPORTING_API_URL` and `CLARISA_API_URL` (TEST hosts) to the local `server/.env`; the Leader copied that git-ignored file into the worktree.
- **Skills:** nestjs-expert, api-design-principles, error-handling-patterns · Effort: high

#### Attempt 1 (spawn 1 — ended partial)

- **P-5 (Reporting `GET qa/catalog?phase_year=2026`):** **UNSETTLED — blocker.** No auth → 401 (JSON `{response, statusCode, message, timestamp, path}`). The repo and `.env` hold no Reporting credential or scheme; no header guessed. Result-types client not built.
- **P-6 (CLARISA):** endpoint settled with an open question. Swagger has no "science programs" route; nearest is `GET initiatives` (fields `id`, `name`, `short_name`, `official_code`, `type_id`, `active`, `status`, `stageId`, `description`, `action_area_id`, `action_area_description`, `stages[]`). 200 without a key on TEST (`CLARISA_API_KEY` not read). `show=active` ignored and ids can repeat → client keeps `active === 1`, de-duplicates by id. **Open:** TEST data is the old portfolio (`INIT-xx`, `PLAT-xx`, `SGP-xx`), no `SP-xx` codes — whether these are the "Science Programs" (D8) is unconfirmed.
- **Files changed (uncommitted):** new `server/src/users/catalogs/{catalogs.ports,catalogs.errors,catalog.service,catalogs.controller,clarisa-science-programs.client,pending-result-type.source}.ts`, `fixtures/clarisa-initiatives.json`, two specs; new `server/src/config/catalogs.config.ts`, `server/test/catalogs.e2e-spec.ts`; modified `users.module.ts`, `env.validation.ts`, `env.validation.spec.ts`, `openapi.config.spec.ts`, `vitest.config.e2e.ts`, `.env.example`, `server/src/config/AGENTS.md`.
- **Implementer verification:** lint, build clean; unit 24 files / 634 passed; e2e 7 files / 259 passed.
- **Red run / falsifiers (mutation runs):** dropping `active === 1` → `expected [ …(5) ] to deeply equal [ …(3) ]`; stale limit 48 h → two specs `promise resolved … instead of rejecting`; PROGRAM grantable → unit + e2e `expected [ …(6) ] to deeply equal [ …(5) ]`. Restored.
- **Not Done / Assumptions (verbatim from report):** Reporting result-types client not built (P-5 unsettled); `pending-result-type.source.ts` stands in and always answers 503; `src/users/AGENTS.md` catalogs row and `docs/infrastructure.md` § 6 not updated; no e2e for a stale copy after 1 h (unit only); assumption that CLARISA `initiatives` are the Science Programs.
- **runtime events:** none
- **spawns:** implementer not reported by host calls, 169404 tokens (40 tool uses), ended partial

#### Leader notes

- The `pending-result-type.source.ts` placeholder is not in the task text; kept uncommitted pending the user's answer on P-5 — it must not ship as the final result-types source.
- Escalated to the back lead 2026-10-19: Reporting auth scheme + whether `qa/catalog` carries result-type key/name; whether CLARISA `initiatives` are the Science Programs.
- **Back lead answers (2026-10-19):** (1) Reporting authenticates with the same API key as CLARISA (`CLARISA_API_KEY`); the placement is still to be confirmed at source. (2) The "Science Programs" are the initiatives, read from CLARISA `GET cgiar-entities/by-portfolio?portfolioId=2,3&version=2` instead of `initiatives`. P-6 settled by user decision (source endpoint).
- **continuations: 1** (Reporting result-types client on the CLARISA key; CLARISA client moved to `cgiar-entities/by-portfolio`; placeholder removed) — sent to the same Implementer by message (context intact).

#### Attempt 1 (continuation 1 — ended complete)

- **P-5 settled:** no swagger on the Reporting host; `Authorization: Bearer` and `auth` header → 401; **`x-api-key` → 200**. `qa/catalog` top level: `portfolio`, `phase`, `catalog_version`, `generated_at`, `result_types`, `sections`, `fields`; `result_types[]` = `{ key, label, level }` (9) → mapped `key → key`, `label → name`. Assumption: `phase_year` = current UTC year.
- **P-6 settled:** `cgiar-entities/by-portfolio?portfolioId=2,3&version=2` → 14 rows `{ id, code, name, compose_code, year, short_name, acronym, start_date, end_date, level, is_active, entity_type{code,name}, portfolio{code,name} }` = SP01–SP13 + inactive SGP-02; names trimmed; only `is_active === 1` kept; no dedupe needed; same answer with and without a key → no key sent to CLARISA. SP12/SP13 are `entity_type` "Accelerators" with SP codes — kept.
- **Files changed (whole attempt):** new `server/src/users/catalogs/{catalogs.ports,catalogs.errors,catalog.service,catalogs.controller,catalog-http,clarisa-science-programs.client,reporting-result-types.client}.ts` + specs, `fixtures/{reporting-qa-catalog,clarisa-entities-by-portfolio}.json`; new `server/src/config/catalogs.config.ts`, `server/test/catalogs.e2e-spec.ts`; modified `server/src/users/users.module.ts`, `server/src/config/{env.validation,env.validation.spec,openapi.config.spec}.ts`, `server/src/config/AGENTS.md` (env rows), `server/vitest.config.e2e.ts`, `server/.env.example`. Deleted before landing: `pending-result-type.source.ts`, `fixtures/clarisa-initiatives.json`.
- **Falsifiers (restored):** stale limit 48 h → 2 red (`promise resolved … instead of rejecting`); PROGRAM grantable → unit + e2e red (`expected [ 'ADMIN', 'ASSESSOR', …(4) ] to deeply equal [ …(3) ]`); Reporting maps `name` from `key` → 2 red; key in the wrong header → `expected { accept: 'application/json', …(1) } to match object { 'x-api-key': 'unit-test-key' }`.
- **Implementer verification:** lint, build clean; unit 25 files / 649 passed; e2e 7 files / 259 passed.
- **Evidence re-run (Leader-inline, non-author):** `pnpm lint` 0; `pnpm build` 0; `pnpm test --reporter=dot --maxWorkers=2` 649/649; `pnpm test:e2e --reporter=dot` 259/259 → **VERIFIED**. Secret scan: the `CLARISA_API_KEY` value appears in no tracked or untracked file nor in the diff; no TEST host names in code or fixtures.
- **Reviewer verdict:** PASS — FR-11 (three catalogs, 503 `SERVICE_UNAVAILABLE` without a copy, stale ≤ 24 h), FR-1 (class-level `ADMIN_ACCESS`; 200/403/401 per route in e2e), NFR-3 (one 10 s `AbortController` over `fetch` + `json()`), NFR-2 (logs carry source + status/reason only; unit test asserts the key never logs); § 6/§ 7/DD-9 match; fixtures match the settled shapes (disqualifier not hit); OpenAPI generic test covers the new routes and their 503 codes; named check on the § 5 / DD-12 amendment: untouched, no contradiction; `src/config/AGENTS.md` env rows accepted (task adds those vars).
- **runtime events:** none
- **spawns:** implementer not reported by host calls, 188623 tokens (11 tool uses, continuation), ended complete; reviewer not reported by host calls, 72827 tokens (16 tool uses), ended complete

#### ADVISORY (Reviewer, 4R — non-gating, recorded only)

- RISK — `fetch` follows redirects; Node strips `Authorization` cross-origin but not `x-api-key`, so a redirecting Reporting/proxy would forward the key. Suggest `redirect: 'error'` in `catalog-http.ts` `getJson`. **Raised to the user.**
- RISK — `phase_year = getUTCFullYear()` is unstated in the spec; on 1 January, if Reporting has no catalog for the new year, the stale window ends after 24 h and every user-management mutation answers 503. Later: take the year from the active cycle (TRD § 5 `cycles.phase_year`).
- RESILIENCE — no failure memory: during an outage each request in the stale window waits up to 10 s before getting the stale copy; consider a short backoff.
- READABILITY — `UpstreamUnavailableError` now exists twice (`auth/cognito-auth.client.ts:49` → `AUTH_SERVICE_UNAVAILABLE`; `users/catalogs/catalogs.errors.ts:9` → `SERVICE_UNAVAILABLE`); `auth-decision.ts:79` maps by class, so a wrong import fails silently. **Forward pointer → T-5 brief** (CognitoAdminClient needs one too).
- READABILITY — CLARISA spec title still says `initiatives`; e2e "serves the cached copy when the source fails after a success" only proves the fresh path (stale end to end is unit-only); duplicate `@nestjs/swagger` import in `catalogs.controller.ts`.
- RISK — the OpenAPI "carries no secret" test checks only `COGNITO_CLIENT_SECRET`; add `CLARISA_API_KEY`. **Forward pointer → T-9 brief** (privacy task).
- SPEC — `/catalogs/science-programs` includes Accelerators (SP12, SP13); follows the user decision, to be confirmed with business (Santi) and then recorded in `docs/qa-context.md`.

#### Requirements covered

FR-11 (both scenarios), FR-1 (catalog routes), NFR-3; NFR-2 for the catalog clients.

#### Decisions made

- Back lead (2026-10-19): Reporting auth = shared `CLARISA_API_KEY`; Science Programs source = CLARISA `cgiar-entities/by-portfolio?portfolioId=2,3&version=2`.
- Execute-time spec edits (recorded when made, no requirement meaning changed): `design.md` § 9 Env — Reporting auth and `CLARISA_API_KEY` usage; `design.md` § 11 — P-5 and P-6 rows settled and the ledger count updated (10 verified · 4 UNVERIFIED). Carried as a named conformance check into the T-3 Reviewer brief.
- Leader: the `pending-result-type.source.ts` placeholder (not in the task text) was removed before landing.

#### Final verification

lint ✅ · build ✅ · unit 649/649 ✅ · e2e 259/259 ✅

### Pre-check for T-5 (P-8) — 2026-10-19 (not a task attempt)

- **Source:** Cris (pool owner), Slack DM 2026-10-19 10:32 / 10:59 — new QA-only App Client + IAM user; credentials delivered out of band and placed in the local `server/.env` by the back lead (`COGNITO_ADMIN_ACCESS_KEY_ID`, `COGNITO_ADMIN_SECRET_ACCESS_KEY`; `COGNITO_CLIENT_ID`/`COGNITO_CLIENT_SECRET` replaced by the new client).
- **Probe (Leader-inline, read-only, no user data read, nothing created):**
  1. `sts get-caller-identity` with the admin keys → OK, IAM user `qa-cognito-service`.
  2. `AdminGetUser` on a username that cannot exist → **AccessDeniedException** (`not authorized to perform: cognito-idp:AdminGetUser`). **P-8 refuted as of today** — the IAM user lacks the actions design § 7 / DD-6 require.
  3. New client `InitiateAuth USER_PASSWORD_AUTH` (fake user, correct `SECRET_HASH`) → `USER_PASSWORD_AUTH flow not enabled for this client`; with a wrong secret → `Unable to verify secret hash` ⇒ the secret is valid, the flow is off. The server's custom login (`cognito-auth.client.ts:124`) and refresh (`:227`) need `USER_PASSWORD_AUTH` and `REFRESH_TOKEN_AUTH` — custom login does not work with the new client yet.
  4. Hosted UI `/oauth2/authorize` with `identity_provider=CGIAR-AzureAD` → 302 to Microsoft for both `http://localhost:4200/auth/callback` and `https://qatest.ciat.cgiar.org/auth/callback` (return leg needs a browser).
- **Action:** reply sent to Cris (Slack DM, at the back lead's request) asking for `cognito-idp:AdminGetUser` + `cognito-idp:AdminCreateUser` on the pool ARN, the two auth flows, and confirmation of token revocation. T-5 stays blocked (`[ ]`, external) until a re-probe passes.
- Also noted (out of this spec): Cris announced Cognito JWT/OIDC metadata changes rolling out from 2026-11-04 (deadline 2027-02-28) — the token verification in `auth` should be checked against it.
- **Re-probe after Cris's fix (Slack DM 2026-10-19 11:22 — flows enabled, `AdminGetUser` + `AdminCreateUser` added to `qa-cognito-service`, token revocation on):** `AdminGetUser` (nonexistent username) → `UserNotFoundException` ⇒ permission granted; `InitiateAuth USER_PASSWORD_AUTH` (fake user, correct hash) → `Incorrect username or password` ⇒ flow on, secret valid; wrong secret → `Unable to verify secret hash`; SSO authorize → 302 to Microsoft for both callbacks. **P-8: `AdminGetUser` settled**; `AdminCreateUser` is granted per the pool owner but not exercised (it would create a real account and send the shared-template email) — T-5's first step re-runs the read-only probe; the real call stays a T-10 HITL smoke. Confirmation sent to Cris. Worktree `.env` refreshed from the main checkout (new client).

### T-3: Permissions and assignment rules (ADMIN all, `*`, Assessor/Lead exclusivity, effective scope)

- **Final status:** PASS (Reviewer, twice: initial diff + DD-13 continuation)
- **Date:** 2026-10-19
- **Attempts:** 1 · **continuations: 1** (DD-13 ADMIN exemption in `canReview`, after the back lead resolved the spec tension) — same Implementer by message
- **Skills:** nestjs-expert, nestjs-best-practices + `tdd` (Leader: authorization rules, red-first pays) · Effort: xhigh

#### Attempt 1

- **Files changed:** `server/src/users/{permissions,authorization.service,role-assignments.repository,users.errors}.ts`; new `server/src/users/effective-scope.ts` + spec; `server/src/common/error-codes.ts` (`USERS_ROLE_CONFLICT` 409); `server/src/users/catalogs/catalog.service.ts` (reads `GRANTABLE_ROLES`); specs `role-assignments.repository.spec.ts` (DD-11 pinned test now expects the refusal, with a note), `authorization.service.spec.ts`, `authorization.matrix.spec.ts`; `server/test/auth-guards.e2e-spec.ts`.
- **What it does:** ADMIN grants `Object.values(Permission)` (FR-14, DD-10); `GRANTABLE_ROLES` (no PROGRAM) is the single source, used by `/catalogs/roles`; `*` matches any result type, accepted only for result-type roles (DD-1); Assessor vs Lead overlap for one user refused in the repository, `*` included → `USERS_ROLE_CONFLICT` (FR-3, DD-2, DD-11); `canReview(user, perm, {resultType, programId}, ...predicates)` = permission ∧ program in scope ∧ no active exclusion ∧ extra predicates (D9 seam); only `active` exclusions exclude (DD-12); an active ADMIN skips scope + exclusions (DD-13).
- **Red run:** repository 11 failures (`promise resolved … instead of rejecting`, incl. DD-11 and A KP / L `*`); matrix ADMIN grid `expected [ …(25) ] to deeply equal []`; service 13 failures (`canReview` stubbed false). `effective-scope.ts` written before its spec (no own red; falsifiers cover it).
- **Falsifiers (reverted):** `*` literal-only → 7 red; overlap ignores `*` → 7 red (`*` vs `*` row stays green via `a === b`; `*` vs key rows red); ADMIN back to one permission → 8 red. DD-13 continuation: no exemption → 3 red; exemption for every role → 7 red; exempt a revoked/inactive ADMIN → 2 red.
- **Existing tests changed by FR-14:** three asserting ADMIN lacks TPB/assessor flipped; e2e "refuses a role that does not hold the declared permission" switched ADMIN → PPU; e2e ADMIN passes `/probe/tpb` added.
- **Implementer verification:** lint 0, build ok, unit 26 files / 734 passed, e2e 7 / 260 passed (after the continuation; 729 / 260 before it).
- **Evidence re-run (Leader-inline, non-author):** initial — lint 0, build 0, unit 729/729, e2e 260/260 → VERIFIED; after continuation — lint 0, build 0, unit 734/734, e2e 260/260 → **VERIFIED**.
- **Reviewer verdict 1:** PASS — FR-14/DD-10 matrix derived from the `Permission` catalog; DD-1 `*` edge cases; all four `*` overlap shapes both orders; DD-11 pinned test; § 7 conjunction; FR-2 grantable list; T-2 spec edits (§ 9, P-5, P-6) not contradicted. Flagged the ADMIN-vs-exclusion **spec tension** (FR-4 vs D3), not a defect.
- **Reviewer verdict 2 (continuation):** PASS — exemption skips only `coversProgram`; `ADMIN_ACCESS` is granted by ADMIN only (`permissions.ts:53`), so `can(user, ADMIN_ACCESS)` ≡ live ADMIN grant; revoked/inactive pinned. Listed stale spec restatements (fixed by the Leader, below).
- **runtime events:** none
- **spawns:** implementer not reported by host calls, 130974 tokens (31 tool uses), ended complete; implementer (continuation) not reported by host calls, 139920 tokens (3 tool uses), ended complete; reviewer not reported by host calls, 72034 tokens (12 tool uses), ended complete; reviewer (continuation) not reported by host calls, 85371 tokens (6 tool uses), ended complete

#### Decisions made

- **Back lead, 2026-10-19 — DD-13:** "No puede haber un admin con conflicto" → option (a) (Leader-recommended): an active ADMIN is never blocked by a conflict of interest; exclusions stay stored and apply again if ADMIN is revoked. Option (b) — forbid exclusions on admins — rejected (extra validation, new error code, open case for child 2).
- Execute-time spec edits (recorded when made): `design.md` § 7 "Effective scope & `canReview`" (ADMIN exempt from scope + exclusion conjuncts; permission and timeline predicate still apply — narrowed after Reviewer 2); § 10 new **DD-13**; DD-12/DD-13 rows moved into ID order after DD-11; `requirements.md` FR-4 statement (ADMIN exception), § 3 Glossary "Exclusion" and "Effective scope", FR-4 Manual-exclusion scenario "(for a non-admin …)"; `tasks.md` T-3 Requirements + Design refs (DD-13), coverage row FR-4 "T-3 (wins; ADMIN exempt, DD-13)". Document Control dates updated. These are carried as a named conformance check into the T-4 Reviewer brief.
- Not edited (above this spec): `../proposal.md:41` describes scope as "minus exclusions" for everyone — recorded here; the proposal is historical input.
- The Leader judged requirement meaning changed for admins (FR-4) — approved explicitly by the back lead, so recorded as a user-approved amendment rather than a silent edit.

#### ADVISORY (Reviewer, 4R — non-gating)

- RISK (high) — `AuthorizationSubject extends Partial<ProgramScopeView>`: a subject loaded without exclusions passes `coversProgram` (fail-open), and the effective-scope row "nothing loaded at all = all programs" makes it official. **Forward pointer → T-4 brief:** make `programScope` and `exclusions` required on the cached subject and delete/flip that row.
- RESILIENCE — shared locks do not stop two concurrent inserts of the opposite role; the rule is safe only under the unit of work's `users` row `FOR UPDATE` (DD-2). **Forward pointer → T-4 brief:** two-writer test. **→ T-6 brief:** role replacement must revoke before insert, or Assessor KP → Lead KP is refused.
- RISK — Assessor KP + Assessor `*` allowed, but `UserSummary.roles[].resultTypes` (`'all' | string[]`) cannot represent both. **Forward pointer → T-6 brief:** reject or collapse to `all`.
- RISK — the exemption keys on the permission `ADMIN_ACCESS`, DD-13 on the role; a future role granted `ADMIN_ACCESS` would skip conflict checks silently. Suggest a test that only ADMIN grants `ADMIN_ACCESS` (or check the role code).
- READABILITY — redundant `isActive && revokedAt === null` filter in the overlap check; `authorization.matrix.spec.ts` header still says every cell is a literal (ADMIN row now derived).
- DOCS — `server/src/users/AGENTS.md` still describes the old ADMIN and file list (T-9 docs scope).

#### Requirements covered

FR-14; FR-3 (mixed roles, Assessor/Lead incl. `*`, all covers future types); FR-4 (exclusion wins — pure part; ADMIN exempt, DD-13); FR-2 (PROGRAM not grantable — rule part).

#### Final verification

lint ✅ · build ✅ · unit 734/734 ✅ · e2e 260/260 ✅

### T-4: Repositories, unit of work and cache for program scope, exclusions and audit

- **Final status:** PASS (parallel lens Reviewers: reliability/concurrency + risk/security)
- **Date:** 2026-10-19
- **Attempts:** 1
- **Skills:** nestjs-expert, nestjs-best-practices + `tdd` · Effort: xhigh · Review mode: parallel lenses (effort xhigh; data-integrity/auth surface)

#### Attempt 1

- **Files changed:** new `server/src/users/{user-programs.repository,user-audit.repository,users-admin.unit-of-work}.ts` + specs; modified `server/src/users/{current-user.cache,effective-scope,authorization.service,users.errors,users.module}.ts` + the cache, effective-scope, matrix, authorization and module specs; `server/src/common/error-codes.ts` (6 codes: `USERS_NOT_FOUND`, `USERS_LAST_ADMIN`, `USERS_EXCLUSION_EXISTS`, `USERS_EXCLUSION_NOT_FOUND`, `USERS_EXCLUSION_NOT_MANUAL`, `USERS_EXCLUSION_NOT_REPORTING` — match design § 7); `server/src/auth/{admission.service,me.controller}.ts` (new `AdmittedUser` type, same behavior) + admission spec; `server/test/support/in-memory-stores.ts`; five e2e suites (override `USER_PROGRAMS_STORE`).
- **Forward pointers satisfied:** (1) audit repository exposes only `record`/`findByUserId`, pinned by a test, not a module provider; (2) admin-facing end paths require the actor (`requireActor` refuses null/undefined/0/non-integers before any write); the only actor-less end is `endReportingExclusionAsSystem` (reporting → removed); the fake emulates the three schema CHECKs; (3) `programScope`/`exclusions` required on `AuthorizationSubject`, `?? []` defaults removed, "nothing loaded" row deleted, admission returns `AdmittedUser` (cannot reach `canReview`); (4) two-writer opposite-role test (same key and `*` vs key) — exactly one succeeds; user-row `FOR UPDATE` asserted in SQL.
- **Red run:** 27 programs-repository + 12 unit-of-work tests failed at assertion against no-op skeletons (e.g. `expected [ 'fulfilled', 'fulfilled' ] to deeply equal [ 'fulfilled', 'rejected' ]`). Audit repository: no own red (insert/read only); rollback proven by falsifier.
- **Falsifiers (restored):** admin count without the ADMIN `roles` lock → concurrent-demotion + `FOR UPDATE` SQL red; audit repository on `this.db` instead of the tx → 2 red; user-row lock removed → 5 red incl. 3 two-writer rows; cache without scope → 3 red; no isolation level → red; subject loses required fields → `tsc` unused `@ts-expect-error`.
- **Implementer verification:** lint 0, build ok, unit 818 (was 734), e2e 260.
- **Evidence re-run (Leader-inline, non-author):** `pnpm lint` 0; `pnpm build` 0; unit 818/818; e2e 260/260 → **VERIFIED**. Full type check `tsc --noEmit -p tsconfig.json` → 9 errors in spec files: 7 pre-existing in `token-verifier.service.spec.ts` (untouched by this spec); `schema.spec.ts:285` and `admission.service.spec.ts:861` **introduced by T-1** (vitest does not type-check; `pnpm build` excludes specs) — fix approved by the back lead as a separate commit; this diff adds none.
- **Reviewer verdict, lens 1 (reliability/concurrency):** PASS — locks user row then ADMIN `roles` row `FOR UPDATE` (SQL asserted); audit on the tx connection, gone on rollback; fake waits on row locks without serializing transactions (negative controls prove the race); **READ COMMITTED judged correct and safer**: no leak (`SET TRANSACTION` without `SESSION` binds only the next tx), a locking count deadlocks at any isolation, RC + plain read after the roles lock is the only cycle-free form; RC drops gap locks — "read nothing then insert" checks rely on the user-row lock or a unique key (already DD-2).
- **Reviewer verdict, lens 2 (risk/security):** PASS — no fail-open path (cache always loads scope; a load error rejects in `AuthGuard`); DD-13 exempts only scope/exclusions; actor rules hold; `findActive` matches user + exclusion id; audit `actor_id` NOT NULL + FK; out-of-scope files are necessary wiring and do not change login, refresh or the `/auth/me` shape (P-12 untouched).
- **runtime events:** none
- **spawns:** implementer not reported by host calls, 282815 tokens (76 tool uses), ended complete; reviewer lens 1 not reported by host calls, 120398 tokens (10 tool uses), ended complete; reviewer lens 2 not reported by host calls, 118047 tokens (21 tool uses), ended complete

#### Decisions made

- **DD-14 (recorded by the Leader from the lens-1 spec-gap finding; reported to the back lead at this gate):** the admin unit of work runs `READ COMMITTED`; the last-admin count is a plain read after the ADMIN `roles` row lock. Does not change any requirement's meaning; it records how DD-3 is made correct.
- Execute-time spec edits (recorded when made): `design.md` § 7 step 2 (plain read under RC, DD-14); § 7 lock-order line rewritten (user row → ADMIN roles row → role_assignments writes; ADMIN guard before any grant insert) — the old "users → role_assignments → roles" contradicted steps 2–3; § 10 new DD-14; Document Control date. Sweep: no other restatement of the old order or of isolation in the spec folder. Carried as a named conformance check into the next Reviewer brief.

#### ADVISORY (Reviewers, 4R — non-gating)

- RELIABILITY — the fake takes the REPEATABLE READ snapshot at `begin`; InnoDB takes it at the first plain read (here, the count), so the RR test's claim does not hold on real MySQL — the real hazard is an earlier plain read freezing the snapshot. Rename the test and comment.
- RESILIENCE — the unit of work does not enforce step order. **Forward pointer → T-6 brief:** test that the ADMIN guard runs before any grant insert (FK shared lock → exclusive upgrade deadlock risk); role replacement revokes before insert (T-3 pointer).
- RESILIENCE — the fake has no deadlock detection (a cycle shows as a timeout).
- RISK — `UserAuditRepository.record` accepts the full `NewUserAuditEvent` (a caller can set `createdAt`/`id` and backdate). **Forward pointer → T-6 brief:** narrow the input to `userId, actorId, action, changes, requestId`; the DB sets the time.
- RELIABILITY — `findScopeView` does two separate reads (scope, then exclusions); a load during a commit can pair old scope with new exclusions until invalidate/TTL — within FR-6. **Forward pointer → T-6 brief:** invalidate after commit (epoch guard handles overlap).
- RELIABILITY — the `@ts-expect-error` test is enforced only by `tsc -p tsconfig.json`, which no gate runs. **Leader:** add a spec type-check (baseline 7 pre-existing errors) to the verification of T-5…T-9 after the T-1 fix.
- READABILITY — `InvalidProgramIdError` field `programIds` vs API body `programs`/`programId` (§ 6) — **→ T-6/T-8** remap; `addManualExclusion` does not range-check `programId` like `replaceScope` (T-6's catalog check covers it).
- DOCS — `server/src/users/AGENTS.md` file table lacks the three new files and the `USER_PROGRAMS_STORE` / `USERS_ADMIN_UNIT_OF_WORK` bindings (T-9).

#### T-10 checklist additions (real MySQL — merged from Implementer + lens 1)

- Two admins demoting each other concurrently under the pinned READ COMMITTED: the second waits on the ADMIN `roles` row, then counts after the first commits — exactly one succeeds.
- The same race with a plain read before the lock (confirms the RC choice).
- Concurrent opposite-role grants to one user serialize on the `users` row.
- An admin demotion racing a login (admission `FOR SHARE`) and a concurrent ADMIN grant (FK shared lock on `roles`): no deadlock, no 500.
- `SET TRANSACTION ISOLATION LEVEL READ COMMITTED` applies only to that transaction: `@@transaction_isolation` on the next use of the pooled connection reads `REPEATABLE-READ`.
- `SELECT @@binlog_format` on `qadb` is not `STATEMENT` (RC + statement binlog → error 1665).
- `ER_DUP_ENTRY` on `active_key` maps to `USERS_EXCLUSION_EXISTS`; the DD-12 CHECKs reject their cases; a rolled-back audit insert leaves no row; the JSON `changes` column round-trips.
- Concurrent `replaceScope` on one user without the user lock gives 409, not 500.

#### Operational note

From this commit on, this branch reads `user_programs` and `user_program_exclusions` on every authenticated request (cache load). **Running the branch against `qadb` requires migration `0001` applied first**; otherwise authenticated requests fail. Not an issue for other branches. Applied by a human at T-10.

#### Budget tripwire (design § 2)

- Budget: 10 tasks · ~3,200 LOC · ~16 Reviewer passes. Actual after T-4: 4 tasks · ~6,200 LOC (T-1 ~600, T-2 ~1,200, T-3 ~1,000, T-4 ~3,400; more than half tests) · 7 Reviewer passes. **LOC exceeded.**
- Causes: two user-approved amendments (DD-12, DD-13), concurrency tests with a lock-emulating fake, real-response fixtures (T-2), fail-open fix carried from T-3.
- Escalated to the back lead 2026-10-19. Answer: "Sí, ajusta el alcance que todo quede bien". The Leader proposed option A (re-baseline to ~12,500 LOC / ~20 Reviewer passes, no requirement cut) vs B (cut ~800 LOC of tests/filters). **Back lead chose option A (2026-10-19, "Si. A")** — `design.md` § 2 and `tasks.md` header re-baselined to ~12,500 LOC · ~20 Reviewer passes; no requirement cut.

#### Requirements covered

FR-4 (storage part), FR-6 (cache carries scope + exclusions; invalidate refreshes), FR-7 (last admin — locking part, concurrent), FR-13 (storage part), NFR-5.

#### Final verification

lint ✅ · build ✅ · unit 818/818 ✅ · e2e 260/260 ✅

### T-1 follow-up fix: spec type errors introduced by T-1

- **Final status:** PASS (Reviewer) · **Date:** 2026-10-19 · approved by the back lead as a separate commit
- **Cause:** `tsc --noEmit -p tsconfig.json` errors in `schema.spec.ts:285` and `admission.service.spec.ts:861` came from T-1 (new `users` columns; `IndexColumn[]` helper typing). Not caught because vitest does not type-check and `pnpm build` excludes specs.
- **Files changed:** `server/src/database/drizzle/schema/schema.spec.ts` (`names` helper takes `ReadonlyArray<object>`; existing `'name' in c` guard kept); `server/src/auth/admission.service.spec.ts` (`winnerRow` sets `nickname: null`, `invitation: 'none'`, `invitedAt: null` before `...overrides`). No assertion changed.
- **Verification:** Implementer — tsc: `token-verifier.service.spec.ts` 7 (pre-existing, untouched), others 0; lint, build ok; unit 818. Leader re-run — tsc only the 7 pre-existing errors; unit 818/818 → **VERIFIED**.
- **Reviewer verdict:** PASS — fixture defaults match `users.ts:52-56`; widened helper returns the same values; no casts; § 7 / DD-14 unaffected.
- **spawns:** implementer not reported by host calls, 64386 tokens (8 tool uses), ended complete; reviewer not reported by host calls, 27769 tokens (8 tool uses), ended complete
- **Leader decision:** from T-5 on, every task's verification adds `cd server && npx tsc --noEmit -p tsconfig.json`, expected to report exactly the 7 pre-existing `token-verifier.service.spec.ts` errors (baseline) — more is a failure. [advisory-grade gate addition, recorded per the T-4 lens-2 advisory]

### T-5: Cognito admin client (create user, existing user, resend invitation)

- **Final status:** PASS (Reviewer) on attempt 2 — attempt 1 FAIL (log-spy coverage)
- **Date:** 2026-10-19
- **Skills:** nestjs-expert, error-handling-patterns, aws-serverless + `tdd` · Effort: high (attempt 1)

#### Attempt 1 — FAIL

- **P-8 probe (Implementer):** one read-only `AdminGetUser` on `qa-permission-probe-does-not-exist-20261019` → `UserNotFoundException` (HTTP 400) ⇒ permitted. `AdminCreateUser` never called against the real pool.
- **Findings with sources:** `Username` defaults to the email — SDK docs (`AdminCreateUserRequest.Username`): when the pool supports only email/phone as sign-in attributes, Cognito generates the username → unsettled, T-10. RESEND = `AdminCreateUser` + `MessageAction: 'RESEND'` on an existing user (SDK `MessageAction` docs); refusal state via `UnsupportedUserStateException` unproven → T-10.
- **Error class:** reused the auth `UpstreamUnavailableError` (503 `AUTH_SERVICE_UNAVAILABLE`); no third same-named class (T-2 forward pointer satisfied).
- **Files changed:** new `server/src/auth/cognito-admin.client.ts` + spec, `server/src/config/cognito-admin.config.ts` + spec; modified `server/src/auth/auth.module.ts`, `server/src/config/env.validation{,.spec}.ts`, `server/src/auth/no-qa-tokens.spec.ts`, `server/.env.example`, `server/package.json` (+ `@aws-sdk/client-cognito-identity-provider ^3.1152.0`), `server/pnpm-lock.yaml`.
- **Red run:** 18/18 failed against a deliberately wrong stub (e.g. `expected 'created' to be 'existing_account'`); TypeErrors not counted.
- **Falsifiers (reverted):** `email_verified` 'false' → attributes red; email appended to a log line → log-spy red; `console.log(secretAccessKey)` in config → `no-qa-tokens.spec.ts` red.
- **Implementer verification:** lint, build clean; unit 847/847; e2e 260/260; tsc exactly the 7 pre-existing `token-verifier.service.spec.ts` errors.
- **Evidence re-run (Leader-inline, non-author):** lint 0; build 0; unit 847/847; e2e 260/260; tsc 7 (token-verifier only) → **VERIFIED**. Secret scan: `COGNITO_ADMIN_ACCESS_KEY_ID`, `COGNITO_ADMIN_SECRET_ACCESS_KEY`, `COGNITO_CLIENT_SECRET` values in neither the diff nor new files; `package.json` adds only the approved SDK.
- **runtime events:** none
- **Reviewer verdict: FAIL** (verbatim):

> STATUS: FAIL
> SUMMARY: The client, config, env validation and FR-17 static check match design § 7 CognitoAdminClient, § 9 and DD-6. One gap blocks the gate: the NFR-2 log-spy test never runs the successful `createUser` path, so logging the email on the most likely line would leave every test green. The named check (design § 7 step 2, the lock-order line, DD-14) passes: the diff touches none of them, and Cognito calls stay outside the transaction, consistent with DD-7. The red run (a deliberately wrong stub failing on assertions) is accepted as stronger than "fails before the client exists". P-8: `AdminGetUser` is settled per `execution.md:206`. A nonexistent username returning `UserNotFoundException` proves the permission without reading user data.
>
> ISSUES:
> 1. **Discovered Issue:** The log-spy test (`cognito-admin.client.spec.ts`, "logs the operation and the AWS error name, and never the email…") runs five calls: `getUser` throttled, `createUser` NotAuthorized, `createUser` UsernameExists, resend unsupported, resend success. It never runs a successful `createUser`, so the `outcome=created` line (`cognito-admin.client.ts:482` in the diff) is never checked. It also never runs `getUser` for a user that exists or does not exist. Changing line 482 to `` `…outcome=created email=${input.email}` `` keeps every test green. So the evidence "email in log → log-spy red" only holds for wherever the Implementer put that change, not for the path where a create gets logged.
>    * **Violated Rule:** `requirements.md` NFR-2 ("No email, name, temporary password or AWS credential in any log line") and the defect-class gate "PII leak … to logs → log spies". `tasks.md` T-5 Tests ("logs carry no email or key (log spy)") and Falsifier ("log the email → the log-spy test goes red"). Reviewer checklist: "trace the named mutation through the fixture".
>    * **Remediation Suggestion:** Add `send.mockResolvedValueOnce({})` followed by `client.createUser(input)` to the `calls` list. Also add a found and a not-found `getUser`. Assert `text` contains `outcome=created`. Re-run the email falsifier on the `created` line and record the red.

- **ADVISORY (non-gating):** permission-refusal fixture uses `NotAuthorizedException` but the real IAM refusal is `AccessDeniedException` (add that fixture); `AliasExistsException` if the pool uses email as alias → maps to 503 instead of `existing_account` (T-10); T-6 must call `getUser` before `createUser` (DD-7) and share one 10 s budget across both calls (NFR-3) — **forward pointers → T-6 brief**; no test pins `COGNITO_ADMIN_TIMEOUT_MS === 10_000`; resend on `UserNotFound` → `not_applicable` goes beyond § 7 Invitation (defensible under FR-8 — record as decision); `server/src/config/AGENTS.md` Secrets line + `docs/infrastructure.md` § 6 → T-9; design § 11 P-8 row still UNVERIFIED (Leader to update).
- **spawns:** implementer not reported by host calls, 142417 tokens (30 tool uses), ended complete; reviewer not reported by host calls, 60161 tokens (13 tool uses), ended fail

#### Attempt 2 — PASS (effort bumped to xhigh)

- **Attempt history carried in the brief:** attempt 1 ran the email falsifier on one log line; the log spy never drove a successful `createUser` nor `getUser` found / not found.
- **Files changed:** `server/src/auth/cognito-admin.client.spec.ts` only (client byte-identical to attempt 1 — Reviewer confirmed line for line).
- **Change:** the five-call logging test replaced by a 13-case table — `getUser` found / not found / throttled / IAM `AccessDeniedException`; `createUser` created / existing_account / NotAuthorized / 5xx / timeout; `resendInvitation` resent / not_applicable (confirmed) / not_applicable (missing) / throttled. Each asserts `op=` / `outcome=` / `error=` and that no line holds the email (full, local part, domain), given/family name, stubbed key id/secret or pool id; `getUser` found/not found must log nothing. `AccessDeniedException` fixture built with the SDK class.
- **Falsifiers, one per log line (reverted):** `created` + email → `createUser created` red; `existing_account` + email → its case red; `resent` + email → its case red; `not_applicable` + email → both cases red; `unavailable` + pool id → 5 cases red; a new `getUser` found log with the email → `getUser found` red.
- **Implementer verification:** lint, build clean; unit 860/860; e2e 260/260; tsc 7 (token-verifier only).
- **Evidence re-run (Leader-inline, non-author):** lint 0; build 0; unit 860/860; e2e 260/260; tsc 7 (token-verifier only) → **VERIFIED**.
- **Reviewer verdict:** PASS — FAIL fixed; every outcome driven with its own logger spy; timeout case proves the abort message's email never reaches a log; P-8 § 11 row accurate.
- **runtime events:** none
- **spawns:** implementer (rework, same context) not reported by host calls, 150650 tokens (5 tool uses), ended complete; reviewer (re-review, same context) not reported by host calls, 73501 tokens (4 tool uses), ended complete

#### ADVISORY (Reviewer, 4R — non-gating)

- RISK (ledger) — keep P-8's `AdminCreateUser` half as High if refuted: **applied by the Leader** (§ 11 P-8 "If false" + count line).
- READABILITY — the `getUser` 503 table lacks an `accessDenied` row (proved only indirectly through the log case).
- Unpinned: no test asserts `COGNITO_ADMIN_TIMEOUT_MS === 10_000`.
- **Forward pointers → T-6 brief:** call `getUser` before `createUser` (DD-7 — the client's `UsernameExists` path is only the race fallback); share **one** 10 s NFR-3 budget across `getUser` + `createUser` (each call alone has 10 s).
- **→ T-9 brief:** `server/src/config/AGENTS.md` Secrets line + env rows for `COGNITO_ADMIN_*`; `docs/infrastructure.md` § 6 (new env, IAM user `qa-cognito-service`).

#### T-10 checklist additions (real pool, by a human, after telling the pool owner)

- `AdminCreateUser` with a test user: is `Username = email` accepted, or does the pool generate the username (P-4)?
- Invitation email content with the shared template (P-10).
- Resend while invited → `resent`; resend after confirmation → `UnsupportedUserStateException` → `not_applicable`.
- Creating the same email twice → `UsernameExistsException`; under an alias-configured pool, `AliasExistsException` (today maps to 503 — would need mapping to `existing_account`).

#### Decisions made

- Error class: reuse the auth `UpstreamUnavailableError` (503 `AUTH_SERVICE_UNAVAILABLE`, FR-2) — no third same-named class.
- `resendInvitation` maps `UserNotFoundException` to `not_applicable` (409 `USERS_INVITATION_NOT_APPLICABLE`) in addition to the confirmed-user refusal named in design § 7 Invitation — defensible under FR-8 ("not applicable" when the account is absent from the pool). Recorded here at the Reviewer's request; no requirement meaning changed.
- Execute-time spec edits (recorded when made): `design.md` § 11 P-8 row (settled for `AdminGetUser`; `AdminCreateUser` High → T-10) and the ledger count line. Carried as a named conformance check into the next Reviewer brief.

#### Requirements covered

FR-2 (client part: custom new → account + email; existing → `existing_account`, no write; Cognito down → 503), FR-8 (client part), NFR-2 (client logs), NFR-3 (10 s per call).

#### Final verification

lint ✅ · build ✅ · unit 860/860 ✅ · e2e 260/260 ✅ · tsc baseline (7 pre-existing) ✅

### T-6: UsersAdminService (create, edit, roles, programs, exclusions, activation, invitation)

- **Final status:** PASS (parallel lens Reviewers: conformance/reliability + risk/security/privacy)
- **Date:** 2026-10-19
- **Attempts:** 1 · checkpoints: none needed (~55 tool calls)
- **Skills:** nestjs-expert, nestjs-best-practices, error-handling-patterns, tdd · Effort: xhigh · Review: parallel lenses

#### Attempt 1

- **Files changed:** new `server/src/users/users-admin.service.ts` + spec (96 tests), `server/test/support/users-admin-world.ts` (fake world + recording unit of work); modified `server/src/common/error-codes.ts` (`USERS_EMAIL_TAKEN`, `USERS_NICKNAME_TAKEN`, `USERS_NAME_LOCKED`, `USERS_INVITATION_NOT_APPLICABLE` — all 409; all 11 § 7 codes now present), `server/src/users/users.errors.ts` (+ `FieldValidationError`), `server/src/users/users.repository.ts` + spec (nickname, `isActive`, invitation fields, `findByNickname`), `server/src/users/role-assignments.repository.ts` (`findActiveByUserId` with grant ids, for the diff), `server/src/users/user-audit.repository.ts` + spec (pointer 5), `server/test/support/in-memory-stores.ts` (case-insensitive nickname uniqueness). Outside-scope edits judged necessary by both Reviewers.
- **Forward pointers satisfied:** (1) `ended_by` = acting admin on remove/dismiss (tested with a second admin); (2) roles by diff, revoke before insert — Assessor KP → Lead KP swap asserts call order; (3) **reject** (not collapse): role listed twice, `*` inside the array, empty array, scope on a global role → `VALIDATION_FAILED` on `roles[i].…`; (4) last-admin guard before the first revoke and any insert (order asserted); (5) `record` takes `{ userId, actorId, action, changes, requestId? }` field by field — forged `id`/`createdAt` ignored; (6) invalidate spied, after `tx:commit` only; (7) API field names (`programs`, `programId`, `exclusions[i].reason`, `roles[i].…`); (8) `getUser` first, `createUser` only if absent, one 10 s deadline across both (6 s + 6 s → 503; 4 s + 4 s → success); (9) not-applicable resend cases → 409.
- **Red run:** 92/96 failed against a no-op skeleton (≈29 on the "expected refusal" helper — behavioral, accepted by Reviewer 1; 4 TypeErrors not counted).
- **Falsifiers (restored, `cmp` verified):** re-issue unchanged grants → "unchanged grant keeps its id" red; QA row before Cognito → 4 red incl. "Cognito down → no record" and the 10 s budget; name edit after sign-in → both `USERS_NAME_LOCKED` cases red.
- **Implementer verification:** lint 0, build ok, unit 961 (32 files), e2e 260, tsc 7 (token-verifier only).
- **Evidence re-run (Leader-inline, non-author):** lint 0; build 0; unit 961/961; e2e 260/260; tsc 7 → **VERIFIED**.
- **Not Done / Assumptions (verbatim from the report):** "Return shape: methods return `{ userId, changed }` (create returns `{ userId, invitation }`), not `UserDetail`. The query repository does not exist yet; T-8 can read the detail afterwards. · No-ops: an action that changes nothing (same nickname, same roles, already inactive) writes no audit, does not invalidate, and returns `changed: false`. · Name rule: a name sent unchanged after the first sign-in is not an error; only a changed one gives `USERS_NAME_LOCKED`. · PROGRAM grants: a role replacement never touches existing PROGRAM grants (D6). · Scope: `programs: []` is rejected, because it would silently mean "all". · Create: it does not invalidate the cache, since the new user has no cached entry. · Audit layout: `create` is one event with the profile fields, then one `role_grant` / `scope_change` / `exclusion_add` per change. An edit is one `update` event with all changed fields. · Resend: a successful resend updates `invited_at`. · Late Cognito create: after a 503 from the budget, the in-flight Cognito create may still land in the pool. DD-7 accepts this, and it shows as `existing_account` on retry. · Real MySQL locking is still unverified (HITL on `qadb`)." — no owed item and no blocker (assumptions only; both Reviewers checked them against the spec) → not a continuation.
- **Leader correction:** the report said `CognitoAdminClient` is not provided in any module — false: `server/src/auth/auth.module.ts:55,60` provides and exports it. The service is not yet registered in `UsersModule`. **Forward pointer → T-8 brief:** register `UsersAdminService` and wire `CognitoAdminClient` without an `AuthModule` ↔ `UsersModule` cycle.
- **Reviewer verdict, lens 1 (conformance/reliability):** PASS — every FR-2…FR-8/FR-13 scenario tested with side effects (no row, no audit, Cognito not called, no invalidation, `tx:begin` absent); P-1 through the real `AdmissionService`; deactivation → 403 `AUTH_USER_INACTIVE`, refresh refused, no Cognito call; order validate → uniqueness → Cognito → tx → invalidate asserted; `Promise.race` handles late rejections; P-8 named check consistent.
- **Reviewer verdict, lens 2 (risk/security/privacy):** PASS — deactivate/activate never call Cognito; existing account gets no write; resend gated before Cognito and re-checked under lock; last-admin concurrency tested; audit inside the unit of work; decision line holds only ids/action/outcome/code (`^[A-Z_]{1,64}$`)/request id; non-HTTP errors log only `internal_error`.
- **runtime events:** none
- **spawns:** implementer not reported by host calls, 279462 tokens (56 tool uses), ended complete; reviewer lens 1 not reported by host calls, 108177 tokens (18 tool uses), ended complete; reviewer lens 2 not reported by host calls, 90446 tokens (14 tool uses), ended complete

#### Open points raised to the back lead at this gate (2026-10-19)

1. **Spec tension (FR-13 vs design § 7 step 5):** an edit writes one `update` event with every changed field's before/after. FR-13 "edit of each field … recorded with … before and after" vs § 7 "one `user_audit_events` row per change". Both Reviewers deferred it to each other. Leader proposal: amend § 7 to "one row per field changed" **or** "one row per request, each changed field with before/after" — answer pending.
2. **Product question (lens 2):** resend to a **deactivated** custom user is allowed today (temporary password for an account QA refuses with 403). FR-8 does not forbid it. Leader recommendation: refuse with 409 `USERS_INVITATION_NOT_APPLICABLE` — answer pending (business may confirm with Santi).
3. **Reliability (lens 1):** `edit` locks a second `users` row (`findByNickname(..., { forUpdate: true })`) outside the § 7 lock order — two admins swapping colliding nicknames concurrently can deadlock (MySQL 1213 → 500 instead of 409). A plain read suffices (unique key maps the race to `USERS_NICKNAME_TAKEN`, as DD-14 relies on); same for `findByEmail(..., { forUpdate: true })` in the insert race path. Raised as a spec-gap fix proposal (not an advisory-to-task): answer pending.

#### ADVISORY (Reviewers, 4R — non-gating, recorded only)

- Resend: if the in-tx re-check refuses or the DB write fails after Cognito resent, the email went out with no audit row — log `outcome=refused|error` with a reason (`cognito_sent_not_recorded`) and test the in-tx refusal; add a code comment (DD-7-style window).
- Duplicate `programId` in create `exclusions` → 409 `USERS_EXCLUSION_EXISTS`, not in § 6 `POST /users` errors — dedupe as `VALIDATION_FAILED` on `exclusions[i].programId`. **→ T-8 brief** (DTO validation).
- Worst case on create ≈ 20 s before 503 (catalog 10 s + Cognito 10 s; NFR-3 is per upstream — conforms). **→ T-10** note.
- `exclusion_add` audit changes omit the new exclusion's `id` (remove/dismiss include it) — record it for joinable history.
- `programs: []` rejected — stricter than § 6 `'all' | number[]` but follows "no rows = all". **→ T-8** document in OpenAPI.
- Log spy covers `create` and `deactivate`; others by construction (shared wrapper). **→ T-9 brief** (log-spy e2e over every mutation route).
- P-7 (collation) still decides case-insensitive nickname uniqueness — T-10.
- Readability: `resendInvitation` builds its 404 via `this.mutate(userId, async () => false)`.

#### Requirements covered

FR-2, FR-3 (replacing roles), FR-4 (behavior), FR-5, FR-6 (invalidate after commit), FR-7, FR-8, FR-13 (service part).

#### Final verification

lint ✅ · build ✅ · unit 961/961 ✅ · e2e 260/260 ✅ · tsc baseline ✅

### T-6 amendment: DD-15 — audit granularity, resend to a deactivated user, plain uniqueness reads

- **Final status:** PASS (Reviewer lens 1, re-review) · **Date:** 2026-10-19
- **User decisions (back lead, 2026-10-19):** "Adelante con la A y lo que consideres con el 2 y 3" — (1) option A: one `update` row per edit request with every changed field; (2) Leader's recommendation: refuse resend to a deactivated user (409); (3) Leader's recommendation: plain reads for uniqueness inside the unit of work. Business owner for (2): Santi Sánchez (QA product, per root `CLAUDE.md`) — may revisit; one-line change.
- **Attempts:** code 1 (PASS); spec wording 2 (attempt 1 FAIL on the Leader's DD-15 text, attempt 2 PASS)

#### Code (Implementer, same context as T-6)

- **Files changed:** `server/src/users/users-admin.service.ts`, `server/src/users/users-admin.service.spec.ts`, `server/test/support/users-admin-world.ts` (fake logs plain vs `FOR UPDATE` lookups; hook to model a concurrent commit mid-write).
- **Changes:** (1) no code change — existing test pins one `update` row with firstName + lastName before/after; (2) deactivated resend → 409 `USERS_INVITATION_NOT_APPLICABLE` in the pre-check (before Cognito) and the in-tx re-check; (3) nickname lookup in `edit` and email lookup in the create race path are plain reads; unique violation at write → 409 `USERS_NICKNAME_TAKEN` / `USERS_EMAIL_TAKEN`, no audit, no invalidation; (4) [advisory-grade] `exclusion_add` changes carry `exclusionId`; `cognito_sent_not_recorded` log line (`outcome=error`, ids only) when Cognito resent but the in-tx re-check refuses or the write fails.
- **Falsifiers (reverted):** drop `isActive` on resend → deactivated test red; restore `forUpdate: true` on the nickname lookup → "plain read" test red (`expected [ 'tx:begin', …(3) ] to include 'lookup:nickname:plain'`).
- **Implementer verification:** lint 0, build ok, unit 968, e2e 260, tsc 7 (token-verifier only).
- **Evidence re-run (Leader-inline, non-author):** lint 0; build 0; unit 968/968; e2e 260/260; tsc 7 → **VERIFIED**.

#### Spec (Leader edits, recorded when made)

- `design.md` § 7 step 5 (audit rows per DD-15), § 7 "Invitation (FR-8)" (active users only), § 10 new **DD-15**, § 2 summary line, Document Control date; `requirements.md` FR-8 headline ("an active custom user") + "Not applicable" scenario (+ deactivated); `tasks.md` T-4 Requirements line (FR-13 → DD-15).
- **Reviewer attempt 1 — FAIL (verbatim issue):** "DD-15 (1) says "one row per admin request per target". Step 5 says "role grants/revokes, scope changes and exclusion actions are one row each", and it also defines a change as "one admin request on one target". A create already writes `create` plus one `role_grant` per grant plus `scope_change` plus `exclusion_add` for a single request, and `replaceRoles` writes one row per grant or revoke. Read literally, DD-15 (1) would fail both, and a later reviewer could fail T-6 or T-8 on it. · Violated Rule: `design.md` § 10 DD-15 (1) against § 7 step 5 and the shipped create and roles audit layout. · Remediation: Spec-only fix … reword DD-15 (1) and the opening of step 5 … No code change."
- **Fix:** step 5 and DD-15 (1) reworded (edit = one `update` row; each grant/revoke, scope change, exclusion action, deactivation, reactivation and resend = its own row; create = one `create` row plus those rows); correction note in DD-15; sweep for "one event per change" / "row per change" / "per request per target" → only the correction note.
- **Reviewer attempt 2 — PASS:** step 5 and DD-15 agree with each other and with the service; FR-13 met by per-field before/after; FR-8 changes limited to the approved case. Leader then added deactivation/reactivation/resend to step 5's list (Reviewer's advisory; additive) — carried as a named conformance check into the T-7 Reviewer brief.
- **spawns:** implementer (follow-up, same context) not reported by host calls, 292835 tokens (8 tool uses), ended complete; reviewer lens 1 (re-review ×2, same context) not reported by host calls, 126626 + 133810 tokens (4 + 6 tool uses), ended fail then complete

#### ADVISORY (non-gating)

- RELIABILITY — the `cognito_sent_not_recorded` path writes a second decision line for one mutation (§ 7 Logging: "one decision line per mutation"); the catch would also fire if `cache.invalidate` threw after commit (synchronous; unlikely). **→ T-9 brief** (log-spy task): fold into one line or document the exception.

#### Final verification

lint ✅ · build ✅ · unit 968/968 ✅ · e2e 260/260 ✅ · tsc baseline ✅
