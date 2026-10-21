import { Credentials, Session } from './auth.models';

/**
 * TODO(api): one hardcoded ADMIN so the design preview can be used while no real QA user exists
 * for the designer. Never calls the API, and only works on DESIGN_HOSTS. Remove once the designer
 * has a real QA account.
 */
export const DESIGN_USER = { email: 'design@qa.cgiar', password: 'design-preview' } as const;

/** sessionStorage flag: the design user stays signed in across reloads of this tab. */
export const DESIGN_SESSION_KEY = 'qa.designSession';

/**
 * Hosts where the design user works: Juanpa's design preview (CloudFront) and local design work.
 * Anywhere else (qatest, production) it is off: it gave a client-side ADMIN UI to anyone who knew
 * the password (found 21-oct-2026; the API refuses its fake token, but every admin screen showed).
 */
const DESIGN_HOSTS = ['localhost', '127.0.0.1', 'd1q06uhr5i46v9.cloudfront.net'];

export function designUserAllowed(hostname: string): boolean {
  return DESIGN_HOSTS.includes(hostname.toLowerCase());
}

export function isDesignUser(credentials: Credentials): boolean {
  return (
    credentials.email.trim().toLowerCase() === DESIGN_USER.email &&
    credentials.password === DESIGN_USER.password
  );
}

export function designSession(): Session {
  return {
    accessToken: 'design-preview',
    expiresIn: 12 * 3600,
    user: {
      id: 0,
      email: DESIGN_USER.email,
      firstName: 'Design',
      lastName: 'Preview',
      authSource: 'custom',
      assignments: [{ role: 'ADMIN' }],
    },
  };
}
