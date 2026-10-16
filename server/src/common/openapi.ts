import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  DocumentBuilder,
  type OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';
import { API_PREFIX } from './configure-app.js';

/** Swagger UI path (the JSON document is under it). Served outside the guards. */
export const OPENAPI_PATH = `${API_PREFIX}/docs`;
export const OPENAPI_JSON_PATH = `${OPENAPI_PATH}/openapi.json`;

/** Security scheme names, used by the controllers' decorators. */
export const ACCESS_TOKEN_SCHEME = 'access-token';
export const SESSION_COOKIE_SCHEME = 'session-cookie';

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
        '**Response standard.** Success: `{ success: true, data, meta }`. Error: `{ success: false, error: { status, code, message, fields?, retryAfter? }, meta }`. A 204 has no body.',
        'Branch on `error.code` (each route lists the codes it can return); `error.message` is safe to show to the user; `error.fields` gives per-field problems for `VALIDATION_FAILED`. `meta.requestId` is also in the `x-request-id` header — quote it to support.',
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
