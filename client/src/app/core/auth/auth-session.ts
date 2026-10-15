import { DestroyRef, PLATFORM_ID, Service, computed, inject, signal } from '@angular/core';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { firstValueFrom, timeout } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { ApiError, CLIENT_ERROR, toApiError } from '../http/api-envelope';
import { AuthApi } from './auth-api';
import {
  Credentials,
  LoginResult,
  NewPasswordChallenge,
  Session,
  UserProfile,
  isChallenge,
} from './auth.models';
import { DeepLink, LOGIN_PATH } from './deep-link';
import { TokenStore } from './token-store';

/**
 * `unknown` until the first refresh answers. Guards WAIT for it instead of reading a default
 * (PRMS `readOnly = true` race, P2-3322).
 */
export type SessionStatus = 'unknown' | 'authenticated' | 'anonymous';

/** `renewed`: new token · `ended`: the server closed the session · `unavailable`: network/503, session kept. */
export type RefreshOutcome = 'renewed' | 'ended' | 'unavailable';

/** The app waits this long for the startup refresh before showing login (a hung API must not freeze the app). */
const STARTUP_REFRESH_TIMEOUT_MS = 8000;

/** Refresh this many seconds before the access token expires. */
const PROACTIVE_REFRESH_MARGIN_S = 60;

/** Holds the signed-in user, the session status and every auth flow. */
@Service()
export class AuthSession {
  private readonly api = inject(AuthApi);
  private readonly tokens = inject(TokenStore);
  private readonly deepLink = inject(DeepLink);
  private readonly router = inject(Router);
  private readonly config = inject(APP_CONFIG);
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly state = signal<SessionStatus>(this.isBrowser ? 'unknown' : 'anonymous');
  private readonly profile = signal<UserProfile | null>(null);
  private readonly busy = signal(false);
  private readonly challengeState = signal<{
    email: string;
    challenge: NewPasswordChallenge;
  } | null>(null);
  private readonly startupProblem = signal<ApiError | null>(null);

  private resolveReady!: () => void;
  private readonly readyPromise = new Promise<void>((resolve) => (this.resolveReady = resolve));
  private signInAttempt: Promise<LoginResult> | null = null;
  private refreshAttempt: Promise<RefreshOutcome> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  readonly status = this.state.asReadonly();
  readonly user = this.profile.asReadonly();
  readonly isSignedIn = computed(() => this.state() === 'authenticated');
  /** True while a login, new-password or SSO exchange is running. */
  readonly signingIn = this.busy.asReadonly();
  /** Set while the first login asks for a new password. */
  readonly pendingChallenge = computed(() => this.challengeState());
  /** Network or service problem on the startup refresh (not a missing session). */
  readonly startupError = this.startupProblem.asReadonly();

  constructor() {
    if (!this.isBrowser) this.resolveReady();
    inject(DestroyRef).onDestroy(() => this.cancelRefreshTimer());
  }

  /** Resolves once the status is no longer `unknown`. */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  /** App start (browser only): one refresh with the cookie recovers the session after a reload. */
  async bootstrap(): Promise<void> {
    if (!this.isBrowser || this.state() !== 'unknown') return;
    try {
      this.apply(
        await firstValueFrom(this.api.refresh().pipe(timeout(STARTUP_REFRESH_TIMEOUT_MS))),
      );
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.status !== 401) this.startupProblem.set(apiError);
      this.clearLocal();
    } finally {
      this.resolveReady();
    }
  }

  /** One attempt at a time: a second call while one runs returns the same promise. */
  signIn(credentials: Credentials): Promise<LoginResult> {
    if (this.signInAttempt) return this.signInAttempt;
    this.busy.set(true);
    this.signInAttempt = firstValueFrom(this.api.login(credentials))
      .then((result) => {
        if (isChallenge(result)) {
          this.challengeState.set({ email: credentials.email, challenge: result });
        } else {
          this.apply(result);
        }
        return result;
      })
      .finally(() => {
        this.signInAttempt = null;
        this.busy.set(false);
      });
    return this.signInAttempt;
  }

  /** Second step of the first login. Throws `AUTH_CHALLENGE_EXPIRED` handling to the caller. */
  async completeNewPassword(newPassword: string): Promise<void> {
    const pending = this.challengeState();
    if (!pending) {
      throw new ApiError({
        status: 401,
        code: 'AUTH_CHALLENGE_EXPIRED',
        message: 'Your sign-in expired. Sign in again.',
      });
    }
    if (this.busy()) return;
    this.busy.set(true);
    try {
      this.apply(
        await firstValueFrom(
          this.api.completeNewPassword(pending.email, newPassword, pending.challenge.session),
        ),
      );
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.code === 'AUTH_CHALLENGE_EXPIRED') this.challengeState.set(null);
      throw apiError;
    } finally {
      this.busy.set(false);
    }
  }

  cancelChallenge(): void {
    this.challengeState.set(null);
  }

  /** Callback URL registered in Cognito: `<origin><ssoCallbackPath>`. */
  ssoRedirectUri(): string {
    return `${this.document.location.origin}${this.config.ssoCallbackPath}`;
  }

  /** Leaves the app for the CGIAR sign-in page; the deep link survives in sessionStorage. */
  async startSso(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const { url } = await firstValueFrom(this.api.providerUrl(this.ssoRedirectUri()));
      this.document.location.assign(url);
    } finally {
      this.busy.set(false);
    }
  }

  /** Back from SSO: exchanges the one-time code for a session. */
  async completeSso(code: string): Promise<void> {
    this.busy.set(true);
    try {
      this.apply(await firstValueFrom(this.api.exchangeCode(code, this.ssoRedirectUri())));
    } finally {
      this.busy.set(false);
      this.resolveReady();
    }
  }

  /**
   * Shared refresh: concurrent callers (interceptor 401s, the timer) get ONE request.
   * Only `ended` clears the session; a network blip or 503 keeps it (the server keeps the cookies on 503).
   */
  refresh(): Promise<RefreshOutcome> {
    if (this.refreshAttempt) return this.refreshAttempt;
    this.refreshAttempt = firstValueFrom(this.api.refresh())
      .then((session): RefreshOutcome => {
        this.apply(session);
        return 'renewed';
      })
      .catch((error: unknown): RefreshOutcome => {
        const apiError = toApiError(error);
        if (apiError.code === CLIENT_ERROR.NETWORK || apiError.status === 503) return 'unavailable';
        this.clearLocal();
        return 'ended';
      })
      .finally(() => (this.refreshAttempt = null));
    return this.refreshAttempt;
  }

  /** The server rejected the session: sign out locally and go to login, keeping where the user was. */
  async expire(): Promise<void> {
    this.deepLink.save(this.router.url);
    this.clearLocal();
    await this.router.navigateByUrl(LOGIN_PATH);
  }

  /** Server logout (revokes and clears cookies); the local session ends even if the call fails. */
  async signOut(): Promise<void> {
    try {
      if (this.isSignedIn()) await firstValueFrom(this.api.logout());
    } catch {
      // Offline or already expired: nothing else to revoke from here.
    } finally {
      this.clearLocal();
      await this.router.navigateByUrl(LOGIN_PATH);
    }
  }

  private apply(session: Session): void {
    this.tokens.set(session.accessToken, session.expiresIn);
    this.profile.set(session.user);
    this.challengeState.set(null);
    this.startupProblem.set(null);
    this.state.set('authenticated');
    this.scheduleRefresh(session.expiresIn);
  }

  private clearLocal(): void {
    this.cancelRefreshTimer();
    this.tokens.clear();
    this.profile.set(null);
    this.challengeState.set(null);
    this.state.set('anonymous');
  }

  private scheduleRefresh(expiresInSeconds: number): void {
    this.cancelRefreshTimer();
    if (!this.isBrowser) return;
    const delayMs =
      Math.max(expiresInSeconds - PROACTIVE_REFRESH_MARGIN_S, expiresInSeconds / 2) * 1000;
    this.refreshTimer = setTimeout(() => void this.refresh(), delayMs);
  }

  private cancelRefreshTimer(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }
}
