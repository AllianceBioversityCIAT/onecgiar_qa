import { PLATFORM_ID, Service, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AuthProvider, AuthUser, Credentials } from './auth-provider';

export const SESSION_STORAGE_KEY = 'qa.session';

/** Holds the signed-in user for the current browser tab. */
@Service()
export class AuthSession {
  private readonly provider = inject(AuthProvider);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly currentUser = signal<AuthUser | null>(this.restore());
  private readonly attemptInFlight = signal(false);
  private pendingAttempt: Promise<AuthUser> | null = null;

  readonly user = this.currentUser.asReadonly();
  readonly isSignedIn = computed(() => this.currentUser() !== null);
  readonly signingIn = this.attemptInFlight.asReadonly();

  /** A call made while another attempt is running returns that same attempt. */
  signIn(credentials: Credentials): Promise<AuthUser> {
    if (this.pendingAttempt) {
      return this.pendingAttempt;
    }
    this.attemptInFlight.set(true);
    this.pendingAttempt = this.provider
      .signIn(credentials)
      .then((user) => {
        this.currentUser.set(user);
        this.persist(user);
        return user;
      })
      .finally(() => {
        this.pendingAttempt = null;
        this.attemptInFlight.set(false);
      });
    return this.pendingAttempt;
  }

  signOut(): void {
    this.currentUser.set(null);
    this.persist(null);
  }

  private restore(): AuthUser | null {
    if (!this.isBrowser) {
      return null;
    }
    try {
      const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      return isAuthUser(parsed) ? { email: parsed.email } : null;
    } catch {
      return null;
    }
  }

  private persist(user: AuthUser | null): void {
    if (!this.isBrowser) {
      return;
    }
    try {
      if (user) {
        sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user));
      } else {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
      }
    } catch {
      // Storage blocked (private mode, quota): the session still lives in memory.
    }
  }
}

function isAuthUser(value: unknown): value is AuthUser {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { email?: unknown }).email === 'string' &&
    (value as { email: string }).email.length > 0
  );
}
