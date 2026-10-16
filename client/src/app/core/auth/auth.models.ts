/**
 * Auth contract of the QA server (`docs/specs/auth/cognito-native-session/design.md` § 6,
 * `server/src/auth/**`). Copied by hand until a shared package exists (TRD ADR-007).
 */

/** Role names as stored in `role_assignments` (`server/src/users/schema/roles.ts`). */
export type RoleName = 'ADMIN' | 'LEAD_ASSESSOR' | 'ASSESSOR' | 'TPB' | 'PPU' | 'PROGRAM';

export interface Assignment {
  readonly role: RoleName;
  /** Present for result-type scoped roles (ASSESSOR, LEAD_ASSESSOR). */
  readonly resultTypeKey?: string;
  /** Present for program scoped roles (PROGRAM). */
  readonly programId?: number;
}

export interface UserProfile {
  readonly id: number;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly authSource: 'sso' | 'custom';
  /** Empty = guest: signed in, read only. */
  readonly assignments: readonly Assignment[];
}

export interface Session {
  readonly accessToken: string;
  /** Seconds until the access token expires. */
  readonly expiresIn: number;
  readonly user: UserProfile;
}

/** First login of a custom user: a new password must be set before a session exists. */
export interface NewPasswordChallenge {
  readonly challenge: 'NEW_PASSWORD_REQUIRED';
  readonly session: string;
}

export type LoginResult = Session | NewPasswordChallenge;

export interface Credentials {
  readonly email: string;
  readonly password: string;
}

export function isChallenge(result: LoginResult): result is NewPasswordChallenge {
  return (result as NewPasswordChallenge).challenge === 'NEW_PASSWORD_REQUIRED';
}

/** Server error codes the auth screens branch on (`server/src/common/error-codes.ts`). */
export const AUTH_ERROR = {
  INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  PASSWORD_POLICY: 'AUTH_PASSWORD_POLICY',
  CHALLENGE_EXPIRED: 'AUTH_CHALLENGE_EXPIRED',
  SSO_CODE_INVALID: 'AUTH_SSO_CODE_INVALID',
  SESSION_MISSING: 'AUTH_SESSION_MISSING',
  SESSION_EXPIRED: 'AUTH_SESSION_EXPIRED',
  TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  USER_NOT_ADMITTED: 'AUTH_USER_NOT_ADMITTED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  USER_NOT_REGISTERED: 'AUTH_USER_NOT_REGISTERED',
  USER_INACTIVE: 'AUTH_USER_INACTIVE',
  NO_ACTIVE_ROLES: 'AUTH_NO_ACTIVE_ROLES',
  EMAIL_NOT_VERIFIED: 'AUTH_EMAIL_NOT_VERIFIED',
  EMAIL_CONFLICT: 'AUTH_EMAIL_CONFLICT',
  LOGIN_INCOMPLETE: 'AUTH_LOGIN_INCOMPLETE',
  ORIGIN_NOT_ALLOWED: 'AUTH_ORIGIN_NOT_ALLOWED',
  REDIRECT_URI_NOT_ALLOWED: 'AUTH_REDIRECT_URI_NOT_ALLOWED',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  SERVICE_UNAVAILABLE: 'AUTH_SERVICE_UNAVAILABLE',
} as const;

/** Admission refusals that close the session on refresh (the server clears the cookies, FR-13). */
const ADMISSION_REFUSALS: ReadonlySet<string> = new Set([
  AUTH_ERROR.USER_INACTIVE,
  AUTH_ERROR.NO_ACTIVE_ROLES,
  AUTH_ERROR.USER_NOT_REGISTERED,
  AUTH_ERROR.EMAIL_NOT_VERIFIED,
  AUTH_ERROR.EMAIL_CONFLICT,
]);

/**
 * The server refused the session itself: a 401, or a known admission refusal (403/409). Listed codes
 * only: a 403 on Origin (the OriginGuard keeps the cookies, FR-14) or a gateway/WAF 403 without our
 * envelope must not sign the user out.
 */
export function endsSession(error: { status: number; code: string }): boolean {
  return error.status === 401 || ADMISSION_REFUSALS.has(error.code);
}
