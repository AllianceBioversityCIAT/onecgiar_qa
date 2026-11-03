# Users admin write safety — Proposal

## Document Control

| | |
|---|---|
| Spec path | `docs/specs/changes/users-admin-write-safety` |
| Type | Change |
| Approval Mode | gated |
| Status | Draft — awaiting approval |
| Branch | `feat/users-admin-write-safety` (from `origin/staging-center` @ `21ca0ca`) |
| Source | Front lead request, Slack DM 2026-10-20 10:12 (Assessors screen integration); Jira: none yet (parent story P2-3908) |
| Builds on | `docs/specs/archive/2026-10-19-auth--user-management--core/` (users admin API) |
| Depends on | none (the core spec is merged in `staging-center`) |
| Parallel-safe | no — touches the `users` module and the shared `common/` HTTP layer |
| Scope | Server only (`server/`) |
| Date | 2026-10-20 |

## Intent

Make the users admin API safe to call from a client that retries writes, and let the front save one person in one call.

## Problem / Current Behavior

1. **The front already retries writes with an `Idempotency-Key`, and the server ignores it.**
   - The front's request interceptor adds `Idempotency-Key` to every write (`client/src/app/core/http/request-safety.interceptor.ts:29,56-57`; header name `client/src/app/core/http/unsent-queue.ts:10`).
   - It replays a write that got no answer, a timeout, or 502/503/504, every 60 s, with the same key (`request-safety.interceptor.ts:30-32`; `unsent-queue.ts:13,35-37`).
   - The front timeout is 20 s (`client/src/app/core/http/request-context.ts:7`).
   - No server code reads the header (`git grep -i idempotency -- server` → no match).
2. **How each users admin write behaves on a replay today** (from the core spec's service rules, `server/src/users/users-admin.service.ts`; archived design § 7):

   | Route | Replay today |
   |---|---|
   | `PATCH /users/:id`, `PUT /users/:id/roles`, `PUT /users/:id/programs`, `POST …/deactivate`, `POST …/activate` | Harmless — no change, no audit row, 200 with the same `UserDetail` |
   | `POST /users` | No duplicate, but **409 `USERS_EMAIL_TAKEN`** instead of the first 201 |
   | `POST …/exclusions`, `DELETE …/exclusions/:id`, `POST …/dismiss` | 409 / 404 instead of the first answer |
   | `POST /users/:id/invitation` | **Sends another Cognito email** — the only replay with a real side effect |

3. **A create can outlive the front's 20 s timeout.** A cold-cache `POST /users` reads two catalogs one after the other (10 s bound each) and then calls Cognito (one 10 s budget) — about 30 s worst case (archived `requirements.md` NFR-3). The front then queues and replays a request that probably succeeded and gets a 409.
4. **Editing one person takes up to five separate calls** (`PATCH`, `PUT roles`, `PUT programs`, exclusion add/remove), each in its own transaction (archived design § 6). If one fails midway, the person is left partly edited; the front must order and recover the calls itself.

## Proposed Outcome

- A write sent again with the **same `Idempotency-Key`** gets **the same answer as the first time** (status and `data`; the envelope `meta` is per request) and **does nothing again** — no second user, no second email, no second audit row.
- The same key with a **different request** is refused instead of silently returning a stale answer.
- **`PUT /users/:id`** saves a person's nickname/names, roles, program scope and manual exclusions **in one transaction**: all or nothing, one cache invalidation, the same audit rows and rules as the separate routes.

## Scope

- Idempotency for every write route of the users admin API (`POST /users`, `PATCH /users/:id`, `PUT /users/:id/roles|programs`, the three exclusion routes, `deactivate`, `activate`, `invitation`, and the new `PUT /users/:id`), built as a reusable mechanism other modules can opt into later.
- The key is **optional**: a write without it behaves exactly as today.
- New `PUT /users/:id` (admin-only), reusing the service's existing validation, guards (Assessor/Lead, last admin, live-grant rules) and audit layout (DD-15).
- OpenAPI, module guides and the front contract note updated; tests at the core spec's standard (unit + e2e, falsifiers).

## Non-Goals

- Idempotency for auth routes (login, refresh, logout, callback) or catalogs (read-only).
- Changing the front's interceptor or retry policy.
- Removing the existing separate routes (they stay; the front can use either).
- Dismissing `reporting` exclusions through `PUT /users/:id` (stays on its own route — it needs a reason and is not an edit of the desired set).
- Lowering the cold-cache create latency (could be a later change: warm catalogs at boot).

## Affected Users, Systems, And Specs

| Affected | How |
|---|---|
| QA Admin (via the Assessors screen) | Safe retries; single save |
| Front (`client/` HTTP layer, Assessors screen) | Already sends the key; can switch edit to `PUT /users/:id` |
| `server/src/users/` | Service gains the aggregate edit; controller gains a route |
| `server/src/common/` | Idempotency interceptor/guard + storage port |
| `server/src/database/` | New storage for keys (option A: table + migration `0002`) |
| Archived core spec | Behavior is extended, not changed; its contract note gets an addendum |

## Visual Reference

- Source: None
- Notes: backend-only change; the Assessors screen already exists on the front.

## Requirement Delta Preview

### ADDED Requirements

- **Idempotent writes:** a users-admin write carrying `Idempotency-Key` is executed at most once per key and admin; a repeat within the retention window returns the stored status and body.
- **Key reuse with a different request** (method, path or body differ) → refused with a dedicated error (e.g. 422 `IDEMPOTENCY_KEY_REUSED`).
- **Concurrent repeat** while the first is still running → refused fast with a retryable error (e.g. 409 `IDEMPOTENCY_IN_PROGRESS`), never executed twice.
- **Failed first attempt** (validation error, 409, 5xx) — whether its answer is replayed or the key is freed for a retry is decided at specify (recommendation: replay 4xx, free on 5xx/timeout).
- **Aggregate edit:** `PUT /users/:id` with `{ nickname?, firstName?, lastName?, roles, programs, exclusions }` (exclusions = the desired set of **manual** exclusions with reasons) applies everything in one transaction; any refusal changes nothing.

### MODIFIED Requirements

- Archived NFR-2 / § 7 Logging: the decision line gains the idempotency outcome (`replayed`, `in_progress`, `reused`) — ids only, never the key's request body.

### REMOVED Requirements

- None.

## Approach Options

| Option | How keys are stored | Pros | Cons |
|---|---|---|---|
| **A. MySQL table, inside the unit of work** | `idempotency_keys` (key + actor, request hash, status, response, expires); reserved before the write, completed **in the same transaction** as the change | Exactly-once with the data change (no gap between "wrote" and "remembered"); fits the existing unit of work and lock order; no new AWS permissions | New migration `0002` on `qadb` (human-applied); expired rows need a cleanup (delete on read + small sweep) |
| B. DynamoDB with TTL | ElectroDB entity in `cgiar-qa-{env}` with a TTL attribute | Native expiry; no MySQL migration | Not atomic with the MySQL write (a crash between them replays the action); TTL must be enabled on the table and IAM extended (pool/infra owner); first entity in the table |
| C. In-process memory | Map with expiry | Trivial | Wrong with more than one API instance or a restart — not a real guarantee |

`POST /users` and the invitation call Cognito **before** the transaction (archived DD-7), so every option reserves the key first, in its own short write, and then completes it with the response.

## Recommended Approach

**Option A**, the smallest *safe* path. It is the only one where the "already done" record commits together with the change. It reuses the unit of work, the lock order (DD-14) and the human-applied migration process the core spec established. Admin writes are low-volume, so a MySQL table with a 24 h retention and lazy cleanup is enough.

Build it as a NestJS interceptor in `common/` that reads the header, hashes method + path + body, and delegates storage to a port, so later modules opt in with one decorator. Users-admin writes opt in now.

`PUT /users/:id` goes in the **same spec**: the front will call it with a key, it shares the same transaction plumbing, and it is the main way the screen will save.

## Risks, Dependencies, And Open Questions

| # | Item | Type |
|---|---|---|
| R1 | Migration `0002` on the shared `qadb` — must be applied by a human (as `0001`); this branch will not run against `qadb` without it | Risk / dependency |
| R2 | The key must be scoped per admin (actor id) so two admins never collide or read each other's stored answers | Risk (security) |
| R3 | Stored responses contain `UserDetail` (emails, names) — retention must be short and the table never logged | Risk (privacy, NFR-2) |
| R4 | `POST /users` and resend do Cognito work before the transaction: a crash after Cognito but before completion leaves the key `in_progress` → define expiry of stuck reservations | Risk |
| Q1 | Retention window: 24 h? (the front replays every 60 s while online) | Open — specify |
| Q2 | Replay failed 4xx answers, or free the key? | Open — specify |
| Q3 | Header required on users-admin writes, or optional? (proposal: optional) | Open — back lead |
| Q4 | Does `PUT /users/:id` also cover `invitation` resend or activation status? (proposal: no — keep those as actions) | Open — back lead |
| Q5 | Jira ticket for this change (sub-task of P2-3908, or new) | Open — back lead |
| D1 | Front contract note addendum and a message to the front lead when it ships | Dependency |

No Active Lessons digest exists yet (`docs/specs/kaizen-log.md` absent). Pending standardizations from the core spec apply in spirit: include `tsc -p tsconfig.json` in verification (KZ-auth--user-management--core-1) and derive the test budget from the defect-class gates (KZ-auth--user-management--core-2).

## Success Criteria

- The front can replay any users-admin write with the same key and always receive the first answer; no duplicate user, audit row or email is ever produced by a replay (proven by e2e and concurrency tests).
- Key reuse with a different body and a concurrent repeat are refused with documented codes.
- `PUT /users/:id` saves a full edit atomically; a refusal at any step leaves the person unchanged.
- No regression in the existing 1,016 unit / 414 e2e tests; OpenAPI documents the header and the new codes.

## Next Step

```text
/akili-specify changes/users-admin-write-safety
```
