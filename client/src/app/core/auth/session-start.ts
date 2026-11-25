import { isSpPath } from '../../../sp-frame-ancestors';
import type { AuthSession } from './auth-session';

/**
 * How the Cognito session starts for the page the app is born on (the app initializer).
 *
 * The Science Program view (`/sp`, P2-3911) lives in Reporting's iframe with its own SP session and must never
 * recover the Cognito one: Reporting and QA share the site (`cgiar.org`), so the refresh cookie travels inside
 * the iframe and a person who also has a QA account would get that session there. It also made the one-time
 * code wait for a refresh call. Every other page recovers the session from the refresh cookie as before.
 */
export function startSession(session: Pick<AuthSession, 'bootstrap' | 'startAnonymous'>, pathname: string): Promise<void> | void {
  return isSpPath(pathname) ? session.startAnonymous() : session.bootstrap();
}
