import { PLATFORM_ID, Service, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export const LOGIN_PATH = '/login';
export const HOME_PATH = '/';
export const PENDING_REDIRECT_KEY = 'qa.pendingRedirect';

/** Only internal paths are accepted as return targets (no open redirects). */
export function safeReturnUrl(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return HOME_PATH;
  }
  return value;
}

/**
 * Page the user wanted before signing in. Kept in `sessionStorage` (not a query param) because
 * the SSO round trip leaves the app; it holds only a path, never session data. Read once.
 */
@Service()
export class DeepLink {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  save(url: string | null | undefined): void {
    if (!this.isBrowser || !url) return;
    const path = safeReturnUrl(url);
    if (path === HOME_PATH || path.startsWith(LOGIN_PATH) || path.startsWith('/auth/')) return;
    try {
      sessionStorage.setItem(PENDING_REDIRECT_KEY, path);
    } catch {
      // Storage blocked: the user lands on home after sign-in, nothing else breaks.
    }
  }

  /** Returns the saved path (or home) and forgets it. */
  consume(): string {
    if (!this.isBrowser) return HOME_PATH;
    try {
      const saved = sessionStorage.getItem(PENDING_REDIRECT_KEY);
      sessionStorage.removeItem(PENDING_REDIRECT_KEY);
      return safeReturnUrl(saved);
    } catch {
      return HOME_PATH;
    }
  }
}
