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
