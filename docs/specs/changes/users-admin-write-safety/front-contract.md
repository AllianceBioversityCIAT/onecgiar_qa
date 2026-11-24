# Users admin write safety — contract addendum for the front

Addendum to the archived `docs/specs/archive/2026-10-19-auth--user-management--core/front-contract.md` (spec `changes/users-admin-write-safety`, `design.md` § 8). Server only; every route still needs an **ADMIN** Bearer token and answers the standard envelope. Live shapes: Swagger UI (`/api/v1/docs`).

## Quick path

1. Keep sending `Idempotency-Key` on every write and reuse the **same** key on every retry of one action (the front already does, `request-safety.interceptor.ts`).
2. A repeat of a finished action now returns the **first answer** with `Idempotency-Replayed: true`; the server did not run it again. Treat it as success.
3. Change the unsent queue so **409 `IDEMPOTENCY_IN_PROGRESS` is retried later with the same key** (below). Everything else about 409 stays as it is.
4. Optional: replace the five-call "save person" with `PUT /users/:id`.

## What the server now does

| Topic | Contract |
|---|---|
| Header honored | `Idempotency-Key` (1-128 chars: letters, digits, `-`, `_`, `.`, `:`; case-sensitive) on all 11 write routes: `POST /users`, `PATCH /users/:id`, `PUT /users/:id`, `PUT /users/:id/roles`, `PUT /users/:id/programs`, `POST /users/:id/exclusions`, `DELETE /users/:id/exclusions/:exclusionId`, `POST /users/:id/exclusions/:exclusionId/dismiss`, `POST /users/:id/deactivate`, `POST /users/:id/activate`, `POST /users/:id/invitation`. Without the header nothing changes. A malformed key is 400 `VALIDATION_FAILED` on field `Idempotency-Key`. Scope: one key per admin; another admin's identical key is a different key. Remembered 24 hours |
| Replay marker | A replayed answer carries the response header `Idempotency-Replayed: true`. Success: same status and `data` as the first answer (`meta` is the new request's). **A replayed refusal carries the marker too** (same status and `error` as the first one), although OpenAPI documents the header on 2xx only. A crash between commit and answer replays the route's status with a fresh `UserDetail` |
| What is remembered | Success (2xx) and deterministic refusals (400 validation, 404, 409 domain codes). **Not** remembered: 5xx, 503, anything unexpected: the key is freed and a retry runs again |
| `PUT /users/:id` | One transaction replaces nickname/names (optional), `roles`, `programs` and `exclusions` (`[{ programId, reason }]`, the desired **manual** set). All or nothing: any refusal changes nothing. Answers 200 `UserDetail`. Rules: `programs: []` is 400 (use `'all'` as everywhere); a program listed twice in `exclusions` is 400 on `exclusions[i].programId`; an existing manual exclusion keeps its original reason; manual exclusions not listed are removed; a program with an active `reporting` exclusion is 409 `USERS_EXCLUSION_EXISTS`; `reporting` exclusions are never removed. Other 409s: `USERS_NICKNAME_TAKEN`, `USERS_NAME_LOCKED`, `USERS_ROLE_CONFLICT`, `USERS_LAST_ADMIN` |

## New error codes (keyed writes)

| Status | Code | Meaning | What the front does |
|---|---|---|---|
| 409 | `IDEMPOTENCY_IN_PROGRESS` | The same key is still being processed (or a dead request is within its 2-minute lease) | **Transient.** Retry later with the **same key**, like a 503. Do not mark it rejected |
| 422 | `IDEMPOTENCY_KEY_REUSED` | The key was already used for a **different** request (other path or body) | A client bug: never retry; start the action again with a **new** key. Safe to mark as rejected |
| 503 | `SERVICE_UNAVAILABLE` | The key store is down; the change did not run | Retry with the same key (already handled) |

## Front code to change (P-10)

- `client/src/app/core/http/unsent-queue.ts:208-217` (read-only reference, not edited here): only 0/502/503/504, 429 and signed-in 401 are retried; any other status, **including every 409**, is marked `rejected`. Add: a 409 whose `error.code` is `IDEMPOTENCY_IN_PROGRESS` is transient, like 503. A 409 with any other code (`USERS_NICKNAME_TAKEN`, ...) stays a permanent "no".
- `request-safety.interceptor.ts` keeps reusing one key per queued action: nothing to change there.

## Open item

**P-14 (open):** the front lead has not yet confirmed that 409 `IDEMPOTENCY_IN_PROGRESS` can be treated as transient. If not, DD-4 switches the in-flight answer to 503 (a one-line server change; the front would then retry it as it does today). Needs the front lead's answer; record it in `execution.md`.
