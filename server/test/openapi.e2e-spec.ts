import type { NestExpressApplication } from '@nestjs/platform-express';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { JWKS_CACHE } from '../src/auth/token-verifier.service.js';
import { configureApp } from '../src/common/configure-app.js';
import { buildOpenApiDocument, setupOpenApi } from '../src/common/openapi.js';
import { localJwksCache, newKeyPair } from './support/jwt-test-keys.js';

// The OpenAPI document must describe exactly what the router serves, with the
// right security on each operation, so the docs can be trusted and Swagger UI
// can drive every route. Expected values are written out, not imported.

/** FR-10's public routes: no access token. */
const PUBLIC_ROUTES = [
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/complete-new-password',
  'GET /api/v1/auth/provider-url',
  'POST /api/v1/auth/callback',
  'POST /api/v1/auth/session/refresh',
  'POST /api/v1/auth/session/logout',
  'GET /api/v1/health',
];
const SESSION_ROUTES = [
  'POST /api/v1/auth/session/refresh',
  'POST /api/v1/auth/session/logout',
];

type Operation = {
  summary?: string;
  security?: Array<Record<string, string[]>>;
  responses: Record<string, unknown>;
};

async function buildApp(withDocs: boolean): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(JWKS_CACHE)
    .useValue(localJwksCache(newKeyPair('openapi-e2e-kid')))
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  if (withDocs) setupOpenApi(app);
  await app.init();
  return app;
}

/** `METHOD /path` for every controller route the Express router serves. */
function servedRoutes(app: NestExpressApplication): string[] {
  const { router } = app.getHttpAdapter().getInstance() as {
    router: {
      stack: Array<{ route?: { path: string; methods: Record<string, true> } }>;
    };
  };
  return router.stack
    .flatMap(({ route }) =>
      route === undefined
        ? []
        : Object.keys(route.methods).map(
            (method) => `${method.toUpperCase()} ${route.path}`,
          ),
    )
    .filter((key) => !key.includes('/api/v1/docs'))
    .sort();
}

/** `METHOD /path` for every operation of the document (`{id}` → `:id`). */
function documentedRoutes(doc: OpenAPIObject): string[] {
  return Object.entries(doc.paths)
    .flatMap(([path, item]) =>
      Object.keys(item)
        .filter((key) =>
          ['get', 'post', 'put', 'patch', 'delete'].includes(key),
        )
        .map(
          (method) =>
            `${method.toUpperCase()} ${path.replace(/\{(\w+)\}/g, ':$1')}`,
        ),
    )
    .sort();
}

function operationOf(doc: OpenAPIObject, key: string): Operation {
  const [method, path] = key.split(' ');
  const item = doc.paths[path] as Record<string, Operation>;
  return item[method.toLowerCase()];
}

describe('OpenAPI document (e2e)', () => {
  let app: NestExpressApplication;
  let doc: OpenAPIObject;

  beforeAll(async () => {
    app = await buildApp(false);
    doc = buildOpenApiDocument(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('documents exactly the routes the router serves', () => {
    const served = servedRoutes(app);
    expect(served.length).toBeGreaterThanOrEqual(8);
    expect(documentedRoutes(doc)).toEqual(served);
  });

  it('marks every non-public route with the access-token scheme, and no public one', () => {
    for (const key of documentedRoutes(doc)) {
      const schemes = (operationOf(doc, key).security ?? []).flatMap(
        Object.keys,
      );
      if (PUBLIC_ROUTES.includes(key)) {
        expect(schemes, key).not.toContain('access-token');
      } else {
        expect(schemes, key).toContain('access-token');
      }
    }
  });

  it('marks the session routes with the session cookie', () => {
    for (const key of SESSION_ROUTES) {
      const schemes = (operationOf(doc, key).security ?? []).flatMap(
        Object.keys,
      );
      expect(schemes, key).toContain('session-cookie');
    }
  });

  it('gives every operation a summary, a success response and documented errors', () => {
    for (const key of documentedRoutes(doc)) {
      const operation = operationOf(doc, key);
      const codes = Object.keys(operation.responses);
      expect(operation.summary, `${key}: summary`).toBeTruthy();
      expect(
        codes.some((code) => code.startsWith('2')),
        `${key}: 2xx`,
      ).toBe(true);
      if (!key.endsWith('/health')) {
        expect(
          codes.some((code) => code.startsWith('4')),
          `${key}: 4xx`,
        ).toBe(true);
      }
      if (!PUBLIC_ROUTES.includes(key)) {
        expect(codes, `${key}: 401`).toContain('401');
      }
    }
  });

  it('declares both security schemes', () => {
    expect(doc.components?.securitySchemes).toMatchObject({
      'access-token': { type: 'http', scheme: 'bearer' },
      'session-cookie': { type: 'apiKey', in: 'cookie', name: 'qa_rt' },
    });
  });

  it('describes the request bodies with their validation bounds', () => {
    const schemas = doc.components?.schemas as Record<string, any>;
    expect(schemas.LoginDto).toMatchObject({
      required: expect.arrayContaining(['email', 'password']),
      properties: {
        email: { type: 'string', format: 'email', maxLength: 255 },
        password: { type: 'string', format: 'password', minLength: 1 },
      },
    });
    expect(schemas.CallbackDto.required).toEqual(
      expect.arrayContaining(['code', 'redirectUri']),
    );
    expect(schemas.CompleteNewPasswordDto.required).toEqual(
      expect.arrayContaining(['email', 'newPassword', 'session']),
    );
  });

  it('describes the responses: session, challenge, profile and the error envelope', () => {
    const schemas = doc.components?.schemas as Record<string, any>;
    expect(schemas.SessionResponse.required).toEqual(
      expect.arrayContaining(['accessToken', 'expiresIn', 'user']),
    );
    expect(schemas.ChallengeResponse.required).toEqual(
      expect.arrayContaining(['challenge', 'session']),
    );
    expect(schemas.UserProfile.required).toEqual(
      expect.arrayContaining(['id', 'email', 'authSource', 'assignments']),
    );
    expect(schemas.ErrorEnvelope.required).toEqual(
      expect.arrayContaining(['statusCode', 'error', 'message', 'requestId']),
    );
    const login = operationOf(doc, 'POST /api/v1/auth/login');
    expect(JSON.stringify(login.responses['200'])).toContain(
      '#/components/schemas/ChallengeResponse',
    );
    expect(JSON.stringify(login.responses['401'])).toContain(
      '#/components/schemas/ErrorEnvelope',
    );
  });

  it('carries no secret or token value', () => {
    const text = JSON.stringify(doc);
    expect(text).not.toContain(process.env.COGNITO_CLIENT_SECRET!);
    expect(text).not.toMatch(/eyJ[\w-]+\.[\w-]+\./);
  });
});

describe('Swagger UI (e2e)', () => {
  it('serves the UI and the JSON document without a token when enabled', async () => {
    const app = await buildApp(true);
    try {
      const ui = await request(app.getHttpServer()).get('/api/v1/docs');
      expect(ui.status).toBe(200);
      expect(ui.headers['content-type']).toContain('text/html');

      const json = await request(app.getHttpServer())
        .get('/api/v1/docs/openapi.json')
        .expect(200);
      expect(json.body.openapi).toMatch(/^3\./);
      expect(Object.keys(json.body.paths)).toContain('/api/v1/auth/login');
    } finally {
      await app.close();
    }
  });

  it('serves nothing when not set up (OPENAPI_ENABLED=false)', async () => {
    const app = await buildApp(false);
    try {
      await request(app.getHttpServer()).get('/api/v1/docs').expect(404);
      await request(app.getHttpServer())
        .get('/api/v1/docs/openapi.json')
        .expect(404);
    } finally {
      await app.close();
    }
  });
});
