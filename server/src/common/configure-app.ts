import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { formsOutside, requireJsonPost } from '../auth/json-only.js';
import { authConfig } from '../config/auth.config.js';
import { HttpExceptionFilter } from './http-exception.filter.js';
import { requestIdMiddleware } from './request-id.js';

export const API_PREFIX = 'api/v1';

/** Where every auth route lives (design 6). */
const AUTH_PATH = `/${API_PREFIX}/auth`;

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
    }),
  );
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
  app.useBodyParser('json');
  app.useBodyParser('urlencoded', {
    extended: true,
    type: formsOutside(AUTH_PATH),
  });
}
