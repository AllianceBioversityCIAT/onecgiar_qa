import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { parse as parseContentType } from 'content-type';
import helmet from 'helmet';
import type { IncomingMessage } from 'node:http';
import type { Request } from 'express';
import { formsOutside, requireJsonPost } from '../auth/json-only.js';
import { authConfig } from '../config/auth.config.js';
import { HttpExceptionFilter } from './http-exception.filter.js';
import { requestIdMiddleware } from './request-id.js';
import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor.js';
import { bodyParserErrors, validationExceptionFactory } from './validation.js';

export const API_PREFIX = 'api/v1';

/** Where every auth route lives (design 6). */
const AUTH_PATH = `/${API_PREFIX}/auth`;

/**
 * The one JSON body that outgrows the 100 KB default (R-5, field-configuration
 * FR-5 and NFR-2): `PATCH /cycles/:id/field-config/draft` takes 1 to 2,000
 * items. With the real catalog keys (a 25-character result type key, a
 * 60-character field key, `view_only`, both flags) an item is about 176 bytes,
 * so 2,000 weigh about 352 KB. At the DTO maxima (64 and 128 characters) an
 * item is about 285 bytes (84 fixed + 64 + 128 + 9), so 2,000 weigh about
 * 570,000 bytes, which 512 KiB would refuse. 640 KiB (655,360 bytes, about 327
 * bytes an item) covers that with room for JSON escaping, and is still a
 * bounded body.
 */
export const FIELD_CONFIG_DRAFT_BODY_LIMIT = '640kb';

/** That route, under the global prefix: any cycle id, an optional trailing slash, any letter case. */
const FIELD_CONFIG_DRAFT_PATH = new RegExp(
  `^/${API_PREFIX}/cycles/[^/]+/field-config/draft/?$`,
  'i',
);

/** Whether a request is a JSON `PATCH` of a field-config draft (the query string is ignored). */
export function isFieldConfigDraftJson(request: IncomingMessage): boolean {
  if (request.method !== 'PATCH') return false;
  // Called with the Express request, so `path` (no query string) is there.
  if (!FIELD_CONFIG_DRAFT_PATH.test((request as Request).path)) return false;
  try {
    return (
      parseContentType(request.headers['content-type'] ?? '').type ===
      'application/json'
    );
  } catch {
    return false;
  }
}

/**
 * The single place that wires the HTTP surface (prefix, security headers,
 * cookies, validation, error envelope, CORS, proxy trust, body parsing). Used
 * by `main.ts` and by the e2e suite so the tests exercise the real bootstrap.
 */
export function configureApp(app: NestExpressApplication): void {
  const { allowedOrigins } = app.get(authConfig.KEY);

  // One reverse proxy (TEST/PROD) sits in front: use its client IP (P-16).
  app.set('trust proxy', 1);
  app.setGlobalPrefix(API_PREFIX);
  // First, so every later step (and every log line) sees the request id.
  app.use(requestIdMiddleware);
  app.use(helmet());
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // Field errors in our words, never class-validator's texts.
      exceptionFactory: validationExceptionFactory,
    }),
  );
  // Response standard: success wrapped here, errors built by the filter.
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  // Exact-origin allow-list: the callback echoes the matching origin and
  // returns `false` for anything else, so no allow header is ever sent for
  // other origins. Requests without an Origin header are not cross-origin.
  app.enableCors({
    origin: (origin, callback) => {
      callback(null, origin !== undefined && allowedOrigins.includes(origin));
    },
    credentials: true,
  });

  // Body parsing (FR-4, login CSRF). The JSON-only rule comes first, mounted
  // so it covers every path the router serves under /api/v1/auth: a POST that
  // is not JSON is refused before anything reads its body. The parsers below
  // replace Nest's defaults, JSON and urlencoded on every path (Nest skips a
  // default parser once one of its kind is registered): JSON everywhere,
  // urlencoded everywhere but under /api/v1/auth, and no text parser at all.
  app.use(AUTH_PATH, requireJsonPost);
  // The draft edit of the field configuration is the one body with a larger
  // limit, mounted before the global parser (which skips a body already read);
  // every other path keeps the 100 KB default. A body over either limit is the
  // same parser error, answered 413 below.
  app.useBodyParser('json', {
    limit: FIELD_CONFIG_DRAFT_BODY_LIMIT,
    type: isFieldConfigDraftJson,
  });
  app.useBodyParser('json');
  // A broken body gets its own code here; left alone, Nest would turn it into
  // a bare 400 (and the parser's own text never reaches the client anyway).
  app.use(bodyParserErrors);
  app.useBodyParser('urlencoded', {
    extended: true,
    type: formsOutside(AUTH_PATH),
  });
}
