# Front-end auth integration (client/)

How the Angular client uses the Cognito-native session of `server/` (spec: `cognito-native-session/`).
Owner: Yeck (front). Back contract owner: Juanda. Last checked against the back: 2026-10-16.

## Flow

| Step | Front | Back |
|-|-|-|
| App start | `AuthSession.bootstrap()` (`provideAppInitializer`) → one `POST /auth/session/refresh` with the cookie | Rotates `qa_rt`/`qa_ru`, returns `{ accessToken, expiresIn, user }` |
| Email + password | `POST /auth/login` → session, or `NEW_PASSWORD_REQUIRED` challenge → `POST /auth/complete-new-password` | Calls Cognito, admits the user, sets the cookies |
| SSO (CGIAR Azure AD) | `GET /auth/provider-url?redirectUri=<origin>/auth/callback` → redirect → `/auth/callback` page → `POST /auth/callback { code, redirectUri }` | Builds the Hosted UI URL, exchanges the code |
| Calls | `authInterceptor`: `Authorization: Bearer <token>` on every API call; `withCredentials` only on `/auth/*` | `AuthGuard` + `PermissionGuard` |
| 401 on a call | One shared refresh, one retry; still 401 → sign out to `/login`, keeping the deep link | — |
| Proactive refresh | Timer at `expiresIn − 60 s` (min 30 s, max 12 h) | — |
| Sign-out | `POST /auth/session/logout`; if it cannot reach the server, retried on the next start | Revokes the refresh token, clears the cookies |

The access token lives in memory only (`TokenStore`). The front never reads cookies.

## When the session ends

`endsSession()` in `client/src/app/core/auth/auth.models.ts`:

- **Ends it:** a 401, or a refresh refused for admission: `AUTH_USER_INACTIVE`, `AUTH_NO_ACTIVE_ROLES`, `AUTH_USER_NOT_REGISTERED`, `AUTH_EMAIL_NOT_VERIFIED`, `AUTH_EMAIL_CONFLICT`. The server clears the cookies on those (FR-13); the login page shows the server message.
- **Keeps it:** 5xx, 429, timeouts, network errors, `AUTH_ORIGIN_NOT_ALLOWED` (the OriginGuard keeps the cookies, FR-14) and any 403 without our envelope (gateway/WAF).

Server messages are shown as they come (`error-codes.ts`: "message is safe to show as is").

## Environments

| Build | File | API |
|-|-|-|
| `ng build` (production) | `environment.ts` | `https://api.qa.cgiar.org/api/v1` (to confirm) |
| `ng build --configuration test` | `environment.qatest.ts` | `https://qatest-serv.ciat.cgiar.org/api/v1` |
| `ng serve` (development) | `environment.development.ts` | `http://localhost:3000/api/v1` |

No secrets in the front: every value ships to the browser.

## Running it end to end

- **TEST:** front at `https://qatest.ciat.cgiar.org`, built with `--configuration test`. Same site as `qatest-serv.ciat.cgiar.org`, so the `SameSite=Lax` cookies travel. Needs `https://qatest.ciat.cgiar.org/auth/callback` registered in Cognito for SSO.
- **Local:** `server/` on `:3000` + `ng serve` on `:4200` (the default `ALLOWED_ORIGINS` and the Cognito callback registered for local use `http://localhost:4200`). Another port → add it to `ALLOWED_ORIGINS` and register its callback, or refresh/logout answer 403 and SSO fails.
- A local front against the TEST API does not work: the TEST server only allows its own origin, and the cookies would be cross-site.

## Open questions for the back

- **Cognito callbacks** for TEST and PROD (`https://…/auth/callback`): asked to Juanda 2026-10-16. Without them the CGIAR sign-in button fails outside localhost.

## Not done yet (front)

- Several tabs: a sign-out in one tab does not end the others (no `BroadcastChannel`). The spec does not ask for it.
- GUEST users (SSO, no roles): `AccessControl.isGuest` exists but no screen tells them they have no role yet.
- SSO `state` / PKCE: owned by the back (`server/src/auth/AGENTS.md`, known gap); the front follows its contract once defined.
- T-11 (manual run on TEST with real accounts) is pending the TEST deploy built with `--configuration test`.
