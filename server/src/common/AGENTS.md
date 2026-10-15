# src/common — Agent Guide

The HTTP surface shared by `main.ts` and the e2e suites, so tests exercise the real bootstrap. Root and `server/AGENTS.md` rules apply.

## Files

| File | Role |
|---|---|
| `configure-app.ts` | `configureApp(app)` and `API_PREFIX` (`api/v1`): trust proxy (1 hop), global prefix, request id, helmet, cookie-parser, global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`), global `HttpExceptionFilter`, CORS (exact-origin echo from `ALLOWED_ORIGINS`, credentials, never `*`), and body parsing (JSON everywhere; urlencoded everywhere except `/api/v1/auth`; no text parser; JSON-only gate on auth POSTs) |
| `http-exception.filter.ts` | Every error → `{ statusCode, error, message, details?, requestId }`. Unknown errors become a generic 500 without internals |
| `openapi.ts` | `buildOpenApiDocument(app)`, `setupOpenApi(app)` (Swagger UI at `/api/v1/docs`, JSON/YAML under it, `persistAuthorization`), the security scheme names `ACCESS_TOKEN_SCHEME` / `SESSION_COOKIE_SCHEME`, and `@ApiErrorResponses(...statuses)` (the error envelope per status). Called from `main.ts` only when `OPENAPI_ENABLED` resolves to true — not from `configureApp`, so the e2e router inventory is unaffected |
| `request-id.ts` | `requestIdMiddleware`: reuses a valid incoming `x-request-id` or creates one, echoes it on the response; `requestIdOf(request)` for logs and the envelope |

## Rules

- **One wiring path.** Any global middleware, pipe, filter or parser goes into `configureApp`, never only into `main.ts` — otherwise e2e tests stop matching production.
- **Order matters:** request id first (every later step and log line sees it); the JSON-only gate on `/api/v1/auth` runs before any body parser reads the body.
- **CORS:** keep the exact-match callback. Do not switch `origin` to `true`, a regex, or `*` (FR-16; the CORS e2e fails).
- **Error envelope:** keep the field set stable — clients and tests depend on it. Put validation detail in `details`; never put stack traces, SQL or upstream bodies in `message`.
- **OpenAPI:** the docs routes are registered on the Express adapter, outside the Nest guards. Keep them off in PROD unless enabled on purpose: the document maps the whole API surface. `ErrorEnvelope` is a class so the document can describe it; keep its fields in step with the filter.
- `trust proxy = 1` assumes exactly one reverse proxy in TEST/PROD (premise P-16); revisit throttling if that changes.

## Testing

`http-exception.filter.spec.ts` and `request-id.spec.ts` (unit); `test/openapi.e2e-spec.ts` (document = router, security per route, schemas, UI served when set up); the CORS, envelope, 404 and body-parsing behavior is covered in `test/app.e2e-spec.ts` and `test/auth-login.e2e-spec.ts`.
