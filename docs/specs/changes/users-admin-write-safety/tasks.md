# Users admin write safety — Tasks

| | |
|---|---|
| Spec path | `docs/specs/changes/users-admin-write-safety` |
| Branch | `feat/users-admin-write-safety` (from `origin/staging-center`) |
| Commits | `[SPEC:changes/users-admin-write-safety] <emoji> <type>(users): …` |
| Budget (design § 2) | 8 tasks · ~3,600 LOC · ~14 Reviewer passes |
| Verification (server) | `cd server && pnpm lint && pnpm build && pnpm test --reporter=dot && npx tsc --noEmit -p tsconfig.json` (baseline: 7 pre-existing errors in `src/auth/token-verifier.service.spec.ts`) — `pnpm test:e2e --reporter=dot` where stated |

Status: `[ ]` pending · `[~]` in progress · `[x]` done (after a Reviewer PASS, a recorded `REVIEW_WAIVED`, or a `REVIEW_SKIPPED`).

## Dependency graph

```
T-1 ─▶ T-2 ─┬─▶ T-3 ──────────────┐
            └─▶ T-4 ─▶ T-5 ────────┴─▶ T-6 ─▶ T-7 ─▶ T-8 (HITL)
```

Serial boundaries: T-1 (`server/src/database/**`); T-4 and T-5 both edit `users-admin.service.ts` (serial); T-3 and T-4 share no file but the same build — run one after the other.

---

## T-1: Schema and migration for `idempotency_keys`
- **Status:** [x]
- **Size:** S
- **Depends on:** none
- **Requirements:** FR-2, FR-5, FR-6, FR-7 (storage part: PK per admin + key, state, lease, expiry); NFR-5 (expiry index)
- **Design refs:** § 5; DD-1, DD-3
- **Scope:** `server/src/database/drizzle/schema/idempotency-keys.ts`, `schema/index.ts`, generated `server/drizzle/0002_*.sql` (+ meta), `schema.spec.ts`.
- **Tests:** `schema.spec`: composite PK (`actor_id`, `idem_key`), FK to users, `state` enum values, `fingerprint` char(64), `expires_at` index, nullable answer columns; migration additive (CREATE TABLE only, no ALTER/DROP).
- **Verification:** server command; generated SQL reviewed by hand against § 5.
- **Falsifier:** make the PK `idem_key` alone → the per-admin PK assertion goes red (two admins would collide, FR-6); drop the `expires_at` index → its assertion goes red.
- **Red run:** new `schema.spec` cases fail on assertions before the table exists.
- **Disqualifier:** a test that only asserts the table exists; a migration not read line by line.
- **Consumers:** `schema/index.ts` re-exports (`pnpm build`); `server/drizzle/meta/_journal.json`.
- **Review:** full — shared schema on a DB that is never reset.
- **Done when:** schema + migration + tests green; `0002` contains only the new table.
- **Skills:** nestjs-expert, nestjs-best-practices

## T-2: Fingerprint and idempotency store (port + Drizzle adapter)
- **Status:** [x]
- **Size:** M
- **Depends on:** T-1
- **Requirements:** FR-3 (replay lookup), FR-4 (fingerprint mismatch), FR-5 (in-flight, lease, take-over), FR-6 (per-admin scope), FR-7 (retention, purge), FR-9 (no cross-admin read), NFR-1, NFR-4 (store errors surface), NFR-5
- **Design refs:** § 5, § 7 Reserve / Lease / Fingerprint / Scope; DD-1, DD-3; P-7, P-12
- **Scope:** `server/src/common/idempotency/{fingerprint,idempotency.store,idempotency.errors}.ts`, `server/src/common/error-codes.ts` (`IDEMPOTENCY_IN_PROGRESS` 409, `IDEMPOTENCY_KEY_REUSED` 422), in-memory fake in `server/test/support/` with lock/duplicate-key emulation (core T-4 pattern).
- **Tests:** fingerprint table (key order, nested objects, arrays order-sensitive, whitespace, path ids, query ignored, same body different path); store: reserve new → `in_progress`; duplicate → returns the existing row; take-over only when the lease expired and only with the old `owner_token` (compare-and-set); two concurrent take-overs → exactly one wins; `markExecuted` conditioned on `in_progress` + token (0 rows → typed error); `complete`/`release` only by the owner; purge deletes only expired rows in a bounded batch; every query keyed by `actor_id`; generated SQL asserted (PK insert, conditional UPDATE, bounded DELETE).
- **Verification:** server command.
- **Falsifier:** drop `owner_token` from the take-over condition → the concurrent take-over test lets both win (red); drop `actor_id` from the lookup → the cross-admin test returns the other admin's row (red); sort arrays in the canonical form → the "array order matters" row goes red.
- **Red run:** store and fingerprint tests fail on assertions against a skeleton.
- **Disqualifier:** a concurrency test whose fake serializes calls; no assertion on the real SQL.
- **Consumers:** `server/src/common/error-codes.ts` (error catalog; OpenAPI tests read it) — run `pnpm test:e2e` too.
- **Review:** full — concurrency and data isolation.
- **Done when:** store + fingerprint green with all falsifiers executed; P-12 listed for T-8.
- **Skills:** nestjs-expert, nestjs-best-practices, tdd

## T-3: Idempotency interceptor and `@Idempotent()` decorator
- **Status:** [ ]
- **Size:** M
- **Depends on:** T-2
- **Requirements:** FR-1 (no header → untouched); FR-2 (Remembered success · Remembered refusal · Not remembered on a server failure); FR-3 (replay marker; BUT no re-execution — at interceptor level: handler not called); FR-4; FR-5 (in-flight → 409); FR-6 (malformed key → 400; 401/403 never reach it — P-1); NFR-2 (decision-line field), NFR-4 (store down → 503, handler not called)
- **Design refs:** § 7 Interceptor order, Reserve, Complete/release, Replay rendering, Decision log; DD-2, DD-4, DD-5, DD-6; P-1…P-4
- **Scope:** `server/src/common/idempotency/{idempotency.interceptor,idempotent.decorator,idempotency.context}.ts` + unit spec. No route wiring yet (T-6).
- **Tests:** decision table over a stub handler: no header; malformed key; new key + 2xx → `complete`; new key + domain 4xx → stored refusal; pipe 400 → stored refusal; 5xx/unknown → `release`; replay success (handler not called, `Idempotency-Replayed` header, same `data`); replay refusal (re-thrown with same status/code/fields); `executed` without answer → `route_status` + fresh detail via an injected reader; reuse → 422; in flight → 409; expired lease → take-over then run; store throws → 503 and handler not called.
- **Verification:** server command.
- **Falsifier:** call the handler before checking the stored row → the "replay never calls the handler" assertion goes red; remember 5xx answers → the "release on 5xx" row goes red.
- **Red run:** decision-table rows fail on assertions against a pass-through interceptor.
- **Disqualifier:** a replay test that only checks the status (must check handler not called and `data` equality).
- **Consumers:** none yet (opt-in decorator, wired in T-6).
- **Review:** full — the contract of every keyed write.
- **Done when:** every decision-table row green with falsifiers executed.
- **Skills:** nestjs-expert, error-handling-patterns, tdd

## T-4: Exactly-once fence in the unit of work and the service
- **Status:** [ ]
- **Size:** M
- **Depends on:** T-2
- **Requirements:** FR-2 (AND IT MUST mark executed in the same commit as the change); FR-3 (BUT no second user / Cognito call / audit / invalidation / email — service level); FR-5 (a stalled first request cannot commit after a take-over); NFR-1
- **Design refs:** § 7 Exactly-once fence; DD-2, DD-3; P-5, P-6, P-11
- **Scope:** `server/src/users/users-admin.unit-of-work.ts` (tx-bound idempotency store in `UsersAdminRepositories`), `users-admin.service.ts` (`AdminContext` carries the optional reservation; every mutation incl. `create` and `resendInvitation` calls `markExecuted` inside its transaction; no-op mutations mark too), specs; `users-admin-world` fake.
- **Tests:** for each public mutation: with a reservation, `markExecuted` runs inside the same tx (rollback test: a failure after the change rolls back both the change and the mark); token mismatch (taken over) → the change rolls back and nothing is audited or invalidated; without a reservation → behavior unchanged (existing 1,016 tests green); `create`/`resendInvitation` mark in the tx that follows the Cognito call.
- **Verification:** server command + `pnpm test:e2e --reporter=dot`.
- **Falsifier:** mark executed in a separate write after the tx → the rollback test sees a mark without a change (red); ignore the 0-rows result → the take-over test commits a second change (red).
- **Red run:** fence tests fail on assertions before the wiring exists.
- **Disqualifier:** a test that spies `markExecuted` without proving it ran in the same transaction (assert on the tx/stub connection, core T-4 pattern).
- **Consumers:** `AdminContext` and `UsersAdminRepositories` readers (`users-admin.controller.ts`, service, `test/support/users-admin-world.ts`, `test/support/users-admin-app.ts`, all users e2e suites).
- **Review:** lenses — reliability (transactions, fencing) and risk (exactly-once).
- **Done when:** fence green on every mutation with falsifiers executed; no existing test changed in meaning.
- **Skills:** nestjs-expert, nestjs-best-practices, tdd

## T-5: Aggregate edit in the service (`replaceUser`) and helper extraction
- **Status:** [ ]
- **Size:** M
- **Depends on:** T-4
- **Requirements:** FR-8 (Full save · All or nothing BUT nothing may change · Same rules AND IT MUST enforce every rule / write the same audit rows · No change · Out of reach (D4) · Unknown user)
- **Design refs:** § 7 Aggregate edit, Exclusion reconciliation; DD-7, DD-8; P-11
- **Scope:** `users-admin.service.ts` — extract the edit, programs-replace and manual-exclusion-remove closures into helpers taking `(repos, ctx, target, …)`; the separate routes call them; add `replaceUser` (validate all → one `mutate` → edit, roles, programs, reconcile manual exclusions → one invalidate). Specs.
- **Tests:** parity table: for each input, the aggregate and the sequence of separate calls give the same final state and the same audit rows (unchanged parts write none); refusal at each step (nickname taken, name locked, role conflict, last admin, unknown program, catalog 503, duplicate programId, `reporting` exclusion on a listed program) → no change, no audit, no invalidation; no-op → no audit; `reporting` exclusions, activation, invitation, email untouched; unknown user → 404.
- **Verification:** server command.
- **Falsifier:** apply roles in their own transaction inside `replaceUser` → the "last admin refusal leaves the nickname unchanged" row goes red; skip the reconcile removal → the parity row "exclusion removed" goes red.
- **Red run:** `replaceUser` tests fail on assertions against a skeleton.
- **Disqualifier:** parity tests that compare only HTTP status; refusal tests without "no audit / no invalidation".
- **Consumers:** the separate-route service tests (`users-admin.service.spec.ts`) — must stay green unchanged in meaning (refactor).
- **Review:** full — core behavior shared by 5 routes.
- **Done when:** parity and refusal tables green; existing service tests unchanged in meaning.
- **Skills:** nestjs-expert, nestjs-best-practices, tdd

## T-6: Route wiring, `PUT /users/:id`, DTO and OpenAPI
- **Status:** [ ]
- **Size:** M
- **Depends on:** T-3, T-4, T-5
- **Requirements:** FR-1…FR-6 (HTTP surface, every write route); FR-3 Replayed create · Replayed invitation (BUT no email — Cognito spy) · Replayed refusal; FR-6 Another admin, same key (BUT no reveal); FR-8 (HTTP surface); FR-10
- **Design refs:** § 6, § 7; DD-4, DD-6; P-8, P-10
- **Scope:** `server/src/users/users-admin.controller.ts` (`@Idempotent()` on the 10 write routes; new `PUT /users/:id`; the reservation passed in `AdminContext`; the post-crash reader), `server/src/users/dto/replace-user.dto.ts`, OpenAPI (header, replay header, codes, new route); e2e `server/test/users-admin-idempotency.e2e-spec.ts` (+ `PUT` cases in `users-admin.e2e-spec.ts`).
- **Tests:** per write route: same key twice → one side effect (one user / one audit set / one Cognito call / one invalidation), second answer = first `data` + `Idempotency-Replayed: true`; no header twice → today's behavior; reuse → 422; in flight (held reservation) → 409; another admin with the key → fresh execution, never the first body; 401/403 with a key → nothing stored; malformed key → 400; `PUT /users/:id` happy path, each refusal code, unknown fields, 403 matrix (every grantable non-admin role, core T-8 pattern); OpenAPI lists the header and each route's codes exactly.
- **Verification:** server command + `pnpm test:e2e --reporter=dot`.
- **Falsifier:** remove `@Idempotent()` from `POST /users/:id/invitation` → its "one Cognito call" e2e goes red; key the store by key only → the cross-admin e2e goes red.
- **Red run:** e2e fail on assertions (second side effect / missing header) before wiring.
- **Disqualifier:** replay e2e that check status only; a 403 matrix with fewer roles than `GRANTABLE_ROLES`.
- **Consumers:** `test/openapi.e2e-spec.ts`, `test/auth-hardening.e2e-spec.ts` (route inventory), `test/users-admin.e2e-spec.ts`, `test/users-admin-privacy.e2e-spec.ts`; front `client/src/app/core/http/*` (informative, P-10).
- **Review:** lenses — contract and security.
- **Done when:** every write route proven idempotent over HTTP; `PUT` fully tested; OpenAPI exact.
- **Skills:** nestjs-expert, api-design-principles, nestjs-best-practices

## T-7: Privacy, docs and front contract addendum
- **Status:** [ ]
- **Size:** S
- **Depends on:** T-6
- **Requirements:** FR-9; NFR-2; NFR-3 (overhead measured: keyed vs unkeyed write on the e2e app, recorded); FR-10 (docs); P-14 (front acceptance)
- **Design refs:** § 7 Decision log, § 8, § 9
- **Scope:** log-spy e2e over keyed writes (every logger, core T-9 pattern): no stored body, request body, email or name in any line; decision line carries `idempotency=`; module guides (`server/src/common/AGENTS.md` idempotency section, `server/src/users/AGENTS.md`, `server/src/database/AGENTS.md` new table/`0002`, `server/test/AGENTS.md` new fake/suite); `docs/specs/changes/users-admin-write-safety/front-contract.md` (addendum: header honored, replay marker, `PUT /users/:id`, 409 `IDEMPOTENCY_IN_PROGRESS` is transient, 422 reuse = client bug); TRD pending items recorded in `execution.md`.
- **Tests:** as scope.
- **Verification:** server command + `pnpm test:e2e --reporter=dot`; addendum sent to the front lead and the answer to P-14 recorded.
- **Falsifier:** log the remembered `data` in the replay line → the log-spy test goes red.
- **Red run:** n/a for docs; the log-spy falsifier is the evidence.
- **Disqualifier:** a log spy that captures one logger; an NFR-3 overhead figure from fewer than 200 requests (report the spread instead).
- **Consumers:** none.
- **Review:** checklist — tests + docs (claims checked at `file:line`, KZ-auth--user-management--core-3).
- **Done when:** log spy green with falsifier; guides and addendum true of the code; P-14 answered or recorded open.
- **Skills:** nestjs-expert, api-design-principles, cognitive-doc-design

## T-8: HITL validation (shared DB)
- **Status:** [ ]
- **Size:** S
- **Depends on:** T-7; a human applies `0002` on `qadb`
- **Requirements:** NFR-1 on real MySQL (P-12); P-13; FR-3/FR-5 on the running API
- **Design refs:** § 11 UNVERIFIED rows
- **Scope:** with the back lead: apply `0002`; confirm P-13 (qatest DB); run, rollback-only where possible, two concurrent reservations of the same key and a take-over race on `qadb` (P-12); against the local API: replay of `POST /users` and of the invitation with the same key (one user, one email), a reuse and an in-flight case; record outcomes in `execution.md`; refuted premise → Pivot.
- **Tests:** manual checklist above.
- **Verification:** each UNVERIFIED row gets "confirmed" or "refuted" with its observation.
- **Falsifier:** two concurrent reservations of the same key both succeeding on `qadb` refutes P-12 (DD-3).
- **Red run:** n/a (no test gate)
- **Disqualifier:** a concurrency check run sequentially (it cannot show the race).
- **Consumers:** none.
- **Review:** checklist — recorded evidence only.
- **Done when:** P-12, P-13 settled (P-14 settled in T-7 or recorded open).
- **Skills:** none required

---

## Coverage (scenario and clause level)

| Requirement | Scenario / clause | Task |
|---|---|---|
| FR-1 | No header · BUT nothing remembered | T-3 (unit), T-6 (HTTP) |
| FR-2 | Remembered success · AND IT MUST mark executed in the same commit · answer stored after commit / crash replay | T-3 (complete, crash reader), T-4 (same-commit fence), T-6 |
| FR-2 | Remembered refusal (D3) | T-3, T-6 |
| FR-2 | Not remembered on a server failure (D3) | T-3 |
| FR-3 | Replayed create · BUT no user / Cognito / audit / invalidation / extra log line | T-3 (handler not called), T-4 (service), T-6 (HTTP side effects), T-7 (log line) |
| FR-3 | Replayed invitation · BUT no email | T-6 (Cognito spy), T-8 (real pool, optional) |
| FR-3 | Replayed refusal | T-3, T-6 |
| FR-4 | Reuse → 422, nothing executes | T-2 (fingerprint), T-3, T-6 |
| FR-5 | Two identical requests at once · AND IT MUST hold on any number of instances | T-2 (CAS, fake), T-4 (fence), T-8 (real MySQL) |
| FR-5 | Abandoned in-flight key · AND IT MUST NOT expire while a request can still run | T-2 (lease), T-3 (take-over) |
| FR-6 | Another admin, same key · BUT must NOT reveal | T-2, T-6 |
| FR-6 | Malformed key → 400 | T-3, T-6 |
| FR-6 | Refused before reaching the write (401/403) | T-6 (P-1) |
| FR-7 | Retention 24 h, removal, key reusable after | T-2 |
| FR-8 | Full save (roles rules, programs rules, reconcile) | T-5, T-6 |
| FR-8 | All or nothing · BUT nothing may change | T-5 |
| FR-8 | Same rules · AND IT MUST enforce every rule · AND IT MUST write the same audit rows | T-5 (parity table) |
| FR-8 | No change | T-5 |
| FR-8 | Out of reach (D4) · AND IT MUST leave untouched · BUT unknown fields refused | T-5, T-6 |
| FR-8 | Unknown user | T-5, T-6 |
| FR-9 | Remembered answers private (logs, other admins, deleted after retention) | T-2 (scope, purge), T-6 (cross-admin), T-7 (logs) |
| FR-10 | OpenAPI header, replay header, codes, `PUT` | T-6 |
| NFR-1 | At most one execution | T-2, T-4, T-8 |
| NFR-2 | No PII in logs | T-7 |
| NFR-3 | Overhead ≤ 20 ms p95; replay touches no catalog/Cognito | T-3/T-6 (no calls on replay), T-7 (measurement) |
| NFR-4 | Store down → 503, no execution | T-3 |
| NFR-5 | Automatic removal | T-2 |
