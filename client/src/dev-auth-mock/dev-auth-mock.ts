/**
 * DEV ONLY — local stand-in for the QA auth API (`/api/v1/auth/*`) so the whole front flow can be
 * exercised before the deployed API exists. Mounted by `server.ts` only when the build is the `mock`
 * configuration (`environment.mockAuth`) AND `QA_DEV_AUTH_MOCK=1`. Production builds set
 * `mockAuth: false`, so this router is never mounted there.
 *
 * Mirrors the real contract (`docs/specs/auth/cognito-native-session/design.md` § 6): standard
 * envelope, `qa_rt` / `qa_ru` cookies on `Path=/api/v1/auth/session`, Origin check on refresh and
 * logout, short-lived access tokens (120 s) so the refresh path is exercised.
 * Tokens are fake and unsigned: they mean nothing outside this process.
 */
import express, { Request, Response, Router } from 'express';
import { randomUUID } from 'node:crypto';

type Role = 'ADMIN' | 'LEAD_ASSESSOR' | 'ASSESSOR' | 'TPB' | 'PPU' | 'PROGRAM';
interface Assignment {
  role: Role;
  resultTypeKey?: string;
  programId?: number;
}
interface Persona {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  assignments: Assignment[];
  /** Special behaviour on login. */
  behaviour?: 'new-password' | 'inactive' | 'no-roles' | 'rate-limited' | 'sso-only';
}

const PASSWORD = 'mock-password';
const ACCESS_TTL_S = 120;
const COOKIE_PATH = '/api/v1/auth/session';
const COOKIE_MAX_AGE_MS = 30 * 24 * 3600 * 1000;

export const PERSONAS: readonly Persona[] = [
  {
    id: 1,
    email: 'admin@mock.qa',
    firstName: 'Ada',
    lastName: 'Admin',
    assignments: [{ role: 'ADMIN' }],
  },
  {
    id: 2,
    email: 'assessor@mock.qa',
    firstName: 'Abel',
    lastName: 'Assessor',
    assignments: [{ role: 'ASSESSOR', resultTypeKey: 'KP' }],
  },
  {
    id: 3,
    email: 'lead@mock.qa',
    firstName: 'Lea',
    lastName: 'Lead',
    assignments: [{ role: 'LEAD_ASSESSOR', resultTypeKey: 'INNOVATION_DEV' }],
  },
  {
    id: 4,
    email: 'program@mock.qa',
    firstName: 'Pia',
    lastName: 'Program',
    assignments: [{ role: 'PROGRAM', programId: 10 }],
  },
  {
    id: 5,
    email: 'tpb@mock.qa',
    firstName: 'Tom',
    lastName: 'Broker',
    assignments: [{ role: 'TPB' }],
  },
  {
    id: 6,
    email: 'ppu@mock.qa',
    firstName: 'Paz',
    lastName: 'PPU',
    assignments: [{ role: 'PPU' }],
  },
  {
    id: 7,
    email: 'multi@mock.qa',
    firstName: 'Max',
    lastName: 'Multi',
    assignments: [{ role: 'ADMIN' }, { role: 'ASSESSOR', resultTypeKey: 'POLICY' }],
  },
  {
    id: 8,
    email: 'guest@mock.qa',
    firstName: 'Gus',
    lastName: 'Guest',
    assignments: [],
    behaviour: 'sso-only',
  },
  {
    id: 9,
    email: 'newpass@mock.qa',
    firstName: 'Nina',
    lastName: 'New',
    assignments: [{ role: 'ASSESSOR', resultTypeKey: 'KP' }],
    behaviour: 'new-password',
  },
  {
    id: 10,
    email: 'inactive@mock.qa',
    firstName: 'Ivo',
    lastName: 'Inactive',
    assignments: [],
    behaviour: 'inactive',
  },
  {
    id: 11,
    email: 'noroles@mock.qa',
    firstName: 'Noa',
    lastName: 'Noroles',
    assignments: [],
    behaviour: 'no-roles',
  },
  {
    id: 12,
    email: 'ratelimit@mock.qa',
    firstName: 'Rae',
    lastName: 'Limit',
    assignments: [],
    behaviour: 'rate-limited',
  },
];

/** In-memory state of this dev process. */
const refreshTokens = new Map<string, number>(); // refresh token -> persona id
const challenges = new Map<string, number>(); // challenge session -> persona id
const ssoCodes = new Map<string, number>(); // one-time code -> persona id

const meta = () => ({ requestId: randomUUID(), timestamp: new Date().toISOString() });

function ok(res: Response, data: unknown, status = 200): void {
  const m = meta();
  res.status(status).set('x-request-id', m.requestId).json({ success: true, data, meta: m });
}

function fail(
  res: Response,
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): void {
  const m = meta();
  res
    .status(status)
    .set('x-request-id', m.requestId)
    .json({ success: false, error: { status, code, message, ...extra }, meta: m });
}

function profile(p: Persona) {
  return {
    id: p.id,
    email: p.email,
    firstName: p.firstName,
    lastName: p.lastName,
    authSource: p.behaviour === 'sso-only' ? 'sso' : 'custom',
    assignments: p.assignments,
  };
}

function issueSession(res: Response, p: Persona): void {
  const refresh = randomUUID();
  refreshTokens.set(refresh, p.id);
  const cookie = {
    httpOnly: true,
    secure: true,
    sameSite: 'lax' as const,
    path: COOKIE_PATH,
    maxAge: COOKIE_MAX_AGE_MS,
  };
  res.cookie('qa_rt', refresh, cookie);
  res.cookie('qa_ru', p.email, cookie);
  ok(res, {
    accessToken: `mock.${p.id}.${Date.now() + ACCESS_TTL_S * 1000}`,
    expiresIn: ACCESS_TTL_S,
    user: profile(p),
  });
}

function clearCookies(res: Response): void {
  const cookie = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: COOKIE_PATH };
  res.clearCookie('qa_rt', cookie);
  res.clearCookie('qa_ru', cookie);
}

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function ownOrigin(req: Request): string {
  return `${req.protocol}://${req.get('host')}`;
}

/** Same rule as the real OriginGuard: refresh/logout need an allowed Origin (here: this server). */
function originAllowed(req: Request): boolean {
  return req.get('origin') === ownOrigin(req);
}

function personaFromBearer(req: Request): Persona | null {
  const match = /^Bearer mock\.(\d+)\.(\d+)$/.exec(req.get('authorization') ?? '');
  if (!match || Number(match[2]) < Date.now()) return null;
  return PERSONAS.find((p) => p.id === Number(match[1])) ?? null;
}

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c: string) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

function mockSsoPage(redirectUri: string): string {
  const rows = PERSONAS.filter(
    (p) => !['inactive', 'no-roles', 'rate-limited', 'new-password'].includes(p.behaviour ?? ''),
  )
    .map(
      (p) =>
        `<li><a href="/__mock-sso/pick?persona=${p.id}&amp;redirectUri=${encodeURIComponent(redirectUri)}">${escapeHtml(p.email)}</a> — ${p.assignments.map((a) => a.role).join(', ') || 'guest (no roles)'}</li>`,
    )
    .join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Mock CGIAR sign-in</title>
<body style="font-family:system-ui;max-width:40rem;margin:4rem auto;padding:0 1rem">
<h1>Mock CGIAR sign-in (dev only)</h1><p>Pick who you are. This page replaces the Cognito Hosted UI locally.</p>
<ul>${rows}</ul><p><a href="${escapeHtml(redirectUri)}?error=access_denied&amp;error_description=${encodeURIComponent('You cancelled the sign-in.')}">Cancel</a></p></body></html>`;
}

export function devAuthMockRouter(): Router {
  const router = express.Router();
  router.use('/api/v1/auth', express.json());

  router.post('/api/v1/auth/login', (req, res) => {
    const { email, password } = (req.body ?? {}) as { email?: unknown; password?: unknown };
    const fields: { field: string; code: string; message: string }[] = [];
    if (typeof email !== 'string' || !email)
      fields.push({ field: 'email', code: 'REQUIRED', message: 'Enter your email.' });
    if (typeof password !== 'string' || !password)
      fields.push({ field: 'password', code: 'REQUIRED', message: 'Enter your password.' });
    if (fields.length)
      return fail(
        res,
        400,
        'VALIDATION_FAILED',
        'Some fields are missing or invalid. Check them and try again.',
        { fields },
      );

    const p = PERSONAS.find((x) => x.email === String(email).toLowerCase());
    if (p?.behaviour === 'rate-limited')
      return fail(
        res,
        429,
        'TOO_MANY_REQUESTS',
        'Too many attempts. Wait a moment and try again.',
        { retryAfter: 30 },
      );
    if (!p || p.behaviour === 'sso-only' || password !== PASSWORD)
      return fail(res, 401, 'AUTH_INVALID_CREDENTIALS', 'Incorrect email or password.');
    if (p.behaviour === 'inactive')
      return fail(
        res,
        403,
        'AUTH_USER_INACTIVE',
        'Your QA account is inactive. Contact the QA administrator.',
      );
    if (p.behaviour === 'no-roles')
      return fail(
        res,
        403,
        'AUTH_NO_ACTIVE_ROLES',
        'Your account has no active QA role yet. Contact the QA administrator.',
      );
    if (p.behaviour === 'new-password') {
      const session = randomUUID();
      challenges.set(session, p.id);
      return ok(res, { challenge: 'NEW_PASSWORD_REQUIRED', session });
    }
    return issueSession(res, p);
  });

  router.post('/api/v1/auth/complete-new-password', (req, res) => {
    const { newPassword, session } = (req.body ?? {}) as { newPassword?: string; session?: string };
    const id = session ? challenges.get(session) : undefined;
    if (id === undefined)
      return fail(res, 401, 'AUTH_CHALLENGE_EXPIRED', 'Your sign-in expired. Sign in again.');
    if (!newPassword || newPassword.length < 8 || !/\d/.test(newPassword)) {
      return fail(
        res,
        400,
        'AUTH_PASSWORD_POLICY',
        'Use at least 8 characters, including a number.',
      );
    }
    challenges.delete(session!);
    return issueSession(
      res,
      PERSONAS.find((p) => p.id === id)!,
    );
  });

  router.get('/api/v1/auth/provider-url', (req, res) => {
    const redirectUri = String(req.query['redirectUri'] ?? '');
    if (!redirectUri.startsWith(`${ownOrigin(req)}/`))
      return fail(
        res,
        400,
        'AUTH_REDIRECT_URI_NOT_ALLOWED',
        'This sign-in address is not allowed.',
      );
    ok(res, { url: `${ownOrigin(req)}/__mock-sso?redirectUri=${encodeURIComponent(redirectUri)}` });
  });

  router.post('/api/v1/auth/callback', (req, res) => {
    const { code } = (req.body ?? {}) as { code?: string };
    const id = code ? ssoCodes.get(code) : undefined;
    if (id === undefined)
      return fail(
        res,
        401,
        'AUTH_SSO_CODE_INVALID',
        'The sign-in link expired or was already used. Start again.',
      );
    ssoCodes.delete(code!);
    return issueSession(
      res,
      PERSONAS.find((p) => p.id === id)!,
    );
  });

  router.post('/api/v1/auth/session/refresh', (req, res) => {
    if (!originAllowed(req))
      return fail(
        res,
        403,
        'AUTH_ORIGIN_NOT_ALLOWED',
        'This request is not allowed from this site.',
      );
    const token = readCookie(req, 'qa_rt');
    const id = token ? refreshTokens.get(token) : undefined;
    if (!token) return fail(res, 401, 'AUTH_SESSION_MISSING', 'Your session ended. Sign in again.');
    if (id === undefined) {
      clearCookies(res);
      return fail(res, 401, 'AUTH_SESSION_EXPIRED', 'Your session ended. Sign in again.');
    }
    refreshTokens.delete(token);
    return issueSession(
      res,
      PERSONAS.find((p) => p.id === id)!,
    );
  });

  router.post('/api/v1/auth/session/logout', (req, res) => {
    if (!originAllowed(req))
      return fail(
        res,
        403,
        'AUTH_ORIGIN_NOT_ALLOWED',
        'This request is not allowed from this site.',
      );
    const token = readCookie(req, 'qa_rt');
    if (token) refreshTokens.delete(token);
    clearCookies(res);
    res.status(204).end();
  });

  router.get('/api/v1/auth/me', (req, res) => {
    const p = personaFromBearer(req);
    if (!p) return fail(res, 401, 'AUTH_TOKEN_INVALID', 'Your session expired. Sign in again.');
    ok(res, profile(p));
  });

  // Mock of the Cognito Hosted UI: pick a persona, come back with a one-time code.
  router.get('/__mock-sso', (req, res) => {
    const redirectUri = String(req.query['redirectUri'] ?? '');
    if (!redirectUri.startsWith(`${ownOrigin(req)}/`)) {
      res.status(400).send('Bad mock SSO request');
      return;
    }
    res.type('html').send(mockSsoPage(redirectUri));
  });
  router.get('/__mock-sso/pick', (req, res) => {
    const redirectUri = String(req.query['redirectUri'] ?? '');
    const p = PERSONAS.find((x) => x.id === Number(req.query['persona']));
    if (!p || !redirectUri.startsWith(`${ownOrigin(req)}/`)) {
      res.status(400).send('Bad mock SSO request');
      return;
    }
    const code = `mock-code-${randomUUID()}`;
    ssoCodes.set(code, p.id);
    res.redirect(`${redirectUri}?code=${encodeURIComponent(code)}`);
  });

  return router;
}
