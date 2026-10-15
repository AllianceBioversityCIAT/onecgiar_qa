# Cognito-native authentication and session — Proposal

## 1. Document Control

| | |
|---|---|
| Spec path | `docs/specs/auth/cognito-native-session` |
| Slug | `cognito-native-session` — derived from the free-text argument "Autenticación nativa con Cognito para el nuevo QA (usuarios, roles, login, sesión)" |
| Type | Change |
| Jira | P2-3954 (epic P2-3902) — commits use `<emoji> <type>(auth) P2-3954: …` |
| Approval Mode | gated |
| Depends on | none (first spec; `server/` has the Drizzle and DynamoDB foundations) |
| Parallel-safe | no — creates the shared users/roles schema and the global guard every later spec uses |
| PRD | US-3 (roles, scoped), Auth acceptance criterion, problem P4, constraint "QA never stores the client secret" |
| TRD | ADR-003, § 10 Security & Authorization Model, QAS-SEC-1/2/3 |
| Branch | `feat/auth-cognito-session` (from `staging` @ `607dc0b`) |
| Date | 2026-10-13 |

## 2. Intent

Make the QA session 100 % Cognito: QA verifies Cognito access tokens on every request and never signs tokens of its own, and QA owns **authorization** — who is a QA user and what each role may do — because the shared PRMS user pool only proves identity.

## 3. Problem / Current Behavior

| # | Today (old QA, `CGIAR/QA` @ `8c2081d1`) | Evidence |
|---|---|---|
| 1 | After authenticating through the auth microservice, QA signs its own JWT | `server/src/api/users/users.repository.ts:129` and `server/src/api/auth/auth.service.ts:470` (`jwt.sign(…, config.jwtSecret, …)`) |
| 2 | The signing secret is a constant in code | `server/src/config/const.config.ts:4` (`jwtSecret:` literal; value not reproduced here) |
| 3 | That JWT is not verified by the back | `grep -rnE "jwt\.verify\|JwtAuthGuard\|AuthGuard\('jwt'\)" server/src --include='*.ts'` → 0 hits; the only guard found is `server/src/shared/guards/role.guard.ts:21` — what it checks is `UNVERIFIED — confirm at source before relying on it` |
| 4 | New QA (`server/`) has no auth at all: every route is public | `server/src/app.module.ts` imports only Config, Drizzle and DynamoDB modules (this repo @ `607dc0b`) |

The Cognito user pool is shared by every PRMS application and federated with the CGIAR directory, so "can authenticate" ≠ "is a QA user" (stated by the back lead, 2026-10-13 — `UNVERIFIED` until the pool configuration is confirmed by infrastructure).

## 4. Proposed Outcome

- Users log in (custom user/password or CGIAR directory SSO) through QA's API, which delegates to the auth microservice; QA never sees the client secret.
- Every API request is authenticated by local verification of the Cognito access token, then authorized against QA's own users, roles and scoped assignments.
- SSO users are admitted as GUEST on first login; custom users only when an admin registered them and gave them a role.
- The session survives a page reload through a refresh cookie the browser's JavaScript cannot read.

## 5. Scope

Backend only (`server/`). Delivered as one spec in three slices, built in order:

| Slice | Delivers |
|---|---|
| **S1 Data model** | Drizzle tables `users`, `roles`, `role_assignments`; migrations; seed of the six roles; seed of the first ADMIN by email from env (`SEED_ADMIN_EMAIL`); permission catalog in code and `can(user, permission, { resultType?, programId? })` |
| **S2 Login API** | `POST /auth/login`, `POST /auth/complete-new-password`, `GET /auth/provider-url`, `POST /auth/callback`; one user-resolution routine shared by all flows (steps 1–7 of the request); response = access token + `expiresIn` + profile with assignments in the body, refresh token only in the cookie; no cookie on 403 |
| **S3 Session** | Global guard (`aws-jwt-verify`; `@Public()` opt-out); user + active assignments loaded per request with a short cache; permission decorator with scope check; GUEST limited to routes marked read; `POST /auth/refresh`, `POST /auth/logout` (Origin-checked); `GET /auth/me`; CORS with credentials and explicit origins |

Decided rules carried into requirements unchanged: SSO detection by the `identities` claim of the id token; link by `sub`; pre-registration by email with `sub` linked on first login; 409 when the email belongs to another `sub`; LEAD_ASSESSOR implies ASSESSOR for the same result type; permissions are the union of active assignments; revoking = deactivating with `revoked_at` / `revoked_by`.

New env vars: `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `MS_AUTH_URL`, `MS_AUTH_USER`, `MS_AUTH_PASSWORD`, `ALLOWED_ORIGINS`, plus `SEED_ADMIN_EMAIL` (added by this proposal for the ADMIN seed).

## 6. Non-Goals

- Password reset for custom users.
- Admin module for users and role assignments, including creating custom users in Cognito (`/auth/register`).
- Defining what a GUEST may read (this spec only provides the "read route" marker).
- Revoking the refresh token in Cognito on logout.
- SSR rendering of session data (SSR renders public content only).
- Front-end screens (the login screen on `feat/auth-login` is wired in a later front spec).

## 7. Affected Users, Systems, and Specs

| Affected | How |
|---|---|
| All roles (PRD § 3) | Every request now requires a verified token and an authorization decision |
| `server/src/database/drizzle/schema/` | First tables (shared boundary — serial) |
| `server/src/config/` | New env validation for auth variables (shared boundary — serial) |
| `server/src/main.ts`, `app.module.ts` | Global prefix, global guard, CORS, cookie parsing |
| Auth microservice (`one-cgiar-microservices/auth-microservice`) | Consumed; **may need a change** for refresh (Risk R1) |
| `docs/trd/trd.md` § 5.1 | Table names change from `role_grants` to `roles` + `role_assignments`; recorded as a pending TRD update applied on `staging` (shared-file write discipline) |
| Every later spec | Uses the guard, `@Public()`, the read marker and `can()` |

## 8. Visual Reference

- Source: None
- Notes: backend-only change. The existing login mockup (branch `feat/auth-login`) is consumed by a later front spec.

## 9. Requirement Delta Preview

### ADDED

- Users, roles and scoped role assignments with audit fields; role and first-ADMIN seeds.
- Login flows (custom, new-password challenge, SSO provider URL, SSO callback) delegated to the microservice.
- Access rules at login: SSO unknown → GUEST created; custom unknown → 403, nothing created; inactive → 403; custom without active assignments → 403; email bound to another `sub` → 409.
- Per-request verification (signature via JWKS, `exp`, `token_use = access`, `client_id`) → 401 on any failure; unknown/inactive/custom-without-roles user → 401.
- Authorization: permission decorator, scope check through `can()`, GUEST only on read routes.
- Refresh (Origin-checked, re-applies access rules, rotates the cookie when Cognito rotates), logout (Origin-checked, clears the cookie), `/auth/me`.

### MODIFIED

- All existing routes become authenticated by default (today only `GET /` exists; it becomes `@Public()` or moves to a health route).

### REMOVED

- None in this repo. (The old QA's self-signed JWT is not ported.)

## 10. Approach Options

### For the refresh flow (the one open design choice — see R1)

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. Microservice accepts `username` on refresh** | QA stores the Cognito `username` in a second httpOnly cookie (same attributes and Path as the refresh cookie) and sends `{ refreshToken, username }`; the microservice uses it for `SECRET_HASH` when no valid access token is given | Works after reload and after long idle; keeps "token only in memory"; Cognito still validates refresh token + hash | Needs a small, backward-compatible change in a shared microservice (another team's review) |
| B. Keep the last access token in an httpOnly cookie | QA sends the (possibly expired) token to the microservice | No microservice change | Does **not** work: the microservice calls Cognito `/oauth2/userInfo`, which rejects an expired token (R1) |
| C. Keep the access token in `sessionStorage` | Front sends it with the refresh call | No microservice change | Breaks the decided "access token only in memory"; still fails once the token expires (idle > token lifetime) |

### For per-request user loading

| Option | Pros | Cons |
|---|---|---|
| **A. In-process cache, short TTL (e.g. 30–60 s), invalidated on assignment change in the same process** | Simple, no infra | With several API processes (PM2 cluster, several containers) another process keeps a stale entry until TTL |
| B. No cache | Always fresh | One MySQL read per request (cheap with indexes, but avoidable) |
| C. Shared cache (Redis) | Cross-process invalidation | New infrastructure, not justified by any TRD scenario (LITE tier) |

## 11. Recommended Approach

- **Refresh: Option A**, contingent on the microservice change being accepted. If it is not accepted in time, ship S1–S2 and the guard first and keep refresh behind the microservice change — do **not** fall back to B or C, because B fails and C violates a decided rule.
- **User loading: Option A** with the TTL as the documented upper bound of staleness, so "admin revokes the last role → next refresh fails" is guaranteed by refresh re-applying the rules against the DB (not the cache), and per-request staleness is bounded by the TTL.
- **Cookie Path:** a cookie has one `Path`, so the refresh and logout routes share a prefix: `/api/v1/auth/session/refresh` and `/api/v1/auth/session/logout`, cookie `Path=/api/v1/auth/session`. (The request listed `/auth/refresh` and `/auth/logout`; this keeps their intent with a single Path.)
- Everything else as decided in the request.

## 12. Risks, Dependencies, and Open Questions

| ID | Risk / question | Evidence | Impact | Owner |
|---|---|---|---|---|
| **R1** | **Refresh after reload fails as the microservice is today.** `refreshAuthenticationTokens` first calls `getUserInfo(data?.accessToken)` (`auth-microservice/src/api/auth/auth.service.ts:597`), which calls Cognito `/oauth2/userInfo` with that token (`:242-262`) and throws 401 on failure; the username is needed for `SECRET_HASH` (`src/api/auth/services/cognito/cognito.service.ts:362-376`). After a reload the front has **no** access token at all (it lives in memory), and after idle it is expired — so refresh cannot work without Option A | Code as read @ `bf29541f`. Runtime behavior with an expired token is `UNVERIFIED` until tested | High | Back lead + microservice owners |
| R2 | The microservice swallows non-HTTP errors on refresh: the `catch` only rethrows when `error.response` exists (`auth.service.ts:616-625`), otherwise the method returns `undefined` (empty 2xx). QA must treat an empty refresh response as 401 | Code as read @ `bf29541f` | Low | Back lead (handled in QA) |
| R3 | `COGNITO_CLIENT_ID` must be QA's app client in CLARISA (`mis_auth`); the microservice takes client id/secret from the caller's CLARISA metadata (`auth.service.ts:72`, `:597-603`) | Variable present in `server/.env` (name only checked, 2026-10-13); that it equals the `mis_auth` client is `UNVERIFIED` — user-stated (back lead, 2026-10-13); settled by the first real login passing the `client_id` check | High | Back lead |
| R4 | Identity provider is `CGIAR-AzureAD` (matches the microservice example at `src/shared/swagger/responses-swagger.ts:10`). That federated users' id tokens carry the `identities` claim is still unconfirmed | Provider: `UNVERIFIED` — user-stated (back lead, 2026-10-13). `identities` claim: `UNVERIFIED`; settled by decoding one real SSO id token in TEST | High (SSO vs custom classification) | Back lead |
| R5 | The microservice's provider-login route is `POST /auth/login/provider` (`auth.controller.ts:41`), not GET; QA's own `GET /auth/provider-url` calls it with POST | Code as read | Low | Back lead |
| R6 | Id tokens are returned by custom login (`auth.service.ts:192`), code validation (`:142`), new-password completion (`:226`) and refresh (`:610`) — so `identities` can be read in every flow | Code as read | — (confirms the design) | — |
| R7 | One email with two `sub`s (a person with both a custom and a federated identity in the shared pool) gets 409 and cannot log in | Decided behavior; frequency `UNVERIFIED` | Low | Business owner |
| R8 | Calls to the microservice authenticate with a JSON `auth` header `{ username, password }` validated against CLARISA (`src/middleware/jwt-clarisa.middleware.ts:23-46`) — `MS_AUTH_USER` / `MS_AUTH_PASSWORD` are those credentials and are secrets in TEST/PROD | Code as read | Low | Infrastructure (secrets store) |
| R9 | `SameSite=Lax` lets any `*.cgiar.org` page send the refresh cookie; the Origin check on refresh/logout and CORS (no readable response for other origins) are the controls | Design reasoning | Low | Covered by acceptance criteria |
| Q1 | ~~Global prefix~~ **Resolved (back lead, 2026-10-13):** `/api/v1` — all routes in this spec live under it | — | — | — |
| Q2 | **Decided (back lead, 2026-10-13): the longest Cognito allows** — 1 day is Cognito's maximum for access tokens (`UNVERIFIED` against the current AWS docs and QA's app client settings). Trade-off accepted: a leaked access token stays valid until it expires; role and user changes still apply within the cache TTL, because the guard reloads the user on every request | App client setting `UNVERIFIED` | Low | Infrastructure (app client config) |

## 13. Success Criteria

The request's acceptance criteria, unchanged, become the requirement scenarios:

- SSO unknown user logs in → created as GUEST; read routes allowed, action routes 403.
- SSO user pre-registered by email → enters with roles; `sub` linked.
- Custom unknown → 403, no user row created. Custom registered without active roles → 403.
- Custom registered with a role → completes the new-password challenge on first login and gets a session.
- ASSESSOR of KP + LEAD_ASSESSOR of Innovation Development → lead permissions only on Innovation Development results.
- PROGRAM acts only on its program's results.
- Admin revokes a custom user's last role → the next refresh fails.
- No token / expired / bad signature / another app's `client_id` → 401.
- Refresh token never in a response body nor readable by JavaScript.
- Expired (or absent, after reload) access token → `POST /auth/session/refresh` returns a new one (**requires R1 resolved**).
- Refresh from a disallowed Origin → 403.
- QA signs no tokens and stores no client secret.

## 14. Next Step

```text
/akili-specify auth/cognito-native-session
```
