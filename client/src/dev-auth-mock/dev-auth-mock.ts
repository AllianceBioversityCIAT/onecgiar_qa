/**
 * DEV / PREVIEW ONLY — stand-in for the QA auth API (`/api/v1/auth/*`) so the whole front flow can be
 * used before the deployed API exists. Only the `mock` build (with `QA_DEV_AUTH_MOCK=1`) and the
 * `preview` build contain it (see `dev-auth-mock.entry*.ts`); production builds never do.
 *
 * Two kinds of users (Yeck 15-Oct-2026: "correos específicos para la prueba del token… y otros correos
 * falsos… para que entre normal"):
 * - `PERSONAS` (`@mock.qa`): fixed roles and edge cases (new password, inactive, no roles, 429…)
 *   to test tokens, refresh and permissions. Password: `mock-password`.
 * - Any other well-formed email with any password: signs in as ADMIN (sees every screen), like the
 *   old stub login the design preview used.
 *
 * Stateless on purpose: the email travels inside codes and tokens, so it works on several Lambda
 * instances behind CloudFront and across dev-server reloads. Tokens are fake and unsigned.
 * Mirrors the real contract (design.md § 6): envelope, `qa_rt`/`qa_ru` cookies on
 * `Path=/api/v1/auth/session`, Origin rule on refresh/logout, 120 s access tokens.
 */
import express, { Request, Response, Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';

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
const CODE_TTL_MS = 5 * 60_000;
const COOKIE_PATH = '/api/v1/auth/session';
const COOKIE_MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const CALLBACK_PATH = '/auth/callback';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

/** Any other email: an ADMIN with that address (free sign-in for design reviews). */
function freePersona(email: string): Persona {
  const id =
    100000 + (parseInt(createHash('sha1').update(email).digest('hex').slice(0, 6), 16) % 900000);
  const local = email.split('@')[0] ?? email;
  return { id, email, firstName: local, lastName: '', assignments: [{ role: 'ADMIN' }] };
}

function personaFor(email: string): Persona | null {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL.test(normalized)) return null;
  return PERSONAS.find((p) => p.email === normalized) ?? freePersona(normalized);
}

const isTestPersona = (email: string) =>
  PERSONAS.some((p) => p.email === email.trim().toLowerCase());

// ---- stateless tokens: <kind>.<base64url(email)>.<expiry ms> --------------------------------------
const pack = (kind: string, email: string, ttlMs: number) =>
  `${kind}.${Buffer.from(email).toString('base64url')}.${Date.now() + ttlMs}`;

function unpack(kind: string, value: string | null | undefined): Persona | null {
  const parts = (value ?? '').split('.');
  if (parts.length !== 3 || parts[0] !== kind || !(Number(parts[2]) > Date.now())) return null;
  try {
    return personaFor(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

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

const cookieOptions = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: COOKIE_PATH };

function sessionBody(p: Persona) {
  return {
    accessToken: pack('mock', p.email, ACCESS_TTL_S * 1000),
    expiresIn: ACCESS_TTL_S,
    user: profile(p),
  };
}

function issueSession(res: Response, p: Persona): void {
  res.cookie('qa_rt', pack('mock-rt', p.email, COOKIE_MAX_AGE_MS), {
    ...cookieOptions,
    maxAge: COOKIE_MAX_AGE_MS,
  });
  res.cookie('qa_ru', p.email, { ...cookieOptions, maxAge: COOKIE_MAX_AGE_MS });
  ok(res, sessionBody(p));
}

function clearCookies(res: Response): void {
  res.clearCookie('qa_rt', cookieOptions);
  res.clearCookie('qa_ru', cookieOptions);
}

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Refresh/logout must come from the app itself (the real OriginGuard). Behind CloudFront the server
 * sees the Lambda host, not the public one, so the browser's own `Sec-Fetch-Site` decides; locally
 * the Origin is compared with this server.
 */
function originAllowed(req: Request): boolean {
  const origin = req.get('origin');
  if (!origin) return false;
  if (req.get('sec-fetch-site') === 'same-origin') return true;
  return origin === `${req.protocol}://${req.get('host')}`;
}

/** The callback must be this app's `/auth/callback` (any host: the public one differs from the Lambda one). */
function callbackOrigin(redirectUri: string): string | null {
  try {
    const url = new URL(redirectUri);
    return ['http:', 'https:'].includes(url.protocol) && url.pathname === CALLBACK_PATH
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c: string) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

function mockSsoPage(): string {
  const rows = PERSONAS.filter(
    (p) => !['inactive', 'no-roles', 'rate-limited', 'new-password'].includes(p.behaviour ?? ''),
  )
    .map(
      (p) =>
        `<li><a href="/__mock-sso/pick?persona=${p.id}">${escapeHtml(p.email)}</a> — ${p.assignments.map((a) => a.role).join(', ') || 'guest (no roles)'}</li>`,
    )
    .join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Mock CGIAR sign-in</title>
<body style="font-family:system-ui;max-width:40rem;margin:4rem auto;padding:0 1rem">
<h1>Mock CGIAR sign-in (test only)</h1><p>Pick who you are. This page replaces the Cognito Hosted UI until the QA API is live.</p>
<ul>${rows}</ul><p><a href="${CALLBACK_PATH}?error=access_denied">Cancel</a></p></body></html>`;
}

export function devAuthMockRouter(): Router {
  const router = express.Router();
  router.use('/api/v1/auth', express.json());

  router.post('/api/v1/auth/login', (req, res) => {
    const { email, password } = (req.body ?? {}) as { email?: unknown; password?: unknown };
    const fields: { field: string; code: string; message: string }[] = [];
    if (typeof email !== 'string' || !email)
      fields.push({ field: 'email', code: 'REQUIRED', message: 'Enter your email.' });
    else if (!EMAIL.test(email.trim()))
      fields.push({
        field: 'email',
        code: 'INVALID_EMAIL',
        message: 'Enter a valid email address.',
      });
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

    const p = personaFor(String(email))!;
    // Free emails sign in with any password; test personas need the shared password.
    if (!isTestPersona(p.email)) return issueSession(res, p);
    if (p.behaviour === 'rate-limited')
      return fail(
        res,
        429,
        'TOO_MANY_REQUESTS',
        'Too many attempts. Wait a moment and try again.',
        { retryAfter: 30 },
      );
    if (p.behaviour === 'sso-only' || password !== PASSWORD)
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
    if (p.behaviour === 'new-password')
      return ok(res, {
        challenge: 'NEW_PASSWORD_REQUIRED',
        session: pack('mock-chal', p.email, CODE_TTL_MS),
      });
    return issueSession(res, p);
  });

  router.post('/api/v1/auth/complete-new-password', (req, res) => {
    const { newPassword, session } = (req.body ?? {}) as { newPassword?: string; session?: string };
    const p = unpack('mock-chal', session);
    if (!p) return fail(res, 401, 'AUTH_CHALLENGE_EXPIRED', 'Your sign-in expired. Sign in again.');
    if (!newPassword || newPassword.length < 8 || !/\d/.test(newPassword)) {
      return fail(
        res,
        400,
        'AUTH_PASSWORD_POLICY',
        'Use at least 8 characters, including a number.',
      );
    }
    return issueSession(res, p);
  });

  router.get('/api/v1/auth/provider-url', (req, res) => {
    const origin = callbackOrigin(String(req.query['redirectUri'] ?? ''));
    if (!origin)
      return fail(
        res,
        400,
        'AUTH_REDIRECT_URI_NOT_ALLOWED',
        'This sign-in address is not allowed.',
      );
    ok(res, { url: `${origin}/__mock-sso` });
  });

  router.post('/api/v1/auth/callback', (req, res) => {
    const { code } = (req.body ?? {}) as { code?: string };
    const p = unpack('mock-code', code);
    if (!p)
      return fail(
        res,
        401,
        'AUTH_SSO_CODE_INVALID',
        'The sign-in link expired or was already used. Start again.',
      );
    return issueSession(res, p);
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
    if (!token) return fail(res, 401, 'AUTH_SESSION_MISSING', 'Your session ended. Sign in again.');
    const p = unpack('mock-rt', token);
    if (!p) {
      clearCookies(res);
      return fail(res, 401, 'AUTH_SESSION_EXPIRED', 'Your session ended. Sign in again.');
    }
    // Like the real server today (Cognito does not rotate the refresh token, design P-18).
    return ok(res, sessionBody(p));
  });

  router.post('/api/v1/auth/session/logout', (req, res) => {
    if (!originAllowed(req))
      return fail(
        res,
        403,
        'AUTH_ORIGIN_NOT_ALLOWED',
        'This request is not allowed from this site.',
      );
    clearCookies(res);
    res.status(204).end();
  });

  router.get('/api/v1/auth/me', (req, res) => {
    const bearer = /^Bearer (.+)$/.exec(req.get('authorization') ?? '')?.[1];
    const p = unpack('mock', bearer);
    if (!p) return fail(res, 401, 'AUTH_TOKEN_INVALID', 'Your session expired. Sign in again.');
    ok(res, profile(p));
  });

  // Mock of the Cognito Hosted UI: pick a test persona, come back (relative URL: same public host).
  router.get('/__mock-sso', (_req, res) => {
    res.type('html').send(mockSsoPage());
  });
  router.get('/__mock-sso/pick', (req, res) => {
    const p = PERSONAS.find((x) => x.id === Number(req.query['persona']));
    if (!p) {
      res.status(400).send('Bad mock SSO request');
      return;
    }
    res.redirect(
      `${CALLBACK_PATH}?code=${encodeURIComponent(pack('mock-code', p.email, CODE_TTL_MS))}`,
    );
  });

  return router;
}
