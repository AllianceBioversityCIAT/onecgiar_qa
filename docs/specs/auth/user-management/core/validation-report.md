# Validation Report — User management (core)

## Document Control

| | |
|---|---|
| Spec path | `docs/specs/auth/user-management/core` |
| Validated | 2026-10-19 · branch `feat/auth-user-management` @ `0b6aeda` (identical content merged into `staging-center` @ `8fda249`) |
| Auditors | Two independent T3 auditors (`opus`, read-only; neither implemented the spec) — A: requirement coverage at clause level; B: tasks, files, quality, design conformance, guides. Build integrity run by the Leader. |
| Inputs | `requirements.md`, `design.md`, `tasks.md`, `execution.md`, `front-contract.md`, `../proposal.md`, `../family.md`; constitution (`AGENTS.md`, `docs/prd.md`, `docs/trd/trd.md`); no `test-report.md` (coverage verified directly) |

## Summary

**Verdict: PASS with warnings — archive-ready once the documentation drift below is fixed (or explicitly accepted).** No FAIL. Every requirement clause is implemented and tested; the warnings are (a) documentation drift accumulated through four approved amendments, (b) residual risks already recorded as open in T-10, (c) a handful of small test or contract gaps.

| Area | PASS | WARN | FAIL | BLOCKED |
|---|---|---|---|---|
| Requirement clauses (80) | 66 | 14 | 0 | 0 |
| Tasks, files, design, guides | 25 | 15 | 0 | 0 |
| Build integrity | 5 | 0 | 0 | 0 |

The one BLOCKED clause of auditor A ("compiler-only / suite green" — auditors have no shell) is closed by the Leader's run below and counted as PASS.

## Task Completion

All 10 tasks are `[x]`, each with a closing Reviewer PASS and verification evidence in `execution.md`; amendments and follow-ups (DD-12, T-1 type fix, DD-15, T-7 live-grant) are closed.

| Finding | Result |
|---|---|
| T-1…T-9: closing record + re-run evidence before the final status | PASS |
| T-10: evidence tables and Reviewer PASS; the DD-3 COMMIT falsifier was never run (residual, open) | WARN |
| Evidence-before-checkbox: each task's entry and checkbox land in the same commit, so the order is provable only inside the entry, not from git | WARN |

## File Existence

| Path (design § 4 / § 9) | Result | Note |
|---|---|---|
| `server/src/users/{users-admin.controller,users-admin.service,users-admin.unit-of-work,users-query.repository,user-programs.repository,user-audit.repository,effective-scope,permissions,authorization.service,current-user.cache}.ts`, `dto/*` | PASS | |
| `server/src/users/catalogs/{reporting-catalog.client,clarisa.client}.ts` | WARN | Shipped as `reporting-result-types.client.ts`, `clarisa-science-programs.client.ts` (+ `catalog-http`, `catalogs.ports`, `catalogs.errors`); rename not reflected in § 4 |
| `server/src/auth/cognito-admin.module.ts` (not in § 4) | WARN | Explained in `execution.md` T-8 (avoids an Auth↔Users module cycle); § 4 not amended |
| Auth, common, config, schema files, `server/drizzle/0001_user_management.sql` | PASS | |
| § 9 dependency and env vars (`package.json:29`, `.env.example:28-43`, `env.validation.ts`) | PASS | |

## Build Integrity

Run by the Leader on `0b6aeda` (2026-10-19):

| Check | Result |
|---|---|
| `pnpm lint` | PASS — 0 |
| `pnpm build` | PASS — 0 |
| `pnpm test` | PASS — 34 files, 1,012 tests |
| `pnpm test:e2e` | PASS — 9 files, 397 tests |
| `npx tsc --noEmit -p tsconfig.json` | PASS — only the 7 pre-existing errors in `src/auth/token-verifier.service.spec.ts` (outside this spec) |

`client/` is untouched by this spec. Environment boot smoke: done during T-10 (API from the branch on port 3400 against `qadb`, all routes exercised) — PASS.

## Requirement Coverage

Clause-level detail by auditor A; one row per requirement here.

| Req | Result | Evidence / note |
|---|---|---|
| FR-1 Admin-only | PASS | 6 roles × 12 routes → 403 with byte-equal bodies for existing vs missing id; 401 without token |
| FR-2 Create | PASS + 2 WARN | All scenarios tested (SSO link, custom new/existing, validation, 409s, no record on failure, 503). WARN: the `UsernameExists` race path is unit-only (real pool residual); 4-byte characters (emoji) in names/nickname likely 500 on `utf8mb3` — no requirement clause covers it |
| FR-3 Roles | PASS | Overlap incl. `all` (3 shapes), future types, diff replace, unchanged grant keeps its id |
| FR-4 Program scope and exclusions | PASS | As amended by DD-13 (active ADMIN exempt); DD-12 system end verified on real MySQL |
| FR-5 Edit | PASS | Email immutable; names only before first sign-in; 404 |
| FR-6 Takes effect | PASS | Invalidate after commit; 60 s TTL — no single end-to-end chain test (advisory) |
| FR-7 Deactivate / last admin | PASS + 3 WARN | WARN: "past actions keep their name and nickname" has no assertion; "AND IT MUST hold concurrently" proven by lock-emulating tests and real-MySQL serialization (wait, no deadlock) — the committed race is residual (needs a second ADMIN) |
| FR-8 Resend | PASS + 1 WARN | As amended by DD-15 (deactivated → 409). WARN: the "already confirmed" Cognito refusal is unit-only (real pool residual) |
| FR-9 List | PASS + 1 WARN | WARN: case-insensitive `q` not exercised on real MySQL (low risk: `_ci` collation confirmed) |
| FR-10 Detail | WARN | Active exclusions carry no "who" (`createdBy`); history (removed/dismissed) does — matches design § 6, narrower than FR-10's wording |
| FR-11 Catalogs | PASS | Real Reporting/CLARISA verified in T-10; 503 without copy; stale ≤ 24 h |
| FR-12 Nickname exposure | PASS + 1 WARN | `/auth/me` nickname ✅. WARN: `toPublicUser` exists and is unit-tested but no route uses it yet (no non-admin endpoint exists) — deferred by nature |
| FR-13 Audit | PASS | Over HTTP per DD-15; none on refusal |
| FR-14 ADMIN holds all | PASS | Matrix derived from the permission catalog |
| NFR-1 | PASS + 1 WARN | `/users`: inventory + 403 per route. WARN: `/catalogs` 403 tested for ASSESSOR only; no inventory assertion |
| NFR-2 | PASS | Log spy over every logger and mutation route |
| NFR-3 | PASS + 1 WARN | Cognito: one 10 s budget ✅. WARN: catalogs are 10 s per upstream call — a cold-cache create can take ~20 s before its 503 |
| NFR-4 | PASS | p95 167 ms over 260 requests, 550 users, on `qadb` |
| NFR-5 | PASS | Unique keys and CHECKs verified on real MySQL; last-admin concurrency — see FR-7 |
| § 7 defect-class gates (11) | 8 PASS · 3 WARN | WARNs are the NFR-1 catalogs, FR-7 concurrency and FR-12 rows above |

**Requirement-intent drift (not violations, need a spec line):** FR-10 "who" on active exclusions; NFR-3 bound per upstream call vs per request; FR-9 `programId` filter keeps users excluded from that program (design choice, unstated in FR-9).

## Linting & Code Quality

Lint clean. Architecture: no module cycle, no `forwardRef`, secrets read only in `src/config/`, `ADMIN_ACCESS` at class level on both controllers, decision log carries ids only.

**4R advisory (do not drive the verdict):**

| Lens | Finding |
|---|---|
| Risk | `catalog-http.ts` `fetch` follows redirects — a redirecting Reporting host or proxy would receive `x-api-key`; set `redirect: 'error'` |
| Risk | `no-qa-tokens.spec.ts` only checks env names containing `SECRET`; `CLARISA_API_KEY` is not pinned |
| Risk | The ADMIN exemption (DD-13) keys on the `ADMIN_ACCESS` permission, not the role; covered only indirectly |
| Reliability | `/users/:id/activate` documents 409 `USERS_LAST_ADMIN` it can never return (the combined deactivate/activate row in design § 6); the OpenAPI test locks it in |
| Reliability | `countActiveAdmins` (`users-admin.unit-of-work.ts:112-121`) ignores `revokedAt` and the role catalog, unlike `isLiveAssignment` used elsewhere |
| Reliability | `phase_year` = UTC calendar year → 503 risk on 1 January (take it from the active cycle later) |
| Reliability | `utf8mb3` charset (see FR-2 WARN) |
| Resilience | Catalog outage: no failure memory/backoff — each request waits up to 10 s before the stale copy |
| Readability | Two `UpstreamUnavailableError` classes mapped by class; duplicate imports in `catalogs.controller.ts`, `dto/create-user.dto.ts`; `users-admin.unit-of-work.spec.ts:209` still names the REPEATABLE READ claim T-4 found wrong |
| Process | The T-9 commit is typed `📝 docs` but adds tests and a service change |

**Carried-forward advisories still open in code** (from `execution.md`): the above, plus `PATCH /users/:id` with `{}` untested; re-read failure after a committed create answers 5xx; no HTTP check that a rollback leaves the audit count unchanged; T-1 `toContainEqual`/DD-12 `not.toMatch` assertions that cannot fail; the fake has no deadlock detection and emulates only `roleActive`; Accelerators SP12/SP13 not confirmed by the business owner.

## Design Conformance

| Finding | Result |
|---|---|
| 12 `/users` + 3 `/catalogs` routes; 11 new error codes; § 7 lock order, DD-14, DD-15, § 7 Logging match the code | PASS |
| requirements § 8 scenario counts match the FR headings; § 11 ledger "14 verified · 0 UNVERIFIED" has 14 rows | PASS |
| design § 6: 503 listed only on create/invitation (code also documents it on roles, programs, exclusions per § 7); combined deactivate/activate row gives activate `USERS_LAST_ADMIN` | WARN |
| design § 5 still says "new nullable columns" for `users` — `invitation` is NOT NULL | WARN |
| `execution.md` header budget still ~3,200 LOC · ~16 passes (design § 2 / tasks header: ~12,500 · ~20) | WARN |
| Reviewer-pass totals: `spawns` lines sum to 19 after T-8 (doc says 20) and 23 at close (doc says 25) | WARN |
| requirements § 7 "exactly one audit entry" and T-9 scope "each mutation → exactly one event" contradict DD-15 (create/roles write several rows) | WARN |
| tasks.md: T-2 "FR-11 (both scenarios)" (FR-11 has 1); T-8 Tests line lists 4 roles; T-5 still reads "stays `[!]`" | WARN |
| `requirements.md` / `design.md` still `Status: Draft`; `family.md` core child `active`; `execution.md` Summary says "not pushed, not merged" (now merged @ `8fda249`) | WARN |
| `proposal.md`: non-goal "Invitation emails" overtaken by D7/FR-8; success criterion "no user can review an excluded program" contradicted by DD-13 (recorded in `execution.md` T-3; proposal treated as historical) | WARN |

## Test Evidence Summary

| Kind | Evidence |
|---|---|
| Unit | 1,012 tests — rules, repositories (generated SQL asserted), unit of work (lock-emulating fake), service (every FR scenario with side effects), clients (fixtures from real responses) |
| e2e | 397 tests — every route × role matrix, validation fields, error codes, OpenAPI per-route codes, log privacy, audit coverage over HTTP |
| Manual (T-10, `qadb` + real pool) | constraints, case-insensitive nickname, lock serialization, Cognito create/existing/resend + emails, real catalogs, NFR-4 p95 |
| Falsifiers | executed and recorded per task (red then reverted) |
| Residual (open, recorded in `execution.md` T-10) | DD-3 committed race; demotion vs login; same-row opposite grants; concurrent `replaceScope`; `ER_DUP_ENTRY` mapping over the API; isolation observability; resend after confirm; `UsernameExists` race; mixed-case `q`; `utf8mb3` |

## Agent Guide / Constitution Impact

| Finding | Result |
|---|---|
| Guides updated in T-9 cover the new surface (`server/AGENTS.md`, `server/src/{users,auth,common,config,database}/AGENTS.md`, `server/test/AGENTS.md`) | PASS |
| `execution.md` has no `## Constitution Impact` block although one was owed (public admin API, `CognitoAdminModule`, `users/catalogs`, `users/dto`) | WARN → add for `/akili-archive` |
| Root `AGENTS.md` `## Module Guides` users/auth descriptions are stale (recorded as an optional pending item for `staging`) | WARN → `/akili-archive` on `staging` |

## Remediation

**R-A — documentation (no code; recommended before archive):**
1. `design.md`: § 4 file names (catalog clients, `cognito-admin.module.ts`); § 5 `invitation` NOT NULL; § 6 split deactivate/activate errors and list 503 on roles/programs/exclusions; `Status`.
2. `requirements.md`: § 7 audit gate wording per DD-15; one line each for FR-10 (who on active exclusions — accept as § 6 or expose it), NFR-3 (bound per upstream call), FR-9 (`programId` keeps excluded users); a clause for 4-byte characters (or record as known limitation); `Status`.
3. `tasks.md`: T-2 FR-11 wording, T-8 Tests roles, T-5 `[!]` wording.
4. `execution.md`: header budget, Reviewer-pass totals (state the counting rule), Summary merge state, `## Constitution Impact` block; `family.md` core status.

**R-B — small code/test items (optional, one short follow-up task):**
1. `/activate` OpenAPI: drop `USERS_LAST_ADMIN`.
2. `/catalogs` 403 rows for every non-admin role + inventory assertion (NFR-1).
3. Assert deactivation keeps names/nickname (FR-7).
4. `fetch` `redirect: 'error'`; pin `CLARISA_API_KEY` in the no-secret check.
5. `countActiveAdmins` aligned with `isLiveAssignment`.

**R-C — residual risks (human, when conditions allow):** DD-3 committed race once a second ADMIN exists; resend after confirm and `UsernameExists` race on the next real invite; mixed-case `q` on `qadb`; `utf8mb3` decision (DTO validation or `utf8mb4`, with the pool/infra owner).

## Archive Readiness Recommendation

**Ready for `/akili-archive` after R-A**, with R-B accepted as a follow-up and R-C carried as recorded residual risks. No FAIL blocks archiving; all tasks are complete, tests cover every key scenario, and amendments are reflected in the spec. The back lead must review this summary and choose: fix R-A (+ optionally R-B) now, or accept the warnings as they stand.

```text
/akili-archive auth/user-management/core
```
