import { Credentials, Session } from './auth.models';

/**
 * TODO(api): DESIGN BRANCH ONLY. One hardcoded ADMIN so the design preview can be used while no
 * real QA user exists for the designer. Never calls the API. Remove before this branch goes to
 * staging-center.
 */
export const DESIGN_USER = { email: 'design@qa.cgiar', password: 'design-preview' } as const;

/** sessionStorage flag: the design user stays signed in across reloads of this tab. */
export const DESIGN_SESSION_KEY = 'qa.designSession';

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
