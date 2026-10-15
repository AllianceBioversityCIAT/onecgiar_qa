import { RedirectUriNotAllowedError } from './auth.errors.js';

/** Characters that may follow the origin: the end, or the start of path, query or fragment. */
const AFTER_ORIGIN = new Set(['', '/', '?', '#']);

/**
 * FR-6 / FR-7: a redirect URI is allowed only when it starts with one of the
 * `ALLOWED_ORIGINS`. The URI is parsed and its origin compared for equality,
 * because a plain `startsWith` accepts `https://qa.cgiar.org.evil.com`; the
 * text must also start with that origin and continue right after it, which
 * rejects userinfo (`https://user@qa.cgiar.org`) and backslash tricks that two
 * parsers can read differently.
 */
export function isAllowedRedirectUri(
  redirectUri: string,
  allowedOrigins: readonly string[],
): boolean {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return false;
  }
  const { origin } = url;
  return (
    allowedOrigins.includes(origin) &&
    redirectUri.startsWith(origin) &&
    AFTER_ORIGIN.has(redirectUri.charAt(origin.length))
  );
}

/** Throws `RedirectUriNotAllowedError` (400) unless the URI is allowed. */
export function assertAllowedRedirectUri(
  redirectUri: string,
  allowedOrigins: readonly string[],
): void {
  if (!isAllowedRedirectUri(redirectUri, allowedOrigins)) {
    throw new RedirectUriNotAllowedError();
  }
}
