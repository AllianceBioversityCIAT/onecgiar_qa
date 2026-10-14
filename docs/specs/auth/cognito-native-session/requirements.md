# Cognito-native authentication and session — Requirements

## 1. Document Control

| | |
|---|---|
| Spec path | `docs/specs/auth/cognito-native-session` |
| Depth | Full (auth, data model, API) |
| Type | Change |
| Jira | P2-3954 (epic P2-3902) — commits use `<emoji> <type>(auth) P2-3954: …` |
| Approval Mode | gated |
| Source | `proposal.md` (same folder), with the back lead's answers of 2026-10-13 |
| PRD | US-3, § 7 Auth criterion, P4, § 8 constraints |
| TRD | ADR-003, § 6, § 10, QAS-SEC-1/2/3 |
| Status | Draft |
| Last updated | 2026-10-13 |

## 2. Executive Summary

QA stops trusting anything but Cognito for identity and starts owning authorization. Users log in through QA's API (custom or CGIAR-AzureAD SSO), which delegates to the CGIAR auth microservice; every request carries a Cognito access token that QA verifies locally; QA decides admission (SSO → GUEST on first login, custom → only if pre-registered with a role) and permissions (roles scoped globally, per result type, or per program). The session survives reloads through an httpOnly refresh cookie. QA signs no tokens and never holds the Cognito client secret.

## 3. Glossary

| Term | Meaning |
|---|---|
| Access token | Cognito access token (JWT). Sent as `Authorization: Bearer`. Lives only in front memory |
| Id token | Cognito id token; read at login/refresh to learn identity attributes (`sub`, `email`, names, `identities`). Never returned to the client by QA |
| Refresh token | Cognito refresh token. Only ever in the refresh cookie |
| SSO user | User whose id token carries `identities` as a non-empty array (federated with `CGIAR-AzureAD`) |
| Custom user | Any other id token: `identities` absent, empty, or not an array (Cognito user/password) |
| Registered user | A row in QA's `users` |
| Pre-registered user | Registered by an admin by email, `sub` still empty |
| Assignment | A user's role, with its scope (global, a result type key, or a program id), active or revoked |
| GUEST | A registered user with no active assignments; read-only |
| Read route | A route explicitly marked as readable by GUEST |
| Allowed origin | An origin listed in `ALLOWED_ORIGINS` |
| Microservice | `one-cgiar-microservices/auth-microservice` |

## 4. System Context & Scope

**Current behavior (new QA):** `server/` exposes `GET /` with no authentication; `AppModule` imports only Config, Drizzle and DynamoDB modules (`server/src/app.module.ts`, this repo @ `607dc0b`). No users, roles or auth code exist.

**Current behavior (microservice @ `bf29541f`):** refresh requires a valid access token to look up the username for `SECRET_HASH` (`src/api/auth/auth.service.ts:597`, `:242-262`) — see FR-13 dependency.

**In scope:** data model and seeds; permission evaluation; login, new-password, SSO URL and SSO callback endpoints; per-request verification and authorization; refresh, logout, `me`; CORS and Origin checks; config validation. All routes under `/api/v1`.

**Out of scope:** password reset; admin module (user/assignment management, `/auth/register`); what GUEST may read; Cognito refresh-token revocation on logout; SSR with session data; front-end screens.

## 5. Stakeholders / Personas

| Role (PRD § 3) | Scope | Needs from this spec |
|---|---|---|
| ADMIN | Global | Exists from day one (seed); later grants roles |
| ASSESSOR / LEAD_ASSESSOR | Result type | Permissions only on their result types |
| TPB, PPU | Global | Permissions everywhere for their actions |
| PROGRAM | Program | Permissions only on their program |
| GUEST | — | Read routes only |
| Back lead | — | One guard and one `can()` every later module reuses |

## 6. Functional Requirements

### FR-1: Users, roles and assignments

The system SHALL store users, roles and role assignments so that each assignment's scope matches its role's scope type and revocations are traceable.

#### Scenario: Scoped assignment is accepted
- GIVEN the role ASSESSOR has scope type `result_type`
- WHEN an assignment of ASSESSOR with result type key `KP` is stored for a user
- THEN it is stored as active with `created_at` and `created_by`
- BUT it must NOT be accepted with a program id, or with no result type key
- AND IT MUST be rejected for a global role (ADMIN, TPB, PPU) that carries any scope value

#### Scenario: Duplicate active assignment
- GIVEN a user already has an active ASSESSOR assignment for `KP`
- WHEN the same assignment is stored again
- THEN it is rejected
- BUT a new active assignment MUST be accepted once the previous one was revoked

#### Scenario: Revocation keeps history
- WHEN an assignment is revoked
- THEN it becomes inactive with `revoked_at` and `revoked_by` set
- BUT it must NOT be deleted

#### Scenario: Unique identity
- AND IT MUST keep `email` unique and stored lowercase, and `cognito_sub` unique when present (empty allowed until first login)

### FR-2: Seeds

The system SHALL provide repeatable seeds for the six roles and for the first ADMIN.

#### Scenario: Roles seed
- WHEN the seed runs on an empty database
- THEN ADMIN, LEAD_ASSESSOR, ASSESSOR, TPB, PPU (global or result-type scoped as defined in FR-3) and PROGRAM exist with their scope types
- AND running it again changes nothing (idempotent)

#### Scenario: First ADMIN seed
- GIVEN `SEED_ADMIN_EMAIL` is set
- WHEN the seed runs
- THEN a pre-registered user with that email (lowercased, empty `sub`, `auth_source = sso` by default and corrected on first login per FR-8) has an active ADMIN assignment
- AND running it again does not duplicate the user or the assignment
- BUT it must NOT run when `SEED_ADMIN_EMAIL` is absent; it reports that and exits without changes

### FR-3: Permission evaluation

The system SHALL decide `can(user, permission, { resultType?, programId? })` from the user's active assignments only.

| Role | Scope type | Grants |
|---|---|---|
| ADMIN | global | Admin permissions |
| TPB | global | TPB permissions |
| PPU | global | PPU permissions |
| ASSESSOR | result_type | Assessor permissions for that result type |
| LEAD_ASSESSOR | result_type | Lead permissions **and** assessor permissions for that result type |
| PROGRAM | program | Program permissions for that program |
| (none) GUEST | — | No action permissions |

#### Scenario: Union of scoped roles
- GIVEN a user is ASSESSOR of `KP` and LEAD_ASSESSOR of `INNOVATION_DEV`
- WHEN lead permission is checked for `INNOVATION_DEV`
- THEN it is granted
- AND assessor permission is granted for both `KP` and `INNOVATION_DEV`
- BUT lead permission must NOT be granted for `KP`

#### Scenario: Program scope
- GIVEN a user is PROGRAM of program 12
- THEN program permission is granted for program 12
- BUT it must NOT be granted for program 13, nor when no program is given

#### Scenario: Scoped permission without context
- WHEN a result-type-scoped permission is checked without a result type
- THEN it is denied (fail closed)

#### Scenario: Revoked or inactive
- BUT a revoked assignment, or an assignment of an inactive role, must NOT grant anything

### FR-4: Custom login

`POST /api/v1/auth/login` with `{ email, password }` SHALL authenticate through the microservice.

#### Scenario: Valid credentials, admitted user
- GIVEN a custom user registered with an active assignment
- WHEN they log in with valid credentials
- THEN the response is FR-9's success shape and the refresh cookie is set

#### Scenario: First login challenge
- WHEN Cognito answers `NEW_PASSWORD_REQUIRED`
- THEN the response carries the challenge name and session, and no tokens
- AND IT MUST NOT set a cookie
- BUT the admission rules (FR-8) are not evaluated until the challenge completes (FR-5)

#### Scenario: Invalid credentials
- WHEN credentials are wrong
- THEN 401 with the standard error envelope
- BUT it must NOT reveal whether the email exists

#### Scenario: Validation
- AND IT MUST reject a missing or malformed email or an empty password with 400 before calling the microservice

#### Scenario: JSON only (login CSRF)
- WHEN a POST to any `/api/v1/auth/*` route has a parsed media type other than `application/json` (parameters such as `; charset=utf-8` allowed) — e.g. `application/x-www-form-urlencoded` or `text/plain` with a JSON-looking body
- THEN 415 with the error envelope, no `Set-Cookie`, and the microservice is not called
- AND the urlencoded and text body parsers are not applied to `/api/v1/auth/*` (amended 2026-10-14; applies equally to FR-5 and FR-7)
- BUT a POST with no body and no `Content-Type` (e.g. the session refresh/logout calls of T-9) is not rejected by this rule

### FR-5: Complete new password

`POST /api/v1/auth/complete-new-password` with `{ email, newPassword, session }` SHALL complete the challenge through the microservice and then apply FR-8 and FR-9.

#### Scenario: Completed and admitted
- THEN the response is FR-9's success shape with cookie

#### Scenario: Completed but not admitted
- GIVEN the custom user is not registered in QA, or has no active assignments
- THEN 403 and no cookie
- BUT the password change in Cognito is not rolled back (accepted; outside QA's control)

### FR-6: SSO provider URL

`GET /api/v1/auth/provider-url` SHALL return the Cognito authorize URL for the `CGIAR-AzureAD` provider, obtained from the microservice, for the redirect URI the front supplies.

#### Scenario: Redirect URI allow-list
- WHEN the requested redirect URI does not start with an allowed origin
- THEN 400
- AND IT MUST NOT call the microservice

### FR-7: SSO callback

`POST /api/v1/auth/callback` with `{ code, redirectUri }` SHALL exchange the code through the microservice and then apply FR-8 and FR-9.

#### Scenario: Invalid or reused code
- THEN 401, no cookie

### FR-8: User resolution and admission

On every token acquisition (FR-4, FR-5, FR-7) and on refresh (FR-13), the system SHALL resolve the QA user from the verified id token:

| Step | Rule | Outcome on failure |
|---|---|---|
| 1 | Verify the id token (signature, issuer, audience = QA client, expiry). `auth_source = sso` only if `identities` is a non-empty array; any other shape (absent, object, string, empty) is `custom` (amended 2026-10-13) | 401 |
| 2 | Find user by `sub`; else find by email with empty `sub` and link the `sub`. A **custom** token links by email only when `email_verified` is true (boolean `true` or string `"true"`); an **SSO** token (with `identities`) links without it, since the email comes from the CGIAR directory. The link is conditional (`cognito_sub IS NULL`); if another `sub` won it concurrently → step 3 | 403 (custom, email not verified — nothing linked or created) |
| 3 | A user with that email but another `sub` exists | 409 |
| 4 | No user: SSO → create (`auth_source = sso`, no assignments, `created_by` empty); custom → refuse, create nothing | 403 (custom) |
| 5 | User inactive | 403 |
| 6 | Custom user without active assignments | 403 |
| 7 | Update `last_login_at`; update names when they changed; update the email only for SSO, or for custom with `email_verified` true — otherwise keep the stored email (amended 2026-10-13) | — |

#### Scenario: SSO first login
- GIVEN no QA user for this `sub` or email
- WHEN an SSO user logs in
- THEN a user is created as GUEST and admitted

#### Scenario: Pre-registered SSO user
- GIVEN an admin pre-registered `ana@cgiar.org` with an ASSESSOR assignment and empty `sub`
- WHEN Ana logs in via SSO
- THEN her `sub` is linked and her assignments apply

#### Scenario: Custom not registered
- THEN 403
- BUT no user row must be created

#### Scenario: Email collision
- GIVEN a user with that email has another `sub`
- THEN 409 and nothing is linked or created

#### Scenario: Unverified email on a custom token
- GIVEN a pre-registered user with empty `sub`
- WHEN a custom user logs in with that email and `email_verified` is absent or false
- THEN 403
- BUT nothing is linked or created
- AND an SSO token with the same email links without `email_verified`

#### Scenario: Concurrent link of the same email
- GIVEN a pre-registered user with empty `sub`
- WHEN two logins with that email and different `sub`s link at the same time
- THEN exactly one links and is admitted
- AND the other receives 409 and links nothing

#### Scenario: Malformed identities claim
- WHEN the id token's `identities` is an object, an empty string, or absent
- THEN the user is treated as custom (requires `email_verified` to link, and active assignments)

#### Scenario: Unverified email change of a linked custom user
- GIVEN a custom user linked by `sub`
- WHEN they log in with a new email and `email_verified` is not true
- THEN the stored email does not change

#### Scenario: Auth source of a pre-registered user
- AND IT MUST set `auth_source` from the id token on first login, overriding what the admin entered

### FR-9: Login response and refresh cookie

On successful admission the system SHALL respond with `{ accessToken, expiresIn, user }` where `user` = profile + active assignments, and set the refresh cookie.

#### Scenario: Cookie attributes
- THEN the refresh token is set in a cookie that is `HttpOnly`, `Secure`, `SameSite=Lax`, host-only (no `Domain`), `Path=/api/v1/auth/session`
- AND the Cognito username needed for refresh (FR-13) travels in a companion cookie with the same attributes
- BUT the refresh token, the id token and the username must NOT appear in any response body or log line

#### Scenario: No cookie on refusal
- BUT a 401, 403 or 409 response, or a `NEW_PASSWORD_REQUIRED` challenge, must NOT set a session cookie
- AND IT MUST leave an existing session cookie untouched (neither cleared nor replaced): only a successful login sends `Set-Cookie` (amended 2026-10-14; refresh refusals keep FR-13's clearing)

### FR-10: Access-token verification

Every route SHALL require a valid Cognito access token unless explicitly marked public.

#### Scenario: Valid token
- GIVEN a token signed by the pool's JWKS, unexpired, `token_use = access`, `client_id` = QA's client
- THEN the request proceeds to FR-11

#### Scenario: Rejections
- WHEN the token is missing, malformed, expired, badly signed, an id token, or from another app client
- THEN 401 with the error envelope
- BUT the handler must NOT run

#### Scenario: Public routes
- AND IT MUST allow only login, complete-new-password, provider-url, callback, session refresh, session logout and health without a token

### FR-11: Current user per request

After FR-10, the system SHALL load the user by `sub` with active assignments.

#### Scenario: Not admitted anymore
- WHEN the user does not exist, is inactive, or is custom without active assignments
- THEN 401

#### Scenario: Freshness bound
- AND IT MUST reflect assignment or user changes within 60 seconds (cache bound), and immediately within the same process when the change happens through QA

### FR-12: Route authorization

Routes SHALL declare the permission they need; scoped permissions are checked with `can()` against the resource's result type or program.

#### Scenario: Missing permission
- THEN 403
- BUT the handler must NOT run

#### Scenario: GUEST
- GIVEN a user with no active assignments (SSO)
- THEN read routes succeed
- BUT every route not marked read returns 403

#### Scenario: Undeclared route
- AND IT MUST deny (403) an authenticated non-public route that declares neither a permission nor the read marker (fail closed)

### FR-13: Session refresh

`POST /api/v1/auth/session/refresh` SHALL return a new access token using only the refresh cookies.

#### Scenario: After reload or expiry
- GIVEN valid refresh cookies and no (or an expired) access token
- WHEN the front calls refresh from an allowed origin
- THEN the response is FR-9's success shape
- AND the refresh cookie is rotated when Cognito returns a new refresh token, otherwise kept

#### Scenario: Admission re-checked
- GIVEN an admin revoked a custom user's last active assignment, or deactivated the user
- WHEN refresh is called
- THEN 403 and both session cookies are cleared
- AND IT MUST read the database, not the per-request cache

#### Scenario: Origin
- WHEN the `Origin` header is missing or not allowed
- THEN 403 and the microservice must NOT be called

#### Scenario: Missing or invalid refresh
- WHEN the cookies are absent, or the microservice rejects the refresh (including an empty response)
- THEN 401 and both cookies are cleared

**Dependency:** depends on the microservice accepting the username on refresh (proposal R1). Until then this requirement is blocked.

### FR-14: Logout

`POST /api/v1/auth/session/logout` SHALL clear both session cookies.

#### Scenario: Allowed origin
- THEN 204 and both cookies cleared (expired, same Path), with or without an access token

#### Scenario: Disallowed origin
- THEN 403 and cookies untouched

### FR-15: Current profile

`GET /api/v1/auth/me` SHALL return the authenticated user's profile and active assignments (GUEST included).

### FR-16: CORS

The API SHALL answer cross-origin requests with credentials only for allowed origins.

#### Scenario: Allowed origin
- THEN `Access-Control-Allow-Origin` echoes that exact origin and `Access-Control-Allow-Credentials: true`
- BUT `*` must NOT be used

#### Scenario: Other origin
- THEN no CORS allow headers are returned

### FR-17: No QA-issued tokens

#### Scenario: Static guarantee
- THEN `server/` contains no token signing and no Cognito client secret (configuration or code)

### FR-18: Configuration

The API SHALL refuse to start when `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `MS_AUTH_URL`, `MS_AUTH_USER`, `MS_AUTH_PASSWORD` or `ALLOWED_ORIGINS` is missing, naming the missing variables.
- AND IT MUST reject an `ALLOWED_ORIGINS` entry that is not an `https://` origin, except `http://localhost:<port>` for local development

## 7. Non-Functional Requirements

| ID | Attribute | Scenario | Measure | TRD |
|---|---|---|---|---|
| NFR-1 | Security | Forged/expired/foreign tokens | 100 % → 401; e2e matrix | QAS-SEC-1 |
| NFR-2 | Security | Out-of-scope action | 100 % → 403; `can()` table tests cover every role × scope | QAS-SEC-2 |
| NFR-3 | Security | Malformed input on auth routes | 100 % → 400 before the microservice is called | QAS-SEC-3 |
| NFR-4 | Security | Brute force on login | Login and callback limited to 10 requests per minute per IP → 429 | TRD § 10 |
| NFR-5 | Performance | Authenticated request, warm JWKS and cache | Guard + user load add ≤ 20 ms p95 | QAS-PERF-1 |
| NFR-6 | Availability | Microservice down or 5xx | Auth routes answer 503 within 10 s with the error envelope; other routes unaffected for users with valid tokens | QAS-AVL-1 |
| NFR-7 | Observability | Every auth decision | One structured log line (route, outcome, reason code, user id when known, request id); never a token, cookie or password | QAS-OBS-1 |

### Defect classes and their gates

| Defect class | Gate | Substitute / accepted risk |
|---|---|---|
| A route reachable without a token (guard bypass, wrong `@Public`) | e2e route-inventory test: every registered route except the public list answers 401 without a token | — |
| Token check too lax (wrong `client_id`, id token accepted, expired accepted) | Unit/e2e tests with a locally generated key set and forged tokens | Real pool behavior: HITL login in TEST |
| Scope leak in `can()` | Table-driven unit tests over every role × scope × context | — |
| Admission rule wrong (custom admitted, SSO refused, 409 missed) | Unit tests of the resolution service with fakes for every row of FR-8 | — |
| Cookie leaks (body, wrong flags, cookie on 403) | e2e assertions on `Set-Cookie` attributes and response bodies | — |
| DB constraint defects (duplicate active assignment, scope mismatch, email case) | Integration test against a disposable MySQL schema | **No disposable DB exists yet** (shared `qadb` must not be reset) — substitute: migration review at the HITL pause + service-level guards tested with fakes; accepted risk until a test DB is provided |
| Microservice contract drift | Contract tests against recorded fixtures | Real behavior: HITL run in TEST (identities claim, client id, refresh) |
| Compiler-only defects | `pnpm build` (tsc) in every task | — |

## 8. Requirement ID Index

| ID | Title | Scenarios |
|---|---|---|
| FR-1 | Users, roles and assignments | 4 |
| FR-2 | Seeds | 2 |
| FR-3 | Permission evaluation | 4 |
| FR-4 | Custom login | 4 |
| FR-5 | Complete new password | 2 |
| FR-6 | SSO provider URL | 1 |
| FR-7 | SSO callback | 1 |
| FR-8 | User resolution and admission | 9 |
| FR-9 | Login response and refresh cookie | 2 |
| FR-10 | Access-token verification | 3 |
| FR-11 | Current user per request | 2 |
| FR-12 | Route authorization | 3 |
| FR-13 | Session refresh | 4 (blocked by R1) |
| FR-14 | Logout | 2 |
| FR-15 | Current profile | — |
| FR-16 | CORS | 2 |
| FR-17 | No QA-issued tokens | 1 |
| FR-18 | Configuration | — |
| NFR-1…7 | See § 7 | — |

Owning tasks are filled in `tasks.md`.
