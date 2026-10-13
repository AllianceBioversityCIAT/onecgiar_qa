import { Test, TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/common/configure-app.js';

const ALLOWED = 'https://qa.example.org';
const DISALLOWED = 'https://evil.example.com';

describe('HTTP surface (e2e)', () => {
  let app: NestExpressApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /api/v1/health returns 200 { status: "ok" }', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET / is no longer served (DD-9)', async () => {
    await request(app.getHttpServer()).get('/').expect(404);
  });

  describe('CORS (FR-16)', () => {
    it('echoes an allowed origin exactly, with credentials', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .set('Origin', ALLOWED)
        .expect(200);
      expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('answers the preflight of an allowed origin', async () => {
      const res = await request(app.getHttpServer())
        .options('/api/v1/health')
        .set('Origin', ALLOWED)
        .set('Access-Control-Request-Method', 'POST')
        .expect(204);
      expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('returns no CORS allow headers for a disallowed origin', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .set('Origin', DISALLOWED);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('returns no CORS allow headers on the preflight of a disallowed origin', async () => {
      const res = await request(app.getHttpServer())
        .options('/api/v1/health')
        .set('Origin', DISALLOWED)
        .set('Access-Control-Request-Method', 'POST');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('never answers with a wildcard origin', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .set('Origin', ALLOWED);
      expect(res.headers['access-control-allow-origin']).not.toBe('*');
    });
  });

  it('sets Helmet security headers', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('answers an unknown route with the error envelope', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/nope')
      .expect(404);
    expect(res.body).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: expect.any(String),
      requestId: expect.any(String),
    });
  });

  it('echoes a client-supplied x-request-id only when well-formed', async () => {
    const ok = await request(app.getHttpServer())
      .get('/api/v1/nope')
      .set('x-request-id', 'abc-123');
    expect(ok.body.requestId).toBe('abc-123');
    const bad = await request(app.getHttpServer())
      .get('/api/v1/nope')
      .set('x-request-id', 'bad id with spaces');
    expect(bad.body.requestId).not.toBe('bad id with spaces');
    expect(bad.body.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
