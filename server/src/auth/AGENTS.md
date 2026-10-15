# src/auth — Agent Guide

Identity and session: QA talks to **Cognito directly** with its own app client, verifies every access token locally, decides who is admitted, and keeps the session in httpOnly cookies. Spec: `docs/specs/auth/cognito-native-session/` (FR-4…FR-18, DD-2, DD-3, DD-10, DD-11). Root and `server/AGENTS.md` rules apply.

## Files

| File | Role |
|---|---|
| `auth.module.ts` | Wires the controllers and providers; exports `TokenVerifier`, `AdmissionService` |
| `cognito-auth.client.ts` | The only code that calls Cognito: user-pool API (`InitiateAuth` USER_PASSWORD_AUTH / REFRESH_TOKEN_AUTH, `RespondToAuthChallenge`, `RevokeToken`) and Hosted UI (authorize URL, `/oauth2/token`). `SECRET_HASH` = base64 HMAC-SHA256(secret, username + clientId). Timeout 10 s |
| `token-verifier.service.ts` | `verifyAccess` / `verifyId` with `aws-jwt-verify` against the pool JWKS (`iss`, `client_id`/`aud`, `token_use`, `exp`). JWKS cache behind the `JWKS_CACHE` token |
| `admission.service.ts`, `admission.unit-of-work.ts` | FR-8: resolve the QA user from a verified id token in one MySQL transaction (`mode: 'login' \| 'refresh'`; refresh never creates users and bypasses the cache) |
| `auth.controller.ts` | `POST login`, `POST complete-new-password`, `GET provider-url`, `POST callback` — all public |
| `session.controller.ts` | `POST session/refresh`, `POST session/logout` — public, cookie-only, behind `OriginGuard` |
| `me.controller.ts` | `GET me` (any authenticated user, GUEST included) and `toUserProfile` |
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
- **Cognito errors:** the client maps 4xx → `InvalidCredentialsError` (401, no hint whether the email exists), throttling/5xx/timeout/network → `UpstreamUnavailableError` (503). Keep that mapping in the client, not in controllers.
- **Admission:** decisions that depend on concurrent writes come only from the conditional `UPDATE … WHERE cognito_sub IS NULL` or `SELECT … FOR UPDATE`, never a plain read (DD-10). Lock order everywhere: `users` → `role_assignments` → `roles`. After commit, call `CurrentUserCache.invalidate(user.id)`.
- **Secrets:** `COGNITO_CLIENT_SECRET` is read only in `src/config/auth.config.ts`. Do not add another reader, a fallback literal, or a log of it — `no-qa-tokens.spec.ts` fails if you do. QA never signs tokens.
- **Known gap:** the SSO authorize URL has no `state`/PKCE yet. It must be added (FR-6/FR-7 amendment + front) before SSO goes live.

## Testing

- Unit: the Cognito client against a stubbed `fetch` with Cognito-shaped fixtures; admission with in-memory stores (including a snapshot store that emulates REPEATABLE READ).
- e2e: `test/auth-login.e2e-spec.ts`, `test/auth-session.e2e-spec.ts`, `test/auth-guards.e2e-spec.ts`, `test/auth-hardening.e2e-spec.ts` over the real app, with the Cognito client faked, real RS256 tokens from a local key set, and in-memory DB ports. Assert each cookie attribute, not just presence; assert "Cognito not called" with the fake's spy.
- Against the real pool, only by a human or with explicit approval (no real tokens in the repo or chat).
