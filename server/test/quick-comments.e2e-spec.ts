// @akili-spec assessment/step-1-assessment
import type request from 'supertest';
import {
  bearer,
  buildAssessmentApp,
  type AssessmentApp,
} from './support/assessment-app.js';

// GET and POST /quick-comments over real HTTP (T-11; design 6, 7.7; FR-12,
// FR-21). Guards, pipe, filter, envelope and OpenAPI are the real ones; the
// stores and the unit of work are fakes.

function expectError(res: request.Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.body).toMatchObject({
    success: false,
    error: { status, code },
    meta: { requestId: res.headers['x-request-id'] },
  });
  expect(JSON.stringify(res.body)).not.toMatch(/@/);
}

describe('quick comments (e2e)', () => {
  let a: AssessmentApp;

  beforeEach(async () => {
    a = await buildAssessmentApp(new Date('2026-11-13T10:00:00Z'));
  });
  afterEach(async () => {
    await a.app.close();
  });

  const assessorA = () => bearer('sub-policy');
  const assessorB = () => bearer('sub-policy2');
  const tpb = () => bearer('sub-tpb');

  it('401 without a token', async () => {
    const res = await a.send('get', '/quick-comments?role=ASSESSOR', {
      token: null,
    });
    expectError(res, 401, 'AUTH_TOKEN_INVALID');
  });

  it('Shared by role: A saves a text (201), B sees it newest first, a TPB user gets 403 on the ASSESSOR list', async () => {
    const saved = await a.send('post', '/quick-comments', {
      token: assessorA(),
      body: { role: 'ASSESSOR', body: '  Please add the evidence link  ' },
    });
    expect(saved.status).toBe(201);
    expect(saved.body).toMatchObject({
      success: true,
      data: {
        body: 'Please add the evidence link',
        createdAt: '2026-11-13T10:00:00.000Z',
      },
    });
    expect(typeof saved.body.data.id).toBe('number');

    const list = await a.send('get', '/quick-comments?role=ASSESSOR', {
      token: assessorB(),
    });
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([
      {
        id: saved.body.data.id,
        body: 'Please add the evidence link',
        createdAt: '2026-11-13T10:00:00.000Z',
      },
    ]);

    const denied = await a.send('get', '/quick-comments?role=ASSESSOR', {
      token: tpb(),
    });
    expectError(denied, 403, 'AUTH_PERMISSION_DENIED');
    const deniedSave = await a.send('post', '/quick-comments', {
      token: tpb(),
      body: { role: 'ASSESSOR', body: 'Sneaky' },
    });
    expectError(deniedSave, 403, 'AUTH_PERMISSION_DENIED');
  });

  it('the same trimmed text twice keeps one row: the second answer is 200 with the existing row', async () => {
    const first = await a.send('post', '/quick-comments', {
      token: assessorA(),
      body: { role: 'ASSESSOR', body: 'Same text' },
    });
    const second = await a.send('post', '/quick-comments', {
      token: assessorB(),
      body: { role: 'ASSESSOR', body: ' Same text ' },
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data).toEqual(first.body.data);
    expect(a.world.quickComments).toHaveLength(1);
    expect(a.world.audits.map((x) => x.action)).toEqual(['quick_comment_save']);
  });

  it.each([
    ['a missing role', { body: 'Text' }],
    ['a role that is not a reviewer role', { role: 'ADMIN', body: 'Text' }],
    ['an unknown role', { role: 'NOPE', body: 'Text' }],
    ['an empty body', { role: 'ASSESSOR', body: '   ' }],
    ['a body over 2,000 characters', { role: 'ASSESSOR', body: 'x'.repeat(2001) }],
    ['an unknown field', { role: 'ASSESSOR', body: 'Text', extra: 1 }],
  ])('400 VALIDATION_FAILED for %s', async (_label, body) => {
    const res = await a.send('post', '/quick-comments', {
      token: assessorA(),
      body,
    });
    expectError(res, 400, 'VALIDATION_FAILED');
    expect(a.world.quickComments).toEqual([]);
  });

  it('400 VALIDATION_FAILED for a list with no role or an unknown one', async () => {
    expectError(
      await a.send('get', '/quick-comments', { token: assessorA() }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await a.send('get', '/quick-comments?role=NOPE', { token: assessorA() }),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('403 for an ADMIN, who holds no ASSESSOR grant', async () => {
    const res = await a.send('get', '/quick-comments?role=ASSESSOR', {
      token: bearer('sub-admin'),
    });
    expectError(res, 403, 'AUTH_PERMISSION_DENIED');
  });
});
