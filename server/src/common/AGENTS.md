# src/common — Agent Guide

The HTTP surface shared by `main.ts` and the e2e suites, so tests exercise the real bootstrap. Root and `server/AGENTS.md` rules apply.

## Files

| File | Role |
|---|---|
| `configure-app.ts` | `configureApp(app)` and `API_PREFIX` (`api/v1`): trust proxy (1 hop), global prefix, request id, helmet, cookie-parser, global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`), global `HttpExceptionFilter`, CORS (exact-origin echo from `ALLOWED_ORIGINS`, credentials, never `*`), and body parsing (JSON everywhere; urlencoded everywhere except `/api/v1/auth`; no text parser; JSON-only gate on auth POSTs) |
| `http-exception.filter.ts` | Every error → `{ statusCode, error, message, details?, requestId }`. Unknown errors become a generic 500 without internals |
| `request-id.ts` | `requestIdMiddleware`: reuses a valid incoming `x-request-id` or creates one, echoes it on the response; `requestIdOf(request)` for logs and the envelope |

## Rules

- **One wiring path.** Any global middleware, pipe, filter or parser goes into `configureApp`, never only into `main.ts` — otherwise e2e tests stop matching production.
- **Order matters:** request id first (every later step and log line sees it); the JSON-only gate on `/api/v1/auth` runs before any body parser reads the body.
- **CORS:** keep the exact-match callback. Do not switch `origin` to `true`, a regex, or `*` (FR-16; the CORS e2e fails).
- **Error envelope:** keep the field set stable — clients and tests depend on it. Put validation detail in `details`; never put stack traces, SQL or upstream bodies in `message`.
- `trust proxy = 1` assumes exactly one reverse proxy in TEST/PROD (premise P-16); revisit throttling if that changes.

## Testing

`http-exception.filter.spec.ts` and `request-id.spec.ts` (unit); the CORS, envelope, 404 and body-parsing behavior is covered in `test/app.e2e-spec.ts` and `test/auth-login.e2e-spec.ts`.
