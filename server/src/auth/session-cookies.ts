import type { CookieOptions, Response } from 'express';
import { API_PREFIX } from '../common/configure-app.js';

/** The refresh token (FR-9). */
export const REFRESH_COOKIE = 'qa_rt';
/** The Cognito username the refresh needs (FR-13, DD-2). */
export const USERNAME_COOKIE = 'qa_ru';

/**
 * Only the session routes receive the cookies (DD-3): login routes never see
 * the refresh token.
 */
export const SESSION_COOKIE_PATH = `/${API_PREFIX}/auth/session`;

/**
 * The refresh token's lifetime as an env-free constant. Premise P-14 (the app
 * client's refresh-token validity is 30 days) is UNVERIFIED until T-11.
 */
export const SESSION_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Host-only (no `Domain`), `HttpOnly`, `SameSite=Lax`, and `Secure` always,
 * localhost included: browsers accept `Secure` cookies there (design 6).
 */
const ATTRIBUTES: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: SESSION_COOKIE_PATH,
};

/** Sets both session cookies. Both values must be non-empty: the caller checks. */
export function setSessionCookies(
  response: Response,
  refreshToken: string,
  username: string,
): void {
  const options: CookieOptions = {
    ...ATTRIBUTES,
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
  };
  response.cookie(REFRESH_COOKIE, refreshToken, options);
  response.cookie(USERNAME_COOKIE, username, options);
}
