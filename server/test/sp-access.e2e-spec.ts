// P2-3911 (SP view): the Reporting link codes, their exchange for an SP
// session, and the SP session guard, over real HTTP. Contract:
// docs/sp-view/reporting-integration.md § 2-3. Expected values are written out.
import { createHash } from 'node:crypto';
import request from 'supertest';
import {
  bearer,
  buildAssessmentApp,
  withoutRequestMeta,
  type AssessmentApp,
} from './support/assessment-app.js';
import { LogSpy } from './support/log-spy.js';

const KEY = 'test-sp-access-key-0000000000000000';
const AT = new Date('2026-11-17T10:00:00.000Z');
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

const IDENTITY = {
  email: 'sp-user@example.org',
  name: 'Sam Program',
  programCode: 'SP01',
  isReportingAdmin: false,
};

describe('SP access: link codes and sessions (e2e)', () => {
  let a: AssessmentApp;
  const http = () => request(a.app.getHttpServer());
  const issue = (body: object, key: string | null = KEY) => {
    const call = http().post('/api/v1/sp-access/codes');
    if (key !== null) call.set('x-api-key', key);
    return call.send(body);
  };
  const exchange = (code: unknown, ip = '203.0.113.7') =>
    http()
      .post('/api/v1/sp-access/session')
      .set('X-Forwarded-For', ip)
      .send({ code });

  beforeEach(async () => {
    a = await buildAssessmentApp(AT);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await a.app.close();
  });

  describe('POST /sp-access/codes', () => {
    it('issues a 43-character base64url code that lasts 60 s, and stores only its SHA-256', async () => {
      const res = await issue(IDENTITY).expect(201);
      expect(res.body.success).toBe(true);
      expect(Object.keys(res.body.data).sort()).toEqual(['code', 'expiresAt']);
      const { code, expiresAt } = res.body.data;
      expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(expiresAt).toBe('2026-11-17T10:01:00.000Z');
      expect(a.spAccess.codes).toHaveLength(1);
      const row = a.spAccess.codes[0]!;
      expect(row.codeHash).toBe(sha256(code));
      expect(JSON.stringify(a.spAccess.codes)).not.toContain(code);
      expect(row).toMatchObject({
        email: 'sp-user@example.org',
        name: 'Sam Program',
        programId: 1,
        isReportingAdmin: false,
      });
    });

    it('never issues the same code twice', async () => {
      const one = await issue(IDENTITY).expect(201);
      const two = await issue(IDENTITY).expect(201);
      expect(one.body.data.code).not.toBe(two.body.data.code);
    });

    it.each([
      ['missing', null],
      ['wrong', 'test-sp-access-key-0000000000000001'],
      ['empty', ''],
    ])(
      'refuses a %s x-api-key with 401 SP_ACCESS_KEY_INVALID, before reading the body',
      async (_, key) => {
        const res = await issue({ unknown: true }, key).expect(401);
        expect(res.body.error).toMatchObject({
          status: 401,
          code: 'SP_ACCESS_KEY_INVALID',
        });
        expect(a.spAccess.codes).toEqual([]);
      },
    );

    it('maps the program code case-insensitively and trimmed', async () => {
      await issue({ ...IDENTITY, programCode: '  sp02 ' }).expect(201);
      expect(a.spAccess.codes[0]!.programId).toBe(2);
    });

    it.each([
      ['an unknown code', { programCode: 'SP99' }],
      ['null for a non-admin', { programCode: null }],
      ['blank', { programCode: '   ' }],
    ])('answers 400 SP_PROGRAM_UNKNOWN for %s', async (_, patch) => {
      const res = await issue({ ...IDENTITY, ...patch }).expect(400);
      expect(res.body.error.code).toBe('SP_PROGRAM_UNKNOWN');
      expect(a.spAccess.codes).toEqual([]);
    });

    it('lets an admin send null (no program) or a code', async () => {
      await issue({
        ...IDENTITY,
        programCode: null,
        isReportingAdmin: true,
      }).expect(201);
      await issue({ ...IDENTITY, isReportingAdmin: true }).expect(201);
      expect(a.spAccess.codes.map((c) => c.programId)).toEqual([null, 1]);
    });

    it.each([
      ['a missing email', { email: undefined }, 'email'],
      ['a bad email', { email: 'not-an-email' }, 'email'],
      [
        'a too long email',
        { email: `${'a'.repeat(310)}@example.org` },
        'email',
      ],
      ['a blank name', { name: '   ' }, 'name'],
      ['a too long name', { name: 'n'.repeat(201) }, 'name'],
      ['a missing programCode', { programCode: undefined }, 'programCode'],
      [
        'a too long programCode',
        { programCode: 'S'.repeat(33) },
        'programCode',
      ],
      [
        'a missing isReportingAdmin',
        { isReportingAdmin: undefined },
        'isReportingAdmin',
      ],
      [
        'a string isReportingAdmin',
        { isReportingAdmin: 'true' },
        'isReportingAdmin',
      ],
      ['an unknown field', { role: 'Lead' }, 'role'],
    ])('answers 400 VALIDATION_FAILED for %s', async (_, patch, field) => {
      const res = await issue({ ...IDENTITY, ...patch }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(
        (res.body.error.fields as Array<{ field: string }>).map((f) => f.field),
      ).toContain(field);
      expect(a.spAccess.codes).toEqual([]);
    });
  });

  describe('POST /sp-access/codes when no key is configured', () => {
    it('answers 503 SP_ACCESS_DISABLED, whatever key is sent', async () => {
      const off = await buildAssessmentApp(AT, { spAccess: {} });
      try {
        for (const key of [KEY, null]) {
          const call = request(off.app.getHttpServer()).post(
            '/api/v1/sp-access/codes',
          );
          if (key !== null) call.set('x-api-key', key);
          const res = await call.send(IDENTITY).expect(503);
          expect(res.body.error.code).toBe('SP_ACCESS_DISABLED');
        }
        expect(off.spAccess.codes).toEqual([]);
      } finally {
        await off.app.close();
      }
    });
  });

  describe('POST /sp-access/session', () => {
    it('trades a code for an 8 h session, storing only the token hash', async () => {
      const { code } = (await issue(IDENTITY).expect(201)).body.data;
      const res = await exchange(code).expect(200);
      expect(res.body.data).toEqual({
        accessToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        expiresAt: '2026-11-17T18:00:00.000Z',
        user: { name: 'Sam Program' },
        program: { id: 1, code: 'SP01', name: 'Breeding' },
        isReportingAdmin: false,
      });
      const token = res.body.data.accessToken as string;
      expect(a.spAccess.sessions).toHaveLength(1);
      expect(a.spAccess.sessions[0]!.tokenHash).toBe(sha256(token));
      expect(JSON.stringify(a.spAccess.sessions)).not.toContain(token);
      expect(res.text).not.toContain('sp-user@example.org');
    });

    it('answers an admin without a program with program null', async () => {
      const { code } = (
        await issue({
          ...IDENTITY,
          programCode: null,
          isReportingAdmin: true,
        }).expect(201)
      ).body.data;
      const res = await exchange(code).expect(200);
      expect(res.body.data).toMatchObject({
        program: null,
        isReportingAdmin: true,
      });
    });

    it('answers unknown, used and expired codes with one identical 401 SP_CODE_INVALID', async () => {
      const { code } = (await issue(IDENTITY).expect(201)).body.data;
      await exchange(code).expect(200);
      const used = await exchange(code).expect(401);
      const unknown = await exchange('x'.repeat(43)).expect(401);
      const { code: late } = (await issue(IDENTITY).expect(201)).body.data;
      a.setClock(new Date(AT.getTime() + 60_001));
      const expired = await exchange(late).expect(401);
      expect(used.body.error.code).toBe('SP_CODE_INVALID');
      expect(withoutRequestMeta(unknown.body)).toEqual(
        withoutRequestMeta(used.body),
      );
      expect(withoutRequestMeta(expired.body)).toEqual(
        withoutRequestMeta(used.body),
      );
      expect(a.spAccess.sessions).toHaveLength(1);
    });

    it('still accepts a code at exactly 60 s', async () => {
      const { code } = (await issue(IDENTITY).expect(201)).body.data;
      a.setClock(new Date(AT.getTime() + 60_000));
      await exchange(code).expect(200);
    });

    it('answers 400 VALIDATION_FAILED without a code', async () => {
      const res = await http()
        .post('/api/v1/sp-access/session')
        .send({})
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('limits the exchange to 10 requests per minute per IP (429)', async () => {
      for (let i = 0; i < 10; i++) {
        await exchange('x'.repeat(43), '192.0.2.10').expect(401);
      }
      const res = await exchange('x'.repeat(43), '192.0.2.10').expect(429);
      expect(res.body.error.code).toBe('TOO_MANY_REQUESTS');
      // Another address is not limited.
      await exchange('x'.repeat(43), '192.0.2.11').expect(401);
    });
  });

  describe('the SP session guard (GET /sp/me)', () => {
    const me = (token: string | null) => a.spSend('get', '/sp/me', token);

    it('answers the session user and program, never the email', async () => {
      const token = await a.spLogin();
      const res = await me(token).expect(200);
      expect(res.body.data).toEqual({
        user: { name: 'Sam Program' },
        isReportingAdmin: false,
        program: { id: 1, code: 'SP01', name: 'Breeding' },
        programs: [{ id: 1, code: 'SP01', name: 'Breeding' }],
      });
      expect(res.text).not.toContain('sp-user@example.org');
    });

    it('lists every Science Program for an admin', async () => {
      const token = await a.spLogin({
        programCode: null,
        isReportingAdmin: true,
      });
      const res = await me(token).expect(200);
      expect(res.body.data).toMatchObject({
        isReportingAdmin: true,
        program: null,
      });
      expect(
        (res.body.data.programs as Array<{ code: string }>).map((p) => p.code),
      ).toEqual(['SP01', 'SP02', 'SP03']);
    });

    it.each([
      ['no token', null],
      ['an unknown token', 'x'.repeat(43)],
    ])('answers 401 SP_SESSION_INVALID with %s', async (_, token) => {
      const res = await me(token).expect(401);
      expect(res.body.error.code).toBe('SP_SESSION_INVALID');
    });

    it('treats a valid Cognito access token as an unknown SP token (401)', async () => {
      const res = await http()
        .get('/api/v1/sp/me')
        .set('Authorization', bearer('sub-assessor'))
        .expect(401);
      expect(res.body.error.code).toBe('SP_SESSION_INVALID');
    });

    it('refuses an SP token on a Cognito route (401 AUTH_TOKEN_INVALID)', async () => {
      const token = await a.spLogin();
      const res = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
      expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID');
    });

    it('ends the session 8 h after the exchange', async () => {
      const token = await a.spLogin();
      a.setClock(new Date(AT.getTime() + 8 * 3600_000 - 1));
      await me(token).expect(200);
      a.setClock(new Date(AT.getTime() + 8 * 3600_000));
      const res = await me(token).expect(401);
      expect(res.body.error.code).toBe('SP_SESSION_INVALID');
    });
  });

  describe('logs (never an email, name, code, token or key)', () => {
    it('writes one fixed-shape sp_access line per issue and exchange, with ids and words only', async () => {
      const spy = new LogSpy();
      spy.attach();
      try {
        const issued = await issue({
          ...IDENTITY,
          name: 'Zebulon Plantedname',
        }).expect(201);
        const code = issued.body.data.code as string;
        const exchanged = await exchange(code).expect(200);
        const token = exchanged.body.data.accessToken as string;
        await exchange(code).expect(401);
        await issue(IDENTITY, 'wrong-key-value-planted-0000000000').expect(401);
        await issue({ ...IDENTITY, programCode: 'SP99' }).expect(400);
        await me_(token);

        const all = spy.lines.join('\n');
        for (const secret of [
          code,
          token,
          KEY,
          'wrong-key-value-planted',
          'sp-user@example.org',
          'Zebulon',
          'Plantedname',
        ]) {
          expect(all, secret).not.toContain(secret);
        }
        const lines = spy.lines
          .filter((l) => l.includes('"event":"sp_access"'))
          .map((l) => JSON.parse(l) as Record<string, unknown>);
        expect(
          lines.map(({ action, outcome, reason }) => ({
            action,
            outcome,
            reason,
          })),
        ).toEqual([
          { action: 'issue', outcome: 'ok', reason: undefined },
          { action: 'exchange', outcome: 'ok', reason: undefined },
          { action: 'exchange', outcome: 'refused', reason: 'SP_CODE_INVALID' },
          {
            action: 'issue',
            outcome: 'refused',
            reason: 'SP_ACCESS_KEY_INVALID',
          },
          { action: 'issue', outcome: 'refused', reason: 'SP_PROGRAM_UNKNOWN' },
        ]);
        for (const line of lines) {
          expect(Object.keys(line).sort()).toEqual(
            expect.arrayContaining(['action', 'event', 'outcome', 'requestId']),
          );
          for (const key of Object.keys(line)) {
            expect([
              'action',
              'event',
              'outcome',
              'reason',
              'requestId',
            ]).toContain(key);
          }
        }
      } finally {
        spy.detach();
      }
    });
  });

  const me_ = (token: string) => a.spSend('get', '/sp/me', token).expect(200);
});
