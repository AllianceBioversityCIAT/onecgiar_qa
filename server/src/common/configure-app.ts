import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { authConfig } from '../config/auth.config.js';
import { HttpExceptionFilter } from './http-exception.filter.js';

export const API_PREFIX = 'api/v1';

/**
 * The single place that wires the HTTP surface (prefix, security headers,
 * cookies, validation, error envelope, CORS, proxy trust). Used by `main.ts`
 * and by the e2e suite so the tests exercise the real bootstrap.
 */
export function configureApp(app: NestExpressApplication): void {
  const { allowedOrigins } = app.get(authConfig.KEY);

  // One reverse proxy (TEST/PROD) sits in front: use its client IP (P-16).
  app.set('trust proxy', 1);
  app.setGlobalPrefix(API_PREFIX);
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
}
