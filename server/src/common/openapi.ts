import { applyDecorators } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  ApiResponse,
  DocumentBuilder,
  type OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';
import { API_PREFIX } from './configure-app.js';
import { ErrorEnvelope } from './http-exception.filter.js';

/** Swagger UI path (the JSON document is under it). Served outside the guards. */
export const OPENAPI_PATH = `${API_PREFIX}/docs`;
export const OPENAPI_JSON_PATH = `${OPENAPI_PATH}/openapi.json`;

/** Security scheme names, used by the controllers' decorators. */
export const ACCESS_TOKEN_SCHEME = 'access-token';
export const SESSION_COOKIE_SCHEME = 'session-cookie';

const STATUS_DESCRIPTIONS: Record<number, string> = {
  400: 'Invalid input (validation or a redirect URI outside ALLOWED_ORIGINS)',
  401: 'Missing, invalid or expired credentials',
  403: 'Not allowed: missing permission, not admitted, or a foreign Origin',
  409: 'Conflict: the email belongs to another account',
  415: 'Only application/json is accepted on /api/v1/auth POSTs',
  429: 'Too many requests (10 per minute per IP)',
  503: 'Cognito unavailable (timeout, 5xx or throttling)',
};

/** Documents error responses with the shared envelope (`{ statusCode, error, message, details?, requestId }`). */
export const ApiErrorResponses = (...statuses: number[]) =>
  applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({
        status,
        description: STATUS_DESCRIPTIONS[status] ?? `HTTP ${status}`,
        type: ErrorEnvelope,
      }),
    ),
  );

/** The OpenAPI document of every controller route (global prefix included). */
export function buildOpenApiDocument(
  app: NestExpressApplication,
): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('OneCGIAR QA API')
    .setDescription(
      [
        'Every route is under `/api/v1` and requires a Cognito **access token** (`Authorization: Bearer …`) unless marked otherwise.',
        '',
        '**Try it from this page:** call `POST /auth/login` (or the SSO flow), copy `accessToken` into **Authorize → access-token**.',
        "The session routes (`/auth/session/*`) use the httpOnly cookies the login set; the browser sends them, and they also require an `Origin` listed in `ALLOWED_ORIGINS` (add this page's origin, e.g. `http://localhost:3000`, locally).",
        '',
        'Errors always use the envelope `{ statusCode, error, message, details?, requestId }`; `requestId` is echoed in `x-request-id`.',
      ].join('\n'),
    )
    .setVersion('1')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Cognito access token from login, callback or session refresh',
      },
      ACCESS_TOKEN_SCHEME,
    )
    .addCookieAuth(
      'qa_rt',
      {
        type: 'apiKey',
        in: 'cookie',
        description:
          'httpOnly refresh cookie set by login (Path=/api/v1/auth/session); sent by the browser',
      },
      SESSION_COOKIE_SCHEME,
    )
    .build();
  return SwaggerModule.createDocument(app, config);
}

/** Serves Swagger UI at `/api/v1/docs` and the JSON at `/api/v1/docs/openapi.json`. */
export function setupOpenApi(app: NestExpressApplication): void {
  SwaggerModule.setup(OPENAPI_PATH, app, () => buildOpenApiDocument(app), {
    jsonDocumentUrl: OPENAPI_JSON_PATH,
    yamlDocumentUrl: `${OPENAPI_PATH}/openapi.yaml`,
    customSiteTitle: 'OneCGIAR QA API',
    swaggerOptions: {
      persistAuthorization: true,
      withCredentials: true,
      displayRequestDuration: true,
    },
  });
}
