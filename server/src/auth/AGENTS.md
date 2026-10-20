# src/auth — Agent Guide

Identity and session: QA talks to **Cognito directly** with its own app client, verifies every access token locally, decides who is admitted, and keeps the session in httpOnly cookies. Spec: `docs/specs/auth/cognito-native-session/` (FR-4…FR-18, DD-2, DD-3, DD-10, DD-11). Root and `server/AGENTS.md` rules apply.

## Files

| File | Role |
|---|---|
| `auth.module.ts` | Wires the controllers and providers; exports `TokenVerifier`, `AdmissionService` |
| `cognito-auth.client.ts` | The only code that calls Cognito: user-pool API (`InitiateAuth` USER_PASSWORD_AUTH / REFRESH_TOKEN_AUTH, `RespondToAuthChallenge`, `RevokeToken`) and Hosted UI (authorize URL, `/oauth2/token`). `SECRET_HASH` = base64 HMAC-SHA256(secret, username + clientId). Timeout 10 s |
| `cognito-admin.module.ts`, `cognito-admin.client.ts` | `CognitoAdminModule` / `CognitoAdminClient`: the Cognito **admin** API for user management (`AdminGetUser`, `AdminCreateUser`, invitation resend), AWS SDK with SigV4; credentials from `COGNITO_ADMIN_*` locally, else the host's IAM role. Timeout 10 s; failures reuse `UpstreamUnavailableError` (503 `AUTH_SERVICE_UNAVAILABLE`). Logs the operation, outcome and AWS error name only. Its own module so `UsersModule` can import it without a cycle (`AuthModule` imports `UsersModule`) |
| `token-verifier.service.ts` | `verifyAccess` / `verifyId` with `aws-jwt-verify` against the pool JWKS (`iss`, `client_id`/`aud`, `token_use`, `exp`). JWKS cache behind the `JWKS_CACHE` token |
| `admission.service.ts`, `admission.unit-of-work.ts` | FR-8: resolve the QA user from a verified id token in one MySQL transaction (`mode: 'login' \| 'refresh'`; refresh never creates users and bypasses the cache) |
| `auth.controller.ts` | `POST login`, `POST complete-new-password`, `GET provider-url`, `POST callback` — all public |
| `session.controller.ts` | `POST session/refresh`, `POST session/logout` — public, cookie-only, behind `OriginGuard` |
| `me.controller.ts` | `GET me` (any authenticated user, GUEST included) and `toUserProfile` (adds the caller's own `nickname`, FR-12). Takes an `AdmittedUser`: the admission result carries no program scope, so it cannot reach `canReview`; request handlers get an `AuthenticatedUser` (admitted + scope + active exclusions) |
| `session-cookies.ts` | `qa_rt` (refresh token) and `qa_ru` (`cognito:username`): `HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth/session`, no `Domain`, 30 days. `setSessionCookies` / `clearSessionCookies` |
| `guards/auth.guard.ts` | Global: skips `@Public()`, verifies the Bearer access token, loads the user through `CurrentUserCache`, 401 otherwise |
| `guards/permission.guard.ts` | Global: `@ReadAccess()` → any authenticated user; `@RequirePermission(p)` → `canAny`; **no decorator → 403** |
| `guards/origin.guard.ts` | Session routes only: exact `Origin` in `ALLOWED_ORIGINS`, else 403 (missing Origin refused); logs its own decision |
| `decorators/` | `@Public()`, `@ReadAccess()`, `@RequirePermission(p)`, `@CurrentUser()` |
| `json-only.ts` | Every POST under `/api/v1/auth` must be `application/json` (UTF-8) or bodyless, else 415 (login CSRF, FR-4) |
| `auth-throttle.ts` | 10 req/min per IP on login, complete-new-password and callback (NFR-4) |
| `auth-decision.ts` | One structured log line per auth decision; maps error classes to reason codes |
| `auth.errors.ts` | Typed refusals (409 collision, 403 not registered/inactive/no roles/origin, 401 session missing, 400 redirect URI, 415) |
| `redirect-uri.ts` | Redirect-URI allow-list by parsed origin (rejects look-alike hosts, userinfo, backslashes) |
| `dto/` | Request DTOs (`class-validator`) |
| `no-qa-tokens.spec.ts` | FR-17 static check: no token signing in `src`, client secret only from env, no secret literal or log |

## Rules when changing this module

- **Every new route anywhere** must be `@Public()` (and listed in FR-10), `@ReadAccess()`, or `@RequirePermission(...)`. The route inventory e2e (`test/auth-hardening.e2e-spec.ts`) compares the live router against FR-10's public list and fails on any drift — update the spec first, then the list.
- **Cookies:** only a successful login/callback/new-password or a rotated refresh sets them. A failed login never touches existing cookies. On refresh, any 4xx refusal clears both; a 503 keeps them (an outage must not end a session). A foreign-Origin 403 never touches them.
- **Logging:** use `logAuthDecision` with a reason code. Never log tokens, cookies, passwords, codes, the username, request bodies, or anything from a Cognito body except a sanitized error name.
- **Cognito errors:** the client maps a refusal to `InvalidCredentialsError(code)` (401) with the code of the step — login `AUTH_INVALID_CREDENTIALS` (no hint whether the email exists), new password `AUTH_CHALLENGE_EXPIRED`, SSO code `AUTH_SSO_CODE_INVALID`, refresh `AUTH_SESSION_EXPIRED` —, `InvalidPasswordException` → `PasswordPolicyError` (400 `AUTH_PASSWORD_POLICY`), and throttling/5xx/timeout/network → `UpstreamUnavailableError` (503 `AUTH_SERVICE_UNAVAILABLE`). Keep that mapping in the client, not in controllers.
- **Admission:** decisions that depend on concurrent writes come only from the conditional `UPDATE … WHERE cognito_sub IS NULL` or `SELECT … FOR UPDATE`, never a plain read (DD-10). Lock order for logins and admission: `users` → `role_assignments` → `roles`, shared locks only on `roles`; the admin API (`src/users/AGENTS.md`) takes `users` → ADMIN `roles` row → `role_assignments`, so a login (shared locks only) cannot close a lock cycle with it (DD-14). After commit, call `CurrentUserCache.invalidate(user.id)`.
- **Admin API:** the IAM user/role needs only `cognito-idp:AdminGetUser` and `AdminCreateUser` on the pool; never log the email or the SDK error message (name only). It is called by `UsersAdminService`, never by the auth controllers.
- **Secrets:** `COGNITO_CLIENT_SECRET` is read only in `src/config/auth.config.ts` (the admin keys only in `cognito-admin.config.ts`). Do not add another reader, a fallback literal, or a log of it — `no-qa-tokens.spec.ts` fails if you do. QA never signs tokens.
- **OpenAPI:** public auth routes carry no security scheme; `/auth/session/*` carry `session-cookie`; anything authenticated carries `access-token`. Keep summaries and documented status codes in step with § 6 of the design.
- **Known gap:** the SSO authorize URL has no `state`/PKCE yet. It must be added (FR-6/FR-7 amendment + front) before SSO goes live.

## Testing

- Unit: the Cognito client against a stubbed `fetch` with Cognito-shaped fixtures; admission with in-memory stores (including a snapshot store that emulates REPEATABLE READ).
- e2e: `test/auth-login.e2e-spec.ts`, `test/auth-session.e2e-spec.ts`, `test/auth-guards.e2e-spec.ts`, `test/auth-hardening.e2e-spec.ts` over the real app, with the Cognito client faked, real RS256 tokens from a local key set, and in-memory DB ports. Assert each cookie attribute, not just presence; assert "Cognito not called" with the fake's spy.
- Against the real pool, only by a human or with explicit approval (no real tokens in the repo or chat).
