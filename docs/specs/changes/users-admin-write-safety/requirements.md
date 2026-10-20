# Users admin write safety — Requirements

## 1. Document Control

| | |
|---|---|
| Spec path | `docs/specs/changes/users-admin-write-safety` |
| Type | Change |
| Depth | Full (API contract, new persisted data, migration, concurrency) |
| Approval Mode | gated |
| Status | Approved (back lead, 2026-10-20) |
| Source | `proposal.md` (2026-10-20); front lead request (Slack DM 2026-10-20) |
| Builds on | `docs/specs/archive/2026-10-19-auth--user-management--core/` (cited below as *core*) |
| Jira | none yet (story P2-3908 is the parent context) |
| Scope | Server only (`server/`) |
| Last updated | 2026-10-20 |

**Decisions taken at specify (Leader defaults from the proposal; the back lead may overrule at this gate):**

| # | Decision |
|---|---|
| D1 | The `Idempotency-Key` header is **optional**; a write without it behaves exactly as today (proposal Q3) |
| D2 | Retention of a remembered answer: **24 hours** (proposal Q1) |
| D3 | A deterministic refusal (4xx) is remembered and replayed like a success; a server-side failure (5xx, including 503 from an upstream) is **not** remembered — the key is freed so a retry runs again (proposal Q2) |
| D4 | `PUT /users/:id` covers nickname, names, roles, program scope and the **manual** exclusions; invitation resend, activation and the dismissal of `reporting` exclusions stay separate actions (proposal Q4) |

## 2. Executive Summary

The front already sends an `Idempotency-Key` on every write and replays writes that time out; the server ignores the key, so a replay can answer 409 for an action that succeeded or send a second invitation email. This spec makes every users-admin write run **at most once per key**: a repeat returns the first answer and does nothing. It also adds `PUT /users/:id`, which saves a whole person in **one** transaction instead of up to five separate calls.

## 3. Glossary

| Term | Meaning |
|---|---|
| Idempotency key | The value of the `Idempotency-Key` request header, chosen by the client per user action and reused on every retry of that action |
| Request fingerprint | Method + route path (with ids) + the request body in canonical form; two requests with the same fingerprint are "the same request" |
| Remembered answer | The status code and response body of the first completed execution for a key |
| In flight | A key whose first execution has started and not yet completed |
| Retention window | How long a remembered answer is kept (D2) |
| Aggregate edit | `PUT /users/:id` — the full editable state of one person in one call |
| Desired manual exclusions | In an aggregate edit, the complete list of **manual** exclusions the person must have after the call |

## 4. System Context & Scope

**In scope:** idempotent handling of every users-admin write route (core design § 6: `POST /users`, `PATCH /users/:id`, `PUT /users/:id/roles`, `PUT /users/:id/programs`, `POST /users/:id/exclusions`, `DELETE /users/:id/exclusions/:exclusionId`, `POST /users/:id/exclusions/:exclusionId/dismiss`, `POST /users/:id/deactivate`, `POST /users/:id/activate`, `POST /users/:id/invitation`) and of the new `PUT /users/:id`; the aggregate edit; OpenAPI, module guides and the front contract addendum.

**Out of scope:** auth routes (login, refresh, logout, callback); read routes; changing the front's retry policy; removing the separate routes; dismissing `reporting` exclusions through the aggregate edit; reducing cold-cache create latency.

**Current behavior:**

| # | Today | Evidence |
|---|---|---|
| C1 | The front adds `Idempotency-Key` (a UUID, or `<ms>-<base36>` when `crypto.randomUUID` is unavailable) to every write and keeps the same key on replays | `client/src/app/core/http/request-safety.interceptor.ts:29,56-57`; `client/src/app/core/http/unsent-queue.ts:10,266-268` |
| C2 | The front replays a write that got no answer, a timeout (20 s) or 502/503/504, every 60 s | `client/src/app/core/http/unsent-queue.ts:13,35-37`; `client/src/app/core/http/request-context.ts:7` |
| C3 | The server never reads the header | `git grep -n -i idempotency -- server` → no match (`staging-center` @ `21ca0ca`) |
| C4 | Replaying `POST /users` answers 409 `USERS_EMAIL_TAKEN`; replaying the exclusion routes answers 409/404; replaying `POST /users/:id/invitation` sends another Cognito email; `PATCH`, `PUT roles/programs`, `deactivate` and `activate` replays change nothing | `server/src/users/users-admin.service.ts` (uniqueness pre-check, exclusion lifecycle, `resendInvitation`, no-op rules — core T-6, DD-15) |
| C5 | A cold-cache create can take ~30 s (two catalog reads of up to 10 s each, then one 10 s Cognito budget) | core `requirements.md` NFR-3 |
| C6 | Editing one person takes up to five calls, each in its own transaction | core `design.md` § 6 |

## 5. Stakeholders / Personas

| Role | Needs |
|---|---|
| QA Admin (through the Assessors screen) | A save that is never applied twice and never half-applied |
| Front lead | A server that honors the key the front already sends; one call to save a person |
| Back lead | Exactly-once guarantees provable by tests; no new operational burden |

## 6. Functional Requirements

### FR-1: The key is optional

A users-admin write without an `Idempotency-Key` header SHALL behave exactly as before this change.

#### Scenario: No header
- GIVEN a valid admin write without the header
- WHEN it is sent twice
- THEN each request executes as it does today (core behavior, C4)
- BUT nothing about it may be remembered

### FR-2: First execution with a key

A users-admin write carrying a valid key SHALL execute normally and remember its answer for the retention window.

#### Scenario: Remembered success
- GIVEN an admin and a key never used by that admin
- WHEN the write completes with a 2xx
- THEN the client gets the normal answer
- AND the status and the `data` (or error code and field errors) are remembered under (admin, key) with the request fingerprint
- AND IT MUST mark the key as executed in the same commit as the change — a change can never exist without that mark, nor the mark without the change
- AND the answer is stored right after the commit; if the process stops between the two, a replay returns the same status with the person's current detail and still does not execute again (the answer is read after the commit today — core T-8)

#### Scenario: Remembered refusal (D3)
- WHEN the write ends in a 4xx (validation, 404, 409)
- THEN the refusal is remembered and the change is not made

#### Scenario: Not remembered on a server failure (D3)
- WHEN the write ends in a 5xx or 503 (including an upstream timeout)
- THEN nothing is remembered and the key is free for a retry

### FR-3: Replay returns the first answer

A repeat of a remembered key with the same fingerprint, by the same admin, within the retention window, SHALL return the remembered status and the same `data` (or the same `error` code and field errors) and SHALL NOT execute again. The envelope's `meta` (request id, timestamp) belongs to each request and is new on a replay.

#### Scenario: Replayed create
- GIVEN `POST /users` completed with 201 under key K
- WHEN the same request is sent again with K
- THEN the answer is the same 201 with the same `data`
- AND it carries a header marking it as replayed (`Idempotency-Replayed: true`)
- BUT it must NOT create a user, call Cognito, write an audit row, invalidate the cache or write a decision line other than the replay line

#### Scenario: Replayed invitation
- GIVEN `POST /users/:id/invitation` completed under key K
- WHEN it is sent again with K
- THEN the first answer is returned
- BUT it must NOT send another email

#### Scenario: Replayed refusal
- GIVEN a write was refused with 409 under key K
- WHEN it is replayed with K
- THEN the same 409 with the same error code is returned, even if the data has changed since

### FR-4: Key reused for a different request

The same admin sending the same key with a different fingerprint SHALL be refused with 422 `IDEMPOTENCY_KEY_REUSED`, and nothing SHALL execute.

### FR-5: Concurrent repeat

A request whose key is in flight for the same admin SHALL be refused with 409 `IDEMPOTENCY_IN_PROGRESS`, and SHALL NOT execute.

#### Scenario: Two identical requests at once
- GIVEN two requests with the same key from the same admin arrive together
- THEN exactly one executes
- AND the other answers 409 `IDEMPOTENCY_IN_PROGRESS`
- AND IT MUST hold on any number of API instances

#### Scenario: Abandoned in-flight key
- GIVEN a key stayed in flight because its process died
- WHEN a request with that key arrives after the in-flight lease has expired
- THEN it executes as a first execution
- AND IT MUST NOT expire while a request can still legitimately be running (longer than the slowest write, C5)

### FR-6: Keys are per admin and validated

Keys SHALL be scoped to the authenticated admin, and SHALL be validated.

#### Scenario: Another admin, same key
- WHEN a different admin sends a key another admin used
- THEN it is treated as a new key
- BUT it must NOT return or reveal the other admin's remembered answer

#### Scenario: Malformed key
- WHEN the header is empty, longer than 128 characters, or contains characters outside letters, digits, `-`, `_`, `.`, `:`
- THEN 400 `VALIDATION_FAILED` with field `Idempotency-Key`, and nothing executes

#### Scenario: Refused before reaching the write
- WHEN the request is refused by authentication (401) or permission (403)
- THEN nothing is remembered under the key

### FR-7: Retention

A remembered answer SHALL be honored for the retention window (D2) and SHALL be removed after it; after removal the key behaves as new.

### FR-8: Aggregate edit

`PUT /users/:id` SHALL apply the editable state of one person — `nickname`, `firstName`, `lastName` (each optional), `roles`, `programs` and the desired manual `exclusions` — in one transaction, and SHALL return the resulting `UserDetail`.

#### Scenario: Full save
- GIVEN an existing user
- WHEN the admin sends the full state
- THEN every change is applied together and the answer is the new `UserDetail`
- AND roles follow the replace rules of core FR-3 (unchanged grants keep their id; revoke before insert)
- AND program scope follows core FR-4 (`'all'` or a non-empty list)
- AND manual exclusions are reconciled to the desired list: missing ones are added with their reason, ones absent from the list are removed, existing ones are kept unchanged

#### Scenario: All or nothing
- WHEN any part is refused (validation, `USERS_NICKNAME_TAKEN`, `USERS_NAME_LOCKED`, `USERS_ROLE_CONFLICT`, `USERS_LAST_ADMIN`, unknown result type or program, 503 from a catalog)
- THEN the refusal is returned with its code
- BUT nothing may change — no partial edit, no audit row, no cache invalidation

#### Scenario: Same rules as the separate routes
- AND IT MUST enforce every rule the separate routes enforce (core FR-3, FR-4, FR-5, FR-7, DD-12, DD-13, DD-15)
- AND IT MUST write the same audit rows the separate routes would write for the same changes (core DD-15), and none for parts that did not change

#### Scenario: No change
- WHEN the sent state equals the current state
- THEN 200 with the `UserDetail`, no audit row and no invalidation

#### Scenario: Out of reach of the aggregate edit (D4)
- AND IT MUST leave `reporting` exclusions, activation status, invitation state and email untouched
- BUT a body naming a field the route does not accept is refused with `UNKNOWN_FIELD`

#### Scenario: Unknown user
- THEN 404 `USERS_NOT_FOUND`

### FR-9: Remembered answers stay private

Remembered answers SHALL NOT appear in logs, error bodies or any other admin's responses, and SHALL be deleted after the retention window.

### FR-10: Contract documentation

OpenAPI SHALL document the optional `Idempotency-Key` header on every users-admin write, the replay marker header, the new error codes, and `PUT /users/:id` with its request, answer and error codes.

## 7. Non-Functional Requirements

| ID | Attribute | Scenario | Measure | TRD |
|---|---|---|---|---|
| NFR-1 | Integrity | Concurrent identical requests, any number of instances | At most one execution per (admin, key); proven by a concurrency test with a lock-emulating fake | TRD § 5.1 |
| NFR-2 | Security / privacy | Logs and errors for keyed writes | No remembered body, request body, email or name in any log line; decision lines carry ids and the idempotency outcome only | QAS-OBS-1 |
| NFR-3 | Performance | Keyed write vs unkeyed write, warm | Added overhead p95 ≤ 20 ms; replay answered without touching catalogs or Cognito | QAS-PERF-1 |
| NFR-4 | Availability | Storage for keys unavailable | The write answers 503 rather than running without the guarantee | QAS-AVL-1 |
| NFR-5 | Operability | Data growth | Remembered answers older than the retention window are removed without manual action | — |

### Defect classes and their gates

| Defect class | Gate | Substitute / accepted risk |
|---|---|---|
| A replay re-executes (duplicate user, email, audit row) | e2e per write route: same key twice → one side effect; service/unit with Cognito and audit spies | — |
| Answer remembered without its change, or change without its answer | Unit test of the unit of work: failure after the change rolls back both; SQL asserted in one transaction | Real MySQL atomicity: HITL on `qadb` |
| Concurrent repeat runs twice | Unit test with the lock-emulating fake (core T-4 pattern) | **Real MySQL locking unverified** — HITL on `qadb` |
| Key reuse with a different body accepted | Unit tests over fingerprint canonicalization (key order, whitespace, ids in path) | — |
| Cross-admin leak | e2e: admin B with admin A's key gets a fresh execution and never A's body | — |
| Stuck in-flight key never released | Unit test with a fake clock over the lease | — |
| Aggregate edit partially applied | Unit tests: a refusal at each step leaves no change, no audit, no invalidation | — |
| Aggregate edit diverges from the separate routes | Table test: same input through the aggregate and through the separate routes yields the same final state and the same audit rows | — |
| Remembered body in logs | e2e log spy over keyed writes (core T-9 pattern) | — |
| Migration defect on shared `qadb` | Generated SQL review + `schema.spec` | Applied by a human at the HITL step |
| Compiler-only / spec type errors | `pnpm build` + `npx tsc --noEmit -p tsconfig.json` (baseline: 7 pre-existing errors) — KZ-auth--user-management--core-1 | — |
| Contract mismatch with the front | OpenAPI e2e (header, codes, new route) + contract addendum reviewed with the front lead | Front integration is theirs |

## 8. Requirement ID Index

| ID | Title | Scenarios |
|---|---|---|
| FR-1 | The key is optional | 1 |
| FR-2 | First execution with a key | 3 |
| FR-3 | Replay returns the first answer | 3 |
| FR-4 | Key reused for a different request | — |
| FR-5 | Concurrent repeat | 2 |
| FR-6 | Keys are per admin and validated | 3 |
| FR-7 | Retention | — |
| FR-8 | Aggregate edit | 6 |
| FR-9 | Remembered answers stay private | — |
| FR-10 | Contract documentation | — |
| NFR-1…NFR-5 | See § 7 | — |
